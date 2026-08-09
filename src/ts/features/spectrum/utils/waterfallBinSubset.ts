export type WaterfallBinSubsetMode = "none" | "interleaved";
export type WaterfallBinParity = "odd" | "even";

export interface WaterfallBinSubset {
  mode: WaterfallBinSubsetMode;
  parity: WaterfallBinParity;
}

export const DEFAULT_WATERFALL_BIN_SUBSET: WaterfallBinSubset = {
  mode: "none",
  parity: "odd",
};

/**
 * Returns the selected half of an FFT row for the Canvas2D fallback.
 * Odd bins are the one-based bins 1, 3, 5... (zero-based indices 1, 3, 5...).
 */
export const selectWaterfallBinSubset = (
  spectrum: Float32Array,
  subset: WaterfallBinSubset,
): Float32Array => {
  if (subset.mode === "none") return spectrum;

  const parity = subset.parity === "odd" ? 1 : 0;
  const selected = new Float32Array(
    Math.max(0, Math.ceil((spectrum.length - parity) / 2)),
  );
  for (let index = 0; index < selected.length; index += 1) {
    selected[index] = spectrum[index * 2 + parity];
  }
  return selected;
};
