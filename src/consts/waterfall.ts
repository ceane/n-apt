/**
 * Constants for waterfall display rendering
 * SDR++ style color palette and display parameters
 */

export const DEFAULT_COLOR_MAP: number[][] = [
  [0x00, 0x00, 0x20],
  [0x00, 0x00, 0x30],
  [0x00, 0x00, 0x50],
  [0x00, 0x00, 0x91],
  [0x1e, 0x90, 0xff],
  [0xff, 0xff, 0xff],
  [0xff, 0xff, 0x00],
  [0xfe, 0x6d, 0x16],
  [0xff, 0x00, 0x00],
  [0xc6, 0x00, 0x00],
  [0x9f, 0x00, 0x00],
  [0x75, 0x00, 0x00],
  [0x4a, 0x00, 0x00],
];

export const WATERFALL_GRID_COLOR = "rgba(50, 50, 50, 255)";
export const WATERFALL_TEXT_COLOR = "#666";
// Reuse FFT dB constants for consistency
export { FFT_MIN_DB as WATERFALL_MIN_DB, FFT_MAX_DB as WATERFALL_MAX_DB } from "./ts/fft";

// Frequency ranges for optimal grid display
export const WATERFALL_FREQUENCY_RANGES = [
  1.0, 2.0, 2.5, 5.0, 10.0, 20.0, 25.0, 50.0, 100.0, 200.0, 250.0, 500.0, 1000.0, 2000.0, 2500.0,
  5000.0, 10000.0, 20000.0, 25000.0, 50000.0, 100000.0, 200000.0, 250000.0, 500000.0, 1000000.0,
  2000000.0, 2500000.0, 5000000.0, 10000000.0, 20000000.0, 25000000.0, 50000000.0,
];

// Canvas layout constants
export const WF_MIN = { x: 40, y: 20 };
export const WATERFALL_CANVAS_BG = "#0a0a0a";
export const WATERFALL_FONT_FAMILY = "JetBrains Mono";
export const WATERFALL_FONT_SIZE = "16px";
