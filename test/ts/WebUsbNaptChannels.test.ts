import {
  getValidChannelCenterRange,
  getNextNaptChannelCenter,
  parseCanonicalNaptChannels,
  resolveNaptChannelCenter,
} from "@n-apt/webusb/naptChannels";

const signalsYaml = `
signals:
  channels:
    a:
      label: "A"
      freq_range_hz: !frequency_range 18kHz..4.39MHz
    b:
      label: "B"
      freq_range_hz: !frequency_range 24.1MHz..30.37MHz
    c:
      label: "C"
      freq_range_hz: !frequency_range 4.75MHz..23MHz
  sdr:
    sample_rate: !frequency 3.2MHz
  mock_apt:
    channels:
      a:
        freq_range_hz: !frequency_range 18kHz..4.47MHz
`;

describe("standalone N-APT channel navigation", () => {
  it("reads only canonical channel ranges from signals.yaml", () => {
    expect(parseCanonicalNaptChannels(signalsYaml)).toEqual([
      {
        id: "a",
        label: "A",
        minHz: 18_000,
        maxHz: 4_390_000,
        centerHz: 2_204_000,
      },
      {
        id: "b",
        label: "B",
        minHz: 24_100_000,
        maxHz: 30_370_000,
        centerHz: 27_235_000,
      },
      {
        id: "c",
        label: "C",
        minHz: 4_750_000,
        maxHz: 23_000_000,
        centerHz: 13_875_000,
      },
    ]);
  });

  it("limits a channel's center to positions where the 3.2 MHz view remains inside it", () => {
    const [channelA] = parseCanonicalNaptChannels(signalsYaml);

    expect(getValidChannelCenterRange(channelA, 3_200_000)).toEqual({
      minHz: 1_618_000,
      maxHz: 2_790_000,
    });
  });

  it("returns the remembered valid center when returning to a channel", () => {
    const [channelA] = parseCanonicalNaptChannels(signalsYaml);

    expect(
      resolveNaptChannelCenter({
        channel: channelA,
        sampleRateHz: 3_200_000,
        currentCenterHz: 27_235_000,
        rememberedCenterHz: 2_500_000,
        isActive: false,
      }),
    ).toBe(2_500_000);
  });

  it("pages an active channel reselect to the next non-visible portion", () => {
    const [channelA] = parseCanonicalNaptChannels(signalsYaml);

    expect(
      getNextNaptChannelCenter({
        channel: channelA,
        sampleRateHz: 3_200_000,
        currentCenterHz: 1_000_000,
      }),
    ).toBe(2_790_000);
  });

  it("pages back when the active channel is already at its right edge", () => {
    const [channelA] = parseCanonicalNaptChannels(signalsYaml);

    expect(
      getNextNaptChannelCenter({
        channel: channelA,
        sampleRateHz: 3_200_000,
        currentCenterHz: 2_790_000,
        direction: -1,
      }),
    ).toBe(1_618_000);
  });

  it("walks through all of a wide channel instead of bouncing at its edge", () => {
    const [, , channelC] = parseCanonicalNaptChannels(signalsYaml);

    expect(
      getNextNaptChannelCenter({
        channel: channelC,
        sampleRateHz: 3_200_000,
        currentCenterHz: 13_875_000,
      }),
    ).toBe(17_075_000);
    expect(
      getNextNaptChannelCenter({
        channel: channelC,
        sampleRateHz: 3_200_000,
        currentCenterHz: 17_075_000,
      }),
    ).toBe(20_275_000);
    expect(
      getNextNaptChannelCenter({
        channel: channelC,
        sampleRateHz: 3_200_000,
        currentCenterHz: 20_275_000,
      }),
    ).toBe(21_400_000);
    expect(
      getNextNaptChannelCenter({
        channel: channelC,
        sampleRateHz: 3_200_000,
        currentCenterHz: 21_400_000,
        direction: -1,
      }),
    ).toBe(18_200_000);
  });

  it("uses the paging center when an active reselect is outside the valid range", () => {
    const [channelA] = parseCanonicalNaptChannels(signalsYaml);

    expect(
      resolveNaptChannelCenter({
        channel: channelA,
        sampleRateHz: 3_200_000,
        currentCenterHz: 1_000_000,
        rememberedCenterHz: null,
        isActive: true,
      }),
    ).toBe(2_790_000);
  });
});
