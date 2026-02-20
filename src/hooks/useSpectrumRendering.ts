import { useCallback } from "react";
import { drawSpectrum, drawSpectrumGrid, drawSpectrumTrace } from "@n-apt/fft/FFTCanvasRenderer";
import { FFT_AREA_MIN, FFT_MIN_DB, FFT_MAX_DB, LINE_COLOR } from "@n-apt/consts";

export interface SpectrumRenderingOptions {
  displayTemporalResolution: "low" | "medium" | "high";
  snapshotGridPreferenceRef: React.MutableRefObject<boolean>;
  frequencyRangeRef: React.MutableRefObject<{ min: number; max: number }>;
}

export function useSpectrumRendering({
  displayTemporalResolution,
  snapshotGridPreferenceRef,
  frequencyRangeRef,
}: SpectrumRenderingOptions) {
  const renderSpectrum = useCallback(
    (canvas: HTMLCanvasElement, spectrumData: number[]) => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !spectrumData) return;

      const rect = canvas.parentElement?.getBoundingClientRect();
      const width = rect?.width || canvas.width;
      const height = rect?.height || canvas.height;

      if (displayTemporalResolution === "high") {
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
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, width, height);
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

  return { renderSpectrum };
}
