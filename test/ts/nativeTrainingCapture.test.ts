import * as NativeClassifier from '@n-apt/classification';

const config: NativeClassifier.NativeTrainingCaptureConfig = {
  sessionId: 'capture-1', visualizerSessionKey: 'spectrum-session-1', sourceId: 'rtl-1', streamEpoch: 4, optionsRevision: 2,
  appliedOptions: { mode: 'rx', centerFrequencyHz: 1_600_000, sampleRateHz: 3_200_000, fftSize: 2048, fftWindow: 'rectangular', frameRate: 50 },
  sampleRateHz: 3_200_000, centerFrequencyHz: 1_600_000, configuredFrameRateHz: 50, configuredFftSize: 2048, fftSize: 2048, window: 'rectangular', temporalResolution: 'lossless',
};
const frame = (patch: Partial<NativeClassifier.NativeTrainingCaptureFrame> = {}): NativeClassifier.NativeTrainingCaptureFrame => ({
  sourceId: 'rtl-1', streamEpoch: 4, optionsRevision: 2, appliedOptions: config.appliedOptions, sequence: 10, timestampMs: 1000, sampleRateHz: 3_200_000,
  centerFrequencyHz: 1_600_000, configuredFrameRateHz: 50, configuredFftSize: 2048, fftSize: 2048, window: 'rectangular', temporalResolution: 'lossless', status: 'receiving', iqBytes: new Uint8Array(8192),
  validSamples: 4096,
  ...patch,
});
const eligible = (patch = {}) => NativeClassifier.canStartNativeTrainingCapture({
  selectedSourceId: 'rtl-1', activeSourceId: 'rtl-1', expectedSourceId: 'rtl-1', sourceMode: 'live', temporalResolution: 'lossless',
  sourceCapability: 'rx', sourceIsMock: false, sourceStatus: 'receiving', sourcePaused: false,
  deviceConnected: true, canvasPaused: false, isRtlSdr: true, ...patch,
});

it('accepts a complete IQ payload even when its acquired sample count differs from analysis FFT size', () => {
  expect(NativeClassifier.isCompleteNativeTrainingFrame({ fftSize: 2048, validSamples: 4096, rawIqByteCount: 8192 })).toBe(true);
  expect(NativeClassifier.isCompleteNativeTrainingFrame({ fftSize: 4096, validSamples: 2048, rawIqByteCount: 4096 })).toBe(true);
  expect(NativeClassifier.isCompleteNativeTrainingFrame({ fftSize: 2048, validSamples: 4096, rawIqByteCount: 4094 })).toBe(false);
});

it('uses the epoch attached to the live frame when source-list metadata lags', () => {
  expect(NativeClassifier.resolveNativeTrainingEpoch(30, 5)).toBe(30);
  expect(NativeClassifier.resolveNativeTrainingEpoch(4, undefined)).toBe(4);
  expect(NativeClassifier.resolveNativeTrainingEpoch(undefined, 5)).toBe(5);
  expect(NativeClassifier.resolveNativeTrainingEpoch(undefined, undefined)).toBeNull();
});

it('stops at an applied options revision boundary and records both exact frame identities and options snapshots', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  session.start({ ...config, optionsRevision: 2, appliedOptions: frame().appliedOptions }, 0, 900);
  expect(session.append(frame(), 100, 1000)).toBe('accepted');
  expect(session.append(frame({ streamEpoch: 5, optionsRevision: 3, sequence: 0, timestampMs: 1001,
    centerFrequencyHz: 1_610_000, appliedOptions: { ...frame().appliedOptions, centerFrequencyHz: 1_610_000, fftSize: 4096 } }), 110, 1001)).toBe('stopped');
  expect(session.snapshot()?.optionsAppliedEvents[0]).toMatchObject({
    kind: 'PatchOptionsApplied',
    fromFrameSequence: 10, toFrameSequence: 0, fromRevision: 2, toRevision: 3,
    changedFields: expect.arrayContaining(['streamEpoch', 'optionsRevision', 'centerFrequencyHz', 'appliedOptions']),
    patch: { optionsRevision: 3, centerFrequencyHz: 1_610_000, appliedOptions: { centerFrequencyHz: 1_610_000, fftSize: 4096 } },
  });
});

it('allows only the selected, active real RTL-SDR source in live receiving mode', () => {
  expect(eligible()).toBe(true);
  for (const patch of [
    { sourceCapability: 'mock' }, { sourceCapability: 'tx_rx' }, { sourceIsMock: true },
    { sourceStatus: 'paused' }, { sourceStatus: 'stale' }, { sourcePaused: true },
    { sourceMode: 'file' }, { temporalResolution: 'reduced' }, { temporalResolution: 'slow' }, { canvasPaused: true }, { deviceConnected: false },
    { isRtlSdr: false }, { selectedSourceId: 'other' }, { activeSourceId: 'other' }, { expectedSourceId: 'other' },
  ]) expect(eligible(patch)).toBe(false);
});

it('retains original per-frame boundaries and provenance, rejecting duplicates and stopping on a source or config mismatch', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  expect(session.start(config, 0, 900)).toBe(true);
  expect(session.append(frame(), 100, 1000)).toBe('accepted');
  expect(session.append(frame(), 120, 1000)).toBe('duplicate');
  expect(session.append(frame({ sequence: 9 }), 130, 1000)).toBe('stopped');
  expect(session.active).toBe(false);
  expect(session.snapshot()?.frames).toHaveLength(1);
  expect(session.snapshot()?.frames[0]).toMatchObject({ sequence: 10, timestampMs: 1000, validSamples: 4096, streamEpoch: 4, optionsRevision: 2 });
  expect(session.snapshot()?.frames[0].iqBytes).toHaveLength(8192);
  expect(session.snapshot()?.frames[0]).not.toHaveProperty('sampleRateHz');
  expect(session.snapshot()?.frames[0]).not.toHaveProperty('appliedOptions');
  expect(session.toExportObject()).toMatchObject({ format: 'n-apt-native-iq-frames-v1', sessionId: 'capture-1', frames: [{ sequence: 10 }] });
  expect(session.toExportObject()?.frames[0]).not.toHaveProperty('label');
});

it('stops on a missing sequence instead of joining disconnected IQ payloads', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  session.start(config, 0, 900);
  expect(session.append(frame(), 100, 1000)).toBe('accepted');
  expect(session.append(frame({ sequence: 12, timestampMs: 1002 }), 120, 1002)).toBe('stopped');
  expect(session.snapshot()?.stopReason).toBe('frame-sequence-gap');
  expect(session.snapshot()?.frames).toHaveLength(1);
  expect(session.snapshot()?.streamInterruptedEvents).toContainEqual(expect.objectContaining({ kind: 'StreamInterrupted', code: 1, byteOffset: 8192, frameSequence: 10, nextFrameSequence: 12, reason: 'frame-sequence-gap' }));
});

it('records a timestamp discontinuity even when frame sequence numbers are consecutive', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  session.start(config, 0, 900);
  expect(session.append(frame(), 100, 1000)).toBe('accepted');
  expect(session.append(frame({ sequence: 11, timestampMs: 1221 }), 120, 1221)).toBe('stopped');
  expect(session.snapshot()?.streamInterruptedEvents).toContainEqual(expect.objectContaining({ kind: 'StreamInterrupted', code: 1, byteOffset: 8192, frameSequence: 10, nextFrameSequence: 11, reason: 'frame-timestamp-gap' }));
});

it('automatically stops after no new frame arrives within the stale interval', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  session.start(config, 0, 900);
  session.append(frame(), 100, 1000);
  expect(session.stopIfStale(100 + NativeClassifier.NativeTrainingCaptureSession.STALE_AFTER_MS - 1)).toBe(false);
  expect(session.stopIfStale(100 + NativeClassifier.NativeTrainingCaptureSession.STALE_AFTER_MS)).toBe(true);
  expect(session.active).toBe(false);
});

it('stops instead of recording a frame with a changed acquisition configuration', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  session.start(config, 0, 900);
  expect(session.append(frame({ sequence: 11, centerFrequencyHz: 1_700_000 }), 100, 1000)).toBe('stopped');
  expect(session.snapshot()?.frames).toHaveLength(0);
});

it('keeps annotations in a separate sidecar and identifies a tune boundary', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  const annotations = { label: 'uncertain' as const, channel: 'A' as const, features: ['u-dip'], tags: ['interference'] };
  session.start(config, 0, 900, annotations);
  session.append(frame(), 100, 1000);
  session.updateAnnotations({ ...annotations, label: 'matching', tags: ['interference', 'weak-signal'] }, 1010);
  expect(session.append(frame({ sequence: 11, timestampMs: 1020, streamEpoch: 5, optionsRevision: 3, centerFrequencyHz: 1_700_000,
    appliedOptions: { ...config.appliedOptions, centerFrequencyHz: 1_700_000 } }), 120, 1020)).toBe('stopped');
  expect(session.snapshot()).toMatchObject({
    stopReason: 'center-frequency-changed',
    tuneEvents: [{ timestampMs: 1020, fromCenterFrequencyHz: 1_600_000, toCenterFrequencyHz: 1_700_000, fromFrameSequence: 10, toFrameSequence: 11 }],
    optionsAppliedEvents: [{ kind: 'PatchOptionsApplied', fromFrameSequence: 10, toFrameSequence: 11, fromRevision: 2, toRevision: 3, fromStreamEpoch: 4, toStreamEpoch: 5, changedFields: expect.arrayContaining(['centerFrequencyHz', 'appliedOptions', 'optionsRevision']), patch: { centerFrequencyHz: 1_700_000, optionsRevision: 3 } }],
    streamInterruptedEvents: [{ kind: 'StreamInterrupted', code: 1, timestampMs: 1020, byteOffset: 8192, frameSequence: 10, nextFrameSequence: 11, reason: 'stream-epoch-changed' }],
  });
  expect(session.toAnnotationSidecar()).toMatchObject({ format: 'n-apt-native-annotations-v1', captureId: 'capture-1',
    annotations: { label: 'matching', tags: ['interference', 'weak-signal'] }, annotationEvents: [{ timestampMs: 1010 }],
    interferenceMarkedEvents: [{ kind: 'InterferenceMarked', code: 2, timestampMs: 900, byteOffset: 0 }] });
  expect(session.toExportObject()).not.toHaveProperty('annotations');
});

it('records the old and new frame boundary when a non-frequency acquisition option changes', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  session.start(config, 0, 900);
  session.append(frame(), 100, 1000);
  expect(session.append(frame({ sequence: 11, timestampMs: 1020, streamEpoch: 4, optionsRevision: 3, window: 'hann',
    appliedOptions: { ...config.appliedOptions, fftWindow: 'hann' } }), 120, 1020)).toBe('stopped');
  expect(session.snapshot()).toMatchObject({
    stopReason: 'source-or-config-changed',
    optionsAppliedEvents: [{ kind: 'PatchOptionsApplied', fromFrameSequence: 10, toFrameSequence: 11, fromTimestampMs: 1000, toTimestampMs: 1020, fromRevision: 2, toRevision: 3, fromStreamEpoch: 4, toStreamEpoch: 4, changedFields: expect.arrayContaining(['window', 'appliedOptions', 'optionsRevision']), patch: { window: 'hann', optionsRevision: 3 } }],
  });
  expect(session.snapshot()?.streamInterruptedEvents).toEqual([]);
});

it('clears a stopped capture only when explicitly requested after export', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  session.start(config, 0, 900);
  session.stop('user-stopped');
  session.clear();
  expect(session.snapshot()).toBeNull();
  expect(session.start(config, 200, 1200)).toBe(true);
  session.clear();
  expect(session.active).toBe(true);
});

it('rejects cached pre-start frames and increasing sequences with non-increasing timestamps', () => {
  const stale = new NativeClassifier.NativeTrainingCaptureSession();
  stale.start(config, 0, 1000);
  expect(stale.append(frame(), 20, 1000)).toBe('stopped');
  expect(stale.snapshot()?.frames).toHaveLength(0);

  const outOfOrder = new NativeClassifier.NativeTrainingCaptureSession();
  outOfOrder.start(config, 0, 900);
  expect(outOfOrder.append(frame(), 20, 1000)).toBe('accepted');
  expect(outOfOrder.append(frame({ sequence: 11, timestampMs: 1000 }), 40, 1001)).toBe('stopped');
  expect(outOfOrder.snapshot()?.frames).toHaveLength(1);
});
