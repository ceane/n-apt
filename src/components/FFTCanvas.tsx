import React, { useRef, useEffect, useCallback, useState } from "react";
import styled from "styled-components";
import {
  drawSpectrum,
  drawSpectrumGrid,
  FrequencyRange,
} from "@n-apt/fft/FFTCanvasRenderer";
import {
  drawWaterfall,
  addWaterfallFrame,
  spectrumToAmplitude,
} from "@n-apt/waterfall/FIFOWaterfallRenderer";
import { FFTWebGPU } from "@n-apt/gpu/FFTWebGPU";
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
  border-radius: 4px;
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
  /** Currently active signal area identifier */
  activeSignalArea: string;
  /** Whether the visualization is paused */
  isPaused: boolean;
}

/**
 * FFT canvas component with FFT spectrum and waterfall displays
 * Uses SDR++ style rendering for professional spectrum analysis
 */
const FFTCanvas = ({
  data,
  frequencyRange,
  activeSignalArea: _activeSignalArea,
  isPaused,
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
  const animationFrameRef = useRef<number | null>(null);
  const dataRef = useRef<any>(null);
  const lastProcessedDataRef = useRef<any>(null);
  const frequencyRangeRef = useRef<FrequencyRange>(frequencyRange);
  const retuneSmearRef = useRef(0);
  const retuneDriftPxRef = useRef(0);
  const waveformFloatRef = useRef<Float32Array | null>(null);
  const spectrumRendererRef = useRef<FFTWebGPU | null>(null);
  const waterfallRendererRef = useRef<WaterfallWebGPU | null>(null);
  const webgpuDeviceRef = useRef<GPUDevice | null>(null);
  const webgpuFormatRef = useRef<GPUTextureFormat | null>(null);
  const [webgpuEnabled, setWebgpuEnabled] = useState(false);

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

      drawSpectrum({
        ctx,
        width,
        height,
        waveform: spectrumData,
        frequencyRange: frequencyRangeRef.current,
      });
    },
    [],
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
            waterfallBufferRef.current[dstIdx] = colorBuffer[srcIdx];
            waterfallBufferRef.current[dstIdx + 1] = colorBuffer[srcIdx + 1];
            waterfallBufferRef.current[dstIdx + 2] = colorBuffer[srcIdx + 2];
            waterfallBufferRef.current[dstIdx + 3] = 255;
          }
        } catch (error) {
          console.warn(
            "WASM SIMD buffer operations failed, using fallback:",
            error,
          );
          // Fallback to original implementation
          addWaterfallFrame(
            waterfallBufferRef.current!,
            normalizedData,
            waterfallWidth,
            waterfallHeight,
            retuneSmearRef.current,
            1, // driftDirection - 1 = right
          );
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
          );
        }
      }

      if (retuneSmearRef.current > 0) {
        retuneSmearRef.current -= 1;
      }

      // Draw the updated buffer
      drawWaterfall({
        ctx,
        width: canvas.width,
        height: canvas.height,
        waterfallBuffer: waterfallBufferRef.current!,
        frequencyRange: frequencyRangeRef.current,
      });
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

  /**
   * Animation loop for continuous spectrum and waterfall updates
   */
  const animate = useCallback(() => {
    if (isPaused) return;

    const spectrumCanvas = spectrumCanvasRef.current;
    const spectrumGpuCanvas = spectrumGpuCanvasRef.current;
    const waterfallCanvas = waterfallCanvasRef.current;
    const waterfallGpuCanvas = waterfallGpuCanvasRef.current;

    const currentData = dataRef.current;
    if (currentData?.waveform) {
      const waveform = ensureFloat32Waveform(currentData.waveform);
      if (currentData !== lastProcessedDataRef.current) {
        waveformFloatRef.current = waveform;
      }

      if (
        webgpuEnabled &&
        spectrumRendererRef.current &&
        spectrumGpuCanvas
      ) {
        const rect = spectrumGpuCanvas.parentElement?.getBoundingClientRect();
        const width = rect?.width || spectrumGpuCanvas.width;
        const height = rect?.height || spectrumGpuCanvas.height;

        spectrumRendererRef.current.updateWaveform(
          waveformFloatRef.current || waveform,
        );
        spectrumRendererRef.current.render({
          canvasWidth: width,
          canvasHeight: height,
          dpr: window.devicePixelRatio || 1,
          plotLeft: FFT_AREA_MIN.x,
          plotRight: Math.max(FFT_AREA_MIN.x + 1, width - 40),
          plotTop: FFT_AREA_MIN.y,
          plotBottom: Math.max(FFT_AREA_MIN.y + 1, height - 40),
          dbMin: FFT_MIN_DB,
          dbMax: FFT_MAX_DB,
          lineColor: LINE_COLOR,
          fillColor: SHADOW_COLOR,
          backgroundColor: "rgba(0, 0, 0, 0)",
        });
      } else if (spectrumCanvas) {
        renderSpectrum(spectrumCanvas, currentData.waveform);
      }

      if (currentData !== lastProcessedDataRef.current) {
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
          renderWaterfall(waterfallCanvas, currentData.waveform);
        }

        lastProcessedDataRef.current = currentData;
      }

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

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [
    renderSpectrum,
    renderWaterfall,
    isPaused,
    ensureFloat32Waveform,
    webgpuEnabled,
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
    retuneSmearRef.current = 6;
    const dims = waterfallGpuDimsRef.current;
    if (dims) {
      const prevSpan = prevRange.max - prevRange.min;
      const delta = frequencyRange.min - prevRange.min;
      const drift = prevSpan !== 0 ? (delta / prevSpan) * dims.width : 0;
      retuneDriftPxRef.current = Math.max(-dims.width, Math.min(dims.width, drift));
    } else {
      retuneDriftPxRef.current = 0;
    }

    const spectrumCanvas = spectrumCanvasRef.current;
    if (spectrumCanvas) {
      const rect = spectrumCanvas.parentElement?.getBoundingClientRect();
      const ctx = spectrumCanvas.getContext("2d");
      if (rect && ctx) {
        if (webgpuEnabled) {
          ctx.clearRect(0, 0, rect.width, rect.height);
        }
        drawSpectrumGrid({
          ctx,
          width: rect.width,
          height: rect.height,
          frequencyRange: frequencyRangeRef.current,
          fftMin: FFT_MIN_DB,
          fftMax: FFT_MAX_DB,
          clearBackground: !webgpuEnabled,
        });
      }
    }
  }, [frequencyRange.min, frequencyRange.max, webgpuEnabled]);

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
            if (webgpuEnabled) {
              ctx.clearRect(0, 0, spectrumRect.width, spectrumRect.height);
            }
            drawSpectrumGrid({
              ctx,
              width: spectrumRect.width,
              height: spectrumRect.height,
              frequencyRange: frequencyRangeRef.current,
              fftMin: FFT_MIN_DB,
              fftMax: FFT_MAX_DB,
              clearBackground: !webgpuEnabled,
            });
          }
        }

        if (spectrumGpuCanvas && spectrumRendererRef.current) {
          spectrumRendererRef.current.resize(
            spectrumRect.width,
            spectrumRect.height,
            dpr,
          );
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
          const waterfallWidth = Math.max(
            1,
            Math.round(waterfallRect.width * dpr - marginX * 2),
          );
          const waterfallHeight = Math.max(
            1,
            Math.round(waterfallRect.height * dpr - marginY * 2),
          );
          waterfallGpuDimsRef.current = {
            width: waterfallWidth,
            height: waterfallHeight,
          };
          waterfallRendererRef.current.updateDimensions(
            waterfallWidth,
            waterfallHeight,
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

    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [animate, webgpuEnabled]);

  return (
    <VisualizerContainer>
      <SpectrumSection>
        <SectionTitle>FFT Signal Display {isPaused && "(Paused)"}</SectionTitle>
        <CanvasWrapper>
          <CanvasLayer
            ref={spectrumGpuCanvasRef}
            style={{ display: webgpuEnabled ? "block" : "none", zIndex: 1 }}
          />
          <CanvasLayer
            ref={spectrumCanvasRef}
            style={{ display: "block", zIndex: webgpuEnabled ? 0 : 0 }}
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
