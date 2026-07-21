import { resolveDemodSourceRange } from "../demodThunks";

describe("resolveDemodSourceRange", () => {
  it("uses the current live visualizer range instead of a stale whole-channel frame", () => {
    expect(
      resolveDemodSourceRange({
        sourceMode: "live",
        sampleRateHz: 3_200_000,
        liveFrame: {
          center_frequency_hz: 26_000_000,
          sample_rate: 4_372_000,
        },
        liveFrequencyRange: { min: 24_400_000, max: 27_600_000 },
      }),
    ).toEqual({
      range: { min: 24_400_000, max: 27_600_000 },
      reason: "live_frequency_range",
    });
  });
});
