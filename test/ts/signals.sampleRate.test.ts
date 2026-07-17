import { resolveSampleRateSpec } from "@n-apt/utils/signals";

describe("resolveSampleRateSpec", () => {
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
