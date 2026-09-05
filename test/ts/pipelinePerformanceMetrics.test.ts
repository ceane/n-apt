import * as PipelinePerformance from "@n-apt/app/infrastructure/performance/pipelineMetrics";

describe("browser pipeline performance metrics", () => {
  it("counts latest-frame drops and sequence gaps separately", () => {
    const metrics = PipelinePerformance.createPipelinePerformanceMetrics(false);
    metrics.frameAccepted(10, 8_192);
    metrics.frameAccepted(13, 8_192);
    metrics.frameDropped(2);

    expect(metrics.snapshot()).toMatchObject({
      framesAccepted: 2,
      framesDropped: 2,
      sequenceGaps: 2,
      bytesReceived: 16_384,
      detailedProfilingEnabled: false,
    });
  });

  it("reports presentation cadence as a screen ceiling", () => {
    const metrics = PipelinePerformance.createPipelinePerformanceMetrics(true);
    metrics.presentationFrame(16);
    metrics.presentationFrame(35);

    expect(metrics.snapshot().presentation).toMatchObject({
      frames: 2,
      refreshMisses: 1,
      warning: PipelinePerformance.PRESENTATION_CEILING_WARNING,
    });
  });
});
