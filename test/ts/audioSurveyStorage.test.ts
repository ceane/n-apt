import { chooseAudioSurveyArtifactEvictions } from "@n-apt/demodulation/survey/audioSurveyStorage";

describe("audio survey artifact retention", () => {
  it("prunes the lowest-ranked clips first and leaves summaries and models alone", () => {
    const result = chooseAudioSurveyArtifactEvictions(
      [
        { id: "summary", kind: "summary", sizeBytes: 10, score: 0, createdAt: 1 },
        { id: "best", kind: "event-clip", sizeBytes: 80, score: 0.9, createdAt: 3 },
        { id: "old-low", kind: "event-clip", sizeBytes: 30, score: 0.1, createdAt: 1 },
        { id: "new-low", kind: "reference-pair", sizeBytes: 40, score: 0.1, createdAt: 2 },
        { id: "model", kind: "model", sizeBytes: 40, score: 0, createdAt: 0 },
      ],
      90,
      220,
    );

    expect(result).toEqual({ canFit: true, evictIds: ["old-low", "new-low"] });
  });

  it("rejects an artifact when the cap cannot be met without deleting durable summaries or models", () => {
    const result = chooseAudioSurveyArtifactEvictions(
      [
        { id: "summary", kind: "summary", sizeBytes: 100, score: 0, createdAt: 1 },
        { id: "model", kind: "model", sizeBytes: 100, score: 0, createdAt: 0 },
      ],
      1,
      200,
    );

    expect(result).toEqual({ canFit: false, evictIds: [] });
  });
});
