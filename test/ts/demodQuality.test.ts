import {
  DEMOD_MIN_FFT_SIZE,
  beforeDemodEnforceQuality,
  getDemodQualityLockedFftSizes,
  hasConnectedDemodQualityNode,
} from "../../src/ts/utils/demodQuality";

describe("demodQuality", () => {
  it("filters out FFT sizes below the demod quality floor", () => {
    expect(
      getDemodQualityLockedFftSizes([16_384, 32_768, 65_536, 131_072]),
    ).toEqual([65_536, 131_072]);
  });

  it("falls back to the minimum FFT size when no higher options exist", () => {
    expect(getDemodQualityLockedFftSizes([8_192, 16_384])).toEqual([
      DEMOD_MIN_FFT_SIZE,
    ]);
  });

  it("keeps the current FFT size available when it already exceeds the floor", () => {
    expect(
      getDemodQualityLockedFftSizes(
        [65_536, 131_072],
        DEMOD_MIN_FFT_SIZE,
        262_144,
      ),
    ).toEqual([65_536, 131_072, 262_144]);
  });

  it("enforces the minimum FFT size and lossless temporal resolution when locked", () => {
    expect(
      beforeDemodEnforceQuality(
        { fftSize: 32_768, temporalResolution: "slow" },
        true,
      ),
    ).toEqual({
      fftSize: 65_536,
      temporalResolution: "lossless",
    });
  });

  it("preserves settings when the quality guard is not active", () => {
    expect(
      beforeDemodEnforceQuality(
        { fftSize: 32_768, temporalResolution: "reduced" },
        false,
      ),
    ).toEqual({
      fftSize: 32_768,
      temporalResolution: "reduced",
    });
  });

  it("treats connected radio and stimulus nodes as quality-sensitive", () => {
    const nodes = [
      { id: "radio", data: { radioOptions: true } },
      { id: "stimulus", data: { stimulusOptions: true } },
      { id: "helper", data: {} },
    ];

    expect(
      hasConnectedDemodQualityNode(nodes, [
        { source: "helper", target: "radio" },
      ]),
    ).toBe(true);
    expect(
      hasConnectedDemodQualityNode(nodes, [
        { source: "stimulus", target: "helper" },
      ]),
    ).toBe(true);
    expect(
      hasConnectedDemodQualityNode(nodes, [
        { source: "helper", target: "other" },
      ]),
    ).toBe(false);
  });
});
