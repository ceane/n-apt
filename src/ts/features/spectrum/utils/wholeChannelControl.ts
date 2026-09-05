export type WholeChannelBounds = { min: number; max: number };

const isFinitePositive = (value?: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const getWholeChannelSpanHz = (
  bounds?: WholeChannelBounds | null,
): number | null => {
  if (!bounds) return null;
  const span = bounds.max - bounds.min;
  return Number.isFinite(span) && span > 0 ? span : null;
};

export const resolveWholeChannelMode = ({
  supportsWholeChannel,
  sampleRateHz,
  activeChannelBounds,
}: {
  supportsWholeChannel: boolean;
  sampleRateHz?: number | null;
  activeChannelBounds?: WholeChannelBounds | null;
}): boolean => {
  const spanHz = getWholeChannelSpanHz(activeChannelBounds);
  return (
    supportsWholeChannel &&
    spanHz !== null &&
    isFinitePositive(sampleRateHz) &&
    Math.round(sampleRateHz) === Math.round(spanHz)
  );
};

export const resolveWholeChannelFrame = ({
  supportsWholeChannel,
  wholeChannelMode,
  sampleRateHz,
  channelBounds,
}: {
  supportsWholeChannel: boolean;
  wholeChannelMode: boolean;
  sampleRateHz?: number | null;
  channelBounds: WholeChannelBounds;
}): {
  isWholeChannel: boolean;
  sampleRateHz: number | null;
  spanHz: number;
} => {
  const spanHz = getWholeChannelSpanHz(channelBounds) ?? 0;
  const isWholeChannel =
    supportsWholeChannel &&
    spanHz > 0 &&
    (wholeChannelMode ||
      (isFinitePositive(sampleRateHz) && sampleRateHz >= spanHz));

  return {
    isWholeChannel,
    sampleRateHz: isWholeChannel
      ? spanHz
      : isFinitePositive(sampleRateHz)
        ? sampleRateHz
        : null,
    spanHz,
  };
};
