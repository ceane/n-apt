import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('prepare imports browser training exports as separate timestamped frames with explicit labels and session split', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'napt-browser-capture-'));
  try {
    const inputDir = path.join(root, 'input');
    const outputDir = path.join(root, 'prepared');
    await mkdir(inputDir);
    const payload = Buffer.from([0, 128, 255, 127, 128, 128, 127, 255]).toString('base64');
    const capture = {
      format: 'n-apt-native-iq-frames-v1', iqSampleFormat: 'u8',
      payloadSemantics: 'each frame stores the complete iq_data payload received for that sequence; frames remain independent and are never concatenated',
      sessionId: 'capture-a', visualizerSessionKey: 'visualizer-a',
      streamInterruptedEvents: [{ kind: 'StreamInterrupted', code: 1, timestampMs: 1020, byteOffset: 16, frameSequence: 11, nextFrameSequence: 12, reason: 'configuration-boundary' }],
      tuneEvents: [{ timestampMs: 1020, sequence: 12, fromFrameSequence: 11, toFrameSequence: 12, fromCenterFrequencyHz: 137500000, toCenterFrequencyHz: 137600000 }],
      optionsAppliedEvents: [{ kind: 'PatchOptionsApplied', timestampMs: 1020, fromTimestampMs: 1011, toTimestampMs: 1020, fromFrameSequence: 11, toFrameSequence: 12,
        fromRevision: 2, toRevision: 3, fromStreamEpoch: 3, toStreamEpoch: 4,
        fromSourceId: 'rtl-1', toSourceId: 'rtl-1', byteOffset: 16,
        changedFields: ['centerFrequencyHz', 'streamEpoch'], patch: { centerFrequencyHz: 137600000 } }],
      stopReason: 'center-frequency-changed',
      config: { sourceId: 'rtl-1', streamEpoch: 3, optionsRevision: 2,
        appliedOptions: { mode: 'rx', centerFrequencyHz: 137500000, sampleRateHz: 3200000, fftSize: 32768, fftWindow: 'hann', frameRate: 60 },
        sampleRateHz: 3200000, centerFrequencyHz: 137500000,
        configuredFftSize: 32768, fftSize: 32768, window: 'hann', temporalResolution: 'lossless' },
      frames: [10, 11].map((sequence) => ({ streamEpoch: 3, optionsRevision: 2, sequence, timestampMs: 1000 + sequence, validSamples: 4, iqBase64: payload })),
    };
    await writeFile(path.join(inputDir, 'capture.json'), JSON.stringify(capture));
    const sidecar = { format: 'n-apt-native-annotations-v1', captureId: 'capture-a', sessionId: 'capture-a',
      annotations: { label: 'matching', channel: 'A', features: ['u-dip'], tags: ['interference'] },
      annotationEvents: [{ timestampMs: 1012, frameSequence: 10, annotations: { label: 'matching', channel: 'A', features: ['u-dip'], tags: ['interference'] } }],
      interferenceMarkedEvents: [{ kind: 'InterferenceMarked', code: 2, timestampMs: 1012, byteOffset: 8, frameSequence: 10 }] };
    await writeFile(path.join(inputDir, 'annotations.json'), JSON.stringify(sidecar));
    await writeFile(path.join(inputDir, 'dataset.json'), JSON.stringify({ recordings: [{
      id: 'positive-a', session: 'positive-session-a', split: 'train', label: 'matching',
      input: 'capture.json', annotations: 'annotations.json', format: 'browser-capture', sampleRateHz: 3200000, centerFrequencyHz: 137500000,
    }] }));
    const result = spawnSync(process.execPath, ['scripts/classifier/cli.mjs', 'prepare', '--manifest', path.join(inputDir, 'dataset.json'), '--out', outputDir], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const dataset = JSON.parse(await readFile(path.join(outputDir, 'dataset.json'), 'utf8'));
    assert.equal(dataset.recordings.length, 2);
    assert.deepEqual(dataset.recordings.map((r) => r.frameSequence), [10, 11]);
    assert.ok(dataset.recordings.every((r) => r.captureId === 'positive-a' && r.session === 'positive-session-a' && r.split === 'train' && r.label === 'matching'));
    assert.equal(dataset.recordings[0].timestampStartMs, 1010);
    assert.equal(dataset.recordings[0].analysisFftSize, 32768);
    assert.deepEqual(dataset.recordings[0].captureAnnotations, { label: 'matching', channel: 'A', features: ['u-dip'], tags: ['interference'] });
    assert.equal(dataset.recordings[0].tuneEvents[0].toCenterFrequencyHz, 137600000);
    assert.equal(dataset.recordings[0].optionsAppliedEvents[0].toFrameSequence, 12);
    assert.equal(dataset.recordings[0].interferenceMarkedEvents[0].code, 2);
    assert.equal(dataset.recordings[0].stopReason, 'center-frequency-changed');
    assert.notEqual(dataset.recordings[0].input, dataset.recordings[1].input);
    const first = await readFile(path.join(outputDir, dataset.recordings[0].input));
    assert.equal(first.length, 32);
    assert.equal(first.readFloatLE(0), -1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
