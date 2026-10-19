import {
  evaluateChannelPrerequisite,
  getChannelPrerequisite,
  resolveDemodChannelSelectionAndRange,
} from "@n-apt/demodulation/channelPrerequisites";

const channels = [
  {
    id: "a",
    label: "A",
    min_hz: 18_000,
    max_hz: 4_390_000,
    prerequisite_for: {
      "demod.stimulus.audio": "any",
      "demod.audio_survey": "all",
    },
  },
  {
    id: "b",
    label: "B",
    min_hz: 24_100_000,
    max_hz: 30_370_000,
    prerequisite_for: {
      "demod.stimulus.audio": "any",
      "demod.audio_survey": "all",
    },
  },
  {
    id: "c",
    label: "C",
    min_hz: 4_750_000,
    max_hz: 23_000_000,
    prerequisite_for: { "demod.stimulus.vision": "all" },
  },
] as const;

describe("channel prerequisite metadata", () => {
  it("repairs a zero-based hydrated range to the selected audio channel edge", () => {
    expect(
      resolveDemodChannelSelectionAndRange(
        "A",
        { min: 0, max: 3_200_000 },
        channels,
        3_200_000,
      ),
    ).toEqual({
      channelLabel: "A",
      range: { min: 18_000, max: 3_218_000 },
    });
  });

  it("starts a fresh demod route at Channel A's 18 kHz lower edge", () => {
    expect(
      resolveDemodChannelSelectionAndRange("A", null, channels, 3_200_000),
    ).toEqual({
      channelLabel: "A",
      range: { min: 18_000, max: 3_218_000 },
    });
  });

  it("keeps Channel C available for the Vision capture option", () => {
    expect(
      resolveDemodChannelSelectionAndRange(
        "C",
        null,
        channels,
        3_200_000,
      ),
    ).toEqual({
      channelLabel: "C",
      range: { min: 4_750_000, max: 7_950_000 },
    });
  });

  it("repairs an unknown channel selection and retains a valid A/B range", () => {
    expect(
      resolveDemodChannelSelectionAndRange(
        "Unknown",
        { min: 24_100_000, max: 27_300_000 },
        channels,
        3_200_000,
      ),
    ).toEqual({
      channelLabel: "A",
      range: { min: 18_000, max: 3_218_000 },
    });
    expect(
      resolveDemodChannelSelectionAndRange(
        "B",
        { min: 27_170_000, max: 30_370_000 },
        channels,
        3_200_000,
      ),
    ).toEqual({
      channelLabel: "B",
      range: { min: 27_170_000, max: 30_370_000 },
    });
  });

  it("uses any-tagged channels as alternatives for stimulus flows", () => {
    expect(
      evaluateChannelPrerequisite("demod.stimulus.audio", 27_000_000, channels),
    ).toMatchObject({ allowed: true, requiredChannelLabels: ["A", "B"] });
  });

  it("requires every all-tagged channel to be available for the audio survey", () => {
    expect(getChannelPrerequisite("demod.audio_survey", channels)).toEqual({
      channelLabels: ["A", "B"],
      mode: "all",
      available: true,
    });
    expect(
      getChannelPrerequisite("demod.audio_survey", [
        channels[0],
        { ...channels[1], max_hz: 1 },
      ]),
    ).toMatchObject({
      channelLabels: ["A", "B"],
      mode: "all",
      available: false,
    });
  });

  it("fails closed when prerequisite metadata or a channel range is invalid", () => {
    expect(
      evaluateChannelPrerequisite("demod.stimulus.audio", 1_000_000, [
        { ...channels[0], prerequisite_for: undefined },
      ]),
    ).toMatchObject({ allowed: false, requiredChannelLabels: [] });
    expect(
      evaluateChannelPrerequisite("demod.stimulus.audio", 1_000_000, [
        { ...channels[0], max_hz: 1 },
      ]),
    ).toMatchObject({ allowed: false });
  });

  it("uses Channel C metadata for the vision stimulus flow", () => {
    expect(
      evaluateChannelPrerequisite(
        "demod.stimulus.vision",
        10_000_000,
        channels,
      ),
    ).toMatchObject({ allowed: true, requiredChannelLabels: ["C"] });
  });
});
