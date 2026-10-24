import { createPipelinePerformanceMetrics } from "@n-apt/app/infrastructure/performance/pipelineMetrics";

describe("pipeline performance metrics", () => {
  test("records interaction latency and pending-worker presentation skips", () => {
    const metrics = createPipelinePerformanceMetrics(true);
    metrics.interactionRequested();
    metrics.interactionRendered();
    metrics.workerPendingPaintSkipped();

    const snapshot = metrics.snapshot();
    expect(snapshot.timings.interactionToRenderCallback.observations).toBe(1);
    expect(snapshot.interactionFrames).toBe(1);
    expect(snapshot.workerPendingPaintSkips).toBe(1);
  });

  test("records completed GPU queue work separately from CPU render submission", () => {
    const metrics = createPipelinePerformanceMetrics(true);
    const startedAt = metrics.startTiming();
    metrics.finishTiming("gpuQueueCompletion", startedAt);

    expect(metrics.snapshot().timings.gpuQueueCompletion.observations).toBe(1);
  });

  test("keeps detailed interaction measurements disabled by default", () => {
    const metrics = createPipelinePerformanceMetrics(false);
    metrics.interactionRequested();
    metrics.interactionRendered();
    metrics.workerPendingPaintSkipped();

    const snapshot = metrics.snapshot();
    expect(snapshot.timings.interactionToRenderCallback.observations).toBe(0);
    expect(snapshot.workerPendingPaintSkips).toBe(0);
  });
});
