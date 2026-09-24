import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeIq, spectrumFromIq, validateDataset, selectFrameIndices, readTrainingCapture } from '../../scripts/classifier/io.mjs';
test('raw IQ formats reject truncated pairs and preserve signed values', () => {
  assert.throws(() => decodeIq(Buffer.from([0]), 'u8'));
  assert.deepEqual(Array.from(decodeIq(Buffer.from([128, 0, 255, 128]), 'u8')), [0, -1, 127 / 128, 0]);
  const data = Buffer.alloc(8); data.writeFloatLE(0.25); data.writeFloatLE(-0.5, 4);
  assert.deepEqual(Array.from(decodeIq(data, 'f32le')), [0.25, -0.5]);
});
test('FFT preserves a known complex tone bin and incomplete sample count', () => {
  const iq = Float32Array.from({ length: 2048 }, (_, i) => i % 2 ? Math.sin(2 * Math.PI * 17 * Math.floor(i / 2) / 1024) : Math.cos(2 * Math.PI * 17 * Math.floor(i / 2) / 1024));
  const result = spectrumFromIq(iq, 1024, 'rectangular');
  assert.equal(result.spectrum.indexOf(Math.max(...result.spectrum)), 512 + 17);
  assert.equal(spectrumFromIq(iq.subarray(0, 1500), 1024, 'hann').validSamples, 750);
});
test('representative windows sample across the whole acquisition and reject invalid caps', () => {
  assert.deepEqual(selectFrameIndices(1000, 4), [0, 333, 666, 999]);
  assert.deepEqual(selectFrameIndices(9, 1), [4]);
  assert.throws(() => selectFrameIndices(10, 257));
});
test('dataset requires labels and keeps sessions in exactly one split', () => {
  const row = { id: 'one', session: 'day1', split: 'train', label: 'matching', input: '/tmp/example.iq', format: 'u8', sampleRateHz: 3200000, centerFrequencyHz: 10000000 };
  assert.equal(validateDataset({ recordings: [row] }).recordings.length, 1);
  assert.throws(() => validateDataset({ recordings: [row, { ...row, id: 'two', split: 'test' }] }));
  assert.throws(() => validateDataset({ recordings: [{ ...row, sampleRateHz: undefined }] }));
});

test('browser training exports validate and preserve each complete raw IQ frame independently', () => {
  const capture = {
    format: 'n-apt-native-iq-frames-v1',
    payloadSemantics: 'each frame stores the complete iq_data payload received for that sequence; frames remain independent and are never concatenated',
    iqSampleFormat: 'u8',
    sessionId: 'session-a',
    config: { sourceId: 'rtl-1', streamEpoch: 3, optionsRevision: 2, appliedOptions: { mode: 'rx', centerFrequencyHz: 137500000, sampleRateHz: 3200000, fftSize: 32768, fftWindow: 'hann' }, sampleRateHz: 3200000, centerFrequencyHz: 137500000, configuredFftSize: 32768, fftSize: 32768, window: 'hann', temporalResolution: 'lossless' },
    frames: [10, 11].map((sequence) => ({ streamEpoch: 3, optionsRevision: 2, sequence, timestampMs: 1000 + sequence,
      validSamples: 4, iqBase64: Buffer.from([0, 128, 255, 127, 128, 128, 127, 255]).toString('base64') })),
  };
  const parsed = readTrainingCapture(capture);
  assert.equal(parsed.frames.length, 2);
  assert.deepEqual(Array.from(parsed.frames[0].iqBytes), [0, 128, 255, 127, 128, 128, 127, 255]);
  assert.equal(parsed.config.fftSize, 32768);
  assert.equal(parsed.frames[0].validSamples, 4);
  assert.throws(() => readTrainingCapture({ ...capture, frames: [capture.frames[0], { ...capture.frames[1], sequence: 12 }] }), /sequence gap/);
  assert.throws(() => readTrainingCapture({ ...capture, frames: [{ ...capture.frames[0], validSamples: 5 }] }), /byte count/);
});
