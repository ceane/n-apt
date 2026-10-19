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

export interface DemodChannelRange {
  min: number;
  max: number;
}

export interface DemodChannelSelectionAndRange {
  channelLabel: string;
  range: DemodChannelRange;
}

type DemodChannelRangeSource = {
  label: string;
  min_hz?: number;
  max_hz?: number;
  minHz?: number;
  maxHz?: number;
  prerequisite_for?: ChannelPrerequisiteSource["prerequisite_for"];
};

const getDemodChannelBounds = (
  channel: DemodChannelRangeSource,
): DemodChannelRange | null => {
  const min = channel.min_hz ?? channel.minHz;
  const max = channel.max_hz ?? channel.maxHz;
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min
  ) {
    return null;
  }
  return { min, max };
};

const validRange = (channel: ChannelPrerequisiteSource): boolean =>
  Number.isFinite(channel.min_hz) &&
  Number.isFinite(channel.max_hz) &&
  channel.max_hz > channel.min_hz;

/**
 * Resolve the selected channel and receiver window a live demod route can use.
 * Persisted presentation state can hydrate with a highlighted A/B channel but
 * a zero-based acquisition range; move that invalid window onto the selected
 * channel while retaining its requested width, capped to the receiver rate.
 */
export const resolveDemodChannelSelectionAndRange = (
  selectedLabel: string | null | undefined,
  currentRange: DemodChannelRange | null | undefined,
  channels: readonly DemodChannelRangeSource[] | null | undefined,
  sampleRateHz: number,
): DemodChannelSelectionAndRange | null => {
  const eligibleChannels = (channels ?? []).filter(
    (channel) => {
      const label = channel.label.trim().toUpperCase();
      return (
        getDemodChannelBounds(channel) !== null &&
        (label === "A" || label === "B" || label === "C")
      );
    },
  );
  const eligibleLabels = new Set(
    eligibleChannels.map((channel) => channel.label.trim().toUpperCase()),
  );
  const requestedLabel = selectedLabel?.trim().toUpperCase() ?? "";
  const channelLabel = eligibleLabels.has(requestedLabel)
    ? requestedLabel
    : eligibleLabels.has("A")
      ? "A"
      : (eligibleChannels[0]?.label.trim().toUpperCase() ?? "");
  const channel = eligibleChannels.find(
    (candidate) => candidate.label.trim().toUpperCase() === channelLabel,
  );
  if (!channel || !Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    return null;
  }

  const bounds = getDemodChannelBounds(channel);
  if (!bounds) return null;
  const maxWindowHz = Math.min(sampleRateHz, bounds.max - bounds.min);
  const currentWidth =
    currentRange &&
    Number.isFinite(currentRange.min) &&
    Number.isFinite(currentRange.max) &&
    currentRange.max > currentRange.min
      ? currentRange.max - currentRange.min
      : maxWindowHz;
  const widthHz = Math.min(currentWidth, maxWindowHz);
  const rangeIsInsideChannel =
    currentRange !== null &&
    currentRange !== undefined &&
    Number.isFinite(currentRange.min) &&
    Number.isFinite(currentRange.max) &&
    currentRange.min >= bounds.min &&
    currentRange.max <= bounds.max &&
    currentRange.max - currentRange.min <= maxWindowHz;
  const range = rangeIsInsideChannel
    ? { min: currentRange.min, max: currentRange.max }
    : { min: bounds.min, max: bounds.min + widthHz };

  return { channelLabel, range };
};

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
  const currentChannelLabel =
    currentChannel?.label?.trim().toUpperCase() ?? null;

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
