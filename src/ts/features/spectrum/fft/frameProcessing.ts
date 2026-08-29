import {
  averageTemporalWaveforms,
  clampTemporalActiveCount,
  ensureTemporalFrameSlot,
} from "@n-apt/math/temporalResolution";
import {
  extendSpectrumBelowZero,
  mirrorPresentationCoverageSlackHz,
  resolvePanZoomForDisplayRange,
  sourceCoversMirroredDisplay,
} from "@n-apt/math/basebandMirror";

export const FULL_CHANNEL_BINS = 4096;

export function resolveFrameTemporalWindow({
  configuredWindow,
  isRequestedNextFrame,
}: {
  configuredWindow: number;
  isRequestedNextFrame: boolean;
}): number {
  return isRequestedNextFrame ? 1 : configuredWindow;
}

export function shouldPresentSpectrumFrameForRange({
  frameCenterHz,
  frameSampleRateHz,
  requestedRange,
  requiresExactRange,
  isTxPreviewFrame = false,
}: {
  frameCenterHz?: number | null;
  frameSampleRateHz?: number | null;
  requestedRange: { min: number; max: number };
  requiresExactRange: boolean;
  isTxPreviewFrame?: boolean;
}): boolean {
  if (!requiresExactRange) return true;
  // A v2 standby frame carries explicit presentation ownership. It is safe to
  // paint while the Tx slider/view range catches up; otherwise the FFT can go
  // blank even though the waterfall has already accepted the same frame.
  if (isTxPreviewFrame) return true;
  if (
    typeof frameCenterHz !== "number" ||
    !Number.isFinite(frameCenterHz) ||
    typeof frameSampleRateHz !== "number" ||
    !Number.isFinite(frameSampleRateHz) ||
    frameSampleRateHz <= 0
  ) {
    return false;
  }

  const requestedMinHz = requestedRange.min;
  const requestedMaxHz = requestedRange.max;
  const requestedSampleRateHz = requestedMaxHz - requestedMinHz;
  if (
    !Number.isFinite(requestedMinHz) ||
    !Number.isFinite(requestedMaxHz) ||
    requestedSampleRateHz <= 0
  ) {
    return false;
  }

  // A source may legally deliver a wider acquisition window than the current
  // viewport (for example HackRF's 4.372 MHz whole-channel frame while the UI
  // is still presenting a 3.2 MHz channel window). The frame is safe to paint
  // when its actual frequency coverage fully contains the requested viewport.
  // A one-hertz tolerance preserves the exact-match behavior for retunes while
  // avoiding false negatives from integer rounding at the window edges.
  const frameMinHz = frameCenterHz - frameSampleRateHz / 2;
  const frameMaxHz = frameCenterHz + frameSampleRateHz / 2;
  const rangeToleranceHz = 1;
  return (
    requestedSampleRateHz <= frameSampleRateHz + rangeToleranceHz &&
    requestedMinHz >= frameMinHz - rangeToleranceHz &&
    requestedMaxHz <= frameMaxHz + rangeToleranceHz
  );
}

/**
 * A live IQ frame owns the spectrum's frequency axis. Do not let an older
 * frame take ownership of the requested window while a hardware retune is in
 * flight; each frame is painted on the axis it reports.
 */
export const shouldAdoptLiveFrameRange = ({
  frameCenterHz,
  frameSampleRateHz,
  requestedRange,
  isTxPreviewFrame = false,
}: {
  frameCenterHz?: number | null;
  frameSampleRateHz?: number | null;
  requestedRange: { min: number; max: number };
  isTxPreviewFrame?: boolean;
}): boolean =>
  shouldPresentSpectrumFrameForRange({
    frameCenterHz,
    frameSampleRateHz,
    requestedRange,
    requiresExactRange: true,
    isTxPreviewFrame,
  });

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
  /**
   * False when the mirror is on and the current acquisition cannot fill the
   * viewport. The live renderer still paints immediately; the GPU resampler
   * handles uncovered bins at the noise floor on the frame's own axis.
   */
  coversDisplay: boolean;
}

export const resolveLiveSpectrumCoordinateModel = ({
  viewportBaseRange,
  sourceRange,
  zoom,
  panOffsetHz,
  mirrorEnabled,
}: {
  viewportBaseRange: { min: number; max: number };
  sourceRange: { min: number; max: number };
  zoom: number;
  panOffsetHz: number;
  mirrorEnabled: boolean;
}) => {
  const view = resolveGpuView({
    frequencyRange: viewportBaseRange,
    zoom,
    panOffset: panOffsetHz,
    allowNegativeFrequencies: mirrorEnabled,
  });
  return {
    sourceRange,
    displayRange: view.visualRange,
    clampedPan: view.clampedPan,
  };
};

export interface LiveSpectrumPaintContract {
  /** Pan/zoom axis — always the frame's CF ± fs/2. */
  paintViewportRange: { min: number; max: number };
  sourceFrequencyRange: { min: number; max: number };
  /** Absolute Hz the gesture is looking at. */
  displayRange: { min: number; max: number };
  zoom: number;
  panOffsetHz: number;
}

/**
 * FFTCanvas wiring: Redux pan is measured against a start-anchored request
 * while IQ bins are labeled by the live frame. Re-base pan/zoom onto the
 * acquisition axis before prepareSpectrumRenderData or the GPU |f| fold paints
 * a channel-sized island with floor on both sides.
 */
export const resolveLiveSpectrumPaintContract = ({
  requestedViewRange,
  sourceFrequencyRange,
  zoom,
  panOffsetHz,
  mirrorEnabled,
}: {
  requestedViewRange: { min: number; max: number };
  sourceFrequencyRange: { min: number; max: number };
  zoom: number;
  panOffsetHz: number;
  mirrorEnabled: boolean;
  frameCenterHz?: number | null;
  frameSampleRateHz?: number | null;
  isTxPreviewFrame?: boolean;
}): LiveSpectrumPaintContract => {
  // Non-finite inputs (fuzzed NaN/Infinity, corrupt Redux hydration) must
  // degrade to a safe finite fallback instead of pushing an infinite range
  // into the GPU pipeline and freezing the spectrum with no console trace.
  const safeSourceRange = {
    min: Number.isFinite(sourceFrequencyRange.min)
      ? sourceFrequencyRange.min
      : 0,
    max: Number.isFinite(sourceFrequencyRange.max)
      ? sourceFrequencyRange.max
      : 1,
  };
  if (!(safeSourceRange.max > safeSourceRange.min)) {
    safeSourceRange.max = safeSourceRange.min + 1;
  }
  const safeRequestedRange = {
    min: Number.isFinite(requestedViewRange.min) ? requestedViewRange.min : 0,
    max: Number.isFinite(requestedViewRange.max) ? requestedViewRange.max : 0,
  };
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const safePan = Number.isFinite(panOffsetHz) ? panOffsetHz : 0;
  const gestureView = resolveLiveSpectrumCoordinateModel({
    viewportBaseRange: safeRequestedRange,
    sourceRange: safeSourceRange,
    zoom: safeZoom,
    panOffsetHz: safePan,
    mirrorEnabled,
  });
  const requestedDisplaySpan =
    gestureView.displayRange.max - gestureView.displayRange.min;
  const sourceSpan = safeSourceRange.max - safeSourceRange.min;
  const mirrorGestureCovered = sourceCoversMirroredDisplay(
    safeSourceRange,
    gestureView.displayRange,
    mirrorPresentationCoverageSlackHz(safeSourceRange),
  );
  const residentMirrorRange =
    (gestureView.displayRange.min + gestureView.displayRange.max) / 2 < 0
      ? {
          min: -safeSourceRange.max,
          max: -safeSourceRange.min,
        }
      : safeSourceRange;
  // During cold start Redux can still expose a persisted whole-channel span
  // while the first live frame only covers the accepted sample-rate window.
  // Letting that wider range reach the GPU makes the frame occupy one island
  // inside a channel-sized viewport. The frame axis is the only complete row
  // available until the range state catches up, so keep the initial paint
  // source-sized. Normal zoom/pan requests have a span no wider than source.
  // Commit mirror presentation atomically with frame coverage. If the pending
  // gesture cannot be filled by this resident frame, present the complete
  // frame on the positive or reflected side nearest the requested center.
  const displayRange =
    Number.isFinite(requestedDisplaySpan) &&
    Number.isFinite(sourceSpan) &&
    sourceSpan > 0 &&
    requestedDisplaySpan > sourceSpan + 1
      ? mirrorEnabled
        ? residentMirrorRange
        : safeSourceRange
      : mirrorEnabled
        ? mirrorGestureCovered
          ? gestureView.displayRange
          : residentMirrorRange
        : gestureView.displayRange.min >= safeSourceRange.min &&
            gestureView.displayRange.max <= safeSourceRange.max
          ? gestureView.displayRange
          : safeSourceRange;
  // A retune request can move ahead of the latest server frame. Keep the
  // visual axis on that resident frame until a new acquisition arrives; this
  // avoids presenting a floor-filled gap that appears to animate toward the
  // requested VFO position.
  const rebased = resolvePanZoomForDisplayRange({
    hardwareRange: safeSourceRange,
    displayRange,
  });
  // Normalize the emitted ranges so they always satisfy max >= min (a fuzzed
  // negative sample rate can produce an inverted display range otherwise).
  const normalizedDisplayRange =
    displayRange.max >= displayRange.min
      ? displayRange
      : { min: displayRange.max, max: displayRange.min };
  return {
    paintViewportRange: safeSourceRange,
    sourceFrequencyRange: safeSourceRange,
    displayRange: normalizedDisplayRange,
    zoom: rebased.zoom,
    panOffsetHz: rebased.panOffsetHz,
  };
};

export const shouldClearSpectrumWaveformForRangeChange = ({
  isPaused: _isPaused,
}: {
  isPaused: boolean;
}) => false;

/**
 * Resolves only the geometry needed by the GPU mirror path.
 *
 * The GPU resampler consumes the complete source waveform, so asking the CPU
 * zoom processor for a sliced/padded copy here is redundant. Keep this math
 * equivalent to the zoom processor's mirrored range calculation without
 * touching the waveform data.
 */
const resolveGpuView = ({
  frequencyRange,
  zoom,
  panOffset,
  allowNegativeFrequencies,
}: {
  frequencyRange: { min: number; max: number };
  zoom: number;
  panOffset: number;
  allowNegativeFrequencies: boolean;
}): {
  visualRange: { min: number; max: number };
  clampedPan: number;
} => {
  const fullSpan = frequencyRange.max - frequencyRange.min;
  if (!Number.isFinite(fullSpan) || fullSpan <= 0) {
    return {
      visualRange: frequencyRange,
      clampedPan: 0,
    };
  }

  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const halfSpan = fullSpan / (2 * safeZoom);
  const center = (frequencyRange.min + frequencyRange.max) / 2;
  const clampedPan = allowNegativeFrequencies
    ? panOffset
    : Math.max(
        frequencyRange.min + halfSpan - center,
        Math.min(frequencyRange.max - halfSpan - center, panOffset),
      );
  const visualCenter = center + clampedPan;

  return {
    visualRange: {
      min: visualCenter - halfSpan,
      max: visualCenter + halfSpan,
    },
    clampedPan,
  };
};

/** Applies view-window selection and vertical inversion before renderer submission. */
export function prepareSpectrumRenderData({
  waveform,
  frequencyRange,
  sourceFrequencyRange,
  zoom,
  panOffset,
  invert,
  dbMin,
  dbMax,
  inversionBuffer,
  mirrorBuffer,
  allowNegativeFrequencies = false,
  mirrorOnGpu = false,
  resampleOnGpu = false,
  getZoomedData,
}: {
  waveform: Float32Array;
  frequencyRange: { min: number; max: number };
  sourceFrequencyRange?: { min: number; max: number };
  zoom: number;
  panOffset: number;
  invert: boolean;
  dbMin: number;
  dbMax: number;
  inversionBuffer?: Float32Array | null;
  mirrorBuffer?: Float32Array | null;
  allowNegativeFrequencies?: boolean;
  /** When true, skip CPU work; resample.wgsl owns negative display bands. */
  mirrorOnGpu?: boolean;
  /** When true, resample.wgsl owns ordinary live pan/zoom slicing too. */
  resampleOnGpu?: boolean;
  getZoomedData: (
    waveform: Float32Array,
    frequencyRange: { min: number; max: number },
    zoom: number,
    panOffset: number,
    allowNegativeFrequencies?: boolean,
  ) => {
    slicedWaveform: Float32Array;
    visualRange: { min: number; max: number };
    clampedPan: number;
  };
}): SpectrumRenderPreparation {
  const sourceRange = sourceFrequencyRange ?? frequencyRange;
  // Setting on ⇒ free pan math always (no positive-window clamp). Fold/extend
  // only arms once the viewport crosses below 0 Hz. Gating pan freedom on
  // "is below 0" was what froze the spectrum while EditableCenterFrequency
  // still updated Redux: every paint rewrote vizPan back into the acquisition.
  const freePan = allowNegativeFrequencies;
  const gpuView = resampleOnGpu || freePan
    ? resolveGpuView({
        frequencyRange,
        zoom,
        panOffset,
        allowNegativeFrequencies: freePan,
      })
    : null;
  // With the setting enabled, WebGPU owns viewport resampling for every pan
  // position. The shader only folds |f| for negative display coordinates, but
  // retaining the original acquisition here avoids CPU slicing and allocation
  // on the positive side too.
  const useGpuViewport =
    gpuView !== null && !invert && (resampleOnGpu || mirrorOnGpu);

  const { slicedWaveform, visualRange, clampedPan } = useGpuViewport
    ? {
        // Full source for the shader; it folds |f| and floors uncovered bins.
        slicedWaveform: waveform,
        visualRange: gpuView!.visualRange,
        clampedPan: gpuView!.clampedPan,
      }
    : getZoomedData(
        waveform,
        frequencyRange,
        zoom,
        panOffset,
        freePan,
      );
  const coversDisplay = sourceCoversMirroredDisplay(
    sourceRange,
    visualRange,
  );

  let displayWaveform = slicedWaveform;
  if (useGpuViewport) {
    displayWaveform = waveform;
  } else if (freePan) {
    // Frequency-space resample for the whole row (positive and negative) so
    // zoom seams stay consistent in snapshot/CPU rendering. The live WebGPU
    // path returns above and never performs this O(FFT size) pass.
    displayWaveform = extendSpectrumBelowZero({
      spectrum: waveform,
      sourceRange,
      displayRange: visualRange,
      outputLength: slicedWaveform.length,
      floorDb: dbMin,
      target: mirrorBuffer ?? undefined,
    });
  }

  return {
    slicedWaveform: displayWaveform,
    visualRange,
    clampedPan,
    coversDisplay,
    spectrumWaveform:
      invert && !useGpuViewport
        ? invertSpectrumVertically(
            displayWaveform,
            dbMin,
            dbMax,
            inversionBuffer ?? undefined,
          )
        : displayWaveform,
  };
}

/**
 * The newest `fftSize` complex samples of a live I/Q payload.
 *
 * A live frame carries every sample captured since the previous frame so audio
 * demodulation has an unbroken timeline, which can be more than one FFT worth.
 * The display wants the most recent window instead of the oldest, otherwise the
 * spectrum and waterfall lag the stream by the length of the surplus.
 */
export function newestIqWindow(
  iqData: Uint8Array,
  fftSize: number,
): Uint8Array {
  if (!Number.isFinite(fftSize) || fftSize <= 0) return iqData;
  const bytesNeeded = fftSize * 2;
  if (iqData.length <= bytesNeeded) return iqData;
  // Start on an even index so I and Q never swap, then take exactly
  // `bytesNeeded` bytes so a whole (non-straddling) FFT window is returned.
  // Aligning only the start can otherwise yield bytesNeeded + 1 bytes when the
  // input minus the window length is odd.
  const start = (iqData.length - bytesNeeded) & ~1;
  return iqData.subarray(start, start + bytesNeeded);
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
