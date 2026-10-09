import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  createBundleSnapshot,
  decryptBundleBytes,
  decryptLegacyBundleBytes,
  encryptBundleBytes,
  extractBundleAtomically,
  isBundleExtracted,
} from '../../scripts/encrypted-modules/bundle.ts';
import {
  ensureMlBundle,
  ML_REQUIRED_FILES,
  ML_UNAVAILABLE_EXIT_STATUS,
  ML_UNAVAILABLE_FALLBACK,
  runGuardedMlCommand,
} from '../../scripts/encrypted-modules/mlRuntime.ts';

function mlBundleFixtureFiles(indexContent) {
  return ML_REQUIRED_FILES.map((filePath) => ({
    path: filePath,
    content:
      filePath === 'index.ts'
        ? indexContent ?? Buffer.from('export const ML_MODULE_BUNDLE_API_VERSION = 1;\n')
        : Buffer.from(`// fixture: ${filePath}\n`),
  }));
}

test('encrypted module bundles preserve source bytes exactly', () => {
  const source = Buffer.from('const label = "Cafe\u0301 \u200b radio";\n', 'utf8');
  const encrypted = encryptBundleBytes(
    [{ path: 'ml/vision/source.ts', content: source }],
    'fixture-password',
  );

  const decrypted = decryptBundleBytes(encrypted, 'fixture-password');

  assert.deepEqual(decrypted.files[0].content, source);
});

test('bundle extraction is complete, lossless, and validated by bundle identity', async (t) => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'napt-ml-bundle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'ml');
  const source = Buffer.from('const sample = "Cafe\u0301 \u200b";\n', 'utf8');
  const decrypted = decryptBundleBytes(
    encryptBundleBytes([{ path: 'vision/source.ts', content: source }], 'fixture-password'),
    'fixture-password',
  );

  await extractBundleAtomically(decrypted, target);

  assert.deepEqual(await fs.readFile(path.join(target, 'vision/source.ts')), source);
  assert.equal(await isBundleExtracted(decrypted, target), true);
  await fs.rm(path.join(target, 'vision/source.ts'));
  assert.equal(await isBundleExtracted(decrypted, target), false);
});

test('invalid bundle paths do not replace an existing extraction', async (t) => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'napt-ml-bundle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'ml');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'preserve.txt'), 'preserve');
  const valid = decryptBundleBytes(
    encryptBundleBytes([{ path: 'vision/source.ts', content: Buffer.from('source') }], 'fixture-password'),
    'fixture-password',
  );
  const invalid = {
    ...valid,
    files: [...valid.files, { path: '../escape.ts', content: Buffer.from('escape') }],
  };

  assert.throws(() => extractBundleAtomically(invalid, target), /path|manifest/i);

  assert.equal(await fs.readFile(path.join(target, 'preserve.txt'), 'utf8'), 'preserve');
  await assert.rejects(fs.access(path.join(root, 'escape.ts')));
});

test('bundle creation rejects missing required module entries', () => {
  assert.throws(
    () => encryptBundleBytes(
      [{ path: 'ml/vision/feature.ts', content: Buffer.from('source') }],
      'fixture-password',
      { requiredFiles: ['ml/index.ts'] },
    ),
    /required.*ml\/index\.ts/i,
  );
});

test('bundle validation rejects wrong keys, truncated data, and duplicate entries', () => {
  const encrypted = encryptBundleBytes(
    [{ path: 'ml/index.ts', content: Buffer.from('export {};') }],
    'fixture-password',
    { requiredFiles: ['ml/index.ts'] },
  );

  assert.throws(() => decryptBundleBytes(encrypted, 'wrong-password'), /authentication/i);
  assert.throws(() => decryptBundleBytes(encrypted.subarray(0, 30), 'fixture-password'), /truncated/i);
  assert.throws(
    () => encryptBundleBytes([
      { path: 'ml/index.ts', content: Buffer.from('first') },
      { path: 'ML/INDEX.TS', content: Buffer.from('duplicate') },
    ], 'fixture-password'),
    /duplicate/i,
  );
});

test('legacy bundles remain readable and are upgraded to lossless identity snapshots', async () => {
  const crypto = await import('node:crypto');
  const password = 'fixture-password';
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const source = Buffer.from('const label = "Cafe\u0301 \u200b";\n', 'utf8');
  const plaintext = JSON.stringify({ files: [{ path: 'ml/index.ts', content: source.toString('base64') }] });
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(password, salt, 32, {
    N: 131072, r: 8, p: 1, maxmem: 268435456,
  }), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const legacy = Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]);

  const decrypted = decryptLegacyBundleBytes(legacy, password);
  const snapshot = createBundleSnapshot(decrypted.files);

  assert.deepEqual(decrypted.files[0].content, source);
  assert.equal(decrypted.bundleId, snapshot.bundleId);
  assert.throws(() => decryptLegacyBundleBytes(legacy, 'wrong-password'), /authentication/i);
});

test('bundle extraction rejects stale or modified output and does not leave partial files', async (t) => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'napt-ml-bundle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'ml');
  const bundle = decryptBundleBytes(
    encryptBundleBytes([
      { path: 'index.ts', content: Buffer.from('export {};') },
      { path: 'vision/decoder.ts', content: Buffer.from('export const decode = true;') },
    ], 'fixture-password', { requiredFiles: ['index.ts'] }),
    'fixture-password',
  );

  await extractBundleAtomically(bundle, target);
  assert.equal(await isBundleExtracted(bundle, target), true);
  await fs.writeFile(path.join(target, 'vision/decoder.ts'), 'modified');
  assert.equal(await isBundleExtracted(bundle, target), false);
  await fs.writeFile(path.join(target, 'vision/decoder.ts'), 'export const decode = true;');
  await fs.writeFile(path.join(target, 'unexpected.ts'), 'stale');
  assert.equal(await isBundleExtracted(bundle, target), false);

  await extractBundleAtomically(bundle, target);
  assert.equal(await isBundleExtracted(bundle, target), true);
  await assert.rejects(fs.access(path.join(target, 'unexpected.ts')));
});

test('ML runtime promotes only an authenticated bundle with its required entry', async (t) => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'napt-ml-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const encryptedPath = path.join(root, 'src/encrypted-modules/ml.bundle.enc');
  const extractedPath = path.join(root, 'src/encrypted-modules/tmp/ml');
  await fs.mkdir(path.dirname(encryptedPath), { recursive: true });
  const source = Buffer.from('export const mlReady = true;\n');
  await fs.writeFile(encryptedPath, encryptBundleBytes(
    mlBundleFixtureFiles(source),
    'fixture-password',
    { requiredFiles: ML_REQUIRED_FILES },
  ));

  const result = await ensureMlBundle(root, { password: 'fixture-password' });

  assert.equal(result.bundleId.length, 64);
  assert.deepEqual(await fs.readFile(path.join(extractedPath, 'index.ts')), source);
});

test('ML runtime rejects a missing bundle and never creates partial extraction output', async (t) => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'napt-ml-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.rejects(
    ensureMlBundle(root, { password: 'fixture-password' }),
    /not found.*ml\.bundle\.enc/i,
  );
  await fs.mkdir(path.join(root, 'src/encrypted-modules'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/encrypted-modules/ml.bundle.enc'), Buffer.from('truncated'));
  await assert.rejects(
    ensureMlBundle(root, { password: 'fixture-password' }),
    /truncated/i,
  );
  await assert.rejects(fs.access(path.join(root, 'src/encrypted-modules/tmp/ml')));
});

test('guarded ML commands pass arguments after readiness and ignore them on fallback', async () => {
  const fallbackLines = [];
  const forwardedArgs = ['--model', 'capture.bin', '--output', 'result.json'];
  let runCount = 0;
  let receivedArgs = [];
  const readyStatus = await runGuardedMlCommand({
    args: forwardedArgs,
    ensureReady: async () => ({}),
    run: async (args) => {
      runCount += 1;
      receivedArgs = [...args];
      return 7;
    },
    writeFallback: (line) => fallbackLines.push(line),
  });
  const unavailableStatus = await runGuardedMlCommand({
    args: ['--ignored', 'secret-path'],
    ensureReady: async () => { throw new Error('invalid encrypted bundle'); },
    run: async () => {
      runCount += 1;
      return 0;
    },
    writeFallback: (line) => fallbackLines.push(line),
  });

  assert.equal(readyStatus, 7);
  assert.equal(unavailableStatus, ML_UNAVAILABLE_EXIT_STATUS);
  assert.equal(runCount, 1);
  assert.deepEqual(fallbackLines, [ML_UNAVAILABLE_FALLBACK]);
  assert.deepEqual(receivedArgs, forwardedArgs);
});

test('ML command entrypoint prints its fixed fallback and exits unavailable without forwarding args', async (t) => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'napt-ml-command-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runner = path.resolve('scripts/encrypted-modules/runMlEntrypoint.mjs');

  const result = spawnSync(process.execPath, [
    runner,
    '--runtime', 'node',
    '--entry', 'scripts/probe.mjs',
    '--', '--help', 'must-not-reach-target',
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, ML_UNAVAILABLE_EXIT_STATUS);
  assert.equal(result.stderr.trim(), ML_UNAVAILABLE_FALLBACK);
  assert.equal(result.stdout, '');
});

test('ML command entrypoint forwards arguments unchanged when the encrypted bundle is ready', async (t) => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'napt-ml-command-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const targetRoot = path.join(root, 'src/encrypted-modules');
  await fs.mkdir(targetRoot, { recursive: true });
  const program = 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n';
  await fs.writeFile(path.join(targetRoot, 'ml.bundle.enc'), encryptBundleBytes([
    ...mlBundleFixtureFiles(),
    { path: 'scripts/probe.mjs', content: Buffer.from(program) },
  ], 'fixture-password', { requiredFiles: ML_REQUIRED_FILES }));
  const runner = path.resolve('scripts/encrypted-modules/runMlEntrypoint.mjs');
  const args = ['--capture', '/tmp/capture file.iq', '--flag=value'];

  const result = spawnSync(process.execPath, [
    runner,
    '--runtime', 'node',
    '--entry', 'scripts/probe.mjs',
    '--',
    ...args,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, UNSAFE_LOCAL_LATEX_PASSWORD: 'fixture-password' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
});
