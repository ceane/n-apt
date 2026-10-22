export interface PausedFrameSnapshot {
  iqData: Uint8Array | null;
  waterfall: Uint8ClampedArray | null;
  waterfallDimensions: { width: number; height: number } | null;
}
