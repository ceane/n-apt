import { useCallback, useRef } from "react";
import { spectrumToAmplitude } from "@n-apt/consts/types";

export interface Draw2DFIFOWaterfallOptions {
  canvas: HTMLCanvasElement;
  waterfallBuffer: Uint8ClampedArray;
  frequencyRange: { min: number; max: number };
  waterfallMin?: number;
  waterfallMax?: number;
  driftAmount?: number;
  driftDirection?: number;
  fftFrame?: number[]; // Optional new FFT frame data
  colormap?: number[][];
}

export function useDraw2DFIFOWaterfall() {
  const lastBufferRef = useRef<{ length: number; timestamp: number } | null>(
    null,
  );

  // Inline dbToColor function
  const dbToColor = useCallback(
    (
      db: number,
      minDb: number,
      maxDb: number,
      colormap: number[][],
    ): [number, number, number] => {
      const normalized = (db - minDb) / (maxDb - minDb);
      const index = Math.max(
        0,
        Math.min(colormap.length - 1, normalized * (colormap.length - 1)),
      );
      const lowerIndex = Math.floor(index);
      const upperIndex = Math.min(colormap.length - 1, lowerIndex + 1);
      const fraction = index - lowerIndex;

      const lower = colormap[lowerIndex];
      const upper = colormap[upperIndex];

      return [
        lower[0] + (upper[0] - lower[0]) * fraction,
        lower[1] + (upper[1] - lower[1]) * fraction,
        lower[2] + (upper[2] - lower[2]) * fraction,
      ];
    },
    [],
  );

  // Inline addWaterfallFrame function
  const addWaterfallFrame = useCallback(
    (
      waterfallBuffer: Uint8ClampedArray,
      fftFrame: number[],
      width: number,
      height: number,
      driftAmount: number,
      minDb: number,
      maxDb: number,
      colormap: number[][],
    ) => {
      // Shift all old pixels down by 1 row (FIFO)
      for (let y = height - 1; y > 0; y--) {
        for (let x = 0; x < width; x++) {
          const dst = (y * width + x) * 4;
          const src = ((y - 1) * width + x) * 4;
          waterfallBuffer[dst] = waterfallBuffer[src];
          waterfallBuffer[dst + 1] = waterfallBuffer[src + 1];
          waterfallBuffer[dst + 2] = waterfallBuffer[src + 2];
          waterfallBuffer[dst + 3] = 255;
        }
      }

      // Insert new FFT frame at top row
      for (let x = 0; x < width; x++) {
        const dbValue = fftFrame[x] * (maxDb - minDb) + minDb;
        const [r, g, b] = dbToColor(dbValue, minDb, maxDb, colormap);

        const i0 = x * 4;
        waterfallBuffer[i0] = r;
        waterfallBuffer[i0 + 1] = g;
        waterfallBuffer[i0 + 2] = b;
        waterfallBuffer[i0 + 3] = 255;

        const smear = Math.max(
          0,
          Math.min(Math.floor(driftAmount), height - 1),
        );
        for (let dy = 1; dy <= smear; dy++) {
          const i = (dy * width + x) * 4;
          waterfallBuffer[i] = Math.max(waterfallBuffer[i], r);
          waterfallBuffer[i + 1] = Math.max(waterfallBuffer[i + 1], g);
          waterfallBuffer[i + 2] = Math.max(waterfallBuffer[i + 2], b);
          waterfallBuffer[i + 3] = 255;
        }
      }
    },
    [dbToColor],
  );

  const draw2DFIFOWaterfall = useCallback(
    (options: Draw2DFIFOWaterfallOptions) => {
      const {
        canvas,
        waterfallBuffer,
        waterfallMin = -80,
        waterfallMax = 20,
        driftAmount = 0,
        fftFrame,
        colormap = [],
      } = options;

      const ctx = canvas.getContext("2d");
      if (!ctx || !waterfallBuffer) return false;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement?.getBoundingClientRect();
      const cssWidth = rect?.width || canvas.clientWidth || 800;
      const cssHeight = rect?.height || canvas.clientHeight || 400;

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
      const currentBuffer = { length: waterfallBuffer.length, timestamp: now };
      if (lastBufferRef.current && !fftFrame) {
        const last = lastBufferRef.current;
        if (
          last.length === waterfallBuffer.length &&
          now - last.timestamp < 16
        ) {
          return true;
        }
      }
      lastBufferRef.current = currentBuffer;

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
        }

        // Draw the waterfall content using physical pixels
        const expectedSize = waterfallWidth * waterfallHeight * 4;
        if (waterfallBuffer.length >= expectedSize) {
          try {
            const imageData = new ImageData(waterfallWidth, waterfallHeight);
            imageData.data.set(waterfallBuffer.subarray(0, expectedSize));
            ctx.putImageData(imageData, marginX, marginY);
          } catch (e) {
            console.error("Waterfall draw failed:", e);
          }
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
    lastBufferRef.current = null;
  }, []);

  return {
    draw2DFIFOWaterfall,
    cleanup,
  };
}
