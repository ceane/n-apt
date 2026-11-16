export const WATERFALL_SOURCE_FFT_SIZE = 4096;
export const WATERFALL_SOURCE_HISTORY_ROWS = 512;

export const WATERFALL_NODE_WIDTH = 880;
export const WATERFALL_NODE_HEIGHT = 540;
export const WATERFALL_CONTROL_RAIL_WIDTH = 108;

export const WATERFALL_ANALYSIS_CONTROL_RAIL_WIDTH = 160;
export const WATERFALL_ANALYSIS_COLUMN_GAP = 16;
export const WATERFALL_ANALYSIS_NODE_WIDTH =
  WATERFALL_NODE_WIDTH -
  WATERFALL_CONTROL_RAIL_WIDTH +
  WATERFALL_ANALYSIS_CONTROL_RAIL_WIDTH +
  WATERFALL_ANALYSIS_COLUMN_GAP;

export const formatWaterfallSpan = (spanHz: number): string => {
  if (!Number.isFinite(spanHz) || spanHz <= 0) return "—";
  if (spanHz >= 1_000_000) return `${(spanHz / 1_000_000).toFixed(2)} MHz`;
  if (spanHz >= 1_000) return `${(spanHz / 1_000).toFixed(1)} kHz`;
  return `${Math.round(spanHz)} Hz`;
};
