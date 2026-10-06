import type { SpectrumFrame } from "@n-apt/consts/schemas/websocket";

export type ChannelPrerequisiteMode = "any" | "all";
export type DemodFlowId =
  | "demod.stimulus.audio"
  | "demod.stimulus.apt"
  | "demod.stimulus.internal"
  | "demod.stimulus.speech"
  | "demod.stimulus.vision"
  | "demod.audio_survey";

export type ChannelPrerequisiteSource = Pick<
  SpectrumFrame,
  "label" | "min_hz" | "max_hz"
> & {
  prerequisite_for?: Partial<Record<DemodFlowId, ChannelPrerequisiteMode>>;
};

export interface ChannelPrerequisite {
  channelLabels: string[];
  mode: ChannelPrerequisiteMode | null;
  available: boolean;
}

export interface ChannelPrerequisiteAccess extends ChannelPrerequisite {
  allowed: boolean;
  requiredChannelLabels: string[];
  currentChannelLabel: string | null;
}

const validRange = (channel: ChannelPrerequisiteSource): boolean =>
  Number.isFinite(channel.min_hz) &&
  Number.isFinite(channel.max_hz) &&
  channel.max_hz > channel.min_hz;

export const getChannelPrerequisite = (
  flowId: DemodFlowId | string,
  channels: readonly ChannelPrerequisiteSource[] | null | undefined,
): ChannelPrerequisite => {
  const tagged = (channels ?? []).filter(
    (channel) => channel.prerequisite_for?.[flowId as DemodFlowId],
  );
  const mode = tagged[0]?.prerequisite_for?.[flowId as DemodFlowId] ?? null;
  const channelLabels = tagged
    .map((channel) => channel.label?.trim().toUpperCase())
    .filter((label): label is string => Boolean(label));
  const consistentMode = tagged.every(
    (channel) => channel.prerequisite_for?.[flowId as DemodFlowId] === mode,
  );
  const validCount = tagged.filter(validRange).length;

  return {
    channelLabels,
    mode: consistentMode ? mode : null,
    available:
      tagged.length > 0 &&
      consistentMode &&
      (mode === "all" ? validCount === tagged.length : validCount > 0),
  };
};

export const evaluateChannelPrerequisite = (
  flowId: DemodFlowId | string,
  frequencyHz: number | null | undefined,
  channels: readonly ChannelPrerequisiteSource[] | null | undefined,
): ChannelPrerequisiteAccess => {
  const prerequisite = getChannelPrerequisite(flowId, channels);
  const currentChannel =
    typeof frequencyHz === "number" && Number.isFinite(frequencyHz)
      ? (channels ?? []).find(
          (channel) =>
            validRange(channel) &&
            frequencyHz >= channel.min_hz &&
            frequencyHz <= channel.max_hz,
        )
      : undefined;
  const currentChannelLabel = currentChannel?.label?.trim().toUpperCase() ?? null;

  return {
    ...prerequisite,
    allowed:
      prerequisite.available &&
      currentChannelLabel !== null &&
      prerequisite.channelLabels.includes(currentChannelLabel),
    requiredChannelLabels: prerequisite.channelLabels,
    currentChannelLabel,
  };
};
