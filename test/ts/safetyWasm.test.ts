import {
  getQuantizedIqPowerFloorDbmJS,
  getRecommendedFftSizeForIqPowerDbmJS,
} from "../../src/ts/utils/safetyWasm";

describe("IQ quantization power floor", () => {
  it("calculates the 8-bit IQ floor from FFT size", () => {
    expect(getQuantizedIqPowerFloorDbmJS(8, 2048, 30)).toBeCloseTo(-45.257, 3);
    expect(getQuantizedIqPowerFloorDbmJS(8, 65_536, 30)).toBeCloseTo(
      -60.309,
      3,
    );
  });

  it("recommends a larger FFT size for lower requested powers", () => {
    expect(getRecommendedFftSizeForIqPowerDbmJS(-70, 8, 30)).toBe(1_048_576);
  });
});
