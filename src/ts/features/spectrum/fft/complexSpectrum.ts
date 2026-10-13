/**
 * Shared complex-I/Q FFT used by the scalar spectrum paths.
 *
 * The magnitude (dB) spectrum and the phase spectrum are both derived from the
 * same butterflies so their bins line up index-for-index.
 */

export const normalizeWindowType = (windowType?: string) => {
  switch ((windowType ?? "hanning").toLowerCase()) {
    case "none":
    case "rectangular":
      return "rectangular";
    case "hann":
    case "hanning":
      return "hanning";
    case "hamming":
      return "hamming";
    case "blackman":
      return "blackman";
    case "nuttall":
      return "nuttall";
    default:
      return "hanning";
  }
};

export type SpectrumScratch = {
  paddedReal: Float32Array;
  paddedImag: Float32Array;
  bitReverse: Uint32Array;
};

export interface ComplexIqSpectrum {
  /** Transformed real bins. Owned by the shared scratch cache — consume
   * synchronously before the next call. */
  real: Float32Array;
  /** Transformed imaginary bins. Same ownership rules as {@link real}. */
  imag: Float32Array;
  fftLen: number;
  numSamples: number;
  normSq: number;
}

const windowCache = new Map<string, Float32Array>();
const spectrumScratchCache = new Map<number, SpectrumScratch>();

const getWindowValue = (index: number, size: number, windowType?: string) => {
  if (size <= 1) return 1;

  const normalized = normalizeWindowType(windowType);
  const t = index / (size - 1);
  switch (normalized) {
    case "rectangular":
      return 1;
    case "hamming":
      return 0.54 - 0.46 * Math.cos(2 * Math.PI * t);
    case "blackman":
      return (
        0.42 -
        0.5 * Math.cos(2 * Math.PI * t) +
        0.08 * Math.cos(4 * Math.PI * t)
      );
    case "nuttall":
      return (
        0.355768 -
        0.487396 * Math.cos(2 * Math.PI * t) +
        0.144232 * Math.cos(4 * Math.PI * t) -
        0.012604 * Math.cos(6 * Math.PI * t)
      );
    case "hanning":
    default:
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
  }
};

const getWindowCoefficients = (
  fftSize: number,
  windowType?: string,
): Float32Array => {
  const normalized = normalizeWindowType(windowType);
  const cacheKey = `${fftSize}:${normalized}`;
  const cached = windowCache.get(cacheKey);
  if (cached) return cached;

  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = getWindowValue(i, fftSize, normalized);
  }
  windowCache.set(cacheKey, window);
  return window;
};

const getSpectrumScratch = (fftLen: number): SpectrumScratch => {
  const cached = spectrumScratchCache.get(fftLen);
  if (cached) return cached;

  const scratch: SpectrumScratch = {
    paddedReal: new Float32Array(fftLen),
    paddedImag: new Float32Array(fftLen),
    bitReverse: new Uint32Array(fftLen),
  };

  const bits = Math.log2(fftLen);
  for (let i = 0; i < fftLen; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    scratch.bitReverse[i] = y >>> 0;
  }

  spectrumScratchCache.set(fftLen, scratch);
  return scratch;
};

/**
 * Windows and transforms an interleaved u8 I/Q payload, returning the raw
 * complex bins (no fftshift applied — callers decide the bin layout).
 */
export const computeComplexIqSpectrum = (
  input: Uint8Array,
  fftSize: number,
  windowType?: string,
): ComplexIqSpectrum => {
  const numSamples = Math.max(
    1,
    Math.min(fftSize, Math.floor(input.length / 2)),
  );
  const windowCoefficients = getWindowCoefficients(numSamples, windowType);
  const fftLen = Math.pow(2, Math.ceil(Math.log2(numSamples)));
  const scratch = getSpectrumScratch(fftLen);
  const { paddedReal, paddedImag, bitReverse } = scratch;
  let windowEnergy = 0;

  paddedReal.fill(0);
  paddedImag.fill(0);
  for (let i = 0; i < numSamples; i++) {
    const windowVal = windowCoefficients[i];
    const inputIndex = i * 2;
    paddedReal[i] = ((input[inputIndex] - 128) / 128) * windowVal;
    paddedImag[i] = ((input[inputIndex + 1] - 128) / 128) * windowVal;
    windowEnergy += windowVal * windowVal;
  }

  for (let i = 0; i < fftLen; i++) {
    const j = bitReverse[i];
    if (j > i) {
      const realValue = paddedReal[i];
      paddedReal[i] = paddedReal[j];
      paddedReal[j] = realValue;
      const imagValue = paddedImag[i];
      paddedImag[i] = paddedImag[j];
      paddedImag[j] = imagValue;
    }
  }

  const bits = Math.log2(fftLen);
  for (let s = 1; s <= bits; s++) {
    const m = 1 << s;
    const halfM = m >> 1;
    const wAngle = (-2 * Math.PI) / m;
    const wStepReal = Math.cos(wAngle);
    const wStepImag = Math.sin(wAngle);

    for (let k = 0; k < fftLen; k += m) {
      let wReal = 1;
      let wImag = 0;
      for (let j = 0; j < halfM; j++) {
        const uReal = paddedReal[k + j];
        const uImag = paddedImag[k + j];
        const vr =
          paddedReal[k + j + halfM] * wReal - paddedImag[k + j + halfM] * wImag;
        const vi =
          paddedReal[k + j + halfM] * wImag + paddedImag[k + j + halfM] * wReal;
        paddedReal[k + j] = uReal + vr;
        paddedImag[k + j] = uImag + vi;
        paddedReal[k + j + halfM] = uReal - vr;
        paddedImag[k + j + halfM] = uImag - vi;
        const nextWReal = wReal * wStepReal - wImag * wStepImag;
        wImag = wReal * wStepImag + wImag * wStepReal;
        wReal = nextWReal;
      }
    }
  }

  const normSq = Math.max(numSamples * windowEnergy, 1e-12);

  return {
    real: paddedReal,
    imag: paddedImag,
    fftLen,
    numSamples,
    normSq,
  };
};
