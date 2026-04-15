import { memo, useRef, useEffect } from "react";
import styled, { memo as styledMemo } from "styled-components";
import {
  WATERFALL_CANVAS_BG,
  WATERFALL_HISTORY_LIMIT,
  WATERFALL_HISTORY_MAX,
  FFT_MIN_DB,
  FFT_MAX_DB,
} from "@n-apt/consts";

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
  performScalarResampling: (data: number[], targetLength: number) => number[];
  spectrumToAmplitude: (
    data: number[],
    historyLimit: number,
    historyMax: number,
  ) => number[];
  awaitingDeviceData?: boolean;
}

const WaterfallCanvas = styledMemo(styled.canvas<{ $width: number; $height: number }>`
  display: block;
  width: ${({ $width }) => $width}px;
  height: ${({ $height }) => $height}px;
  background-color: ${({ theme }) => theme.colors?.waterfallBackground ?? WATERFALL_CANVAS_BG};
`);

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
    const dbValue = fftFrame[x] ?? minDb;
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
  const imageData = new ImageData(width, height);
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
    spectrumToAmplitude,
    awaitingDeviceData = false,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const localBufferRef = useRef<Uint8ClampedArray | null>(null);
    const bufferDimsRef = useRef<{ width: number; height: number } | null>(
      null,
    );
    const lastWaveformRef = useRef<Float32Array | null>(null);

    // Initialize buffer if needed
    useEffect(() => {
      const expectedLen = width * height * 4;
      if (
        !localBufferRef.current ||
        localBufferRef.current.length !== expectedLen
      ) {
        localBufferRef.current = new Uint8ClampedArray(expectedLen);
        bufferDimsRef.current = { width, height };
        onWaterfallBufferChange?.(localBufferRef.current);
      }
    }, [width, height, onWaterfallBufferChange]);

    // Render waterfall
    useEffect(() => {
      if (!isVisible || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Update canvas dimensions
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const showPlaceholder = awaitingDeviceData && (!waveform || waveform.length === 0);

      if (showPlaceholder) {
        const minDim = Math.max(1, Math.min(width, height));
        const fontSize = Math.max(12, Math.min(24, Math.round(minDim * 0.07)));
        ctx.fillStyle = canvas.style.backgroundColor || WATERFALL_CANVAS_BG;
        ctx.fillRect(0, 0, width, height);
        ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = WATERFALL_PLACEHOLDER_COLOR;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(WATERFALL_PLACEHOLDER_TEXT, width / 2, height / 2);
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
        const resampled = performScalarResampling(Array.from(renderWaveform), width);
        const normalizedData = spectrumToAmplitude(
          resampled,
          WATERFALL_HISTORY_LIMIT,
          WATERFALL_HISTORY_MAX,
        );

        addWaterfallFrame(
          buffer,
          normalizedData,
          width,
          height,
          retuneSmear,
          1,
          FFT_MIN_DB,
          FFT_MAX_DB,
        );

        onWaterfallBufferChange?.(buffer);
      }

      // Draw the waterfall
      drawWaterfall({ ctx, width, height, waterfallBuffer: buffer });
    }, [
      width,
      height,
      waveform,
      frequencyRange,
      isPaused,
      isVisible,
      retuneSmear,
      performScalarResampling,
      spectrumToAmplitude,
      onWaterfallBufferChange,
      awaitingDeviceData,
    ]);

    return <WaterfallCanvas ref={canvasRef} $width={width} $height={height} />;
  },
);

FIFOWaterfall.displayName = "FIFOWaterfall";
