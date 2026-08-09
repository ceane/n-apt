import { getTxSpectrumRevisionKey } from "@n-apt/spectrum/FFTCanvas";

describe("getTxSpectrumRevisionKey", () => {
  it("changes when the TX sample rate changes", () => {
    const base = getTxSpectrumRevisionKey({
      centerFrequencyHz: 137_100_000,
      sampleRateHz: 2_400_000,
      signal: "apt",
      powerDbm: -18,
    });

    expect(
      getTxSpectrumRevisionKey({
        centerFrequencyHz: 137_100_000,
        sampleRateHz: 218_000,
        signal: "apt",
        powerDbm: -18,
      }),
    ).not.toBe(base);
  });
});
