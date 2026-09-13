import {
  getVisualizerDefaultDbLimits,
  VISUALIZER_DEFAULT_ZOOM,
  VISUALIZER_MAX_ZOOM,
} from "@n-apt/consts/visualizerControls";

describe("shared visualizer control defaults", () => {
  test("keeps one zoom ceiling and reset defaults for both power scales", () => {
    expect(VISUALIZER_DEFAULT_ZOOM).toBe(1);
    expect(VISUALIZER_MAX_ZOOM).toBe(1125);
    expect(getVisualizerDefaultDbLimits("dB")).toEqual({ min: -120, max: 0 });
    expect(getVisualizerDefaultDbLimits("dBm")).toEqual({ min: -100, max: 30 });
  });
});
