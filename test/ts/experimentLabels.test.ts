import {
  collectExperimentLabels,
  normalizeExperimentLabels,
} from "@n-apt/demodulation/react-flow/nodes/experimentLabels";

describe("reverse engineering experiment labels", () => {
  it("normalizes entered labels for pill display and storage", () => {
    expect(normalizeExperimentLabels(["  carrier   present ", "carrier present", "", "  spike "])).toEqual([
      "carrier present",
      "spike",
    ]);
  });

  it("restores a unique label catalog from persisted experiment notes", () => {
    expect(
      collectExperimentLabels([
        { labels: ["carrier present", "baseline"] },
        { labels: ["baseline", "spike absent"] },
        { title: "ordinary note" },
      ]),
    ).toEqual(["carrier present", "baseline", "spike absent"]);
  });
});
