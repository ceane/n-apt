export const RENDER_LOOP_WARNING =
  "Render-loop callback cadence is a pre-paint proxy; it does not measure browser paint or display presentation.";

export const PIPELINE_TIMING_STAGES = [
  "frameReceiptToDecrypt",
  "frameDecrypt",
  "tuneRequestToFrameReceipt",
  "workerQueueWait",
  "workerCompute",
  "workerRoundTrip",
  "renderSubmit",
  "renderCallback",
  "interactionToRenderCallback",
  "overlayRaster",
  "overlayUpload",
  "browserStatePublish",
  "gpuQueueCompletion",
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
  interactionFrames: number;
  workerPendingPaintSkips: number;
  workerResultsRejectedAsStale: number;
  latestFramesReplaced: number;
  renderLoop: {
    callbacks: number;
    lateIntervals: number;
    warning: string;
  };
  timings: Record<PipelineTimingStage, PipelineTimingSummary>;
  sourceTimings: Record<
    string,
    { tuneRequestToFrameReceipt: PipelineTimingSummary }
  >;
};

export type BrowserPipelineMetrics = {
  frameAccepted(sequence: number, bytes: number, streamId?: string): void;
  frameDropped(count?: number): void;
  frameReplaced(count?: number): void;
  workerPendingPaintSkipped(): void;
  workerResultRejectedAsStale(): void;
  interactionRequested(): void;
  interactionRendered(): void;
  startTiming(): number | null;
  finishTiming(stage: PipelineTimingStage, startedAt: number | null): void;
  recordTiming(stage: PipelineTimingStage, durationMs: number): void;
  renderLoopCallback(timestampMs: number, targetIntervalMs?: number): void;
  retuneRequested(sourceId: string, targetFrequencyHz: number): void;
  retuneFrameReceived(
    sourceId: string,
    centerFrequencyHz: number,
    sequence?: number,
    streamEpoch?: number,
  ): void;
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
  let interactionFrames = 0;
  let workerPendingPaintSkips = 0;
  let workerResultsRejectedAsStale = 0;
  let latestFramesReplaced = 0;
  let pendingInteractionAt: number | null = null;
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
  const sourceLabelById = new Map<string, string>();
  const nextSourceIndexByKind = new Map<string, number>();
  const pendingRetunes = new Map<
    string,
    {
      startedAt: number;
      sourceLabel: string;
      baselineSequence?: number;
      baselineStreamEpoch?: number;
    }
  >();
  const lastFrameBySource = new Map<
    string,
    { centerFrequencyHz: number; sequence?: number; streamEpoch?: number }
  >();
  const sourceTuneSamples = new Map<string, number[]>();
  const sourceTuneObservations = new Map<string, number>();

  const getSourceLabel = (sourceId: string): string | null => {
    const existing = sourceLabelById.get(sourceId);
    if (existing) return existing;
    if (sourceLabelById.size >= 64) return null;
    const kind =
      sourceId
        .trim()
        .toLowerCase()
        .split(/[-/:]/, 1)[0]
        .replace(/[^a-z0-9_]/g, "_") || "source";
    const sourceIndex = (nextSourceIndexByKind.get(kind) ?? 0) + 1;
    nextSourceIndexByKind.set(kind, sourceIndex);
    const label = `${kind}#${sourceIndex}`;
    sourceLabelById.set(sourceId, label);
    return label;
  };

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
    frameReplaced(count = 1) {
      if (detailedProfilingEnabled) {
        latestFramesReplaced += Math.max(0, count);
      }
    },
    workerPendingPaintSkipped() {
      if (detailedProfilingEnabled) workerPendingPaintSkips += 1;
    },
    workerResultRejectedAsStale() {
      if (detailedProfilingEnabled) workerResultsRejectedAsStale += 1;
    },
    interactionRequested() {
      if (detailedProfilingEnabled && typeof performance !== "undefined") {
        pendingInteractionAt = performance.now();
      }
    },
    interactionRendered() {
      if (!detailedProfilingEnabled || pendingInteractionAt === null) return;
      interactionFrames += 1;
      recordTiming(
        "interactionToRenderCallback",
        performance.now() - pendingInteractionAt,
      );
      pendingInteractionAt = null;
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
    retuneRequested(sourceId, targetFrequencyHz) {
      if (
        !detailedProfilingEnabled ||
        typeof performance === "undefined" ||
        !sourceId ||
        !Number.isFinite(targetFrequencyHz) ||
        targetFrequencyHz <= 0
      ) {
        return;
      }
      const sourceLabel = getSourceLabel(sourceId);
      if (!sourceLabel) return;
      const target = Math.round(targetFrequencyHz);
      const lastFrame = lastFrameBySource.get(sourceId);
      if (lastFrame?.centerFrequencyHz === target) return;
      const key = `${sourceId}\u0000${target}`;
      pendingRetunes.set(key, {
        startedAt: performance.now(),
        sourceLabel,
        baselineSequence: lastFrame?.sequence,
        baselineStreamEpoch: lastFrame?.streamEpoch,
      });
      while (pendingRetunes.size > capacity) {
        const oldestKey = pendingRetunes.keys().next().value;
        if (oldestKey === undefined) break;
        pendingRetunes.delete(oldestKey);
      }
    },
    retuneFrameReceived(sourceId, centerFrequencyHz, sequence, streamEpoch) {
      if (
        !detailedProfilingEnabled ||
        typeof performance === "undefined" ||
        !sourceId ||
        !Number.isFinite(centerFrequencyHz) ||
        centerFrequencyHz <= 0
      ) {
        return;
      }
      const center = Math.round(centerFrequencyHz);
      const frame = {
        centerFrequencyHz: center,
        ...(Number.isFinite(sequence) ? { sequence } : {}),
        ...(Number.isFinite(streamEpoch) ? { streamEpoch } : {}),
      };
      const key = `${sourceId}\u0000${center}`;
      const request = pendingRetunes.get(key);
      const isFreshFrame =
        request?.baselineStreamEpoch !== undefined &&
        frame.streamEpoch !== undefined
          ? frame.streamEpoch !== request.baselineStreamEpoch ||
            request.baselineSequence === undefined ||
            frame.sequence === undefined ||
            frame.sequence > request.baselineSequence
          : request?.baselineSequence === undefined ||
            frame.sequence === undefined ||
            frame.sequence > request.baselineSequence;
      if (lastFrameBySource.has(sourceId) || lastFrameBySource.size < 64) {
        lastFrameBySource.set(sourceId, frame);
      }
      if (!request || !isFreshFrame) return;
      pendingRetunes.delete(key);
      const durationMs = performance.now() - request.startedAt;
      recordTiming("tuneRequestToFrameReceipt", durationMs);
      const stageSamples = sourceTuneSamples.get(request.sourceLabel) ?? [];
      stageSamples.push(durationMs);
      if (stageSamples.length > capacity) stageSamples.shift();
      sourceTuneSamples.set(request.sourceLabel, stageSamples);
      sourceTuneObservations.set(
        request.sourceLabel,
        (sourceTuneObservations.get(request.sourceLabel) ?? 0) + 1,
      );
    },
    snapshot() {
      const timings = Object.fromEntries(
        PIPELINE_TIMING_STAGES.map((stage) => [
          stage,
          summarize(samples.get(stage)!, observations.get(stage)!),
        ]),
      ) as Record<PipelineTimingStage, PipelineTimingSummary>;
      const sourceTimings = Object.fromEntries(
        Array.from(sourceTuneSamples, ([sourceId, sourceSamples]) => [
          sourceId,
          {
            tuneRequestToFrameReceipt: summarize(
              sourceSamples,
              sourceTuneObservations.get(sourceId) ?? sourceSamples.length,
            ),
          },
        ]),
      ) as BrowserPipelineSnapshot["sourceTimings"];
      return {
        detailedProfilingEnabled,
        framesAccepted,
        framesDropped,
        sequenceGaps,
        bytesReceived,
        interactionFrames,
        workerPendingPaintSkips,
        workerResultsRejectedAsStale,
        latestFramesReplaced,
        renderLoop: {
          callbacks: renderCallbacks,
          lateIntervals: lateRenderIntervals,
          warning: RENDER_LOOP_WARNING,
        },
        timings,
        sourceTimings,
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
