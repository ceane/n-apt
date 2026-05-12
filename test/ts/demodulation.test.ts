import {
  computeFrequencyOffsetHz,
  shiftIqToBaseband,
} from "../../src/ts/utils/demodulation";

describe("demodulation utilities", () => {
  it("computes frequency offset from the selected and frame center frequencies", () => {
    expect(computeFrequencyOffsetHz(137_930_000, 137_920_000)).toBe(10_000);
    expect(computeFrequencyOffsetHz(137_910_000, 137_920_000)).toBe(-10_000);
  });

  it("changes IQ samples when a non-zero frequency offset is applied", () => {
    const iq = new Uint8Array([
      255, 128,
      255, 128,
      255, 128,
      255, 128,
    ]);

    const shifted = shiftIqToBaseband(iq, 4_000, 1_000);

    expect(Array.from(shifted)).not.toEqual([
      0.9921875, 0,
      0.9921875, 0,
      0.9921875, 0,
      0.9921875, 0,
    ]);
  });
});
