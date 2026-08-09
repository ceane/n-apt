import {
  clampVizZoom,
  getRetunedVizPanForZoomChange,
  getStableVizPanForZoomChange,
  getZoomedViewForCenterFrequency,
} from "@n-apt/spectrum/public/visualizationZoom";

it("allows the VisualizerSliders zoom maximum to reach 1,125x", () => {
  expect(clampVizZoom(1125)).toBe(1125);
});

it("zooms the viewport to show a center frequency inside the hardware bounds", () => {
  expect(
    getZoomedViewForCenterFrequency({
      hardwareRange: { min: 0, max: 100 },
      currentZoom: 1,
      currentPan: 0,
      requestedCenterHz: 75,
    }),
  ).toEqual({ zoom: 2, pan: 25 });
});

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

  it("preserves small near-center pan offsets during zoom changes", () => {
    const result = getStableVizPanForZoomChange({
      currentZoom: 4,
      currentPan: 2,
      nextZoom: 6,
      rangeMin: 100,
      rangeMax: 200,
    });

    expect(result).toBe(2);
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

  it("retunes the hardware window when zooming out would otherwise clamp the visual center", () => {
    const result = getRetunedVizPanForZoomChange({
      currentPan: 44,
      nextZoom: 2,
      rangeMin: 100,
      rangeMax: 200,
    });

    expect(result.retuned).toBe(true);
    expect(result.frequencyRange).toEqual({ min: 119, max: 219 });
    expect(result.pan).toBe(25);
  });

  it("keeps zoom-out retunes inside active channel bounds", () => {
    const result = getRetunedVizPanForZoomChange({
      currentPan: 44,
      nextZoom: 2,
      rangeMin: 100,
      rangeMax: 200,
      bounds: { min: 90, max: 210 },
    });

    expect(result.retuned).toBe(true);
    expect(result.frequencyRange).toEqual({ min: 110, max: 210 });
    expect(result.pan).toBe(25);
  });
});
