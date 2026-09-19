/**
 * Max-pool decimation shared by spectrum renderers. Boundaries differ by
 * caller: snapshot/diagnostic decimation uses a precomputed factor
 * (Math.floor(i * factor)) while the scalar SIMD fallback derives boundaries
 * from (x * srcLen) / outLen — the modes are NOT interchangeable.
 */
export type MaxPoolBoundary = "factor" | "divide";

export function maxInBinRange(
  waveform: ArrayLike<number>,
  start: number,
  end: number,
  skipNonFinite: boolean,
): number {
  let max = -Infinity;
  const len = waveform.length;
  for (let j = start; j < end && j < len; j++) {
    const v = waveform[j];
    if (skipNonFinite ? Number.isFinite(v) && v > max : v > max) {
      max = v;
    }
  }
  return max;
}

export function maxPoolDecimateInto(
  waveform: ArrayLike<number>,
  output: number[] | Float32Array,
  fallback: number,
  boundary: MaxPoolBoundary = "factor",
): void {
  const len = waveform.length;
  const targetWidth = output.length;
  if (targetWidth <= 0 || len === 0) {
    for (let i = 0; i < targetWidth; i++) output[i] = fallback;
    return;
  }
  const factor = len / targetWidth;
  for (let i = 0; i < targetWidth; i++) {
    const start =
      boundary === "factor"
        ? Math.floor(i * factor)
        : Math.floor((i * len) / targetWidth);
    const end =
      boundary === "factor"
        ? Math.min(len, Math.floor((i + 1) * factor))
        : Math.max(start + 1, Math.floor(((i + 1) * len) / targetWidth));
    const max = maxInBinRange(waveform, start, end, false);
    output[i] = max === -Infinity ? fallback : max;
  }
}
