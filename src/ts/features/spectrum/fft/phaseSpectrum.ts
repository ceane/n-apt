import { computeComplexIqSpectrum } from "@n-apt/spectrum/fft/complexSpectrum";

/** Phase is rendered on a cyclic -180..180 scale. */
export const MIN_PHASE_DEG = -180;
export const MAX_PHASE_DEG = 180;

/**
 * Per-frequency-bin phase of an interleaved u8 I/Q payload, in degrees.
 *
 * The bin layout deliberately matches `computeIqToDbSpectrumScalar`: the output
 * is fftshifted (`result[i]` is bin `i ± fftLen/2`) so a phase row lines up
 * index-for-index with the magnitude rows the waterfall already displays.
 *
 * Phase ignores amplitude, so bins holding no signal contribute
 * `atan2(0, 0) === 0` rather than meaningful noise.
 */
export function computeIqToPhaseSpectrum(
  input: Uint8Array,
  options: {
    fftSize: number;
    windowType?: string;
  },
  output?: Float32Array,
): Float32Array {
  const { fftSize, windowType } = options;
  const { real, imag, fftLen } = computeComplexIqSpectrum(
    input,
    fftSize,
    windowType,
  );
  const result =
    output && output.length === fftLen ? output : new Float32Array(fftLen);
  const half = fftLen / 2;
  const radiansToDegrees = 180 / Math.PI;

  for (let i = 0; i < fftLen; i++) {
    const sourceIndex = i < half ? i + half : i - half;
    result[i] =
      Math.atan2(imag[sourceIndex], real[sourceIndex]) * radiansToDegrees;
  }

  return result;
}
