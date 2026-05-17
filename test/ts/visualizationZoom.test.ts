import { getStableVizPanForZoomChange } from "../../src/ts/utils/visualizationZoom";

describe("getStableVizPanForZoomChange", () => {
  it("keeps pan stable when zooming from the center", () => {
    expect(
      getStableVizPanForZoomChange({
        currentZoom: 2,
        currentPan: 0,
        nextZoom: 4,
        rangeMin: 100,
        rangeMax: 200,
      }),
    ).toBe(0);
  });

  it("preserves the relative pan position when zoom changes", () => {
    const result = getStableVizPanForZoomChange({
      currentZoom: 4,
      currentPan: 30,
      nextZoom: 2,
      rangeMin: 100,
      rangeMax: 200,
    });

    expect(result).toBeCloseTo(26.5, 4);
  });

  it("clamps to the new zoom range when zooming out near the edge", () => {
    const result = getStableVizPanForZoomChange({
      currentZoom: 8,
      currentPan: 44,
      nextZoom: 2,
      rangeMin: 100,
      rangeMax: 200,
    });

    expect(result).toBeLessThanOrEqual(25);
    expect(result).toBeGreaterThan(0);
  });

  it("returns to center at full zoom out", () => {
    expect(
      getStableVizPanForZoomChange({
        currentZoom: 6,
        currentPan: 18,
        nextZoom: 1,
        rangeMin: 100,
        rangeMax: 200,
      }),
    ).toBe(0);
  });
});
