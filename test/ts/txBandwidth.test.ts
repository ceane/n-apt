import { getTxFrequencyRangeForBandwidth } from "@n-apt/components/sidebar/TxSettingsSection";

describe("Bandwidth + Center Tx settings", () => {
  it("calculates the Tx range without requiring an Rx sample-rate change", () => {
    expect(getTxFrequencyRangeForBandwidth(10_000_000, 8_000_000)).toEqual({
      min: 6_000_000,
      max: 14_000_000,
    });
  });

  it("does not produce a range for invalid bandwidth", () => {
    expect(getTxFrequencyRangeForBandwidth(10_000_000, 0)).toBeNull();
  });
});
