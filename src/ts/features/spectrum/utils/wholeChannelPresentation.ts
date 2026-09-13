export interface FrequencyBounds {
  min: number;
  max: number;
}

export interface WholeChannelViewportInput {
  channelBounds: FrequencyBounds;
  maxSampleRateHz: number;
  preferredCenterHz?: number | null;
}

/**
 * Calculates the largest initial viewport that can be rendered for a logical
 * channel. The channel remains the presentation boundary; hardware identity
 * is intentionally not part of this calculation.
 */
export const resolveWholeChannelViewport = ({
  channelBounds,
  maxSampleRateHz,
  preferredCenterHz,
}: WholeChannelViewportInput): FrequencyBounds => {
  const min = Math.min(channelBounds.min, channelBounds.max);
  const max = Math.max(channelBounds.min, channelBounds.max);
  const channelSpan = max - min;

  if (!Number.isFinite(channelSpan) || channelSpan <= 0) {
    return { min, max };
  }

  const safeMaximum =
    Number.isFinite(maxSampleRateHz) && maxSampleRateHz > 0
      ? maxSampleRateHz
      : channelSpan;
  const visibleSpan = Math.min(channelSpan, safeMaximum);
  const channelCenter = (min + max) / 2;
  const requestedCenter =
    typeof preferredCenterHz === "number" && Number.isFinite(preferredCenterHz)
      ? preferredCenterHz
      : channelCenter;
  const halfSpan = visibleSpan / 2;
  const boundedCenter = Math.max(
    min + halfSpan,
    Math.min(max - halfSpan, requestedCenter),
  );

  return {
    min: boundedCenter - halfSpan,
    max: boundedCenter + halfSpan,
  };
};
