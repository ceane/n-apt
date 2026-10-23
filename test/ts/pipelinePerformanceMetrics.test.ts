import * as PipelinePerformance from "@n-apt/app/infrastructure/performance/pipelineMetrics";

describe("browser pipeline performance metrics", () => {
  it("counts latest-frame drops and sequence gaps separately", () => {
    const metrics = PipelinePerformance.createPipelinePerformanceMetrics(false);
    metrics.frameAccepted(10, 8_192, "rx-a");
    metrics.frameAccepted(13, 8_192, "rx-a");
    metrics.frameAccepted(1, 4_096, "rx-b");
    metrics.frameDropped(2);

    expect(metrics.snapshot()).toMatchObject({
      framesAccepted: 3,
      framesDropped: 2,
      sequenceGaps: 2,
      bytesReceived: 20_480,
      detailedProfilingEnabled: false,
    });
  });

  it("keeps a bounded timing window and reports useful percentiles", () => {
    const metrics = PipelinePerformance.createPipelinePerformanceMetrics(true, 3);
    for (const duration of [4, 9, 6, 100]) {
      metrics.recordTiming("workerCompute", duration);
    }

    expect(metrics.snapshot().timings.workerCompute).toMatchObject({
      observations: 4,
      samples: 3,
      minMs: 6,
      p50Ms: 9,
      p95Ms: 100,
      maxMs: 100,
    });
  });

  it("labels render-loop cadence as a pre-paint proxy", () => {
    const metrics = PipelinePerformance.createPipelinePerformanceMetrics(true);
    metrics.renderLoopCallback(10, 16);
    metrics.renderLoopCallback(26, 16);
    metrics.renderLoopCallback(60, 16);

    expect(metrics.snapshot().renderLoop).toMatchObject({
      callbacks: 3,
      lateIntervals: 1,
      warning: expect.stringContaining("pre-paint proxy"),
    });
    expect(metrics.snapshot().timings.renderLoopInterval.p95Ms).toBe(34);
  });

  it("does not retain detailed samples when profiling is disabled", () => {
    const metrics = PipelinePerformance.createPipelinePerformanceMetrics(false);
    metrics.recordTiming("workerCompute", 12);
    expect(metrics.snapshot().timings.workerCompute.observations).toBe(0);
  });

  it("keeps tune-to-frame latency matched to its source and target frequency", () => {
    jest.useFakeTimers();
    try {
      const metrics = PipelinePerformance.createPipelinePerformanceMetrics(true);
      metrics.retuneRequested("hackrf_one-secret", 13_400_000);
      jest.advanceTimersByTime(70);
      metrics.retuneFrameReceived("rtl_sdr-secret", 13_400_000);
      metrics.retuneFrameReceived("hackrf_one-secret", 13_400_000);

      expect(metrics.snapshot().timings.tuneRequestToFrameReceipt.p50Ms)
        .toBe(70);
      expect(
        metrics.snapshot().sourceTimings["hackrf_one#1"]
          .tuneRequestToFrameReceipt.p95Ms,
      ).toBe(70);
      expect(metrics.snapshot().sourceTimings["rtl_sdr#1"])
        .toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("only measures a fresh frame after an actual center-frequency change", () => {
    jest.useFakeTimers();
    try {
      const metrics = PipelinePerformance.createPipelinePerformanceMetrics(true);
      metrics.retuneFrameReceived("hackrf_one-device", 13_400_000, 10, 2);
      metrics.retuneRequested("hackrf_one-device", 13_400_000);
      jest.advanceTimersByTime(20);
      metrics.retuneFrameReceived("hackrf_one-device", 13_400_000, 11, 2);
      expect(
        metrics.snapshot().timings.tuneRequestToFrameReceipt.observations,
      ).toBe(0);

      metrics.retuneRequested("hackrf_one-device", 13_800_000);
      jest.advanceTimersByTime(10);
      metrics.retuneFrameReceived("hackrf_one-device", 13_800_000, 11, 2);
      jest.advanceTimersByTime(15);
      metrics.retuneFrameReceived("hackrf_one-device", 13_800_000, 12, 2);

      expect(
        metrics.snapshot().timings.tuneRequestToFrameReceipt.p50Ms,
      ).toBe(25);
    } finally {
      jest.useRealTimers();
    }
  });

  it("exposes an opt-in snapshot accessor on the browser window", () => {
    const previous = window.naptPipelineMetrics;
    localStorage.setItem("napt.pipelineProfile", "1");
    let profiledModule: typeof PipelinePerformance | undefined;
    jest.isolateModules(() => {
      profiledModule = require("@n-apt/app/infrastructure/performance/pipelineMetrics");
    });
    expect(window.naptPipelineMetrics?.snapshot()).toEqual(
      profiledModule?.browserPipelineMetrics.snapshot(),
    );
    expect(window.naptPipelineMetrics?.snapshot().detailedProfilingEnabled).toBe(true);
    localStorage.removeItem("napt.pipelineProfile");
    if (previous) window.naptPipelineMetrics = previous;
    else delete window.naptPipelineMetrics;
  });
});
