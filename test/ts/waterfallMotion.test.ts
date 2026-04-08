import { getWaterfallMotion } from "../../src/ts/utils/waterfallMotion";

describe("getWaterfallMotion", () => {
  test("does not request a motion row without a previous range", () => {
    expect(
      getWaterfallMotion({
        previousVisualRange: null,
        currentVisualRange: { min: 100, max: 200 },
        textureWidth: 4096,
      }),
    ).toEqual({
      driftBins: 0,
      shouldPaintMotionRow: false,
      smearRows: 0,
    });
  });

  test("requests a motion row when the visual center changes", () => {
    const result = getWaterfallMotion({
      previousVisualRange: { min: 100, max: 200 },
      currentVisualRange: { min: 110, max: 210 },
      textureWidth: 4096,
    });

    expect(result.shouldPaintMotionRow).toBe(true);
    expect(result.driftBins).toBeCloseTo(409.6, 4);
    expect(result.smearRows).toBeGreaterThan(0);
  });

  test("requests a motion row when the zoom span changes", () => {
    const result = getWaterfallMotion({
      previousVisualRange: { min: 100, max: 200 },
      currentVisualRange: { min: 125, max: 175 },
      textureWidth: 4096,
    });

    expect(result.shouldPaintMotionRow).toBe(true);
    expect(result.smearRows).toBeGreaterThan(0);
  });

  test("ignores tiny sub-bin motion", () => {
    const result = getWaterfallMotion({
      previousVisualRange: { min: 100, max: 200 },
      currentVisualRange: { min: 100.001, max: 200.001 },
      textureWidth: 128,
    });

    expect(result.driftBins).toBeCloseTo(0.00128, 6);
    expect(result.shouldPaintMotionRow).toBe(false);
    expect(result.smearRows).toBe(0);
  });
});
