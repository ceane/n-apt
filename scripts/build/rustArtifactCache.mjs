import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Call only after a successful Cargo build with its complete compiler-artifact
// filename list (including fresh dependencies). Never evict the working set.
export function pruneRustArtifacts(profile, filenames, { now = Date.now(), maxAgeMs = 86400000 } = {}) {
  const live = new Set(filenames.map(file => path.resolve(file)));
  // Cargo also emits dep-info beside each compiled artifact.
  for (const file of [...live]) {
    const stem = path.basename(file).replace(/^lib/, '').replace(/\.(rlib|rmeta|so|dylib|dll|exe)$/, '');
    live.add(path.join(path.dirname(file), `${stem}.d`));
    live.add(path.join(path.dirname(file), `lib${stem}.rmeta`));
    live.add(path.join(path.dirname(file), `lib${stem}.rlib`));
  }
  let bytesRemoved = 0;
  let filesRemoved = 0;
  const deps = path.join(profile, 'deps');
  for (const name of fs.existsSync(deps) ? fs.readdirSync(deps) : []) {
    const file = path.resolve(deps, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || live.has(file) || now - stat.mtimeMs < maxAgeMs) continue;
    fs.unlinkSync(file);
    bytesRemoved += stat.size;
    filesRemoved += 1;
  }
  const incremental = path.join(profile, 'incremental');
  const inspect = file => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return { newest: Infinity, bytes: 0 };
    let newest = stat.mtimeMs;
    let bytes = stat.isFile() ? stat.size : 0;
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) {
      const nested = inspect(path.join(file, name));
      newest = Math.max(newest, nested.newest);
      bytes += nested.bytes;
    }
    return { newest, bytes };
  };
  for (const name of fs.existsSync(incremental) ? fs.readdirSync(incremental) : []) {
    const dir = path.join(incremental, name);
    if (!fs.lstatSync(dir).isDirectory()) continue;
    const usage = inspect(dir);
    if (now - usage.newest < 14 * 86400000) continue;
    fs.rmSync(dir, { recursive: true });
    bytesRemoved += usage.bytes;
    filesRemoved += 1;
  }
  return { bytesRemoved, filesRemoved };
}

// Separate process: the parent lock helper keeps Cargo's directory lock held.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filenames = JSON.parse(fs.readFileSync(0, 'utf8'));
  const result = pruneRustArtifacts(process.argv[2], filenames);
  console.log(`[Rust cache] Removed ${result.filesRemoved} stale entries (${(result.bytesRemoved / 1024 ** 2).toFixed(1)} MiB); retained current build artifacts.`);
}
