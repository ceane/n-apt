import { useCallback } from "react";
import type { SnapshotData } from "@n-apt/spectrum/public/FFTCanvas";
import type { FFTCanvasHandle } from "@n-apt/spectrum";
import {
  clearWaterfall,
  setFrequencyRange,
  setSnapshotProgress,
  setVizPan,
  setVizZoom,
  useAppDispatch,
} from "@n-apt/redux";
import type { FrequencyRange } from "@n-apt/consts/schemas/websocket";

export type WholeChannelSnapshotSegment = {
  data: SnapshotData;
  visualRange: { min: number; max: number };
  waveformHistory: Float32Array[];
};

export type WholeChannelCaptureOptions = {
  captureVideoHistory?: boolean;
  frameRate?: number;
  durationMs?: number;
};

export async function* streamWholeChannelSegmentFrames(
  captureWholeChannelSegments: (
    options?: WholeChannelCaptureOptions,
  ) => Promise<WholeChannelSnapshotSegment[]>,
  frameRate: number,
  durationMs = 1000,
): AsyncGenerator<WholeChannelSnapshotSegment[], void, void> {
  const safeFrameRate =
    Number.isFinite(frameRate) && frameRate > 0 ? Math.round(frameRate) : 30;
  const totalVideoFrames = Math.max(
    1,
    Math.round((durationMs / 1000) * safeFrameRate),
  );

  const capturedSegments = await captureWholeChannelSegments({
    captureVideoHistory: true,
    frameRate: safeFrameRate,
    durationMs,
  });
  const totalSegments = capturedSegments.length;

  if (!totalSegments) {
    for (let i = 0; i < totalVideoFrames; i++) yield [];
    return;
  }

  const histories = capturedSegments.map(
    (seg) =>
      seg.waveformHistory || (seg.data.waveform ? [seg.data.waveform] : []),
  );
  const framesPerSegment = Math.max(...histories.map((h) => h.length), 1);

  for (
    let videoFrameIdx = 0;
    videoFrameIdx < totalVideoFrames;
    videoFrameIdx++
  ) {
    const timeIdx = Math.floor(
      (videoFrameIdx / totalVideoFrames) * framesPerSegment,
    );

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
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isRtlSdr?: boolean;
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
  sendFrequencyRange,
  fftCanvasRef,
}: UseCaptureWholeChannelSegmentsOptions) => {
  const reduxDispatch = useAppDispatch();

  return useCallback(async (captureOptions: WholeChannelCaptureOptions = {}) => {
    const fullRange = frequencyRange;
    const hardwareSpanHz = sampleRateHzEffective
      ? sampleRateHzEffective
      : null;

    if (
      !fullRange ||
      sourceMode !== "live" ||
      !hardwareSpanHz ||
      !(hardwareSpanHz > 0)
    ) {
      return [];
    }

    const area = activeSignalArea?.toLowerCase();
    const channelRange = area
      ? (signalAreaBounds?.[area] ?? fullRange)
      : fullRange;
    const totalSpan = channelRange.max - channelRange.min;
    if (!(totalSpan > hardwareSpanHz + 1)) {
      return [];
    }

    const settleMs = 1000;
    const raf = () =>
      new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const originalRange = fullRange;
    const originalPan = vizPanOffset;
    const originalZoom = vizZoom;
    const segments: WholeChannelSnapshotSegment[] = [];
    const estimatedSegments = Math.max(
      1,
      Math.ceil(totalSpan / hardwareSpanHz),
    );
    const requestedCaptureFps = captureOptions.frameRate ?? 30;
    const captureFps = Number.isFinite(requestedCaptureFps)
      ? Math.max(1, Math.round(requestedCaptureFps))
      : 30;
    const framesToCapture = captureOptions.captureVideoHistory
      ? Math.max(
          1,
          Math.round(
            (captureOptions.durationMs ?? 1000) * (captureFps / 1000),
          ),
        )
      : 0;
    const frameIntervalMs = 1000 / captureFps;

    try {
      reduxDispatch(
        setSnapshotProgress({
          stage: "collecting",
          message: "Collecting whole-channel segments",
          current: 0,
          total: estimatedSegments,
        }),
      );

      for (
        let segmentMin = channelRange.min;
        segmentMin < channelRange.max - 1;
        segmentMin += hardwareSpanHz
      ) {
        // Ensure the segment always has the full hardwareSpanHz
        // If we reach the end, "slide" back so the segment covers the end boundaries
        let actualMin = segmentMin;
        let actualMax = segmentMin + hardwareSpanHz;

        if (actualMax > channelRange.max) {
          actualMax = channelRange.max;
          actualMin = Math.max(channelRange.min, actualMax - hardwareSpanHz);
        }

        const nextRange = {
          min: actualMin,
          max: actualMax,
        };
        const nextIndex = segments.length + 1;

        reduxDispatch(
          setSnapshotProgress({
            stage: "collecting",
            message: `Collecting segment ${nextIndex} of ${estimatedSegments}`,
            current: nextIndex,
            total: estimatedSegments,
          }),
        );

        reduxDispatch(setFrequencyRange(nextRange));
        sendFrequencyRange(nextRange);
        reduxDispatch(setVizZoom(1));
        reduxDispatch(setVizPan(0));
        reduxDispatch(clearWaterfall());

        await raf();
        await sleep(settleMs);

        const waveformHistory: Float32Array[] = [];
        let nextCaptureAt = performance.now();
        for (let frameI = 0; frameI < framesToCapture; frameI++) {
          await raf();
          const data = fftCanvasRef.current?.getSnapshotData();
          if (data?.waveform?.length) {
            waveformHistory.push(new Float32Array(data.waveform));
          }
          if (frameI < framesToCapture - 1) {
            nextCaptureAt += frameIntervalMs;
            await sleep(Math.max(0, nextCaptureAt - performance.now()));
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
        if (actualMax >= channelRange.max - 1) break;
      }
    } finally {
      reduxDispatch(setFrequencyRange(originalRange));
      sendFrequencyRange(originalRange);
      reduxDispatch(setVizZoom(originalZoom));
      reduxDispatch(setVizPan(originalPan));
      await raf();
    }

    return segments;
  }, [
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
