/**
 * Shared constants used across multiple modules
 * Common values that are used in both FFT and waterfall rendering
 */
import { formatFrequency, formatFrequencyHighRes } from "@n-apt/utils/frequency";

// Shared frequency ranges for optimal grid display (in Hz)
export const FREQUENCY_RANGES = [
  // Hz
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500,
  // kHz
  1_000, 2_000, 2_500, 5_000, 10_000, 20_000, 25_000, 50_000, 100_000, 200_000, 250_000, 500_000,
  // MHz
  1_000_000, 2_000_000, 2_500_000, 5_000_000, 10_000_000, 20_000_000, 25_000_000, 50_000_000, 100_000_000, 200_000_000, 250_000_000, 500_000_000,
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

// Frequency formatting functions are now imported from ../utils/frequency
export { formatFrequency, formatFrequencyHighRes };

// Find best range function can be shared
export const findBestFrequencyRange = (
  bandwidth: number,
  maxSteps: number,
): number => {
  for (const range of FREQUENCY_RANGES) {
    if (bandwidth / range < maxSteps) {
      return range;
    }
  }
  return 50_000_000.0;
};
