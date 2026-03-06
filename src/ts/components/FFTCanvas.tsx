import {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useState,
  useMemo,
  memo,
} from "react";
import styled from "styled-components";
import { useFFTAnimation } from "@n-apt/hooks/useFFTAnimation";
import { usePauseLogic } from "@n-apt/hooks/usePauseLogic";
import { useSpectrumRenderer } from "@n-apt/hooks/useSpectrumRenderer";
import { RESAMPLE_WGSL } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/hooks/useDrawWebGPUFIFOWaterfall";
import { useFrequencyDrag } from "@n-apt/hooks/useFrequencyDrag";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useWasmSimdMath } from "@n-apt/hooks/useWasmSimdMath";
import { useThemeStore } from "@n-apt/hooks/useThemeStore";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import type { FrequencyRange } from "@n-apt/consts/types";
import { VisualizerSliders } from "@n-apt/components/VisualizerSliders";
// spectrumToAmplitude removed — dB normalisation now handled in the waterfall WGSL shader
import {
  VISUALIZER_PADDING,
  VISUALIZER_GAP,
  SECTION_TITLE_COLOR,
  SECTION_TITLE_AFTER_COLOR,
  CANVAS_BORDER_COLOR,
  FFT_AREA_MIN,
  FFT_MIN_DB,
  FFT_MAX_DB,
} from "@n-apt/consts";
import {
  saveWaterfallSnapshot,
  loadWaterfallSnapshot,
  clearWaterfallSnapshot,
} from "@n-apt/utils/waterfallDb";

// Use dynamic import for WASM module loading
(async () => {
  try {
    const wasmModule = await import("n_apt_canvas");
    const { default: initWasm, test_wasm_simd_availability } = wasmModule;

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

const MAX_VISUALIZER_ZOOM = 1000;

const VisualizerContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: row;
  background-color: #0a0a0a;
  position: relative;
  overflow: hidden;
  padding: ${VISUALIZER_PADDING}px;
  gap: ${VISUALIZER_GAP}px;
  align-items: stretch;
`;

const VisualizerContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: ${VISUALIZER_GAP}px;
  min-height: 0;
`;

const SlidersRail = styled.div`
  width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const SpectrumSection = styled.div`
  flex: 2;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
`;

const WaterfallSection = styled.div`
  flex: 1;
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
  border: 1px solid ${CANVAS_BORDER_COLOR};
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

// const WATERFALL_TEXTURE_SNAPSHOT_KEY = "napt-waterfall-texture-snapshot";
// const WATERFALL_TEXTURE_META_KEY = "napt-waterfall-texture-meta";

/**
 * Props for FFTCanvas component
 */
interface FFTCanvasProps {
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
  /** Whether the RTL-SDR device is connected */
  isDeviceConnected?: boolean;
  /** Callback for frequency range changes */
  onFrequencyRangeChange?: (range: FrequencyRange) => void;
  displayTemporalResolution?: "low" | "medium" | "high";
  /** Force 2D canvas rendering (skip WebGPU). Used by file-selection mode. */
  force2D?: boolean;
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
  vizZoom?: number;
  vizPanOffset?: number;
  onVizZoomChange?: (zoom: number) => void;
  onVizPanChange?: (pan: number) => void;
  fftMin?: number;
  fftMax?: number;
  onFftDbLimitsChange?: (min: number, max: number) => void;
  /** Function to request auto FFT options from server */
  sendGetAutoFftOptions?: (screenWidth: number) => void;
  hardwareSampleRateHz?: number;
  /** Whether I/Q recording is active */
  isIqRecordingActive?: boolean;
}

/**
 * FFT canvas component with FFT spectrum and waterfall displays
 * Uses SDR++ style rendering for professional spectrum analysis
 */
export type SnapshotData = {
  waveform: Float32Array | null;
  frequencyRange: FrequencyRange;
  dbMin: number;
  dbMax: number;
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
};

export type FFTCanvasHandle = {
  getSpectrumCanvas: () => HTMLCanvasElement | null;
  getWaterfallCanvas: () => HTMLCanvasElement | null;
  triggerSnapshotRender: () => void;
  getSnapshotData: () => SnapshotData | null;
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
      isDeviceConnected = true,
      onFrequencyRangeChange,
      displayTemporalResolution = "medium",
      force2D = false,
      onSnapshot: _onSnapshot,
      snapshotGridPreference,
      vizZoom = 1,
      vizPanOffset = 0,
      onVizZoomChange,
      onVizPanChange,
      fftMin,
      fftMax,
      onFftDbLimitsChange,
      sendGetAutoFftOptions,
      hardwareSampleRateHz,
      isIqRecordingActive = false,
    } = props;
    const { state, dispatch } = useSpectrumStore();
    const fftColor = useThemeStore((s) => s.fftColor);
    const waterfallTheme = useThemeStore((s) => s.waterfallTheme);

    const fillColor = useMemo(() => {
      if (fftColor.startsWith("#")) {
        return `${fftColor}33`; // 20% opacity
      }
      return fftColor;
    }, [fftColor]);

    const colormap = useMemo(() => WATERFALL_COLORMAPS[waterfallTheme], [waterfallTheme]);
    const [spectrumCanvasNode, setSpectrumCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [spectrumGpuCanvasNode, setSpectrumGpuCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [waterfallCanvasNode, setWaterfallCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [waterfallGpuCanvasNode, setWaterfallGpuCanvasNode] =
      useState<HTMLCanvasElement | null>(null);

    // Maintain refs for internal hook usage that don't need to trigger re-renders
    const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const spectrumGpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const waterfallCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const waterfallGpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
    // Ref to the CanvasWrapper div for the spectrum section — receives pointer
    // events since all CanvasLayer elements have pointer-events:none.
    const spectrumContainerRef = useRef<HTMLDivElement | null>(null);

    // Sync state to refs
    useEffect(() => {
      spectrumCanvasRef.current = spectrumCanvasNode;
    }, [spectrumCanvasNode]);
    useEffect(() => {
      spectrumGpuCanvasRef.current = spectrumGpuCanvasNode;
    }, [spectrumGpuCanvasNode]);
    useEffect(() => {
      waterfallCanvasRef.current = waterfallCanvasNode;
    }, [waterfallCanvasNode]);
    useEffect(() => {
      waterfallGpuCanvasRef.current = waterfallGpuCanvasNode;
    }, [waterfallGpuCanvasNode]);

    // Simplified buffer management
    const waterfallBufferRef = useRef<Uint8ClampedArray | null>(null);
    const waterfallDataWidthRef = useRef<number | null>(null);
    const bufferPoolRef = useRef<Uint8ClampedArray[]>([]);
    const maxBufferPoolSize = 3;

    // Track canvas dimensions for cache management
    const spectrumWidthRef = useRef<number>(0);
    const spectrumHeightRef = useRef<number>(0);

    const getBufferFromPool = (size: number): Uint8ClampedArray => {
      const pool = bufferPoolRef.current;
      for (let i = 0; i < pool.length; i++) {
        const buffer = pool[i];
        if (buffer.length === size) {
          pool.splice(i, 1);
          buffer.fill(0);
          return buffer;
        }
      }
      return new Uint8ClampedArray(size);
    };

    const returnBufferToPool = (buffer: Uint8ClampedArray) => {
      const pool = bufferPoolRef.current;
      if (pool.length < maxBufferPoolSize) {
        pool.push(buffer);
      }
    };

    const lastWaterfallRowRef = useRef<Float32Array | null>(null);
    const pausedWaterfallRowRef = useRef<Float32Array | null>(null);
    const waterfallTextureSnapshotRef = useRef<Uint8Array | null>(null);
    const waterfallTextureMetaRef = useRef<{
      width: number;
      height: number;
      writeRow: number;
    } | null>(null);
    const pendingWaterfallRestoreRef = useRef<{
      data: Uint8Array;
      width: number;
      height: number;
      writeRow: number;
    } | null>(null);
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

    // Visualizer slider state: zoom (frequency), dB ceiling/floor
    const vizDbMax = fftMax ?? FFT_MAX_DB;
    const vizDbMin = fftMin ?? FFT_MIN_DB;

    const setVizDbLimits = useCallback(
      (min: number, max: number) => {
        if (onFftDbLimitsChange) {
          onFftDbLimitsChange(min, max);
        }
      },
      [onFftDbLimitsChange],
    );

    // FFT averaging, smoothing, and waterfall smoothing toggles
    const [fftAvgEnabled, setFftAvgEnabled] = useState(false);
    const [fftSmoothEnabled, setFftSmoothEnabled] = useState(false);
    const [wfSmoothEnabled, setWfSmoothEnabled] = useState(false);

    // Clear waterfall effect
    useEffect(() => {
      if (state.isWaterfallCleared) {
        clearWaterfallSnapshot();
        dispatch({ type: "RESET_WATERFALL_CLEARED" });
      }
    }, [state.isWaterfallCleared, dispatch]);
    const fftAvgBufferRef = useRef<Float32Array | null>(null);
    const fftProcessedBufferRef = useRef<Float32Array | null>(null);
    const fftSmoothedBufferRef = useRef<Float32Array | null>(null);
    const waterfallCappedBufferRef = useRef<Float32Array | null>(null);

    const setVizZoom = useCallback(
      (val: number | ((prev: number) => number)) => {
        if (onVizZoomChange) {
          onVizZoomChange(typeof val === "function" ? val(vizZoom) : val);
        }
      },
      [onVizZoomChange, vizZoom],
    );

    const setVizPanOffset = useCallback(
      (val: number | ((prev: number) => number)) => {
        if (onVizPanChange) {
          onVizPanChange(typeof val === "function" ? val(vizPanOffset) : val);
        }
      },
      [onVizPanChange, vizPanOffset],
    );

    const vizZoomRef = useRef(vizZoom);
    const vizDbMaxRef = useRef(vizDbMax);
    const vizDbMinRef = useRef(vizDbMin);
    const vizPanOffsetRef = useRef(vizPanOffset);
    vizZoomRef.current = vizZoom;
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
          const paddedWaveform = new Float32Array(visibleBins).fill(-120);
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
    const spectrumResampleBufRef = useRef<Float32Array | null>(null);
    const waterfallDimsRef = useRef<{ width: number; height: number } | null>(
      null,
    );
    const waterfallGpuDimsRef = useRef<{
      width: number;
      height: number;
    } | null>(null);
    // OVERLAY_MIN_INTERVAL_MS moved to useSpectrumRenderer hook

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
      overlayDirtyRef,
    } = useWebGPUInit({
      force2D,
      spectrumGpuCanvasRef,
      waterfallGpuCanvasRef,
      resampleWgsl: RESAMPLE_WGSL,
      resampleComputePipelineRef,
      resampleParamsBufferRef,
      gpuBufferPoolRef,
    });
    const spectrumWebgpuEnabled = webgpuEnabled;

    // Compute zoomed frequency range from the full range (visual only, don't retune)
    const handleZoomChange = useCallback(
      (newZoom: number) => {
        const clampedZoom = Math.max(1, Math.min(MAX_VISUALIZER_ZOOM, newZoom));
        setVizZoom(clampedZoom);
        // Reset pan offset when zooming completely out to prevent getting stuck panned
        if (clampedZoom <= 1) setVizPanOffset(0);
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;
      },
      [setVizZoom, setVizPanOffset, overlayDirtyRef],
    );

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
      if (sendGetAutoFftOptions) {
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
    }, [sendGetAutoFftOptions]);

    useFrequencyDrag({
      spectrumCanvasRef,
      spectrumGpuCanvasRef,
      spectrumCanvasNode,
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
      onFftDbLimitsChange,
      onVizZoomChange: setVizZoom,
      renderWaveformRef,
    });

    // Initialize WASM SIMD for optimized data processing
    const { resampleSpectrum: wasmResampleSpectrum, isSimdAvailable } = useWasmSimdMath({
      fftSize: 4096,
      enableSimd: true,
      fallbackToScalar: true,
    });

    // Use the unified spectrum renderer (WebGPU + Canvas2D fallback)
    const { drawSpectrum, cleanup: cleanupSpectrum } = useSpectrumRenderer();
    const { drawWebGPUFIFOWaterfall } = useDrawWebGPUFIFOWaterfall();

    // Simplified renderer initialization

    // Redundant overlay logic removed (now handled by useSpectrumRenderer)

    const ensureFloat32Waveform = useCallback(
      (spectrumData: ArrayLike<number> | null | undefined) => {
        if (!spectrumData || spectrumData.length === 0) {
          return new Float32Array(1024).fill(-120);
        }

        // Validate data contains at least one finite number
        let hasValidData = false;
        for (let i = 0; i < spectrumData.length; i++) {
          const v = spectrumData[i];
          if (Number.isFinite(v)) {
            hasValidData = true;
            break;
          }
        }
        if (!hasValidData) {
          return new Float32Array(1024).fill(-120);
        }

        if (spectrumData instanceof Float32Array) {
          return spectrumData;
        }

        // If it's a regular array, we shouldn't return a reference to renderWaveformRef.current
        // directly because the caller (onRenderFrame) assumes it's returning a fresh waveform
        // that it will THEN copy/blend into renderWaveformRef.current.
        // Returning renderWaveformRef.current here causes aliasing issues where the previous
        // frame and current frame point to the exact same memory, breaking the blending math
        // and causing an empty/frozen screen.
        return Float32Array.from(spectrumData);
      },
      [],
    );

    const restoreWaveformFromStorageRef = useRef<() => void>(() => {
      // When paused and no current waveform, try to restore from last valid data
      if (lastProcessedDataRef.current?.waveform) {
        const waveform = ensureFloat32Waveform(
          lastProcessedDataRef.current.waveform,
        );
        if (waveform && waveform.length > 0) {
          renderWaveformRef.current = new Float32Array(waveform);
          return;
        }
      }

      // If no previous data, create a fallback waveform
      const fallbackWaveform = new Float32Array(1024).fill(-120);
      renderWaveformRef.current = fallbackWaveform;
    });

    // WASM SIMD optimized resampling with CPU fallback
    const resampleSpectrumInto = useCallback(
      (input: Float32Array, output: Float32Array) => {
        const srcLen = input.length;
        const outLen = output.length;
        if (srcLen === 0 || outLen === 0) return;

        // Use WASM SIMD when available for 3-10x performance boost
        if (isSimdAvailable) {
          wasmResampleSpectrum(input, output);
        } else {
          // CPU fallback with max-pooling
          for (let x = 0; x < outLen; x++) {
            const start = Math.floor((x * srcLen) / outLen);
            const end = Math.max(
              start + 1,
              Math.floor(((x + 1) * srcLen) / outLen),
            );
            let maxVal = -Infinity;
            for (let i = start; i < end && i < srcLen; i++) {
              const v = input[i];
              if (Number.isFinite(v)) {
                if (v > maxVal) maxVal = v;
              }
            }
            output[x] =
              maxVal !== -Infinity
                ? maxVal
                : (input[Math.min(start, srcLen - 1)] ?? -120);
          }
        }
      },
      [isSimdAvailable, wasmResampleSpectrum],
    );

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
        const spectrumCanvas = spectrumCanvasRef.current;
        const waterfallGpuCanvas = waterfallGpuCanvasRef.current;

        const currentData = dataRef.current;

        if (!isPaused && currentData?.waveform) {
          const waveform = ensureFloat32Waveform(currentData.waveform);

          // Validate waveform before processing
          if (!waveform || waveform.length === 0) {
            return;
          }

          if (currentData !== lastProcessedDataRef.current) {
            waveformFloatRef.current = waveform;
            lastProcessedDataRef.current = currentData;

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
          currentData?.waveform &&
          currentData !== lastProcessedDataRef.current &&
          (force2D || !renderWaveformRef.current)
        ) {
          // Paused: ingest once to avoid blank frames (file mode or first paused frame)
          const waveform = ensureFloat32Waveform(currentData.waveform);

          // Validate waveform before processing
          if (!waveform || waveform.length === 0) {
            return;
          }

          waveformFloatRef.current = waveform;
          lastProcessedDataRef.current = currentData;

          // Clear previous buffer before creating new one
          const prev = renderWaveformRef.current;
          if (prev) {
            prev.fill(0);
          }
          renderWaveformRef.current = new Float32Array(waveform);
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

          // Apply FFT averaging + smoothing (modifiable copy)
          let slicedWaveform = rawSlicedWaveform;

          if (!isPaused && (fftAvgEnabled || fftSmoothEnabled)) {
            // Ensure we have a persistent buffer of the right size
            if (
              !fftProcessedBufferRef.current ||
              fftProcessedBufferRef.current.length !== rawSlicedWaveform.length
            ) {
              fftProcessedBufferRef.current = new Float32Array(
                rawSlicedWaveform.length,
              );
            }
            const processed = fftProcessedBufferRef.current;
            processed.set(rawSlicedWaveform);

            // FFT Averaging — exponential moving average (α = 0.2)
            if (fftAvgEnabled) {
              let prev = fftAvgBufferRef.current;
              if (!prev || prev.length !== processed.length) {
                prev = new Float32Array(processed);
                fftAvgBufferRef.current = prev;
              } else {
                const alpha = 0.2;
                for (let i = 0; i < processed.length; i++) {
                  processed[i] = prev[i] * (1 - alpha) + processed[i] * alpha;
                }
                prev.set(processed);
              }
            } else {
              fftAvgBufferRef.current = null;
            }

            // FFT Smoothing — 5-bin moving average
            if (fftSmoothEnabled && processed.length > 4) {
              if (
                !fftSmoothedBufferRef.current ||
                fftSmoothedBufferRef.current.length !== processed.length
              ) {
                fftSmoothedBufferRef.current = new Float32Array(
                  processed.length,
                );
              }
              const smoothed = fftSmoothedBufferRef.current;
              for (let i = 0; i < processed.length; i++) {
                let sum = 0;
                let count = 0;
                for (
                  let j = Math.max(0, i - 2);
                  j <= Math.min(processed.length - 1, i + 2);
                  j++
                ) {
                  sum += processed[j];
                  count++;
                }
                smoothed[i] = sum / count;
              }
              slicedWaveform = smoothed;
            } else {
              slicedWaveform = processed;
            }
          } else if (!fftAvgEnabled) {
            fftAvgBufferRef.current = null;
          }
          // Spectrum render (using unified hook)
          if (spectrumGpuCanvas || spectrumCanvas) {
            const rect = (spectrumGpuCanvas || spectrumCanvas)?.parentElement?.getBoundingClientRect();
            const width = rect?.width || (spectrumGpuCanvas || spectrumCanvas)?.width || 1;
            const displayWidth = Math.max(1, Math.floor(width - FFT_AREA_MIN.x - 40));

            // Resample for performance and visual clarity
            if (!spectrumResampleBufRef.current || spectrumResampleBufRef.current.length !== displayWidth) {
              if (spectrumResampleBufRef.current) spectrumResampleBufRef.current.fill(0);
              spectrumResampleBufRef.current = new Float32Array(displayWidth);
            }
            const outBuf = spectrumResampleBufRef.current;
            if (slicedWaveform.length === displayWidth) {
              outBuf.set(slicedWaveform);
            } else {
              resampleSpectrumInto(slicedWaveform, outBuf);
            }

            // Sanitise data for shader
            for (let i = 0; i < outBuf.length; i++) {
              if (!Number.isFinite(outBuf[i])) outBuf[i] = vizDbMinRef.current;
            }

            drawSpectrum({
              canvas: (spectrumWebgpuEnabled ? spectrumGpuCanvas : spectrumCanvas) as HTMLCanvasElement,
              webgpuEnabled: spectrumWebgpuEnabled,
              device: webgpuDeviceRef.current,
              format: webgpuFormatRef.current,
              waveform: outBuf,
              frequencyRange: visualRange,
              fftMin: vizDbMinRef.current,
              fftMax: vizDbMaxRef.current,
              gridOverlayRenderer: gridOverlayRendererRef.current,
              markersOverlayRenderer: markersOverlayRendererRef.current,
              overlayDirty: overlayDirtyRef.current,
              centerFrequencyMHz: centerFreqRef.current,
              isDeviceConnected,
              hardwareSampleRateHz,
              fullCaptureRange: frequencyRangeRef.current,
              isIqRecordingActive,
              lineColor: fftColor,
              fillColor: fillColor,
            });
          }

          // Waterfall render (only push new lines when not paused)
          if (
            webgpuEnabled &&
            webgpuDeviceRef.current &&
            webgpuFormatRef.current &&
            waterfallGpuCanvas
          ) {
            const dims = waterfallGpuDimsRef.current;
            if (dims && !isPaused && currentData) {
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
              if (meta && snapshot && meta.width === FIXED_WATERFALL_BINS) {
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
              }

              // Pass 4096 bins to hook — shader handles pixel mapping
              drawWebGPUFIFOWaterfall({
                canvas: waterfallGpuCanvas,
                device: webgpuDeviceRef.current,
                format: webgpuFormatRef.current,
                fftData: waterfallBins,
                frequencyRange: frequencyRangeRef.current,
                fftMin: vizDbMinRef.current,
                fftMax: vizDbMaxRef.current,
                driftAmount: retuneSmearRef.current,
                driftDirection: retuneDriftPxRef.current,
                wfSmooth: wfSmoothEnabled,
                colormap: colormap,
                colormapName: waterfallTheme,
              });
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
                    pausedWaterfallRowRef.current.fill(-200);
                  } else {
                    pausedWaterfallRowRef.current.fill(-200);
                  }
                  restoredWaterfallRef.current = true;
                }
                rowBuffer = pausedWaterfallRowRef.current;
              }

              if (rowBuffer) {
                drawWebGPUFIFOWaterfall({
                  canvas: waterfallGpuCanvas,
                  device: webgpuDeviceRef.current,
                  format: webgpuFormatRef.current,
                  fftData: rowBuffer,
                  frequencyRange: visualRange,
                  fftMin: vizDbMinRef.current,
                  fftMax: vizDbMaxRef.current,
                  driftAmount: retuneSmearRef.current,
                  driftDirection: retuneDriftPxRef.current,
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
        ensureFloat32Waveform,
        displayTemporalResolution,
        resampleSpectrumInto,
        spectrumWebgpuEnabled,
        webgpuEnabled,
        webgpuDeviceRef,
        webgpuFormatRef,
        gridOverlayRendererRef,
        markersOverlayRendererRef,
        isDeviceConnected,
        spectrumCanvasNode,
        spectrumGpuCanvasNode,
        waterfallCanvasNode,
        waterfallGpuCanvasNode,
        fftColor,
        fillColor,
        colormap,
        waterfallTheme,
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
    });

    const { restoreWaveformFromStorage, ensurePausedFrame } = usePauseLogic({
      isPaused,
      renderWaveformRef,
      waveformFloatRef,
      waterfallBufferRef,
      waterfallDimsRef,
      dataRef,
      ensureFloat32Waveform,
      forceRender,
    });

    restoreWaveformFromStorageRef.current = restoreWaveformFromStorage;

    const saveWaterfallTextureSnapshot = useCallback(async () => {
      const snapshot = waterfallTextureSnapshotRef.current;
      const meta = waterfallTextureMetaRef.current;
      if (!snapshot || !meta) return;
      try {
        await saveWaterfallSnapshot(snapshot, meta);
      } catch (e) {
        console.error("Failed to save waterfall snapshot to IndexedDB:", e);
      }
    }, []);

    const loadWaterfallTextureSnapshot = useCallback(async () => {
      if (pendingWaterfallRestoreRef.current || restoredWaterfallRef.current)
        return;
      if (
        waterfallTextureSnapshotRef.current &&
        waterfallTextureMetaRef.current
      )
        return;
      try {
        const snapshot = await loadWaterfallSnapshot();
        if (!snapshot) return;

        pendingWaterfallRestoreRef.current = {
          data: snapshot.data,
          width: snapshot.meta.width,
          height: snapshot.meta.height,
          writeRow: snapshot.meta.writeRow,
        };
      } catch (err) {
        console.error("Failed to load waterfall snapshot from IndexedDB:", err);
      }
    }, []);

    useEffect(() => {
      // Restore waterfall history unconditionally on mount (no longer tied to isPaused).
      // This allows returning to a tab with old context without tossing the buffer out
      const timeoutId = setTimeout(() => {
        loadWaterfallTextureSnapshot();
      }, 100);

      return () => {
        clearTimeout(timeoutId);
        saveWaterfallTextureSnapshot();
        cleanupSpectrum();
      };
    }, [saveWaterfallTextureSnapshot, cleanupSpectrum]);

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
        frameBufferRef.current = [];
        spectrumResampleBufRef.current?.fill(0);

        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;

        if (isPaused) {
          forceRender();
        }
      }
    }, [frequencyRange, isPaused, forceRender]);

    // Handle canvas resizing
    useEffect(() => {
      const handleResize = () => {
        const dpr = window.devicePixelRatio || 1;

        const spectrumRect =
          spectrumCanvasRef.current?.parentElement?.getBoundingClientRect() ??
          spectrumGpuCanvasRef.current?.parentElement?.getBoundingClientRect();
        const waterfallRect =
          waterfallCanvasRef.current?.parentElement?.getBoundingClientRect() ??
          waterfallGpuCanvasRef.current?.parentElement?.getBoundingClientRect();

        if (
          spectrumRect &&
          spectrumRect.width > 0 &&
          spectrumRect.height > 0 &&
          spectrumCanvasRef.current
        ) {
          const canvas = spectrumCanvasRef.current;
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
          waterfallCanvasRef.current
        ) {
          const canvas = waterfallCanvasRef.current;
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
      const spectrumParent =
        spectrumCanvasRef.current?.parentElement ??
        spectrumGpuCanvasRef.current?.parentElement;
      const waterfallParent =
        waterfallCanvasRef.current?.parentElement ??
        waterfallGpuCanvasRef.current?.parentElement;
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

        if (waveformFloatRef.current && !dataRef.current?.waveform) {
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

    const snapshotNeededRef = useRef(false);

    const triggerSnapshotRender = useCallback(() => {
      snapshotNeededRef.current = true;
    }, []);

    useEffect(() => {
      overlayDirtyRef.current.grid = true;
      if (isPaused) forceRender();
    }, [vizDbMin, vizDbMax, vizZoom, vizPanOffset, forceRender, isPaused]);

    useImperativeHandle(ref, () => ({
      getSpectrumCanvas: () => spectrumCanvasRef.current,
      getWaterfallCanvas: () => waterfallCanvasRef.current,
      triggerSnapshotRender,
      getSnapshotData: () => {
        const waveform = renderWaveformRef.current;
        if (!waveform || waveform.length === 0) return null;
        return {
          waveform: new Float32Array(waveform),
          frequencyRange: { ...frequencyRangeRef.current },
          dbMin: vizDbMinRef.current,
          dbMax: vizDbMaxRef.current,
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
        };
      },
    }));

    return (
      <VisualizerContainer>
        <VisualizerContent>
          <SpectrumSection>
            <SectionTitle>
              FFT Signal Display {isPaused && "(Paused)"}
            </SectionTitle>
            <SpectrumRow>
              <CanvasWrapper ref={spectrumContainerRef}>
                {!isInitializingWebGPU && spectrumWebgpuEnabled && (
                  <CanvasLayer
                    ref={setSpectrumGpuCanvasNode}
                    id="fft-spectrum-canvas-webgpu"
                  />
                )}
                {!isInitializingWebGPU && !spectrumWebgpuEnabled && (
                  <CanvasLayer
                    ref={setSpectrumCanvasNode}
                    id="fft-spectrum-canvas-2d"
                  />
                )}
              </CanvasWrapper>
            </SpectrumRow>
          </SpectrumSection>
          <WaterfallSection>
            <SectionTitle>
              Waterfall Display {isPaused && "(Paused)"}
            </SectionTitle>
            <CanvasWrapper>
              {!isInitializingWebGPU && webgpuEnabled && (
                <CanvasLayer
                  ref={setWaterfallGpuCanvasNode}
                  id="fft-waterfall-canvas-webgpu"
                />
              )}
              {!isInitializingWebGPU && !webgpuEnabled && (
                <CanvasLayer
                  ref={setWaterfallCanvasNode}
                  id="fft-waterfall-canvas-2d"
                />
              )}
            </CanvasWrapper>
          </WaterfallSection>
        </VisualizerContent>
        <SlidersRail>
          <VisualizerSliders
            zoom={vizZoom}
            dbMax={state.fftMaxDb}
            dbMin={state.fftMinDb}
            onZoomChange={handleZoomChange}
            onDbMaxChange={(max: number) => setVizDbLimits(state.fftMinDb, max)}
            onDbMinChange={(min: number) => setVizDbLimits(min, state.fftMaxDb)}
            fftAvgEnabled={fftAvgEnabled}
            fftSmoothEnabled={fftSmoothEnabled}
            wfSmoothEnabled={wfSmoothEnabled}
            onFftAvgChange={setFftAvgEnabled}
            onFftSmoothChange={setFftSmoothEnabled}
            onWfSmoothChange={setWfSmoothEnabled}
            onResetZoomDb={() => dispatch({ type: "RESET_ZOOM_AND_DB" })}
          />
        </SlidersRail>
      </VisualizerContainer>
    );
  })
);

FFTCanvas.displayName = "FFTCanvas";

export default FFTCanvas;
