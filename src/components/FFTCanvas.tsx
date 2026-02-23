import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import styled from "styled-components";
import { useFFTAnimation } from "@n-apt/hooks/useFFTAnimation";
import { usePauseLogic } from "@n-apt/hooks/usePauseLogic";
import { useDraw2DFFTSignal } from "@n-apt/hooks/useDraw2DFFTSignal";
import { useDraw2DFIFOWaterfall } from "@n-apt/hooks/useDraw2DFIFOWaterfall";
import { useDrawWebGPUFFTSignal } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/hooks/useDrawWebGPUFIFOWaterfall";
import { useOverlayRenderer } from "@n-apt/hooks/useOverlayRenderer";
import { useFrequencyDrag } from "@n-apt/hooks/useFrequencyDrag";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import type { FrequencyRange } from "@n-apt/consts/types";
import { spectrumToAmplitude } from "@n-apt/consts/types";
import {
  VISUALIZER_PADDING,
  VISUALIZER_GAP,
  WATERFALL_HISTORY_LIMIT,
  WATERFALL_HISTORY_MAX,
  SECTION_TITLE_COLOR,
  SECTION_TITLE_AFTER_COLOR,
  CANVAS_BORDER_COLOR,
  FFT_AREA_MIN,
  FFT_CANVAS_BG,
  LINE_COLOR,
  SHADOW_COLOR,
  FFT_MIN_DB,
  FFT_MAX_DB,
  WATERFALL_CANVAS_BG,
} from "@n-apt/consts";

// WebGPU SIMD Resampling Compute Shader
const RESAMPLE_WGSL = `
struct ResampleParams {
  src_len: u32,
  out_len: u32,
  reserved1: u32,
  reserved2: u32,
};

@group(0) @binding(0) var<storage, read> input_buffer: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_buffer: array<f32>;
@group(0) @binding(2) var<uniform> params: ResampleParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  if (x >= params.out_len) {
    return;
  }
  
  let start = u32(floor(f32(x * params.src_len) / f32(params.out_len)));
  let end = min(start + 1, u32(floor(f32((x + 1) * params.src_len) / f32(params.out_len))));
  
  var max_val: f32 = -3.402823466e38; // f32::MIN
  for (var i = start; i < end && i < params.src_len; i = i + 1) {
    let v = input_buffer[i];
    // Check if v is finite by comparing with infinity values
    if (v != -3.402823466e38 && v != 3.402823466e38 && v > max_val) {
      max_val = v;
    }
  }
  
  output_buffer[x] = select(f32(-120.0), max_val, max_val > -3.402823466e38);
}
`;

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

const CanvasLayer = styled.canvas`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
  will-change: width, height;
`;

const ToggleableCanvasLayer = styled(CanvasLayer) <{ $visible: boolean }>`
  display: ${({ $visible }) => ($visible ? "block" : "none")};
  z-index: 0;
`;

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
  snapshotGridPreference?: boolean;
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
    isPaused,
    isDeviceConnected = true,
    onFrequencyRangeChange,
    displayTemporalResolution = "medium",
    force2D = false,
    snapshotGridPreference = true,
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

  // Simplified frame management
  const frameBufferRef = useRef<Float32Array[]>([]);
  const maxFrameBufferSize = 1;
  const lastProcessedDataRef = useRef<any>(null);
  const frequencyRangeRef = useRef<FrequencyRange>(frequencyRange);
  const centerFreqRef = useRef(centerFrequencyMHz);
  centerFreqRef.current = centerFrequencyMHz;

  const retuneSmearRef = useRef(0);
  const retuneDriftPxRef = useRef(0);

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
        const width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
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

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
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
    onFrequencyRangeChange,
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
      const cf = centerFreqRef.current;

      // Grid overlay
      {
        const overlay = gridOverlayRendererRef.current;
        const dirty = overlayDirtyRef.current.grid;
        const last = overlayLastUploadMsRef.current.grid;
        if (overlay && dirty && now - last >= OVERLAY_MIN_INTERVAL_MS) {
          const ctx = overlay.beginDraw(width, height, dpr);
          drawGridOnContext(ctx, width, height, freq, FFT_MIN_DB, FFT_MAX_DB);
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
          drawMarkersOnContext(ctx, width, height, freq, cf, isDeviceConnected);
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
        force2D
      ) {
        // Paused: still ingest when data identity changes (stitched file frames only)
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
        // Spectrum render - always render existing waveform, but only update with new data when not paused
        if (spectrumWebgpuEnabled && webgpuDeviceRef.current && webgpuFormatRef.current && spectrumGpuCanvas) {
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
          if (currentWaveform.length === displayWidth) {
            outBuf.set(currentWaveform);
          } else {
            resampleSpectrumInto(currentWaveform, outBuf);
          }

          // Prevent WebGPU vertex NaNs/Infs (can show as dense vertical "curtains")
          for (let i = 0; i < outBuf.length; i++) {
            const v = outBuf[i];
            if (!Number.isFinite(v)) outBuf[i] = FFT_MIN_DB;
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
            fftMin: FFT_MIN_DB,
            fftMax: FFT_MAX_DB,
            gridOverlayRenderer: gridOverlayRendererRef.current ?? undefined,
            markersOverlayRenderer: markersOverlayRendererRef.current ?? undefined,
            centerFrequencyMHz: centerFreqRef.current,
            isDeviceConnected,
            showGrid: true,
          });
        }

        // Only draw 2D shadow render when snapshot is requested (not every frame!)
        if (spectrumCanvas && snapshotNeededRef.current) {
          draw2DFFTSignal({
            canvas: spectrumCanvas,
            waveform: Array.from(currentWaveform),
            frequencyRange: frequencyRangeRef.current,
            showGrid: snapshotGridPreferenceRef.current,
            centerFrequencyMHz: centerFreqRef.current,
            isDeviceConnected,
            highPerformanceMode: false, // Use full quality for snapshots
          });
          snapshotNeededRef.current = false; // Reset after drawing
          lastSnapshotWaveformRef.current = currentWaveform;
        }

        // Waterfall render (only push new lines when not paused)
        if (!isPaused && currentData) {
          if (webgpuEnabled && webgpuDeviceRef.current && webgpuFormatRef.current && waterfallGpuCanvas) {
            const dims = waterfallGpuDimsRef.current;
            if (dims) {
              let resampled: number[];
              if (sdrProcessor && currentWaveform && currentWaveform.length >= 4) {
                const float32Output = new Float32Array(dims.width);
                try {
                  sdrProcessor.resample_spectrum(currentWaveform, float32Output, dims.width);
                  resampled = Array.from(float32Output);
                } catch (error) {
                  console.warn("WASM SIMD resampling failed, using fallback:", error);
                  resampled = performScalarResampling(Array.from(currentWaveform), dims.width);
                }
              } else {
                resampled = performScalarResampling(Array.from(currentWaveform), dims.width);
              }

              const normalizedData = spectrumToAmplitude(
                resampled,
                WATERFALL_HISTORY_LIMIT,
                WATERFALL_HISTORY_MAX,
              );

              // Convert to RGBA format for waterfall hook
              const rgbaBuffer = new Uint8ClampedArray(normalizedData.length * 4);
              for (let i = 0; i < normalizedData.length; i++) {
                const val = Math.round(normalizedData[i] * 255);
                rgbaBuffer[i * 4] = val;
                rgbaBuffer[i * 4 + 1] = val;
                rgbaBuffer[i * 4 + 2] = val;
                rgbaBuffer[i * 4 + 3] = 255;
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
            }
          } else if (waterfallCanvas) {
            // 2D waterfall rendering
            draw2DFIFOWaterfall({
              canvas: waterfallCanvas,
              waveform: Array.from(currentWaveform),
              frequencyRange: frequencyRangeRef.current,
              waterfallMin: WATERFALL_HISTORY_LIMIT,
              waterfallMax: WATERFALL_HISTORY_MAX,
            });
          }
        }

        // Only draw 2D waterfall shadow when snapshot is requested (not every frame!)
        if (waterfallCanvas && waterfallBufferRef.current && snapshotNeededRef.current) {
          draw2DFIFOWaterfall({
            canvas: waterfallCanvas,
            waterfallBuffer: waterfallBufferRef.current,
            frequencyRange: frequencyRangeRef.current,
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

  // Reset cached waveforms when frequency range changes
  useEffect(() => {
    const prevRange = frequencyRangeRef.current;
    frequencyRangeRef.current = frequencyRange;

    if (prevRange.min !== frequencyRange.min || prevRange.max !== frequencyRange.max) {
      lastProcessedDataRef.current = null;
      renderWaveformRef.current = null;
      waveformFloatRef.current = null;
      frameBufferRef.current = [];
      spectrumResampleBufRef.current?.fill(0);
    }
  }, [frequencyRange]);

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

      if (spectrumRect && spectrumRect.width > 0 && spectrumRect.height > 0 && spectrumCanvasRef.current) {
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

      if (waterfallRect && waterfallRect.width > 0 && waterfallRect.height > 0 && waterfallCanvasRef.current) {
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
    const spectrumParent = spectrumCanvasRef.current?.parentElement ?? spectrumGpuCanvasRef.current?.parentElement;
    const waterfallParent = waterfallCanvasRef.current?.parentElement ?? waterfallGpuCanvasRef.current?.parentElement;
    if (spectrumParent) resizeObserver.observe(spectrumParent);
    if (waterfallParent) resizeObserver.observe(waterfallParent);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      resizeObserver.disconnect();
    };
  }, [forceRender, spectrumWebgpuEnabled, isPaused, ensurePausedFrame]);

  useEffect(() => {
    const cleanupInterval = setInterval(() => {
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
  }, [dataRef, waterfallDimsRef, returnBufferToPool, getBufferFromPool]);

  const snapshotNeededRef = useRef(false);
  const lastSnapshotWaveformRef = useRef<Float32Array | null>(null);

  const triggerSnapshotRender = useCallback(() => {
    snapshotNeededRef.current = true;
  }, []);

  useImperativeHandle(ref, () => ({
    getSpectrumCanvas: () => spectrumCanvasRef.current,
    getWaterfallCanvas: () => waterfallCanvasRef.current,
    triggerSnapshotRender,
  }));

  return (
    <VisualizerContainer>
      <SpectrumSection>
        <SectionTitle>FFT Signal Display {isPaused && "(Paused)"}</SectionTitle>
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
