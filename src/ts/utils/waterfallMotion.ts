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
      transitionRows: 0,
    };
  }

  const currentSpan = getSpan(currentVisualRange);
  const previousSpan = getSpan(previousVisualRange);
  const referenceSpan = currentSpan > 0 ? currentSpan : previousSpan;
  const centerDelta =
    getCenterFrequency(currentVisualRange) -
    getCenterFrequency(previousVisualRange);
  const driftBins =
    referenceSpan > 0 ? (centerDelta / referenceSpan) * textureWidth : 0;
  const zoomChanged = Math.abs(currentSpan - previousSpan) > Number.EPSILON;
  const shouldPaintMotionRow = Math.abs(driftBins) >= 0.5 || zoomChanged;
  const zoomMotion =
    currentSpan > 0 && previousSpan > 0
      ? Math.abs(Math.log2(currentSpan / previousSpan))
      : 0;
  const transitionRows = shouldPaintMotionRow
    ? Math.max(
        1,
        Math.min(
          6,
          Math.ceil(Math.max(Math.abs(driftBins) / 96, zoomMotion * 3)),
        ),
      )
    : 0;

  return {
    driftBins,
    shouldPaintMotionRow,
    smearRows: transitionRows,
    transitionRows,
  };
};
