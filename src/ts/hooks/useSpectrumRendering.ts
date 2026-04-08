import { useCallback } from "react";
import { useDraw2DFFTSignal } from "@n-apt/hooks/useDraw2DFFTSignal";

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
  const { draw2DFFTSignal } = useDraw2DFFTSignal();

  const renderSpectrum = useCallback(
    (canvas: HTMLCanvasElement, spectrumData: number[]) => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      const width = rect?.width || canvas.width;
      const height = rect?.height || canvas.height;

      return draw2DFFTSignal({
        canvas,
        waveform: spectrumData,
        frequencyRange: frequencyRangeRef.current,
        fftMin: displayTemporalResolution === "high" ? -120 : -100,
        fftMax: displayTemporalResolution === "high" ? 20 : 0,
        showGrid: snapshotGridPreferenceRef.current,
        highPerformanceMode: displayTemporalResolution === "high",
      }) ?? (width > 0 && height > 0);
    },
    [displayTemporalResolution, draw2DFFTSignal, frequencyRangeRef, snapshotGridPreferenceRef],
  );

  return { renderSpectrum };
}
