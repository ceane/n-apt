import {
  averageTemporalWaveforms,
  clampTemporalActiveCount,
  ensureTemporalFrameSlot,
} from "@n-apt/utils/temporalResolution";

export const FULL_CHANNEL_BINS = 4096;

export function invertSpectrumVertically(
  waveform: Float32Array,
  dbMin: number,
  dbMax: number,
  target?: Float32Array,
): Float32Array {
  const output =
    target && target.length === waveform.length
      ? target
      : new Float32Array(waveform.length);
  const midpoint = dbMin + dbMax;
  for (let index = 0; index < waveform.length; index += 1) {
    output[index] = midpoint - waveform[index];
  }
  return output;
}

export interface SpectrumRenderPreparation {
  slicedWaveform: Float32Array;
  visualRange: { min: number; max: number };
  clampedPan: number;
  spectrumWaveform: Float32Array;
}

/** Applies view-window selection and vertical inversion before renderer submission. */
export function prepareSpectrumRenderData({
  waveform,
  frequencyRange,
  zoom,
  panOffset,
  invert,
  dbMin,
  dbMax,
  inversionBuffer,
  getZoomedData,
}: {
  waveform: Float32Array;
  frequencyRange: { min: number; max: number };
  zoom: number;
  panOffset: number;
  invert: boolean;
  dbMin: number;
  dbMax: number;
  inversionBuffer?: Float32Array | null;
  getZoomedData: (
    waveform: Float32Array,
    frequencyRange: { min: number; max: number },
    zoom: number,
    panOffset: number,
  ) => {
    slicedWaveform: Float32Array;
    visualRange: { min: number; max: number };
    clampedPan: number;
  };
}): SpectrumRenderPreparation {
  const { slicedWaveform, visualRange, clampedPan } = getZoomedData(
    waveform,
    frequencyRange,
    zoom,
    panOffset,
  );
  return {
    slicedWaveform,
    visualRange,
    clampedPan,
    spectrumWaveform: invert
      ? invertSpectrumVertically(
          slicedWaveform,
          dbMin,
          dbMax,
          inversionBuffer ?? undefined,
        )
      : slicedWaveform,
  };
}

export interface SpectrumWaveformSource {
  iq_data?: Uint8Array | null;
  waveform?: Float32Array | null;
  data?: Float32Array | null;
}

/** Resolves either raw IQ or an already-produced playback waveform. */
export function resolveSpectrumWaveform({
  source,
  processIq,
}: {
  source: SpectrumWaveformSource;
  processIq?: (iqData: Uint8Array) => Float32Array;
}): Float32Array | undefined {
  if (source.iq_data) {
    return processIq?.(source.iq_data);
  }
  return source.waveform ?? source.data ?? undefined;
}

export interface FullChannelAccumulationState {
  waveform: Float32Array | null;
  range: { min: number; max: number } | null;
}

/** Accumulates one tuned hop into the channel-wide display buffer. */
export function accumulateFullChannelWaveform({
  state,
  channelRange,
  hopCenterHz,
  hopSampleRate,
  waveform,
}: {
  state: FullChannelAccumulationState;
  channelRange: { min: number; max: number };
  hopCenterHz?: number | null;
  hopSampleRate?: number | null;
  waveform: Float32Array;
}): FullChannelAccumulationState {
  const channelSpan = channelRange.max - channelRange.min;
  if (
    channelSpan <= 0 ||
    typeof hopCenterHz !== "number" ||
    hopCenterHz <= 0 ||
    typeof hopSampleRate !== "number" ||
    hopSampleRate <= 0
  ) {
    return state;
  }

  const rangeChanged =
    !state.range ||
    state.range.min !== channelRange.min ||
    state.range.max !== channelRange.max;
  const accumulated = rangeChanged
    ? new Float32Array(FULL_CHANNEL_BINS).fill(-200)
    : (state.waveform ?? new Float32Array(FULL_CHANNEL_BINS).fill(-200));
  const hopMin = hopCenterHz - hopSampleRate / 2;
  const hopMax = hopCenterHz + hopSampleRate / 2;
  const startRatio = Math.max(
    0,
    (hopMin - channelRange.min) / channelSpan,
  );
  const endRatio = Math.min(1, (hopMax - channelRange.min) / channelSpan);
  const destStart = Math.round(startRatio * FULL_CHANNEL_BINS);
  const destEnd = Math.round(endRatio * FULL_CHANNEL_BINS);
  const destCount = Math.max(1, destEnd - destStart);
  const srcLen = waveform.length;

  if (srcLen > 0) {
    for (let i = 0; i < destCount; i++) {
      const srcIdx = Math.min(
        srcLen - 1,
        Math.round((i / destCount) * srcLen),
      );
      const destIdx = Math.min(FULL_CHANNEL_BINS - 1, destStart + i);
      accumulated[destIdx] = waveform[srcIdx];
    }
  }

  return {
    waveform: accumulated,
    range: { ...channelRange },
  };
}

export interface TemporalWaveformState {
  framePool: Float32Array[];
  activeFrames: Float32Array[];
  writeIndex: number;
  activeCount: number;
  renderWaveform: Float32Array | null;
}

export interface TemporalWaveformUpdate {
  writeIndex: number;
  activeCount: number;
  renderWaveform: Float32Array;
}

/**
 * Adds one waveform to the temporal ring buffer and returns the waveform that
 * should be presented. The supplied arrays are reusable storage owned by the
 * caller; no React state or rendering side effects belong in this helper.
 */
export function updateTemporalWaveform(
  waveform: Float32Array,
  temporalWindow: number,
  state: TemporalWaveformState,
): TemporalWaveformUpdate {
  if (temporalWindow <= 1) {
    return {
      writeIndex: state.writeIndex,
      activeCount: 0,
      renderWaveform: waveform,
    };
  }

  const window = Math.max(1, Math.floor(temporalWindow));
  const pool = state.framePool;
  if (
    pool.length !== window ||
    (pool.length > 0 && pool[0].length !== waveform.length)
  ) {
    pool.length = 0;
    for (let i = 0; i < window; i++) {
      pool[i] = new Float32Array(waveform.length);
    }
    state.activeFrames.length = 0;
    state.writeIndex = 0;
    state.activeCount = 0;
  }

  const writeIndex = ensureTemporalFrameSlot(
    pool,
    state.writeIndex,
    waveform.length,
  );
  pool[writeIndex].set(waveform);

  const nextWriteIndex = writeIndex + 1 === window ? 0 : writeIndex + 1;
  const activeCount = clampTemporalActiveCount(
    Math.min(window, state.activeCount + 1),
    window,
  );
  state.writeIndex = nextWriteIndex;
  state.activeCount = activeCount;

  const activeFrames = state.activeFrames;
  activeFrames.length = activeCount;
  let readIndex = nextWriteIndex - 1;
  if (readIndex < 0) readIndex = window - 1;
  for (let i = 0; i < activeCount; i++) {
    activeFrames[i] = pool[readIndex];
    readIndex--;
    if (readIndex < 0) readIndex = window - 1;
  }

  const outputBuffer =
    state.renderWaveform &&
    state.renderWaveform.length === waveform.length &&
    state.renderWaveform !== waveform
      ? state.renderWaveform
      : new Float32Array(waveform.length);

  return {
    writeIndex: nextWriteIndex,
    activeCount,
    renderWaveform: averageTemporalWaveforms(
      activeFrames,
      outputBuffer,
      outputBuffer,
    ),
  };
}
