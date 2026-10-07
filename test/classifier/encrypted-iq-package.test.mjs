import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { encodeIqCaptureV4 } from "../../src/ts/webusb/iqCaptureFormat.ts";
import { encryptIqCaptureBytes, deriveIqCaptureKey } from "../../scripts/encrypt_iq_capture.mjs";
import { createCapturePackage } from "../../scripts/classifier/capturePackage.mjs";

const root = process.cwd();
const labelDraft = {
  format: "n-apt-native-label-draft-v1",
  sessionId: "encrypted-package-session",
  annotations: {
    label: "matching",
    channel: "A",
    features: ["bridge", "u-dip"],
    tags: [],
  },
  annotationEvents: [],
  interferenceMarkedEvents: [],
};

function iqCapture() {
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
      patch: {
        center_frequency_hz: 1_618_000,
        capture_sample_rate_hz: 3_200_000,
        fft_size: 4,
        fft_window: "rectangular",
      },
    }],
    chunks: [{ sample_offset: 0, channel: 0, data: Uint8Array.from([128, 130, 127, 126, 127, 129, 128, 127]) }],
  });
}

test("prepares an encrypted V6 IQ Data Package without changing its samples or detached labels", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "napt-encrypted-iq-package-"));
  try {
    const plainPath = path.join(directory, "plain.iq");
    const encryptedPath = path.join(directory, "encrypted.iq");
    const encryptedPackagePath = path.join(directory, "encrypted-package");
    const labelsPath = path.join(directory, "labels.json");
    const encryptedLabelsPath = path.join(directory, "encrypted-labels.json");
    const envPath = path.join(directory, ".env.test");
    const outputPath = path.join(directory, "prepared");
    const passkey = "test-only-classifier-capture-key";

    await writeFile(plainPath, await iqCapture());
    await writeFile(labelsPath, JSON.stringify(labelDraft));
    const key = deriveIqCaptureKey(passkey);
    const encryptedBytes = encryptIqCaptureBytes(await readFile(plainPath), key);
    key.fill(0);
    await writeFile(encryptedPath, encryptedBytes);
    await writeFile(encryptedLabelsPath, JSON.stringify(labelDraft));
    await writeFile(envPath, `UNSAFE_LOCAL_USER_PASSWORD=${passkey}\n`);
    await createCapturePackage({
      capturePath: encryptedPath,
      labelsPath: encryptedLabelsPath,
      outputPath: encryptedPackagePath,
    });

    const result = spawnSync(process.execPath, [
      "--import", "tsx", "scripts/classifier/cli.mjs", "prepare",
      "--package", encryptedPackagePath,
      "--split", "train",
      "--out", outputPath,
      "--env-file", envPath,
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const dataset = JSON.parse(await readFile(path.join(outputPath, "dataset.json"), "utf8"));
    assert.equal(dataset.recordings.length, 1);
    assert.equal(dataset.recordings[0].session, labelDraft.sessionId);
    assert.equal(dataset.recordings[0].label, "matching");
    assert.equal(dataset.recordings[0].split, "train");
    assert.equal(dataset.recordings[0].complexSamples, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
