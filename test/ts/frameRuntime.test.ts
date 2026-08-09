import {
  createFrameRuntime,
  createSourceFrameRuntime,
  getLiveFrameRefForSource,
  subscribeFrameRuntime,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
import {
  liveDataBySourceRef,
  presentationController,
  sourceVisualizationRuntime,
} from "@n-apt/redux/middleware/websocketMiddleware";

describe("frame runtime", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("shares one clock while preserving subscriber cadence", () => {
    jest.useFakeTimers();
    const fast = jest.fn();
    const slow = jest.fn();
    const unsubscribeFast = subscribeFrameRuntime(fast, 50);
    const unsubscribeSlow = subscribeFrameRuntime(slow, 250);

    jest.advanceTimersByTime(200);
    expect(fast).toHaveBeenCalledTimes(4);
    expect(slow).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(100);
    expect(slow).toHaveBeenCalledTimes(1);

    unsubscribeFast();
    unsubscribeSlow();
  });

  test("reads and clears an imperative frame slot without React state", () => {
    const ref = { current: { sequence: 1 } as { sequence: number } | null };
    const runtime = createFrameRuntime(ref);

    expect(runtime.read()).toEqual({ sequence: 1 });
    runtime.clear();
    expect(runtime.read()).toBeNull();
    expect(ref.current).toBeNull();
  });

  test("selects a source-specific slot and falls back to the live slot", () => {
    const fallback = {
      current: { sequence: 1 } as { sequence: number } | null,
    };
    const bySource = {
      current: {
        "source-a": {
          current: { sequence: 2 } as { sequence: number } | null,
        },
      },
    };
    const runtime = createSourceFrameRuntime(fallback, bySource);

    expect(runtime.getRef("source-a").current).toEqual({ sequence: 2 });
    expect(runtime.getRef("source-b")).toBe(fallback);
  });

  test("routes Mock Tx presentation reads to its source-scoped frame slot", () => {
    const previous = liveDataBySourceRef.current;
    try {
      liveDataBySourceRef.current = {};
      const txRef = getLiveFrameRefForSource("mock-tx");
      txRef.current = { sequence: 2 } as any;
      const rxRef = getLiveFrameRefForSource("mock-apt");

      expect(txRef.current).toEqual({ sequence: 2 });
      expect(txRef).not.toBe(rxRef);

      liveDataBySourceRef.current["mock-tx"] = {
        current: { sequence: 3 } as any,
      };
      expect(txRef.current).toEqual({ sequence: 3 });
    } finally {
      liveDataBySourceRef.current = previous;
    }
  });

  test("keeps RX and TX presentation reads isolated for one source", () => {
    const rxFrame = { source_id: "shared-source", frame_status: "receiving" };
    const txFrame = {
      source_id: "shared-source",
      frame_status: "standby",
      is_tx_preview: true,
    };
    const previous = liveDataBySourceRef.current;
    try {
      liveDataBySourceRef.current = {};
      presentationController.reset();

      presentationController.selectSource("shared-source", "rx");
      presentationController.commitActiveSource("shared-source");
      presentationController.acceptFrame(rxFrame as any, "rx");

      presentationController.selectSource("shared-source", "tx");
      presentationController.commitActiveSource("shared-source");
      presentationController.acceptFrame(txFrame as any, "tx");

      presentationController.selectSource("shared-source", "rx");
      presentationController.commitActiveSource("shared-source");

      expect(getLiveFrameRefForSource("shared-source", "rx").current).toBe(
        rxFrame,
      );
      expect(getLiveFrameRefForSource("shared-source", "tx").current).toBe(
        txFrame,
      );
    } finally {
      presentationController.reset();
      liveDataBySourceRef.current = previous;
    }
  });

  test("does not fall back from an RX slot to a source-scoped TX frame", () => {
    const previous = liveDataBySourceRef.current;
    try {
      liveDataBySourceRef.current = {};
      presentationController.reset();
      sourceVisualizationRuntime.clear();

      const txFrame = {
        source_id: "shared-source",
        frame_status: "transmitting",
        is_tx_preview: true,
      };
      sourceVisualizationRuntime.publish(txFrame as any);
      liveDataBySourceRef.current["shared-source"] =
        sourceVisualizationRuntime.getSourceRef("shared-source");

      expect(getLiveFrameRefForSource("shared-source", "rx").current).toBeNull();
    } finally {
      presentationController.reset();
      sourceVisualizationRuntime.clear();
      liveDataBySourceRef.current = previous;
    }
  });
});
