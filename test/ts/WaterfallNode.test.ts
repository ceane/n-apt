import { getWaterfallNodeFrequencyRange } from "@n-apt/components/react-flow/nodes/WaterfallNode";

describe("WaterfallNode Tx display range", () => {
  it("uses the configured whole-channel Tx window while an old frame is cached", () => {
    expect(
      getWaterfallNodeFrequencyRange({
        sourceRole: "tx",
        fallbackRange: { min: 127_975_000, max: 146_225_000 },
        expectedCenterFrequencyHz: 137_100_000,
        expectedSampleRateHz: 18_250_000,
        frame: {
          center_frequency_hz: 137_100_000,
          sample_rate: 2_400_000,
        },
      }),
    ).toEqual({ min: 127_975_000, max: 146_225_000 });
  });
});
