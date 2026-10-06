import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneRustArtifacts } from '../../scripts/build/rustArtifactCache.mjs';

test('prunes stale unused objects but preserves current artifacts, recent files, and other profiles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test_rust_cache_'));
  try {
    const profile = path.join(root, 'dev-fast');
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
    const result = pruneRustArtifacts(profile, [live], { now: Date.now() });
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
    const profile = path.join(root, 'target', 'dev-fast');
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
    env.TEST_CARGO_EXIT = '0';
    const success = spawnSync(process.execPath, [wrapper], { env, encoding: 'utf8' });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(fs.existsSync(stale), false, success.stdout + success.stderr);
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
    const cleanup = spawnSync('python3', [path.resolve('scripts/build/rustCacheCleanup.py'), root, process.execPath, path.resolve('scripts/build/rustArtifactCache.mjs')], { input: '[]', encoding: 'utf8' });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    assert.match(cleanup.stdout, /deferred cleanup/);
    assert.equal(fs.existsSync(stale), true);
  } finally {
    holder.stdin.end();
    await once(holder, 'close');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
