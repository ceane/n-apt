import {
  createFrameRuntime,
  createSourceFrameRuntime,
  getLiveFrameRefForSource,
} from "../../src/ts/visualization/frameRuntime";
import { liveDataBySourceRef } from "../../src/ts/redux/middleware/websocketMiddleware";

describe("frame runtime", () => {
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
});
