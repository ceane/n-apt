import {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
  memo,
  Suspense,
} from "react";
import styled from "styled-components";
import { useFFTAnimation } from "@n-apt/hooks/useFFTAnimation";
import { usePauseLogic } from "@n-apt/hooks/usePauseLogic";
import { useSpectrumRenderer } from "@n-apt/hooks/useSpectrumRenderer";
import { useUnifiedFFTWaterfall } from "@n-apt/hooks/useUnifiedFFTWaterfall";
import { RESAMPLE_WGSL } from "@n-apt/shaders";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/hooks/useDrawWebGPUFIFOWaterfall";
import { useFrequencyDrag } from "@n-apt/hooks/useFrequencyDrag";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import { useWasmSimdMath } from "@n-apt/hooks/useWasmSimdMath";
import { useAppSelector } from "@n-apt/redux";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import type { DeviceProfile } from "@n-apt/consts/schemas/websocket";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import type { FrequencyRange } from "@n-apt/consts/types";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";
// New hooks
import { useCanvasState } from "@n-apt/hooks/useCanvasState";
import { useWaterfallBufferPool } from "@n-apt/hooks/useWaterfallBufferPool";
// spectrumToAmplitude removed — dB normalisation now handled in the waterfall WGSL shader
import {
  VISUALIZER_GAP,
  SECTION_TITLE_COLOR,
  SECTION_TITLE_AFTER_COLOR,
  FFT_MIN_DB,
  FFT_MAX_DB,
} from "@n-apt/consts";
import { detectHeterodyningFromHistory } from "@n-apt/utils/detectHeterodyning";
import type {
  FFTVisualizerMachine,
  FFTVisualizerSnapshot,
} from "@n-apt/utils/fftVisualizerMachine";
import {
  resolvePendingWaterfallRestore,
  type PendingWaterfallRestore,
} from "@n-apt/utils/waterfallRestore";
import { getWaterfallMotion } from "@n-apt/utils/waterfallMotion";

// Use dynamic import for WASM module loading
(async () => {
  try {
    const wasmModule = await import("n_apt_canvas");
    const initWasm = wasmModule.default;
    const test_wasm_simd_availability = wasmModule.test_wasm_simd_availability;

    // Initialize the WASM module first
    await initWasm();

    // Test WASM SIMD availability
    if (test_wasm_simd_availability) {
      test_wasm_simd_availability();

      // Expose globally for manual testing
      (window as any).testWasmSimd = test_wasm_simd_availability;
    }

    // sdrProcessor = new SIMDRenderingProcessor(); // Removed as sdrProcessor is unused
  } catch {
    // Silently handle WASM loading errors
  }
})();


const VisualizerContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: row;
  background-color: ${(props) => props.theme.background};
  position: relative;
  overflow: hidden;
`;

const VisualizerContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: ${VISUALIZER_GAP}px;
  min-height: 0;
`;


const SpectrumSection = styled.div`
  flex: 2;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${SECTION_TITLE_COLOR};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: "/";
    color: ${SECTION_TITLE_AFTER_COLOR};
  }
`;

const CanvasWrapper = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid ${(props) => props.theme.canvasBorder};
  border-radius: 8px;
  overflow: hidden;
  background-color: ${(props) => props.theme.background};
`;

const SpectrumRow = styled.div`
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
`;

const CanvasLayer = styled.canvas`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  will-change: width, height;
`;

const HighlightOverlay = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

const HighlightBand = styled.div<{ $left: number; $width: number; $waterfall?: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${({ $left }) => `${$left}%`};
  width: ${({ $width }) => `${$width}%`};
  background: ${({ $waterfall }) =>
    $waterfall ? "rgba(255, 206, 84, 0.18)" : "rgba(255, 206, 84, 0.12)"};
  box-shadow: inset 0 0 0 1px rgba(255, 206, 84, 0.7);
`;

const LOADING_PLACEHOLDER_TEXT = "Loading data from source...";
const LOADING_PLACEHOLDER_FONT = "24px 'JetBrains Mono', monospace";
const WATERFALL_PLACEHOLDER_FONT = "20px 'JetBrains Mono', monospace";
const LOADING_PLACEHOLDER_COLOR = "#888888";
const MIN_FFT_DB_SPAN = 5;

const DB_MAX_RANGE: Record<"dB" | "dBm", { min: number; max: number }> = {
  dB: { min: FFT_MIN_DB, max: FFT_MAX_DB },
  dBm: { min: -100, max: 30 },
};

const DB_MIN_RANGE: Record<"dB" | "dBm", { min: number; max: number }> = {
  dB: { min: FFT_MIN_DB, max: -10 },
  dBm: { min: -120, max: -10 },
};

const clampDbMaxValue = (value: number, scale: "dB" | "dBm") => {
  const bounds = DB_MAX_RANGE[scale];
  return Math.min(Math.max(value, bounds.min), bounds.max);
};

const clampDbMinValue = (value: number, scale: "dB" | "dBm") => {
  const bounds = DB_MIN_RANGE[scale];
  return Math.min(Math.max(value, bounds.min), bounds.max);
};

const ensureValidDbRange = (
  minVal: number,
  maxVal: number,
  scale: "dB" | "dBm",
) => {
  let nextMin = clampDbMinValue(minVal, scale);
  let nextMax = clampDbMaxValue(maxVal, scale);

  if (nextMax - nextMin < MIN_FFT_DB_SPAN) {
    nextMax = clampDbMaxValue(nextMin + MIN_FFT_DB_SPAN, scale);
    if (nextMax - nextMin < MIN_FFT_DB_SPAN) {
      nextMin = clampDbMinValue(nextMax - MIN_FFT_DB_SPAN, scale);
    }
  }

  return { min: nextMin, max: nextMax };
};

const toUnifiedWindowType = (
  windowType?: string,
): "rectangular" | "hanning" | "hamming" | "blackman" | "nuttall" => {
  switch ((windowType ?? "Rectangular").toLowerCase()) {
    case "rectangular":
    case "none":
      return "rectangular";
    case "hann":
    case "hanning":
      return "hanning";
    case "hamming":
      return "hamming";
    case "blackman":
      return "blackman";
    case "nuttall":
      return "nuttall";
    default:
      return "rectangular";
  }
};

/**
 * Props for FFTCanvas component
 */
export interface FFTCanvasProps {
  /** Reference to FFT data containing waveform and metadata */
  dataRef: React.MutableRefObject<any>;
  /** Frequency range to display */
  frequencyRange: FrequencyRange;
  /** Current center frequency in MHz (for overlay label) */
  centerFrequencyMHz: number;
  /** Currently active signal area identifier */
  activeSignalArea: string;
  /** Signal area bounds for VFO drag clamping */
  signalAreaBounds?: Record<string, { min: number; max: number }>;
  /** Whether the visualization is paused */
  isPaused: boolean;
  /** Target frame rate for the visualization */
  fftFrameRate?: number;
  fftSize?: number;
  fftWindow?: string;
  powerScale?: "dB" | "dBm";
  /** Whether the RTL-SDR device is connected */
  isDeviceConnected?: boolean;
  /** Callback for frequency range changes */
  onFrequencyRangeChange?: (range: FrequencyRange) => void;
  displayTemporalResolution?: "low" | "medium" | "high";
  /** Callback to trigger a snapshot render for the sidebar */
  onSnapshot?: (data: {
    waveform: Float32Array;
    frequencyRange: FrequencyRange;
    dbMin: number;
    dbMax: number;
    centerFrequencyMHz: number;
    isDeviceConnected: boolean;
    vizZoom: number;
    vizPanOffset: number;
    grid: boolean;
  }) => void;
  /** Grid preference for snapshot rendering (affects 2D shadow canvases) */
  snapshotGridPreference: boolean;
  /** Whether to hide title and use compact layout (for node integration) */
  compact?: boolean;
  showSpikeOverlay?: boolean;
  vizZoom?: number;
  vizPanOffset?: number;
  onVizZoomChange?: (zoom: number) => void;
  onVizPanChange?: (pan: number) => void;
  fftMin?: number;
  fftMax?: number;
  onFftDbLimitsChange?: (min: number, max: number) => void;
  /** Function to request auto FFT options from server */
  sendGetAutoFftOptions?: (screenWidth: number) => void;
  /** Auto FFT options from server/cache */
  autoFftOptions?: {
    type: "auto_fft_options";
    autoSizes: number[];
    recommended: number;
  } | null;
  hardwareSampleRateHz?: number;
  deviceProfile?: DeviceProfile | null;
  tunerGainDb?: number;
  /** Whether I/Q recording is active */
  isIqRecordingActive?: boolean;
  limitMarkers?: SdrLimitMarker[];
  isWaterfallCleared?: boolean;
  onResetWaterfallCleared?: () => void;
  heterodyningVerifyRequestId?: number;
  heterodyningHighlightedBins?: Array<{ start: number; end: number }>;
  onHeterodyningAnalyzed?: (result: {
    detected: boolean;
    confidence: number | null;
    statusText: string;
    highlightedBins: Array<{ start: number; end: number }>;
  }) => void;
  awaitingDeviceData?: boolean;
  visualizerMachine?: FFTVisualizerMachine;
  visualizerSessionKey?: string;
  waterfallCanvasBindings?: FFTCanvasWaterfallBindings;
}

export interface FFTCanvasWaterfallBindings {
  waterfallGpuCanvasNode: HTMLCanvasElement | null;
  waterfallOverlayCanvasNode: HTMLCanvasElement | null;
  setWaterfallGpuCanvasNode: (node: HTMLCanvasElement | null) => void;
  setWaterfallOverlayCanvasNode: (node: HTMLCanvasElement | null) => void;
}

/**
 * FFT canvas component with FFT spectrum and waterfall displays
 * Uses SDR++ style rendering for professional spectrum analysis
 */
export type SnapshotData = {
  waveform: Float32Array | null;
  fullChannelWaveform: Float32Array | null;
  frequencyRange: FrequencyRange;
  dbMin: number;
  dbMax: number;
  fftSize?: number;
  fftWindow?: string;
  centerFrequencyMHz: number;
  isDeviceConnected: boolean;
  vizZoom: number;
  vizPanOffset: number;
  waterfallTextureSnapshot: Uint8Array | null;
  waterfallTextureMeta: {
    width: number;
    height: number;
    writeRow: number;
  } | null;
  waterfallBuffer: Uint8ClampedArray | null;
  waterfallDims: { width: number; height: number } | null;
  webgpuEnabled: boolean;
  hardwareSampleRateHz?: number;
  isIqRecordingActive?: boolean;
  colormap: number[][];
};

export type FFTCanvasHandle = {
  getSpectrumCanvas: () => HTMLCanvasElement | null;
  getWaterfallCanvas: () => HTMLCanvasElement | null;
  triggerSnapshotRender: () => void;
  getSnapshotData: () => SnapshotData | null;
  getCompositeSnapshot: () => { dataUrl: string; width: number; height: number } | null;
};

const FFTCanvas = memo(
  forwardRef<FFTCanvasHandle, FFTCanvasProps>((props, ref) => {
    const {
      dataRef,
      frequencyRange,
      centerFrequencyMHz,
      activeSignalArea: _activeSignalArea,
      signalAreaBounds,
      isPaused,
      fftFrameRate,
      fftSize,
      fftWindow,
      powerScale,
      isDeviceConnected = true,
      onFrequencyRangeChange,
      displayTemporalResolution = "medium",
      onSnapshot: _onSnapshot,
      snapshotGridPreference,
      showSpikeOverlay = false,
      vizZoom = 1,
      vizPanOffset = 0,
      onVizZoomChange,
      onVizPanChange,
      fftMin,
      fftMax,
      onFftDbLimitsChange,
      sendGetAutoFftOptions,
      autoFftOptions,
      hardwareSampleRateHz,
      isIqRecordingActive = false,
      limitMarkers = [],
      isWaterfallCleared = false,
      onResetWaterfallCleared,
      heterodyningVerifyRequestId = 0,
      heterodyningHighlightedBins = [],
      onHeterodyningAnalyzed,
      awaitingDeviceData = false,
      visualizerMachine,
      visualizerSessionKey = "default",
      waterfallCanvasBindings,
      compact = false,
    } = props;
    const fftColor = useAppSelector((reduxState) => reduxState.theme.fftColor);
    const waterfallTheme = useAppSelector((reduxState) => reduxState.theme.waterfallTheme);
    const fillColor = useMemo(() => {
      if (fftColor.startsWith("#")) {
        return `${fftColor}33`; // 20% opacity
      }
      return fftColor;
    }, [fftColor]);

    const colormap = useMemo(() => WATERFALL_COLORMAPS[waterfallTheme], [waterfallTheme]);

    // Use new hooks for state management
    const canvasState = useCanvasState(waterfallCanvasBindings);
    const {
      spectrumGpuCanvasNode,
      setSpectrumGpuCanvasNode,
      setSpectrumOverlayCanvasNode: _setSpectrumOverlayCanvasNode,
      waterfallGpuCanvasNode,
      setWaterfallGpuCanvasNode: _setWaterfallGpuCanvasNode,
      setWaterfallOverlayCanvasNode: _setWaterfallOverlayCanvasNode,
      spectrumGpuCanvasRef,
      spectrumOverlayCanvasRef,
      waterfallGpuCanvasRef,
      waterfallOverlayCanvasRef,
      spectrumContainerRef,
    } = canvasState;

    // Sync state to refs (this is now handled inside useCanvasState hook)

    const lastRenderedPowerScaleRef = useRef<"dB" | "dBm" | null>(null);
    const lastIncomingFrameRef = useRef<LiveFrameData | null>(null);
    const liveGpuProcessInFlightRef = useRef(false);

    const {
      waterfallBufferRef,
      waterfallDataWidthRef,
      getBufferFromPool,
      returnBufferToPool,
    } = useWaterfallBufferPool();

    const waterfallCappedBufferRef = useRef<Float32Array | null>(null);

    // Track canvas dimensions for cache management
    const spectrumWidthRef = useRef<number>(0);
    const spectrumHeightRef = useRef<number>(0);

    const clearOverlayCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, []);

    const drawLoadingPlaceholder = useCallback(
      (canvas: HTMLCanvasElement | null, fontOverride?: string) => {
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const dpr = window.devicePixelRatio || 1;
        const logicalWidth = canvas.width / dpr;
        const logicalHeight = canvas.height / dpr;
        ctx.save();
        ctx.font = fontOverride ?? LOADING_PLACEHOLDER_FONT;
        ctx.fillStyle = LOADING_PLACEHOLDER_COLOR;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          LOADING_PLACEHOLDER_TEXT,
          logicalWidth / 2,
          logicalHeight / 2,
        );
        ctx.restore();
      },
      [],
    );

    const lastWaterfallRowRef = useRef<Float32Array | null>(null);
    const pausedWaterfallRowRef = useRef<Float32Array | null>(null);
    const waterfallTextureSnapshotRef = useRef<Uint8Array | null>(null);
    const waterfallTextureMetaRef = useRef<{
      width: number;
      height: number;
      writeRow: number;
    } | null>(null);
    const heterodyningHistoryRef = useRef<Float32Array[]>([]);
    const lastHeterodyningRequestIdRef = useRef(0);
    const pendingWaterfallRestoreRef = useRef<PendingWaterfallRestore | null>(
      null,
    );
    const restoredWaterfallRef = useRef(false);

    // Simplified frame management
    const frameBufferRef = useRef<Float32Array[]>([]);
    const maxFrameBufferSize = 1;
    const lastProcessedDataRef = useRef<any>(null);
    const frequencyRangeRef = useRef<FrequencyRange>(frequencyRange);
    const centerFreqRef = useRef(centerFrequencyMHz);
    centerFreqRef.current = centerFrequencyMHz;

    const retuneSmearRef = useRef(0);
    const retuneDriftPxRef = useRef(0);
    const lastWaterfallVisualRangeRef = useRef<FrequencyRange | null>(null);

    const effectivePowerScale = powerScale ?? "dB";
    const baseDbMin = Number.isFinite(fftMin) ? (fftMin as number) : FFT_MIN_DB;
    const baseDbMax = Number.isFinite(fftMax) ? (fftMax as number) : FFT_MAX_DB;
    const validatedDbRange = useMemo(
      () => ensureValidDbRange(baseDbMin, baseDbMax, effectivePowerScale),
      [baseDbMin, baseDbMax, effectivePowerScale],
    );
    const vizDbMin = validatedDbRange.min;
    const vizDbMax = validatedDbRange.max;

    const applyDbLimits = useCallback(
      (minValue: number, maxValue: number) => {
        if (!onFftDbLimitsChange) return;
        const next = ensureValidDbRange(minValue, maxValue, effectivePowerScale);
        onFftDbLimitsChange(next.min, next.max);
      },
      [onFftDbLimitsChange, effectivePowerScale],
    );

    useEffect(() => {
      if (!onFftDbLimitsChange) return;
      const normalized = { min: vizDbMin, max: vizDbMax };
      const lastEmitted = lastEmittedDbLimitsRef.current;
      const shouldEmit =
        baseDbMin !== normalized.min ||
        baseDbMax !== normalized.max;

      if (
        shouldEmit &&
        (!lastEmitted ||
          lastEmitted.min !== normalized.min ||
          lastEmitted.max !== normalized.max)
      ) {
        lastEmittedDbLimitsRef.current = normalized;
        onFftDbLimitsChange(vizDbMin, vizDbMax);
      }
    }, [baseDbMin, baseDbMax, vizDbMin, vizDbMax, onFftDbLimitsChange]);

    const currentVizZoom = vizZoom ?? 1;

    const fftAvgEnabled = useAppSelector((reduxState) => reduxState.spectrum.fftAvgEnabled);
    const fftSmoothEnabled = useAppSelector((reduxState) => reduxState.spectrum.fftSmoothEnabled);
    const wfSmoothEnabled = useAppSelector((reduxState) => reduxState.spectrum.wfSmoothEnabled);

    // Clear waterfall effect
    useEffect(() => {
      if (isWaterfallCleared) {
        visualizerMachine?.clear(visualizerSessionKey);
        waterfallBufferRef.current = null;
        waterfallTextureSnapshotRef.current = null;
        waterfallTextureMetaRef.current = null;
        lastWaterfallRowRef.current = null;
        pausedWaterfallRowRef.current = null;
        pendingWaterfallRestoreRef.current = null;
        restoredWaterfallRef.current = false;
        heterodyningHistoryRef.current = [];
        onResetWaterfallCleared?.();
      }
    }, [
      isWaterfallCleared,
      onResetWaterfallCleared,
      visualizerMachine,
      visualizerSessionKey,
    ]);
    const fftProcessedBufferRef = useRef<Float32Array | null>(null);
    const spikePersistenceRef = useRef<Float32Array | null>(null);

    const setVizZoom = useCallback(
      (val: number | ((prev: number) => number)) => {
        const newZoom = typeof val === "function" ? val(currentVizZoom) : val;
        if (onVizZoomChange) {
          onVizZoomChange(newZoom);
        }
      },
      [onVizZoomChange, currentVizZoom],
    );

    const setVizPanOffset = useCallback(
      (val: number | ((prev: number) => number)) => {
        if (onVizPanChange) {
          onVizPanChange(typeof val === "function" ? val(vizPanOffset) : val);
        }
      },
      [onVizPanChange, vizPanOffset],
    );

    const vizZoomRef = useRef(currentVizZoom);
    const vizDbMaxRef = useRef(vizDbMax);
    const vizDbMinRef = useRef(vizDbMin);
    const vizPanOffsetRef = useRef(vizPanOffset);
    const previousPowerScaleRef = useRef(effectivePowerScale);
    const lastEmittedDbLimitsRef = useRef<{ min: number; max: number } | null>(null);
    vizZoomRef.current = currentVizZoom;
    vizDbMaxRef.current = vizDbMax;
    vizDbMinRef.current = vizDbMin;
    vizPanOffsetRef.current = vizPanOffset;

    // Compute zoomed visual frequency range and waveform slice
    const getZoomedData = useCallback(
      (
        fullWaveform: Float32Array,
        fullRange: FrequencyRange,
        zoom: number,
        panOffset: number,
      ): {
        slicedWaveform: Float32Array;
        visualRange: FrequencyRange;
        clampedPan: number;
      } => {
        if (zoom === 1) {
          return {
            slicedWaveform: fullWaveform,
            visualRange: fullRange,
            clampedPan: 0,
          };
        }

        const totalBins = fullWaveform.length;
        const visibleBins = Math.max(1, Math.floor(totalBins / zoom));

        const fullSpan = fullRange.max - fullRange.min;
        const halfSpan = fullSpan / (2 * zoom);

        // Calculate max allowed pan so visual window doesn't exceed hardware window
        const maxPan = fullSpan / 2 - halfSpan;
        let clampedPan = panOffset;
        if (maxPan >= 0) {
          clampedPan = Math.max(-maxPan, Math.min(maxPan, panOffset));
        } else {
          const outPan = -maxPan;
          clampedPan = Math.max(-outPan, Math.min(outPan, panOffset));
        }

        const centerFreq = (fullRange.min + fullRange.max) / 2;
        const visualCenter = centerFreq + clampedPan;

        // Convert visual center to bin index
        const visualCenterBin = Math.round(
          ((visualCenter - fullRange.min) / fullSpan) * totalBins,
        );

        let startBin = Math.round(visualCenterBin - visibleBins / 2);

        const visualRange = {
          min: visualCenter - halfSpan,
          max: visualCenter + halfSpan,
        };

        if (zoom < 1) {
          const paddedWaveform = new Float32Array(visibleBins).fill(FFT_MIN_DB);
          const destOffset = Math.max(0, -startBin);
          const dataToCopy = Math.min(totalBins, visibleBins - destOffset);
          const srcOffset = Math.max(0, startBin);

          if (dataToCopy > 0) {
            paddedWaveform.set(
              fullWaveform.subarray(srcOffset, srcOffset + dataToCopy),
              destOffset,
            );
          }
          return { slicedWaveform: paddedWaveform, visualRange, clampedPan };
        }

        // Clamp startBin to valid array bounds for zoom > 1
        startBin = Math.max(0, Math.min(totalBins - visibleBins, startBin));

        const slicedWaveform = fullWaveform.subarray(
          startBin,
          startBin + visibleBins,
        );

        return { slicedWaveform, visualRange, clampedPan };
      },
      [],
    );

    // Ref to track snapshot grid preference (for 2D shadow renders)
    const snapshotGridPreferenceRef = useRef(true);

    // Update ref when prop changes
    useEffect(() => {
      snapshotGridPreferenceRef.current = snapshotGridPreference;
    }, [snapshotGridPreference]);
    const waveformFloatRef = useRef<Float32Array | null>(null);
    const renderWaveformRef = useRef<Float32Array | null>(null);
    const FULL_CHANNEL_BINS = 4096;
    const fullChannelWaveformRef = useRef<Float32Array | null>(null);
    const fullChannelRangeRef = useRef<FrequencyRange | null>(null);
    const waterfallDimsRef = useRef<{ width: number; height: number } | null>(
      null,
    );
    const waterfallGpuDimsRef = useRef<{
      width: number;
      height: number;
    } | null>(null);

    // Simplified WebGPU references
    const resampleComputePipelineRef = useRef<GPUComputePipeline | null>(null);
    const resampleParamsBufferRef = useRef<GPUBuffer | null>(null);
    const gpuBufferPoolRef = useRef<GPUBuffer[]>([]);

    const {
      webgpuEnabled,
      isInitializingWebGPU,
      webgpuDeviceRef,
      webgpuFormatRef,
      gridOverlayRendererRef,
      markersOverlayRendererRef,
      spikesOverlayRendererRef,
      overlayDirtyRef,
    } = useWebGPUInit({
      spectrumGpuCanvasRef,
      waterfallGpuCanvasRef,
      resampleWgsl: RESAMPLE_WGSL,
      resampleComputePipelineRef,
      resampleParamsBufferRef,
      gpuBufferPoolRef,
    });
    const spectrumWebgpuEnabled = webgpuEnabled;
    const effectiveFftSize = fftSize ?? 32768;
    const activeScaleDbMin = vizDbMin;
    const activeScaleDbMax = vizDbMax;
    const gpuProcessingDevice = webgpuDeviceRef.current;

    const { processUnified } = useUnifiedFFTWaterfall({
      device: webgpuDeviceRef.current ?? null,
      fftSize: effectiveFftSize,
      waterfallHeight: 1,
      windowType: toUnifiedWindowType(fftWindow),
      enableAveraging: false,
      enableSmoothing: false,
    });

    // Compute zoomed frequency range from the full range (visual only, don't retune)
    useEffect(() => {
      // Frequency range changes affect both overlays
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      // Sync internal refs used by drag/render logic
      frequencyRangeRef.current = frequencyRange;
    }, [frequencyRange, overlayDirtyRef]);

    useEffect(() => {
      // Center frequency changes only affect marker overlay.
      overlayDirtyRef.current.markers = true;
      centerFreqRef.current = centerFrequencyMHz;
    }, [centerFrequencyMHz, overlayDirtyRef]);

    useEffect(() => {
      // Device connectivity toggles whether red limit lines should display.
      overlayDirtyRef.current.markers = true;
    }, [isDeviceConnected]);

    useEffect(() => {
      // Recording state change should trigger grid redraw
      overlayDirtyRef.current.grid = true;
    }, [isIqRecordingActive, hardwareSampleRateHz]);

    // Screen width detection for auto FFT options
    useEffect(() => {
      if (sendGetAutoFftOptions && !autoFftOptions) {
        const detectScreenWidth = () => {
          const cssWidth =
            window.innerWidth ||
            document.documentElement.clientWidth ||
            document.body.clientWidth;
          const dpr = window.devicePixelRatio || 1;
          sendGetAutoFftOptions(Math.round(cssWidth * dpr));
        };

        // Initial detection
        detectScreenWidth();

        // Listen for resize events (with debouncing)
        let resizeTimeout: NodeJS.Timeout;
        const handleResize = () => {
          clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(detectScreenWidth, 500);
        };

        window.addEventListener("resize", handleResize);

        return () => {
          window.removeEventListener("resize", handleResize);
          clearTimeout(resizeTimeout);
        };
      }
    }, [sendGetAutoFftOptions, autoFftOptions]);

    useFrequencyDrag({
      spectrumGpuCanvasRef,
      spectrumGpuCanvasNode,
      spectrumContainerRef,
      frequencyRangeRef,
      spectrumWebgpuEnabled,
      activeSignalArea: _activeSignalArea,
      signalAreaBounds,
      onFrequencyRangeChange,
      vizZoomRef,
      vizPanOffsetRef,
      onVizPanChange: (pan: number) => {
        setVizPanOffset(pan);
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;
        if (isPaused) forceRender();
      },
      vizDbMinRef,
      vizDbMaxRef,
      onFftDbLimitsChange: applyDbLimits,
      onVizZoomChange: setVizZoom,
      renderWaveformRef,
    });

    // Initialize WASM SIMD for optimized data processing
    const {
      processIqToDbmSpectrum,
      detectProminentSpikes,
    } = useWasmSimdMath({
      fftSize: 4096,
      enableSimd: true,
      fallbackToScalar: true,
    });

    // Use the unified spectrum renderer (WebGPU + Canvas2D fallback)
    const { drawSpectrum, cleanup: cleanupSpectrum } = useSpectrumRenderer();
    const { drawWebGPUFIFOWaterfall } = useDrawWebGPUFIFOWaterfall();

    // Simplified renderer initialization

    // Redundant overlay logic removed (now handled by useSpectrumRenderer)

    const restoreWaveformFromStorageRef = useRef<() => void>(() => {
      // When paused and no current IQ data, try to reprocess from last valid frame
      // using the CPU path (authoritative spectrum source).
      const lastData = lastProcessedDataRef.current;
      if (
        lastData?.iq_data &&
        lastData.iq_data.length >= 2
      ) {
        const isDbm = effectivePowerScale === "dBm";
        const restored = processIqToDbmSpectrum(
          lastData.iq_data,
          isDbm ? 30.0 : 0.0,
          effectiveFftSize,
          fftWindow,
        );
        if (restored.length > 0) {
          renderWaveformRef.current = new Float32Array(restored);
          return;
        }
      }

      // If no previous data, create a fallback waveform
      const fallbackWaveform = new Float32Array(1024).fill(FFT_MIN_DB);
      renderWaveformRef.current = fallbackWaveform;
    });

    /**
     * Animation loop for continuous spectrum and waterfall updates
     * While paused: keep rendering the last cached waveform without ingesting new data.
     *
     * NOTE: React's dev profiling creates PerformanceMeasure objects that leak memory.
     * WebGPU state changes also trigger performance measurements. Clear them each frame
     * to prevent memory ballooning (was reaching 40GB+ without this).
     */
    const onRenderFrame = useCallback(
      (_runId: number) => {
        performance.clearMeasures();
        const spectrumGpuCanvas = spectrumGpuCanvasRef.current;
        const waterfallGpuCanvas = waterfallGpuCanvasRef.current;
        const spectrumOverlayCanvas = spectrumOverlayCanvasRef.current;
        const waterfallOverlayCanvas = waterfallOverlayCanvasRef.current;

        const currentData = dataRef.current;

        const hasRenderableWaveform = !!(
          renderWaveformRef.current &&
          renderWaveformRef.current.length > 0
        );
        const hasIncomingData = !!(
          currentData &&
          (currentData.iq_data?.length ?? 0) > 0
        );
        const showLoadingPlaceholder = awaitingDeviceData &&
          !hasRenderableWaveform &&
          !hasIncomingData &&
          !(isPaused && pendingWaterfallRestoreRef.current);

        if (showLoadingPlaceholder) {
          drawLoadingPlaceholder(spectrumOverlayCanvas);
          drawLoadingPlaceholder(waterfallOverlayCanvas, WATERFALL_PLACEHOLDER_FONT);
          return;
        }

        clearOverlayCanvas(spectrumOverlayCanvas);
        clearOverlayCanvas(waterfallOverlayCanvas);

        const powerScale = effectivePowerScale;
        const isDbmMode = powerScale === "dBm";
        const powerScaleChanged = lastRenderedPowerScaleRef.current !== powerScale;
        const hasNewData = !isPaused && currentData && currentData !== lastProcessedDataRef.current &&
          !!currentData.iq_data;
        const shouldReprocessCurrentFrame = !!(
          currentData &&
          (currentData === lastProcessedDataRef.current || isPaused) &&
          powerScaleChanged &&
          !!currentData.iq_data
        );

        if (hasNewData || shouldReprocessCurrentFrame) {
          // Unified IQ→spectrum path: all live data is iq_data (Uint8Array).
          // The only variable is the dB offset for the power scale.
          const iqBytes = currentData?.iq_data;
          if (!iqBytes || iqBytes.length < 2) return;

          if (gpuProcessingDevice && webgpuEnabled && !isInitializingWebGPU) {
            if (!liveGpuProcessInFlightRef.current) {
              liveGpuProcessInFlightRef.current = true;
              const currentFrame = currentData;
              const liveChunkSize = effectiveFftSize * 2;
              const liveIqChunk =
                iqBytes.length > liveChunkSize
                  ? iqBytes.subarray(0, liveChunkSize)
                  : iqBytes;
              // GPU unified path: drives the waterfall texture only.
              // Do NOT write spectrumData back to waveformFloatRef — the CPU
              // processIqToDbmSpectrum path below is the authoritative spectrum
              // source and uses a different normalization / FFT implementation.
              // Letting the async GPU result overwrite the CPU result causes
              // dB mode to draw with dBm-shaped values (race condition).
              void processUnified(liveIqChunk, {
                inputMode: "complex_iq",
                powerMode: isDbmMode ? "dbm" : "db",
                minDb: activeScaleDbMin,
                maxDb: activeScaleDbMax,
                hardwareSampleRateHz: currentFrame.sample_rate,
                centerFrequencyHz: currentFrame.center_frequency_hz,
              })
                .finally(() => {
                  liveGpuProcessInFlightRef.current = false;
                })
                .catch(() => {
                  liveGpuProcessInFlightRef.current = false;
                });
            }
          }

          let waveform: Float32Array;

          const offsetDb = isDbmMode ? 30.0 : 0.0;
          const rawSpectrum = processIqToDbmSpectrum(
            iqBytes,
            offsetDb,
            effectiveFftSize,
            fftWindow,
          );
          const cpuSpectrum = new Float32Array(rawSpectrum.length);

          const minClamp = activeScaleDbMin;
          const maxClamp = activeScaleDbMax;

          for (let i = 0; i < rawSpectrum.length; i++) {
            cpuSpectrum[i] = Math.min(maxClamp, Math.max(minClamp, rawSpectrum[i]));
          }
          waveform = cpuSpectrum;

          // Validate waveform before processing
          if (waveform && waveform.length > 0) {
            waveformFloatRef.current = waveform;
            lastProcessedDataRef.current = currentData;
            lastRenderedPowerScaleRef.current = effectivePowerScale;

            // Accumulate into full-channel composite buffer for Whole Channel snapshots
            {
              const channelRange = frequencyRangeRef.current;
              const channelSpan = channelRange.max - channelRange.min;
              const hopCenterHz = currentData.center_frequency_hz;
              const hopSampleRate = currentData.sample_rate;
              if (
                channelSpan > 0 &&
                typeof hopCenterHz === "number" && hopCenterHz > 0 &&
                typeof hopSampleRate === "number" && hopSampleRate > 0
              ) {
                const hopCenterMHz = hopCenterHz / 1_000_000;
                const hopSpanMHz = hopSampleRate / 1_000_000;
                const hopMin = hopCenterMHz - hopSpanMHz / 2;
                const hopMax = hopCenterMHz + hopSpanMHz / 2;

                // Reset if channel range changed
                if (
                  !fullChannelRangeRef.current ||
                  fullChannelRangeRef.current.min !== channelRange.min ||
                  fullChannelRangeRef.current.max !== channelRange.max
                ) {
                  fullChannelWaveformRef.current = new Float32Array(FULL_CHANNEL_BINS).fill(-200);
                  fullChannelRangeRef.current = { ...channelRange };
                }

                const buf = fullChannelWaveformRef.current!;
                const startRatio = Math.max(0, (hopMin - channelRange.min) / channelSpan);
                const endRatio = Math.min(1, (hopMax - channelRange.min) / channelSpan);
                const destStart = Math.round(startRatio * FULL_CHANNEL_BINS);
                const destEnd = Math.round(endRatio * FULL_CHANNEL_BINS);
                const destCount = Math.max(1, destEnd - destStart);
                const srcLen = waveform.length;

                for (let i = 0; i < destCount; i++) {
                  const srcIdx = Math.min(srcLen - 1, Math.round((i / destCount) * srcLen));
                  buf[destStart + i] = waveform[srcIdx];
                }
              }
            }

            // Keep a single active spectrum pipeline here.
            // The direct drawSpectrum path is the authoritative visible renderer.
            // Launching unifiedFFT.processUnified in parallel causes a second,
            // stateful GPU processing path to race the visible renderer, which
            // manifests as flashing/color shifts during dBm and dB-range changes.

            // Add frame to buffer for smooth rendering - reuse arrays to save memory
            const frameBuffer = frameBufferRef.current;
            let newFrame: Float32Array;

            if (
              frameBuffer.length > 0 &&
              frameBuffer[0].length === waveform.length
            ) {
              // Reuse existing array to minimize memory allocation
              newFrame = frameBuffer.shift()!;
              newFrame.set(waveform);
            } else {
              // Create new array only when necessary
              newFrame = new Float32Array(waveform);
            }

            frameBuffer.push(newFrame);

            // Keep buffer size limited
            if (frameBuffer.length > maxFrameBufferSize) {
              const dropped = frameBuffer.shift();
              if (dropped) {
                dropped.fill(0); // Clear dropped array to help GC
              }
            }

            if (displayTemporalResolution === "high") {
              const prev = renderWaveformRef.current;
              if (!prev || prev.length !== waveform.length) {
                // Clear previous buffer before creating new one
                if (prev) {
                  prev.fill(0);
                }
                renderWaveformRef.current = new Float32Array(waveform);
              } else {
                prev.set(waveform);
              }
            } else {
              const alpha = displayTemporalResolution === "low" ? 0.15 : 0.4;
              const prev = renderWaveformRef.current;
              if (!prev || prev.length !== waveform.length) {
                // Clear previous buffer before creating new one
                if (prev) {
                  prev.fill(0);
                }
                renderWaveformRef.current = new Float32Array(waveform);
              } else {
                for (let i = 0; i < waveform.length; i++) {
                  prev[i] = alpha * waveform[i] + (1.0 - alpha) * prev[i];
                }
              }
            }
          }
        } else if (
          isPaused &&
          currentData?.iq_data &&
          (currentData !== lastProcessedDataRef.current || powerScaleChanged)
        ) {
          // Paused: ingest once to avoid blank frames (file mode or first paused frame)
          const processedWaveform = processIqToDbmSpectrum(
            currentData.iq_data,
            isDbmMode ? 30.0 : 0.0,
            effectiveFftSize,
            fftWindow,
          );

          // Validate waveform before processing
          if (!processedWaveform || processedWaveform.length === 0) {
            return;
          }

          waveformFloatRef.current = processedWaveform;
          lastProcessedDataRef.current = currentData;
          lastRenderedPowerScaleRef.current = powerScale;

          const prev = renderWaveformRef.current;
          if (!prev || prev.length !== processedWaveform.length) {
            renderWaveformRef.current = new Float32Array(processedWaveform);
          } else {
            prev.fill(0);
            prev.set(processedWaveform);
          }
        }

        const waveform = renderWaveformRef.current;
        if (!waveform || waveform.length === 0) {
          if (isPaused && !waveform) {
            restoreWaveformFromStorageRef.current();
            if (
              !renderWaveformRef.current ||
              renderWaveformRef.current.length === 0
            ) {
              return;
            }
          } else {
            return;
          }
        }

        // Update waveform reference after potential restoration
        const currentWaveform = renderWaveformRef.current;

        if (currentWaveform && currentWaveform.length > 0) {
          const {
            slicedWaveform: rawSlicedWaveform,
            visualRange,
            clampedPan,
          } = getZoomedData(
            currentWaveform,
            frequencyRangeRef.current,
            vizZoomRef.current,
            vizPanOffsetRef.current,
          );

          // Sync clamped pan back to state if it drifted
          if (clampedPan !== vizPanOffsetRef.current) {
            setVizPanOffset(clampedPan);
          }

          const unifiedSourceWaveform = null;

          // Use unified GPU output (averaging/smoothing handled on GPU when enabled)
          const baseSpectrumWaveform = unifiedSourceWaveform ?? rawSlicedWaveform;
          let slicedWaveform = baseSpectrumWaveform;

          // CPU-side fallback for averaging/smoothing when unified GPU path isn't active
          if (!unifiedSourceWaveform) {
            if (fftAvgEnabled) {
              if (
                !fftProcessedBufferRef.current ||
                fftProcessedBufferRef.current.length !== baseSpectrumWaveform.length
              ) {
                fftProcessedBufferRef.current = new Float32Array(baseSpectrumWaveform.length);
              }
              const processed = fftProcessedBufferRef.current;
              processed.set(baseSpectrumWaveform);

              // Disable FFT averaging to prevent noise floor animation when moving dB sliders
              // let prev = fftAvgBufferRef.current;
              // if (!prev || prev.length !== processed.length) {
              //   prev = new Float32Array(processed);
              //   fftAvgBufferRef.current = prev;
              // } else {
              //   const alpha = 0.2;
              //   for (let i = 0; i < processed.length; i++) {
              //     processed[i] = prev[i] * (1 - alpha) + processed[i] * alpha;
              //   }
              //   prev.set(processed);
              // }
              slicedWaveform = processed;
            }

            // Disable FFT smoothing to prevent noise floor animation when moving dB sliders
            // if (fftSmoothEnabled && slicedWaveform.length > 4) {
            //   if (
            //     !fftSmoothedBufferRef.current ||
            //     fftSmoothedBufferRef.current.length !== slicedWaveform.length
            //   ) {
            //     fftSmoothedBufferRef.current = new Float32Array(slicedWaveform.length);
            //   }
            //   const smoothed = fftSmoothedBufferRef.current;
            //   for (let i = 0; i < slicedWaveform.length; i++) {
            //     let sum = 0;
            //     let count = 0;
            //     for (
            //       let j = Math.max(0, i - 2);
            //       j <= Math.min(slicedWaveform.length - 1, i + 2);
            //       j++
            //     ) {
            //       sum += slicedWaveform[j];
            //       count++;
            //     }
            //     smoothed[i] = sum / count;
            //   }
            //   slicedWaveform = smoothed;
            // }
          }
          // Spectrum render (using unified hook)
          if (spectrumGpuCanvas) {
            drawSpectrum({
              canvas: spectrumGpuCanvas,
              webgpuEnabled: spectrumWebgpuEnabled,
              isInitializingWebGPU,
              device: webgpuDeviceRef.current,
              format: webgpuFormatRef.current,
              waveform: slicedWaveform,
              frequencyRange: visualRange,
              fftMin: activeScaleDbMin,
              fftMax: activeScaleDbMax,
              powerScale: effectivePowerScale,
              gridOverlayRenderer: gridOverlayRendererRef.current,
              markersOverlayRenderer: markersOverlayRendererRef.current,
              spikesOverlayRenderer: spikesOverlayRendererRef.current,
              overlayDirty: overlayDirtyRef.current,
              centerFrequencyMHz: centerFreqRef.current,
              isDeviceConnected,
              hardwareSampleRateHz,
              fullCaptureRange: frequencyRangeRef.current,
              isIqRecordingActive,
              limitMarkers,
              showSpikeOverlay,
              spikeMarkers: showSpikeOverlay
                ? detectProminentSpikes({
                  spectrumData: slicedWaveform,
                  dbMin: activeScaleDbMin,
                  dbMax: activeScaleDbMax,
                  maxMarkers: Math.max(24, Math.floor(slicedWaveform.length / 12)),
                  frequencyRange: visualRange,
                  temporalPersistence:
                    spikePersistenceRef.current && spikePersistenceRef.current.length === slicedWaveform.length
                      ? spikePersistenceRef.current
                      : (spikePersistenceRef.current = new Float32Array(slicedWaveform.length)),
                })
                : [],
              lineColor: fftColor,
              fillColor: fillColor,
            });
          }

          // Waterfall render (only push new lines when not paused AND new data is available)
          // Note: Unified FFT system provides its own waterfall texture for instant synchronization
          // This fallback waterfall rendering is kept for compatibility when unified FFT is not available
          if (
            webgpuEnabled &&
            webgpuDeviceRef.current &&
            webgpuFormatRef.current &&
            waterfallGpuCanvas
          ) {
            const dims = waterfallGpuDimsRef.current;
            if (dims && currentData) {
              const waterfallMotion = getWaterfallMotion({
                previousVisualRange: lastWaterfallVisualRangeRef.current,
                currentVisualRange: visualRange,
                textureWidth: 4096,
              });
              const shouldUpdateWaterfallRow =
                !isPaused && (hasNewData || waterfallMotion.shouldPaintMotionRow);
              retuneDriftPxRef.current = waterfallMotion.driftBins;
              retuneSmearRef.current = waterfallMotion.smearRows;

              // ALWAYS resample to a constant width (4096 bins)
              // This 'bakes' the current zoom into the row permanently and avoids
              // resetting the WebGPU texture when the zoom level changes.
              const FIXED_WATERFALL_BINS = 4096;
              let waterfallBins: Float32Array;

              // Ensure we have a persistent buffer for the fixed-width data
              if (
                !waterfallCappedBufferRef.current ||
                waterfallCappedBufferRef.current.length !== FIXED_WATERFALL_BINS
              ) {
                waterfallCappedBufferRef.current = new Float32Array(
                  FIXED_WATERFALL_BINS,
                );
              }
              const processed = waterfallCappedBufferRef.current;

              if (shouldUpdateWaterfallRow) {
                // Peak-resampling to 4096 bins
                const srcLen = slicedWaveform.length;
                const ratio = srcLen / FIXED_WATERFALL_BINS;
                for (let i = 0; i < FIXED_WATERFALL_BINS; i++) {
                  const start = Math.floor(i * ratio);
                  const end = Math.floor((i + 1) * ratio);
                  let maxVal = -200;
                  for (let j = start; j < Math.max(end, start + 1); j++) {
                    const val = slicedWaveform[j] ?? -200;
                    if (val > maxVal) maxVal = val;
                  }
                  processed[i] = maxVal;
                }
                waterfallBins = processed;

                // Keep a copy of the last row for pause/snapshot
                if (
                  !lastWaterfallRowRef.current ||
                  lastWaterfallRowRef.current.length !== waterfallBins.length
                ) {
                  lastWaterfallRowRef.current = new Float32Array(waterfallBins);
                } else {
                  lastWaterfallRowRef.current.set(waterfallBins);
                }
                if (hasNewData) {
                  heterodyningHistoryRef.current.push(new Float32Array(waterfallBins));
                  if (heterodyningHistoryRef.current.length > 96) {
                    heterodyningHistoryRef.current.shift();
                  }
                }
                lastWaterfallVisualRangeRef.current = { ...visualRange };
              } else {
                retuneDriftPxRef.current = 0;
                retuneSmearRef.current = 0;
                waterfallBins = lastWaterfallRowRef.current ?? processed;
              }

              // Snapshot tracking (always 4096 bins wide)
              const textureBytesPerRow = FIXED_WATERFALL_BINS * 4;
              const textureByteSize = textureBytesPerRow * dims.height;
              if (
                !waterfallTextureSnapshotRef.current ||
                waterfallTextureSnapshotRef.current.length !== textureByteSize
              ) {
                waterfallTextureSnapshotRef.current = new Uint8Array(
                  textureByteSize,
                );
                waterfallTextureMetaRef.current = {
                  width: FIXED_WATERFALL_BINS,
                  height: dims.height,
                  writeRow: 0,
                };
              }
              const meta = waterfallTextureMetaRef.current;
              const snapshot = waterfallTextureSnapshotRef.current;
              const restoreTexture = resolvePendingWaterfallRestore({
                pendingRestore: pendingWaterfallRestoreRef.current,
                shouldUpdateWaterfallRow,
                hasRenderedRestore: restoredWaterfallRef.current,
              });
              if (shouldUpdateWaterfallRow && meta && snapshot && meta.width === FIXED_WATERFALL_BINS) {
                const rowBytes = new Uint8Array(
                  waterfallBins.buffer,
                  waterfallBins.byteOffset,
                  waterfallBins.byteLength,
                );
                const smear = Math.max(
                  0,
                  Math.min(
                    Math.floor(retuneSmearRef.current || 0),
                    dims.height - 1,
                  ),
                );
                for (let s = 0; s <= smear; s++) {
                  const row = (meta.writeRow - s + dims.height) % dims.height;
                  const offset = row * textureBytesPerRow;
                  snapshot.set(rowBytes, offset);
                }
                meta.writeRow = (meta.writeRow + 1) % dims.height;
                pendingWaterfallRestoreRef.current = null;
                restoredWaterfallRef.current = false;
              }

              // Pass 4096 bins to hook — shader handles pixel mapping
              drawWebGPUFIFOWaterfall({
                canvas: waterfallGpuCanvas,
                device: webgpuDeviceRef.current,
                format: webgpuFormatRef.current,
                fftData: waterfallBins,
                fftMin: activeScaleDbMin,
                fftMax: activeScaleDbMax,
                driftAmount: retuneSmearRef.current,
                freeze: !shouldUpdateWaterfallRow,
                restoreTexture,
                wfSmooth: wfSmoothEnabled,
                colormap: colormap,
                colormapName: waterfallTheme,
              });
              if (restoreTexture) {
                restoredWaterfallRef.current = true;
              }
            } else if (isPaused) {
              const restore = pendingWaterfallRestoreRef.current ?? undefined;
              const FIXED_WATERFALL_BINS = 4096;
              const targetWidth = restore?.width ?? FIXED_WATERFALL_BINS;

              let rowBuffer: Float32Array | null = null;
              if (targetWidth > 0) {
                rowBuffer = lastWaterfallRowRef.current;
                if (!rowBuffer || rowBuffer.length !== targetWidth) {
                  if (
                    !pausedWaterfallRowRef.current ||
                    pausedWaterfallRowRef.current.length !== targetWidth
                  ) {
                    pausedWaterfallRowRef.current = new Float32Array(
                      targetWidth,
                    );
                    pausedWaterfallRowRef.current.fill(-120);
                  } else {
                    pausedWaterfallRowRef.current.fill(-120);
                  }
                  restoredWaterfallRef.current = true;
                }
                rowBuffer = pausedWaterfallRowRef.current;
              }

              if (rowBuffer) {
                drawWebGPUFIFOWaterfall({
                  canvas: waterfallGpuCanvas,
                  device: webgpuDeviceRef.current!,
                  format: webgpuFormatRef.current!,
                  fftData: rowBuffer,
                  fftMin: activeScaleDbMin,
                  fftMax: activeScaleDbMax,
                  driftAmount: retuneSmearRef.current,
                  freeze: true,
                  restoreTexture: restore,
                  colormap,
                  colormapName: waterfallTheme,
                });
              }
            }
          }
        }
      },
      [
        drawSpectrum,
        drawWebGPUFIFOWaterfall,
        isPaused,
        displayTemporalResolution,
        spectrumWebgpuEnabled,
        webgpuEnabled,
        webgpuDeviceRef,
        webgpuFormatRef,
        gridOverlayRendererRef,
        markersOverlayRendererRef,
        isDeviceConnected,
        spectrumGpuCanvasNode,
        waterfallGpuCanvasNode,
        fftColor,
        fillColor,
        colormap,
        waterfallTheme,
        fftAvgEnabled,
        fftSmoothEnabled,
        wfSmoothEnabled,
        effectivePowerScale,
        activeScaleDbMin,
        activeScaleDbMax,
        showSpikeOverlay,
        awaitingDeviceData,
        drawLoadingPlaceholder,
        clearOverlayCanvas,
        WATERFALL_PLACEHOLDER_FONT,
      ],
    );

    const onBecomeVisible = useCallback(() => {
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
    }, []);

    const { forceRender } = useFFTAnimation({
      isPaused,
      onRenderFrame,
      onBecomeVisible,
      targetFPS: fftFrameRate,
    });

    // Handle component unmounting
    useEffect(() => {
      return () => {
      };
    }, []);

    useEffect(() => {
      const hasPendingWaterfallRestore = !!pendingWaterfallRestoreRef.current;
      lastProcessedDataRef.current = null;
      if (!isPaused || !hasPendingWaterfallRestore) {
        pausedWaterfallRowRef.current = null;
        restoredWaterfallRef.current = false;
      }

      const currentWaveform = waveformFloatRef.current;
      if (currentWaveform && currentWaveform.length > 0) {
        renderWaveformRef.current = new Float32Array(currentWaveform);
      } else if (isPaused && dataRef.current?.iq_data) {
        // Trigger a re-process of paused I/Q data
        lastProcessedDataRef.current = null;
      }

      forceRender();
    }, [displayTemporalResolution, forceRender]);

    useEffect(() => {
      forceRender();
    }, [awaitingDeviceData, forceRender]);


    useEffect(() => {
      if (!onHeterodyningAnalyzed) return;
      if (heterodyningVerifyRequestId <= 0) return;
      if (heterodyningVerifyRequestId === lastHeterodyningRequestIdRef.current) {
        return;
      }

      lastHeterodyningRequestIdRef.current = heterodyningVerifyRequestId;
      onHeterodyningAnalyzed(
        detectHeterodyningFromHistory(heterodyningHistoryRef.current),
      );
    }, [heterodyningVerifyRequestId, onHeterodyningAnalyzed]);

    useEffect(() => {
      if (!showSpikeOverlay) {
        spikePersistenceRef.current = null;
      }
      overlayDirtyRef.current.spikes = true;
      forceRender();
    }, [showSpikeOverlay, forceRender, overlayDirtyRef]);

    const { restoreWaveformFromStorage, ensurePausedFrame } = usePauseLogic({
      isPaused,
      renderWaveformRef,
      waveformFloatRef,
      waterfallBufferRef,
      waterfallDimsRef,
      dataRef,
      forceRender,
      snapshotScope: visualizerSessionKey,
    });

    restoreWaveformFromStorageRef.current = restoreWaveformFromStorage;

    const buildVisualizerSessionSnapshot = useCallback((): FFTVisualizerSnapshot | null => {
      const waveform = renderWaveformRef.current ?? waveformFloatRef.current;
      const waterfallTextureSnapshot = waterfallTextureSnapshotRef.current;
      const waterfallTextureMeta = waterfallTextureMetaRef.current;
      const waterfallBuffer = waterfallBufferRef.current;
      const waterfallDims = waterfallDimsRef.current;

      if (
        !waveform &&
        !waterfallTextureSnapshot &&
        !waterfallTextureMeta &&
        !waterfallBuffer &&
        !waterfallDims
      ) {
        return null;
      }

      return {
        waveform: waveform ? new Float32Array(waveform) : null,
        waterfallTextureSnapshot: waterfallTextureSnapshot
          ? new Uint8Array(waterfallTextureSnapshot)
          : null,
        waterfallTextureMeta: waterfallTextureMeta
          ? { ...waterfallTextureMeta }
          : null,
        waterfallBuffer: waterfallBuffer
          ? new Uint8ClampedArray(waterfallBuffer)
          : null,
        waterfallDims: waterfallDims ? { ...waterfallDims } : null,
      };
    }, []);

    const restoreVisualizerSessionSnapshot = useCallback(
      (snapshot: FFTVisualizerSnapshot | null) => {
        if (!snapshot) {
          return false;
        }

        let restored = false;

        if (snapshot.waveform && snapshot.waveform.length > 0) {
          const waveform = new Float32Array(snapshot.waveform);
          renderWaveformRef.current = waveform;
          waveformFloatRef.current = new Float32Array(snapshot.waveform);
          restored = true;
        }

        if (snapshot.waterfallBuffer && snapshot.waterfallDims) {
          waterfallBufferRef.current = new Uint8ClampedArray(
            snapshot.waterfallBuffer,
          );
          waterfallDimsRef.current = { ...snapshot.waterfallDims };
          restored = true;
        }

        if (
          snapshot.waterfallTextureSnapshot &&
          snapshot.waterfallTextureMeta
        ) {
          waterfallTextureSnapshotRef.current = new Uint8Array(
            snapshot.waterfallTextureSnapshot,
          );
          waterfallTextureMetaRef.current = { ...snapshot.waterfallTextureMeta };
          pendingWaterfallRestoreRef.current = {
            data: new Uint8Array(snapshot.waterfallTextureSnapshot),
            width: snapshot.waterfallTextureMeta.width,
            height: snapshot.waterfallTextureMeta.height,
            writeRow: snapshot.waterfallTextureMeta.writeRow,
          };
          restoredWaterfallRef.current = false;
          restored = true;
        }

        return restored;
      },
      [],
    );

    const persistVisualizerSession = useCallback(() => {
      if (!visualizerMachine) {
        return;
      }

      visualizerMachine.persist(
        visualizerSessionKey,
        buildVisualizerSessionSnapshot(),
      );
    }, [buildVisualizerSessionSnapshot, visualizerMachine, visualizerSessionKey]);

    useEffect(() => {
      const restoredFromMachine = restoreVisualizerSessionSnapshot(
        visualizerMachine?.restore(visualizerSessionKey) ?? null,
      );
      if (restoredFromMachine) {
        forceRender();
      }

      return () => {
        persistVisualizerSession();
        cleanupSpectrum();
      };
    }, [
      cleanupSpectrum,
      forceRender,
      persistVisualizerSession,
      restoreVisualizerSessionSnapshot,
      visualizerMachine,
      visualizerSessionKey,
    ]);

    // Reset cached waveforms and trigger grid redraw when frequency range changes
    useEffect(() => {
      const prevRange = frequencyRangeRef.current;
      frequencyRangeRef.current = frequencyRange;

      if (
        prevRange.min !== frequencyRange.min ||
        prevRange.max !== frequencyRange.max
      ) {
        lastProcessedDataRef.current = null;
        renderWaveformRef.current = null;
        waveformFloatRef.current = null;
        fullChannelWaveformRef.current = null;
        fullChannelRangeRef.current = null;
        frameBufferRef.current = [];
      }

      if (isPaused) {
        forceRender();
      }
    }, [frequencyRange, isPaused, forceRender]);

    useEffect(() => {
      const currentData = dataRef.current;
      const hasData = !!(currentData && currentData.iq_data);

      if (hasData && currentData !== lastIncomingFrameRef.current) {
        lastIncomingFrameRef.current = currentData;
        if (isPaused) {
          forceRender();
        }
      }

      if (!hasData) {
        lastIncomingFrameRef.current = null;
      }
    }, [dataRef, isPaused, forceRender]);

    // Handle canvas resizing
    useEffect(() => {
      const handleResize = () => {
        const dpr = window.devicePixelRatio || 1;

        const spectrumRect =
          spectrumGpuCanvasRef.current?.parentElement?.getBoundingClientRect();
        const waterfallRect =
          waterfallGpuCanvasRef.current?.parentElement?.getBoundingClientRect();

        if (
          spectrumRect &&
          spectrumRect.width > 0 &&
          spectrumRect.height > 0 &&
          spectrumOverlayCanvasRef.current
        ) {
          const canvas = spectrumOverlayCanvasRef.current;
          canvas.width = spectrumRect.width * dpr;
          canvas.height = spectrumRect.height * dpr;
          canvas.style.width = `${spectrumRect.width}px`;
          canvas.style.height = `${spectrumRect.height}px`;
          canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        if (
          spectrumRect &&
          spectrumRect.width > 0 &&
          spectrumRect.height > 0 &&
          spectrumWebgpuEnabled &&
          spectrumGpuCanvasRef.current
        ) {
          const canvas = spectrumGpuCanvasRef.current;
          canvas.width = Math.max(1, Math.round(spectrumRect.width * dpr));
          canvas.height = Math.max(1, Math.round(spectrumRect.height * dpr));
          canvas.style.width = `${spectrumRect.width}px`;
          canvas.style.height = `${spectrumRect.height}px`;

          spectrumWidthRef.current = spectrumRect.width;
          spectrumHeightRef.current = spectrumRect.height;
          overlayDirtyRef.current.grid = true;
          overlayDirtyRef.current.markers = true;
        }


        if (
          waterfallRect &&
          waterfallRect.width > 0 &&
          waterfallRect.height > 0 &&
          waterfallOverlayCanvasRef.current
        ) {
          const canvas = waterfallOverlayCanvasRef.current;
          canvas.width = waterfallRect.width * dpr;
          canvas.height = waterfallRect.height * dpr;
          canvas.style.width = `${waterfallRect.width}px`;
          canvas.style.height = `${waterfallRect.height}px`;
          canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        if (
          waterfallRect &&
          waterfallRect.width > 0 &&
          waterfallRect.height > 0 &&
          waterfallGpuCanvasRef.current
        ) {
          const canvas = waterfallGpuCanvasRef.current;
          canvas.width = Math.max(1, Math.round(waterfallRect.width * dpr));
          canvas.height = Math.max(1, Math.round(waterfallRect.height * dpr));
          canvas.style.width = `${waterfallRect.width}px`;
          canvas.style.height = `${waterfallRect.height}px`;

          const marginX = Math.round(40 * dpr);
          const marginY = Math.round(8 * dpr);
          const displayWidth = Math.max(
            1,
            Math.round(waterfallRect.width * dpr - marginX * 2),
          );
          const displayHeight = Math.max(
            1,
            Math.round(waterfallRect.height * dpr - marginY * 2),
          );
          if (waterfallDataWidthRef.current !== displayWidth) {
            waterfallDataWidthRef.current = displayWidth;
          }
          const dataWidth = waterfallDataWidthRef.current;
          waterfallGpuDimsRef.current = {
            width: dataWidth,
            height: displayHeight,
          };
        }

        if (isPaused) {
          ensurePausedFrame();
        }

        forceRender();
      };

      handleResize();
      window.addEventListener("resize", handleResize);

      const resizeObserver = new ResizeObserver(() => handleResize());
      const spectrumParent = spectrumGpuCanvasRef.current?.parentElement;
      const waterfallParent = waterfallGpuCanvasRef.current?.parentElement;
      if (spectrumParent) resizeObserver.observe(spectrumParent);
      if (waterfallParent) resizeObserver.observe(waterfallParent);

      return () => {
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
      };
    }, [forceRender, spectrumWebgpuEnabled, isPaused, ensurePausedFrame]);

    useEffect(() => {
      const cleanupInterval = setInterval(() => {
        // Avoid clearing buffers while paused so the snapshot can be restored
        if (isPaused) return;

        if (waterfallBufferRef.current && waterfallDimsRef.current) {
          const { width, height } = waterfallDimsRef.current;
          const expectedSize = width * height * 4;
          if (waterfallBufferRef.current.length > expectedSize * 1.5) {
            returnBufferToPool(waterfallBufferRef.current);
            waterfallBufferRef.current = getBufferFromPool(expectedSize);
          }
        }

        if (waveformFloatRef.current && !dataRef.current?.iq_data) {
          waveformFloatRef.current = null;
        }
      }, 30000);

      return () => clearInterval(cleanupInterval);
    }, [
      dataRef,
      waterfallDimsRef,
      returnBufferToPool,
      getBufferFromPool,
      isPaused,
    ]);

    // When paused, draw the restored frame once WebGPU is ready
    useEffect(() => {
      if (!isPaused) return;
      if (!webgpuEnabled) return;
      if (!webgpuDeviceRef.current || !webgpuFormatRef.current) return;
      forceRender();
    }, [isPaused, webgpuEnabled, forceRender]);

    useEffect(() => {
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      if (isPaused) {
        forceRender();
      }
    }, [vizDbMin, vizDbMax, currentVizZoom, vizPanOffset, isPaused, forceRender]);

    // Separate effect for powerScale changes to ensure immediate overlay updates
    useEffect(() => {
      if (previousPowerScaleRef.current === effectivePowerScale) {
        return;
      }
      previousPowerScaleRef.current = effectivePowerScale;
      lastProcessedDataRef.current = null;
      lastRenderedPowerScaleRef.current = null;
      // Keep render buffers intact so the new power scale can redraw immediately
      // from the existing live IQ frame instead of flashing a blank placeholder.
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      if (isPaused) {
        forceRender();
      }
    }, [effectivePowerScale, isPaused, forceRender]);

    const buildSnapshotData = useCallback((): SnapshotData | null => {
      const waveform = renderWaveformRef.current;
      const frequencyRangeCurrent = frequencyRangeRef.current;
      if (!waveform || waveform.length === 0 || !frequencyRangeCurrent) {
        return null;
      }

      return {
        waveform: new Float32Array(waveform),
        fullChannelWaveform: fullChannelWaveformRef.current
          ? new Float32Array(fullChannelWaveformRef.current)
          : null,
        frequencyRange: { ...frequencyRangeCurrent },
        dbMin: vizDbMinRef.current,
        dbMax: vizDbMaxRef.current,
        fftSize: effectiveFftSize,
        fftWindow: fftWindow ?? "Rectangular",
        centerFrequencyMHz: centerFreqRef.current,
        isDeviceConnected,
        vizZoom: vizZoomRef.current,
        vizPanOffset: vizPanOffsetRef.current,
        waterfallTextureSnapshot: waterfallTextureSnapshotRef.current
          ? new Uint8Array(waterfallTextureSnapshotRef.current)
          : null,
        waterfallTextureMeta: waterfallTextureMetaRef.current
          ? { ...waterfallTextureMetaRef.current }
          : null,
        waterfallBuffer: waterfallBufferRef.current
          ? new Uint8ClampedArray(waterfallBufferRef.current)
          : null,
        waterfallDims: waterfallDimsRef.current
          ? { ...waterfallDimsRef.current }
          : null,
        webgpuEnabled,
        hardwareSampleRateHz,
        isIqRecordingActive,
        colormap: colormap || [],
      };
    }, [
      colormap,
      effectiveFftSize,
      fftWindow,
      hardwareSampleRateHz,
      isDeviceConnected,
      isIqRecordingActive,
      webgpuEnabled,
    ]);

    const getCompositeSnapshot = useCallback(() => {
      const spectrumCanvas = spectrumGpuCanvasRef.current;
      const waterfallCanvas = waterfallGpuCanvasRef.current;

      if (!spectrumCanvas) {
        return null;
      }

      const width = spectrumCanvas.width;
      const waterfallHeight = waterfallCanvas?.height ?? 0;
      const height = spectrumCanvas.height + waterfallHeight;
      const compositeCanvas = document.createElement("canvas");
      compositeCanvas.width = width;
      compositeCanvas.height = height;
      const ctx = compositeCanvas.getContext("2d");
      if (!ctx) {
        return null;
      }

      ctx.drawImage(spectrumCanvas, 0, 0);
      if (waterfallCanvas) {
        ctx.drawImage(waterfallCanvas, 0, spectrumCanvas.height);
      }

      return {
        dataUrl: compositeCanvas.toDataURL("image/png"),
        width,
        height,
      };
    }, [spectrumWebgpuEnabled, webgpuEnabled]);

    useImperativeHandle(ref, () => ({
      getSpectrumCanvas: () => spectrumGpuCanvasRef.current,
      getWaterfallCanvas: () => waterfallGpuCanvasRef.current,
      triggerSnapshotRender: () => {
        forceRender();
      },
      getSnapshotData: buildSnapshotData,
      getCompositeSnapshot,
    }), [spectrumWebgpuEnabled, webgpuEnabled, buildSnapshotData, getCompositeSnapshot]);

    return (
      <Suspense fallback={<div>Loading FFT visualization...</div>}>
        <VisualizerContainer style={compact ? { backgroundColor: 'transparent' } : {}}>
          <VisualizerContent style={compact ? { gap: 0 } : {}}>
            <SpectrumSection>
              {!compact && (
                <SectionTitle>
                  FFT Signal Display {isPaused && "(Paused)"}
                </SectionTitle>
              )}
              <SpectrumRow>
                <CanvasWrapper ref={spectrumContainerRef}>
                  {!isInitializingWebGPU && (
                    <CanvasLayer
                      ref={setSpectrumGpuCanvasNode}
                      id="fft-spectrum-canvas-webgpu"
                    />
                  )}
                  <CanvasLayer
                    ref={_setSpectrumOverlayCanvasNode}
                    id="fft-spectrum-canvas-overlay"
                  />
                  {heterodyningHighlightedBins.length > 0 && (
                    <HighlightOverlay>
                      {heterodyningHighlightedBins.map((bin, index) => (
                        <HighlightBand
                          key={`spectrum-highlight-${index}`}
                          $left={Math.max(0, Math.min(100, bin.start * 100))}
                          $width={Math.max(
                            0.2,
                            Math.min(100, (bin.end - bin.start) * 100),
                          )}
                        />
                      ))}
                    </HighlightOverlay>
                  )}
                </CanvasWrapper>
              </SpectrumRow>
            </SpectrumSection>
          </VisualizerContent>
        </VisualizerContainer>
      </Suspense>
    );
  })
);

FFTCanvas.displayName = "FFTCanvas";

export default FFTCanvas;
