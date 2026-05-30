import {
  computeFrequencyOffsetHz,
  applyComplexLowPass,
  shiftIqToBaseband,
} from "../../src/ts/utils/demodulation";

describe("demodulation utilities", () => {
  it("computes frequency offset from the selected and frame center frequencies", () => {
    expect(computeFrequencyOffsetHz(137_930_000, 137_920_000)).toBe(10_000);
    expect(computeFrequencyOffsetHz(137_910_000, 137_920_000)).toBe(-10_000);
  });

  it("changes IQ samples when a non-zero frequency offset is applied", () => {
    const iq = new Uint8Array([255, 128, 255, 128, 255, 128, 255, 128]);

    const shifted = shiftIqToBaseband(iq, 4_000, 1_000);

    expect(Array.from(shifted)).not.toEqual([
      0.9921875, 0, 0.9921875, 0, 0.9921875, 0, 0.9921875, 0,
    ]);
  });

  it("attenuates fast IQ changes more when the bandwidth is narrower", () => {
    const iq = new Float32Array([1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1, 0]);

    const wide = applyComplexLowPass(iq, 3_200_000, 200_000);
    const narrow = applyComplexLowPass(iq, 3_200_000, 10_000);

    const wideDelta = Math.abs(wide[2] - wide[0]);
    const narrowDelta = Math.abs(narrow[2] - narrow[0]);

    expect(narrowDelta).toBeLessThan(wideDelta);
  });
});
