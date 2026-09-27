import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  encodeIqCaptureV4,
  encodeNaptCaptureV4,
} from "../../src/ts/webusb/iqCaptureFormat.ts";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function iqTrailerDigest(bytes) {
  const readU64 = (offset) =>
    Number(
      new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      ).getBigUint64(offset, true),
    );
  const metadataLength = readU64(8);
  const metadata = JSON.parse(
    Buffer.from(bytes.subarray(40, 40 + metadataLength)).toString("utf8"),
  );
  const trailer = bytes.subarray(
    metadata.sections.trailer.offset_bytes + 24,
    metadata.sections.trailer.offset_bytes +
      metadata.sections.trailer.length_bytes,
  );
  return JSON.parse(Buffer.from(trailer).toString("utf8")).integrity.digest;
}
const annotations = {
  label: "matching",
  channel: "A",
  features: ["bridge", "coherent-continuation"],
  tags: ["stable"],
};
const labelDraft = {
  format: "n-apt-native-label-draft-v1",
  sessionId: "session-a",
  annotations,
  annotationEvents: [],
  interferenceMarkedEvents: [],
};
const updates = [
  {
    sample_offset: 0,
    timestamp_us: 1790500000000000,
    patch: {
      center_frequency_hz: 137500000,
      fft_size: 4096,
      fft_window: "hann",
    },
  },
];

async function iqBytes(samples = [128, 130, 127, 126]) {
  return encodeIqCaptureV4({
    metadata: {
      center_frequency_hz: 137500000,
      capture_sample_rate_hz: 3200000,
    },
    frameUpdates: updates,
    chunks: [{ sample_offset: 0, channel: 0, data: Uint8Array.from(samples) }],
  });
}

async function runPackage(
  root,
  captureName,
  bytes,
  extraArgs = [],
  packageName = "capture-package",
  labels = labelDraft,
) {
  const capturePath = path.join(root, captureName);
  const labelsPath = path.join(root, "label-draft.json");
  const outputPath = path.join(root, packageName);
  await writeFile(capturePath, bytes);
  await writeFile(labelsPath, JSON.stringify(labels));
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/classifier/cli.mjs",
      "package",
      "--capture",
      capturePath,
      "--labels",
      labelsPath,
      "--out",
      outputPath,
      ...extraArgs,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  return { result, capturePath, labelsPath, outputPath };
}

function runPreparePackage(packagePath, outputPath, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/classifier/cli.mjs",
      "prepare",
      "--package",
      packagePath,
      "--split",
      "train",
      "--out",
      outputPath,
      ...extraArgs,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

function runExtract(datasetPath, outputPath) {
  return spawnSync(
    process.execPath,
    [
      "scripts/classifier/cli.mjs",
      "extract",
      "--dataset",
      datasetPath,
      "--fft-sizes",
      "1024",
      "--crops",
      "0:1",
      "--max-frames",
      "1",
      "--out",
      outputPath,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 60000 },
  );
}

function browserCapture() {
  const timestampMs = Date.UTC(2026, 8, 27, 10, 20, 30);
  return Buffer.from(
    JSON.stringify({
      format: "n-apt-native-iq-frames-v1",
      payloadSemantics:
        "each frame stores the complete iq_data payload received for that sequence; frames remain independent and are never concatenated",
      iqSampleFormat: "u8",
      sessionId: "browser-session-a",
      createdAtTimestampMs: timestampMs,
      config: {
        sourceId: "rtl-sdr:0",
        streamEpoch: 3,
        optionsRevision: 0,
        appliedOptions: { mode: "rx" },
        sampleRateHz: 3200000,
        centerFrequencyHz: 137500000,
        configuredFftSize: 4096,
        fftSize: 4096,
        window: "hann",
        temporalResolution: "lossless",
      },
      frames: [
        {
          streamEpoch: 3,
          optionsRevision: 0,
          sequence: 0,
          timestampMs,
          validSamples: 4,
          iqBase64: Buffer.from([
            128, 130, 127, 126, 127, 129, 128, 127,
          ]).toString("base64"),
        },
        {
          streamEpoch: 3,
          optionsRevision: 0,
          sequence: 1,
          timestampMs: timestampMs + 50,
          validSamples: 4,
          iqBase64: Buffer.from([
            128, 130, 127, 126, 127, 129, 128, 127,
          ]).toString("base64"),
        },
      ],
    }),
  );
}

test("packages V6 IQ captures with verified trailer identity while preserving the capture bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napt-data-package-iq-"));
  try {
    const bytes = await iqBytes();
    const name = "capture_20260927_102030.iq";
    const { result, outputPath } = await runPackage(root, name, bytes);
    assert.equal(result.status, 0, result.stderr);

    const captureCopy = await readFile(path.join(outputPath, "captures", name));
    assert.deepEqual(captureCopy, Buffer.from(bytes));
    const labels = JSON.parse(
      await readFile(path.join(outputPath, "labels.json"), "utf8"),
    );
    assert.equal(labels.format, "n-apt-capture-labels-v1");
    assert.equal(labels.captureIdentity.kind, "v6-trailer-sha256");
    assert.equal(labels.captureIdentity.algorithm, "SHA-256");
    assert.equal(
      labels.captureIdentity.scope,
      "file-with-integrity-digest-placeholder",
    );
    assert.equal(labels.captureIdentity.digestHex, iqTrailerDigest(bytes));
    assert.equal(labels.captureId, labels.captureIdentity.digestHex);
    assert.deepEqual(labels.annotations, annotations);
    assert.equal(
      JSON.stringify(labels).includes(Buffer.from(bytes).toString("base64")),
      false,
    );

    const descriptor = JSON.parse(
      await readFile(path.join(outputPath, "datapackage.json"), "utf8"),
    );
    assert.equal(descriptor.resources.length, 2);
    const resource = descriptor.resources.find(
      (item) => item.path === `captures/${name}`,
    );
    assert.equal(resource.bytes, bytes.byteLength);
    assert.equal(resource.hash, `sha256:${hash(bytes)}`);
    assert.notEqual(resource.hash.slice("sha256:".length), labels.captureId);
    assert.equal(
      descriptor.resources.find((item) => item.path === "labels.json").format,
      "json",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packages encrypted V6 NAPT by trailer checksum and timestamped WAV by filename plus UTC time", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napt-data-package-formats-"));
  try {
    const napt = await encodeNaptCaptureV4({
      metadata: {
        center_frequency_hz: 137500000,
        capture_sample_rate_hz: 3200000,
      },
      frameUpdates: updates,
      channels: [
        {
          center_freq_hz: 137500000,
          sample_rate_hz: 3200000,
          bins_per_frame: 4096,
        },
      ],
      data: Uint8Array.of(128, 130, 127, 126),
      passphrase: "fixture-passphrase",
    });
    const naptResult = await runPackage(
      root,
      "capture_20260927_102030.napt",
      napt,
      [],
      "napt-package",
    );
    assert.equal(naptResult.result.status, 0, naptResult.result.stderr);
    const naptLabels = JSON.parse(
      await readFile(path.join(naptResult.outputPath, "labels.json"), "utf8"),
    );
    assert.equal(naptLabels.captureIdentity.kind, "v6-trailer-sha256");
    assert.match(naptLabels.captureIdentity.digestHex, /^[0-9a-f]{64}$/);
    assert.notEqual(naptLabels.captureIdentity.digestHex, "0".repeat(64));
    assert.deepEqual(
      await readFile(
        path.join(
          naptResult.outputPath,
          "captures",
          "capture_20260927_102030.napt",
        ),
      ),
      Buffer.from(napt),
    );

    const wavRoot = await mkdtemp(
      path.join(tmpdir(), "napt-data-package-wav-"),
    );
    try {
      const wav = Buffer.from("RIFF\x04\x00\x00\x00WAVE", "binary");
      const wavName = "capture_job-1_20260927_102030.wav";
      const wavResult = await runPackage(wavRoot, wavName, wav);
      assert.equal(wavResult.result.status, 0, wavResult.result.stderr);
      const wavLabels = JSON.parse(
        await readFile(path.join(wavResult.outputPath, "labels.json"), "utf8"),
      );
      assert.deepEqual(wavLabels.captureIdentity, {
        kind: "filename-timestamp",
        fileName: wavName,
        capturedAtTimestampMs: Date.UTC(2026, 8, 27, 10, 20, 30),
      });
      assert.equal(wavLabels.captureId, `${wavName}@2026-09-27T10:20:30.000Z`);
      assert.deepEqual(
        await readFile(path.join(wavResult.outputPath, "captures", wavName)),
        wav,
      );
    } finally {
      await rm(wavRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repackages browser captures with package labels while enforcing filename/time identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napt-data-package-browser-"));
  try {
    const name = "browser-session_20260927_102030.json";
    const bytes = browserCapture();
    const first = await runPackage(root, name, bytes, [], "first-package");
    assert.equal(first.result.status, 0, first.result.stderr);
    const labels = JSON.parse(
      await readFile(path.join(first.outputPath, "labels.json"), "utf8"),
    );
    assert.equal(labels.captureIdentity.fileName, name);

    const second = await runPackage(
      root,
      name,
      bytes,
      [],
      "second-package",
      labels,
    );
    assert.equal(second.result.status, 0, second.result.stderr);
    const secondLabels = JSON.parse(
      await readFile(path.join(second.outputPath, "labels.json"), "utf8"),
    );
    assert.deepEqual(secondLabels.captureIdentity, labels.captureIdentity);
    assert.equal(secondLabels.captureId, labels.captureId);

    const preparedPath = path.join(root, "browser-prepared");
    const prepared = runPreparePackage(second.outputPath, preparedPath);
    assert.equal(prepared.status, 0, prepared.stderr);
    const preparedDataset = JSON.parse(
      await readFile(path.join(preparedPath, "dataset.json"), "utf8"),
    );
    assert.equal(preparedDataset.recordings.length, 2);
    assert.ok(
      preparedDataset.recordings.every(
        (record) =>
          record.label === "matching" &&
          record.session === "session-a" &&
          record.sourceCaptureId === labels.captureId &&
          record.captureAnnotations.label === annotations.label,
      ),
    );

    const featurePath = path.join(root, "browser-features.jsonl");
    const extracted = runExtract(
      path.join(preparedPath, "dataset.json"),
      featurePath,
    );
    assert.equal(extracted.status, 0, extracted.stderr);
    const featureRows = (await readFile(featurePath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    assert.equal(featureRows.length, 2);
    assert.equal(featureRows[0].sampleRateHz, 3200000);
    assert.equal(featureRows[0].fftSize, 4);
    assert.equal(featureRows[0].validSamples, 4);
    assert.equal(featureRows[0].binHz, 800000);
    assert.equal(featureRows[0].sourceCaptureId, labels.captureId);
    assert.equal(typeof featureRows[0].status, "string");
    assert.equal(featureRows[0].available.narrow, false);
    assert.equal(featureRows[0].temporalFrameCount, 1);
    assert.equal(featureRows[1].temporalFrameCount, 2);

    const mismatched = await runPackage(
      root,
      "different-capture_20260927_102030.json",
      bytes,
      [],
      "mismatched-package",
      labels,
    );
    assert.notEqual(mismatched.result.status, 0);
    assert.match(mismatched.result.stderr, /filename\/time.*does not match/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepares V6 IQ packages by option-patch segments and rejects a changed resource hash", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "napt-data-package-prepare-iq-"),
  );
  try {
    const iq = await encodeIqCaptureV4({
      metadata: {
        center_frequency_hz: 137500000,
        capture_sample_rate_hz: 3200000,
        fft_size: 4096,
        fft_window: "hann",
      },
      frameUpdates: [
        {
          sample_offset: 0,
          timestamp_us: 1790500000000000,
          patch: {
            center_frequency_hz: 137500000,
            capture_sample_rate_hz: 3200000,
            fft_size: 4096,
            fft_window: "hann",
          },
        },
        {
          sample_offset: 8,
          timestamp_us: 1790500000001000,
          patch: {
            center_frequency_hz: 137600000,
            capture_sample_rate_hz: 2400000,
            fft_size: 2048,
            fft_window: "hamming",
          },
        },
      ],
      chunks: [
        {
          sample_offset: 0,
          channel: 0,
          data: Uint8Array.of(128, 130, 127, 126, 129, 125, 130, 128),
        },
        {
          sample_offset: 5,
          channel: 0,
          data: Uint8Array.of(127, 129, 128, 127, 126, 130, 131, 125),
        },
      ],
    });
    const packed = await runPackage(
      root,
      "patched-capture.iq",
      iq,
      [],
      "patched-package",
    );
    assert.equal(packed.result.status, 0, packed.result.stderr);

    const preparedPath = path.join(root, "prepared-iq");
    const prepared = runPreparePackage(packed.outputPath, preparedPath);
    assert.equal(prepared.status, 0, prepared.stderr);
    const dataset = JSON.parse(
      await readFile(path.join(preparedPath, "dataset.json"), "utf8"),
    );
    assert.equal(dataset.recordings.length, 2);
    assert.deepEqual(
      dataset.recordings.map((record) => [
        record.sampleRateHz,
        record.centerFrequencyHz,
        record.analysisFftSize,
        record.window,
      ]),
      [
        [3200000, 137500000, 4096, "hann"],
        [2400000, 137600000, 2048, "hamming"],
      ],
    );
    assert.equal(dataset.recordings[0].timestampStartMs, 1790500000000);
    assert.ok(
      Math.abs(
        dataset.recordings[1].timestampStartMs -
          1790500000001 -
          (1 / 2400000) * 1000,
      ) < 0.0001,
      `unexpected gap-adjusted timestamp: ${dataset.recordings[1].timestampStartMs}`,
    );
    assert.ok(
      dataset.recordings.every(
        (record) =>
          record.session === "session-a" &&
          record.split === "train" &&
          record.label === "matching" &&
          record.sourceCaptureId === record.captureIdentity.digestHex,
      ),
    );
    assert.equal(dataset.recordings[1].optionsAppliedEvents.length, 1);
    assert.equal(dataset.recordings[1].sourceSampleOffsetBytes, 10);
    assert.equal(dataset.recordings[1].sourceChunkGapBefore, true);
    assert.deepEqual(dataset.recordings[0].captureDiscontinuities, [
      { kind: "MissingIqRange", fromByteOffset: 8, toByteOffset: 10 },
    ]);
    for (const record of dataset.recordings) {
      const preparedIq = await readFile(path.join(preparedPath, record.input));
      assert.equal(preparedIq.byteLength, 32);
    }

    const tamperedPath = path.join(root, "tampered-package");
    await cp(packed.outputPath, tamperedPath, { recursive: true });
    const descriptor = JSON.parse(
      await readFile(path.join(tamperedPath, "datapackage.json"), "utf8"),
    );
    const captureResource = descriptor.resources.find(
      (resource) => resource.name === "signal-capture",
    );
    const tamperedCapturePath = path.join(tamperedPath, captureResource.path);
    const tamperedBytes = await readFile(tamperedCapturePath);
    tamperedBytes[tamperedBytes.length - 1] ^= 1;
    await writeFile(tamperedCapturePath, tamperedBytes);
    const rejected = runPreparePackage(
      tamperedPath,
      path.join(root, "tampered-prepared"),
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /hash|integrity/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepares encrypted V6 NAPT packages through the existing password-file decrypt path", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "napt-data-package-prepare-napt-"),
  );
  try {
    const napt = await encodeNaptCaptureV4({
      metadata: {
        center_frequency_hz: 137500000,
        capture_sample_rate_hz: 3200000,
        fft_size: 4096,
        fft_window: "Hanning",
      },
      frameUpdates: updates,
      channels: [
        {
          center_freq_hz: 137500000,
          sample_rate_hz: 3200000,
          bins_per_frame: 4096,
        },
      ],
      data: Uint8Array.of(128, 130, 127, 126, 129, 125, 130, 128),
      passphrase: "fixture-passphrase",
    });
    const packed = await runPackage(
      root,
      "encrypted-capture.napt",
      napt,
      [],
      "encrypted-package",
    );
    assert.equal(packed.result.status, 0, packed.result.stderr);
    const envFile = path.join(root, "classifier.env");
    await writeFile(envFile, "UNSAFE_LOCAL_USER_PASSWORD=fixture-passphrase\n");
    const outputPath = path.join(root, "prepared-napt");
    const prepared = runPreparePackage(packed.outputPath, outputPath, [
      "--env-file",
      envFile,
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);
    const dataset = JSON.parse(
      await readFile(path.join(outputPath, "dataset.json"), "utf8"),
    );
    const packageLabels = JSON.parse(
      await readFile(path.join(packed.outputPath, "labels.json"), "utf8"),
    );
    assert.equal(dataset.recordings.length, 1);
    assert.equal(dataset.recordings[0].sampleRateHz, 3200000);
    assert.equal(dataset.recordings[0].centerFrequencyHz, 137500000);
    assert.equal(dataset.recordings[0].analysisFftSize, 4096);
    assert.equal(dataset.recordings[0].captureFrameUpdates.length, 1);
    assert.equal(
      dataset.recordings[0].sourceCaptureId,
      packageLabels.captureId,
    );
    assert.equal(
      (await readFile(path.join(outputPath, dataset.recordings[0].input)))
        .byteLength,
      32,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to overwrite an existing package directory or rebind a sidecar to a different V6 capture", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napt-data-package-reject-"));
  try {
    const firstBytes = await iqBytes();
    const first = await runPackage(root, "capture-a.iq", firstBytes);
    assert.equal(first.result.status, 0, first.result.stderr);
    const outputPath = path.join(root, "different-package");
    const labelsPath = path.join(root, "label-draft.json");
    const boundLabelsPath = path.join(root, "bound-labels.json");
    const capturePath = path.join(root, "capture-b.iq");
    await writeFile(capturePath, await iqBytes([128, 131, 127, 126]));
    const bound = JSON.parse(
      await readFile(path.join(first.outputPath, "labels.json"), "utf8"),
    );
    await writeFile(boundLabelsPath, JSON.stringify(bound));
    const mismatch = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/classifier/cli.mjs",
        "package",
        "--capture",
        capturePath,
        "--labels",
        boundLabelsPath,
        "--out",
        outputPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /does not match/i);

    const corruptBytes = Buffer.from(await iqBytes());
    corruptBytes[corruptBytes.length - 3] ^= 1;
    const corrupt = await runPackage(
      root,
      "corrupt-capture.iq",
      corruptBytes,
      [],
      "corrupt-package",
    );
    assert.notEqual(corrupt.result.status, 0);
    assert.match(corrupt.result.stderr, /integrity/i);

    const existing = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/classifier/cli.mjs",
        "package",
        "--capture",
        first.capturePath,
        "--labels",
        labelsPath,
        "--out",
        first.outputPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr, /exist/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
