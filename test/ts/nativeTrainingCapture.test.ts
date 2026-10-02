import * as NativeClassifier from '@n-apt/classification';
import { decodeIqCaptureHeader } from '@n-apt/webusb/iqCaptureFormat';
import { verifyStampedIntegrity } from '@n-apt/webusb/iqIntegrity';
import { notifyRawIqFrameArrival } from '@n-apt/app/infrastructure/visualization/frameArrivalRuntime';

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
  sourceCapability: 'rx', sourceIsMock: false, sourceStatus: 'receiving',
  deviceConnected: true, isRtlSdr: true, ...patch,
});

it('accepts a complete IQ payload even when its acquired sample count differs from analysis FFT size', () => {
  expect(NativeClassifier.isCompleteNativeTrainingFrame({ fftSize: 2048, validSamples: 4096, rawIqByteCount: 8192 })).toBe(true);
  expect(NativeClassifier.isCompleteNativeTrainingFrame({ fftSize: 4096, validSamples: 2048, rawIqByteCount: 4096 })).toBe(true);
  expect(NativeClassifier.isCompleteNativeTrainingFrame({ fftSize: 2048, validSamples: 4096, rawIqByteCount: 4094 })).toBe(false);
});

it('captures every accepted raw I/Q arrival independently of canvas repaint cadence', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  const appliedStream = { streamEpoch: 4, optionsRevision: 2, options: config.appliedOptions };
  const rawFrame = (sequence: number, timestamp: number, value: number) => ({
    protocol_version: 2 as const,
    source_id: 'rtl-1',
    stream_epoch: 4,
    options_revision: 2,
    sequence,
    timestamp,
    sample_rate: 3_200_000,
    center_frequency_hz: 1_600_000,
    frame_status: 'receiving' as const,
    data_type: 'iq_raw' as const,
    iq_data: new Uint8Array([value, value, value, value]),
  });

  const clock = [
    { nowMs: 120, nowTimestampMs: 1_020 },
    { nowMs: 140, nowTimestampMs: 1_040 },
  ];
  let latestRawBoundary: { sequence: number; timestampMs: number } | null = null;
  const unsubscribe = NativeClassifier.subscribeNativeTrainingCaptureIngress({
    session,
    getState: () => ({ selectedSourceId: 'rtl-1', appliedStream, eligible: true }),
    now: () => clock.shift() ?? { nowMs: 150, nowTimestampMs: 1_050 },
    onFrameObserved: (observed: unknown) => {
      const frame = observed as { sequence?: number; timestamp?: number };
      if (typeof frame.sequence === 'number' && typeof frame.timestamp === 'number') {
        latestRawBoundary = { sequence: frame.sequence, timestampMs: frame.timestamp };
      }
    },
  });
  try {
    notifyRawIqFrameArrival(rawFrame(10, 1_000, 10));
    expect(latestRawBoundary).toEqual({ sequence: 10, timestampMs: 1_000 });
    expect(session.frameCount).toBe(0);
    expect(session.start(config, 100, 1_000, undefined, latestRawBoundary!)).toBe(true);
    notifyRawIqFrameArrival(rawFrame(11, 1_020, 11));
    notifyRawIqFrameArrival(rawFrame(12, 1_040, 12));
  } finally {
    unsubscribe();
  }

  expect(session.snapshot()?.frames.map(({ sequence, timestampMs, iqBytes }) => ({
    sequence, timestampMs, bytes: [...iqBytes],
  }))).toEqual([
    { sequence: 11, timestampMs: 1_020, bytes: [11, 11, 11, 11] },
    { sequence: 12, timestampMs: 1_040, bytes: [12, 12, 12, 12] },
  ]);
});

it('never records held I/Q frames and marks the following sequence gap', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  const appliedStream = { streamEpoch: 4, optionsRevision: 2, options: config.appliedOptions };
  expect(session.start(config, 100, 1_000, undefined, { sequence: 10, timestampMs: 1_000 })).toBe(true);
  const rawFrame = (sequence: number, timestamp: number, freshness: 'fresh' | 'held') => ({
    protocol_version: 2 as const,
    source_id: 'rtl-1',
    stream_epoch: 4,
    options_revision: 2,
    sequence,
    timestamp,
    sample_rate: 3_200_000,
    center_frequency_hz: 1_600_000,
    frame_status: 'receiving' as const,
    is_fresh: freshness === 'fresh',
    data_type: 'iq_raw' as const,
    iq_data: new Uint8Array([sequence, sequence, sequence, sequence]),
  });
  const options = { session, selectedSourceId: 'rtl-1', appliedStream, eligible: true };

  expect(NativeClassifier.appendNativeTrainingCaptureIngressFrame({
    ...options, rawFrame: rawFrame(11, 1_020, 'held'), nowMs: 120, nowTimestampMs: 1_020,
  })).toBe('ignored');
  expect(session.active).toBe(true);
  expect(session.frameCount).toBe(0);

  expect(NativeClassifier.appendNativeTrainingCaptureIngressFrame({
    ...options, rawFrame: rawFrame(12, 1_040, 'fresh'), nowMs: 140, nowTimestampMs: 1_040,
  })).toBe('stopped');
  expect(session.frameCount).toBe(0);
  expect(session.snapshot()).toMatchObject({
    stopReason: 'frame-sequence-gap',
    streamInterruptedEvents: [{
      kind: 'StreamInterrupted', code: 1, byteOffset: 0, frameSequence: 10,
      nextFrameSequence: 12, reason: 'frame-sequence-gap',
    }],
  });
});

it('uses the verified V6 digest as capture identity and filename plus UTC capture time as the fallback', () => {
  const capturedAtTimestampMs = Date.UTC(2026, 8, 26, 15, 44, 0);
  const fileName = NativeClassifier.nativeTrainingCaptureFileName('capture-1', capturedAtTimestampMs);
  expect(fileName).toBe('n-apt-iq-capture-2026-09-26T15-44-00-000Z-capture-1.iq');
  expect(NativeClassifier.getNativeTrainingCaptureId({
    kind: 'v6-trailer-sha256', algorithm: 'SHA-256', scope: 'file-with-integrity-digest-placeholder', digestHex: 'A'.repeat(64),
  })).toBe('a'.repeat(64));
  expect(NativeClassifier.getNativeTrainingCaptureId({ kind: 'filename-timestamp', fileName, capturedAtTimestampMs }))
    .toBe(`${fileName}@2026-09-26T15:44:00.000Z`);
});

it('exports a V6 IQ file and detached annotations bound to that file trailer digest', async () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  expect(session.start(config, 0, 900, { label: 'matching', channel: 'A', features: ['bridge'], tags: ['live'] })).toBe(true);
  session.append(frame(), 100, 1000);
  expect(session.append(frame({ sequence: 11, timestampMs: 1020, centerFrequencyHz: 1_700_000, streamEpoch: 5, optionsRevision: 3,
    appliedOptions: { ...config.appliedOptions, centerFrequencyHz: 1_700_000 } }), 120, 1020)).toBe('stopped');

  const artifact = await NativeClassifier.exportNativeTrainingCaptureV6(session);
  const decoded = decodeIqCaptureHeader(artifact.captureBytes);
  const identity = artifact.annotations.captureIdentity;
  expect(artifact.captureFileName).toMatch(/\.iq$/);
  expect(artifact.annotationFileName).toMatch(/\.json$/);
  expect(decoded.metadata).toMatchObject({ format: 'iq', format_version: 6, sample_rate_hz: 3_200_000, fft_size: 2048, fft_window: 'rectangular' });
  expect(decoded.metadata).not.toHaveProperty('annotations');
  expect(await verifyStampedIntegrity(artifact.captureBytes, identity.kind === 'v6-trailer-sha256' ? identity.digestHex : '')).toBe(true);
  expect(artifact.annotations).toMatchObject({ format: 'n-apt-native-annotations-v2', annotations: { label: 'matching', channel: 'A', features: ['bridge'], tags: ['live'] }, captureIdentity: identity });
  expect(decoded.frameUpdates).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'PatchOptionsApplied', sample_offset: 8192, timestamp_us: 1_020_000 }),
    expect.objectContaining({ kind: 'StreamInterrupted', sample_offset: 8192, timestamp_us: 1_020_000, patch: { code: 1, reason: 'stream-epoch-changed' } }),
  ]));
});

it('uses the epoch attached to the live frame when source-list metadata lags', () => {
  expect(NativeClassifier.resolveNativeTrainingEpoch(30, 5)).toBe(30);
  expect(NativeClassifier.resolveNativeTrainingEpoch(4, undefined)).toBe(4);
  expect(NativeClassifier.resolveNativeTrainingEpoch(undefined, 5)).toBe(5);
  expect(NativeClassifier.resolveNativeTrainingEpoch(undefined, undefined)).toBeNull();
});

it('uses live managed RX options ahead of a stale hydrated source snapshot', () => {
  expect(NativeClassifier.resolveNativeTrainingReadinessSettings(
    { mode: 'rx', centerFrequencyHz: 1_618_000, sampleRateHz: 3_200_000, fftSize: 4096, fftWindow: 'Rectangular', frameRate: 60 },
    { centerFrequencyHz: 1_600_000, sampleRateHz: 3_200_000, fftSize: 2048, window: 'Rectangular' },
  )).toEqual({
    centerFrequencyHz: 1_618_000,
    sampleRateHz: 3_200_000,
    fftSize: 4096,
    window: 'Rectangular',
  });
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
    { sourceStatus: 'paused' }, { sourceStatus: 'stale' },
    { sourceMode: 'file' }, { temporalResolution: 'reduced' }, { temporalResolution: 'slow' }, { deviceConnected: false },
    { isRtlSdr: false }, { selectedSourceId: 'other' }, { activeSourceId: 'other' }, { expectedSourceId: 'other' },
  ]) expect(eligible(patch)).toBe(false);
  expect(eligible({ canvasPaused: true })).toBe(true);
});

it('identifies stale frames without declaring a receiver disconnected', () => {
  const currentFrame = frame({ timestampMs: 1_000 });
  expect(NativeClassifier.isNativeTrainingFrameStale(currentFrame, 4_001)).toBe(true);
  expect(NativeClassifier.isNativeTrainingFrameStale(currentFrame, 4_000)).toBe(false);
  expect(NativeClassifier.isNativeTrainingFrameStale(currentFrame, 999)).toBe(true);
  expect(NativeClassifier.isNativeTrainingFrameStale(null, 4_001)).toBe(false);
  expect(NativeClassifier.nativeTrainingCaptureSourceStatusCode({
    selectedSourceId: 'rtl-1', activeSourceId: 'rtl-1', expectedSourceId: 'rtl-1', sourceMode: 'live', temporalResolution: 'lossless',
    sourceCapability: 'rx', sourceIsMock: false, sourceStatus: 'receiving',
    deviceConnected: true, isRtlSdr: true,
  })).toBeNull();
});

it('ignores pre-start monitor frames and begins with the first post-start acquisition frame', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  expect(session.start(config, 100, 1_000)).toBe(true);
  expect(session.append(frame({ sequence: 9, timestampMs: 990 }), 101, 1_001)).toBe('prestart');
  expect(session.active).toBe(true);
  expect(session.frameCount).toBe(0);
  expect(session.append(frame({ sequence: 10, timestampMs: 1_020 }), 120, 1_020)).toBe('accepted');
  expect(session.snapshot()?.frames.map(({ sequence }) => sequence)).toEqual([10]);
});

it('anchors capture to the latest acquisition frame instead of browser wall-clock time', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  expect(session.start(config, 200, 1_100, {
    label: 'uncertain', channel: 'unspecified', features: [], tags: [],
  }, { sequence: 100, timestampMs: 1_000 })).toBe(true);
  expect(session.append(frame({ sequence: 100, timestampMs: 1_000 }), 210, 1_100)).toBe('prestart');
  expect(session.append(frame({ sequence: 101, timestampMs: 1_010 }), 220, 1_100)).toBe('accepted');
  expect(session.snapshot()?.frames.map(({ sequence }) => sequence)).toEqual([101]);
});

it('recognizes an explicit RTL-SDR disconnect without treating other source states as unplugged', () => {
  expect(NativeClassifier.isNativeTrainingRtlSdrDisconnected({ isRtlSdr: true, sourceStatus: 'disconnected' })).toBe(true);
  expect(NativeClassifier.isNativeTrainingRtlSdrDisconnected({ isRtlSdr: true, sourceStatus: 'stale' })).toBe(false);
  expect(NativeClassifier.isNativeTrainingRtlSdrDisconnected({ isRtlSdr: false, sourceStatus: 'disconnected' })).toBe(false);
});

it('classifies RTL-SDR disconnect, stale, paused, and non-receiving states separately', () => {
  const live = {
    selectedSourceId: 'rtl-1', activeSourceId: 'rtl-1', expectedSourceId: 'rtl-1', sourceMode: 'live', temporalResolution: 'lossless',
    sourceCapability: 'rx', sourceIsMock: false, sourceStatus: 'receiving',
    deviceConnected: true, isRtlSdr: true,
  } satisfies NativeClassifier.NativeTrainingCaptureEligibility;
  expect(NativeClassifier.nativeTrainingCaptureSourceStatusCode({ ...live, sourceStatus: 'disconnected' })).toBe('rtl-sdr-disconnected');
  expect(NativeClassifier.nativeTrainingCaptureSourceStatusCode({ ...live, sourceStatus: 'stale' })).toBe('rtl-sdr-stale');
  expect(NativeClassifier.nativeTrainingCaptureSourceStatusCode({ ...live, sourceStatus: 'paused' })).toBe('rtl-sdr-paused');
  expect(NativeClassifier.nativeTrainingCaptureSourceStatusCode({ ...live, sourceStatus: 'connected' })).toBe('rtl-sdr-not-receiving');
  expect(NativeClassifier.nativeTrainingCaptureSourceStatusCode({ ...live, sourceMode: 'file', sourceStatus: 'stale' })).toBeNull();
});

it('reports the specific selected-source mismatch in capture readiness diagnostics', () => {
  const currentFrame = frame();
  const current = { ...currentFrame, rawIqByteCount: currentFrame.iqBytes.byteLength };
  const mismatches = NativeClassifier.nativeTrainingFrameMismatchReasons(current, {
    selectedSourceId: 'rtl-2', sourceSampleRateHz: 3_200_000, sourceCenterFrequencyHz: 1_600_000,
    sourceFftSize: 2048, sourceWindow: 'Rectangular', appliedStream: { streamEpoch: 4, optionsRevision: 2, mode: 'rx' },
    nowTimestampMs: 1_100,
  });

  expect(mismatches).toContain('frame source rtl-1 != selected source rtl-2');
});

it('treats a health frame as fresh only when its source, status, payload, and timestamp are valid', () => {
  const current = { ...frame(), rawIqByteCount: 8192 };
  expect(NativeClassifier.isNativeTrainingReadinessFrameUsable(current, 'rtl-1', 1_000)).toBe(true);
  expect(NativeClassifier.isNativeTrainingReadinessFrameUsable(current, 'rtl-2', 1_000)).toBe(false);
  expect(NativeClassifier.isNativeTrainingReadinessFrameUsable({ ...current, status: 'paused' }, 'rtl-1', 1_000)).toBe(false);
  expect(NativeClassifier.isNativeTrainingReadinessFrameUsable({ ...current, rawIqByteCount: 8190 }, 'rtl-1', 1_000)).toBe(false);
  expect(NativeClassifier.isNativeTrainingReadinessFrameUsable(current, 'rtl-1', 5_001)).toBe(false);
});

it('auto-stops an active capture on an explicit RTL-SDR disconnect without waiting for another frame', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  expect(session.start(config, 0, 900)).toBe(true);
  expect(session.append(frame(), 100, 1_000)).toBe('accepted');
  const live = {
    selectedSourceId: 'rtl-1', activeSourceId: 'rtl-1', expectedSourceId: 'rtl-1', sourceMode: 'live', temporalResolution: 'lossless',
    sourceCapability: 'rx', sourceIsMock: false, sourceStatus: 'receiving', deviceConnected: true, isRtlSdr: true,
  } satisfies NativeClassifier.NativeTrainingCaptureEligibility;
  const disconnected = { ...live, sourceStatus: 'disconnected' };
  const reason = NativeClassifier.nativeTrainingCaptureSourceStatusCode(disconnected);
  const stopReason = (NativeClassifier as any).stopNativeTrainingCaptureForHealth(session, {
    eligible: NativeClassifier.canStartNativeTrainingCapture(disconnected),
    ineligibleReason: reason,
    latestFrameFresh: true,
    nowMs: 110,
  });

  expect(stopReason).toBe('rtl-sdr-disconnected');
  expect(session.active).toBe(false);
  expect(session.snapshot()).toMatchObject({
    stopReason: 'rtl-sdr-disconnected',
    streamInterruptedEvents: [{ kind: 'StreamInterrupted', code: 1, frameSequence: 10, reason: 'rtl-sdr-disconnected' }],
  });
});

it('treats title-cased applied window metadata as the same window and accepts the current receiving frame', () => {
  const liveFrame = {
    sourceId: 'rtl-1', streamEpoch: 4, optionsRevision: 2,
    appliedOptions: { ...config.appliedOptions, fftWindow: 'Rectangular' },
    sequence: 10, timestampMs: 1000, status: 'receiving', sampleRateHz: 3_200_000,
    centerFrequencyHz: 1_600_000, configuredFftSize: 2048, fftSize: 2048,
    validSamples: 4096, rawIqByteCount: 8192, window: 'Rectangular',
  };
  expect(NativeClassifier.nativeTrainingFrameMismatchReasons(liveFrame, {
    selectedSourceId: 'rtl-1', sourceSampleRateHz: 3_200_000, sourceCenterFrequencyHz: 1_600_000,
    sourceFftSize: 2048, sourceWindow: 'Rectangular', appliedStream: { streamEpoch: 4, optionsRevision: 2, mode: 'rx' },
    nowTimestampMs: 1100,
  })).toEqual([]);
});

it('reports a changing center frequency or FFT until an applied matching frame arrives', () => {
  const liveFrame = {
    sourceId: 'rtl-1', streamEpoch: 4, optionsRevision: 2,
    appliedOptions: { ...config.appliedOptions, fftWindow: 'Rectangular' },
    sequence: 10, timestampMs: 1000, status: 'receiving', sampleRateHz: 3_200_000,
    centerFrequencyHz: 1_600_000, configuredFftSize: 2048, fftSize: 2048,
    validSamples: 4096, rawIqByteCount: 8192, window: 'Rectangular',
  };
  const changing = NativeClassifier.nativeTrainingFrameMismatchReasons(liveFrame, {
    selectedSourceId: 'rtl-1', sourceSampleRateHz: 3_200_000, sourceCenterFrequencyHz: 1_700_000,
    sourceFftSize: 4096, sourceWindow: 'Rectangular', appliedStream: { streamEpoch: 4, optionsRevision: 3, mode: 'rx' },
    nowTimestampMs: 1100,
  });
  expect(changing).toEqual(expect.arrayContaining([
    'frame center frequency 1600000 Hz != source setting 1700000 Hz',
    'frame FFT setting 2048 != source setting 4096',
    'frame options revision 2 != applied revision 3',
  ]));

  const appliedFrame = {
    ...liveFrame, optionsRevision: 3, centerFrequencyHz: 1_700_000, configuredFftSize: 4096, fftSize: 4096,
    appliedOptions: { ...liveFrame.appliedOptions, centerFrequencyHz: 1_700_000, fftSize: 4096 },
  };
  expect(NativeClassifier.nativeTrainingFrameMismatchReasons(appliedFrame, {
    selectedSourceId: 'rtl-1', sourceSampleRateHz: 3_200_000, sourceCenterFrequencyHz: 1_700_000,
    sourceFftSize: 4096, sourceWindow: 'Rectangular', appliedStream: { streamEpoch: 4, optionsRevision: 3, mode: 'rx' },
    nowTimestampMs: 1100,
  })).toEqual([]);
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
  expect(session.snapshot()?.streamInterruptedEvents).toContainEqual(expect.objectContaining({
    kind: 'StreamInterrupted', code: 1, timestampMs: 1_000, byteOffset: 8_192, frameSequence: 10, reason: 'no-new-frames',
  }));
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
  const captureIdentity = { kind: 'filename-timestamp' as const, fileName: 'n-apt-iq-capture-1970-01-01T00-00-01-000Z-capture-1.json', capturedAtTimestampMs: 1000 };
  expect(session.toAnnotationSidecar(captureIdentity)).toMatchObject({ format: 'n-apt-native-annotations-v2', captureId: `${captureIdentity.fileName}@1970-01-01T00:00:01.000Z`,
    sessionId: 'capture-1', captureIdentity,
    annotations: { label: 'matching', tags: ['interference', 'weak-signal'] }, annotationEvents: [{ timestampMs: 1010 }],
    interferenceMarkedEvents: [{ kind: 'InterferenceMarked', code: 2, timestampMs: 900, byteOffset: 0 }] });
  expect(session.toExportObject()).not.toHaveProperty('annotations');
});

it('does not label the browser frame export with a V6 digest that belongs to a different file', () => {
  const session = new NativeClassifier.NativeTrainingCaptureSession();
  session.start(config, 0, 900);
  session.append(frame(), 100, 1000);
  expect(() => session.toAnnotationSidecar({
    kind: 'v6-trailer-sha256', algorithm: 'SHA-256', scope: 'file-with-integrity-digest-placeholder', digestHex: 'b'.repeat(64),
  })).toThrow('Browser frame capture has no V6 trailer; use its filename and capture time');
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

it('ignores frames at the capture-start boundary and rejects increasing sequences with non-increasing timestamps', () => {
  const stale = new NativeClassifier.NativeTrainingCaptureSession();
  stale.start(config, 0, 1000);
  expect(stale.append(frame(), 20, 1000)).toBe('prestart');
  expect(stale.active).toBe(true);
  expect(stale.snapshot()?.frames).toHaveLength(0);

  const outOfOrder = new NativeClassifier.NativeTrainingCaptureSession();
  outOfOrder.start(config, 0, 900);
  expect(outOfOrder.append(frame(), 20, 1000)).toBe('accepted');
  expect(outOfOrder.append(frame({ sequence: 11, timestampMs: 1000 }), 40, 1001)).toBe('stopped');
  expect(outOfOrder.snapshot()?.frames).toHaveLength(1);
  expect(outOfOrder.snapshot()?.stopReason).toBe('non-increasing-frame-timestamp');
  expect(outOfOrder.lastFrameTimestampDiagnostic).toEqual({
    previousSequence: 10,
    previousTimestampMs: 1000,
    incomingSequence: 11,
    incomingTimestampMs: 1000,
  });
});

it('distinguishes stale and future frame timestamps from timestamp-order failures', () => {
  const stale = new NativeClassifier.NativeTrainingCaptureSession();
  stale.start(config, 0, 1_000);
  expect(stale.append(frame({ timestampMs: 1_010 }), 10, 5_000)).toBe('stopped');
  expect(stale.snapshot()?.stopReason).toBe('frame-timestamp-stale');

  const future = new NativeClassifier.NativeTrainingCaptureSession();
  future.start(config, 0, 1_000);
  expect(future.append(frame({ timestampMs: 5_000 }), 10, 1_010)).toBe('stopped');
  expect(future.snapshot()?.stopReason).toBe('frame-timestamp-future');
});
