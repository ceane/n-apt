import { memo, useRef, useEffect } from "react";
import styled from "styled-components";
// TODO: Update to use useDraw2DFIFOWaterfall hook instead of direct rendering
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
}

const WaterfallCanvas = styled.canvas<{ $width: number; $height: number }>`
  display: block;
  width: ${({ $width }) => $width}px;
  height: ${({ $height }) => $height}px;
  background-color: ${WATERFALL_CANVAS_BG};
`;

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
  }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const localBufferRef = useRef<Uint8ClampedArray | null>(null);
    const bufferDimsRef = useRef<{ width: number; height: number } | null>(
      null,
    );

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
      if (!isVisible || !waveform || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Update canvas dimensions
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const buffer = localBufferRef.current;
      if (!buffer) return;

      if (!isPaused) {
        // Add new frame when not paused
        const resampled = performScalarResampling(Array.from(waveform), width);
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
      drawWaterfall({
        ctx,
        width,
        height,
        waterfallBuffer: buffer,
        frequencyRange,
      });
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
    ]);

    return <WaterfallCanvas ref={canvasRef} $width={width} $height={height} />;
  },
);

FIFOWaterfall.displayName = "FIFOWaterfall";
