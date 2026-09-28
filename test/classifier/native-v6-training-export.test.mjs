import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NativeTrainingCaptureSession, exportNativeTrainingCaptureV6 } from '../../src/ts/features/classification/native/trainingCapture.ts';
import { decodeIqCaptureHeader } from '../../src/ts/webusb/iqCaptureFormat.ts';

const config = {
  sessionId: 'browser-session-a',
  visualizerSessionKey: 'spectrum-session-a',
  sourceId: 'rtl-sdr-a',
  streamEpoch: 7,
  optionsRevision: 3,
  appliedOptions: { mode: 'rx', centerFrequencyHz: 137_500_000, sampleRateHz: 3_200_000, fftSize: 2048, fftWindow: 'Rectangular', frameRate: 60 },
  sampleRateHz: 3_200_000,
  centerFrequencyHz: 137_500_000,
  configuredFrameRateHz: 60,
  configuredFftSize: 2048,
  fftSize: 2048,
  window: 'rectangular',
  temporalResolution: 'lossless',
};

test('browser classifier export packages and prepares as detached-label V6 IQ', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'napt-native-v6-training-export-'));
  try {
    const captureStartTimestampMs = Date.now();
    const firstFrameTimestampMs = captureStartTimestampMs + 10;
    const boundaryTimestampMs = firstFrameTimestampMs + 20;
    const session = new NativeTrainingCaptureSession();
    assert.equal(session.start(config, 0, captureStartTimestampMs, {
      label: 'matching', channel: 'A', features: ['bridge', 'u-dip'], tags: ['antenna-in-front-of-mac'],
    }), true);
    assert.equal(session.append({
      ...config,
      sequence: 10,
      timestampMs: firstFrameTimestampMs,
      validSamples: 4096,
      status: 'receiving',
      iqBytes: new Uint8Array(8192).fill(128),
    }, 10, firstFrameTimestampMs), 'accepted');
    session.stopForMetadataChange({
      ...config,
      optionsRevision: 4,
      appliedOptions: { ...config.appliedOptions, fftSize: 4096 },
      configuredFftSize: 4096,
      fftSize: 4096,
      status: 'receiving',
    }, boundaryTimestampMs, 11);

    const artifact = await exportNativeTrainingCaptureV6(session);
    assert.match(artifact.captureFileName, /\.iq$/);
    assert.match(artifact.annotationFileName, /\.json$/);
    assert.equal(artifact.annotations.captureIdentity.kind, 'v6-trailer-sha256');
    assert.equal(artifact.annotations.captureIdentity.digestHex, artifact.annotations.captureId);
    const { frameUpdates } = decodeIqCaptureHeader(artifact.captureBytes);
    assert.equal(frameUpdates[0].sample_offset, 0);
    assert.equal(frameUpdates[0].timestamp_us, firstFrameTimestampMs * 1000);
    assert.equal(frameUpdates[1].kind, 'PatchOptionsApplied');
    assert.equal(frameUpdates[1].sample_offset, 8192);
    assert.equal(frameUpdates[1].sample_offset, 4096 * 2, 'frame update offsets use bytes while chunk offsets use complex samples');
    assert.equal(frameUpdates[1].timestamp_us, boundaryTimestampMs * 1000);
    assert.equal(frameUpdates[1].frame_sequence, 10);
    assert.equal(frameUpdates[1].next_frame_sequence, 11);

    const capturePath = path.join(root, artifact.captureFileName);
    const labelsPath = path.join(root, artifact.annotationFileName);
    const packagePath = path.join(root, 'package');
    await writeFile(capturePath, artifact.captureBytes);
    await writeFile(labelsPath, JSON.stringify(artifact.annotations));

    const packageResult = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/classifier/cli.mjs', 'package',
      '--capture', capturePath, '--labels', labelsPath, '--out', packagePath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(packageResult.status, 0, packageResult.stderr);
    assert.deepEqual(await readFile(path.join(packagePath, 'captures', artifact.captureFileName)), Buffer.from(artifact.captureBytes));

    const preparedPath = path.join(root, 'prepared');
    const prepareResult = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/classifier/cli.mjs', 'prepare',
      '--package', packagePath, '--split', 'train', '--out', preparedPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(prepareResult.status, 0, prepareResult.stderr);
    const dataset = JSON.parse(await readFile(path.join(preparedPath, 'dataset.json'), 'utf8'));
    assert.equal(dataset.recordings.length, 1);
    assert.equal(dataset.recordings[0].label, 'matching');
    assert.equal(dataset.recordings[0].channel, 'A');
    assert.equal(dataset.recordings[0].sampleRateHz, 3_200_000);
    assert.equal(dataset.recordings[0].analysisFftSize, 2048);
    assert.equal(dataset.recordings[0].validSamples, 4096);
    assert.equal(dataset.recordings[0].captureId, artifact.annotations.captureId);
    assert.deepEqual(dataset.recordings[0].captureAnnotations.features, ['bridge', 'u-dip']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('browser classifier export keeps interruption at the exact byte and timestamp boundary', async () => {
  const session = new NativeTrainingCaptureSession();
  const captureStartTimestampMs = Date.now();
  const firstFrameTimestampMs = captureStartTimestampMs + 10;
  const interruptionTimestampMs = firstFrameTimestampMs + 75;
  assert.equal(session.start(config, 0, captureStartTimestampMs, {
    label: 'uncertain', channel: 'unspecified', features: [], tags: [],
  }), true);
  assert.equal(session.append({
    ...config,
    sequence: 20,
    timestampMs: firstFrameTimestampMs,
    validSamples: 4096,
    status: 'receiving',
    iqBytes: new Uint8Array(8192).fill(128),
  }, 10, firstFrameTimestampMs), 'accepted');
  session.stop('backend-interrupted', { timestampMs: interruptionTimestampMs, nextFrameSequence: 21 });

  const artifact = await exportNativeTrainingCaptureV6(session);
  const { frameUpdates } = decodeIqCaptureHeader(artifact.captureBytes);
  const interruption = frameUpdates.find((update) => update.kind === 'StreamInterrupted');
  assert.ok(interruption);
  assert.equal(interruption.sample_offset, 8192);
  assert.equal(interruption.timestamp_us, interruptionTimestampMs * 1000);
  assert.equal(interruption.frame_sequence, 20);
  assert.equal(interruption.next_frame_sequence, 21);
});
