import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The caller holds Cargo's profile lock and supplies the complete successful
// build graph, including fresh artifacts and build-script OUT_DIR directories.
export function pruneRustArtifacts(profile, filenames, {
  now = Date.now(), maxAgeMs = 0, activeCrates, buildDirectories, retainedGenerations = {},
} = {}) {
  profile = path.resolve(profile);
  const live = new Set(filenames.map(file => path.resolve(file)));
  const inodes = new Set();
  for (const file of live) {
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (stat.isFile()) inodes.add(`${stat.dev}:${stat.ino}`);
    }
  }
  const deps = path.join(profile, 'deps');
  const entries = dir => fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  // Cargo reports the top-level executable; preserve its hashed hardlink too.
  for (const name of entries(deps)) {
    const file = path.join(deps, name);
    const stat = fs.lstatSync(file);
    if (stat.isFile() && inodes.has(`${stat.dev}:${stat.ino}`)) live.add(file);
  }
  // macOS may copy the executable instead of hardlinking it. Identify its
  // current hashed Cargo output by content, then retain that generation's
  // split debug objects too: the running binary can refer to those objects.
  const digest = file => {
    const hash = createHash('sha256');
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      let read;
      while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
      return hash.digest('hex');
    } finally { fs.closeSync(fd); }
  };
  for (const file of filenames) {
    if (path.dirname(path.resolve(file)) !== profile || !fs.existsSync(file)) continue;
    const currentStat = fs.lstatSync(file);
    if (!currentStat.isFile()) continue;
    const name = path.basename(file).replace(/\.exe$/, '').replaceAll('-', '_');
    let currentDigest;
    for (const candidateName of entries(deps)) {
      if (!candidateName.startsWith(`${name}-`) || !/-[a-f0-9]+(?:\.exe)?$/.test(candidateName)) continue;
      const candidate = path.join(deps, candidateName);
      if (live.has(candidate)) continue;
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.size !== currentStat.size) continue;
      currentDigest ??= digest(file);
      if (digest(candidate) === currentDigest) live.add(candidate);
    }
  }
  const hashes = new Set();
  for (const file of [...live]) {
    const stem = path.basename(file).replace(/^lib/, '').replace(/\.(rlib|rmeta|so|dylib|dll|exe)$/, '');
    const hash = stem.match(/-([a-f0-9]+)$/)?.[1];
    if (hash) hashes.add(hash);
    live.add(path.join(path.dirname(file), `${stem}.d`));
    live.add(path.join(path.dirname(file), `lib${stem}.rmeta`));
    live.add(path.join(path.dirname(file), `lib${stem}.rlib`));
    live.add(`${file}.dSYM`);
  }
  let bytesRemoved = 0;
  let filesRemoved = 0;
  const inspect = file => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return { newest: stat.mtimeMs, bytes: stat.size };
    let newest = stat.mtimeMs;
    let bytes = stat.isFile() ? stat.size : 0;
    if (stat.isDirectory()) for (const name of entries(file)) {
      const nested = inspect(path.join(file, name));
      newest = Math.max(newest, nested.newest);
      bytes += nested.bytes;
    }
    return { newest, bytes };
  };
  const remove = file => {
    if (fs.lstatSync(file).isSymbolicLink()) return;
    const usage = inspect(file);
    if (!Number.isFinite(usage.newest)) return;
    fs.rmSync(file, { recursive: true, force: true });
    bytesRemoved += usage.bytes;
    filesRemoved += 1;
  };
  for (const name of entries(deps)) {
    const file = path.join(deps, name);
    const stat = fs.lstatSync(file);
    const artifactHash = name.match(/-([a-f0-9]+)(?:\.|$)/)?.[1];
    if (live.has(file) || hashes.has(artifactHash) || stat.isSymbolicLink()) continue;
    if (!stat.isFile() && !name.endsWith('.dSYM')) continue;
    if (maxAgeMs > 0 && now - inspect(file).newest < maxAgeMs) continue;
    remove(file);
  }
  for (const file of filenames) {
    if (path.dirname(path.resolve(file)) !== profile) continue;
    for (const suffix of ['.old', '.old.dSYM']) if (fs.existsSync(`${file}${suffix}`)) remove(`${file}${suffix}`);
  }
  // Do not prune build-script outputs without their provenance from Cargo.
  if (buildDirectories) {
    const build = path.join(profile, 'build');
    const keep = new Set(buildDirectories.map(dir => path.resolve(dir)));
    for (const file of filenames) {
      const relative = path.relative(build, path.resolve(file));
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) keep.add(path.join(build, relative.split(path.sep)[0]));
    }
    for (const dir of keep) {
      const hash = path.basename(dir).match(/-([a-f0-9]+)$/)?.[1];
      if (hash) hashes.add(hash);
    }
    for (const name of entries(build)) {
      const dir = path.join(build, name);
      if (!keep.has(dir)) remove(dir);
    }
    for (const name of entries(path.join(profile, '.fingerprint'))) {
      const hash = name.match(/-([a-f0-9]+)$/)?.[1];
      // A top-level binary may be copied instead of hardlinked. Its small
      // fingerprints are retained even when Cargo omits the hashed filename.
      const crate = name.replace(/-[a-f0-9]+$/, '').replaceAll('-', '_');
      if (!hashes.has(hash) && !activeCrates?.includes(crate)) remove(path.join(profile, '.fingerprint', name));
    }
  }
  const incremental = path.join(profile, 'incremental');
  const generations = new Map();
  for (const name of entries(incremental)) {
    const dir = path.join(incremental, name);
    if (!fs.lstatSync(dir).isDirectory()) continue;
    const crate = name.match(/^([a-zA-Z0-9_]+)-[a-z0-9]+$/)?.[1];
    const usage = inspect(dir);
    if (!Number.isFinite(usage.newest)) continue;
    if (!activeCrates || !crate) {
      if (now - usage.newest >= 14 * 86400000) remove(dir);
      continue;
    }
    if (!activeCrates.includes(crate)) { remove(dir); continue; }
    const group = generations.get(crate) ?? [];
    group.push({ dir, newest: usage.newest });
    generations.set(crate, group);
  }
  for (const [crate, group] of generations) {
    group.sort((a, b) => b.newest - a.newest || a.dir.localeCompare(b.dir));
    const count = Math.max(1, retainedGenerations[crate] ?? 1);
    for (const old of group.slice(count)) remove(old.dir);
    for (const kept of group.slice(0, count)) {
      const dir = kept.dir;
      const sessions = entries(dir).filter(name => name.startsWith('s-') && fs.lstatSync(path.join(dir, name)).isDirectory());
      const finalized = sessions.filter(name => !name.endsWith('-working'));
      // With no completed session, preserve the generation rather than guessing.
      if (!finalized.length) continue;
      finalized.sort((a, b) => inspect(path.join(dir, b)).newest - inspect(path.join(dir, a)).newest || a.localeCompare(b));
      for (const name of sessions) if (name !== finalized[0]) remove(path.join(dir, name));
    }
  }
  return { bytesRemoved, filesRemoved };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { filenames, ...options } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const result = pruneRustArtifacts(process.argv[2], filenames, options);
  console.log(`[Rust cache] Removed ${result.filesRemoved} stale entries (${(result.bytesRemoved / 1024 ** 2).toFixed(1)} MiB); retained current build artifacts and incremental working set.`);
}
