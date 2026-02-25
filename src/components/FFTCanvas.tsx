import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from "react";
import styled from "styled-components";
import { useFFTAnimation } from "@n-apt/hooks/useFFTAnimation";
import { usePauseLogic } from "@n-apt/hooks/usePauseLogic";
import { useDraw2DFFTSignal } from "@n-apt/hooks/useDraw2DFFTSignal";
import { useDraw2DFIFOWaterfall } from "@n-apt/hooks/useDraw2DFIFOWaterfall";
import { useDrawWebGPUFFTSignal, RESAMPLE_WGSL } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/hooks/useDrawWebGPUFIFOWaterfall";
import { useOverlayRenderer } from "@n-apt/hooks/useOverlayRenderer";
import { useFrequencyDrag } from "@n-apt/hooks/useFrequencyDrag";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import type { FrequencyRange } from "@n-apt/consts/types";
import { VisualizerSliders } from "@n-apt/components/VisualizerSliders";
import { spectrumToAmplitude } from "@n-apt/consts/types";
import {
  VISUALIZER_PADDING,
  VISUALIZER_GAP,
  SECTION_TITLE_COLOR,
  SECTION_TITLE_AFTER_COLOR,
  CANVAS_BORDER_COLOR,
  FFT_AREA_MIN,
  FFT_CANVAS_BG,
  FFT_MIN_DB,
  FFT_MAX_DB,
} from "@n-apt/consts";

// Import SDR processor for WASM FFT processing
let sdrProcessor: any = null;
console.log("🚀 Initializing WASM FFT Pipeline...");

// Use dynamic import for WASM module loading
(async () => {
  try {
    console.log("📦 Loading WASM FFT module...");
    const wasmModule = await import("n_apt_canvas");
    const { SIMDRenderingProcessor, default: initWasm } = wasmModule;

    console.log("✅ WASM FFT module loaded successfully");
    console.log("🔧 Initializing WASM module...");

    // Initialize the WASM module first
    await initWasm();

    console.log("🔧 Creating SIMDRenderingProcessor instance...");
    sdrProcessor = new SIMDRenderingProcessor();

    console.log("🎯 WASM FFT Pipeline: SUCCESS");
    console.log("✅ All modules loaded successfully");
    console.log("   - SDR Processor: Available");
    console.log("   - FFT Size: Variable (backend controlled)");
    console.log("   - WASM Acceleration: Enabled");
    console.log("   - SIMD Support: Available");
    console.log("   - Memory Features: Enabled");
    console.log("   - Performance: Native WASM FFT speed");
    console.log("🚀 Ready for high-performance signal processing!");
  } catch (error) {
    console.error("❌ WASM FFT Pipeline: FAILED");
    console.error("   - Error:", (error as Error).message);
    console.error("   - Cause: WASM FFT module not available");
    console.warn("⚠️  Falling back to JavaScript FFT processing");
    console.log("📊 Performance Impact: FFT will be slower");
  }
})();

const VisualizerContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #0a0a0a;
  position: relative;
  overflow: hidden;
  padding: ${VISUALIZER_PADDING}px;
  gap: ${VISUALIZER_GAP}px;
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
  background-color: ${FFT_CANVAS_BG};
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
  pointer-events: auto;
  will-change: width, height;
`;

const ToggleableCanvasLayer = styled(CanvasLayer).attrs<{ $visible: boolean }>(props => ({
  style: {
    display: props.$visible ? "block" : "none",
  },
}))`
  z-index: 0;
`;

const WATERFALL_TEXTURE_SNAPSHOT_KEY = "napt-waterfall-texture-snapshot";
const WATERFALL_TEXTURE_META_KEY = "napt-waterfall-texture-meta";

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
  /** Grid preference for snapshot rendering (affects 2D shadow canvases) */
  snapshotGridPreference: boolean;
  deviceState: "disconnected" | "connecting" | "connected";
  vizZoom?: number;
  vizPanOffset?: number;
  onVizZoomChange?: (zoom: number) => void;
  onVizPanChange?: (pan: number) => void;
  /** Function to request auto FFT options from server */
  sendGetAutoFftOptions?: (screenWidth: number) => void;
}

/**
 * FFT canvas component with FFT spectrum and waterfall displays
 * Uses SDR++ style rendering for professional spectrum analysis
 */
const FFTCanvas = forwardRef<
  {
    getSpectrumCanvas: () => HTMLCanvasElement | null;
    getWaterfallCanvas: () => HTMLCanvasElement | null;
    triggerSnapshotRender: () => void;
  },
  FFTCanvasProps
>((props, ref): React.ReactElement | null => {
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
    snapshotGridPreference,
    deviceState,
    vizZoom: externalVizZoom,
    vizPanOffset: externalVizPanOffset,
    onVizZoomChange,
    onVizPanChange,
    sendGetAutoFftOptions,
  } = props;
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumGpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallGpuCanvasRef = useRef<HTMLCanvasElement>(null);

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

  const lastWaterfallRowRef = useRef<Uint8ClampedArray | null>(null);
  const pausedWaterfallRowRef = useRef<Uint8ClampedArray | null>(null);
  const waterfallTextureSnapshotRef = useRef<Uint8Array | null>(null);
  const waterfallTextureMetaRef = useRef<{ width: number; height: number; writeRow: number } | null>(
    null,
  );
  const waterfallRowBufferRef = useRef<Uint8Array | null>(null);
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
  const [internalVizZoom, setInternalVizZoom] = useState(1);
  const [vizDbMax, setVizDbMax] = useState(FFT_MAX_DB); // 0
  const [vizDbMin, setVizDbMin] = useState(FFT_MIN_DB); // -120
  const [internalVizPanOffset, setInternalVizPanOffset] = useState(0); // Offset in Hz

  const vizZoom = externalVizZoom !== undefined ? externalVizZoom : internalVizZoom;
  const vizPanOffset = externalVizPanOffset !== undefined ? externalVizPanOffset : internalVizPanOffset;

  const setVizZoom = useCallback(
    (val: number | ((prev: number) => number)) => {
      if (onVizZoomChange) {
        onVizZoomChange(typeof val === "function" ? val(vizZoom) : val);
      } else {
        setInternalVizZoom(val);
      }
    },
    [onVizZoomChange, vizZoom]
  );

  const setVizPanOffset = useCallback(
    (val: number | ((prev: number) => number)) => {
      if (onVizPanChange) {
        onVizPanChange(typeof val === "function" ? val(vizPanOffset) : val);
      } else {
        setInternalVizPanOffset(val);
      }
    },
    [onVizPanChange, vizPanOffset]
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
      if (zoom <= 1) {
        return { slicedWaveform: fullWaveform, visualRange: fullRange, clampedPan: 0 };
      }

      const totalBins = fullWaveform.length;
      const visibleBins = Math.floor(totalBins / zoom);

      const fullSpan = fullRange.max - fullRange.min;
      const halfSpan = fullSpan / (2 * zoom);

      // Calculate max allowed pan so visual window doesn't exceed hardware window
      const maxPan = (fullSpan / 2) - halfSpan;
      const clampedPan = Math.max(-maxPan, Math.min(maxPan, panOffset));

      const centerFreq = (fullRange.min + fullRange.max) / 2;
      const visualCenter = centerFreq + clampedPan;

      // Convert visual center to bin index
      const visualCenterBin = Math.round(((visualCenter - fullRange.min) / fullSpan) * totalBins);

      let startBin = Math.round(visualCenterBin - visibleBins / 2);
      // Clamp startBin to valid array bounds
      startBin = Math.max(0, Math.min(totalBins - visibleBins, startBin));

      const slicedWaveform = fullWaveform.subarray(startBin, startBin + visibleBins);
      const visualRange = {
        min: visualCenter - halfSpan,
        max: visualCenter + halfSpan,
      };

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
  const waterfallDimsRef = useRef<{ width: number; height: number } | null>(null);
  const waterfallGpuDimsRef = useRef<{ width: number; height: number } | null>(null);
  const OVERLAY_MAX_FPS = 60;
  const OVERLAY_MIN_INTERVAL_MS = Math.round(1000 / OVERLAY_MAX_FPS);

  // Simplified WebGPU references
  const resampleComputePipelineRef = useRef<GPUComputePipeline | null>(null);
  const resampleParamsBufferRef = useRef<GPUBuffer | null>(null);
  const gpuBufferPoolRef = useRef<GPUBuffer[]>([]);

  const {
    webgpuEnabled,
    webgpuDeviceRef,
    webgpuFormatRef,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
    overlayDirtyRef,
    overlayLastUploadMsRef,
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

  useEffect(() => {
    // Frequency range changes affect both overlays
    overlayDirtyRef.current.grid = true;
    overlayDirtyRef.current.markers = true;
  }, [frequencyRange]);

  useEffect(() => {
    // Center frequency changes only affect marker overlay.
    overlayDirtyRef.current.markers = true;
  }, [centerFrequencyMHz]);

  useEffect(() => {
    // Device connectivity toggles whether red limit lines should display.
    overlayDirtyRef.current.markers = true;
  }, [isDeviceConnected]);

  // Screen width detection for auto FFT options
  useEffect(() => {
    if (sendGetAutoFftOptions) {
      const detectScreenWidth = () => {
        const width =
          window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
        console.log("Detected screen width:", width);
        sendGetAutoFftOptions(width);
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
  });

  // Use the new 2D rendering hooks for fallback/shadow rendering
  const { draw2DFFTSignal } = useDraw2DFFTSignal();
  const { draw2DFIFOWaterfall } = useDraw2DFIFOWaterfall();

  // Use WebGPU rendering hooks
  const { drawWebGPUFFTSignal } = useDrawWebGPUFFTSignal();
  const { drawWebGPUFIFOWaterfall } = useDrawWebGPUFIFOWaterfall();

  // Use overlay renderer hook for WebGPU overlay textures
  const { drawGridOnContext, drawMarkersOnContext } = useOverlayRenderer();

  const maybeUpdateOverlays = useCallback(
    (width: number, height: number, dpr: number) => {
      const now = performance.now();
      const freq = frequencyRangeRef.current;
      const { visualRange, clampedPan } = getZoomedData(
        renderWaveformRef.current || new Float32Array(0),
        freq,
        vizZoomRef.current,
        vizPanOffsetRef.current,
      );

      // Sync clamped pan back to state if it drifted
      if (clampedPan !== vizPanOffsetRef.current) {
        setVizPanOffset(clampedPan);
      }
      const cf = centerFreqRef.current;

      // Grid overlay
      {
        const overlay = gridOverlayRendererRef.current;
        const dirty = overlayDirtyRef.current.grid;
        const last = overlayLastUploadMsRef.current.grid;
        if (overlay && dirty && now - last >= OVERLAY_MIN_INTERVAL_MS) {
          const ctx = overlay.beginDraw(width, height, dpr);
          drawGridOnContext(ctx, width, height, visualRange, vizDbMinRef.current, vizDbMaxRef.current);
          overlay.endDraw();
          overlayDirtyRef.current.grid = false;
          overlayLastUploadMsRef.current.grid = now;
        }
      }

      // Markers overlay
      {
        const overlay = markersOverlayRendererRef.current;
        const dirty = overlayDirtyRef.current.markers;
        const last = overlayLastUploadMsRef.current.markers;
        if (overlay && dirty && now - last >= OVERLAY_MIN_INTERVAL_MS) {
          const ctx = overlay.beginDraw(width, height, dpr);
          drawMarkersOnContext(ctx, width, height, visualRange, cf, isDeviceConnected);
          overlay.endDraw();
          overlayDirtyRef.current.markers = false;
          overlayLastUploadMsRef.current.markers = now;
        }
      }
    },
    [isDeviceConnected, drawGridOnContext, drawMarkersOnContext],
  );

  const ensureFloat32Waveform = useCallback(
    (spectrumData: ArrayLike<number> | null | undefined) => {
      if (!spectrumData || spectrumData.length === 0) {
        console.warn("Invalid spectrum data provided, using fallback");
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
        console.warn("Spectrum data contains no valid values, using fallback");
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
      const waveform = ensureFloat32Waveform(lastProcessedDataRef.current.waveform);
      if (waveform && waveform.length > 0) {
        renderWaveformRef.current = new Float32Array(waveform);
        return;
      }
    }

    // If no previous data, create a fallback waveform
    const fallbackWaveform = new Float32Array(1024).fill(-120);
    renderWaveformRef.current = fallbackWaveform;
  });

  /**
   * Fallback scalar resampling implementation
   *
   * @param spectrumData - Input spectrum data
   * @param waterfallWidth - Target width
   * @returns Resampled data array
   */
  const performScalarResampling = (spectrumData: number[], waterfallWidth: number): number[] => {
    const resampled = Array.from({ length: waterfallWidth }, () => 0);
    const srcLen = spectrumData.length;
    for (let x = 0; x < waterfallWidth; x++) {
      const start = Math.floor((x * srcLen) / waterfallWidth);
      const end = Math.max(start + 1, Math.floor(((x + 1) * srcLen) / waterfallWidth));
      let maxVal = -Infinity;
      for (let i = start; i < end && i < srcLen; i++) {
        const v = spectrumData[i];
        if (v > maxVal) maxVal = v;
      }
      resampled[x] = maxVal === -Infinity ? spectrumData[Math.min(start, srcLen - 1)] : maxVal;
    }
    return resampled;
  };

  // Simplified WebGPU resampling - remove complex caching and buffer management
  const resampleSpectrumInto = useCallback((input: Float32Array, output: Float32Array) => {
    const srcLen = input.length;
    const outLen = output.length;
    if (srcLen === 0 || outLen === 0) return;

    // Simple CPU resampling - reliable and fast enough for most cases
    for (let x = 0; x < outLen; x++) {
      const start = Math.floor((x * srcLen) / outLen);
      const end = Math.max(start + 1, Math.floor(((x + 1) * srcLen) / outLen));
      let maxVal = -Infinity;
      for (let i = start; i < end && i < srcLen; i++) {
        const v = input[i];
        if (Number.isFinite(v)) {
          if (v > maxVal) maxVal = v;
        }
      }
      output[x] = maxVal !== -Infinity ? maxVal : (input[Math.min(start, srcLen - 1)] ?? -120);
    }
  }, []);

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

      const spectrumCanvas = spectrumCanvasRef.current;
      const spectrumGpuCanvas = spectrumGpuCanvasRef.current;
      const waterfallCanvas = waterfallCanvasRef.current;
      const waterfallGpuCanvas = waterfallGpuCanvasRef.current;

      const currentData = dataRef.current;

      if (!isPaused && currentData?.waveform) {
        const waveform = ensureFloat32Waveform(currentData.waveform);

        // Validate waveform before processing
        if (!waveform || waveform.length === 0) {
          console.warn("Invalid waveform detected, skipping frame");
          return;
        }

        if (currentData !== lastProcessedDataRef.current) {
          waveformFloatRef.current = waveform;
          lastProcessedDataRef.current = currentData;

          // Add frame to buffer for smooth rendering - reuse arrays to save memory
          const frameBuffer = frameBufferRef.current;
          let newFrame: Float32Array;

          if (frameBuffer.length > 0 && frameBuffer[0].length === waveform.length) {
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
          console.warn("Invalid waveform detected in paused mode, skipping frame");
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
          if (!renderWaveformRef.current || renderWaveformRef.current.length === 0) {
            return;
          }
        } else {
          return;
        }
      }

      // Update waveform reference after potential restoration
      const currentWaveform = renderWaveformRef.current;

      if (currentWaveform && currentWaveform.length > 0) {
        const { slicedWaveform, visualRange, clampedPan } = getZoomedData(
          currentWaveform,
          frequencyRangeRef.current,
          vizZoomRef.current,
          vizPanOffsetRef.current,
        );

        // Sync clamped pan back to state if it drifted
        if (clampedPan !== vizPanOffsetRef.current) {
          setVizPanOffset(clampedPan);
        }
        let waveformArray: number[] | null = null;
        // Spectrum render - always render existing waveform, but only update with new data when not paused
        if (
          spectrumWebgpuEnabled &&
          webgpuDeviceRef.current &&
          webgpuFormatRef.current &&
          spectrumGpuCanvas
        ) {
          const rect = spectrumGpuCanvas.parentElement?.getBoundingClientRect();
          const width = rect?.width || spectrumGpuCanvas.width;
          const height = rect?.height || spectrumGpuCanvas.height;

          const displayWidth = Math.max(1, Math.floor(width - FFT_AREA_MIN.x - 40));

          // Always downsample to ~pixel width to avoid "curtains" (many points
          // mapping to the same x pixel creates dense vertical lines).
          if (
            !spectrumResampleBufRef.current ||
            spectrumResampleBufRef.current.length !== displayWidth
          ) {
            // Clear old buffer before creating new one
            if (spectrumResampleBufRef.current) {
              spectrumResampleBufRef.current.fill(0);
            }
            spectrumResampleBufRef.current = new Float32Array(displayWidth);
          }
          const outBuf = spectrumResampleBufRef.current;
          if (slicedWaveform.length === displayWidth) {
            outBuf.set(slicedWaveform);
          } else {
            resampleSpectrumInto(slicedWaveform, outBuf);
          }

          // Prevent WebGPU vertex NaNs/Infs (can show as dense vertical "curtains")
          for (let i = 0; i < outBuf.length; i++) {
            const v = outBuf[i];
            if (!Number.isFinite(v)) outBuf[i] = vizDbMinRef.current;
          }

          const dpr = window.devicePixelRatio || 1;
          // Update overlays only when dirty, throttled (prevents drag jank)
          maybeUpdateOverlays(width, height, dpr);

          // Use hook-based WebGPU renderer
          drawWebGPUFFTSignal({
            canvas: spectrumGpuCanvas,
            device: webgpuDeviceRef.current,
            format: webgpuFormatRef.current,
            waveform: outBuf,
            frequencyRange: frequencyRangeRef.current,
            fftMin: vizDbMinRef.current,
            fftMax: vizDbMaxRef.current,
            gridOverlayRenderer: gridOverlayRendererRef.current ?? undefined,
            markersOverlayRenderer: markersOverlayRendererRef.current ?? undefined,
            centerFrequencyMHz: centerFreqRef.current,
            isDeviceConnected,
            showGrid: true,
          });
        } else if (!spectrumWebgpuEnabled && spectrumCanvas) {
          waveformArray = waveformArray ?? Array.from(slicedWaveform);
          draw2DFFTSignal({
            canvas: spectrumCanvas,
            waveform: waveformArray,
            frequencyRange: visualRange,
            fftMin: vizDbMinRef.current,
            fftMax: vizDbMaxRef.current,
            showGrid: true,
            centerFrequencyMHz: centerFreqRef.current,
            isDeviceConnected,
            highPerformanceMode: displayTemporalResolution !== "high",
          });
        }

        // Only draw 2D shadow render when snapshot is requested (not every frame!)
        if (spectrumCanvas && snapshotNeededRef.current) {
          draw2DFFTSignal({
            canvas: spectrumCanvas,
            waveform: Array.from(slicedWaveform),
            frequencyRange: visualRange,
            fftMin: vizDbMinRef.current,
            fftMax: vizDbMaxRef.current,
            showGrid: snapshotGridPreferenceRef.current,
            centerFrequencyMHz: centerFreqRef.current,
            isDeviceConnected,
            highPerformanceMode: false, // Use full quality for snapshots
          });
          snapshotNeededRef.current = false; // Reset after drawing
          lastSnapshotWaveformRef.current = currentWaveform;
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
            let resampled: number[];
            if (sdrProcessor && slicedWaveform && slicedWaveform.length >= 4) {
              const float32Output = new Float32Array(dims.width);
              try {
                sdrProcessor.resample_spectrum(slicedWaveform, float32Output, dims.width);
                resampled = Array.from(float32Output);
              } catch (error) {
                console.warn("WASM SIMD resampling failed, using fallback:", error);
                resampled = performScalarResampling(Array.from(slicedWaveform), dims.width);
              }
            } else {
              resampled = performScalarResampling(Array.from(slicedWaveform), dims.width);
            }

            const normalizedData = spectrumToAmplitude(
              resampled,
              vizDbMinRef.current,
              vizDbMaxRef.current,
            );

            // Convert to RGBA format for waterfall hook
            const rgbaBuffer = new Uint8ClampedArray(normalizedData.length * 4);
            const rowBuffer =
              waterfallRowBufferRef.current && waterfallRowBufferRef.current.length === dims.width
                ? waterfallRowBufferRef.current
                : new Uint8Array(dims.width);
            waterfallRowBufferRef.current = rowBuffer;
            for (let i = 0; i < normalizedData.length; i++) {
              const normalized = Math.max(0, Math.min(1, normalizedData[i]));
              const gray = Math.round(normalized * 255);
              rgbaBuffer[i * 4] = gray;
              rgbaBuffer[i * 4 + 1] = gray;
              rgbaBuffer[i * 4 + 2] = gray;
              rgbaBuffer[i * 4 + 3] = 255;
              if (i < rowBuffer.length) rowBuffer[i] = gray;
            }
            lastWaterfallRowRef.current = rgbaBuffer;

            const textureSize = dims.width * dims.height;
            if (!waterfallTextureSnapshotRef.current || waterfallTextureSnapshotRef.current.length !== textureSize) {
              waterfallTextureSnapshotRef.current = new Uint8Array(textureSize);
              waterfallTextureMetaRef.current = { width: dims.width, height: dims.height, writeRow: 0 };
            }
            const meta = waterfallTextureMetaRef.current;
            const snapshot = waterfallTextureSnapshotRef.current;
            if (meta && snapshot) {
              const smear = Math.max(
                0,
                Math.min(Math.floor(retuneSmearRef.current || 0), dims.height - 1),
              );
              for (let s = 0; s <= smear; s++) {
                const row = (meta.writeRow - s + dims.height) % dims.height;
                const offset = row * dims.width;
                snapshot.set(rowBuffer.subarray(0, dims.width), offset);
              }
              meta.writeRow = (meta.writeRow + 1) % dims.height;
            }

            // Use hook-based WebGPU waterfall renderer
            drawWebGPUFIFOWaterfall({
              canvas: waterfallGpuCanvas,
              device: webgpuDeviceRef.current,
              format: webgpuFormatRef.current,
              waterfallBuffer: rgbaBuffer,
              frequencyRange: frequencyRangeRef.current,
              driftAmount: retuneSmearRef.current,
              driftDirection: retuneDriftPxRef.current,
            });
          } else if (isPaused) {
            const restore = pendingWaterfallRestoreRef.current ?? undefined;
            const restoreWidth = restore?.width;
            const fallbackWidth = lastWaterfallRowRef.current
              ? Math.max(1, Math.floor(lastWaterfallRowRef.current.length / 4))
              : 0;
            const targetWidth =
              waterfallGpuDimsRef.current?.width ?? restoreWidth ?? fallbackWidth;
            if (targetWidth > 0) {
              let rowBuffer = lastWaterfallRowRef.current;
              if (!rowBuffer || rowBuffer.length !== targetWidth * 4) {
                if (!pausedWaterfallRowRef.current || pausedWaterfallRowRef.current.length !== targetWidth * 4) {
                  pausedWaterfallRowRef.current = new Uint8ClampedArray(targetWidth * 4);
                } else {
                  pausedWaterfallRowRef.current.fill(0);
                }
                rowBuffer = pausedWaterfallRowRef.current;
              }
              drawWebGPUFIFOWaterfall({
                canvas: waterfallGpuCanvas,
                device: webgpuDeviceRef.current,
                format: webgpuFormatRef.current,
                waterfallBuffer: rowBuffer,
                frequencyRange: visualRange,
                driftAmount: retuneSmearRef.current,
                driftDirection: retuneDriftPxRef.current,
                freeze: true,
                restoreTexture: restore,
              });
              if (pendingWaterfallRestoreRef.current) {
                pendingWaterfallRestoreRef.current = null;
                restoredWaterfallRef.current = true;
              }
            }
          }
        } else if (waterfallCanvas && !isPaused && currentData) {
          waveformArray = waveformArray ?? Array.from(currentWaveform);
          const rect = waterfallCanvas.parentElement?.getBoundingClientRect();
          const width = rect?.width || waterfallCanvas.width;
          const height = rect?.height || waterfallCanvas.height;
          const dpr = window.devicePixelRatio || 1;
          const marginX = Math.round(40 * dpr);
          const marginY = Math.round(8 * dpr);
          const waterfallWidth = Math.max(1, Math.round(width - marginX * 2));
          const waterfallHeight = Math.max(1, Math.round(height - marginY * 2));
          const expectedSize = waterfallWidth * waterfallHeight * 4;
          if (!waterfallBufferRef.current || waterfallBufferRef.current.length !== expectedSize) {
            waterfallBufferRef.current = getBufferFromPool(expectedSize);
            waterfallDimsRef.current = { width: waterfallWidth, height: waterfallHeight };
          }
          const waterfallBuffer = waterfallBufferRef.current;
          if (waterfallBuffer) {
            // 2D waterfall rendering uses the buffered RGBA waterfall data
            draw2DFIFOWaterfall({
              canvas: waterfallCanvas,
              waterfallBuffer,
              frequencyRange: visualRange,
              waterfallMin: vizDbMinRef.current,
              waterfallMax: vizDbMaxRef.current,
              driftAmount: retuneSmearRef.current,
              driftDirection: retuneDriftPxRef.current,
              fftFrame: waveformArray,
            });
          }
        }

        // Only draw 2D waterfall shadow when snapshot is requested (not every frame!)
        if (waterfallCanvas && waterfallBufferRef.current && snapshotNeededRef.current) {
          draw2DFIFOWaterfall({
            canvas: waterfallCanvas,
            waterfallBuffer: waterfallBufferRef.current,
            frequencyRange: visualRange,
            waterfallMin: vizDbMinRef.current,
            waterfallMax: vizDbMaxRef.current,
          });
        }
      }
    },
    [
      draw2DFFTSignal,
      draw2DFIFOWaterfall,
      drawWebGPUFFTSignal,
      drawWebGPUFIFOWaterfall,
      isPaused,
      ensureFloat32Waveform,
      displayTemporalResolution,
      maybeUpdateOverlays,
      resampleSpectrumInto,
      spectrumWebgpuEnabled,
      webgpuEnabled,
      webgpuDeviceRef,
      webgpuFormatRef,
      gridOverlayRendererRef,
      markersOverlayRendererRef,
      isDeviceConnected,
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

  const saveWaterfallTextureSnapshot = useCallback(() => {
    const snapshot = waterfallTextureSnapshotRef.current;
    const meta = waterfallTextureMetaRef.current;
    if (!snapshot || !meta) return;
    try {
      const bytes = new Uint8Array(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      sessionStorage.setItem(WATERFALL_TEXTURE_SNAPSHOT_KEY, btoa(binary));
      sessionStorage.setItem(WATERFALL_TEXTURE_META_KEY, JSON.stringify(meta));
    } catch {
      /* ignore */
    }
  }, []);

  const loadWaterfallTextureSnapshot = useCallback(() => {
    if (pendingWaterfallRestoreRef.current || restoredWaterfallRef.current) return;
    if (waterfallTextureSnapshotRef.current && waterfallTextureMetaRef.current) return;
    try {
      const base64 = sessionStorage.getItem(WATERFALL_TEXTURE_SNAPSHOT_KEY);
      const metaJson = sessionStorage.getItem(WATERFALL_TEXTURE_META_KEY);
      if (!base64 || !metaJson) return;
      const meta = JSON.parse(metaJson) as { width: number; height: number; writeRow: number };
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      pendingWaterfallRestoreRef.current = {
        data: bytes,
        width: meta.width,
        height: meta.height,
        writeRow: meta.writeRow,
      };
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!isPaused) {
      restoredWaterfallRef.current = false;
      pendingWaterfallRestoreRef.current = null;
      return;
    }
    loadWaterfallTextureSnapshot();
    saveWaterfallTextureSnapshot();
  }, [isPaused, loadWaterfallTextureSnapshot, saveWaterfallTextureSnapshot]);

  useEffect(() => {
    return () => {
      saveWaterfallTextureSnapshot();
    };
  }, [saveWaterfallTextureSnapshot]);


  // Reset cached waveforms and trigger grid redraw when frequency range changes
  useEffect(() => {
    const prevRange = frequencyRangeRef.current;
    frequencyRangeRef.current = frequencyRange;

    if (prevRange.min !== frequencyRange.min || prevRange.max !== frequencyRange.max) {
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
    const resizeCanvas = () => {
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

      if (spectrumRect && spectrumWebgpuEnabled && spectrumGpuCanvasRef.current) {
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
        canvas.getContext("2d")?.setTransform(1, 0, 0, 1, 0, 0);
      }

      if (waterfallRect && waterfallGpuCanvasRef.current) {
        const canvas = waterfallGpuCanvasRef.current;
        canvas.width = Math.max(1, Math.round(waterfallRect.width * dpr));
        canvas.height = Math.max(1, Math.round(waterfallRect.height * dpr));
        canvas.style.width = `${waterfallRect.width}px`;
        canvas.style.height = `${waterfallRect.height}px`;

        const marginX = Math.round(40 * dpr);
        const marginY = Math.round(8 * dpr);
        const displayWidth = Math.max(1, Math.round(waterfallRect.width * dpr - marginX * 2));
        const displayHeight = Math.max(1, Math.round(waterfallRect.height * dpr - marginY * 2));
        if (waterfallDataWidthRef.current !== displayWidth) {
          waterfallDataWidthRef.current = displayWidth;
        }
        const dataWidth = waterfallDataWidthRef.current;
        waterfallGpuDimsRef.current = { width: dataWidth, height: displayHeight };
      }

      if (isPaused) {
        ensurePausedFrame();
      }

      forceRender();
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    const spectrumParent =
      spectrumCanvasRef.current?.parentElement ?? spectrumGpuCanvasRef.current?.parentElement;
    const waterfallParent =
      waterfallCanvasRef.current?.parentElement ?? waterfallGpuCanvasRef.current?.parentElement;
    if (spectrumParent) resizeObserver.observe(spectrumParent);
    if (waterfallParent) resizeObserver.observe(waterfallParent);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
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
  }, [dataRef, waterfallDimsRef, returnBufferToPool, getBufferFromPool, isPaused]);

  // When paused, draw the restored frame once WebGPU is ready
  useEffect(() => {
    if (!isPaused) return;
    if (!webgpuEnabled) return;
    if (!webgpuDeviceRef.current || !webgpuFormatRef.current) return;
    forceRender();
  }, [isPaused, webgpuEnabled, forceRender]);

  const snapshotNeededRef = useRef(false);
  const lastSnapshotWaveformRef = useRef<Float32Array | null>(null);

  const triggerSnapshotRender = useCallback(() => {
    snapshotNeededRef.current = true;
  }, []);

  useEffect(() => {
    overlayDirtyRef.current.grid = true;
    if (isPaused) forceRender();
  }, [vizDbMin, vizDbMax, vizZoom, vizPanOffset, forceRender, isPaused]);

  // Compute zoomed frequency range from the full range (visual only, don't retune)
  const handleZoomChange = useCallback(
    (newZoom: number) => {
      setVizZoom(newZoom);
      // Reset pan offset when zooming completely out to prevent getting stuck panned
      if (newZoom <= 1) setVizPanOffset(0);
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      if (isPaused) forceRender();
    },
    [isPaused, forceRender],
  );

  useImperativeHandle(ref, () => ({
    getSpectrumCanvas: () => spectrumCanvasRef.current,
    getWaterfallCanvas: () => waterfallCanvasRef.current,
    triggerSnapshotRender,
  }));

  return (
    <VisualizerContainer>
      <SpectrumSection>
        <SectionTitle>FFT Signal Display {isPaused && "(Paused)"}</SectionTitle>
        <SpectrumRow>
          <CanvasWrapper>
            <ToggleableCanvasLayer
              ref={spectrumGpuCanvasRef}
              id="fft-spectrum-canvas-webgpu"
              $visible={spectrumWebgpuEnabled}
            />
            <ToggleableCanvasLayer
              ref={spectrumCanvasRef}
              id="fft-spectrum-canvas-2d"
              $visible={!spectrumWebgpuEnabled}
            />
          </CanvasWrapper>
          <VisualizerSliders
            zoom={vizZoom}
            dbMax={vizDbMax}
            dbMin={vizDbMin}
            onZoomChange={handleZoomChange}
            onDbMaxChange={setVizDbMax}
            onDbMinChange={setVizDbMin}
          />
        </SpectrumRow>
      </SpectrumSection>
      <WaterfallSection>
        <SectionTitle>Waterfall Display {isPaused && "(Paused)"}</SectionTitle>
        <CanvasWrapper>
          <ToggleableCanvasLayer
            ref={waterfallGpuCanvasRef}
            id="fft-waterfall-canvas-webgpu"
            $visible={webgpuEnabled}
          />
          <ToggleableCanvasLayer
            ref={waterfallCanvasRef}
            id="fft-waterfall-canvas-2d"
            $visible={!webgpuEnabled}
          />
        </CanvasWrapper>
      </WaterfallSection>
    </VisualizerContainer>
  );
});

FFTCanvas.displayName = "FFTCanvas";

export default FFTCanvas;
