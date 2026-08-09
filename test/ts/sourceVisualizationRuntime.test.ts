import {
  SourceVisualizationRuntime,
  getLiveVisualizationCapability,
} from "@n-apt/app/infrastructure/visualization/sourceVisualizationRuntime";

type Frame = {
  source_id: string;
  stream_epoch: number;
  sequence: number;
  iq_data: Uint8Array;
};

const frame = (sourceId: string, epoch: number, sequence: number): Frame => ({
  source_id: sourceId,
  stream_epoch: epoch,
  sequence,
  iq_data: new Uint8Array([sequence]),
});

describe("SourceVisualizationRuntime", () => {
  it("keeps one latest presentation frame per source", () => {
    const runtime = new SourceVisualizationRuntime<Frame>();
    runtime.publish(frame("rx", 1, 1));
    runtime.publish(frame("rx", 1, 2));
    const latest = frame("rx", 1, 3);
    runtime.publish(latest);

    expect(runtime.getSourceRef("rx").current).toBe(latest);
    expect(runtime.getMetrics("rx")).toEqual(
      expect.objectContaining({ accepted: 3, dropped: 2, queueDepth: 1 }),
    );
  });

  it("isolates sources and rejects stale epochs and sequences", () => {
    const runtime = new SourceVisualizationRuntime<Frame>();
    const rx = frame("rx", 2, 4);
    const tx = frame("tx", 7, 9);
    expect(runtime.publish(rx)).toBe(true);
    expect(runtime.publish(tx)).toBe(true);
    expect(runtime.publish(frame("rx", 1, 99))).toBe(false);
    expect(runtime.publish(frame("tx", 7, 8))).toBe(false);

    expect(runtime.getSourceRef("rx").current).toBe(rx);
    expect(runtime.getSourceRef("tx").current).toBe(tx);
    expect(runtime.getMetrics("rx").stale).toBe(1);
    expect(runtime.getMetrics("tx").stale).toBe(1);
  });

  it("resets one source without invalidating mounted ref consumers", () => {
    const runtime = new SourceVisualizationRuntime<Frame>();
    runtime.publish(frame("tx", 4, 9));
    const sourceRef = runtime.getSourceRef("tx");

    runtime.reset("tx");

    expect(runtime.getSourceRef("tx")).toBe(sourceRef);
    expect(sourceRef.current).toBeNull();
    expect(runtime.publish(frame("tx", 1, 1))).toBe(true);
  });

  it("reports the mandatory worker WebGPU capability boundary", () => {
    expect(
      getLiveVisualizationCapability({
        webGpu: true,
        offscreenCanvas: true,
        worker: true,
      }),
    ).toEqual({ supported: true, reason: null });
    expect(
      getLiveVisualizationCapability({
        webGpu: false,
        offscreenCanvas: true,
        worker: true,
      }),
    ).toEqual({
      supported: false,
      reason: "Live visualization requires WebGPU",
    });
  });
});
