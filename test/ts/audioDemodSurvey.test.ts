import fs from "node:fs";
import path from "node:path";
import type { SurveyChannelRange as AudioSurveyChannelRange } from "@n-apt/demodulation/survey/audioSurveyModel";

const hasEncryptedAudioSurveySource = fs.existsSync(
  path.resolve(
    process.cwd(),
    "src/encrypted-modules/tmp/ml/src/ts/features/demodulation/survey/audioSurveyModel.ts",
  ),
);
const describeWhenSourceAvailable = hasEncryptedAudioSurveySource
  ? describe
  : describe.skip;
const audioSurveyModel = (
  hasEncryptedAudioSurveySource
    ? require("@n-apt/demodulation/survey/audioSurveyModel")
    : {}
) as Pick<
  typeof import("@n-apt/demodulation/survey/audioSurveyModel"),
  | "buildAudioSurveyViews"
  | "DEFAULT_AUDIO_SURVEY_CONFIG"
  | "AUDIO_SURVEY_STORAGE_CAP_BYTES"
  | "AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES"
  | "getAudioSurveySourceOrder"
  | "advanceAudioSurveyCheckpoint"
  | "hasAudioSurveyBudgetRemaining"
>;

const configuredChannels: AudioSurveyChannelRange[] = [
  {
    id: "a",
    label: "A",
    minHz: 18_000,
    maxHz: 4_390_000,
    prerequisite_for: { "demod.audio_survey": "all" },
  },
  {
    id: "b",
    label: "B",
    minHz: 24_100_000,
    maxHz: 30_370_000,
    prerequisite_for: { "demod.audio_survey": "all" },
  },
  { id: "c", label: "C", minHz: 4_750_000, maxHz: 23_000_000 },
];

describeWhenSourceAvailable("audio survey view planner", () => {
  it("plans its required channels from the audio survey prerequisite metadata", () => {
    const views = audioSurveyModel.buildAudioSurveyViews([
      {
        id: "primary",
        label: "Primary",
        minHz: 1_000_000,
        maxHz: 4_000_000,
        prerequisite_for: { "demod.audio_survey": "all" },
      },
      {
        id: "secondary",
        label: "Secondary",
        minHz: 10_000_000,
        maxHz: 13_000_000,
        prerequisite_for: { "demod.audio_survey": "all" },
      },
      {
        id: "ignored",
        label: "Ignored",
        minHz: 20_000_000,
        maxHz: 23_000_000,
      },
    ]);

    expect(views.map((view: any) => view.channelId)).toEqual([
      "primary",
      "secondary",
    ]);
  });

  it("uses four independent full-rate views to cover only channels A and B", () => {
    const views = audioSurveyModel.buildAudioSurveyViews(configuredChannels);

    expect(audioSurveyModel.DEFAULT_AUDIO_SURVEY_CONFIG.sampleRateHz).toBe(3_200_000);
    expect(audioSurveyModel.DEFAULT_AUDIO_SURVEY_CONFIG.storageCapBytes).toBe(256_000_000);
    expect(audioSurveyModel.AUDIO_SURVEY_STORAGE_CAP_BYTES).toBe(256_000_000);
    expect(audioSurveyModel.AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES).toBe(1_000_000_000);
    expect(views).toHaveLength(4);
    expect(views.map((view: any) => view.channelId)).toEqual(["a", "a", "b", "b"]);
    expect(views.every((view: any) => view.sampleRateHz === 3_200_000)).toBe(true);
    expect(views.every((view: any) => view.maxHz - view.minHz === 3_200_000)).toBe(
      true,
    );
    expect(views[0].minHz).toBe(18_000);
    expect(views[1].maxHz).toBe(4_390_000);
    expect(views[2].minHz).toBe(24_100_000);
    expect(views[3].maxHz).toBe(30_370_000);
    expect(views.some((view: any) => view.channelId === "c")).toBe(false);
  });

  it("does not duplicate or blend a single-window channel", () => {
    const views = audioSurveyModel.buildAudioSurveyViews([
      {
        id: "a",
        label: "A",
        minHz: 10_000_000,
        maxHz: 11_000_000,
        prerequisite_for: { "demod.audio_survey": "all" },
      },
      {
        id: "b",
        label: "B",
        minHz: 10_000_000,
        maxHz: 20_000_000,
        prerequisite_for: { "demod.audio_survey": "all" },
      },
    ]);

    expect(views.filter((view: any) => view.channelId === "a")).toHaveLength(1);
    expect(views[0]).toMatchObject({
      centerHz: 10_500_000,
      minHz: 8_900_000,
      maxHz: 12_100_000,
    });
    expect(views.slice(1).map((view: any) => view.centerHz)).toEqual([
      11_600_000,
      13_866_666.666666666,
      16_133_333.333333332,
      18_400_000,
    ]);
  });

  it("processes replay before live and checkpoints each independent view", () => {
    expect(audioSurveyModel.getAudioSurveySourceOrder("combined")).toEqual(["replay", "live"]);
    const replayDone = audioSurveyModel.advanceAudioSurveyCheckpoint(
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
    expect(audioSurveyModel.hasAudioSurveyBudgetRemaining(8 * 60 * 60 * 1000, 8 * 60 * 60 * 1000)).toBe(
      false,
    );
  });
});
