import {
  resolveTxFocusGeometry,
  resolveTxFocusSampleRateHz,
} from "@n-apt/spectrum/utils/txFocus";

describe("resolveTxFocusSampleRateHz", () => {
  it("adds about ten percent above the transmit bandwidth", () => {
    expect(
      resolveTxFocusSampleRateHz({
        txBandwidthHz: 5_000_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(5_500_000);
  });

  it("caps the monitor sample rate at the device maximum", () => {
    expect(
      resolveTxFocusSampleRateHz({
        txBandwidthHz: 5_000_000,
        maxSampleRateHz: 5_300_000,
      }),
    ).toBe(5_300_000);
  });

  it("returns null when the Tx bandwidth is invalid", () => {
    expect(
      resolveTxFocusSampleRateHz({
        txBandwidthHz: Number.NaN,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBeNull();
  });
});

describe("resolveTxFocusGeometry", () => {
  it("centers the capped monitor window on the active Tx frequency", () => {
    expect(
      resolveTxFocusGeometry({
        centerFrequencyHz: 100_000_000,
        txBandwidthHz: 5_000_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toEqual({
      sampleRateHz: 5_500_000,
      frequencyRange: { min: 97_250_000, max: 102_750_000 },
    });
  });

  it("keeps the Tx center aligned when focus headroom crosses zero", () => {
    expect(
      resolveTxFocusGeometry({
        centerFrequencyHz: 2_204_000,
        txBandwidthHz: 4_372_000,
        maxSampleRateHz: 20_000_000,
        allowNegativeFrequencies: true,
      }),
    ).toEqual({
      sampleRateHz: 4_809_200,
      frequencyRange: { min: -200_600, max: 4_608_600 },
    });
  });

  it("keeps focus at or above zero when negative frequencies are disabled", () => {
    expect(
      resolveTxFocusGeometry({
        centerFrequencyHz: 2_204_000,
        txBandwidthHz: 4_372_000,
        maxSampleRateHz: 20_000_000,
        allowNegativeFrequencies: false,
      }),
    ).toEqual({
      sampleRateHz: 4_408_000,
      frequencyRange: { min: 0, max: 4_408_000 },
    });
  });
});
