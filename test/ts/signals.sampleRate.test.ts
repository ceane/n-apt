import {
  computeMaxFrameRate,
  resolveSampleRateSpec,
} from "@n-apt/math/signals";

describe("resolveSampleRateSpec", () => {
  it("allows a configured logical frame-rate ceiling above 60 FPS", () => {
    expect(computeMaxFrameRate(3_200_000, 32_768, 120)).toBe(97);
    expect(computeMaxFrameRate(20_000_000, 32_768, 120)).toBe(100);
  });

  it("clamps stale channel-derived rates to the active source maximum", () => {
    expect(
      resolveSampleRateSpec(
        ["__NAPT_SAMPLE_RATE_FLOOR__", "__NAPT_SAMPLE_RATE_CHANNEL__"],
        { min_hz: 18_000, max_hz: 4_390_000 },
        3_200_000,
        3_200_000,
      ),
    ).toEqual({ rate: 3_200_000, options: [3_200_000] });
  });
});
