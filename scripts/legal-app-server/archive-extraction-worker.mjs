import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import zipUtils from 'adm-zip/util/index.js';

async function extract() {
  const { zipPath, destination, maxBytes, maxEntries } = workerData;
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length > maxEntries) throw Object.assign(new Error('Archive has too many entries'), { status: 413 });
  let expandedBytes = 0;
  const names = new Set();
  // Check every entry before writing anything; the parent publishes the
  // temporary extraction directory only after the entire worker succeeds.
  const targets = entries.map(entry => {
    const name = entry.entryName;
    if (!name || name.includes('\\') || name.includes('\0') || path.posix.isAbsolute(name) ||
        name.split('/').some(part => part === '..') || /^[A-Za-z]:/.test(name)) {
      throw Object.assign(new Error('Unsafe archive entry path'), { status: 400 });
    }
    const target = path.resolve(destination, name);
    if (!target.startsWith(`${path.resolve(destination)}${path.sep}`) || names.has(target)) {
      throw Object.assign(new Error('Invalid or duplicate archive entry'), { status: 400 });
    }
    names.add(target);
    const type = (entry.header.attr >>> 16) & 0o170000;
    if (type !== 0 && type !== 0o100000 && type !== 0o040000) {
      throw Object.assign(new Error('Archive links and special files are not allowed'), { status: 400 });
    }
    if ((entry.header.flags & 1) || ![0, 8].includes(entry.header.method)) {
      throw Object.assign(new Error('Unsupported encrypted archive or compression method'), { status: 400 });
    }
    expandedBytes += entry.header.size;
    if (expandedBytes > maxBytes) throw Object.assign(new Error('Expanded archive exceeds its size limit'), { status: 413 });
    return target;
  });
  let actualBytes = 0;
  for (const [index, entry] of entries.entries()) {
    const target = targets[index];
    if (entry.isDirectory) { await fs.mkdir(target, { recursive: true, mode: 0o700 }); continue; }
    const compressed = entry.getCompressedData();
    // Bound the inflater's output even when a malicious ZIP lies about size.
    const allowance = Math.min(entry.header.size, maxBytes - actualBytes);
    const data = entry.header.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, allowance) });
    if (data.length !== entry.header.size || data.length > allowance || zipUtils.crc32(data) !== entry.header.crc) {
      throw Object.assign(new Error('Archive entry size or checksum mismatch'), { status: 400 });
    }
    actualBytes += data.length;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, data, { flag: 'wx', mode: 0o600 });
  }
}
extract().then(() => parentPort.postMessage({ ok: true })).catch(error => {
  parentPort.postMessage({ ok: false, status: error.status ?? (error.code === 'ERR_BUFFER_TOO_LARGE' ? 413 : 400), error: error.message });
});
