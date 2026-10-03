import type { AnalysisType } from "@n-apt/consts/types";

export interface StimulusChannelBounds {
  label?: string | null;
  min_hz: number;
  max_hz: number;
}

export interface StimulusChannelAccess {
  allowed: boolean;
  requiredChannelLabels: string[];
  currentChannelLabel: string | null;
}

const STIMULUS_CHANNEL_REQUIREMENTS: Record<AnalysisType, string[]> = {
  audio: ["A", "B"],
  apt: ["A", "B"],
  internal: ["A", "B"],
  speech: ["A", "B"],
  vision: ["C"],
};

export const getRequiredStimulusChannelLabels = (
  analysisType: AnalysisType,
): string[] => STIMULUS_CHANNEL_REQUIREMENTS[analysisType] ?? [];

export const evaluateStimulusChannelAccess = (
  analysisType: AnalysisType,
  frequencyHz: number | null | undefined,
  channels: readonly StimulusChannelBounds[] | null | undefined,
): StimulusChannelAccess => {
  const requiredChannelLabels = getRequiredStimulusChannelLabels(analysisType);
  const currentChannel =
    typeof frequencyHz === "number" && Number.isFinite(frequencyHz)
      ? channels?.find(
          (channel) =>
            typeof channel.label === "string" &&
            Number.isFinite(channel.min_hz) &&
            Number.isFinite(channel.max_hz) &&
            channel.max_hz > channel.min_hz &&
            frequencyHz >= channel.min_hz &&
            frequencyHz <= channel.max_hz,
        )
      : undefined;
  const currentChannelLabel = currentChannel?.label?.toUpperCase() ?? null;

  return {
    allowed:
      currentChannelLabel !== null &&
      requiredChannelLabels.includes(currentChannelLabel),
    requiredChannelLabels,
    currentChannelLabel,
  };
};
