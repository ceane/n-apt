/**
 * Return a spectrum with the centered DC bin replaced by its two immediate
 * neighbors. The input is not mutated so the raw spectrum remains available
 * to other consumers.
 */
export function removeDcSpikeFromSpectrum(
  spectrum: Float32Array,
  output?: Float32Array,
): Float32Array {
  const result =
    output && output.length === spectrum.length
      ? output
      : new Float32Array(spectrum.length);
  result.set(spectrum);

  if (spectrum.length < 3) return result;

  const center = Math.floor(spectrum.length / 2);
  const left = spectrum[center - 1];
  const right = spectrum[center + 1];
  if (Number.isFinite(left) && Number.isFinite(right)) {
    result[center] = (left + right) * 0.5;
  }

  return result;
}
