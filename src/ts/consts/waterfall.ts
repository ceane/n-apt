import { THEME_TOKENS } from "./theme";

const BASE_COLORS = THEME_TOKENS.colors.light;

export const WATERFALL_GRID_COLOR = BASE_COLORS.waterfallGrid;
export const WATERFALL_TEXT_COLOR = BASE_COLORS.waterfallText;
// Reuse FFT dB constants for consistency
export {
  FFT_MIN_DB as WATERFALL_MIN_DB,
  FFT_MAX_DB as WATERFALL_MAX_DB,
} from "@n-apt/consts/fft";

// Frequency ranges for optimal grid display
export const WATERFALL_FREQUENCY_RANGES = [
  1.0, 2.0, 2.5, 5.0, 10.0, 20.0, 25.0, 50.0, 100.0, 200.0, 250.0, 500.0,
  1000.0, 2000.0, 2500.0, 5000.0, 10000.0, 20000.0, 25000.0, 50000.0, 100000.0,
  200000.0, 250000.0, 500000.0, 1000000.0, 2000000.0, 2500000.0, 5000000.0,
  10000000.0, 20000000.0, 25000000.0, 50000000.0,
];

// Canvas layout constants
export const WF_MIN = { x: 40, y: 20 };
export const WATERFALL_CANVAS_BG = BASE_COLORS.waterfallBackground;
export const WATERFALL_FONT_FAMILY = THEME_TOKENS.typography.mono;
export const WATERFALL_FONT_SIZE = THEME_TOKENS.layout.waterfallFontSize;
