import type { FrequencyRange } from "@n-apt/hooks/useWebSocket";

/**
 * Calculates the center frequency from a frequency range
 * @param frequencyRange - The frequency range with min and max values
 * @returns The center frequency in MHz, or null if invalid
 */
export const calculateCenterFrequency = (frequencyRange: FrequencyRange | null): number | null => {
  if (!frequencyRange) return null;
  const min = frequencyRange.min;
  const max = frequencyRange.max;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return (min + max) / 2;
};
