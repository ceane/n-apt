import { normalizeNativeWindowKind, type WindowKind } from './core';
import type { IqAppliedStreamOptions, IqRawFrame } from '@n-apt/consts/schemas/websocket';
import { encodeIqCaptureV4, readIqCaptureTrailerDigest, type CaptureMetadata, type IqCaptureChunk, type IqCaptureFrameUpdate } from '@n-apt/webusb/iqCaptureFormat';
import { verifyStampedIntegrity } from '@n-apt/webusb/iqIntegrity';
import { subscribeRawIqFrameArrivals } from '@n-apt/app/infrastructure/visualization/frameArrivalRuntime';

export interface NativeTrainingCaptureConfig {
  sessionId: string;
  visualizerSessionKey: string;
  sourceId: string;
  streamEpoch: number;
  optionsRevision: number;
  appliedOptions: Extract<IqAppliedStreamOptions, { mode: 'rx' }>;
  sampleRateHz: number;
  centerFrequencyHz: number;
  configuredFrameRateHz: number | null;
  configuredFftSize: number;
  fftSize: number;
  window: WindowKind;
  temporalResolution: 'lossless';
}

export type NativeTrainingCaptureLabel = 'matching' | 'nonmatching' | 'uncertain';
export type NativeTrainingChannel = 'unspecified' | 'A' | 'B' | 'other';
export interface NativeTrainingCaptureAnnotations {
  label: NativeTrainingCaptureLabel;
  channel: NativeTrainingChannel;
  features: string[];
  tags: string[];
}
export interface NativeTrainingAnnotationEvent {
  timestampMs: number;
  frameSequence: number | null;
  annotations: NativeTrainingCaptureAnnotations;
}
export type NativeTrainingCaptureIdentity =
  | { kind: 'v6-trailer-sha256'; algorithm: 'SHA-256'; scope: 'file-with-integrity-digest-placeholder'; digestHex: string }
  | { kind: 'filename-timestamp'; fileName: string; capturedAtTimestampMs: number };
export interface NativeTrainingStreamInterruptedEvent {
  kind: 'StreamInterrupted';
  code: 1;
  timestampMs: number;
  byteOffset: number;
  frameSequence: number | null;
  nextFrameSequence?: number;
  reason?: string;
}
export interface NativeTrainingAnnotationSidecar {
  format: 'n-apt-native-annotations-v2';
  captureId: string;
  sessionId: string;
  captureIdentity: NativeTrainingCaptureIdentity;
  annotations: NativeTrainingCaptureAnnotations;
  annotationEvents: NativeTrainingAnnotationEvent[];
  interferenceMarkedEvents: Array<{ kind: 'InterferenceMarked'; code: 2; timestampMs: number; byteOffset: number; frameSequence: number | null }>;
}
export interface NativeTrainingTuneEvent {
  timestampMs: number;
  sequence: number;
  fromFrameSequence: number | null;
  toFrameSequence: number;
  fromCenterFrequencyHz: number;
  toCenterFrequencyHz: number;
}
export type NativeTrainingCaptureFrameMetadata = Pick<NativeTrainingCaptureConfig,
  'sourceId' | 'streamEpoch' | 'optionsRevision' | 'appliedOptions' | 'sampleRateHz' | 'centerFrequencyHz' | 'configuredFrameRateHz' | 'configuredFftSize' | 'fftSize' | 'window' | 'temporalResolution'> & { status: string };
export interface NativeTrainingOptionsAppliedEvent {
  kind: 'PatchOptionsApplied';
  timestampMs: number;
  fromTimestampMs: number;
  toTimestampMs: number;
  fromFrameSequence: number | null;
  toFrameSequence: number;
  fromRevision: number;
  toRevision: number;
  fromStreamEpoch: number;
  toStreamEpoch: number;
  fromSourceId: string;
  toSourceId: string;
  byteOffset: number;
  changedFields: Array<keyof NativeTrainingCaptureFrameMetadata>;
  patch: Partial<Omit<NativeTrainingCaptureFrameMetadata, 'sourceId' | 'streamEpoch' | 'status'>>;
}

export interface NativeTrainingCaptureFrame extends Omit<NativeTrainingCaptureConfig, 'sessionId' | 'visualizerSessionKey'> {
  sequence: number;
  timestampMs: number;
  validSamples: number;
  status: string;
  iqBytes: Uint8Array;
}

export interface NativeTrainingCaptureEligibility {
  selectedSourceId: string | null;
  activeSourceId: string | null;
  expectedSourceId: string | null;
  sourceMode: string;
  temporalResolution: string;
  sourceCapability: string;
  sourceIsMock: boolean;
  sourceStatus: string | null;
  deviceConnected: boolean;
  isRtlSdr: boolean;
}

export type NativeTrainingCaptureSourceStatusCode =
  | 'rtl-sdr-disconnected'
  | 'rtl-sdr-stale'
  | 'rtl-sdr-paused'
  | 'rtl-sdr-not-receiving';

export function nativeTrainingCaptureSourceStatusCode(
  state: NativeTrainingCaptureEligibility,
): NativeTrainingCaptureSourceStatusCode | null {
  if (!state.isRtlSdr || state.sourceMode !== 'live' || !state.selectedSourceId) return null;
  if (state.sourceStatus === 'disconnected') return 'rtl-sdr-disconnected';
  if (state.sourceStatus === 'stale') return 'rtl-sdr-stale';
  if (state.sourceStatus === 'paused') return 'rtl-sdr-paused';
  if (state.sourceStatus !== null && state.sourceStatus !== 'receiving') return 'rtl-sdr-not-receiving';
  return null;
}

export const isNativeTrainingRtlSdrDisconnected = (
  state: Pick<NativeTrainingCaptureEligibility, 'isRtlSdr' | 'sourceStatus'>,
): boolean => state.isRtlSdr && state.sourceStatus === 'disconnected';

export interface NativeTrainingReadinessFrame {
  sourceId: string;
  streamEpoch: number;
  optionsRevision: number;
  appliedOptions: Extract<IqAppliedStreamOptions, { mode: 'rx' }>;
  sequence: number;
  timestampMs: number;
  status: string;
  sampleRateHz: number;
  centerFrequencyHz: number;
  configuredFftSize: number;
  fftSize: number;
  validSamples: number;
  rawIqByteCount: number;
  window: string;
}

export interface NativeTrainingReadinessExpectation {
  selectedSourceId: string | null;
  sourceSampleRateHz: number | null | undefined;
  sourceCenterFrequencyHz: number | null | undefined;
  sourceFftSize: number | undefined;
  sourceWindow?: string | null;
  appliedStream: { streamEpoch: number; optionsRevision: number; mode: 'rx' } | null;
  nowTimestampMs: number;
}

export interface NativeTrainingReadinessSourceSettings {
  centerFrequencyHz: number | null | undefined;
  sampleRateHz: number | null | undefined;
  fftSize: number | undefined;
  window?: string | null;
}

/** Prefer the live managed RX contract while the cached source snapshot catches up. */
export function resolveNativeTrainingReadinessSettings(
  appliedOptions: IqAppliedStreamOptions | null | undefined,
  sourceSettings: NativeTrainingReadinessSourceSettings,
): NativeTrainingReadinessSourceSettings {
  const appliedRx = appliedOptions?.mode === 'rx' ? appliedOptions : null;
  return {
    centerFrequencyHz: appliedRx?.centerFrequencyHz ?? sourceSettings.centerFrequencyHz,
    sampleRateHz: appliedRx?.sampleRateHz ?? sourceSettings.sampleRateHz,
    fftSize: appliedRx?.fftSize ?? sourceSettings.fftSize,
    window: appliedRx?.fftWindow ?? sourceSettings.window,
  };
}

/** Explain every frame/source mismatch that can keep live training capture disabled. */
export function nativeTrainingFrameMismatchReasons(
  frame: NativeTrainingReadinessFrame | null,
  expected: NativeTrainingReadinessExpectation,
): string[] {
  if (!frame) return ['no current I/Q frame'];
  const mismatches: string[] = [];
  const frameWindow = normalizeNativeWindowKind(frame.window);
  const sourceWindow = normalizeNativeWindowKind(expected.sourceWindow ?? undefined);
  const maxAgeMs = NativeTrainingCaptureSession.STALE_AFTER_MS;
  const ageMs = expected.nowTimestampMs - frame.timestampMs;

  if (frame.sourceId !== expected.selectedSourceId) {
    mismatches.push(`frame source ${frame.sourceId} != selected source ${expected.selectedSourceId ?? 'none'}`);
  }
  if (frame.status !== 'receiving') mismatches.push(`frame status ${frame.status} is not receiving`);
  if (!expected.appliedStream) {
    mismatches.push('no applied RX options for the selected source');
  } else {
    if (frame.streamEpoch !== expected.appliedStream.streamEpoch) {
      mismatches.push(`frame stream epoch ${frame.streamEpoch} != applied stream epoch ${expected.appliedStream.streamEpoch}`);
    }
    if (frame.optionsRevision !== expected.appliedStream.optionsRevision) {
      mismatches.push(`frame options revision ${frame.optionsRevision} != applied revision ${expected.appliedStream.optionsRevision}`);
    }
  }
  if (!Number.isInteger(frame.validSamples) || frame.validSamples <= 0) {
    mismatches.push('frame has no valid I/Q samples');
  }
  if (!Number.isInteger(frame.rawIqByteCount) || frame.rawIqByteCount !== frame.validSamples * 2) {
    mismatches.push(`frame I/Q byte count ${frame.rawIqByteCount} != valid sample byte count ${frame.validSamples * 2}`);
  }
  if (!Number.isInteger(frame.fftSize) || frame.fftSize < 2) {
    mismatches.push(`frame FFT size ${frame.fftSize} is invalid`);
  }
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
    mismatches.push('frame timestamp is stale or in the future');
  }
  if (frame.appliedOptions.centerFrequencyHz !== frame.centerFrequencyHz) {
    mismatches.push(`applied center frequency ${frame.appliedOptions.centerFrequencyHz} Hz != frame center frequency ${frame.centerFrequencyHz} Hz`);
  }
  if (frame.appliedOptions.sampleRateHz !== frame.sampleRateHz) {
    mismatches.push(`applied sample rate ${frame.appliedOptions.sampleRateHz} Hz != frame sample rate ${frame.sampleRateHz} Hz`);
  }
  if (frame.appliedOptions.fftSize !== frame.configuredFftSize) {
    mismatches.push(`applied FFT setting ${frame.appliedOptions.fftSize} != frame FFT setting ${frame.configuredFftSize}`);
  }
  if (frame.appliedOptions.fftWindow !== undefined && normalizeNativeWindowKind(frame.appliedOptions.fftWindow) !== frameWindow) {
    mismatches.push(`applied window ${frame.appliedOptions.fftWindow} != frame window ${frame.window}`);
  }
  if (frame.sampleRateHz !== expected.sourceSampleRateHz) {
    mismatches.push(`frame sample rate ${frame.sampleRateHz} Hz != source setting ${expected.sourceSampleRateHz ?? 'unavailable'} Hz`);
  }
  if (frame.centerFrequencyHz !== expected.sourceCenterFrequencyHz) {
    mismatches.push(`frame center frequency ${frame.centerFrequencyHz} Hz != source setting ${expected.sourceCenterFrequencyHz ?? 'unavailable'} Hz`);
  }
  if (typeof expected.sourceFftSize !== 'number') {
    mismatches.push('selected source FFT setting is unavailable');
  } else if (frame.configuredFftSize !== expected.sourceFftSize) {
    mismatches.push(`frame FFT setting ${frame.configuredFftSize} != source setting ${expected.sourceFftSize}`);
  }
  if (frameWindow !== sourceWindow) {
    mismatches.push(`frame window ${frame.window} != source window ${expected.sourceWindow ?? 'Rectangular'}`);
  }
  return mismatches;
}

export const canStartNativeTrainingCapture = (state: NativeTrainingCaptureEligibility): boolean =>
  !!state.selectedSourceId &&
  state.selectedSourceId === state.activeSourceId &&
  state.selectedSourceId === state.expectedSourceId &&
  state.sourceMode === 'live' && state.temporalResolution === 'lossless' && state.sourceCapability === 'rx' && !state.sourceIsMock &&
  state.sourceStatus === 'receiving' && state.deviceConnected && state.isRtlSdr;

/** Validates the complete acquired I/Q payload independently of the analysis FFT length. */
export function isCompleteNativeTrainingFrame(frame: { fftSize: number; validSamples: number; rawIqByteCount: number }): boolean {
  return Number.isInteger(frame.fftSize) && frame.fftSize >= 2 &&
    Number.isInteger(frame.validSamples) && frame.validSamples > 0 &&
    Number.isInteger(frame.rawIqByteCount) && frame.rawIqByteCount === frame.validSamples * 2;
}

/** The current received frame is authoritative when source-list epoch metadata lags. */
export function resolveNativeTrainingEpoch(frameEpoch: number | null | undefined, sourceEpoch: number | null | undefined): number | null {
  if (typeof frameEpoch === 'number' && Number.isFinite(frameEpoch)) return frameEpoch;
  if (typeof sourceEpoch === 'number' && Number.isFinite(sourceEpoch)) return sourceEpoch;
  return null;
}

export interface CapturedTrainingFrame {
  streamEpoch: number;
  optionsRevision: number;
  sequence: number;
  timestampMs: number;
  validSamples: number;
  iqBytes: Uint8Array;
}

export interface NativeTrainingFrameTimestampDiagnostic {
  previousSequence: number;
  previousTimestampMs: number;
  incomingSequence: number;
  incomingTimestampMs: number;
}

export interface NativeTrainingCaptureSnapshot {
  format: 'n-apt-native-iq-frames-v1';
  iqSampleFormat: 'u8';
  payloadSemantics: 'each frame stores the complete iq_data payload received for that sequence; frames remain independent and are never concatenated';
  sessionId: string;
  visualizerSessionKey: string;
  createdAtTimestampMs: number | null;
  config: NativeTrainingCaptureConfig;
  stopReason: string | null;
  tuneEvents: NativeTrainingTuneEvent[];
  optionsAppliedEvents: NativeTrainingOptionsAppliedEvent[];
  streamInterruptedEvents: NativeTrainingStreamInterruptedEvent[];
  frames: CapturedTrainingFrame[];
}

export class NativeTrainingCaptureSession {
  static readonly STALE_AFTER_MS = 3_000;
  static readonly MAX_DURATION_MS = 12_000;
  static readonly MAX_BYTES = 64 * 1024 * 1024;
  static readonly MAX_FRAMES = 4_000;

  private capture: NativeTrainingCaptureSnapshot | null = null;
  private annotations: NativeTrainingCaptureAnnotations = { label: 'uncertain', channel: 'unspecified', features: [], tags: [] };
  private annotationEvents: NativeTrainingAnnotationEvent[] = [];
  private interferenceMarkedEvents: NativeTrainingAnnotationSidecar['interferenceMarkedEvents'] = [];
  private startedAt = 0;
  private lastFrameAt = 0;
  private lastSequence = -1;
  private lastTimestamp = -1;
  private rejectedFrameTimestamp: NativeTrainingFrameTimestampDiagnostic | null = null;
  private startBoundarySequence: number | null = null;
  private startedAtTimestamp = 0;
  private bytes = 0;

  get active(): boolean { return !!this.capture && this.capture.stopReason === null; }
  get frameCount(): number { return this.capture?.frames.length ?? 0; }
  get lastFrameTimestampDiagnostic(): NativeTrainingFrameTimestampDiagnostic | null {
    return this.rejectedFrameTimestamp ? { ...this.rejectedFrameTimestamp } : null;
  }

  start(
    config: NativeTrainingCaptureConfig,
    nowMs: number,
    nowTimestampMs = Date.now(),
    annotations: NativeTrainingCaptureAnnotations = { label: 'uncertain', channel: 'unspecified', features: [], tags: [] },
    startBoundary?: { sequence: number; timestampMs: number },
  ): boolean {
    if (this.active || !config.sessionId || !config.sourceId || !config.visualizerSessionKey ||
      !Number.isFinite(config.streamEpoch) || !Number.isInteger(config.optionsRevision) || config.optionsRevision < 0 ||
      config.appliedOptions?.mode !== 'rx' || !Number.isFinite(config.sampleRateHz) || config.sampleRateHz <= 0 ||
      !Number.isFinite(config.centerFrequencyHz) || !Number.isInteger(config.configuredFftSize) || config.configuredFftSize < 2 ||
      !Number.isInteger(config.fftSize) || config.fftSize < 2 || !Number.isFinite(nowMs) ||
      (startBoundary !== undefined && (!Number.isInteger(startBoundary.sequence) || !Number.isFinite(startBoundary.timestampMs))) ||
      (config.configuredFrameRateHz !== null && (!Number.isFinite(config.configuredFrameRateHz) || config.configuredFrameRateHz <= 0))) return false;
    this.startedAt = this.lastFrameAt = nowMs;
    this.startBoundarySequence = startBoundary?.sequence ?? null;
    this.lastSequence = startBoundary?.sequence ?? -1;
    this.lastTimestamp = startBoundary?.timestampMs ?? -1;
    this.rejectedFrameTimestamp = null;
    this.startedAtTimestamp = startBoundary?.timestampMs ?? nowTimestampMs;
    this.bytes = 0;
    this.capture = { format: 'n-apt-native-iq-frames-v1', iqSampleFormat: 'u8', payloadSemantics: 'each frame stores the complete iq_data payload received for that sequence; frames remain independent and are never concatenated', sessionId: config.sessionId,
      visualizerSessionKey: config.visualizerSessionKey, createdAtTimestampMs: null,
      config: { ...config, appliedOptions: { ...config.appliedOptions } }, stopReason: null, tuneEvents: [], optionsAppliedEvents: [], streamInterruptedEvents: [], frames: [] };
    this.annotations = cloneAnnotations(annotations);
    this.annotationEvents = [{ timestampMs: this.startedAtTimestamp, frameSequence: this.startBoundarySequence,
      annotations: cloneAnnotations(annotations), initial: true }];
    this.interferenceMarkedEvents = hasInterferenceTag(annotations) ? [{ kind: 'InterferenceMarked', code: 2, timestampMs: nowTimestampMs, byteOffset: 0, frameSequence: null }] : [];
    return true;
  }

  updateAnnotations(annotations: NativeTrainingCaptureAnnotations, timestampMs = Date.now()): void {
    if (!this.capture) return;
    const previouslyMarkedInterference = hasInterferenceTag(this.annotations);
    const next = cloneAnnotations(annotations);
    this.annotations = next;
    if (this.active) {
      this.annotationEvents.push({ timestampMs, frameSequence: this.lastSequence >= 0 ? this.lastSequence : null, annotations: cloneAnnotations(next) });
      if (hasInterferenceTag(next) && !previouslyMarkedInterference) this.interferenceMarkedEvents.push({ kind: 'InterferenceMarked', code: 2, timestampMs, byteOffset: this.bytes, frameSequence: this.lastSequence >= 0 ? this.lastSequence : null });
    } else {
      // Post-capture review adjusts the base label for the whole recording;
      // frame-bounded events from the live session still override it.
      this.annotationEvents.push({ timestampMs, frameSequence: null, annotations: cloneAnnotations(next), captureWide: true });
    }
  }

  stopForTune(toCenterFrequencyHz: number, timestampMs: number, sequence: number): void {
    if (!this.active || !this.capture || !Number.isFinite(toCenterFrequencyHz) || toCenterFrequencyHz === this.capture.config.centerFrequencyHz) return;
    this.stopForMetadataChange({ ...this.capture.config, centerFrequencyHz: toCenterFrequencyHz, status: 'receiving' }, timestampMs, sequence);
  }

  stopForMetadataChange(to: NativeTrainingCaptureFrameMetadata, timestampMs: number, sequence: number): void {
    if (!this.active || !this.capture) return;
    const from = metadataForConfig(this.capture.config);
    const next = { ...to };
    const changedFields = metadataChangedFields(from, next);
    if (!changedFields.length || !Number.isFinite(timestampMs) || !Number.isInteger(sequence)) {
      this.stop('source-or-config-changed');
      return;
    }
    const previousSequence = this.lastSequence >= 0 ? this.lastSequence : null;
    const previousTimestamp = this.lastTimestamp >= 0 ? this.lastTimestamp : this.startedAtTimestamp;
    const patch: NativeTrainingOptionsAppliedEvent['patch'] = {};
    for (const field of changedFields) {
      if (field !== 'sourceId' && field !== 'streamEpoch' && field !== 'status') {
        (patch as Record<string, unknown>)[field] = field === 'appliedOptions' ? { ...next.appliedOptions } : next[field];
      }
    }
    this.capture.optionsAppliedEvents.push({ kind: 'PatchOptionsApplied', timestampMs, fromTimestampMs: previousTimestamp, toTimestampMs: timestampMs,
      fromFrameSequence: previousSequence, toFrameSequence: sequence,
      fromRevision: from.optionsRevision, toRevision: next.optionsRevision,
      fromStreamEpoch: from.streamEpoch, toStreamEpoch: next.streamEpoch,
      fromSourceId: from.sourceId, toSourceId: next.sourceId, byteOffset: this.bytes, changedFields, patch });
    if (from.sourceId !== next.sourceId || from.streamEpoch !== next.streamEpoch) {
      this.mark(timestampMs, from.sourceId !== next.sourceId ? 'source-changed' : 'stream-epoch-changed', sequence);
    }
    if (from.centerFrequencyHz !== next.centerFrequencyHz) {
      this.capture.tuneEvents.push({ timestampMs, sequence, fromFrameSequence: previousSequence, toFrameSequence: sequence,
        fromCenterFrequencyHz: from.centerFrequencyHz, toCenterFrequencyHz: next.centerFrequencyHz });
    }
    this.stop(from.centerFrequencyHz !== next.centerFrequencyHz ? 'center-frequency-changed' : 'source-or-config-changed', { timestampMs, nextFrameSequence: sequence, recordMarker: false });
  }

  append(frame: NativeTrainingCaptureFrame, nowMs: number, nowTimestampMs = Date.now()): 'accepted' | 'duplicate' | 'prestart' | 'stopped' | 'inactive' {
    if (!this.active || !this.capture) return 'inactive';
    const config = this.capture.config;
    const changedFields = metadataChanges(config, frame);
    if (changedFields.length) {
      this.stopForMetadataChange(frame, frame.timestampMs, frame.sequence);
      return 'stopped';
    }
    if (!Number.isFinite(frame.timestampMs) || !Number.isFinite(frame.sequence) ||
      frame.iqBytes.length % 2 !== 0 || frame.iqBytes.length !== frame.validSamples * 2 || frame.validSamples <= 0) {
      this.stop('source-or-config-changed');
      return 'stopped';
    }
    // FFTCanvas may reprocess its most recently observed monitor frame after
    // the user starts recording. Ignore that pre-start frame and wait for the
    // first acquisition timestamp strictly after the capture boundary.
    if (this.capture.frames.length === 0 && this.startBoundarySequence !== null && frame.sequence <= this.startBoundarySequence) return 'prestart';
    if (this.lastSequence < 0 && frame.timestampMs <= this.startedAtTimestamp) return 'prestart';
    if (frame.sequence === this.lastSequence) return 'duplicate';
    if (frame.sequence < this.lastSequence) {
      this.stop('out-of-order-frame', { timestampMs: frame.timestampMs, nextFrameSequence: frame.sequence });
      return 'stopped';
    }
    if (this.lastSequence >= 0 && frame.sequence !== this.lastSequence + 1) {
      this.stop('frame-sequence-gap', { timestampMs: frame.timestampMs, nextFrameSequence: frame.sequence });
      return 'stopped';
    }
    const frameGapLimitMs = Math.max(200, config.configuredFrameRateHz ? 3_000 / config.configuredFrameRateHz : 1_000);
    if (frame.timestampMs <= this.lastTimestamp) {
      this.rejectedFrameTimestamp = {
        previousSequence: this.lastSequence,
        previousTimestampMs: this.lastTimestamp,
        incomingSequence: frame.sequence,
        incomingTimestampMs: frame.timestampMs,
      };
      this.stop('non-increasing-frame-timestamp', { timestampMs: frame.timestampMs, nextFrameSequence: frame.sequence });
      return 'stopped';
    }
    if (this.lastTimestamp >= 0 && frame.timestampMs - this.lastTimestamp > frameGapLimitMs) {
      this.stop('frame-timestamp-gap', { timestampMs: frame.timestampMs, nextFrameSequence: frame.sequence });
      return 'stopped';
    }
    const frameAgeMs = nowTimestampMs - frame.timestampMs;
    if (!Number.isFinite(frameAgeMs) || frameAgeMs > NativeTrainingCaptureSession.STALE_AFTER_MS) {
      this.stop('frame-timestamp-stale', { timestampMs: frame.timestampMs, nextFrameSequence: frame.sequence });
      return 'stopped';
    }
    if (frameAgeMs < -NativeTrainingCaptureSession.STALE_AFTER_MS) {
      this.stop('frame-timestamp-future', { timestampMs: frame.timestampMs, nextFrameSequence: frame.sequence });
      return 'stopped';
    }
    if (!Number.isFinite(nowMs) || nowMs - this.startedAt >= NativeTrainingCaptureSession.MAX_DURATION_MS ||
      this.capture.frames.length >= NativeTrainingCaptureSession.MAX_FRAMES ||
      this.bytes + frame.iqBytes.byteLength > NativeTrainingCaptureSession.MAX_BYTES) {
      this.stop('capture-limit-reached');
      return 'stopped';
    }
    this.lastFrameAt = nowMs;
    this.lastSequence = frame.sequence;
    this.lastTimestamp = frame.timestampMs;
    this.bytes += frame.iqBytes.byteLength;
    if (this.capture.createdAtTimestampMs === null) this.capture.createdAtTimestampMs = frame.timestampMs;
    this.capture.frames.push({
      streamEpoch: frame.streamEpoch, optionsRevision: frame.optionsRevision,
      sequence: frame.sequence, timestampMs: frame.timestampMs, validSamples: frame.validSamples,
      iqBytes: frame.iqBytes.slice(),
    });
    return 'accepted';
  }

  stop(reason = 'user-stopped', boundary?: { timestampMs: number; nextFrameSequence?: number; recordMarker?: boolean }): void {
    if (this.active && this.capture) {
      const timestampMs = boundary?.timestampMs ?? (this.lastTimestamp >= 0 ? this.lastTimestamp : this.startedAtTimestamp);
      if (boundary?.recordMarker !== false && reason !== 'user-stopped' && reason !== 'capture-limit-reached') {
        this.mark(timestampMs, reason, boundary?.nextFrameSequence);
      }
      this.capture.stopReason = reason;
    }
  }

  private mark(timestampMs: number, reason: string, nextFrameSequence?: number): void {
    if (!this.capture) return;
    this.capture.streamInterruptedEvents.push({ kind: 'StreamInterrupted', code: 1, timestampMs, byteOffset: this.bytes,
      frameSequence: this.lastSequence >= 0 ? this.lastSequence : null,
      ...(nextFrameSequence === undefined ? {} : { nextFrameSequence }), reason });
  }

  stopIfStale(nowMs: number): boolean {
    if (!this.active || nowMs - this.lastFrameAt < NativeTrainingCaptureSession.STALE_AFTER_MS) return false;
    this.stop('no-new-frames');
    return true;
  }

  snapshot(): NativeTrainingCaptureSnapshot | null {
    if (!this.capture) return null;
    return { ...this.capture, config: { ...this.capture.config, appliedOptions: { ...this.capture.config.appliedOptions } }, tuneEvents: this.capture.tuneEvents.map((event) => ({ ...event })), optionsAppliedEvents: this.capture.optionsAppliedEvents.map((event) => ({ ...event, changedFields: [...event.changedFields], patch: { ...event.patch, ...(event.patch.appliedOptions ? { appliedOptions: { ...event.patch.appliedOptions } } : {}) } })), streamInterruptedEvents: this.capture.streamInterruptedEvents.map((event) => ({ ...event })), frames: this.capture.frames.map((frame) => ({ ...frame, iqBytes: frame.iqBytes.slice() })) };
  }

  clear(): void {
    if (this.active) return;
    this.capture = null;
    this.annotations = { label: 'uncertain', channel: 'unspecified', features: [], tags: [] };
    this.annotationEvents = [];
    this.interferenceMarkedEvents = [];
    this.bytes = 0;
    this.lastSequence = -1;
    this.lastTimestamp = -1;
    this.rejectedFrameTimestamp = null;
    this.startBoundarySequence = null;
  }

  toExportObject(): Omit<NativeTrainingCaptureSnapshot, 'frames'> & { frames: Array<Omit<CapturedTrainingFrame, 'iqBytes'> & { iqBase64: string }> } | null {
    const capture = this.snapshot();
    if (!capture) return null;
    return { ...capture, frames: capture.frames.map(({ iqBytes, ...frame }) => ({ ...frame, iqBase64: encodeBase64(iqBytes) })) };
  }

  toAnnotationSidecar(captureIdentity: NativeTrainingCaptureIdentity): NativeTrainingAnnotationSidecar | null {
    if (!this.capture) return null;
    if (captureIdentity.kind === 'v6-trailer-sha256') {
      throw new Error('Browser frame capture has no V6 trailer; use its filename and capture time');
    }
    if (captureIdentity.kind === 'filename-timestamp' && captureIdentity.capturedAtTimestampMs !== this.capture.createdAtTimestampMs) {
      throw new Error('Annotation filename timestamp must match the capture timestamp');
    }
    return this.makeAnnotationSidecar(captureIdentity);
  }

  async toVerifiedV6AnnotationSidecar(captureBytes: Uint8Array): Promise<NativeTrainingAnnotationSidecar | null> {
    if (!this.capture) return null;
    const digestHex = readIqCaptureTrailerDigest(captureBytes);
    if (!await verifyStampedIntegrity(captureBytes, digestHex)) {
      throw new Error('V6 I/Q capture trailer checksum did not verify');
    }
    return this.makeAnnotationSidecar({
      kind: 'v6-trailer-sha256',
      algorithm: 'SHA-256',
      scope: 'file-with-integrity-digest-placeholder',
      digestHex,
    });
  }

  private makeAnnotationSidecar(captureIdentity: NativeTrainingCaptureIdentity): NativeTrainingAnnotationSidecar | null {
    if (!this.capture) return null;
    return { format: 'n-apt-native-annotations-v2', captureId: getNativeTrainingCaptureId(captureIdentity), sessionId: this.capture.sessionId, captureIdentity: { ...captureIdentity },
      annotations: cloneAnnotations(this.annotations), annotationEvents: this.annotationEvents.map((event) => ({ ...event, annotations: cloneAnnotations(event.annotations) })),
      interferenceMarkedEvents: this.interferenceMarkedEvents.map((event) => ({ ...event })) };
  }
}

export function isNativeTrainingFrameStale(
  frame: { timestampMs: number } | null,
  nowTimestampMs: number,
): boolean {
  if (!frame) return false;
  const ageMs = nowTimestampMs - frame.timestampMs;
  return !Number.isFinite(ageMs) || ageMs < 0 || ageMs > NativeTrainingCaptureSession.STALE_AFTER_MS;
}

/** A fresh timestamp alone is insufficient: health must match the active RX source and carry a complete receiving payload. */
export function isNativeTrainingReadinessFrameUsable(
  frame: Pick<NativeTrainingReadinessFrame, 'sourceId' | 'status' | 'timestampMs' | 'fftSize' | 'validSamples' | 'rawIqByteCount'> | null,
  selectedSourceId: string | null,
  nowTimestampMs: number,
): boolean {
  return !!frame && !!selectedSourceId && frame.sourceId === selectedSourceId &&
    frame.status === 'receiving' && isCompleteNativeTrainingFrame(frame) &&
    !isNativeTrainingFrameStale(frame, nowTimestampMs);
}

export function stopNativeTrainingCaptureForHealth(
  session: NativeTrainingCaptureSession,
  state: {
    eligible: boolean;
    ineligibleReason?: string | null;
    latestFrameFresh: boolean;
    nowMs: number;
  },
): string | null {
  if (!session.active) return null;
  if (!state.eligible || !state.latestFrameFresh) {
    const reason = state.eligible ? 'stale-frame' : state.ineligibleReason ?? 'source-disconnected-or-ineligible';
    session.stop(reason);
    return reason;
  }
  return session.stopIfStale(state.nowMs) ? 'no-new-frames' : null;
}

export function nativeTrainingCaptureFileName(sessionId: string, capturedAtTimestampMs: number): string {
  if (!sessionId || !Number.isFinite(capturedAtTimestampMs)) {
    throw new Error('Capture filename requires a session ID and finite capture timestamp');
  }
  const timestamp = new Date(capturedAtTimestampMs);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Capture timestamp is outside the supported date range');
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '-');
  const dateTime = timestamp.toISOString().replace(/[:.]/g, '-');
  return `n-apt-iq-capture-${dateTime}-${safeSessionId}.iq`;
}

export interface NativeTrainingV6CaptureArtifact {
  captureFileName: string;
  captureBytes: Uint8Array;
  annotationFileName: string;
  annotations: NativeTrainingAnnotationSidecar;
}

export interface NativeTrainingCaptureIngressAppendOptions {
  session: NativeTrainingCaptureSession;
  rawFrame: unknown;
  selectedSourceId: string | null;
  appliedStream: {
    streamEpoch: number;
    optionsRevision: number;
    options: IqAppliedStreamOptions;
  } | null;
  eligible: boolean;
  ineligibleReason?: string | null;
  nowMs: number;
  nowTimestampMs: number;
}

/**
 * Append one accepted raw receive frame without depending on canvas repaint.
 * The selected source and Redux-applied options remain the authority for
 * deciding whether the raw transport frame belongs in this training capture.
 */
export function appendNativeTrainingCaptureIngressFrame({
  session,
  rawFrame,
  selectedSourceId,
  appliedStream,
  eligible,
  ineligibleReason,
  nowMs,
  nowTimestampMs,
}: NativeTrainingCaptureIngressAppendOptions): 'accepted' | 'duplicate' | 'prestart' | 'stopped' | 'inactive' | 'ignored' {
  if (!session.active) return 'inactive';
  const frame = rawFrame as Partial<IqRawFrame> | null;
  if (!frame || !selectedSourceId || frame.source_id !== selectedSourceId) return 'ignored';
  if (!eligible) {
    session.stop(ineligibleReason || 'source-disconnected-or-ineligible');
    return 'stopped';
  }
  if (frame.is_fresh === false) return 'ignored';
  if (frame.frame_status !== 'receiving') {
    session.stop(frame.frame_status === 'paused' ? 'rtl-sdr-paused' : 'rtl-sdr-not-receiving');
    return 'stopped';
  }

  const options = appliedStream?.options;
  const sampleRateHz = frame.sample_rate;
  const centerFrequencyHz = frame.center_frequency_hz;
  const sequence = frame.sequence;
  const timestampMs = frame.timestamp;
  if (!appliedStream || !options || options.mode !== 'rx') {
    session.stop('applied-options-unavailable');
    return 'stopped';
  }
  const window = normalizeNativeWindowKind(options.fftWindow);
  if (appliedStream.streamEpoch !== frame.stream_epoch ||
    appliedStream.optionsRevision !== frame.options_revision ||
    !Number.isInteger(options.fftSize) || options.fftSize < 2 ||
    !['rectangular', 'hann', 'hamming', 'blackman', 'nuttall'].includes(window) ||
    !Number.isInteger(frame.stream_epoch) || !Number.isInteger(frame.options_revision) ||
    !Number.isInteger(sequence) || !Number.isFinite(timestampMs) ||
    !Number.isFinite(sampleRateHz) || sampleRateHz! <= 0 ||
    !Number.isFinite(centerFrequencyHz) ||
    !(frame.iq_data instanceof Uint8Array) || frame.iq_data.length < 2 || frame.iq_data.length % 2 !== 0) {
    session.stop('applied-options-unavailable');
    return 'stopped';
  }

  return session.append({
    sourceId: selectedSourceId,
    streamEpoch: frame.stream_epoch!,
    optionsRevision: frame.options_revision!,
    appliedOptions: { ...options },
    sequence: sequence!,
    timestampMs: timestampMs!,
    sampleRateHz: sampleRateHz!,
    centerFrequencyHz: centerFrequencyHz!,
    configuredFrameRateHz: options.frameRate ?? null,
    configuredFftSize: options.fftSize,
    fftSize: options.fftSize,
    window,
    temporalResolution: 'lossless',
    validSamples: frame.iq_data.length / 2,
    status: frame.frame_status,
    iqBytes: frame.iq_data,
  }, nowMs, nowTimestampMs);
}

export interface NativeTrainingCaptureIngressState {
  selectedSourceId: string | null;
  appliedStream: NativeTrainingCaptureIngressAppendOptions['appliedStream'];
  eligible: boolean;
  ineligibleReason?: string | null;
}

export function subscribeNativeTrainingCaptureIngress({
  session,
  getState,
  now = () => ({
    nowMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    nowTimestampMs: Date.now(),
  }),
  onFrameObserved,
  onStopped,
}: {
  session: NativeTrainingCaptureSession;
  getState: () => NativeTrainingCaptureIngressState;
  now?: () => { nowMs: number; nowTimestampMs: number };
  onFrameObserved?: (rawFrame: unknown, state: NativeTrainingCaptureIngressState) => void;
  onStopped?: () => void;
}): () => void {
  return subscribeRawIqFrameArrivals((rawFrame) => {
    const state = getState();
    const sourceId = (rawFrame as Partial<IqRawFrame> | null)?.source_id;
    if (!state.selectedSourceId || sourceId !== state.selectedSourceId) return;
    onFrameObserved?.(rawFrame, state);
    if (!session.active) return;
    const time = now();
    const outcome = appendNativeTrainingCaptureIngressFrame({
      session,
      rawFrame,
      ...state,
      ...time,
    });
    if (outcome === 'stopped') onStopped?.();
  });
}

export async function exportNativeTrainingCaptureV6(
  session: NativeTrainingCaptureSession,
): Promise<NativeTrainingV6CaptureArtifact> {
  const capture = session.snapshot();
  if (!capture || capture.stopReason === null || !capture.frames.length || capture.createdAtTimestampMs === null) {
    throw new Error('Stop a non-empty training capture before exporting it');
  }

  const firstFrame = capture.frames[0];
  const lastFrame = capture.frames[capture.frames.length - 1];
  const byteLength = capture.frames.reduce((total, frame) => total + frame.iqBytes.byteLength, 0);
  let sampleOffset = 0;
  const chunks: IqCaptureChunk[] = capture.frames.map((frame) => {
    const chunk: IqCaptureChunk = { sample_offset: sampleOffset, channel: 0, data: frame.iqBytes };
    sampleOffset += frame.validSamples;
    return chunk;
  });
  const frameUpdates: IqCaptureFrameUpdate[] = [
    {
      sample_offset: 0,
      timestamp_us: Math.round(firstFrame.timestampMs * 1000),
      channel: 0,
      kind: 'PatchOptionsApplied',
      source_id: capture.config.sourceId,
      job_id: capture.sessionId,
      next_frame_sequence: firstFrame.sequence,
      patch: {
        center_frequency_hz: capture.config.centerFrequencyHz,
        sample_rate_hz: capture.config.sampleRateHz,
        fft_size: capture.config.fftSize,
        configured_fft_size: capture.config.configuredFftSize,
        fft_window: capture.config.window,
        frame_rate_hz: capture.config.configuredFrameRateHz,
        options_revision: capture.config.optionsRevision,
        stream_epoch: capture.config.streamEpoch,
        valid_sample_count: firstFrame.validSamples,
      },
    },
    ...capture.frames.reduce<{ updates: IqCaptureFrameUpdate[]; byteOffset: number }>((state, frame) => {
      state.updates.push({
        sample_offset: state.byteOffset,
        timestamp_us: Math.round(frame.timestampMs * 1000),
        channel: 0,
        kind: 'Frame',
        source_id: capture.config.sourceId,
        job_id: capture.sessionId,
        frame_sequence: frame.sequence,
        patch: {},
      });
      state.byteOffset += frame.iqBytes.byteLength;
      return state;
    }, { updates: [], byteOffset: 0 }).updates,
    ...capture.optionsAppliedEvents.map((event): IqCaptureFrameUpdate => ({
      sample_offset: event.byteOffset,
      timestamp_us: Math.round(event.timestampMs * 1000),
      channel: 0,
      kind: event.kind,
      source_id: event.toSourceId,
      job_id: capture.sessionId,
      ...(event.fromFrameSequence === null ? {} : { frame_sequence: event.fromFrameSequence }),
      next_frame_sequence: event.toFrameSequence,
      patch: {
        ...event.patch,
        from_options_revision: event.fromRevision,
        to_options_revision: event.toRevision,
        from_stream_epoch: event.fromStreamEpoch,
        to_stream_epoch: event.toStreamEpoch,
        changed_fields: event.changedFields,
      },
    })),
    ...capture.streamInterruptedEvents.map((event): IqCaptureFrameUpdate => ({
      sample_offset: event.byteOffset,
      timestamp_us: Math.round(event.timestampMs * 1000),
      channel: 0,
      kind: event.kind,
      source_id: capture.config.sourceId,
      job_id: capture.sessionId,
      ...(event.frameSequence === null ? {} : { frame_sequence: event.frameSequence }),
      ...(event.nextFrameSequence === undefined ? {} : { next_frame_sequence: event.nextFrameSequence }),
      patch: { code: event.code, ...(event.reason ? { reason: event.reason } : {}) },
    })),
  ];
  frameUpdates.sort((a, b) => a.sample_offset - b.sample_offset || a.timestamp_us - b.timestamp_us ||
    (a.kind === 'StreamInterrupted' ? -1 : b.kind === 'StreamInterrupted' ? 1 : 0));

  const metadata: CaptureMetadata = {
    timestamp_utc: new Date(capture.createdAtTimestampMs).toISOString(),
    source_device: 'RTL-SDR',
    source_id: capture.config.sourceId,
    stream_epoch: capture.config.streamEpoch,
    options_revision: capture.config.optionsRevision,
    center_frequency_hz: capture.config.centerFrequencyHz,
    sample_rate_hz: capture.config.sampleRateHz,
    capture_sample_rate_hz: capture.config.sampleRateHz,
    hardware_sample_rate_hz: capture.config.sampleRateHz,
    fft_size: capture.config.fftSize,
    configured_fft_size: capture.config.configuredFftSize,
    fft_window: capture.config.window,
    frame_rate: capture.config.configuredFrameRateHz,
    duration_s: sampleOffset / capture.config.sampleRateHz,
    sample_count: sampleOffset,
    frame_count: capture.frames.length,
    iq_byte_count: byteLength,
    data_format: 'iq_u8',
    temporal_resolution: capture.config.temporalResolution,
    lossless: true,
    capture_session_id: capture.sessionId,
    last_frame_timestamp_utc: new Date(lastFrame.timestampMs).toISOString(),
    stop_reason: capture.stopReason,
    channels: [{
      center_freq_hz: capture.config.centerFrequencyHz,
      sample_rate_hz: capture.config.sampleRateHz,
      requested_min_freq_hz: capture.config.centerFrequencyHz - capture.config.sampleRateHz / 2,
      requested_max_freq_hz: capture.config.centerFrequencyHz + capture.config.sampleRateHz / 2,
      bins_per_frame: capture.config.fftSize,
      iq_length: byteLength,
      label: null,
    }],
  };
  const captureBytes = await encodeIqCaptureV4({ metadata, frameUpdates, chunks });
  const annotations = await session.toVerifiedV6AnnotationSidecar(captureBytes);
  if (!annotations) throw new Error('Training capture labels are unavailable for export');
  const captureFileName = nativeTrainingCaptureFileName(capture.sessionId, capture.createdAtTimestampMs);
  return {
    captureFileName,
    captureBytes,
    annotationFileName: captureFileName.replace(/^n-apt-iq-capture-/, 'n-apt-annotations-').replace(/\.iq$/, '.json'),
    annotations,
  };
}

export function getNativeTrainingCaptureId(identity: NativeTrainingCaptureIdentity): string {
  if (identity.kind === 'v6-trailer-sha256') {
    if (identity.algorithm !== 'SHA-256' || identity.scope !== 'file-with-integrity-digest-placeholder' || !/^[\da-f]{64}$/i.test(identity.digestHex)) {
      throw new Error('V6 capture identity requires a verified SHA-256 trailer digest');
    }
    return identity.digestHex.toLowerCase();
  }
  if (identity.kind !== 'filename-timestamp' || !identity.fileName || /[/\\\0]/.test(identity.fileName) ||
    identity.fileName === '.' || identity.fileName === '..' || !Number.isFinite(identity.capturedAtTimestampMs)) {
    throw new Error('Capture identity requires a basename and finite capture timestamp');
  }
  const timestamp = new Date(identity.capturedAtTimestampMs);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Capture timestamp is outside the supported date range');
  return `${identity.fileName}@${timestamp.toISOString()}`;
}

function metadataForConfig(config: NativeTrainingCaptureConfig): NativeTrainingCaptureFrameMetadata {
  return { sourceId: config.sourceId, streamEpoch: config.streamEpoch, optionsRevision: config.optionsRevision,
    appliedOptions: { ...config.appliedOptions }, sampleRateHz: config.sampleRateHz,
    centerFrequencyHz: config.centerFrequencyHz, configuredFrameRateHz: config.configuredFrameRateHz,
    configuredFftSize: config.configuredFftSize, fftSize: config.fftSize, window: config.window,
    temporalResolution: config.temporalResolution, status: 'receiving' };
}

function metadataChanges(config: NativeTrainingCaptureConfig, frame: NativeTrainingCaptureFrame): Array<keyof NativeTrainingCaptureFrameMetadata> {
  const previous = metadataForConfig(config);
  const next: NativeTrainingCaptureFrameMetadata = { sourceId: frame.sourceId, streamEpoch: frame.streamEpoch,
    optionsRevision: frame.optionsRevision, appliedOptions: frame.appliedOptions,
    sampleRateHz: frame.sampleRateHz, centerFrequencyHz: frame.centerFrequencyHz,
    configuredFrameRateHz: frame.configuredFrameRateHz, configuredFftSize: frame.configuredFftSize,
    fftSize: frame.fftSize, window: frame.window, temporalResolution: frame.temporalResolution, status: frame.status };
  return metadataChangedFields(previous, next);
}

function metadataChangedFields(from: NativeTrainingCaptureFrameMetadata, to: NativeTrainingCaptureFrameMetadata): Array<keyof NativeTrainingCaptureFrameMetadata> {
  return (Object.keys(from) as Array<keyof NativeTrainingCaptureFrameMetadata>).filter((key) =>
    key === 'appliedOptions' ? JSON.stringify(from[key]) !== JSON.stringify(to[key]) : from[key] !== to[key]);
}

function cloneAnnotations(annotations: NativeTrainingCaptureAnnotations): NativeTrainingCaptureAnnotations {
  return { label: annotations.label, channel: annotations.channel, features: [...new Set(annotations.features)], tags: [...new Set(annotations.tags)] };
}

function hasInterferenceTag(annotations: NativeTrainingCaptureAnnotations): boolean {
  return annotations.tags.some((tag) => tag.trim().toLocaleLowerCase() === 'interference');
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
