import { resolveWholeChannelViewport } from "@n-apt/utils/wholeChannelPresentation";

describe("resolveWholeChannelViewport", () => {
  it("preserves a channel that fits inside the source maximum sample rate", () => {
    expect(
      resolveWholeChannelViewport({
        channelBounds: { min: 100, max: 900 },
        maxSampleRateHz: 1_000,
      }),
    ).toEqual({ min: 100, max: 900 });
  });

  it("centers and clamps an oversized channel to the source maximum", () => {
    expect(
      resolveWholeChannelViewport({
        channelBounds: { min: 0, max: 10_000 },
        maxSampleRateHz: 2_000,
      }),
    ).toEqual({ min: 4_000, max: 6_000 });
  });

  it("uses a preferred center while keeping the viewport inside the channel", () => {
    expect(
      resolveWholeChannelViewport({
        channelBounds: { min: 0, max: 10_000 },
        maxSampleRateHz: 2_000,
        preferredCenterHz: 500,
      }),
    ).toEqual({ min: 0, max: 2_000 });
  });
});
