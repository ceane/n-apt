/**
 * Shared constants used across multiple modules
 * Common values that are used in both FFT and waterfall rendering
 */

// Shared frequency ranges for optimal grid display
export const FREQUENCY_RANGES = [
  1.0, 2.0, 2.5, 5.0, 10.0, 20.0, 25.0, 50.0, 100.0, 200.0, 250.0, 500.0, 1000.0, 2000.0, 2500.0,
  5000.0, 10000.0, 20000.0, 25000.0, 50000.0, 100000.0, 200000.0, 250000.0, 500000.0, 1000000.0,
  2000000.0, 2500000.0, 5000000.0, 10000000.0, 20000000.0, 25000000.0, 50000000.0,
];

// Shared display constants
export const MIN_DB = -80;
export const MAX_DB = 20;
export const GRID_COLOR = "rgba(50, 50, 50, 255)";
export const TEXT_COLOR = "#666";
export const FONT_FAMILY = "JetBrains Mono";
export const FONT_SIZE = "16px";

// Shared canvas background
export const CANVAS_BACKGROUND = "#0a0a0a";

// Frequency formatting function can be shared
export const formatFrequency = (freq: number): string => {
  const freqAbs = Math.abs(freq);
  if (freqAbs < 1000) {
    return freq.toFixed(6);
  } else if (freqAbs < 1000000) {
    return (freq / 1000.0).toFixed(6) + "K";
  } else if (freqAbs < 1000000000) {
    return (freq / 1000000.0).toFixed(6) + "M";
  } else if (freqAbs < 1000000000000) {
    return (freq / 1000000000.0).toFixed(6) + "G";
  }
  return freq.toString();
};

// Find best range function can be shared
export const findBestFrequencyRange = (bandwidth: number, maxSteps: number): number => {
  for (const range of FREQUENCY_RANGES) {
    if (bandwidth / range < maxSteps) {
      return range;
    }
  }
  return 50000000.0;
};
