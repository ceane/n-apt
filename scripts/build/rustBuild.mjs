import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cargo reports fresh artifacts too, so the retained set includes dependencies
// that were reused rather than recompiled. Failed builds never trigger pruning.
const filenames = [];
let valid = true;
let profile;
const child = spawn('cargo', ['build', '--message-format=json-render-diagnostics', ...process.argv.slice(2)], {
  stdio: ['inherit', 'pipe', 'inherit'],
});
const lines = readline.createInterface({ input: child.stdout });
lines.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (message.reason === 'compiler-artifact') {
      filenames.push(...message.filenames);
      if (message.executable && message.target.name === 'n-apt-backend') profile = path.dirname(message.executable);
    } else if (message.reason === 'compiler-message' && message.message.rendered) {
      process.stdout.write(message.message.rendered);
    }
  } catch {
    valid = false;
    console.log(line);
  }
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => {
  if (code === 0 && valid && profile && filenames.length) {
    try {
      if (process.platform === 'win32') {
        console.log('[Rust cache] Automatic cleanup requires a Unix Cargo lock; skipped on Windows.');
      } else {
        const cleanup = spawnSync('python3', [
          fileURLToPath(new URL('./rustCacheCleanup.py', import.meta.url)),
          profile, process.execPath,
          fileURLToPath(new URL('./rustArtifactCache.mjs', import.meta.url)),
        ], { input: JSON.stringify(filenames), encoding: 'utf8' });
        if (cleanup.stdout) process.stdout.write(cleanup.stdout);
        if (cleanup.error || cleanup.status !== 0) console.error('[Rust cache] Cleanup unavailable:', cleanup.error?.message ?? cleanup.stderr);
      }
    } catch (error) { console.error(`[Rust cache] Cleanup failed: ${error.message}`); }
  }
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
