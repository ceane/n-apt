import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { NativeTrainingCaptureSession, exportNativeTrainingCaptureV6 } from '../../src/ts/features/classification/native/trainingCapture.ts';
import { decodeIqCaptureHeader, encodeIqCaptureV4 } from '../../src/ts/webusb/iqCaptureFormat.ts';

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

test('offline classifier entry bundles without the application UI graph', async () => {
  const entry = fileURLToPath(new URL('../../scripts/classifier/browser.ts', import.meta.url));
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'NativeClassifier',
    loader: { '.wgsl': 'text' },
  });

  assert.equal(result.outputFiles.length, 1);
  assert.match(result.outputFiles[0].text, /NativeGpuExtractor/);
  assert.doesNotMatch(result.outputFiles[0].text, /@xyflow\/react/);
});

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
    const initialPatch = frameUpdates.find((update) => update.kind === 'PatchOptionsApplied' && update.sample_offset === 0);
    const frameMarker = frameUpdates.find((update) => update.kind === 'Frame' && update.sample_offset === 0);
    const boundaryPatch = frameUpdates.find((update) => update.kind === 'PatchOptionsApplied' && update.sample_offset === 8192);
    assert.equal(initialPatch.timestamp_us, firstFrameTimestampMs * 1000);
    assert.equal(frameMarker.timestamp_us, firstFrameTimestampMs * 1000);
    assert.equal(frameMarker.frame_sequence, 10);
    assert.equal(boundaryPatch.sample_offset, 4096 * 2, 'frame update offsets use bytes while chunk offsets use complex samples');
    assert.equal(boundaryPatch.timestamp_us, boundaryTimestampMs * 1000);
    assert.equal(boundaryPatch.frame_sequence, 10);
    assert.equal(boundaryPatch.next_frame_sequence, 11);

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

test('browser classifier V6 export keeps each captured frame timestamped and independently prepared', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'napt-native-v6-frame-timing-'));
  try {
    const captureStartTimestampMs = Date.now();
    const firstFrameTimestampMs = captureStartTimestampMs + 10;
    const secondFrameTimestampMs = firstFrameTimestampMs + 23;
    const session = new NativeTrainingCaptureSession();
    assert.equal(session.start(config, 0, captureStartTimestampMs, {
      label: 'matching', channel: 'A', features: ['pulsing'], tags: ['interference visible'],
    }), true);
    for (const [sequence, timestampMs] of [[10, firstFrameTimestampMs], [11, secondFrameTimestampMs]]) {
      assert.equal(session.append({
        ...config,
        sequence,
        timestampMs,
        validSamples: 2048,
        status: 'receiving',
        iqBytes: new Uint8Array(4096).fill(128),
      }, timestampMs - captureStartTimestampMs, timestampMs), 'accepted');
    }
    session.stop('user-requested');

    const artifact = await exportNativeTrainingCaptureV6(session);
    const { frameUpdates } = decodeIqCaptureHeader(artifact.captureBytes);
    assert.deepEqual(frameUpdates.filter((update) => update.kind === 'Frame').map((update) => ({
      sample_offset: update.sample_offset,
      timestamp_us: update.timestamp_us,
      frame_sequence: update.frame_sequence,
    })), [
      { sample_offset: 0, timestamp_us: firstFrameTimestampMs * 1000, frame_sequence: 10 },
      { sample_offset: 4096, timestamp_us: secondFrameTimestampMs * 1000, frame_sequence: 11 },
    ]);

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
    const preparedPath = path.join(root, 'prepared');
    const prepareResult = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/classifier/cli.mjs', 'prepare',
      '--package', packagePath, '--split', 'train', '--out', preparedPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(prepareResult.status, 0, prepareResult.stderr);
    const dataset = JSON.parse(await readFile(path.join(preparedPath, 'dataset.json'), 'utf8'));
    assert.deepEqual(dataset.recordings.map((record) => ({
      frameSequence: record.frameSequence,
      timestampStartMs: record.timestampStartMs,
      validSamples: record.validSamples,
      temporalResolution: record.temporalResolution,
    })), [
      { frameSequence: 10, timestampStartMs: firstFrameTimestampMs, validSamples: 2048, temporalResolution: 'frame-indexed' },
      { frameSequence: 11, timestampStartMs: secondFrameTimestampMs, validSamples: 2048, temporalResolution: 'frame-indexed' },
    ]);
    assert.ok(dataset.recordings.every((record) => !Object.hasOwn(record, 'captureFrameUpdates')),
      'prepared frame records must not duplicate the entire frame event history');

    const featurePath = path.join(root, 'features.jsonl');
    const extractResult = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/classifier/cli.mjs', 'extract',
      '--dataset', path.join(preparedPath, 'dataset.json'), '--fft-sizes', '2048',
      '--crops', '0:1', '--window', 'rectangular', '--max-frames', '64', '--out', featurePath,
    ], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(extractResult.status, 0, extractResult.stderr);
    const featureRows = (await readFile(featurePath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(featureRows.length, 1, 'offline temporal features follow the live classifier interval');
    assert.deepEqual(featureRows.map((row) => row.timestampMs), [firstFrameTimestampMs]);
    assert.deepEqual(featureRows.map((row) => row.temporalFrameCount), [1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prepared frame labels follow the annotation state at each recorded frame boundary', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'napt-native-v6-label-timeline-'));
  try {
    const session = new NativeTrainingCaptureSession();
    assert.equal(session.start(config, 0, 1_000, {
      label: 'matching', channel: 'A', features: ['bridge'], tags: [],
    }, { sequence: 9, timestampMs: 1_000 }), true);
    assert.equal(session.append({ ...config, sequence: 10, timestampMs: 1_010, validSamples: 2048,
      status: 'receiving', iqBytes: new Uint8Array(4096).fill(128) }, 10, 1_010), 'accepted');
    session.updateAnnotations({ label: 'uncertain', channel: 'A', features: [], tags: ['interference visible'] }, 1_011);
    assert.equal(session.append({ ...config, sequence: 11, timestampMs: 1_020, validSamples: 2048,
      status: 'receiving', iqBytes: new Uint8Array(4096).fill(128) }, 20, 1_020), 'accepted');
    session.stop('user-stopped');
    session.updateAnnotations({ label: 'matching', channel: 'A', features: ['bridge'], tags: ['reviewed-after-capture'] }, 1_030);

    const artifact = await exportNativeTrainingCaptureV6(session);
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
    const preparedPath = path.join(root, 'prepared');
    const prepareResult = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/classifier/cli.mjs', 'prepare',
      '--package', packagePath, '--split', 'train', '--out', preparedPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(prepareResult.status, 0, prepareResult.stderr);
    const dataset = JSON.parse(await readFile(path.join(preparedPath, 'dataset.json'), 'utf8'));
    assert.deepEqual(dataset.recordings.map((record) => ({ frameSequence: record.frameSequence, label: record.label })), [
      { frameSequence: 10, label: 'matching' },
      { frameSequence: 11, label: 'uncertain' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prepare rejects lossless V6 frames without one timestamped Frame update per frame', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'napt-native-v6-missing-frame-times-'));
  try {
    const now = Date.now();
    const capturePath = path.join(root, 'untimestamped.iq');
    const labelsPath = path.join(root, 'labels.json');
    const packagePath = path.join(root, 'package');
    const captureBytes = await encodeIqCaptureV4({
      metadata: {
        timestamp_utc: new Date(now).toISOString(), source_device: 'RTL-SDR',
        center_frequency_hz: 137_500_000, sample_rate_hz: 3_200_000,
        capture_sample_rate_hz: 3_200_000, hardware_sample_rate_hz: 3_200_000,
        fft_size: 2048, configured_fft_size: 2048, fft_window: 'rectangular', frame_rate: 60,
        duration_s: 4096 / 3_200_000, sample_count: 4096, frame_count: 2,
        iq_byte_count: 8192, data_format: 'iq_u8', temporal_resolution: 'lossless', lossless: true,
        capture_session_id: 'untimestamped-session',
        channels: [{ center_freq_hz: 137_500_000, sample_rate_hz: 3_200_000, bins_per_frame: 2048, iq_length: 8192 }],
      },
      frameUpdates: [{
        sample_offset: 0, timestamp_us: now * 1000, channel: 0,
        kind: 'PatchOptionsApplied', next_frame_sequence: 10,
        patch: { center_frequency_hz: 137_500_000, capture_sample_rate_hz: 3_200_000, fft_size: 2048,
          configured_fft_size: 2048, fft_window: 'rectangular' },
      }],
      chunks: [
        { sample_offset: 0, channel: 0, data: new Uint8Array(4096).fill(128) },
        { sample_offset: 2048, channel: 0, data: new Uint8Array(4096).fill(128) },
      ],
    });
    await writeFile(capturePath, captureBytes);
    await writeFile(labelsPath, JSON.stringify({
      format: 'n-apt-native-label-draft-v1', sessionId: 'untimestamped-session',
      annotations: { label: 'matching', channel: 'A', features: ['pulsing'], tags: [] },
    }));
    const packageResult = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/classifier/cli.mjs', 'package',
      '--capture', capturePath, '--labels', labelsPath, '--out', packagePath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(packageResult.status, 0, packageResult.stderr);
    const prepareResult = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/classifier/cli.mjs', 'prepare',
      '--package', packagePath, '--split', 'train', '--out', path.join(root, 'prepared'),
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.notEqual(prepareResult.status, 0);
    assert.match(prepareResult.stderr, /lossless.*timestamped Frame updates/i);
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
