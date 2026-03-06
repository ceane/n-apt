/**
 * Shared constants used across multiple modules
 * Common values that are used in both FFT and waterfall rendering
 */

// Shared frequency ranges for optimal grid display
export const FREQUENCY_RANGES = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 
  1.0, 2.0, 2.5, 5.0, 10.0, 20.0, 25.0, 50.0, 100.0, 200.0, 250.0, 500.0,
  1000.0, 2000.0, 2500.0, 5000.0, 10000.0, 20000.0, 25000.0, 50000.0,
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

// Frequency formatting function (Standard / Zoomed out)
export const formatFrequency = (freqMHz: number, showUnits: boolean = true): string => {
  const abs = Math.abs(freqMHz);
  if (abs >= 1000) return (freqMHz / 1000).toFixed(3) + (showUnits ? "GHz" : "");
  if (abs >= 1) return freqMHz.toFixed(3) + (showUnits ? "MHz" : "");
  if (abs >= 0.001) return (freqMHz * 1000).toFixed(0) + (showUnits ? "kHz" : "");
  return (freqMHz * 1000000).toFixed(0) + (showUnits ? "Hz" : "");
};

// High resolution formatting: 100.000.000MHz
export const formatFrequencyHighRes = (freqMHz: number): string => {
  const abs = Math.abs(freqMHz);
  
  if (abs >= 1000) {
    // GHz.MHz.kHz.Hz
    const val = freqMHz / 1000;
    const fixed = val.toFixed(9);
    const [g, rest] = fixed.split(".");
    return `${g}.${rest.slice(0, 3)}.${rest.slice(3, 6)}.${rest.slice(6, 9)}GHz`;
  } else if (abs >= 1) {
    // MHz.kHz.Hz
    const val = freqMHz;
    const fixed = val.toFixed(6);
    const [m, rest] = fixed.split(".");
    return `${m}.${rest.slice(0, 3)}.${rest.slice(3, 6)}MHz`;
  } else if (abs >= 0.001) {
    // kHz.Hz
    const val = freqMHz * 1000;
    const fixed = val.toFixed(3);
    const [k, h] = fixed.split(".");
    return `${k}.${h}kHz`;
  } else {
    // Hz (just integer as requested)
    return `${Math.round(freqMHz * 1000000)}Hz`;
  }
};

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
  return 50000000.0;
};
