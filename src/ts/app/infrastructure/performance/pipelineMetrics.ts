export const RENDER_LOOP_WARNING =
  "Render-loop callback cadence is a pre-paint proxy; it does not measure browser paint or display presentation.";

export const PIPELINE_TIMING_STAGES = [
  "frameReceiptToDecrypt",
  "frameDecrypt",
  "workerQueueWait",
  "workerCompute",
  "workerRoundTrip",
  "renderSubmit",
  "renderLoopInterval",
] as const;

export type PipelineTimingStage = (typeof PIPELINE_TIMING_STAGES)[number];

export type PipelineTimingSummary = {
  observations: number;
  samples: number;
  minMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};

export type BrowserPipelineSnapshot = {
  detailedProfilingEnabled: boolean;
  framesAccepted: number;
  framesDropped: number;
  sequenceGaps: number;
  bytesReceived: number;
  renderLoop: {
    callbacks: number;
    lateIntervals: number;
    warning: string;
  };
  timings: Record<PipelineTimingStage, PipelineTimingSummary>;
};

export type BrowserPipelineMetrics = {
  frameAccepted(sequence: number, bytes: number, streamId?: string): void;
  frameDropped(count?: number): void;
  startTiming(): number | null;
  finishTiming(stage: PipelineTimingStage, startedAt: number | null): void;
  recordTiming(stage: PipelineTimingStage, durationMs: number): void;
  renderLoopCallback(timestampMs: number, targetIntervalMs?: number): void;
  snapshot(): BrowserPipelineSnapshot;
};

const emptyTimingSummary = (): PipelineTimingSummary => ({
  observations: 0,
  samples: 0,
  minMs: null,
  p50Ms: null,
  p95Ms: null,
  maxMs: null,
});

const summarize = (samples: number[], observations: number): PipelineTimingSummary => {
  if (samples.length === 0) return { ...emptyTimingSummary(), observations };
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  return {
    observations,
    samples: samples.length,
    minMs: sorted[0],
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1],
  };
};

export const createPipelinePerformanceMetrics = (
  detailedProfilingEnabled: boolean,
  sampleCapacity = 256,
): BrowserPipelineMetrics => {
  let framesAccepted = 0;
  let framesDropped = 0;
  let sequenceGaps = 0;
  let bytesReceived = 0;
  let renderCallbacks = 0;
  let lateRenderIntervals = 0;
  const lastSequenceByStream = new Map<string, number>();
  let lastRenderCallbackAt: number | null = null;
  const capacity = Math.max(1, Math.floor(sampleCapacity));
  const samples = new Map<PipelineTimingStage, number[]>(
    PIPELINE_TIMING_STAGES.map((stage) => [stage, []]),
  );
  const observations = new Map<PipelineTimingStage, number>(
    PIPELINE_TIMING_STAGES.map((stage) => [stage, 0]),
  );

  const recordTiming = (stage: PipelineTimingStage, durationMs: number) => {
    if (!detailedProfilingEnabled || !Number.isFinite(durationMs) || durationMs < 0) return;
    const stageSamples = samples.get(stage)!;
    stageSamples.push(durationMs);
    if (stageSamples.length > capacity) stageSamples.shift();
    observations.set(stage, observations.get(stage)! + 1);
  };

  return {
    frameAccepted(sequence, bytes, streamId = "default") {
      framesAccepted += 1;
      bytesReceived += Math.max(0, bytes);
      const lastSequence = lastSequenceByStream.get(streamId);
      if (lastSequence !== undefined && sequence > lastSequence + 1) {
        sequenceGaps += sequence - lastSequence - 1;
      }
      if (lastSequence === undefined || sequence > lastSequence) {
        lastSequenceByStream.set(streamId, sequence);
      }
    },
    frameDropped(count = 1) {
      framesDropped += Math.max(0, count);
    },
    startTiming() {
      return detailedProfilingEnabled && typeof performance !== "undefined"
        ? performance.now()
        : null;
    },
    finishTiming(stage, startedAt) {
      if (startedAt === null || typeof performance === "undefined") return;
      recordTiming(stage, performance.now() - startedAt);
    },
    recordTiming,
    renderLoopCallback(timestampMs, targetIntervalMs = 1000 / 60) {
      renderCallbacks += 1;
      if (lastRenderCallbackAt !== null) {
        const intervalMs = timestampMs - lastRenderCallbackAt;
        recordTiming("renderLoopInterval", intervalMs);
        if (intervalMs > targetIntervalMs * 1.5) lateRenderIntervals += 1;
      }
      lastRenderCallbackAt = timestampMs;
    },
    snapshot() {
      const timings = Object.fromEntries(
        PIPELINE_TIMING_STAGES.map((stage) => [
          stage,
          summarize(samples.get(stage)!, observations.get(stage)!),
        ]),
      ) as Record<PipelineTimingStage, PipelineTimingSummary>;
      return {
        detailedProfilingEnabled,
        framesAccepted,
        framesDropped,
        sequenceGaps,
        bytesReceived,
        renderLoop: {
          callbacks: renderCallbacks,
          lateIntervals: lateRenderIntervals,
          warning: RENDER_LOOP_WARNING,
        },
        timings,
      };
    },
  };
};

const isPipelineProfilingEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem("napt.pipelineProfile") === "1";
  } catch {
    return false;
  }
};

export const browserPipelineMetrics = createPipelinePerformanceMetrics(
  isPipelineProfilingEnabled(),
);

declare global {
  interface Window {
    naptPipelineMetrics?: { snapshot: () => BrowserPipelineSnapshot };
  }
}

if (typeof window !== "undefined" && browserPipelineMetrics.snapshot().detailedProfilingEnabled) {
  window.naptPipelineMetrics = { snapshot: () => browserPipelineMetrics.snapshot() };
}
