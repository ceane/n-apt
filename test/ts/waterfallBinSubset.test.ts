import {
  DEFAULT_WATERFALL_BIN_SUBSET,
  selectWaterfallBinSubset,
} from "@n-apt/spectrum/public/waterfallBinSubset";

describe("selectWaterfallBinSubset", () => {
  const spectrum = new Float32Array([0, 1, 2, 3, 4, 5]);

  it("leaves the row untouched when Bin Subset is None", () => {
    expect(
      selectWaterfallBinSubset(spectrum, DEFAULT_WATERFALL_BIN_SUBSET),
    ).toBe(spectrum);
  });

  it("packs odd bins into the half-width output", () => {
    expect(
      Array.from(
        selectWaterfallBinSubset(spectrum, {
          mode: "interleaved",
          parity: "odd",
        }),
      ),
    ).toEqual([1, 3, 5]);
  });

  it("packs even bins into the half-width output", () => {
    expect(
      Array.from(
        selectWaterfallBinSubset(spectrum, {
          mode: "interleaved",
          parity: "even",
        }),
      ),
    ).toEqual([0, 2, 4]);
  });
});
