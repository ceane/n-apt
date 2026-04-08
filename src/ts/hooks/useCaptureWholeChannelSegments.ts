import { useCallback } from "react";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";
import type { FFTCanvasHandle } from "@n-apt/components";
import type { FrequencyRange } from "@n-apt/hooks/useWebSocket";

interface UseCaptureWholeChannelSegmentsOptions {
  frequencyRange: FrequencyRange | null;
  sourceMode: "live" | "file";
  sampleRateHzEffective: number | null;
  activeSignalArea?: string;
  signalAreaBounds?: Record<string, { min: number; max: number }> | null;
  fftFrameRate: number;
  vizPanOffset: number;
  vizZoom: number;
  dispatch: (action: any) => void;
  sendFrequencyRange: (range: FrequencyRange) => void;
  fftCanvasRef: React.RefObject<FFTCanvasHandle | null>;
}

/**
 * Hook for capturing whole channel segments by sweeping across frequency ranges
 * Manages complex state changes during the capture process
 */
export const useCaptureWholeChannelSegments = ({
  frequencyRange,
  sourceMode,
  sampleRateHzEffective,
  activeSignalArea,
  signalAreaBounds,
  fftFrameRate,
  vizPanOffset,
  vizZoom,
  dispatch,
  sendFrequencyRange,
  fftCanvasRef,
}: UseCaptureWholeChannelSegmentsOptions) => {
  return useCallback(async () => {
    const fullRange = frequencyRange;
    const hardwareSpanMHz = sampleRateHzEffective
      ? sampleRateHzEffective / 1_000_000
      : null;

    if (
      !fullRange ||
      sourceMode !== "live" ||
      !hardwareSpanMHz ||
      !(hardwareSpanMHz > 0)
    ) {
      return [];
    }

    const area = activeSignalArea?.toLowerCase();
    const channelRange = area ? signalAreaBounds?.[area] ?? fullRange : fullRange;
    const totalSpan = channelRange.max - channelRange.min;
    if (!(totalSpan > hardwareSpanMHz + 0.0001)) {
      return [];
    }

    const settleMs = 1000;
    const raf = () =>
      new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const originalRange = fullRange;
    const originalPan = vizPanOffset;
    const originalZoom = vizZoom;
    const segments: Array<{
      data: SnapshotData;
      visualRange: { min: number; max: number };
    }> = [];

    try {
      for (
        let segmentMin = channelRange.min;
        segmentMin < channelRange.max - 0.0001;
        segmentMin += hardwareSpanMHz
      ) {
        // Ensure the segment always has the full hardwareSpanMHz
        // If we reach the end, "slide" back so the segment covers the end boundaries
        let actualMin = segmentMin;
        let actualMax = segmentMin + hardwareSpanMHz;

        if (actualMax > channelRange.max) {
          actualMax = channelRange.max;
          actualMin = Math.max(channelRange.min, actualMax - hardwareSpanMHz);
        }

        const nextRange = {
          min: actualMin,
          max: actualMax,
        };

        dispatch({ type: "SET_FREQUENCY_RANGE", range: nextRange });
        sendFrequencyRange(nextRange);
        dispatch({ type: "SET_VIZ_ZOOM", zoom: 1 });
        dispatch({ type: "SET_VIZ_PAN", pan: 0 });
        dispatch({ type: "CLEAR_WATERFALL" });

        await raf();
        await sleep(settleMs);
        await raf();
        await raf();

        const data = fftCanvasRef.current?.getSnapshotData();
        if (data?.waveform?.length) {
          segments.push({
            data,
            visualRange: nextRange,
          });
        }

        // Break if we've reached the end to avoid redundant slides
        if (actualMax >= channelRange.max - 0.0001) break;
      }
    } finally {
      dispatch({ type: "SET_FREQUENCY_RANGE", range: originalRange });
      sendFrequencyRange(originalRange);
      dispatch({ type: "SET_VIZ_ZOOM", zoom: originalZoom });
      dispatch({ type: "SET_VIZ_PAN", pan: originalPan });
      await raf();
    }

    return segments;
  }, [
    dispatch,
    sampleRateHzEffective,
    sendFrequencyRange,
    signalAreaBounds,
    activeSignalArea,
    fftFrameRate,
    frequencyRange,
    sourceMode,
    vizPanOffset,
    vizZoom,
    fftCanvasRef,
  ]);
};
