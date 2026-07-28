import {
  resolveWholeChannelFrame,
  resolveWholeChannelMode,
} from "@n-apt/utils/wholeChannelControl";

describe("whole channel control", () => {
  it("identifies whole-channel mode from the active channel span", () => {
    expect(
      resolveWholeChannelMode({
        supportsWholeChannel: true,
        sampleRateHz: 4_372_000,
        activeChannelBounds: { min: 18_000, max: 4_390_000 },
      }),
    ).toBe(true);
  });

  it("assigns each channel its own span while whole-channel mode is active", () => {
    expect(
      resolveWholeChannelFrame({
        supportsWholeChannel: true,
        wholeChannelMode: true,
        sampleRateHz: 4_372_000,
        channelBounds: { min: 4_750_000, max: 23_000_000 },
      }),
    ).toEqual({
      isWholeChannel: true,
      sampleRateHz: 18_250_000,
      spanHz: 18_250_000,
    });
  });

  it("does not infer whole-channel mode for unsupported sources", () => {
    expect(
      resolveWholeChannelMode({
        supportsWholeChannel: false,
        sampleRateHz: 4_372_000,
        activeChannelBounds: { min: 18_000, max: 4_390_000 },
      }),
    ).toBe(false);
  });
});
