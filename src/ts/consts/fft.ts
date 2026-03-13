import { COLORS } from "./components";

export const FFT_GRID_COLOR = COLORS.fftGrid;
export const LINE_COLOR = COLORS.fftLine;
export const HOLD_COLOR = COLORS.fftHold;
export const SHADOW_COLOR = COLORS.fftShadow;
export const FFT_TEXT_COLOR = COLORS.fftText;
export const FFT_MIN_DB = -120;
export const FFT_MAX_DB = 30;
export const DB_MARKERS = [-120, -100, -80, -60, -40, -20, 0, 20, 30];
export const VERTICAL_RANGE = 10.0;

// Frequency ranges for optimal grid display
export const FFT_FREQUENCY_RANGES = [
  1.0, 2.0, 2.5, 5.0, 10.0, 20.0, 25.0, 50.0, 100.0, 200.0, 250.0, 500.0,
  1000.0, 2000.0, 2500.0, 5000.0, 10000.0, 20000.0, 25000.0, 50000.0, 100000.0,
  200000.0, 250000.0, 500000.0, 1000000.0, 2000000.0, 2500000.0, 5000000.0,
  10000000.0, 20000000.0, 25000000.0, 50000000.0,
];

// Canvas layout constants
export const FFT_AREA_MIN = { x: 40, y: 20 };
export const FFT_CANVAS_BG = COLORS.fftBackground;
export const FFT_FONT_FAMILY = "JetBrains Mono";
export const FFT_FONT_SIZE = "16px";

// Snapshot specific colors
export const SNAP_HW_RATE_LINE = COLORS.snapHwRateLine;
export const SNAP_HW_RATE_TEXT = COLORS.snapHwRateText;
export const SNAP_CENTER_LABEL_BG = COLORS.snapCenterLabelBg;
export const SNAP_CENTER_LABEL_TEXT = COLORS.snapCenterLabelText;

// Overlay specific colors
export const CENTER_LINE_COLOR = COLORS.fftCenterLine;
export const OFFSET_TICK_LINE_COLOR = COLORS.fftOffsetTickLine;
export const OFFSET_TICK_TEXT_COLOR = COLORS.fftOffsetTickText;
export const BOUNDARY_LINE_COLOR = COLORS.fftBoundaryLine;
export const BOUNDARY_TEXT_COLOR = COLORS.fftBoundaryText;
