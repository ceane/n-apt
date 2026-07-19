import { memo, useRef, useEffect, useState, useMemo, useCallback } from "react";
import styled from "styled-components";
import { WATERFALL_CANVAS_BG, FFT_MIN_DB, FFT_MAX_DB } from "@n-apt/consts";
import CanvasPlaceholder, {
  type CanvasPlaceholderState,
} from "@n-apt/components/ui/CanvasPlaceholder";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/hooks/useDrawWebGPUFIFOWaterfall";
import {
  createFifoWaterfall2DRenderer,
  type FifoWaterfall2DRenderer,
} from "@n-apt/utils/rendering/fifoWaterfall2d";

interface FrequencyRange {
  min: number;
  max: number;
}

interface FIFOWaterfallProps {
  width: number;
  height: number;
  waveform: Float32Array | null;
  frequencyRange: FrequencyRange;
  onWaterfallBufferChange?: (buffer: Uint8ClampedArray) => void;
  retuneSmear: number;
  isPaused: boolean;
  isVisible: boolean;
  performScalarResampling: (
    data: ArrayLike<number>,
    targetLength: number,
    output?: Float32Array,
  ) => ArrayLike<number>;
  /** Deprecated: FIFOWaterfall now consumes dB spectrum frames directly. */
  spectrumToAmplitude?: (
    data: number[],
    historyLimit: number,
    historyMax: number,
  ) => number[];
  fftMin?: number;
  fftMax?: number;
  isDeviceConnected?: boolean;
  awaitingDeviceData?: boolean;
  placeholderSourceLabel?: string;
  placeholderPaneLabel?: string;
  placeholderErrorReason?: string | null;
  placeholderState?: CanvasPlaceholderState | null;
  forceCanvas2D?: boolean;
}

const WaterfallViewport = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
`;

const WaterfallCanvas = styled.canvas`
  display: block;
  flex: 1;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  background-color: ${({ theme }) =>
    theme.colors?.waterfallBackground ?? WATERFALL_CANVAS_BG};
`;

const isWebGPUSupported = () =>
  typeof navigator !== "undefined" && "gpu" in navigator;

async function getWebGPUDevice(): Promise<GPUDevice | null> {
  if (!isWebGPUSupported()) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    return await adapter.requestDevice();
  } catch (error) {
    console.error("Failed to request WebGPU device for waterfall:", error);
    return null;
  }
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const gradientStops: [number, number, number][] = [
  [0, 0, 50],
  [0, 120, 200],
  [0, 200, 120],
  [255, 210, 0],
  [255, 80, 0],
];
const ZERO_PLOT_MARGIN = { x: 0, y: 0 } as const;

const sampleGradient = (t: number): [number, number, number] => {
  const normalized = clamp01(t) * (gradientStops.length - 1);
  const lowerIndex = Math.floor(normalized);
  const upperIndex = Math.min(gradientStops.length - 1, lowerIndex + 1);
  const frac = normalized - lowerIndex;
  const lower = gradientStops[lowerIndex];
  const upper = gradientStops[upperIndex];
  return [
    lerp(lower[0], upper[0], frac),
    lerp(lower[1], upper[1], frac),
    lerp(lower[2], upper[2], frac),
  ];
};

// Precomputed 256-entry RGBA gradient LUT — eliminates per-pixel sampleGradient
// calls (Math.floor + lerp ×3) in the waterfall hot loop.
const GRADIENT_LUT_SIZE = 256;
const GRADIENT_LUT = new Uint8ClampedArray(GRADIENT_LUT_SIZE * 4);
{
  for (let i = 0; i < GRADIENT_LUT_SIZE; i++) {
    const [r, g, b] = sampleGradient(i / (GRADIENT_LUT_SIZE - 1));
    GRADIENT_LUT[i * 4] = r;
    GRADIENT_LUT[i * 4 + 1] = g;
    GRADIENT_LUT[i * 4 + 2] = b;
    GRADIENT_LUT[i * 4 + 3] = 255;
  }
}

const fillWaterfallBuffer = (
  buffer: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const [r, g, b] = sampleGradient(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = 255;
    }
  }
};

const addWaterfallFrame = (
  buffer: Uint8ClampedArray,
  fftFrame: ArrayLike<number>,
  width: number,
  height: number,
  retuneSmear: number,
  _steps: number,
  minDb: number,
  maxDb: number,
) => {
  // Shift all rows down by 1 using a single native memmove instead of
  // the previous O(width × height) nested loop with 4 assignments per pixel.
  const rowBytes = width * 4;
  buffer.copyWithin(rowBytes, 0, (height - 1) * rowBytes);

  // Fill the top row using the precomputed gradient LUT
  const dbRange = maxDb - minDb || 1;
  const lutMax = GRADIENT_LUT_SIZE - 1;
  const smear = Math.max(0, Math.min(Math.floor(retuneSmear), height - 1));

  for (let x = 0; x < width; x++) {
    const value = fftFrame[x];
    const dbValue = Number.isFinite(value) ? value : minDb;
    const normalized = (dbValue - minDb) / dbRange;
    const lutIdx =
      Math.max(0, Math.min(lutMax, Math.round(normalized * lutMax))) * 4;
    const r = GRADIENT_LUT[lutIdx];
    const g = GRADIENT_LUT[lutIdx + 1];
    const b = GRADIENT_LUT[lutIdx + 2];
    const idx = x * 4;
    buffer[idx] = r;
    buffer[idx + 1] = g;
    buffer[idx + 2] = b;
    buffer[idx + 3] = 255;

    for (let dy = 1; dy <= smear; dy++) {
      const smearIdx = (dy * width + x) * 4;
      buffer[smearIdx] = Math.max(buffer[smearIdx], r);
      buffer[smearIdx + 1] = Math.max(buffer[smearIdx + 1], g);
      buffer[smearIdx + 2] = Math.max(buffer[smearIdx + 2], b);
      buffer[smearIdx + 3] = 255;
    }
  }
};

export const FIFOWaterfall = memo<FIFOWaterfallProps>(
  ({
    width,
    height,
    waveform,
    frequencyRange,
    onWaterfallBufferChange,
    retuneSmear,
    isPaused,
    isVisible,
    performScalarResampling,
    fftMin = FFT_MIN_DB,
    fftMax = FFT_MAX_DB,
    isDeviceConnected = true,
    awaitingDeviceData = false,
    placeholderSourceLabel,
    placeholderPaneLabel = "Waterfall",
    placeholderErrorReason = null,
    placeholderState: explicitPlaceholderState = null,
    forceCanvas2D = false,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const localBufferRef = useRef<Uint8ClampedArray | null>(null);
    const bufferDimsRef = useRef<{ width: number; height: number } | null>(
      null,
    );
    const lastWaveformRef = useRef<Float32Array | null>(null);
    const scalarResampleOutputRef = useRef<Float32Array | null>(null);
    const resizeFrameRef = useRef<number | null>(null);
    const contextCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const context2DRef = useRef<CanvasRenderingContext2D | null>(null);
    const canvas2DRendererRef = useRef<FifoWaterfall2DRenderer | null>(null);
    if (canvas2DRendererRef.current === null) {
      canvas2DRendererRef.current = createFifoWaterfall2DRenderer();
    }
    const canvas2DRenderer = canvas2DRendererRef.current;
    const getCanvas2DContext = useCallback((canvas: HTMLCanvasElement) => {
      if (contextCanvasRef.current !== canvas) {
        contextCanvasRef.current = canvas;
        context2DRef.current = canvas.getContext("2d");
      }
      return context2DRef.current;
    }, []);
    const [gpuDevice, setGpuDevice] = useState<GPUDevice | null>(null);
    const [gpuFormat, setGpuFormat] = useState<GPUTextureFormat | null>(null);
    const [rendererMode, setRendererMode] = useState<
      "initializing" | "webgpu" | "2d"
    >(() => (forceCanvas2D || !isWebGPUSupported() ? "2d" : "initializing"));
    const [rendererError, setRendererError] = useState<string | null>(null);
    const {
      drawWebGPUFIFOWaterfall,
      cleanup: cleanupWebGPUFIFOWaterfall,
      getLastError,
    } = useDrawWebGPUFIFOWaterfall();
    const [viewportSize, setViewportSize] = useState({
      width: width,
      height: height,
    });

    useEffect(() => {
      let cancelled = false;
      const init = async () => {
        if (forceCanvas2D) {
          setGpuDevice(null);
          setGpuFormat(null);
          setRendererMode("2d");
          return;
        }
        if (!isWebGPUSupported()) {
          setRendererMode("2d");
          return;
        }
        const device = await getWebGPUDevice();
        if (cancelled) return;
        if (!device) {
          setRendererMode("2d");
          return;
        }
        setGpuDevice(device);
        setGpuFormat(navigator.gpu.getPreferredCanvasFormat());
        setRendererMode("webgpu");
      };
      void init();
      return () => {
        cancelled = true;
      };
    }, [forceCanvas2D]);

    const placeholderState = useMemo<CanvasPlaceholderState | null>(() => {
      if (explicitPlaceholderState) return explicitPlaceholderState;
      const hasWaveform = !!(waveform && waveform.length > 0);
      if (!isDeviceConnected) {
        return {
          kind: "error",
          sourceLabel: placeholderSourceLabel,
          reason: "Server down",
        };
      }

      if (placeholderErrorReason) {
        return {
          kind: "error",
          sourceLabel: placeholderSourceLabel,
          reason: placeholderErrorReason,
        };
      }

      if ((awaitingDeviceData || !hasWaveform) && !placeholderErrorReason) {
        return {
          kind: "loading",
          sourceLabel: placeholderSourceLabel,
          paneLabel: placeholderPaneLabel,
        };
      }

      return null;
    }, [
      awaitingDeviceData,
      placeholderErrorReason,
      explicitPlaceholderState,
      isDeviceConnected,
      placeholderPaneLabel,
      placeholderSourceLabel,
      waveform,
    ]);

    const resolveCssSize = () => viewportSize;

    // Initialize buffer if needed
    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const updateSize = () => {
        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
        }
        resizeFrameRef.current = window.requestAnimationFrame(() => {
          const measuredWidth = viewport.offsetWidth;
          const measuredHeight = viewport.offsetHeight;
          if (measuredWidth < 2 || measuredHeight < 2) return;

          setViewportSize((current) => {
            const nextWidth = Math.max(1, Math.round(measuredWidth || width));
            const nextHeight = Math.max(
              1,
              Math.round(measuredHeight || height),
            );
            if (current.width === nextWidth && current.height === nextHeight) {
              return current;
            }
            return { width: nextWidth, height: nextHeight };
          });
        });
      };

      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(viewport);
      return () => {
        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        observer.disconnect();
      };
    }, [width, height]);

    // Initialize buffer if needed
    useEffect(() => {
      const dpr =
        typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
      const { width, height } = resolveCssSize();
      const renderWidth = Math.max(1, Math.round(width * dpr));
      const renderHeight = Math.max(1, Math.round(height * dpr));
      const expectedLen = renderWidth * renderHeight * 4;
      const previousDims = bufferDimsRef.current;
      if (
        !localBufferRef.current ||
        localBufferRef.current.length !== expectedLen ||
        !previousDims ||
        previousDims.width !== renderWidth ||
        previousDims.height !== renderHeight
      ) {
        localBufferRef.current = new Uint8ClampedArray(expectedLen);
        fillWaterfallBuffer(localBufferRef.current, renderWidth, renderHeight);
        bufferDimsRef.current = { width: renderWidth, height: renderHeight };
        lastWaveformRef.current = null;
        onWaterfallBufferChange?.(localBufferRef.current);
      }
    }, [viewportSize.width, viewportSize.height, onWaterfallBufferChange]);

    // Render waterfall
    useEffect(() => {
      if (!isVisible || !canvasRef.current) return;
      // A canvas can only own one context type. Do not acquire Canvas2D while
      // WebGPU discovery is pending, or the later WebGPU context will be null.
      if (rendererMode === "initializing") return;

      const canvas = canvasRef.current;
      const hasWebGPU = !!(
        rendererMode === "webgpu" &&
        gpuDevice &&
        gpuFormat &&
        canvas
      );

      const dpr =
        typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
      const { width: cssWidth, height: cssHeight } = resolveCssSize();
      const renderWidth = Math.max(1, Math.round(cssWidth * dpr));
      const renderHeight = Math.max(1, Math.round(cssHeight * dpr));

      // Update canvas dimensions only if they changed to avoid clearing the drawing buffer unnecessarily
      if (canvas.width !== renderWidth) {
        canvas.width = renderWidth;
      }
      if (canvas.height !== renderHeight) {
        canvas.height = renderHeight;
      }
      if (canvas.style.width !== `${cssWidth}px`) {
        canvas.style.width = `${cssWidth}px`;
      }
      if (canvas.style.height !== `${cssHeight}px`) {
        canvas.style.height = `${cssHeight}px`;
      }

      const showPlaceholder =
        !!placeholderErrorReason || !waveform || waveform.length === 0;

      if (showPlaceholder) {
        if (!hasWebGPU) {
          const ctx = getCanvas2DContext(canvas);
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = canvas.style.backgroundColor || WATERFALL_CANVAS_BG;
            ctx.fillRect(0, 0, cssWidth, cssHeight);
          }
        }
        return;
      }

      if (waveform) {
        lastWaveformRef.current = waveform;
      }

      const buffer = localBufferRef.current;
      if (!buffer) return;

      const renderWaveform = waveform ?? lastWaveformRef.current;
      if (hasWebGPU && gpuDevice && gpuFormat && renderWaveform) {
        const rendered = drawWebGPUFIFOWaterfall({
          canvas,
          device: gpuDevice,
          format: gpuFormat,
          fftData: renderWaveform,
          fftMin,
          fftMax,
          driftAmount: retuneSmear * dpr,
          freeze: isPaused,
          wfSmooth: true,
          colormap: gradientStops,
          colormapName: "fifo-default",
          plotMargin: ZERO_PLOT_MARGIN,
          backgroundColor: canvas.style.backgroundColor || WATERFALL_CANVAS_BG,
        });
        if (!rendered) {
          setRendererError(getLastError());
          cleanupWebGPUFIFOWaterfall();
          setGpuDevice(null);
          setGpuFormat(null);
          setRendererMode("2d");
        }
        return;
      }

      if (!isPaused && renderWaveform) {
        // Add new frame when not paused
        if (
          !scalarResampleOutputRef.current ||
          scalarResampleOutputRef.current.length !== renderWidth
        ) {
          scalarResampleOutputRef.current = new Float32Array(renderWidth);
        }
        const resampled = performScalarResampling(
          renderWaveform as any,
          renderWidth,
          scalarResampleOutputRef.current,
        );

        addWaterfallFrame(
          buffer,
          resampled,
          renderWidth,
          renderHeight,
          retuneSmear * dpr,
          1,
          fftMin,
          fftMax,
        );

        onWaterfallBufferChange?.(buffer);
      }

      // Draw the waterfall via Canvas2D fallback
      const ctx = getCanvas2DContext(canvas);
      if (ctx) {
        canvas2DRenderer.draw(ctx, renderWidth, renderHeight, buffer);
      }
    }, [
      viewportSize.width,
      viewportSize.height,
      waveform,
      frequencyRange,
      isPaused,
      isVisible,
      retuneSmear,
      performScalarResampling,
      fftMin,
      fftMax,
      getCanvas2DContext,
      onWaterfallBufferChange,
      awaitingDeviceData,
      gpuDevice,
      gpuFormat,
      rendererMode,
      drawWebGPUFIFOWaterfall,
      cleanupWebGPUFIFOWaterfall,
      getLastError,
    ]);

    useEffect(
      () => () => cleanupWebGPUFIFOWaterfall(),
      [cleanupWebGPUFIFOWaterfall],
    );

    return (
      <WaterfallViewport ref={viewportRef}>
        <WaterfallCanvas
          key={rendererMode}
          ref={canvasRef}
          data-renderer-mode={rendererMode}
          data-renderer-error={rendererError ?? undefined}
          data-waveform-length={waveform?.length ?? 0}
        />
        {placeholderState && <CanvasPlaceholder state={placeholderState} />}
      </WaterfallViewport>
    );
  },
);

FIFOWaterfall.displayName = "FIFOWaterfall";
