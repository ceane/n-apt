import type { AnalysisType } from "@n-apt/consts/types";
import {
  evaluateChannelPrerequisite,
  getChannelPrerequisite,
  type ChannelPrerequisiteSource,
  type DemodFlowId,
} from "@n-apt/demodulation/channelPrerequisites";

export type StimulusChannelBounds = ChannelPrerequisiteSource;
export type StimulusChannelAccess = ReturnType<
  typeof evaluateChannelPrerequisite
>;

export const getStimulusFlowId = (analysisType: AnalysisType): DemodFlowId =>
  `demod.stimulus.${analysisType}` as DemodFlowId;

export const getRequiredStimulusChannelLabels = (
  analysisType: AnalysisType,
  channels: readonly StimulusChannelBounds[] | null | undefined,
): string[] =>
  getChannelPrerequisite(getStimulusFlowId(analysisType), channels).channelLabels;

export const evaluateStimulusChannelAccess = (
  analysisType: AnalysisType,
  frequencyHz: number | null | undefined,
  channels: readonly StimulusChannelBounds[] | null | undefined,
): StimulusChannelAccess =>
  evaluateChannelPrerequisite(
    getStimulusFlowId(analysisType),
    frequencyHz,
    channels,
  );
