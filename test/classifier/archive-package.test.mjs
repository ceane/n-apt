import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { encodeIqCaptureV4, encodeNaptCaptureV4 } from "../../src/ts/webusb/iqCaptureFormat.ts";
import { readCapturePackage } from "../../scripts/classifier/package.mjs";
import { archiveCapturePackage } from "../../scripts/classifier/archive-package.mjs";
import { decryptIqCapturePayload, encryptIqCaptureBytes, inspectIqCapture } from "../../scripts/encrypt_iq_capture.mjs";
import { deriveCaptureProtectionKey, loadIqCaptureKey } from "../../scripts/classifier/crypto.mjs";

const labels = {
  format: "n-apt-native-label-draft-v1",
  sessionId: "archive-test-session",
  annotations: {
    label: "matching",
    channel: "A",
    features: ["bridge", "u-dip", "pulsing"],
    tags: ["no interference"],
  },
  annotationEvents: [],
  interferenceMarkedEvents: [],
};

function capture() {
  return encodeIqCaptureV4({
    metadata: {
      center_frequency_hz: 1_618_000,
      capture_sample_rate_hz: 3_200_000,
      fft_size: 4,
      fft_window: "rectangular",
    },
    frameUpdates: [{
      sample_offset: 0,
      timestamp_us: 1_790_000_000_000_000,
      kind: "Frame",
      frame_sequence: 0,
      patch: {
        center_frequency_hz: 1_618_000,
        capture_sample_rate_hz: 3_200_000,
        fft_size: 4,
        fft_window: "rectangular",
      },
    }],
    chunks: [{
      sample_offset: 0,
      channel: 0,
      data: Uint8Array.from([128, 130, 127, 126, 127, 129, 128, 127]),
    }],
  });
}

test("archives a labeled capture as encrypted IQ with a rebound detached sidecar", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "napt-classifier-archive-"));
  try {
    const packagePath = path.join(directory, "capture.zip");
    const root = path.join(directory, "classification");
    const sourcePath = path.join(directory, "source.iq");
    const labelPath = path.join(directory, "draft.json");
    const envFile = path.join(directory, ".env.test");
    const passkey = "archive-test-only-secret";
    const sourceBytes = await capture();
    await writeFile(sourcePath, sourceBytes);
    await writeFile(labelPath, JSON.stringify(labels));
    await writeFile(envFile, `UNSAFE_LOCAL_USER_PASSWORD=${passkey}\n`);
    const { createCapturePackage } = await import("../../scripts/classifier/package.mjs");
    await createCapturePackage({
      capturePath: sourcePath,
      labelsPath: labelPath,
      outputPath: path.join(directory, "package"),
    });
    const { default: AdmZip } = await import("adm-zip");
    const archive = new AdmZip();
    archive.addLocalFolder(path.join(directory, "package"));
    archive.writeZip(packagePath);

    const result = await archiveCapturePackage({
      packagePath,
      classificationRoot: root,
      split: "train",
      envFile,
      captureSaltProvider: async () => Buffer.alloc(32, 29),
    });
    const storedPackage = await readCapturePackage(result.packagePath);
    assert.equal(storedPackage.metadata.encrypted, true);
    assert.equal(storedPackage.labels.sessionId, labels.sessionId);
    assert.equal(storedPackage.labels.annotations.label, "matching");
    assert.equal(storedPackage.labels.annotations.channel, "A");
    assert.notEqual(storedPackage.captureId, result.sourceCaptureId);
    assert.equal(result.captureId, storedPackage.captureId);
    assert.match(result.packagePath, /train[\\/]matching[\\/]capture-/);

    const csvPath = path.join(root, "labels.csv");
    const csv = await readFile(csvPath, "utf8");
    assert.equal(csv.split(/\r?\n/, 1)[0], "capture_id,split,label,channel,features,tags,capture_file");
    assert.match(csv, /"bridge;u-dip;pulsing"/);
    assert.match(csv, /"no interference"/);
    assert.equal(csv.trim().split(/\r?\n/).length, 2);
    const descriptor = JSON.parse(await readFile(path.join(result.packagePath, "datapackage.json"), "utf8"));
    assert.equal(descriptor.napt.archive.sourceCaptureId, result.sourceCaptureId);
    assert.equal(descriptor.napt.archive.sessionId, labels.sessionId);
    assert.equal(descriptor.napt.archive.encryption, "AES-256-GCM-REDIS-SALT-V1");
    assert.equal(descriptor.napt.archive.saltKey, `capture-protection:${result.sourceCaptureId}`);
    assert.equal(storedPackage.archive.encryption, "AES-256-GCM-REDIS-SALT-V1");

    const storedCapture = path.join(result.packagePath, "captures", storedPackage.captureName);
    const storedCaptureBytes = await readFile(storedCapture);
    const baseKey = await loadIqCaptureKey({ envFile });
    const captureKey = deriveCaptureProtectionKey(baseKey, Buffer.alloc(32, 29));
    baseKey.fill(0);
    assert.deepEqual(
      decryptIqCapturePayload(storedCaptureBytes, captureKey),
      inspectIqCapture(sourceBytes).payload,
    );
    captureKey.fill(0);
    await writeFile(csvPath, "capture_id,split,label,channel,features,tags,capture_file\n");
    const recovered = await archiveCapturePackage({
      packagePath,
      classificationRoot: root,
      split: "train",
      envFile,
    });
    assert.equal(recovered.packagePath, result.packagePath);
    assert.equal(recovered.captureId, result.captureId);
    assert.equal(recovered.existing, true);
    assert.deepEqual(await readFile(storedCapture), storedCaptureBytes);
    assert.equal((await readFile(csvPath, "utf8")).trim().split(/\r?\n/).length, 2);

    const repeated = await archiveCapturePackage({
      packagePath,
      classificationRoot: root,
      split: "train",
      envFile,
    });
    assert.equal(repeated.packagePath, result.packagePath);
    assert.equal((await readFile(csvPath, "utf8")).trim().split(/\r?\n/).length, 2);
    await assert.rejects(
      archiveCapturePackage({
        packagePath,
        classificationRoot: root,
        split: "validation",
        envFile,
      }),
      /different split.*cross-split duplicate/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("archives an already-encrypted V6 NAPT package without changing its bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "napt-classifier-archive-napt-"));
  try {
    const naptPath = path.join(directory, "capture.napt");
    const labelsPath = path.join(directory, "labels.json");
    const packagePath = path.join(directory, "package");
    const root = path.join(directory, "classification");
    const bytes = await encodeNaptCaptureV4({
      metadata: {
        center_frequency_hz: 1_618_000,
        capture_sample_rate_hz: 3_200_000,
        fft_size: 4,
        fft_window: "rectangular",
      },
      frameUpdates: [{
        sample_offset: 0,
        timestamp_us: 1_790_000_000_000_000,
        patch: {
          center_frequency_hz: 1_618_000,
          capture_sample_rate_hz: 3_200_000,
          fft_size: 4,
          fft_window: "rectangular",
        },
      }],
      channels: [{ center_freq_hz: 1_618_000, sample_rate_hz: 3_200_000, bins_per_frame: 4 }],
      data: Uint8Array.from([128, 130, 127, 126]),
      passphrase: "napt-package-test-secret",
    });
    await writeFile(naptPath, bytes);
    await writeFile(labelsPath, JSON.stringify(labels));
    const { createCapturePackage } = await import("../../scripts/classifier/package.mjs");
    await createCapturePackage({ capturePath: naptPath, labelsPath, outputPath: packagePath });

    const result = await archiveCapturePackage({
      packagePath,
      classificationRoot: root,
      split: "train",
      envFile: path.join(directory, "missing.env"),
    });
    const stored = await readCapturePackage(result.packagePath);
    assert.equal(stored.format, "napt");
    assert.equal(stored.metadata.encrypted, true);
    assert.equal(result.captureId, result.sourceCaptureId);
    assert.equal(Buffer.compare(stored.captureBytes, Buffer.from(bytes)), 0);
    const descriptor = JSON.parse(await readFile(path.join(result.packagePath, "datapackage.json"), "utf8"));
    assert.equal(descriptor.napt.archive.encryption, "pre-encrypted");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rewraps a legacy globally-keyed V6 IQ package with a Redis-derived per-capture key", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "napt-classifier-rewrap-"));
  try {
    const sourcePath = path.join(directory, "legacy.iq");
    const labelsPath = path.join(directory, "labels.json");
    const packagePath = path.join(directory, "package");
    const root = path.join(directory, "classification");
    const envFile = path.join(directory, ".env.test");
    const passkey = "legacy-rewrap-test-secret";
    const sourceBytes = await capture();
    await writeFile(envFile, `UNSAFE_LOCAL_USER_PASSWORD=${passkey}\n`);
    const globalKey = await loadIqCaptureKey({ envFile });
    const legacyBytes = encryptIqCaptureBytes(sourceBytes, globalKey);
    globalKey.fill(0);
    await writeFile(sourcePath, legacyBytes);
    await writeFile(labelsPath, JSON.stringify(labels));
    const { createCapturePackage } = await import("../../scripts/classifier/package.mjs");
    await createCapturePackage({ capturePath: sourcePath, labelsPath, outputPath: packagePath });
    const salt = Buffer.alloc(32, 31);

    const result = await archiveCapturePackage({
      packagePath,
      classificationRoot: root,
      split: "train",
      envFile,
      captureSaltProvider: async () => salt,
    });
    const archived = await readCapturePackage(result.packagePath);
    const descriptor = JSON.parse(await readFile(path.join(result.packagePath, "datapackage.json"), "utf8"));
    assert.equal(descriptor.napt.archive.encryption, "AES-256-GCM-REDIS-SALT-V1");
    assert.notEqual(result.captureId, result.sourceCaptureId);
    const vaultKey = await loadIqCaptureKey({ envFile });
    const captureKey = deriveCaptureProtectionKey(vaultKey, salt);
    vaultKey.fill(0);
    assert.deepEqual(decryptIqCapturePayload(archived.captureBytes, captureKey), inspectIqCapture(sourceBytes).payload);
    captureKey.fill(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
