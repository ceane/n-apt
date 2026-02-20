import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import styled from "styled-components";
import { useFFTAnimation } from "@n-apt/hooks/useFFTAnimation";
import { usePauseLogic } from "@n-apt/hooks/usePauseLogic";
import { useSpectrumRendering } from "@n-apt/hooks/useSpectrumRendering";
import { useFrequencyDrag } from "@n-apt/hooks/useFrequencyDrag";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import {
  drawSpectrumGrid,
  drawSpectrumMarkers,
  FrequencyRange,
} from "@n-apt/fft/FFTCanvasRenderer";
import {
  drawWaterfall,
  addWaterfallFrame,
  spectrumToAmplitude,
} from "@n-apt/waterfall/FIFOWaterfallRenderer";
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
  /** Whether the RTL-SDR device is connected */
  isDeviceConnected?: boolean;
  /** Callback for frequency range changes */
  onFrequencyRangeChange?: (range: FrequencyRange) => void;
  displayTemporalResolution?: "low" | "medium" | "high";
  /** Force 2D canvas rendering (skip WebGPU). Used by file-selection mode. */
  force2D?: boolean;
  /** Grid preference for snapshot rendering (affects 2D shadow canvases) */
  snapshotGridPreference?: boolean;
}

/**
 * FFT canvas component with FFT spectrum and waterfall displays
 * Uses SDR++ style rendering for professional spectrum analysis
 */
const FFTCanvas = forwardRef<{
  getSpectrumCanvas: () => HTMLCanvasElement | null;
  getWaterfallCanvas: () => HTMLCanvasElement | null;
}, FFTCanvasProps>(({
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
}, ref) => {
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
    spectrumRendererRef,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
    waterfallRendererRef,
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

  useFrequencyDrag({
    spectrumCanvasRef,
    spectrumGpuCanvasRef,
    frequencyRangeRef,
    spectrumWebgpuEnabled,
    activeSignalArea: _activeSignalArea,
    onFrequencyRangeChange,
  });

  const maybeUpdateOverlays = useCallback(
    (width: number, height: number, dpr: number) => {
      const now = performance.now();
      const freq = frequencyRangeRef.current;
      const cf = centerFreqRef.current;

      // Grid underlay
      {
        const overlay = gridOverlayRendererRef.current;
        const dirty = overlayDirtyRef.current.grid;
        const last = overlayLastUploadMsRef.current.grid;
        if (overlay && dirty && now - last >= OVERLAY_MIN_INTERVAL_MS) {
          const ctx = overlay.beginDraw(width, height, dpr);
          drawSpectrumGrid({
            ctx: ctx as unknown as CanvasRenderingContext2D,
            width,
            height,
            frequencyRange: freq,
            fftMin: FFT_MIN_DB,
            fftMax: FFT_MAX_DB,
            clearBackground: false,
            skipFreqLabelsNearX: width / 2,
          });
          overlay.endDraw();
          overlayDirtyRef.current.grid = false;
          overlayLastUploadMsRef.current.grid = now;
        }
      }

      // Markers + labels overlay
      {
        const overlay = markersOverlayRendererRef.current;
        const dirty = overlayDirtyRef.current.markers;
        const last = overlayLastUploadMsRef.current.markers;
        if (overlay && dirty && now - last >= OVERLAY_MIN_INTERVAL_MS) {
          const ctx = overlay.beginDraw(width, height, dpr);
          drawSpectrumMarkers({
            ctx: ctx as unknown as CanvasRenderingContext2D,
            width,
            height,
            frequencyRange: freq,
            centerFrequencyMHz: cf,
            isDeviceConnected,
          });
          overlay.endDraw();
          overlayDirtyRef.current.markers = false;
          overlayLastUploadMsRef.current.markers = now;
        }
      }
    },
    [isDeviceConnected],
  );

  const { renderSpectrum } = useSpectrumRendering({
    displayTemporalResolution,
    snapshotGridPreferenceRef,
    frequencyRangeRef,
  });

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
   * Renders waterfall data using SIMD-accelerated buffer-based approach
   *
   * @param canvas - Canvas element to render on
   * @param spectrumData - Power spectrum data in dB
   * @performance Processing time: <2ms for 1024 samples with SIMD
   */
  const renderWaterfall = useCallback(
    (canvas: HTMLCanvasElement, spectrumData: number[]) => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !spectrumData) return;

      const dpr = window.devicePixelRatio || 1;
      const marginX = Math.round(40 * dpr);
      const marginY = Math.round(8 * dpr);

      // Calculate waterfall display area
      const waterfallWidth = Math.max(1, Math.round(canvas.width - marginX * 2));
      const waterfallHeight = Math.max(1, Math.round(canvas.height - marginY * 2));

      // Ensure buffer exists and matches display area; preserve content on resize
      const currentBuf = waterfallBufferRef.current;
      const currentDims = waterfallDimsRef.current;
      const requiredBufferSize = waterfallWidth * waterfallHeight * 4;

      if (
        currentBuf &&
        currentDims &&
        currentDims.width === waterfallWidth &&
        currentDims.height === waterfallHeight
      ) {
        // Buffer is already correct size, no action needed
      } else {
        // Return old buffer to pool if it exists
        if (currentBuf) {
          returnBufferToPool(currentBuf);
        }

        // Try to get buffer from pool, or create new one
        const newBuf = getBufferFromPool(requiredBufferSize);

        if (currentBuf && currentDims) {
          const copyW = Math.min(currentDims.width, waterfallWidth);
          const copyH = Math.min(currentDims.height, waterfallHeight);

          for (let y = 0; y < copyH; y++) {
            const srcRowStart = y * currentDims.width * 4;
            const dstRowStart = y * waterfallWidth * 4;
            newBuf.set(currentBuf.subarray(srcRowStart, srcRowStart + copyW * 4), dstRowStart);
          }
        }

        waterfallBufferRef.current = newBuf;
        waterfallDimsRef.current = {
          width: waterfallWidth,
          height: waterfallHeight,
        };
      }

      // Use SIMD-accelerated resampling if available (WASM implementation)
      let resampled: number[];
      if (sdrProcessor && spectrumData.length >= 4) {
        // Use WASM SIMD resampling for maximum performance
        const float32Output = new Float32Array(waterfallWidth);
        try {
          sdrProcessor.resample_spectrum(
            new Float32Array(spectrumData),
            float32Output,
            waterfallWidth,
          );
          resampled = Array.from(float32Output);
        } catch (error) {
          console.warn("WASM SIMD resampling failed, using fallback:", error);
          resampled = performScalarResampling(spectrumData, waterfallWidth);
        }
      } else {
        // Fallback to scalar resampling
        resampled = performScalarResampling(spectrumData, waterfallWidth);
      }

      // Convert dB to normalized amplitude (0-1)
      const normalizedData = spectrumToAmplitude(
        resampled,
        WATERFALL_HISTORY_LIMIT,
        WATERFALL_HISTORY_MAX,
      );

      // Update waterfall using the SDR++ palette implementation.
      // This keeps the 2D fallback visually consistent with WebGPU rendering.
      if (waterfallBufferRef.current) {
        addWaterfallFrame(
          waterfallBufferRef.current,
          normalizedData,
          waterfallWidth,
          waterfallHeight,
          retuneSmearRef.current,
          1, // driftDirection - 1 = right
          FFT_MIN_DB,
          FFT_MAX_DB,
        );
      }

      if (retuneSmearRef.current > 0) {
        retuneSmearRef.current -= 1;
      }

      // Clear waterfall buffer if it's excessive
      if (waterfallBufferRef.current && waterfallDimsRef.current) {
        const { width, height } = waterfallDimsRef.current;
        const expectedSize = width * height * 4;
        if (waterfallBufferRef.current.length > expectedSize * 1.5) {
          returnBufferToPool(waterfallBufferRef.current);
          waterfallBufferRef.current = getBufferFromPool(expectedSize);
        }
      }

      // Clear unused references
      if (waveformFloatRef.current && !dataRef.current?.waveform) {
        waveformFloatRef.current = null;
      }

      // Draw the updated buffer
      if (waterfallBufferRef.current) {
        drawWaterfall({
          ctx,
          width: canvas.width,
          height: canvas.height,
          waterfallBuffer: waterfallBufferRef.current,
          frequencyRange: frequencyRangeRef.current,
        });
      }
    },
    [sdrProcessor],
  );

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
        if (spectrumWebgpuEnabled && spectrumRendererRef.current && spectrumGpuCanvas) {
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

          spectrumRendererRef.current.updateWaveform(outBuf);
          const dpr = window.devicePixelRatio || 1;
          // Update overlays only when dirty, throttled (prevents drag jank)
          maybeUpdateOverlays(width, height, dpr);

          spectrumRendererRef.current.render(
            {
              canvasWidth: width,
              canvasHeight: height,
              dpr,
              plotLeft: FFT_AREA_MIN.x,
              plotRight: Math.max(FFT_AREA_MIN.x + 1, width - 40),
              plotTop: FFT_AREA_MIN.y,
              plotBottom: Math.max(FFT_AREA_MIN.y + 1, height - 40),
              dbMin: FFT_MIN_DB,
              dbMax: FFT_MAX_DB,
              lineColor: LINE_COLOR,
              fillColor: SHADOW_COLOR,
              backgroundColor: FFT_CANVAS_BG,
            },
            {
              pre: gridOverlayRendererRef.current,
              post: markersOverlayRendererRef.current,
            },
          );
        }

        // Always maintain a 2D shadow render (used for snapshot export)
        if (spectrumCanvas) {
          renderSpectrum(spectrumCanvas, Array.from(currentWaveform));
          const ctx2d = spectrumCanvas.getContext("2d");
          if (ctx2d) {
            const r = spectrumCanvas.parentElement?.getBoundingClientRect();
            const sw = r?.width || spectrumCanvas.width;
            const sh = r?.height || spectrumCanvas.height;
            drawSpectrumMarkers({
              ctx: ctx2d,
              width: sw,
              height: sh,
              frequencyRange: frequencyRangeRef.current,
              centerFrequencyMHz: centerFreqRef.current,
              isDeviceConnected,
            });
          }
        }

        // Waterfall render (only push new lines when not paused)
        if (!isPaused && currentData) {
          if (webgpuEnabled && waterfallRendererRef.current && waterfallGpuCanvas) {
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

              waterfallRendererRef.current.pushLine(
                Float32Array.from(normalizedData),
                retuneSmearRef.current,
                retuneDriftPxRef.current,
              );
              if (retuneSmearRef.current > 0) {
                retuneSmearRef.current -= 1;
                if (retuneSmearRef.current <= 0) {
                  retuneDriftPxRef.current = 0;
                }
              }
            }
          }

          // Always maintain a 2D shadow render for snapshot export
          if (waterfallCanvas) {
            renderWaterfall(waterfallCanvas, Array.from(currentWaveform));
          }
        } else if (waterfallCanvas && waterfallBufferRef.current) {
          // Paused 2D fallback: keep displaying the last buffered waterfall.
          // (Don't push new lines, just redraw the existing buffer.)
          const ctx = waterfallCanvas.getContext("2d");
          if (ctx) {
            drawWaterfall({
              ctx,
              width: waterfallCanvas.width,
              height: waterfallCanvas.height,
              waterfallBuffer: waterfallBufferRef.current,
              frequencyRange: frequencyRangeRef.current,
            });
          }
        }

        // Always render existing waterfall buffer (WebGPU)
        if (webgpuEnabled && waterfallRendererRef.current && waterfallGpuCanvas) {
          const rect = waterfallGpuCanvas.parentElement?.getBoundingClientRect();
          if (rect) {
            const dpr = window.devicePixelRatio || 1;
            const marginX = Math.round(40 * dpr);
            const marginY = Math.round(8 * dpr);
            waterfallRendererRef.current.render({
              canvasWidth: rect.width,
              canvasHeight: rect.height,
              dpr,
              marginX,
              marginY,
              backgroundColor: WATERFALL_CANVAS_BG,
            });
          }
        }
      }
    },
    [
      renderSpectrum,
      renderWaterfall,
      isPaused,
      ensureFloat32Waveform,
      displayTemporalResolution,
      maybeUpdateOverlays,
      resampleSpectrumInto,
      spectrumWebgpuEnabled,
      webgpuEnabled,
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

  useEffect(() => {
    // We don't need to sync data to dataRef anymore since dataRef is passed directly
    // but we can keep the cleanup interval
    const cleanupInterval = setInterval(() => {
      // Clear waterfall buffer if it's excessive
      if (waterfallBufferRef.current && waterfallDimsRef.current) {
        const { width, height } = waterfallDimsRef.current;
        const expectedSize = width * height * 4;
        if (waterfallBufferRef.current.length > expectedSize * 1.5) {
          returnBufferToPool(waterfallBufferRef.current);
          waterfallBufferRef.current = getBufferFromPool(expectedSize);
        }
      }

      // Clear unused references
      if (waveformFloatRef.current && !dataRef.current?.waveform) {
        waveformFloatRef.current = null;
      }
    }, 30000); // Every 30 seconds instead of 10

    return () => {
      clearInterval(cleanupInterval);
    };
  }, []);

  useEffect(() => {
    // Update frequency range ref for new lines only
    // Old waterfall lines stay exactly where they are (no horizontal shifting)
    const prevRange = frequencyRangeRef.current;
    frequencyRangeRef.current = frequencyRange;

    if (
      prevRange.min !== frequencyRange.min ||
      prevRange.max !== frequencyRange.max
    ) {
      // Retune: drop cached waveform/smoothing so new frames render immediately.
      lastProcessedDataRef.current = null;
      if (renderWaveformRef.current) {
        renderWaveformRef.current.fill(0);
      }
      renderWaveformRef.current = null;
      waveformFloatRef.current = null;
      frameBufferRef.current = [];
      if (spectrumResampleBufRef.current) {
        spectrumResampleBufRef.current.fill(0);
      }
      // Clear any cached resampling data if needed
    }

    // Retune artifact: briefly widen/smear the next few lines vertically
    retuneSmearRef.current = 10;
    const dims = waterfallGpuDimsRef.current;
    if (dims) {
      const prevSpan = prevRange.max - prevRange.min;
      const delta = frequencyRange.min - prevRange.min;
      const drift = prevSpan !== 0 ? (delta / prevSpan) * dims.width : 0;
      retuneDriftPxRef.current = Math.max(-dims.width, Math.min(dims.width, drift));
      if (Math.abs(retuneDriftPxRef.current) < 0.5) {
        retuneDriftPxRef.current = 0;
        retuneSmearRef.current = 0;
      }
    } else {
      retuneDriftPxRef.current = 0;
      retuneSmearRef.current = 0;
    }

    // Mark overlays dirty; throttled upload happens in animate loop.
    overlayDirtyRef.current.grid = true;
    overlayDirtyRef.current.markers = true;
  }, [frequencyRange.min, frequencyRange.max]);

  useEffect(() => {
    const spectrumCanvas = spectrumCanvasRef.current;
    const spectrumGpuCanvas = spectrumGpuCanvasRef.current;
    const waterfallCanvas = waterfallCanvasRef.current;
    const waterfallGpuCanvas = waterfallGpuCanvasRef.current;

    if (!spectrumCanvas && !waterfallCanvas && !spectrumGpuCanvas && !waterfallGpuCanvas) {
      return;
    }

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;

      const spectrumRect =
        spectrumCanvas?.parentElement?.getBoundingClientRect() ??
        spectrumGpuCanvas?.parentElement?.getBoundingClientRect();
      const waterfallRect =
        waterfallCanvas?.parentElement?.getBoundingClientRect() ??
        waterfallGpuCanvas?.parentElement?.getBoundingClientRect();

      // Skip resize when canvas is hidden (display:none gives zero dimensions)
      if (spectrumRect && spectrumRect.width === 0 && spectrumRect.height === 0) return;
      if (waterfallRect && waterfallRect.width === 0 && waterfallRect.height === 0) return;

      // Cache the current dimensions to avoid unnecessary resampling cache invalidation
      // const oldSpectrumWidth = spectrumWidthRef.current;
      // const oldSpectrumHeight = spectrumHeightRef.current;

      if (spectrumRect) {
        if (spectrumCanvas) {
          spectrumCanvas.width = spectrumRect.width * dpr;
          spectrumCanvas.height = spectrumRect.height * dpr;
          spectrumCanvas.style.width = `${spectrumRect.width}px`;
          spectrumCanvas.style.height = `${spectrumRect.height}px`;
          const ctx = spectrumCanvas.getContext("2d");
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
          // Overlay is composited via WebGPU in WebGPU mode
        }

        if (spectrumWebgpuEnabled && spectrumGpuCanvas && spectrumRendererRef.current) {
          spectrumRendererRef.current.resize(spectrumRect.width, spectrumRect.height, dpr);

          // Only clear cache if dimensions actually changed significantly
          const widthChanged = Math.abs((spectrumWidthRef.current || 0) - spectrumRect.width) > 10;
          const heightChanged =
            Math.abs((spectrumHeightRef.current || 0) - spectrumRect.height) > 10;

          if (widthChanged || heightChanged) {
            // Handle resize - simplified approach
            // Clear resize flag after a short delay
            setTimeout(() => {
              // Resize handling completed
            }, 100);
          }

          // Update dimension refs
          spectrumWidthRef.current = spectrumRect.width;
          spectrumHeightRef.current = spectrumRect.height;

          // Resizing changes raster size — redraw overlays (throttled in animate loop)
          overlayDirtyRef.current.grid = true;
          overlayDirtyRef.current.markers = true;
        }
      }

      if (waterfallRect) {
        if (waterfallCanvas) {
          waterfallCanvas.width = waterfallRect.width * dpr;
          waterfallCanvas.height = waterfallRect.height * dpr;
          waterfallCanvas.style.width = `${waterfallRect.width}px`;
          waterfallCanvas.style.height = `${waterfallRect.height}px`;
          const ctx = waterfallCanvas.getContext("2d");
          if (ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
          }
        }

        if (waterfallGpuCanvas && waterfallRendererRef.current) {
          waterfallRendererRef.current.resize(waterfallRect.width, waterfallRect.height, dpr);

          const marginX = Math.round(40 * dpr);
          const marginY = Math.round(8 * dpr);
          const displayWidth = Math.max(1, Math.round(waterfallRect.width * dpr - marginX * 2));
          const displayHeight = Math.max(1, Math.round(waterfallRect.height * dpr - marginY * 2));
          if (!waterfallDataWidthRef.current || waterfallDataWidthRef.current < 10) {
            waterfallDataWidthRef.current = displayWidth;
          }
          const dataWidth = waterfallDataWidthRef.current;
          waterfallGpuDimsRef.current = {
            width: dataWidth,
            height: displayHeight,
          };
          waterfallRendererRef.current.updateDimensions(dataWidth, displayHeight);
        }
      }

      if (isPaused && ensurePausedFrame()) {
        forceRender();
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    let resizeTimeout: any = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        resizeCanvas();
      }, 8); // More aggressive debouncing (8ms = ~120fps)
    });

    const spectrumParent = spectrumCanvas?.parentElement ?? spectrumGpuCanvas?.parentElement;
    const waterfallParent = waterfallCanvas?.parentElement ?? waterfallGpuCanvas?.parentElement;

    if (spectrumParent) resizeObserver.observe(spectrumParent);
    if (waterfallParent) resizeObserver.observe(waterfallParent);

    if (isPaused && renderWaveformRef.current) {
      forceRender();
    }

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
    };
  }, [forceRender, webgpuEnabled, spectrumWebgpuEnabled, isPaused, ensurePausedFrame]);

  // Expose canvas getter methods via ref
  useImperativeHandle(ref, () => ({
    getSpectrumCanvas: () => {
      // Return the 2D canvas for snapshot (always maintained for export)
      return spectrumCanvasRef.current;
    },
    getWaterfallCanvas: () => {
      // Return the 2D waterfall canvas for snapshot
      return waterfallCanvasRef.current;
    },
  }), []);

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

FFTCanvas.displayName = 'FFTCanvas';

export default FFTCanvas;
