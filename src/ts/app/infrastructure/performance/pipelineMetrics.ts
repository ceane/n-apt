export const PRESENTATION_CEILING_WARNING =
  "Presentation FPS is calibrated to screen refresh and is not the uncapped production ceiling.";

export type BrowserPipelineSnapshot = {
  detailedProfilingEnabled: boolean;
  framesAccepted: number;
  framesDropped: number;
  sequenceGaps: number;
  bytesReceived: number;
  presentation: {
    frames: number;
    refreshMisses: number;
    warning: string;
  };
};

export type BrowserPipelineMetrics = {
  frameAccepted(sequence: number, bytes: number): void;
  frameDropped(count?: number): void;
  presentationFrame(timestampMs: number, refreshIntervalMs?: number): void;
  snapshot(): BrowserPipelineSnapshot;
};

export const createPipelinePerformanceMetrics = (
  detailedProfilingEnabled: boolean,
): BrowserPipelineMetrics => {
  let framesAccepted = 0;
  let framesDropped = 0;
  let sequenceGaps = 0;
  let bytesReceived = 0;
  let presentationFrames = 0;
  let refreshMisses = 0;
  let lastSequence: number | null = null;
  let lastPresentationTimestamp: number | null = null;

  return {
    frameAccepted(sequence, bytes) {
      framesAccepted += 1;
      bytesReceived += Math.max(0, bytes);
      if (lastSequence !== null && sequence > lastSequence + 1) {
        sequenceGaps += sequence - lastSequence - 1;
      }
      lastSequence = sequence;
    },
    frameDropped(count = 1) {
      framesDropped += Math.max(0, count);
    },
    presentationFrame(timestampMs, refreshIntervalMs = 1000 / 60) {
      presentationFrames += 1;
      if (
        lastPresentationTimestamp !== null &&
        timestampMs - lastPresentationTimestamp > refreshIntervalMs
      ) {
        refreshMisses += 1;
      }
      lastPresentationTimestamp = timestampMs;
    },
    snapshot() {
      return {
        detailedProfilingEnabled,
        framesAccepted,
        framesDropped,
        sequenceGaps,
        bytesReceived,
        presentation: {
          frames: presentationFrames,
          refreshMisses,
          warning: PRESENTATION_CEILING_WARNING,
        },
      };
    },
  };
};

export const browserPipelineMetrics = createPipelinePerformanceMetrics(
  typeof window !== "undefined" &&
    window.localStorage?.getItem("napt.pipelineProfile") === "1",
);
