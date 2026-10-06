import { evaluateStimulusChannelAccess } from "@n-apt/demodulation/react-flow/nodes/stimulusChannelPolicy";

const channels = [
  {
    id: "a",
    label: "A",
    min_hz: 18_000,
    max_hz: 4_390_000,
    prerequisite_for: {
      "demod.stimulus.audio": "any",
      "demod.stimulus.apt": "any",
      "demod.stimulus.internal": "any",
      "demod.stimulus.speech": "any",
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
      "demod.stimulus.apt": "any",
      "demod.stimulus.internal": "any",
      "demod.stimulus.speech": "any",
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

describe("stimulus channel policy", () => {
  it.each([
    ["audio", 1_000_000, true, "A"],
    ["apt", 27_000_000, true, "B"],
    ["speech", 27_000_000, true, "B"],
    ["internal", 10_000_000, false, "C"],
    ["vision", 10_000_000, true, "C"],
    ["vision", 1_000_000, false, "A"],
  ] as const)(
    "%s at %i Hz is compatible with the expected channel range",
    (analysisType, frequencyHz, allowed, currentChannelLabel) => {
      expect(
        evaluateStimulusChannelAccess(analysisType, frequencyHz, channels),
      ).toMatchObject({ allowed, currentChannelLabel });
    },
  );

  it("fails closed when the tuned frequency or channel map is unavailable", () => {
    expect(evaluateStimulusChannelAccess("audio", null, channels).allowed).toBe(
      false,
    );
    expect(evaluateStimulusChannelAccess("vision", 10_000_000, []).allowed).toBe(
      false,
    );
  });
});
