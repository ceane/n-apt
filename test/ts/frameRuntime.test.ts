import {
  createFrameRuntime,
  createSourceFrameRuntime,
} from "../../src/ts/visualization/frameRuntime";

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
});
