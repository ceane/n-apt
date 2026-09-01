export interface NaptChannel {
  id: string;
  label: string;
  minHz: number;
  maxHz: number;
  centerHz: number;
}

export interface ChannelCenterRange {
  minHz: number;
  maxHz: number;
}

const FREQUENCY_UNITS: Record<string, number> = {
  hz: 1,
  khz: 1_000,
  mhz: 1_000_000,
  ghz: 1_000_000_000,
};

const parseFrequencyToken = (token: string): number => {
  const match = String(token)
    .trim()
    .match(/^(\-?\d+(?:\.\d+)?)(Hz|kHz|MHz|GHz)$/i);
  if (!match) throw new Error(`Unsupported frequency token: ${token}`);

  const value = Number(match[1]);
  const multiplier = FREQUENCY_UNITS[match[2].toLowerCase()];
  const frequencyHz = value * multiplier;
  if (!Number.isFinite(frequencyHz)) {
    throw new Error(`Invalid frequency token: ${token}`);
  }
  return frequencyHz;
};

/**
 * Reads the canonical `signals.channels` section and intentionally ignores
 * mock-generator channel overrides later in the same YAML file.
 */
export const parseCanonicalNaptChannels = (
  signalsYaml: string,
): NaptChannel[] => {
  const channelsMatch = /^  channels:\s*$/m.exec(signalsYaml);
  if (!channelsMatch) {
    throw new Error(
      "Could not find the canonical signals.channels section in signals.yaml",
    );
  }

  const channelsStart = channelsMatch.index + channelsMatch[0].length;
  const followingTopLevelSection = /^  \S/m.exec(
    signalsYaml.slice(channelsStart),
  );
  const channelsEnd = followingTopLevelSection
    ? channelsStart + followingTopLevelSection.index
    : signalsYaml.length;
  const channelsText = signalsYaml.slice(channelsStart, channelsEnd);
  const entries = [
    ...channelsText.matchAll(/^    ([A-Za-z0-9_-]+):\s*$/gm),
  ];
  if (entries.length === 0) {
    throw new Error("signals.channels does not contain any channel entries");
  }

  return entries.map((entry, index) => {
    const entryStart = entry.index! + entry[0].length;
    const entryEnd =
      index + 1 < entries.length ? entries[index + 1].index! : channelsText.length;
    const entryText = channelsText.slice(entryStart, entryEnd);
    const rangeMatch = /^      freq_range_hz:\s*!frequency_range\s+([^\s#]+)\.\.([^\s#]+)/m.exec(
      entryText,
    );
    if (!rangeMatch) {
      throw new Error(
        `signals.channels.${entry[1]} is missing a !frequency_range value`,
      );
    }

    const labelMatch = /^      label:\s*["']?([^"'\s#]+)["']?/m.exec(
      entryText,
    );
    const label = labelMatch?.[1] ?? entry[1].toUpperCase();
    const minHz = parseFrequencyToken(rangeMatch[1]);
    const maxHz = parseFrequencyToken(rangeMatch[2]);
    if (minHz >= maxHz) {
      throw new Error(
        `signals.channels.${entry[1]} must have an increasing frequency range`,
      );
    }

    return {
      id: entry[1],
      label,
      minHz,
      maxHz,
      centerHz: (minHz + maxHz) / 2,
    };
  });
};

export const getValidChannelCenterRange = (
  channel: NaptChannel,
  sampleRateHz: number,
): ChannelCenterRange => {
  const safeSampleRateHz =
    Number.isFinite(sampleRateHz) && sampleRateHz > 0 ? sampleRateHz : 1;
  const halfSampleRateHz = safeSampleRateHz / 2;
  const minHz = channel.minHz + halfSampleRateHz;
  const maxHz = channel.maxHz - halfSampleRateHz;
  if (minHz <= maxHz) return { minHz, maxHz };

  const centerHz = (channel.minHz + channel.maxHz) / 2;
  return { minHz: centerHz, maxHz: centerHz };
};

const clamp = (value: number, range: ChannelCenterRange): number =>
  Math.max(range.minHz, Math.min(range.maxHz, value));

/**
 * Advances an already-selected channel by one sample-rate window, clamped to
 * the channel's valid center range. The caller owns direction state so a
 * repeated click can page through a wide channel in either direction.
 */
export const getNextNaptChannelCenter = ({
  channel,
  sampleRateHz,
  currentCenterHz,
  direction = 1,
}: {
  channel: NaptChannel;
  sampleRateHz: number;
  currentCenterHz: number;
  direction?: 1 | -1;
}): number => {
  const safeSampleRateHz =
    Number.isFinite(sampleRateHz) && sampleRateHz > 0 ? sampleRateHz : 1;
  const validRange = getValidChannelCenterRange(channel, safeSampleRateHz);
  if (!Number.isFinite(currentCenterHz)) return validRange.minHz;

  const nextCenter = currentCenterHz + direction * safeSampleRateHz;
  if (direction === 1 && nextCenter > validRange.maxHz) {
    return validRange.maxHz;
  }
  if (direction === -1 && nextCenter < validRange.minHz) {
    return validRange.minHz;
  }
  return clamp(nextCenter, validRange);
};

export const resolveNaptChannelCenter = ({
  channel,
  sampleRateHz,
  currentCenterHz,
  rememberedCenterHz,
  isActive,
  panDirection = 1,
}: {
  channel: NaptChannel;
  sampleRateHz: number;
  currentCenterHz: number;
  rememberedCenterHz: number | null;
  isActive: boolean;
  panDirection?: 1 | -1;
}): number => {
  const validRange = getValidChannelCenterRange(channel, sampleRateHz);
  if (isActive && Number.isFinite(currentCenterHz)) {
    return getNextNaptChannelCenter({
      channel,
      sampleRateHz,
      currentCenterHz,
      direction: panDirection,
    });
  }

  const target =
    rememberedCenterHz !== null && Number.isFinite(rememberedCenterHz)
      ? rememberedCenterHz
      : channel.centerHz;
  return clamp(target, validRange);
};
