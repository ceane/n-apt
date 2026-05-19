import type { FrequencyRange } from "@n-apt/consts/types";

export const AVAILABLE_SPECTRUM_FALLBACK: FrequencyRange = {
  min: 0,
  max: 30_000_000_000,
};

export const getAvailableSpectrumBounds = (
  bounds?: FrequencyRange | null,
): FrequencyRange => {
  if (
    bounds &&
    Number.isFinite(bounds.min) &&
    Number.isFinite(bounds.max) &&
    bounds.max > bounds.min
  ) {
    return bounds;
  }
  return AVAILABLE_SPECTRUM_FALLBACK;
};

export const clampFrequencyRangeToBounds = (
  range: FrequencyRange,
  bounds?: FrequencyRange | null,
): FrequencyRange => {
  const safeBounds = getAvailableSpectrumBounds(bounds);
  const span = range.max - range.min;
  const boundsSpan = safeBounds.max - safeBounds.min;
  if (!Number.isFinite(span) || span <= 0) {
    return {
      min: safeBounds.min,
      max: safeBounds.min,
    };
  }

  if (span >= boundsSpan) {
    return {
      min: safeBounds.min,
      max: safeBounds.max,
    };
  }

  let min = range.min;
  let max = range.max;

  if (min < safeBounds.min) {
    min = safeBounds.min;
    max = min + span;
  }
  if (max > safeBounds.max) {
    max = safeBounds.max;
    min = max - span;
  }

  return { min, max };
};
