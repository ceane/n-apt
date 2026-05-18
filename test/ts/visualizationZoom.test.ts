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

  it("preserves the absolute pan position when zoom changes to keep zoom stable", () => {
    const result = getStableVizPanForZoomChange({
      currentZoom: 4,
      currentPan: 10,
      nextZoom: 2,
      rangeMin: 100,
      rangeMax: 200,
    });

    expect(result).toBe(10);
  });

  it("clamps to the new zoom range when zooming out near the edge", () => {
    const result = getStableVizPanForZoomChange({
      currentZoom: 8,
      currentPan: 44,
      nextZoom: 2,
      rangeMin: 100,
      rangeMax: 200,
    });

    // nextMaxPan for nextZoom=2 with range 100-200 (span=100) is:
    // nextVisualSpan = 100 / 2 = 50
    // nextMaxPan = 50 - 25 = 25
    expect(result).toBe(25);
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
