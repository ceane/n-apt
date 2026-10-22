import { computeComplexIqSpectrum } from "./complexSpectrum";

export function computeIqToDbSpectrumScalar(
  input: Uint8Array,
  options: {
    fftSize: number;
    offsetDb: number;
    windowType?: string;
  },
  output?: Float32Array,
): Float32Array {
  const { fftSize, offsetDb, windowType } = options;
  const { real, imag, fftLen, normSq } = computeComplexIqSpectrum(
    input,
    fftSize,
    windowType,
  );
  const result =
    output && output.length === fftLen ? output : new Float32Array(fftLen);
  const half = fftLen / 2;
  for (let i = 0; i < half; i++) {
    const sourceIndex = i + half;
    const magSq =
      (real[sourceIndex] * real[sourceIndex] +
        imag[sourceIndex] * imag[sourceIndex]) /
      normSq;
    result[i] = 10 * Math.log10(magSq + 1e-15) + offsetDb;
  }
  for (let i = half; i < fftLen; i++) {
    const sourceIndex = i - half;
    const magSq =
      (real[sourceIndex] * real[sourceIndex] +
        imag[sourceIndex] * imag[sourceIndex]) /
      normSq;
    result[i] = 10 * Math.log10(magSq + 1e-15) + offsetDb;
  }

  return result;
}

