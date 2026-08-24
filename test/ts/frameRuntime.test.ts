import {
  __getSourceFrameProxyCacheSize,
  createFrameRuntime,
  createSourceFrameRuntime,
  getLiveFrameRefForSource,
  notifyFrameArrival,
  resolveFrameSlot,
  subscribeFrameArrivals,
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

  test("notifies frame arrivals without starting a polling clock", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFrameArrivals(listener);

    notifyFrameArrival();
    notifyFrameArrival();

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
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

  test("returns the same proxy for repeated lookups of one source/mode key", () => {
    const previous = liveDataBySourceRef.current;
    try {
      liveDataBySourceRef.current = {};
      presentationController.reset();

      const first = getLiveFrameRefForSource("proxy-stability", "rx");
      expect(getLiveFrameRefForSource("proxy-stability", "rx")).toBe(first);
      expect(getLiveFrameRefForSource("proxy-stability")).toBe(
        getLiveFrameRefForSource("proxy-stability"),
      );
      // Distinct keys are distinct proxies.
      expect(getLiveFrameRefForSource("proxy-stability", "tx")).not.toBe(first);
    } finally {
      presentationController.reset();
      liveDataBySourceRef.current = previous;
    }
  });

  test("writes through the proxy into the resolved target and clears it", () => {
    const previous = liveDataBySourceRef.current;
    try {
      liveDataBySourceRef.current = {};
      presentationController.reset();
      sourceVisualizationRuntime.clear();

      const ref = getLiveFrameRefForSource("write-through");
      const frame = { sequence: 9 };
      ref.current = frame;
      expect(ref.current).toBe(frame);

      // Route transitions issue exactly this clear across handoffs.
      ref.current = null;
      expect(ref.current).toBeNull();
    } finally {
      presentationController.reset();
      sourceVisualizationRuntime.clear();
      liveDataBySourceRef.current = previous;
    }
  });

  test("serves a paused source's frozen frame once it is no longer the active target", () => {
    const previous = liveDataBySourceRef.current;
    try {
      liveDataBySourceRef.current = {};
      presentationController.reset();
      sourceVisualizationRuntime.clear();

      // Freeze a frame for source A while it is presented…
      presentationController.selectSource("frozen-src", "rx");
      presentationController.commitActiveSource("frozen-src");
      const frozenFrame = { source_id: "frozen-src", sequence: 1 };
      presentationController.acceptFrame(frozenFrame as any, "rx");
      // Pausing snapshots the live frame into the slot's frozen frame.
      presentationController.setPaused("frozen-src", "rx", true);

      // …then move presentation to another source. Reads of A now resolve
      // through A's own slot rather than the active presentation ref.
      presentationController.selectSource("other-src", "rx");
      presentationController.commitActiveSource("other-src");

      expect(getLiveFrameRefForSource("frozen-src", "rx").current).toBe(
        frozenFrame,
      );
    } finally {
      presentationController.reset();
      sourceVisualizationRuntime.clear();
      liveDataBySourceRef.current = previous;
    }
  });
});

describe("resolveFrameSlot", () => {
  const fallback = { current: null };

  afterEach(() => {
    presentationController.reset();
    sourceVisualizationRuntime.clear();
  });

  test("names each rung of the resolution ladder", () => {
    presentationController.reset();
    liveDataBySourceRef.current = {};

    // Tier 3 fallback: explicit mode, no slot.
    expect(resolveFrameSlot("tier-test", "rx", fallback)).toEqual({
      ref: fallback,
      kind: "fallback",
    });

    // Tier 2 slot-live once the source has a mode slot…
    presentationController.selectSource("tier-test", "rx");
    presentationController.commitActiveSource("tier-test");
    const liveFrame = { source_id: "tier-test", sequence: 1 };
    presentationController.acceptFrame(liveFrame as any, "rx");

    const slotResolution = resolveFrameSlot("tier-test", "rx", fallback);
    // The source is the active target, so tier 1 wins with its own ref kind.
    expect(slotResolution.kind).toBe("active-presentation");

    // …and tier 2 is observable for a non-active source with a frozen frame.
    presentationController.setPaused("tier-test", "rx", true);
    presentationController.selectSource("other-tier", "rx");
    presentationController.commitActiveSource("other-tier");
    const frozen = resolveFrameSlot("tier-test", "rx", fallback);
    expect(frozen.kind).toBe("slot-frozen");
    expect(frozen.ref.current).toMatchObject({ sequence: 1 });
  });

  test("never crosses the RX/TX boundary even for the active target", () => {
    presentationController.reset();
    presentationController.selectSource("mode-strict", "rx");
    presentationController.commitActiveSource("mode-strict");

    // Asking with an explicit different mode must not serve the active RX
    // presentation ref.
    const txResolution = resolveFrameSlot("mode-strict", "tx", fallback);
    expect(txResolution.kind).toBe("fallback");
    expect(txResolution.ref).toBe(fallback);
  });
});

describe("source frame proxy cache", () => {
  test("stays bounded while evicted proxies keep resolving through live state", () => {
    const previous = liveDataBySourceRef.current;
    try {
      liveDataBySourceRef.current = {};
      presentationController.reset();

      const held = getLiveFrameRefForSource("held-source");
      held.current = { marker: true };

      // Flood past the bound (implementation cap is 64).
      for (let index = 0; index < 80; index += 1) {
        getLiveFrameRefForSource(`churn-${index}`);
      }

      // The still-held proxy keeps working through its closure even though
      // it was evicted from the cache.
      expect(held.current).toEqual({ marker: true });

      expect(__getSourceFrameProxyCacheSize()).toBeLessThanOrEqual(64);
    } finally {
      liveDataBySourceRef.current = previous;
      presentationController.reset();
    }
  });
});
