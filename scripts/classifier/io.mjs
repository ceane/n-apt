import { spectrumFromIq } from '../../src/ts/features/classification/native/iq.ts';
export { spectrumFromIq };
export function decodeIq(bytes, format) {
  const stride = { u8: 1, s16le: 2, f32le: 4 }[format];
  if (!stride || !bytes.length || bytes.length % (2 * stride)) throw new Error('Invalid or truncated interleaved I/Q');
  const result = new Float32Array(bytes.length / stride);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < result.length; i++) {
    result[i] = format === 'u8' ? (view.getUint8(i) - 128) / 128 : format === 's16le' ? view.getInt16(i * 2, true) / 32768 : view.getFloat32(i * 4, true);
    if (!Number.isFinite(result[i])) throw new Error('Nonfinite I/Q sample');
  }
  return result;
}

const TRAINING_CAPTURE_FORMAT = 'n-apt-native-iq-frames-v1';
const TRAINING_CAPTURE_SEMANTICS = 'each frame stores the complete iq_data payload received for that sequence; frames remain independent and are never concatenated';

function validateAnnotations(value) {
  if (!value || !['matching', 'nonmatching', 'uncertain'].includes(value.label) ||
    (value.channel !== undefined && !['unspecified', 'A', 'B', 'other'].includes(value.channel)) ||
    !Array.isArray(value.features) || value.features.some((item) => typeof item !== 'string') ||
    !Array.isArray(value.tags) || value.tags.some((item) => typeof item !== 'string')) throw new Error('Training capture annotations are invalid');
  return { label: value.label, channel: value.channel ?? 'unspecified', features: [...value.features], tags: [...value.tags] };
}

function validateFrameMetadata(value) {
  if (!value || typeof value.sourceId !== 'string' || !Number.isInteger(value.streamEpoch) ||
    !Number.isFinite(value.sampleRateHz) || !Number.isFinite(value.centerFrequencyHz) ||
    !(value.configuredFrameRateHz === null || Number.isFinite(value.configuredFrameRateHz)) ||
    !Number.isInteger(value.configuredFftSize) || !Number.isInteger(value.fftSize) ||
    typeof value.window !== 'string' || typeof value.temporalResolution !== 'string' || typeof value.status !== 'string') {
    throw new Error('Training capture frame metadata snapshot is invalid');
  }
  return value;
}

/** Validates an exported browser session without joining its independently framed raw I/Q payloads. */
export function readTrainingCapture(capture, sidecar = null) {
  if (capture?.format !== TRAINING_CAPTURE_FORMAT || capture?.payloadSemantics !== TRAINING_CAPTURE_SEMANTICS || capture?.iqSampleFormat !== 'u8') {
    throw new Error(`Unsupported browser training capture; expected ${TRAINING_CAPTURE_FORMAT} with u8 I/Q`);
  }
  if (typeof capture.sessionId !== 'string' || !capture.sessionId || !Array.isArray(capture.frames) || !capture.frames.length) {
    throw new Error('Training capture requires a session id and at least one frame');
  }
  const config = capture.config;
  if (!config || typeof config.sourceId !== 'string' || !config.sourceId || !Number.isInteger(config.streamEpoch) ||
    !Number.isInteger(config.optionsRevision) || config.optionsRevision < 0 || config.appliedOptions?.mode !== 'rx' ||
    !Number.isFinite(config.sampleRateHz) || config.sampleRateHz <= 0 || !Number.isFinite(config.centerFrequencyHz) ||
    !Number.isInteger(config.configuredFftSize) || config.configuredFftSize < 2 || !Number.isInteger(config.fftSize) || config.fftSize < 2 ||
    !['rectangular', 'hann', 'hamming', 'blackman', 'nuttall'].includes(config.window) || config.temporalResolution !== 'lossless') {
    throw new Error('Training capture has invalid acquisition configuration');
  }
  const frames = [];
  let previous = null;
  for (const frame of capture.frames) {
    if (frame.streamEpoch !== config.streamEpoch || frame.optionsRevision !== config.optionsRevision ||
      !Number.isInteger(frame.sequence) || !Number.isFinite(frame.timestampMs) ||
      !Number.isInteger(frame.validSamples) || frame.validSamples <= 0 || typeof frame.iqBase64 !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.iqBase64)) {
      throw new Error('Training capture contains invalid or mismatched frame metadata');
    }
    const iqBytes = Buffer.from(frame.iqBase64, 'base64');
    if (iqBytes.length !== frame.validSamples * 2 || iqBytes.toString('base64') !== frame.iqBase64) {
      throw new Error(`Training capture frame ${frame.sequence} byte count does not match its I/Q sample count`);
    }
    if (previous && (frame.sequence !== previous.sequence + 1 || frame.timestampMs <= previous.timestampMs)) {
      throw new Error('Training capture sequence gap or timestamp reordering detected');
    }
    frames.push({ ...frame, iqBytes: new Uint8Array(iqBytes) });
    previous = frame;
  }
  if (sidecar && (sidecar.format !== 'n-apt-native-annotations-v1' || sidecar.captureId !== capture.sessionId || sidecar.sessionId !== capture.sessionId)) {
    throw new Error('Annotation sidecar captureId/sessionId does not match the IQ capture');
  }
  const annotations = sidecar ? validateAnnotations(sidecar.annotations) : null;
  const annotationEvents = sidecar?.annotationEvents ?? [];
  const interferenceMarkedEvents = sidecar?.interferenceMarkedEvents ?? [];
  const tuneEvents = capture.tuneEvents ?? [];
  const optionsAppliedEvents = capture.optionsAppliedEvents ?? [];
  if (!Array.isArray(annotationEvents) || annotationEvents.some((event) => !Number.isFinite(event.timestampMs) ||
    !(event.frameSequence === null || Number.isInteger(event.frameSequence)) || (() => { try { validateAnnotations(event.annotations); return false; } catch { return true; } })())) {
    throw new Error('Training capture annotation timeline is invalid');
  }
  if (!Array.isArray(interferenceMarkedEvents) || interferenceMarkedEvents.some((event) => event.kind !== 'InterferenceMarked' || event.code !== 2 || !Number.isFinite(event.timestampMs) ||
    !Number.isInteger(event.byteOffset) || event.byteOffset < 0 || event.byteOffset > frames.reduce((sum, frame) => sum + frame.iqBytes.length, 0))) throw new Error('Annotation sidecar interference timeline is invalid');
  if (!Array.isArray(tuneEvents) || tuneEvents.some((event) => !Number.isFinite(event.timestampMs) || !Number.isInteger(event.sequence) ||
    (event.fromFrameSequence !== undefined && !(event.fromFrameSequence === null || Number.isInteger(event.fromFrameSequence))) ||
    (event.toFrameSequence !== undefined && !Number.isInteger(event.toFrameSequence)) ||
    !Number.isFinite(event.fromCenterFrequencyHz) || !Number.isFinite(event.toCenterFrequencyHz))) throw new Error('Training capture tune timeline is invalid');
  if (!Array.isArray(optionsAppliedEvents) || optionsAppliedEvents.some((event) => event.kind !== 'PatchOptionsApplied' || !Number.isFinite(event.timestampMs) ||
    !Number.isFinite(event.fromTimestampMs) || !Number.isFinite(event.toTimestampMs) ||
    !(event.fromFrameSequence === null || Number.isInteger(event.fromFrameSequence)) || !Number.isInteger(event.toFrameSequence) ||
    !Array.isArray(event.changedFields) || event.changedFields.length === 0 || event.changedFields.some((field) => typeof field !== 'string') ||
    (() => {
      try {
        const fields = new Set(event.changedFields);
        return !Number.isInteger(event.fromRevision) || !Number.isInteger(event.toRevision) ||
          !Number.isInteger(event.fromStreamEpoch) || !Number.isInteger(event.toStreamEpoch) ||
          !event.patch || typeof event.patch !== 'object' ||
          !Number.isInteger(event.byteOffset) || event.byteOffset !== frames.reduce((sum, frame) => sum + frame.iqBytes.length, 0) ||
          event.toTimestampMs !== event.timestampMs || event.fromSourceId !== config.sourceId ||
          Object.keys(event.patch).some((field) => !fields.has(field)) ||
          event.fromRevision !== config.optionsRevision || event.fromStreamEpoch !== config.streamEpoch ||
          (previous && event.fromFrameSequence !== previous.sequence) || (previous && event.fromTimestampMs !== previous.timestampMs) ||
          Object.keys(event.patch).length === 0;
      } catch { return true; }
    })())) {
    throw new Error('Training capture metadata timeline is invalid');
  }
  const streamInterruptedEvents = capture.streamInterruptedEvents ?? [];
  if (!Array.isArray(streamInterruptedEvents) || streamInterruptedEvents.some((event) => event.kind !== 'StreamInterrupted' || event.code !== 1 || !Number.isFinite(event.timestampMs) ||
    !Number.isInteger(event.byteOffset) || event.byteOffset < 0 || event.byteOffset > frames.reduce((sum, frame) => sum + frame.iqBytes.length, 0) ||
    !(event.frameSequence === null || Number.isInteger(event.frameSequence)) ||
    (event.nextFrameSequence !== undefined && !Number.isInteger(event.nextFrameSequence)))) throw new Error('Training capture marker timeline is invalid');
  return { format: TRAINING_CAPTURE_FORMAT, sessionId: capture.sessionId, config: { ...config }, annotations, annotationEvents, interferenceMarkedEvents, tuneEvents, optionsAppliedEvents, streamInterruptedEvents, stopReason: capture.stopReason ?? null, frames };
}
export function validateDataset(dataset) {
  if (!Array.isArray(dataset?.recordings) || !dataset.recordings.length) throw new Error('recordings must be nonempty');
  const ids = new Set(), sessions = new Map();
  for (const r of dataset.recordings) {
    if (!r.id || !/^[a-zA-Z0-9_-]+$/.test(r.id) || ids.has(r.id) || typeof r.session !== 'string' || !r.session ||
      !['train', 'validation', 'test', 'acceptance', 'unlabeled'].includes(r.split) ||
      !['matching', 'nonmatching', 'uncertain'].includes(r.label) || typeof r.input !== 'string' || !r.input ||
      !['u8', 's16le', 'f32le', 'napt', 'browser-capture'].includes(r.format) || !Number.isFinite(r.sampleRateHz) || r.sampleRateHz <= 0 || !Number.isFinite(r.centerFrequencyHz)) throw new Error(`Invalid dataset recording: ${r.id ?? 'missing id'}`);
    if (sessions.has(r.session) && sessions.get(r.session) !== r.split) throw new Error(`Session leakage: ${r.session}`);
    if (r.analysisSampleRateHz !== undefined && r.analysisSampleRateHz !== r.sampleRateHz) throw new Error('Resample I/Q with anti-alias filtering before preparation; metadata-only resampling is forbidden');
    sessions.set(r.session, r.split); ids.add(r.id);
  }
  return dataset;
}

export function selectFrameIndices(frameCount, limit = 64) {
  if (!Number.isInteger(frameCount) || frameCount < 0 || !Number.isInteger(limit) || limit < 1 || limit > 256) throw new Error('Invalid frame selection');
  const count = Math.min(frameCount, limit);
  if (!count) return [];
  if (count === 1) return [Math.floor((frameCount - 1) / 2)];
  return Array.from({length:count},(_,i)=>Math.floor(i*(frameCount-1)/(count-1)));
}
