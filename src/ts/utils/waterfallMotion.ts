import type { FrequencyRange } from "@n-apt/consts/types";

const getCenterFrequency = (range: FrequencyRange) =>
  (range.min + range.max) / 2;

const getSpan = (range: FrequencyRange) => range.max - range.min;

export const getWaterfallMotion = ({
  previousVisualRange,
  currentVisualRange,
  textureWidth,
}: {
  previousVisualRange: FrequencyRange | null;
  currentVisualRange: FrequencyRange;
  textureWidth: number;
}) => {
  if (!previousVisualRange || textureWidth <= 0) {
    return {
      driftBins: 0,
      shouldPaintMotionRow: false,
      smearRows: 0,
    };
  }

  const currentSpan = getSpan(currentVisualRange);
  const previousSpan = getSpan(previousVisualRange);
  const referenceSpan = currentSpan > 0 ? currentSpan : previousSpan;
  const centerDelta = getCenterFrequency(currentVisualRange) - getCenterFrequency(previousVisualRange);
  const driftBins = referenceSpan > 0
    ? (centerDelta / referenceSpan) * textureWidth
    : 0;
  const zoomChanged = Math.abs(currentSpan - previousSpan) > Number.EPSILON;
  const shouldPaintMotionRow = Math.abs(driftBins) >= 0.5 || zoomChanged;
  const smearRows = shouldPaintMotionRow
    ? Math.max(1, Math.min(12, Math.round(Math.abs(driftBins))))
    : 0;

  return {
    driftBins,
    shouldPaintMotionRow,
    smearRows,
  };
};
