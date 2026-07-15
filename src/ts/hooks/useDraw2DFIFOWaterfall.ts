import { useCallback, useRef } from "react";
import { validateWaterfallDataComprehensive } from "@n-apt/validation";
import { spectrumToAmplitude } from "@n-apt/consts/types";
import {
  createFifoWaterfall2DRenderer,
  type FifoWaterfall2DRenderer,
} from "@n-apt/utils/rendering/fifoWaterfall2d";

const DEFAULT_COLORMAP: number[][] = [
  [0, 0, 0],
  [255, 255, 255],
];

export interface Draw2DFIFOWaterfallOptions {
  canvas: HTMLCanvasElement;
  waterfallBuffer: Uint8ClampedArray;
  fftFrame?: number[] | Float32Array;
  frequencyRange: { min: number; max: number };
  waterfallMin?: number;
  waterfallMax?: number;
  driftAmount?: number;
  driftDirection?: number;
  colormap?: number[][];
  fftSize?: number;
  sampleRate?: number;
  centerFrequencyHz?: number;
  isPaused?: boolean;
}

export function useDraw2DFIFOWaterfall() {
  const lastBufferLengthRef = useRef(0);
  const lastDrawTimeRef = useRef(0);
  const contextRef = useRef<{
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
  } | null>(null);
  const rendererRef = useRef<FifoWaterfall2DRenderer | null>(null);
  if (rendererRef.current === null) {
    rendererRef.current = createFifoWaterfall2DRenderer();
  }
  const renderer = rendererRef.current;

  // Inline addWaterfallFrame function
  const addWaterfallFrame = useCallback(
    (
      waterfallBuffer: Uint8ClampedArray,
      fftFrame: ArrayLike<number>,
      width: number,
      height: number,
      driftAmount: number,
      minDb: number,
      maxDb: number,
      colormap: number[][],
    ) => {
      const rowBytes = width * 4;
      waterfallBuffer.copyWithin(rowBytes, 0, (height - 1) * rowBytes);

      const dbRange = maxDb - minDb || 1;
      const colorMax = colormap.length - 1;
      const smear = Math.max(0, Math.min(Math.floor(driftAmount), height - 1));
      for (let x = 0; x < width; x++) {
        const dbValue = fftFrame[x] * (maxDb - minDb) + minDb;
        const normalized = (dbValue - minDb) / dbRange;
        const colorIndex = Math.max(
          0,
          Math.min(colorMax, normalized * colorMax),
        );
        const lowerIndex = Math.floor(colorIndex);
        const upperIndex = Math.min(colorMax, lowerIndex + 1);
        const fraction = colorIndex - lowerIndex;
        const lower = colormap[lowerIndex];
        const upper = colormap[upperIndex];
        const r = lower[0] + (upper[0] - lower[0]) * fraction;
        const g = lower[1] + (upper[1] - lower[1]) * fraction;
        const b = lower[2] + (upper[2] - lower[2]) * fraction;

        const i0 = x * 4;
        waterfallBuffer[i0] = r;
        waterfallBuffer[i0 + 1] = g;
        waterfallBuffer[i0 + 2] = b;
        waterfallBuffer[i0 + 3] = 255;

        for (let dy = 1; dy <= smear; dy++) {
          const i = (dy * width + x) * 4;
          waterfallBuffer[i] = Math.max(waterfallBuffer[i], r);
          waterfallBuffer[i + 1] = Math.max(waterfallBuffer[i + 1], g);
          waterfallBuffer[i + 2] = Math.max(waterfallBuffer[i + 2], b);
          waterfallBuffer[i + 3] = 255;
        }
      }
    },
    [],
  );

  const draw2DFIFOWaterfall = useCallback(
    (options: Draw2DFIFOWaterfallOptions) => {
      const {
        canvas,
        waterfallBuffer,
        fftFrame,
        frequencyRange: _frequencyRange,
        waterfallMin = -80,
        waterfallMax = 20,
        driftAmount = 0,
        driftDirection: _driftDirection = 0,
        colormap = DEFAULT_COLORMAP,
        fftSize,
        sampleRate,
        centerFrequencyHz,
        isPaused = false,
      } = options;

      let contextState = contextRef.current;
      if (!contextState || contextState.canvas !== canvas) {
        const context = canvas.getContext("2d");
        if (!context) return false;
        contextState = { canvas, context };
        contextRef.current = contextState;
      }
      const ctx = contextState.context;

      const dpr = window.devicePixelRatio || 1;
      const parent = canvas.parentElement;
      const cssWidth = parent?.clientWidth || canvas.clientWidth || 800;
      const cssHeight = parent?.clientHeight || canvas.clientHeight || 400;

      // Update internal resolution for High-DPI displays
      if (
        canvas.width !== Math.floor(cssWidth * dpr) ||
        canvas.height !== Math.floor(cssHeight * dpr)
      ) {
        canvas.width = Math.floor(cssWidth * dpr);
        canvas.height = Math.floor(cssHeight * dpr);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
      }

      // Skip if buffer hasn't changed and no new frame (optimization)
      const now = performance.now();
      const isFirstFrame = lastDrawTimeRef.current === 0;
      if (
        !fftFrame &&
        lastBufferLengthRef.current === waterfallBuffer.length &&
        now - lastDrawTimeRef.current < 16
      ) {
        return true;
      }
      lastBufferLengthRef.current = waterfallBuffer.length;
      lastDrawTimeRef.current = now;

      try {
        // Calculate waterfall display dimensions in physical pixels
        const marginX = Math.round(40 * dpr);
        const marginY = Math.round(8 * dpr);
        const waterfallWidth = Math.max(
          1,
          Math.floor(cssWidth * dpr - marginX * 2),
        );
        const waterfallHeight = Math.max(
          1,
          Math.floor(cssHeight * dpr - marginY * 2),
        );

        // If new FFT frame data is provided, update the waterfall buffer
        if (fftFrame && fftFrame.length > 0) {
          // Convert spectrum to amplitude (0-1 range)
          const amplitudes = spectrumToAmplitude(
            fftFrame,
            waterfallMin,
            waterfallMax,
          );

          // Add new frame to waterfall buffer
          addWaterfallFrame(
            waterfallBuffer,
            amplitudes,
            waterfallWidth,
            waterfallHeight,
            driftAmount,
            waterfallMin,
            waterfallMax,
            colormap,
          );

          // Validate waterfall data on first frame or when paused
          if (isFirstFrame || isPaused) {
            const validationResult = validateWaterfallDataComprehensive(
              waterfallBuffer,
              {
                width: waterfallWidth,
                height: waterfallHeight,
                fftSize,
                sampleRate,
                centerFrequencyHz,
                timestamp: Date.now(),
                isPaused,
                isFirstFrame,
              },
            );

            if (!validationResult.isValid) {
              console.error(
                `Waterfall validation failed (${isFirstFrame ? "first frame" : "paused"}):`,
                validationResult.errors,
              );
            } else if (validationResult.warnings.length > 0) {
              console.warn(
                `Waterfall validation warnings (${isFirstFrame ? "first frame" : "paused"}):`,
                validationResult.warnings,
              );
            }

            // Log validation metadata for debugging (only in development)
            if (process.env.NODE_ENV === "development") {
              console.log(
                "Waterfall validation metadata:",
                validationResult.metadata,
              );
            }
          }
        }

        // Draw the waterfall content using physical pixels
        try {
          renderer.draw(
            ctx,
            waterfallWidth,
            waterfallHeight,
            waterfallBuffer,
            marginX,
            marginY,
          );
        } catch (e) {
          console.error("Waterfall draw failed:", e);
        }

        return true;
      } catch (error) {
        console.error("2D waterfall rendering failed:", error);
        return false;
      }
    },
    [addWaterfallFrame],
  );

  const cleanup = useCallback(() => {
    lastBufferLengthRef.current = 0;
    lastDrawTimeRef.current = 0;
    contextRef.current = null;
    renderer.reset();
  }, []);

  return {
    draw2DFIFOWaterfall,
    cleanup,
  };
}
