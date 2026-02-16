import { useRef, useEffect, useCallback, useState } from "react";
import styled from "styled-components";
import {
  drawSpectrum,
  drawSpectrumGrid,
  drawSpectrumTrace,
  drawSpectrumMarkers,
  FrequencyRange,
} from "@n-apt/fft/FFTCanvasRenderer";
import {
  drawWaterfall,
  addWaterfallFrame,
  spectrumToAmplitude,
} from "@n-apt/waterfall/FIFOWaterfallRenderer";
import { FFTWebGPU } from "@n-apt/gpu/FFTWebGPU";
import { OverlayTextureRenderer } from "@n-apt/gpu/OverlayTextureRenderer";
import { WaterfallWebGPU } from "@n-apt/gpu/WaterfallWebGPU";
import { getPreferredCanvasFormat, getWebGPUDevice, isWebGPUSupported } from "@n-apt/gpu/webgpu";
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

// Import SDR processor for WASM FFT processing
let sdrProcessor: any = null;
console.log("🚀 Initializing WASM FFT Pipeline...");

// WebGPU pre-warming removed to prevent memory issues

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
`;

/**
 * Props for FFTCanvas component
 */
interface FFTCanvasProps {
  /** FFT data containing waveform and metadata */
  data: any;
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
const FFTCanvas = ({
  data,
  frequencyRange,
  centerFrequencyMHz,
  activeSignalArea: _activeSignalArea,
  isPaused,
  isDeviceConnected = true,
  onFrequencyRangeChange,
  displayTemporalResolution = "medium",
  force2D = false,
  snapshotGridPreference = true,
}: FFTCanvasProps) => {
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumGpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallGpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallBufferRef = useRef<Uint8ClampedArray | null>(null);
  const waterfallDataWidthRef = useRef<number | null>(null);
  const bufferPoolRef = useRef<Uint8ClampedArray[]>([]);
  const maxBufferPoolSize = 3; // Reduced memory footprint

  // WebGPU resource pooling with lazy initialization
  const gpuBufferPoolRef = useRef<GPUBuffer[]>([]);
  const maxGpuBufferPoolSize = 3;
  const texturePoolRef = useRef<GPUTexture[]>([]);
  const maxTexturePoolSize = 2;

  // Lazy initialization state
  const [isInitialized, setIsInitialized] = useState(false);
  const [webgpuDevice, setWebgpuDevice] = useState<GPUDevice | null>(null);
  const [webgpuReady, setWebgpuReady] = useState(false);

  // Performance tracking removed to prevent memory leaks

  const getBufferFromPool = (size: number): Uint8ClampedArray => {
    const pool = bufferPoolRef.current;
    for (let i = 0; i < pool.length; i++) {
      const buffer = pool[i];
      if (buffer.length === size) {
        pool.splice(i, 1);
        buffer.fill(0); // Clear the buffer
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

  // Frame rate limiting function - more aggressive for performance
  const shouldRenderFrame = useCallback(() => {
    const now = performance.now();
    const elapsed = now - lastFrameTimeRef.current;

    if (elapsed >= frameRateLimiterRef.current) {
      lastFrameTimeRef.current = now;
      return true;
    }
    return false;
  }, []);

  // Aggressive frame skipping for performance
  const frameSkipCounterRef = useRef(0);
  const frameSkipThreshold = 1; // Skip every other frame under heavy load

  // Frame buffering for smooth rendering - optimized for memory
  const frameBufferRef = useRef<Float32Array[]>([]);
  const maxFrameBufferSize = 1; // Further reduced to minimize memory pressure
  const frameDropCounterRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const animationRunIdRef = useRef(0);
  const isVisibleRef = useRef(true);
  const lastRenderTimeRef = useRef(0);
  const targetFrameInterval = 1000 / 60; // 60 FPS for smoother animation
  const lastFrameTimeRef = useRef(0);
  const frameRateLimiterRef = useRef(16); // 60 FPS = ~16.67ms per frame
  const dataRef = useRef<any>(null);
  const lastProcessedDataRef = useRef<any>(null);
  const frequencyRangeRef = useRef<FrequencyRange>(frequencyRange);
  const centerFreqRef = useRef(centerFrequencyMHz);
  centerFreqRef.current = centerFrequencyMHz;


  // Lazy initialization for WebGPU resources
  const initializeWebGPU = useCallback(async () => {
    if (webgpuReady || force2D) return;

    try {
      const device = await getWebGPUDevice();
      if (!device) {
        console.warn("⚠️ WebGPU not available, falling back to 2D rendering");
        return;
      }

      setWebgpuDevice(device);
      setWebgpuReady(true);

      // Pre-allocate some GPU resources
      for (let i = 0; i < 2; i++) {
        const buffer = device.createBuffer({
          size: 1024 * 1024, // 1MB buffer
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        gpuBufferPoolRef.current.push(buffer);
      }

    } catch (error) {
      console.error("❌ WebGPU initialization failed:", error);
      setWebgpuReady(false);
    }
  }, [webgpuReady, force2D]);

  // Initialize WebGPU on first render
  useEffect(() => {
    if (!isInitialized && !force2D) {
      setIsInitialized(true);
      initializeWebGPU();
    }
  }, [isInitialized, initializeWebGPU, force2D]);

  // Memory cleanup function
  const performMemoryCleanup = useCallback(() => {
    // Clear frame buffer if it's getting too large
    const frameBuffer = frameBufferRef.current;
    if (frameBuffer.length > maxFrameBufferSize) {
      const excess = frameBuffer.splice(maxFrameBufferSize);
      excess.forEach(arr => arr.fill(0));
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
  }, []);

  // Mouse drag state for frequency adjustment
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartFreqRef = useRef(0);

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
  const spectrumRendererRef = useRef<FFTWebGPU | null>(null);
  const gridOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const markersOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const waterfallRendererRef = useRef<WaterfallWebGPU | null>(null);
  const webgpuDeviceRef = useRef<GPUDevice | null>(null);
  const webgpuFormatRef = useRef<GPUTextureFormat | null>(null);
  const webgpuContextLostRef = useRef(false);
  const webgpuRetryCountRef = useRef(0);
  const maxWebgpuRetries = 3;
  const waterfallDimsRef = useRef<{ width: number; height: number } | null>(null);
  const waterfallGpuDimsRef = useRef<{ width: number; height: number } | null>(null);
  const [webgpuEnabled, setWebgpuEnabled] = useState(false);
  const spectrumWebgpuEnabled = webgpuEnabled;

  const overlayDirtyRef = useRef({ grid: true, markers: true });
  const overlayLastUploadMsRef = useRef({ grid: 0, markers: 0 });
  const OVERLAY_MAX_FPS = 60;
  const OVERLAY_MIN_INTERVAL_MS = Math.round(1000 / OVERLAY_MAX_FPS);

  useEffect(() => {
    // Center frequency changes only affect marker overlay.
    overlayDirtyRef.current.markers = true;
  }, [centerFrequencyMHz]);

  useEffect(() => {
    // Device connectivity toggles whether red limit lines should display.
    overlayDirtyRef.current.markers = true;
  }, [isDeviceConnected]);

  /**
   * Variable Frequency Oscillator (VFO)
   * Acts as the primary frequency source - click/drag to tune frequency
   * Like a radio's tuning knob at the circuit level, this generates the
   * base oscillating signal that determines what "frequency" the WebGPU canvas/SDR device is on
   */
  useEffect(() => {
    const getActiveSpectrumCanvas = () => {
      // Always return the currently visible canvas
      if (spectrumWebgpuEnabled) {
        return spectrumGpuCanvasRef.current;
      } else {
        return spectrumCanvasRef.current;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const canvas = getActiveSpectrumCanvas();
      if (!isDraggingRef.current || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;

      // Calculate frequency change based on drag distance
      const deltaX = e.clientX - dragStartXRef.current;
      const freqRange = frequencyRangeRef.current.max - frequencyRangeRef.current.min;
      const freqChange = (deltaX / width) * freqRange;

      // Calculate new frequency range, respecting boundaries
      let newMinFreq = dragStartFreqRef.current + freqChange;
      const rangeWidth = frequencyRangeRef.current.max - frequencyRangeRef.current.min;
      let newMaxFreq = newMinFreq + rangeWidth;

      // Apply boundaries based on active signal area
      let minBoundary = 0;
      let maxBoundary = 4.47; // Default for area A

      if (_activeSignalArea === "B") {
        minBoundary = 24.72;
        maxBoundary = 29.88;
      }

      // Clamp to boundaries
      if (newMinFreq < minBoundary) {
        newMinFreq = minBoundary;
        newMaxFreq = newMinFreq + rangeWidth;
      }
      if (newMaxFreq > maxBoundary) {
        newMaxFreq = maxBoundary;
        newMinFreq = newMaxFreq - rangeWidth;
      }

      // Update frequency range
      const newRange = { min: newMinFreq, max: newMaxFreq };
      frequencyRangeRef.current = newRange;

      // Notify parent component
      if (onFrequencyRangeChange) {
        onFrequencyRangeChange(newRange);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      const canvas = getActiveSpectrumCanvas();
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();

      // Only start drag if clicking in the frequency axis area (bottom 60px)
      const height = rect.height;
      const y = e.clientY - rect.top;
      if (y >= height - 60) {
        isDraggingRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartFreqRef.current = frequencyRangeRef.current.min;
        canvas.style.cursor = "grabbing";
        canvas.setPointerCapture(e.pointerId); // Capture pointer for better drag experience
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const canvas = getActiveSpectrumCanvas();
      if (isDraggingRef.current && canvas) {
        canvas.style.cursor = "grab";
        canvas.releasePointerCapture(e.pointerId); // Release pointer capture
      }
      isDraggingRef.current = false;
    };

    const handlePointerEnter = () => {
      const canvas = getActiveSpectrumCanvas();
      if (canvas && !isDraggingRef.current) canvas.style.cursor = "grab";
    };

    const handlePointerLeave = () => {
      const canvas = getActiveSpectrumCanvas();
      if (canvas && !isDraggingRef.current) canvas.style.cursor = "default";
    };

    // Set up event listeners on both canvases but only activate the visible one
    const gpuCanvas = spectrumGpuCanvasRef.current;
    const canvas2D = spectrumCanvasRef.current;

    console.log("VFO: Setting up pointer event listeners", {
      gpuCanvas: !!gpuCanvas,
      canvas2D: !!canvas2D,
      spectrumWebgpuEnabled,
      visibleCanvas: !!getActiveSpectrumCanvas()
    });

    // Add pointer event listeners to both canvases
    [gpuCanvas, canvas2D].forEach(canvas => {
      if (canvas) {
        canvas.addEventListener("pointerdown", handlePointerDown);
        canvas.addEventListener("pointerenter", handlePointerEnter);
        canvas.addEventListener("pointerleave", handlePointerLeave);
        // Set cursor only on the currently visible canvas
        if (canvas === getActiveSpectrumCanvas()) {
          canvas.style.cursor = "grab";
        }
      }
    });

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      [gpuCanvas, canvas2D].forEach(canvas => {
        if (canvas) {
          canvas.removeEventListener("pointerdown", handlePointerDown);
          canvas.removeEventListener("pointerenter", handlePointerEnter);
          canvas.removeEventListener("pointerleave", handlePointerLeave);
        }
      });
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onFrequencyRangeChange, _activeSignalArea, spectrumWebgpuEnabled]);

  // Update cursor when canvas visibility changes
  useEffect(() => {
    const gpuCanvas = spectrumGpuCanvasRef.current;
    const canvas2D = spectrumCanvasRef.current;

    // Reset cursor on both canvases
    [gpuCanvas, canvas2D].forEach(canvas => {
      if (canvas) {
        canvas.style.cursor = "default";
      }
    });

    // Set grab cursor on the currently visible canvas
    const getActiveSpectrumCanvas = () => {
      return spectrumWebgpuEnabled ? spectrumGpuCanvasRef.current : spectrumCanvasRef.current;
    };

    const activeCanvas = getActiveSpectrumCanvas();
    if (activeCanvas && !isDraggingRef.current) {
      activeCanvas.style.cursor = "grab";
    }
  }, [spectrumWebgpuEnabled]);

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

  /**
   * Renders spectrum data using FFTCanvasRenderer
   * @param canvas - Canvas element to render on
   * @param spectrumData - Power spectrum data in dB
   */
  const renderSpectrum = useCallback(
    (canvas: HTMLCanvasElement, spectrumData: number[]) => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !spectrumData) return;

      // Use CSS dimensions (not scaled canvas dimensions) since ctx is already scaled
      const rect = canvas.parentElement?.getBoundingClientRect();
      const width = rect?.width || canvas.width;
      const height = rect?.height || canvas.height;

      if (displayTemporalResolution === "high") {
        // Check if we should draw grid (respect snapshot preference)
        const shouldDrawGrid = snapshotGridPreferenceRef.current;
        if (shouldDrawGrid) {
          drawSpectrumGrid({
            ctx,
            width,
            height,
            frequencyRange: frequencyRangeRef.current,
            clearBackground: true,
          });
        } else {
          // Clear background without grid
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, width, height);
        }

        const fftAreaMax = { x: width - 40, y: height - 40 };
        const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
        const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
        const dataWidth = spectrumData.length;
        if (dataWidth <= 1) return;

        const vertRange = FFT_MAX_DB - FFT_MIN_DB;
        const scaleFactor = fftHeight / vertRange;

        ctx.fillStyle = LINE_COLOR;
        const step = width < 700 ? 2 : 1;
        for (let i = 0; i < dataWidth; i += step) {
          const x = Math.round(FFT_AREA_MIN.x + (i / (dataWidth - 1)) * plotWidth);
          const y = Math.round(
            Math.max(
              FFT_AREA_MIN.y + 1,
              Math.min(fftAreaMax.y, fftAreaMax.y - (spectrumData[i] - FFT_MIN_DB) * scaleFactor),
            ),
          );
          ctx.fillRect(x, y, 1, 1);
        }
      } else {
        // Check if we should draw grid (respect snapshot preference)
        const shouldDrawGrid = snapshotGridPreferenceRef.current;
        if (shouldDrawGrid) {
          drawSpectrum({
            ctx,
            width,
            height,
            waveform: spectrumData,
            frequencyRange: frequencyRangeRef.current,
          });
        } else {
          // Clear background without grid
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, width, height);
          // Draw only the spectrum trace
          drawSpectrumTrace({
            ctx,
            width,
            height,
            waveform: spectrumData,
            frequencyRange: frequencyRangeRef.current,
          });
        }
      }
    },
    [displayTemporalResolution],
  );

  const ensureFloat32Waveform = useCallback((spectrumData: number[]) => {
    if (!spectrumData || !Array.isArray(spectrumData) || spectrumData.length === 0) {
      console.warn("Invalid spectrum data provided, using fallback");
      return new Float32Array(1024).fill(-120);
    }

    // Validate data contains only finite numbers
    const hasValidData = spectrumData.some((v) => Number.isFinite(v));
    if (!hasValidData) {
      console.warn("Spectrum data contains no valid values, using fallback");
      return new Float32Array(1024).fill(-120);
    }

    if (spectrumData instanceof Float32Array) {
      return spectrumData;
    }
    return Float32Array.from(spectrumData);
  }, []);

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
          sdrProcessor.resample_spectrum(new Float32Array(spectrumData), float32Output, waterfallWidth);
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

  useEffect(() => {
    if (!isWebGPUSupported()) {
      console.log("📱 WebGPU not supported - using 2D canvas rendering");
      return;
    }
    if (force2D) {
      console.log("🎨 Force 2D mode enabled - using 2D canvas rendering");
      return;
    }

    let cancelled = false;
    const initializeWebGPU = async (retryCount = 0) => {
      try {
        const device = await getWebGPUDevice();
        if (!device || cancelled) {
          throw new Error("Failed to get WebGPU device");
        }

        webgpuDeviceRef.current = device;
        webgpuFormatRef.current = getPreferredCanvasFormat();
        webgpuContextLostRef.current = false;
        webgpuRetryCountRef.current = 0;

        device.onuncapturederror = () => {
          // Silently handle WebGPU errors - app will fall back to 2D
          webgpuContextLostRef.current = true;
          setWebgpuEnabled(false);

          // Attempt recovery
          if (webgpuRetryCountRef.current < maxWebgpuRetries) {
            webgpuRetryCountRef.current++;
            setTimeout(() => {
              if (!cancelled) {
                initializeWebGPU(webgpuRetryCountRef.current);
              }
            }, 1000 * webgpuRetryCountRef.current);
          }
        };

        device.lost?.then(() => {
          // Silently handle WebGPU device loss - app will fall back to 2D
          webgpuContextLostRef.current = true;
          setWebgpuEnabled(false);

          // Attempt recovery
          if (webgpuRetryCountRef.current < maxWebgpuRetries) {
            webgpuRetryCountRef.current++;
            setTimeout(() => {
              if (!cancelled) {
                initializeWebGPU(webgpuRetryCountRef.current);
              }
            }, 1000 * webgpuRetryCountRef.current);
          }
        });

        setWebgpuEnabled(true);
        console.log("✅ WebGPU initialized successfully - using GPU acceleration");
      } catch (error) {
        // Silently handle WebGPU initialization failure - app will fall back to 2D
        webgpuContextLostRef.current = true;
        setWebgpuEnabled(false);

        // Retry if we haven't exhausted attempts
        if (retryCount < maxWebgpuRetries) {
          setTimeout(
            () => {
              if (!cancelled) {
                initializeWebGPU(retryCount + 1);
              }
            },
            1000 * (retryCount + 1),
          );
        }
      }
    };

    initializeWebGPU();

    return () => {
      cancelled = true;
    };
  }, [force2D]);

  useEffect(() => {
    if (!webgpuEnabled || webgpuContextLostRef.current) return;
    const device = webgpuDeviceRef.current;
    const format = webgpuFormatRef.current;
    if (!device || !format) return;

    if (spectrumGpuCanvasRef.current && !spectrumRendererRef.current) {
      try {
        spectrumRendererRef.current = new FFTWebGPU(spectrumGpuCanvasRef.current, device, format);
        gridOverlayRendererRef.current = new OverlayTextureRenderer(device, format);
        markersOverlayRendererRef.current = new OverlayTextureRenderer(device, format);
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;
      } catch (error) {
        console.error("Failed to create spectrum renderer:", error);
        webgpuContextLostRef.current = true;
        setWebgpuEnabled(false);
        return;
      }
    }

    if (waterfallGpuCanvasRef.current && !waterfallRendererRef.current) {
      try {
        waterfallRendererRef.current = new WaterfallWebGPU(
          waterfallGpuCanvasRef.current,
          device,
          format,
        );
      } catch (error) {
        console.error("Failed to create waterfall renderer:", error);
        webgpuContextLostRef.current = true;
        setWebgpuEnabled(false);
        return;
      }
    }
  }, [webgpuEnabled]);

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

  const resampleSpectrumInto = useCallback((input: Float32Array, output: Float32Array) => {
    const srcLen = input.length;
    const outLen = output.length;
    if (srcLen === 0 || outLen === 0) return;

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
  const animate = useCallback(() => {
    const runId = animationRunIdRef.current;
    const now = performance.now();

    // Clear performance measures to prevent memory leak from React dev profiling
    // and WebGPU state changes that accumulate PerformanceMeasure objects
    performance.clearMeasures();

    // Aggressive frame skipping for performance
    frameSkipCounterRef.current++;
    if (frameSkipCounterRef.current < frameSkipThreshold) {
      animationFrameRef.current = requestAnimationFrame(() => {
        if (animationRunIdRef.current === runId) {
          animate();
        }
      });
      return;
    }
    frameSkipCounterRef.current = 0;

    // Frame rate limiting to prevent excessive renders
    if (now - lastRenderTimeRef.current < targetFrameInterval) {
      animationFrameRef.current = requestAnimationFrame(() => {
        if (animationRunIdRef.current === runId) {
          animate();
        }
      });
      return;
    }

    lastRenderTimeRef.current = now;

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
          frameDropCounterRef.current++;
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
    // Early exit conditions to reduce unnecessary work
    if (!waveform || !isVisibleRef.current || waveform.length === 0) {
      // Skip rendering if no valid waveform or not visible
      animationFrameRef.current = requestAnimationFrame(() => {
        if (animationRunIdRef.current === runId) {
          animate();
        }
      });
      return;
    }

    // Always render existing waveform, but only update with new data when not paused and visible
    if (isVisibleRef.current && waveform.length > 0) {
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
        if (waveform.length === displayWidth) {
          outBuf.set(waveform);
        } else {
          resampleSpectrumInto(waveform, outBuf);
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
        renderSpectrum(spectrumCanvas, Array.from(waveform));
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
            if (sdrProcessor && waveform.length >= 4) {
              const float32Output = new Float32Array(dims.width);
              try {
                sdrProcessor.resample_spectrum(waveform, float32Output, dims.width);
                resampled = Array.from(float32Output);
              } catch (error) {
                console.warn("WASM SIMD resampling failed, using fallback:", error);
                resampled = performScalarResampling(Array.from(waveform), dims.width);
              }
            } else {
              resampled = performScalarResampling(Array.from(waveform), dims.width);
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
          renderWaterfall(waterfallCanvas, Array.from(waveform));
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

    // Schedule next frame only if visible and not destroyed
    if (animationRunIdRef.current === runId && isVisibleRef.current) {
      animationFrameRef.current = requestAnimationFrame(() => {
        if (animationRunIdRef.current === runId) {
          animate();
        }
      });
    } else {
      animationFrameRef.current = null;
    }
  }, [
    renderSpectrum,
    renderWaterfall,
    isPaused,
    ensureFloat32Waveform,
    displayTemporalResolution,
    maybeUpdateOverlays,
    resampleSpectrumInto,
  ]);

  useEffect(() => {
    dataRef.current = data;

    // Perform periodic memory cleanup - reduced frequency to reduce overhead
    const cleanupInterval = setInterval(() => {
      performMemoryCleanup();
    }, 30000); // Every 30 seconds instead of 10

    return () => {
      clearInterval(cleanupInterval);
    };
  }, [data, performMemoryCleanup]);

  useEffect(() => {
    // Update frequency range ref for new lines only
    // Old waterfall lines stay exactly where they are (no horizontal shifting)
    const prevRange = frequencyRangeRef.current;
    frequencyRangeRef.current = frequencyRange;

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
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Re-render when browser tab becomes visible (WebGPU context may need recovery)
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === "visible";
      if (isVisibleRef.current) {
        // Force redraw of last known data when becoming visible
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;

        // Trigger a resize to ensure WebGPU context is recovered
        resizeCanvas();

        // If we have data but animation stopped, restart it
        if (dataRef.current && !animationFrameRef.current) {
          animationRunIdRef.current += 1;
          animate();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    let resizeTimeout: any = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        resizeCanvas();
      }, 16); // Reduced from 100ms to 16ms for better responsiveness
    });

    const spectrumParent = spectrumCanvas?.parentElement ?? spectrumGpuCanvas?.parentElement;
    const waterfallParent = waterfallCanvas?.parentElement ?? waterfallGpuCanvas?.parentElement;

    if (spectrumParent) resizeObserver.observe(spectrumParent);
    if (waterfallParent) resizeObserver.observe(waterfallParent);

    // Kill any previous RAF loop before starting a new one (prevents double draw)
    animationRunIdRef.current += 1;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [animate, webgpuEnabled, spectrumWebgpuEnabled]);

  return (
    <VisualizerContainer>
      <SpectrumSection>
        <SectionTitle>FFT Signal Display {isPaused && "(Paused)"}</SectionTitle>
        <CanvasWrapper>
          <CanvasLayer
            ref={spectrumGpuCanvasRef}
            id="fft-spectrum-canvas-webgpu"
            style={{ display: spectrumWebgpuEnabled ? "block" : "none", zIndex: 0 }}
          />
          <CanvasLayer
            ref={spectrumCanvasRef}
            id="fft-spectrum-canvas-2d"
            style={{ display: spectrumWebgpuEnabled ? "none" : "block", zIndex: 0 }}
          />
        </CanvasWrapper>
      </SpectrumSection>
      <WaterfallSection>
        <SectionTitle>Waterfall Display {isPaused && "(Paused)"}</SectionTitle>
        <CanvasWrapper>
          <CanvasLayer
            ref={waterfallGpuCanvasRef}
            id="fft-waterfall-canvas-webgpu"
            style={{ display: webgpuEnabled ? "block" : "none", zIndex: 0 }}
          />
          <CanvasLayer
            ref={waterfallCanvasRef}
            id="fft-waterfall-canvas-2d"
            style={{ display: webgpuEnabled ? "none" : "block", zIndex: 0 }}
          />
        </CanvasWrapper>
      </WaterfallSection>
    </VisualizerContainer>
  );
};

export default FFTCanvas;
