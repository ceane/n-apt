import {
  evaluateChannelPrerequisite,
  getChannelPrerequisite,
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
  it("uses any-tagged channels as alternatives for stimulus flows", () => {
    expect(
      evaluateChannelPrerequisite(
        "demod.stimulus.audio",
        27_000_000,
        channels,
      ),
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
    ).toMatchObject({ channelLabels: ["A", "B"], mode: "all", available: false });
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
