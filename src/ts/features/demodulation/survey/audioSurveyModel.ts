export const AUDIO_SURVEY_SAMPLE_RATE_HZ = 3_200_000;
export const AUDIO_SURVEY_STORAGE_CAP_BYTES = 256_000_000;
export const AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES = 1_000_000_000;
export const AUDIO_SURVEY_DAILY_BUDGET_MS = 8 * 60 * 60 * 1000;
export const AUDIO_SURVEY_CLIP_DURATION_MS = 5_000;

export type AudioSurveySourceMode = "live" | "replay" | "combined";
export type AudioSurveyJobStatus =
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "stopped"
  | "failed";

export interface SurveyChannelRange {
  id: string;
  label: string;
  minHz: number;
  maxHz: number;
}

export interface AudioSurveyView {
  channelId: string;
  channelLabel: string;
  viewIndex: number;
  minHz: number;
  maxHz: number;
  centerHz: number;
  sampleRateHz: number;
}

export interface SurveyConfig {
  sourceMode: AudioSurveySourceMode;
  sampleRateHz: number;
  dailyBudgetMs: number;
  storageCapBytes: number;
  clipDurationMs: number;
}

export interface SurveyCheckpoint {
  sourcePhase: "replay" | "live";
  viewIndex: number;
  passIndex: number;
  lastFrameKey?: string | null;
  lastFrameTimestamp: number | null;
  elapsedMsToday: number;
  budgetDay?: string;
}

export interface SurveyJobState {
  id: string;
  status: AudioSurveyJobStatus;
  config: SurveyConfig;
  checkpoint: SurveyCheckpoint;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface CandidateRecord {
  id: string;
  jobId: string;
  source: "live" | "replay";
  channelId: string;
  centerHz: number;
  bandwidthHz: number;
  modulation: "am" | "fm" | "unknown";
  score: number;
  snrDb: number;
  firstSeenAt: number;
  lastSeenAt: number;
  sampleCount: number;
  clipArtifactIds: string[];
  demodulationModelScore?: number;
  demodulationModelPreferred?: boolean;
}

export const DEFAULT_AUDIO_SURVEY_CONFIG: Readonly<SurveyConfig> = {
  sourceMode: "combined",
  sampleRateHz: AUDIO_SURVEY_SAMPLE_RATE_HZ,
  dailyBudgetMs: AUDIO_SURVEY_DAILY_BUDGET_MS,
  storageCapBytes: AUDIO_SURVEY_STORAGE_CAP_BYTES,
  clipDurationMs: AUDIO_SURVEY_CLIP_DURATION_MS,
};

export const getAudioSurveySourceOrder = (
  sourceMode: AudioSurveySourceMode,
): SurveyCheckpoint["sourcePhase"][] =>
  sourceMode === "combined"
    ? ["replay", "live"]
    : [sourceMode];

export const hasAudioSurveyBudgetRemaining = (
  elapsedMsToday: number,
  dailyBudgetMs = AUDIO_SURVEY_DAILY_BUDGET_MS,
): boolean => elapsedMsToday < dailyBudgetMs;

export const advanceAudioSurveyCheckpoint = (
  checkpoint: SurveyCheckpoint,
  viewCount: number,
  sourceMode: AudioSurveySourceMode,
): SurveyCheckpoint => {
  if (!Number.isInteger(viewCount) || viewCount < 1) {
    throw new Error("A survey pass must contain at least one view");
  }
  if (checkpoint.viewIndex + 1 < viewCount) {
    return { ...checkpoint, viewIndex: checkpoint.viewIndex + 1 };
  }

  const sourceOrder = getAudioSurveySourceOrder(sourceMode);
  const sourceIndex = sourceOrder.indexOf(checkpoint.sourcePhase);
  const nextSourceIndex = sourceIndex + 1;
  if (nextSourceIndex < sourceOrder.length) {
    return {
      ...checkpoint,
      sourcePhase: sourceOrder[nextSourceIndex],
      viewIndex: 0,
      lastFrameKey: null,
    };
  }

  return {
    ...checkpoint,
    sourcePhase: sourceOrder[0],
    viewIndex: 0,
    passIndex: checkpoint.passIndex + 1,
    lastFrameKey: null,
  };
};

/**
 * Plan endpoint-aligned, independent receiver views for A and B. Each view
 * spans the full complex sample rate; overlaps remain separate observations.
 */
export const buildAudioSurveyViews = (
  channels: readonly SurveyChannelRange[],
  sampleRateHz = AUDIO_SURVEY_SAMPLE_RATE_HZ,
): AudioSurveyView[] => {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new Error("Survey sample rate must be a positive finite value");
  }

  const selected = (["a", "b"] as const).map((channelId) => {
    const channel = channels.find(
      (candidate) =>
        candidate.id.toLowerCase() === channelId ||
        candidate.label.toLowerCase() === channelId,
    );
    if (!channel) {
      throw new Error(`Configured Channel ${channelId.toUpperCase()} is missing`);
    }
    if (
      !Number.isFinite(channel.minHz) ||
      !Number.isFinite(channel.maxHz) ||
      channel.maxHz <= channel.minHz
    ) {
      throw new Error(`Configured Channel ${channelId.toUpperCase()} is invalid`);
    }
    return channel;
  });

  return selected.flatMap((channel) => {
    const spanHz = channel.maxHz - channel.minHz;
    const viewCount = Math.max(1, Math.ceil(spanHz / sampleRateHz));
    const firstCenterHz =
      viewCount === 1
        ? Math.max(sampleRateHz / 2, (channel.minHz + channel.maxHz) / 2)
        : channel.minHz + sampleRateHz / 2;
    const lastCenterHz =
      viewCount === 1
        ? firstCenterHz
        : channel.maxHz - sampleRateHz / 2;

    return Array.from({ length: viewCount }, (_, viewIndex) => {
      const t = viewCount === 1 ? 0 : viewIndex / (viewCount - 1);
      const centerHz = firstCenterHz + (lastCenterHz - firstCenterHz) * t;
      return {
        channelId: channel.id,
        channelLabel: channel.label,
        viewIndex,
        minHz: centerHz - sampleRateHz / 2,
        maxHz: centerHz + sampleRateHz / 2,
        centerHz,
        sampleRateHz,
      };
    });
  });
};
