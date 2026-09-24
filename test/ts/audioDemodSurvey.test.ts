import {
  DEFAULT_AUDIO_SURVEY_CONFIG,
  AUDIO_SURVEY_STORAGE_CAP_BYTES,
  AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES,
  buildAudioSurveyViews,
  advanceAudioSurveyCheckpoint,
  getAudioSurveySourceOrder,
  hasAudioSurveyBudgetRemaining,
  type SurveyChannelRange,
} from "@n-apt/demodulation/survey/audioSurveyModel";

const configuredChannels: SurveyChannelRange[] = [
  { id: "a", label: "A", minHz: 18_000, maxHz: 4_390_000 },
  { id: "b", label: "B", minHz: 24_100_000, maxHz: 30_370_000 },
  { id: "c", label: "C", minHz: 4_750_000, maxHz: 23_000_000 },
];

describe("audio survey view planner", () => {
  it("uses four independent full-rate views to cover only channels A and B", () => {
    const views = buildAudioSurveyViews(configuredChannels);

    expect(DEFAULT_AUDIO_SURVEY_CONFIG.sampleRateHz).toBe(3_200_000);
    expect(DEFAULT_AUDIO_SURVEY_CONFIG.storageCapBytes).toBe(256_000_000);
    expect(AUDIO_SURVEY_STORAGE_CAP_BYTES).toBe(256_000_000);
    expect(AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES).toBe(1_000_000_000);
    expect(views).toHaveLength(4);
    expect(views.map((view) => view.channelId)).toEqual(["a", "a", "b", "b"]);
    expect(views.every((view) => view.sampleRateHz === 3_200_000)).toBe(true);
    expect(views.every((view) => view.maxHz - view.minHz === 3_200_000)).toBe(
      true,
    );
    expect(views[0].minHz).toBe(18_000);
    expect(views[1].maxHz).toBe(4_390_000);
    expect(views[2].minHz).toBe(24_100_000);
    expect(views[3].maxHz).toBe(30_370_000);
    expect(views.some((view) => view.channelId === "c")).toBe(false);
  });

  it("does not duplicate or blend a single-window channel", () => {
    const views = buildAudioSurveyViews([
      { id: "a", label: "A", minHz: 10_000_000, maxHz: 11_000_000 },
      { id: "b", label: "B", minHz: 10_000_000, maxHz: 20_000_000 },
    ]);

    expect(views.filter((view) => view.channelId === "a")).toHaveLength(1);
    expect(views[0]).toMatchObject({
      centerHz: 10_500_000,
      minHz: 8_900_000,
      maxHz: 12_100_000,
    });
    expect(views.slice(1).map((view) => view.centerHz)).toEqual([
      11_600_000,
      13_866_666.666666666,
      16_133_333.333333332,
      18_400_000,
    ]);
  });

  it("processes replay before live and checkpoints each independent view", () => {
    expect(getAudioSurveySourceOrder("combined")).toEqual(["replay", "live"]);
    const replayDone = advanceAudioSurveyCheckpoint(
      { sourcePhase: "replay", viewIndex: 3, passIndex: 0, lastFrameTimestamp: 12, elapsedMsToday: 100 },
      4,
      "combined",
    );
    expect(replayDone).toMatchObject({
      sourcePhase: "live",
      viewIndex: 0,
      passIndex: 0,
      lastFrameTimestamp: 12,
    });
    expect(hasAudioSurveyBudgetRemaining(8 * 60 * 60 * 1000, 8 * 60 * 60 * 1000)).toBe(
      false,
    );
  });
});
