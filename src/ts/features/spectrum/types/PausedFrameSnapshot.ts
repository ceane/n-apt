export interface PausedWaterfallTextureMeta {
  width: number;
  height: number;
  writeRow: number;
}

export interface PausedFrameSnapshot {
  iqData: Uint8Array | null;
  waterfall: Uint8ClampedArray | null;
  waterfallDimensions: { width: number; height: number } | null;
  /** Full recent waterfall history from the circular GPU texture, kept in memory. */
  waterfallTextureSnapshot: Uint8Array | null;
  waterfallTextureMeta: PausedWaterfallTextureMeta | null;
}
