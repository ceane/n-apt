import type { WindowKind } from './core';
import type { IqAppliedStreamOptions } from '@n-apt/consts/schemas/websocket';

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
  format: 'n-apt-native-annotations-v1';
  captureId: string;
  sessionId: string;
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
  sourcePaused: boolean;
  deviceConnected: boolean;
  canvasPaused: boolean;
  isRtlSdr: boolean;
}

export const canStartNativeTrainingCapture = (state: NativeTrainingCaptureEligibility): boolean =>
  !!state.selectedSourceId &&
  state.selectedSourceId === state.activeSourceId &&
  state.selectedSourceId === state.expectedSourceId &&
  state.sourceMode === 'live' && state.temporalResolution === 'lossless' && state.sourceCapability === 'rx' && !state.sourceIsMock &&
  state.sourceStatus === 'receiving' && !state.sourcePaused && state.deviceConnected &&
  !state.canvasPaused && state.isRtlSdr;

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
  private startedAtTimestamp = 0;
  private bytes = 0;

  get active(): boolean { return !!this.capture && this.capture.stopReason === null; }
  get frameCount(): number { return this.capture?.frames.length ?? 0; }

  start(config: NativeTrainingCaptureConfig, nowMs: number, nowTimestampMs = Date.now(), annotations: NativeTrainingCaptureAnnotations = { label: 'uncertain', channel: 'unspecified', features: [], tags: [] }): boolean {
    if (this.active || !config.sessionId || !config.sourceId || !config.visualizerSessionKey ||
      !Number.isFinite(config.streamEpoch) || !Number.isInteger(config.optionsRevision) || config.optionsRevision < 0 ||
      config.appliedOptions?.mode !== 'rx' || !Number.isFinite(config.sampleRateHz) || config.sampleRateHz <= 0 ||
      !Number.isFinite(config.centerFrequencyHz) || !Number.isInteger(config.configuredFftSize) || config.configuredFftSize < 2 ||
      !Number.isInteger(config.fftSize) || config.fftSize < 2 || !Number.isFinite(nowMs) ||
      (config.configuredFrameRateHz !== null && (!Number.isFinite(config.configuredFrameRateHz) || config.configuredFrameRateHz <= 0))) return false;
    this.startedAt = this.lastFrameAt = nowMs;
    this.lastSequence = -1;
    this.lastTimestamp = -1;
    this.startedAtTimestamp = nowTimestampMs;
    this.bytes = 0;
    this.capture = { format: 'n-apt-native-iq-frames-v1', iqSampleFormat: 'u8', payloadSemantics: 'each frame stores the complete iq_data payload received for that sequence; frames remain independent and are never concatenated', sessionId: config.sessionId,
      visualizerSessionKey: config.visualizerSessionKey, createdAtTimestampMs: null,
      config: { ...config, appliedOptions: { ...config.appliedOptions } }, stopReason: null, tuneEvents: [], optionsAppliedEvents: [], streamInterruptedEvents: [], frames: [] };
    this.annotations = cloneAnnotations(annotations);
    this.annotationEvents = [];
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

  append(frame: NativeTrainingCaptureFrame, nowMs: number, nowTimestampMs = Date.now()): 'accepted' | 'duplicate' | 'stopped' | 'inactive' {
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
    if (this.lastTimestamp >= 0 && frame.timestampMs - this.lastTimestamp > frameGapLimitMs) {
      this.stop('frame-timestamp-gap', { timestampMs: frame.timestampMs, nextFrameSequence: frame.sequence });
      return 'stopped';
    }
    if (frame.timestampMs <= this.lastTimestamp || frame.timestampMs <= this.startedAtTimestamp ||
      nowTimestampMs - frame.timestampMs > NativeTrainingCaptureSession.STALE_AFTER_MS ||
      frame.timestampMs - nowTimestampMs > NativeTrainingCaptureSession.STALE_AFTER_MS) {
      this.stop('stale-or-out-of-order-frame', { timestampMs: frame.timestampMs, nextFrameSequence: frame.sequence });
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
      if (boundary?.recordMarker !== false && reason !== 'user-stopped' && reason !== 'capture-limit-reached') this.mark(boundary?.timestampMs ?? Date.now(), reason, boundary?.nextFrameSequence);
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
  }

  toExportObject(): Omit<NativeTrainingCaptureSnapshot, 'frames'> & { frames: Array<Omit<CapturedTrainingFrame, 'iqBytes'> & { iqBase64: string }> } | null {
    const capture = this.snapshot();
    if (!capture) return null;
    return { ...capture, frames: capture.frames.map(({ iqBytes, ...frame }) => ({ ...frame, iqBase64: encodeBase64(iqBytes) })) };
  }

  toAnnotationSidecar(): NativeTrainingAnnotationSidecar | null {
    if (!this.capture) return null;
    return { format: 'n-apt-native-annotations-v1', captureId: this.capture.sessionId, sessionId: this.capture.sessionId,
      annotations: cloneAnnotations(this.annotations), annotationEvents: this.annotationEvents.map((event) => ({ ...event, annotations: cloneAnnotations(event.annotations) })),
      interferenceMarkedEvents: this.interferenceMarkedEvents.map((event) => ({ ...event })) };
  }
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
