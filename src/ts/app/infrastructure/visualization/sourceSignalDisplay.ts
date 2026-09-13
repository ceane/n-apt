type ChannelLike = {
  label?: string;
  min_hz: number;
  max_hz: number;
};

type SourceSignalDisplayLike = {
  id?: string;
  kind?: string;
  sdr?: {
    settings?: {
      sample_rate?: number;
    };
  };
};

const validSampleRate = (value?: number | null): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

export const resolveSourceDisplaySignalArea = ({
  liveSignalArea,
  reduxSignalArea,
  fallbackSignalArea = "A",
}: {
  liveSignalArea?: string | null;
  reduxSignalArea?: string | null;
  fallbackSignalArea?: string;
}): string => {
  const live = liveSignalArea?.trim();
  if (live) return live;
  const redux = reduxSignalArea?.trim();
  return redux || fallbackSignalArea;
};

/**
 * Resolve the sample rate shown by a role-bound signal configuration node.
 * The active role's live control state wins over a stale source snapshot;
 * inactive role nodes retain their source-owned configured rate.
 */
export const resolveSourceDisplaySampleRate = ({
  roleSourceId,
  activeSourceId,
  localSampleRateHz,
  liveSampleRateHz,
  sourceSampleRateHz,
  fallbackSampleRateHz,
}: {
  roleSourceId?: string | null;
  activeSourceId?: string | null;
  localSampleRateHz?: number | null;
  liveSampleRateHz?: number | null;
  sourceSampleRateHz?: number | null;
  fallbackSampleRateHz?: number | null;
}): number | null => {
  const localRate = validSampleRate(localSampleRateHz);
  const liveRate = validSampleRate(liveSampleRateHz);
  if (roleSourceId && roleSourceId === activeSourceId) {
    return localRate ?? liveRate ?? validSampleRate(fallbackSampleRateHz);
  }
  return (
    validSampleRate(sourceSampleRateHz) ??
    localRate ??
    liveRate ??
    validSampleRate(fallbackSampleRateHz)
  );
};

const validSpan = (channel?: ChannelLike | null): number | null => {
  if (
    !channel ||
    !Number.isFinite(channel.min_hz) ||
    !Number.isFinite(channel.max_hz) ||
    channel.max_hz <= channel.min_hz
  ) {
    return null;
  }
  return channel.max_hz - channel.min_hz;
};

/**
 * Resolve the source-owned Whole Channel rate used by signal-display nodes.
 * The mode is not HackRF-specific: mock and future source types can select a
 * channel by role, while ordinary sources simply omit the option.
 */
export const resolveWholeChannelSampleRate = ({
  source,
  activeSignalArea,
  channels,
}: {
  source?: SourceSignalDisplayLike | null;
  activeSignalArea?: string | null;
  channels?: readonly ChannelLike[];
}): number | null => {
  if (!source || !Array.isArray(channels)) return null;

  const requestedLabel = activeSignalArea;
  if (!requestedLabel) return null;

  const normalizedLabel = requestedLabel.toLowerCase();
  const channel = channels.find(
    (candidate) => candidate.label?.toLowerCase() === normalizedLabel,
  );
  return validSpan(channel);
};
