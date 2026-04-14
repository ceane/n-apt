import { useCallback } from "react";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";
import type { FFTCanvasHandle } from "@n-apt/components";
import { useAppDispatch, setSnapshotProgress } from "@n-apt/redux";
import type { FrequencyRange } from "@n-apt/hooks/useWebSocket";

export type WholeChannelSnapshotSegment = {
  data: SnapshotData;
  visualRange: { min: number; max: number };
  waveformHistory: Float32Array[];
};

export async function* streamWholeChannelSegmentFrames(
  captureWholeChannelSegments: () => Promise<WholeChannelSnapshotSegment[]>,
  frameRate: number,
  durationMs = 1000,
): AsyncGenerator<WholeChannelSnapshotSegment[], void, void> {
  const safeFrameRate =
    Number.isFinite(frameRate) && frameRate > 0 ? Math.round(frameRate) : 30;
  const totalVideoFrames = Math.max(
    1,
    Math.round((durationMs / 1000) * safeFrameRate),
  );

  const capturedSegments = await captureWholeChannelSegments();
  const totalSegments = capturedSegments.length;

  if (!totalSegments) {
    for (let i = 0; i < totalVideoFrames; i++) yield [];
    return;
  }

  const histories = capturedSegments.map(
    seg => seg.waveformHistory || (seg.data.waveform ? [seg.data.waveform] : []),
  );
  const framesPerSegment = Math.max(...histories.map(h => h.length), 1);

  for (let videoFrameIdx = 0; videoFrameIdx < totalVideoFrames; videoFrameIdx++) {
    const timeIdx = Math.floor((videoFrameIdx / totalVideoFrames) * framesPerSegment);

    const frameSegments = capturedSegments.map((segment, segIdx) => {
      const history = histories[segIdx];
      const waveform = history[Math.min(timeIdx, history.length - 1)];

      if (!waveform) return segment;

      return {
        ...segment,
        data: { ...segment.data, waveform },
      };
    });

    yield frameSegments;
  }
}

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
  const reduxDispatch = useAppDispatch();

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
    const segments: WholeChannelSnapshotSegment[] = [];
    const estimatedSegments = Math.max(
      1,
      Math.ceil(totalSpan / hardwareSpanMHz),
    );
    const captureFps = 60;
    const framesToCapture = Math.round(captureFps * (settleMs / 1000));

    try {
      reduxDispatch(setSnapshotProgress({
        stage: "collecting",
        message: "Collecting whole-channel segments",
        current: 0,
        total: estimatedSegments,
      }));

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
        const nextIndex = segments.length + 1;

        reduxDispatch(setSnapshotProgress({
          stage: "collecting",
          message: `Collecting segment ${nextIndex} of ${estimatedSegments}`,
          current: nextIndex,
          total: estimatedSegments,
        }));

        dispatch({ type: "SET_FREQUENCY_RANGE", range: nextRange });
        sendFrequencyRange(nextRange);
        dispatch({ type: "SET_VIZ_ZOOM", zoom: 1 });
        dispatch({ type: "SET_VIZ_PAN", pan: 0 });
        dispatch({ type: "CLEAR_WATERFALL" });

        await raf();
        await sleep(settleMs);

        const waveformHistory: Float32Array[] = [];
        for (let frameI = 0; frameI < framesToCapture; frameI++) {
          await raf();
          const data = fftCanvasRef.current?.getSnapshotData();
          if (data?.waveform?.length) {
            waveformHistory.push(new Float32Array(data.waveform));
          }
          if (frameI < framesToCapture - 1) {
            await sleep(Math.floor(1000 / captureFps));
          }
        }
        await raf();

        const finalData = fftCanvasRef.current?.getSnapshotData();
        if (finalData?.waveform?.length) {
          segments.push({
            data: finalData,
            visualRange: nextRange,
            waveformHistory,
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
    reduxDispatch,
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
