import { memo, useRef, useEffect, useState } from "react";
import styled from "styled-components";
import { WATERFALL_CANVAS_BG, FFT_MIN_DB, FFT_MAX_DB } from "@n-apt/consts";

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
  ) => number[];
  /** Deprecated: FIFOWaterfall now consumes dB spectrum frames directly. */
  spectrumToAmplitude?: (
    data: number[],
    historyLimit: number,
    historyMax: number,
  ) => number[];
  fftMin?: number;
  fftMax?: number;
  awaitingDeviceData?: boolean;
}

const WaterfallViewport = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
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

const WATERFALL_PLACEHOLDER_TEXT = "Loading data from source...";
const WATERFALL_PLACEHOLDER_COLOR = "#888888";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const gradientStops: [number, number, number][] = [
  [0, 0, 50],
  [0, 120, 200],
  [0, 200, 120],
  [255, 210, 0],
  [255, 80, 0],
];

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
  fftFrame: number[],
  width: number,
  height: number,
  retuneSmear: number,
  _steps: number,
  minDb: number,
  maxDb: number,
) => {
  for (let y = height - 1; y > 0; y--) {
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      const src = ((y - 1) * width + x) * 4;
      buffer[dst] = buffer[src];
      buffer[dst + 1] = buffer[src + 1];
      buffer[dst + 2] = buffer[src + 2];
      buffer[dst + 3] = 255;
    }
  }

  for (let x = 0; x < width; x++) {
    const value = fftFrame[x];
    const dbValue = Number.isFinite(value) ? value : minDb;
    const normalized = (dbValue - minDb) / (maxDb - minDb || 1);
    const [r, g, b] = sampleGradient(normalized);
    const idx = x * 4;
    buffer[idx] = r;
    buffer[idx + 1] = g;
    buffer[idx + 2] = b;
    buffer[idx + 3] = 255;

    const smear = Math.max(0, Math.min(Math.floor(retuneSmear), height - 1));
    for (let dy = 1; dy <= smear; dy++) {
      const smearIdx = (dy * width + x) * 4;
      buffer[smearIdx] = Math.max(buffer[smearIdx], r);
      buffer[smearIdx + 1] = Math.max(buffer[smearIdx + 1], g);
      buffer[smearIdx + 2] = Math.max(buffer[smearIdx + 2], b);
      buffer[smearIdx + 3] = 255;
    }
  }
};

const drawWaterfall = ({
  ctx,
  width,
  height,
  waterfallBuffer,
}: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  waterfallBuffer: Uint8ClampedArray;
}) => {
  const expectedSize = width * height * 4;
  if (waterfallBuffer.length < expectedSize) {
    return;
  }
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(waterfallBuffer.subarray(0, expectedSize));
  ctx.putImageData(imageData, 0, 0);
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
    awaitingDeviceData = false,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const localBufferRef = useRef<Uint8ClampedArray | null>(null);
    const bufferDimsRef = useRef<{ width: number; height: number } | null>(
      null,
    );
    const lastWaveformRef = useRef<Float32Array | null>(null);
    const resizeFrameRef = useRef<number | null>(null);
    const [viewportSize, setViewportSize] = useState({
      width: width,
      height: height,
    });

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
            const nextHeight = Math.max(1, Math.round(measuredHeight || height));
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
      const { width: cssWidth, height: cssHeight } = resolveCssSize();
      const renderWidth = Math.max(1, Math.round(cssWidth * dpr));
      const renderHeight = Math.max(1, Math.round(cssHeight * dpr));
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

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr =
        typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
      const { width: cssWidth, height: cssHeight } = resolveCssSize();
      const renderWidth = Math.max(1, Math.round(cssWidth * dpr));
      const renderHeight = Math.max(1, Math.round(cssHeight * dpr));

      // Update canvas dimensions
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      const showPlaceholder =
        awaitingDeviceData && (!waveform || waveform.length === 0);

      if (showPlaceholder) {
        const minDim = Math.max(1, Math.min(cssWidth, cssHeight));
        const fontSize = Math.max(12, Math.min(24, Math.round(minDim * 0.07)));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = canvas.style.backgroundColor || WATERFALL_CANVAS_BG;
        ctx.fillRect(0, 0, cssWidth, cssHeight);
        ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = WATERFALL_PLACEHOLDER_COLOR;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(WATERFALL_PLACEHOLDER_TEXT, cssWidth / 2, cssHeight / 2);
        return;
      }

      if (waveform) {
        lastWaveformRef.current = waveform;
      }

      const buffer = localBufferRef.current;
      if (!buffer) return;

      const renderWaveform = waveform ?? lastWaveformRef.current;
      if (!isPaused && renderWaveform) {
        // Add new frame when not paused
        const resampled = performScalarResampling(
          renderWaveform as any,
          renderWidth,
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

      // Draw the waterfall
      drawWaterfall({
        ctx,
        width: renderWidth,
        height: renderHeight,
        waterfallBuffer: buffer,
      });
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
      onWaterfallBufferChange,
      awaitingDeviceData,
    ]);

    const { width: cssWidth, height: cssHeight } = resolveCssSize();
    return (
      <WaterfallViewport ref={viewportRef}>
        <WaterfallCanvas ref={canvasRef} />
      </WaterfallViewport>
    );
  },
);

FIFOWaterfall.displayName = "FIFOWaterfall";
