import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneRustArtifacts } from '../../scripts/build/rustArtifactCache.mjs';

test('prunes stale unused objects but preserves current artifacts, recent files, and other profiles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_cache_'));
  try {
    const profile = path.join(root, 'dev-incremental');
    const deps = path.join(profile, 'deps');
    fs.mkdirSync(deps, { recursive: true });
    const live = path.join(deps, 'liblive-123.rlib');
    const metadata = path.join(deps, 'liblive-123.rmeta');
    const stale = path.join(deps, 'libold-456.rlib');
    const recent = path.join(deps, 'libnew-789.rlib');
    for (const file of [live, metadata, stale, recent]) fs.writeFileSync(file, 'artifact');
    for (const file of [live, metadata, stale]) fs.utimesSync(file, 1, 1);
    const other = path.join(root, 'debug', 'deps');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'keep.rlib'), 'other');
    const link = path.join(deps, 'external.rlib');
    fs.symlinkSync(other, link);
    const result = pruneRustArtifacts(profile, [live], { now: Date.now(), maxAgeMs: 86400000 });
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(live), true);
    assert.equal(fs.existsSync(metadata), true);
    assert.equal(fs.existsSync(recent), true);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(other, 'keep.rlib')), true);
    assert.equal(result.bytesRemoved, 8);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('expires inactive incremental caches by newest nested write, without a global folder limit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_incremental_'));
  try {
    const incremental = path.join(root, 'incremental');
    for (let i = 0; i < 8; i++) {
      const dir = path.join(incremental, `crate-${i}`, 'session');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'object.o'), 'cache');
      fs.utimesSync(path.dirname(dir), 1, 1);
    }
    const stale = path.join(incremental, 'expired');
    fs.mkdirSync(stale);
    fs.writeFileSync(path.join(stale, 'object.o'), 'cache');
    fs.utimesSync(path.join(stale, 'object.o'), 1, 1);
    fs.utimesSync(stale, 1, 1);
    pruneRustArtifacts(root, [], { now: Date.now() });
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.readdirSync(incremental).length, 8);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('build wrapper retains fresh dependencies and skips cleanup after a failed build', async () => {
  const { spawnSync } = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_build_'));
  try {
    const profile = path.join(root, 'target', 'dev-incremental');
    const deps = path.join(profile, 'deps');
    fs.mkdirSync(deps, { recursive: true });
    const live = path.join(deps, 'liblive-123.rlib');
    const stale = path.join(deps, 'libold-456.rlib');
    for (const file of [live, stale]) { fs.writeFileSync(file, 'cache'); fs.utimesSync(file, 1, 1); }
    const cargo = path.join(root, 'cargo');
    const message = JSON.stringify({ reason: 'compiler-artifact', fresh: true, filenames: [live], executable: path.join(profile, 'n-apt-backend'), target: { name: 'n-apt-backend' } });
    fs.writeFileSync(cargo, `#!/bin/sh\nprintf '%s\\n' '${message}'\nexit "\${TEST_CARGO_EXIT:-0}"\n`, { mode: 0o755 });
    const wrapper = path.resolve('scripts/build/rustBuild.mjs');
    const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, TEST_CARGO_EXIT: '1' };
    const failed = spawnSync(process.execPath, [wrapper], { env, encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr);
    assert.equal(fs.existsSync(stale), true);
    const retired = path.join(root, 'target', 'dev-fast');
    fs.mkdirSync(retired);
    fs.writeFileSync(path.join(retired, 'old.rlib'), 'legacy');
    env.TEST_CARGO_EXIT = '0';
    const success = spawnSync(process.execPath, [wrapper], { env, encoding: 'utf8' });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(fs.existsSync(stale), false, success.stdout + success.stderr);
    assert.equal(fs.existsSync(path.join(retired, 'old.rlib')), false);
    assert.equal(fs.existsSync(live), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('defers cleanup while Cargo holds the profile lock', async () => {
  const { spawn, spawnSync } = await import('node:child_process');
  const { once } = await import('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_lock_'));
  const deps = path.join(root, 'deps');
  fs.mkdirSync(deps);
  const stale = path.join(deps, 'old.rlib');
  fs.writeFileSync(stale, 'cache');
  fs.utimesSync(stale, 1, 1);
  const holder = spawn('python3', ['-u', '-c', "import fcntl,sys; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX); print('ready'); sys.stdin.read()", path.join(root, '.cargo-lock')]);
  try {
    await once(holder.stdout, 'data');
    const cleanup = spawnSync('python3', [path.resolve('scripts/build/rustCacheCleanup.py'), root, process.execPath, path.resolve('scripts/build/rustArtifactCache.mjs')], { input: JSON.stringify({ filenames: [] }), encoding: 'utf8' });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    assert.match(cleanup.stdout, /deferred cleanup/);
    assert.equal(fs.existsSync(stale), true);
  } finally {
    holder.stdin.end();
    await once(holder, 'close');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves a retired profile while another Cargo command uses it', async () => {
  const { spawn, spawnSync } = await import('node:child_process');
  const { once } = await import('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_retirement_'));
  const profile = path.join(root, 'dev-incremental');
  const retired = path.join(root, 'debug');
  fs.mkdirSync(profile);
  fs.mkdirSync(retired);
  const artifact = path.join(retired, 'keep.rlib');
  fs.writeFileSync(artifact, 'in use');
  const holder = spawn('python3', ['-u', '-c', "import fcntl,sys; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX); print('ready'); sys.stdin.read()", path.join(retired, '.cargo-lock')]);
  try {
    await once(holder.stdout, 'data');
    const cleanup = spawnSync('python3', [path.resolve('scripts/build/rustCacheCleanup.py'), profile, process.execPath, path.resolve('scripts/build/rustArtifactCache.mjs')], { input: JSON.stringify({ filenames: [] }), encoding: 'utf8' });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    assert.match(cleanup.stdout, /debug is busy/);
    assert.equal(fs.existsSync(artifact), true);
  } finally {
    holder.stdin.end();
    await once(holder, 'close');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('successful build immediately removes fresh stale objects and symbol bundles', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_immediate_'));
  try {
    const deps = path.join(profile, 'deps');
    fs.mkdirSync(deps);
    const live = path.join(deps, 'libcurrent-123.rlib');
    const stale = path.join(deps, 'libstale-456.rlib');
    fs.writeFileSync(live, 'live');
    fs.writeFileSync(stale, 'stale');
    fs.mkdirSync(`${stale}.dSYM`);
    fs.writeFileSync(path.join(`${stale}.dSYM`, 'symbols'), 'symbols');
    pruneRustArtifacts(profile, [live]);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(`${stale}.dSYM`), false);
    assert.equal(fs.existsSync(live), true);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('keeps only the latest active crate incremental generation and finalized session', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_generations_'));
  try {
    const incremental = path.join(profile, 'incremental');
    const old = path.join(incremental, 'backend-aaa', 's-old');
    const active = path.join(incremental, 'backend-bbb', 's-latest');
    const previous = path.join(incremental, 'backend-bbb', 's-previous');
    const abandoned = path.join(incremental, 'backend-bbb', 's-abandoned-working');
    const unused = path.join(incremental, 'unused-ccc', 's-latest');
    for (const dir of [old, active, previous, abandoned, unused]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'object.o'), 'cache');
      fs.utimesSync(path.join(dir, 'object.o'), 1, 1);
      fs.utimesSync(dir, 1, 1);
      fs.utimesSync(path.dirname(dir), 1, 1);
    }
    fs.utimesSync(path.join(active, 'object.o'), 100, 100);
    pruneRustArtifacts(profile, [], { activeCrates: ['backend'] });
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(previous), false);
    assert.equal(fs.existsSync(abandoned), false);
    assert.equal(fs.existsSync(unused), false);
    assert.equal(fs.existsSync(active), true);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('removes stale fingerprints and build outputs while retaining reported build-script outputs', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_build_outputs_'));
  try {
    const live = path.join(profile, 'deps', 'libcurrent-123.rlib');
    const out = path.join(profile, 'build', 'script-abc', 'out');
    const liveFingerprint = path.join(profile, '.fingerprint', 'current-123');
    const staleFingerprint = path.join(profile, '.fingerprint', 'old-456');
    const staleBuild = path.join(profile, 'build', 'old-456');
    for (const dir of [path.dirname(live), out, liveFingerprint, staleFingerprint, staleBuild]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(live, 'live');
    fs.writeFileSync(path.join(out, 'native.a'), 'native');
    pruneRustArtifacts(profile, [live], { buildDirectories: [path.dirname(out)] });
    assert.equal(fs.existsSync(staleFingerprint), false);
    assert.equal(fs.existsSync(staleBuild), false);
    assert.equal(fs.existsSync(liveFingerprint), true);
    assert.equal(fs.existsSync(out), true);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('preserves both library and binary incremental working sets with the same crate name', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_same_name_'));
  try {
    const incremental = path.join(profile, 'incremental');
    for (const [name, mtime] of [['backend-aaa', 1], ['backend-bbb', 2], ['backend-ccc', 3]]) {
      const dir = path.join(incremental, name, 's-final');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'object.o'), 'cache');
      for (const file of [dir, path.dirname(dir), path.join(dir, 'object.o')]) fs.utimesSync(file, mtime, mtime);
    }
    pruneRustArtifacts(profile, [], { activeCrates: ['backend'], retainedGenerations: { backend: 2 } });
    assert.equal(fs.existsSync(path.join(incremental, 'backend-aaa')), false);
    assert.equal(fs.existsSync(path.join(incremental, 'backend-bbb')), true);
    assert.equal(fs.existsSync(path.join(incremental, 'backend-ccc')), true);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('drops the previous hot-reload executable after successful replacement compilation', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_old_binary_'));
  try {
    const current = path.join(profile, 'n-apt-backend');
    fs.writeFileSync(current, 'new binary');
    fs.writeFileSync(`${current}.old`, 'previous binary');
    fs.mkdirSync(`${current}.old.dSYM`);
    pruneRustArtifacts(profile, [current]);
    assert.equal(fs.existsSync(current), true);
    assert.equal(fs.existsSync(`${current}.old`), false);
    assert.equal(fs.existsSync(`${current}.old.dSYM`), false);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('real Cargo builds stay fresh after cleanup, including generated code and a same-name library/bin', async () => {
  const { spawnSync } = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_cargo_'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "n-apt-backend"\nversion = "0.1.0"\nedition = "2021"\n[profile.dev-incremental]\ninherits = "dev"\nincremental = true\n');
    fs.writeFileSync(path.join(root, 'build.rs'), 'fn main() { std::fs::write(std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("generated.rs"), "pub const VALUE: u32 = 7;").unwrap(); }');
    fs.writeFileSync(path.join(root, 'src/lib.rs'), 'include!(concat!(env!("OUT_DIR"), "/generated.rs"));\npub fn value() -> u32 { VALUE }');
    fs.writeFileSync(path.join(root, 'src/main.rs'), 'fn main() { println!("{}", n_apt_backend::value()); }');
    const args = [path.resolve('scripts/build/rustBuild.mjs'), '--offline', '--manifest-path', path.join(root, 'Cargo.toml'), '--target-dir', path.join(root, 'target'), '--profile', 'dev-incremental'];
    const build = () => {
      const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /\[Rust cache\] Removed/);
      return result;
    };
    build();
    assert.doesNotMatch(build().stderr, /Compiling n-apt-backend/);
    fs.appendFileSync(path.join(root, 'src/lib.rs'), '\npub fn additional() -> u32 { 8 }');
    assert.match(build().stderr, /Compiling n-apt-backend/);
    assert.doesNotMatch(build().stderr, /Compiling n-apt-backend/);
    const binary = spawnSync(path.join(root, 'target/dev-incremental/n-apt-backend'), [], { encoding: 'utf8' });
    assert.equal(binary.status, 0, binary.stderr);
    assert.equal(binary.stdout.trim(), '7');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('deletes stale build directories containing symlinks without following their targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_symlink_'));
  try {
    const profile = path.join(root, 'profile');
    const stale = path.join(profile, 'build', 'old-123');
    const external = path.join(root, 'keep');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(external, 'external data');
    fs.symlinkSync(external, path.join(stale, 'native-library'));
    pruneRustArtifacts(profile, [], { buildDirectories: [] });
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.readFileSync(external, 'utf8'), 'external data');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
