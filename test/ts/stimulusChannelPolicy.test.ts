import { evaluateStimulusChannelAccess } from "@n-apt/demodulation/react-flow/nodes/stimulusChannelPolicy";

const channels = [
  { label: "A", min_hz: 18_000, max_hz: 4_390_000 },
  { label: "B", min_hz: 24_100_000, max_hz: 30_370_000 },
  { label: "C", min_hz: 4_750_000, max_hz: 23_000_000 },
];

describe("stimulus channel policy", () => {
  it.each([
    ["audio", 1_000_000, true, "A"],
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
