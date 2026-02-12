import React, { useRef, useEffect, useCallback, useState } from "react";
import styled from "styled-components";
import {
  drawSpectrum,
  drawSpectrumGrid,
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
import {
  getPreferredCanvasFormat,
  getWebGPUDevice,
  isWebGPUSupported,
} from "@n-apt/gpu/webgpu";
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
    console.log("   - FFT Size: 1024");
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
  flex: 1;
  position: relative;
  background-color: #0a0a0a;
  border: 1px solid ${CANVAS_BORDER_COLOR};
  border-radius: 8px;
  overflow: hidden;
`;

const CanvasLayer = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
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
  displayTemporalResolution?: "low" | "medium" | "high";
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
  displayTemporalResolution = "medium",
}: FFTCanvasProps) => {
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumGpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallGpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallBufferRef = useRef<Uint8ClampedArray | null>(null);
  const waterfallDimsRef = useRef<{ width: number; height: number } | null>(
    null,
  );
  const waterfallGpuDimsRef = useRef<{ width: number; height: number } | null>(
    null,
  );
  const waterfallDataWidthRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const animationRunIdRef = useRef(0);
  const dataRef = useRef<any>(null);
  const lastProcessedDataRef = useRef<any>(null);
  const frequencyRangeRef = useRef<FrequencyRange>(frequencyRange);
  const retuneSmearRef = useRef(0);
  const retuneDriftPxRef = useRef(0);
  const waveformFloatRef = useRef<Float32Array | null>(null);
  const renderWaveformRef = useRef<Float32Array | null>(null);
  const spectrumResampleBufRef = useRef<Float32Array | null>(null);
  const spectrumRendererRef = useRef<FFTWebGPU | null>(null);
  const gridOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const markersOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const waterfallRendererRef = useRef<WaterfallWebGPU | null>(null);
  const webgpuDeviceRef = useRef<GPUDevice | null>(null);
  const webgpuFormatRef = useRef<GPUTextureFormat | null>(null);
  const [webgpuEnabled, setWebgpuEnabled] = useState(false);
  const spectrumWebgpuEnabled = webgpuEnabled;
  const centerFreqRef = useRef(centerFrequencyMHz);
  centerFreqRef.current = centerFrequencyMHz;

  const overlayDirtyRef = useRef({ grid: true, markers: true });
  const overlayLastUploadMsRef = useRef({ grid: 0, markers: 0 });
  const OVERLAY_MAX_FPS = 30;
  const OVERLAY_MIN_INTERVAL_MS = Math.round(1000 / OVERLAY_MAX_FPS);

  useEffect(() => {
    // Center frequency changes only affect marker overlay.
    overlayDirtyRef.current.markers = true;
  }, [centerFrequencyMHz]);

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
          });
          overlay.endDraw();
          overlayDirtyRef.current.markers = false;
          overlayLastUploadMsRef.current.markers = now;
        }
      }
    },
    [],
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
        drawSpectrumGrid({
          ctx,
          width,
          height,
          frequencyRange: frequencyRangeRef.current,
          clearBackground: true,
        });

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
              Math.min(
                fftAreaMax.y,
                fftAreaMax.y - (spectrumData[i] - FFT_MIN_DB) * scaleFactor,
              ),
            ),
          );
          ctx.fillRect(x, y, 1, 1);
        }
      } else {
        drawSpectrum({
          ctx,
          width,
          height,
          waveform: spectrumData,
          frequencyRange: frequencyRangeRef.current,
        });
      }
    },
    [displayTemporalResolution],
  );

  const ensureFloat32Waveform = useCallback((spectrumData: number[]) => {
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
      const waterfallWidth = Math.max(
        1,
        Math.round(canvas.width - marginX * 2),
      );
      const waterfallHeight = Math.max(
        1,
        Math.round(canvas.height - marginY * 2),
      );

      // Ensure buffer exists and matches display area; preserve content on resize
      const currentBuf = waterfallBufferRef.current;
      const currentDims = waterfallDimsRef.current;

      if (
        currentBuf &&
        currentDims &&
        currentDims.width === waterfallWidth &&
        currentDims.height === waterfallHeight
      ) {
        // Buffer is already correct size, no action needed
      } else {
        const newBuf = new Uint8ClampedArray(
          waterfallWidth * waterfallHeight * 4,
        );

        if (currentBuf && currentDims) {
          const copyW = Math.min(currentDims.width, waterfallWidth);
          const copyH = Math.min(currentDims.height, waterfallHeight);

          for (let y = 0; y < copyH; y++) {
            const srcRowStart = y * currentDims.width * 4;
            const dstRowStart = y * waterfallWidth * 4;
            newBuf.set(
              currentBuf.subarray(srcRowStart, srcRowStart + copyW * 4),
              dstRowStart,
            );
          }
        } else {
          newBuf.fill(0);
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
        resampled = new Array(waterfallWidth);
        const float32Input = new Float32Array(spectrumData);
        const float32Output = new Float32Array(waterfallWidth);

        try {
          sdrProcessor.resample_spectrum(
            float32Input,
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

      // Use SIMD-accelerated buffer shifting if available
      if (sdrProcessor && waterfallBufferRef.current) {
        try {
          sdrProcessor.shift_waterfall_buffer(
            waterfallBufferRef.current,
            waterfallWidth,
            waterfallHeight,
          );

          // Apply color mapping for new top row using SIMD
          const colorBuffer = new Uint8ClampedArray(waterfallWidth * 4);
          const amplitudeFloat32 = new Float32Array(normalizedData);

          sdrProcessor.apply_color_mapping(amplitudeFloat32, colorBuffer, 1.0);

          // Copy new color data to top row
          for (let x = 0; x < waterfallWidth; x++) {
            const srcIdx = x * 4;
            const dstIdx = x * 4;
            if (waterfallBufferRef.current) {
              waterfallBufferRef.current[dstIdx] = colorBuffer[srcIdx];
              waterfallBufferRef.current[dstIdx + 1] = colorBuffer[srcIdx + 1];
              waterfallBufferRef.current[dstIdx + 2] = colorBuffer[srcIdx + 2];
              waterfallBufferRef.current[dstIdx + 3] = 255;
            }
          }
        } catch (error) {
          console.warn(
            "WASM SIMD buffer operations failed, using fallback:",
            error,
          );
          // Fallback to original implementation
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
        }
      } else {
        // Fallback to original implementation
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
    if (!isWebGPUSupported()) return;

    let cancelled = false;
    (async () => {
      const device = await getWebGPUDevice();
      if (!device || cancelled) return;
      webgpuDeviceRef.current = device;
      webgpuFormatRef.current = getPreferredCanvasFormat();
      device.onuncapturederror = (event) => {
        console.error("WebGPU error:", event.error);
        setWebgpuEnabled(false);
      };
      setWebgpuEnabled(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!webgpuEnabled) return;
    const device = webgpuDeviceRef.current;
    const format = webgpuFormatRef.current;
    if (!device || !format) return;

    if (spectrumGpuCanvasRef.current && !spectrumRendererRef.current) {
      spectrumRendererRef.current = new FFTWebGPU(
        spectrumGpuCanvasRef.current,
        device,
        format,
      );
      gridOverlayRendererRef.current = new OverlayTextureRenderer(device, format);
      markersOverlayRendererRef.current = new OverlayTextureRenderer(device, format);
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
    }

    if (waterfallGpuCanvasRef.current && !waterfallRendererRef.current) {
      waterfallRendererRef.current = new WaterfallWebGPU(
        waterfallGpuCanvasRef.current,
        device,
        format,
      );
    }
  }, [webgpuEnabled]);

  /**
   * Fallback scalar resampling implementation
   *
   * @param spectrumData - Input spectrum data
   * @param waterfallWidth - Target width
   * @returns Resampled data array
   */
  const performScalarResampling = (
    spectrumData: number[],
    waterfallWidth: number,
  ): number[] => {
    const resampled: number[] = new Array(waterfallWidth);
    const srcLen = spectrumData.length;
    for (let x = 0; x < waterfallWidth; x++) {
      const start = Math.floor((x * srcLen) / waterfallWidth);
      const end = Math.max(
        start + 1,
        Math.floor(((x + 1) * srcLen) / waterfallWidth),
      );
      let maxVal = -Infinity;
      for (let i = start; i < end && i < srcLen; i++) {
        const v = spectrumData[i];
        if (v > maxVal) maxVal = v;
      }
      resampled[x] =
        maxVal === -Infinity
          ? spectrumData[Math.min(start, srcLen - 1)]
          : maxVal;
    }
    return resampled;
  };

  const resampleSpectrumInto = useCallback(
    (input: Float32Array, output: Float32Array) => {
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
        output[x] = maxVal !== -Infinity ? maxVal : input[Math.min(start, srcLen - 1)] ?? -120;
      }
    },
    [],
  );

  /**
   * Animation loop for continuous spectrum and waterfall updates
   * While paused: keep rendering the last cached waveform without ingesting new data.
   */
  const animate = useCallback(() => {
    const runId = animationRunIdRef.current;
    const spectrumCanvas = spectrumCanvasRef.current;
    const spectrumGpuCanvas = spectrumGpuCanvasRef.current;
    const waterfallCanvas = waterfallCanvasRef.current;
    const waterfallGpuCanvas = waterfallGpuCanvasRef.current;

    const currentData = dataRef.current;

    if (!isPaused && currentData?.waveform) {
      const waveform = ensureFloat32Waveform(currentData.waveform);
      if (currentData !== lastProcessedDataRef.current) {
        waveformFloatRef.current = waveform;
        lastProcessedDataRef.current = currentData;

        if (displayTemporalResolution === "high") {
          const prev = renderWaveformRef.current;
          if (!prev || prev.length !== waveform.length) {
            renderWaveformRef.current = new Float32Array(waveform);
          } else {
            prev.set(waveform);
          }
        } else {
          const alpha = displayTemporalResolution === "low" ? 0.15 : 0.4;
          const prev = renderWaveformRef.current;
          if (!prev || prev.length !== waveform.length) {
            renderWaveformRef.current = new Float32Array(waveform);
          } else {
            for (let i = 0; i < waveform.length; i++) {
              prev[i] = alpha * waveform[i] + (1.0 - alpha) * prev[i];
            }
          }
        }
      }
    }

    const waveform = renderWaveformRef.current;
    if (waveform) {
      // Spectrum render
      if (spectrumWebgpuEnabled && spectrumRendererRef.current && spectrumGpuCanvas) {
        const rect = spectrumGpuCanvas.parentElement?.getBoundingClientRect();
        const width = rect?.width || spectrumGpuCanvas.width;
        const height = rect?.height || spectrumGpuCanvas.height;
        const displayWidth = Math.max(
          1,
          Math.floor(width - FFT_AREA_MIN.x - 40),
        );

        // Always downsample to ~pixel width to avoid "curtains" (many points
        // mapping to the same x pixel creates dense vertical lines).
        if (
          !spectrumResampleBufRef.current ||
          spectrumResampleBufRef.current.length !== displayWidth
        ) {
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

        spectrumRendererRef.current.render({
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
        }, {
          pre: gridOverlayRendererRef.current,
          post: markersOverlayRendererRef.current,
        });
      } else if (spectrumCanvas) {
        // Use 2D fallback
        renderSpectrum(spectrumCanvas, Array.from(waveform));
        // Draw markers on top of the 2D-rendered spectrum
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
          });
        }
      }

      // Waterfall render (only push new lines when not paused)
      if (!isPaused && currentData) {
        if (
          webgpuEnabled &&
          waterfallRendererRef.current &&
          waterfallGpuCanvas
        ) {
          const dims = waterfallGpuDimsRef.current;
          if (dims) {
            let resampled: number[];
            if (sdrProcessor && waveform.length >= 4) {
              resampled = new Array(dims.width);
              const float32Output = new Float32Array(dims.width);
              try {
                sdrProcessor.resample_spectrum(
                  waveform,
                  float32Output,
                  dims.width,
                );
                resampled = Array.from(float32Output);
              } catch (error) {
                console.warn(
                  "WASM SIMD resampling failed, using fallback:",
                  error,
                );
                resampled = performScalarResampling(
                  Array.from(waveform),
                  dims.width,
                );
              }
            } else {
              resampled = performScalarResampling(
                Array.from(waveform),
                dims.width,
              );
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
        } else if (waterfallCanvas) {
          renderWaterfall(waterfallCanvas, Array.from(waveform));
        }
      }

      // Always render existing waterfall buffer (WebGPU)
      if (
        webgpuEnabled &&
        waterfallRendererRef.current &&
        waterfallGpuCanvas
      ) {
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

    animationFrameRef.current = requestAnimationFrame(() => {
      if (animationRunIdRef.current !== runId) return;
      animate();
    });
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
  }, [data]);

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
          spectrumRendererRef.current.resize(
            spectrumRect.width,
            spectrumRect.height,
            dpr,
          );

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
          waterfallRendererRef.current.resize(
            waterfallRect.width,
            waterfallRect.height,
            dpr,
          );

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
          if (!waterfallDataWidthRef.current) {
            waterfallDataWidthRef.current = displayWidth;
          }
          const dataWidth = waterfallDataWidthRef.current;
          waterfallGpuDimsRef.current = {
            width: dataWidth,
            height: displayHeight,
          };
          waterfallRendererRef.current.updateDimensions(
            dataWidth,
            displayHeight,
          );
        }
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    let resizeTimeout: any = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        resizeCanvas();
      }, 100);
    });

    const spectrumParent =
      spectrumCanvas?.parentElement ?? spectrumGpuCanvas?.parentElement;
    const waterfallParent =
      waterfallCanvas?.parentElement ?? waterfallGpuCanvas?.parentElement;

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
            style={{ display: spectrumWebgpuEnabled ? "block" : "none", zIndex: 0 }}
          />
          <CanvasLayer
            ref={spectrumCanvasRef}
            style={{ display: spectrumWebgpuEnabled ? "none" : "block", zIndex: 0 }}
          />
        </CanvasWrapper>
      </SpectrumSection>
      <WaterfallSection>
        <SectionTitle>Waterfall Display {isPaused && "(Paused)"}</SectionTitle>
        <CanvasWrapper>
          <CanvasLayer
            ref={waterfallGpuCanvasRef}
            style={{ display: webgpuEnabled ? "block" : "none", zIndex: 0 }}
          />
          <CanvasLayer
            ref={waterfallCanvasRef}
            style={{ display: webgpuEnabled ? "none" : "block", zIndex: 0 }}
          />
        </CanvasWrapper>
      </WaterfallSection>
    </VisualizerContainer>
  );
};

export default FFTCanvas;
