export const FFT_LESSON_SAMPLE_COUNT = 2_048;
export const FFT_LESSON_FFT_SIZE = 8;
export const FFT_LESSON_SPECTRUM_SIZE = 512;

export type Complex = {
  real: number;
  imaginary: number;
};

export type LessonWaveformPoint = {
  index: number;
  normalizedTime: number;
  value: number;
  imaginary: number;
};

export type LessonSpectrumPoint = {
  frequencyHz: number;
  magnitude: number;
};

const TWO_PI = Math.PI * 2;
const EPSILON = 1e-12;

const clean = (value: number): number =>
  Math.abs(value) < EPSILON ? 0 : value;

const cleanComplex = (value: Complex): Complex => ({
  real: clean(value.real),
  imaginary: clean(value.imaginary),
});

export const createLessonIqSamples = (
  count = FFT_LESSON_SAMPLE_COUNT,
): Complex[] => {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("FFT lesson sample count must be a positive integer");
  }

  return Array.from({ length: count }, (_, index) => ({
    // The lesson begins with one real sine-wave cycle. Q is zero here so the
    // diagram can introduce I/Q without changing the signal being followed.
    real: Math.sin((TWO_PI * index) / count),
    imaginary: 0,
  }));
};

export const createLessonNaturalIqSamples = (
  count = FFT_LESSON_SAMPLE_COUNT,
): Complex[] => {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("FFT lesson sample count must be a positive integer");
  }

  return Array.from({ length: count }, (_, index) => {
    const phase = (TWO_PI * index) / count;
    return {
      real: Math.sin(phase),
      imaginary: Math.cos(phase),
    };
  });
};

export const createLessonNaturalWaveformSamples = (
  count = FFT_LESSON_SAMPLE_COUNT,
): number[] => {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("FFT lesson sample count must be a positive integer");
  }

  let state = 0x6d2b79f5;
  let previous = 0;

  return Array.from({ length: count }, (_, index) => {
    // A seeded generator makes the waveform noisy and natural-looking while
    // keeping the lesson reproducible in tests and across renders.
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    const noise = (state / 0xffffffff) * 2 - 1;
    const shapedValue =
      previous * 0.58 +
      noise * 76 +
      18 * Math.sin((TWO_PI * index) / 31) +
      10 * Math.sin((TWO_PI * index) / 11);
    const value = Math.max(-128, Math.min(127, Math.round(shapedValue)));
    previous = value;
    return value;
  });
};

export const createLessonWaveformPoints = (
  count = FFT_LESSON_SAMPLE_COUNT,
): LessonWaveformPoint[] =>
  createLessonNaturalIqSamples(count).map((sample, index) => ({
    index,
    normalizedTime: index / count,
    value: sample.real,
    imaginary: sample.imaginary,
  }));

export const calculateBinWidth = (
  sampleRateHz: number,
  fftSize: number,
): number => {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError("Sample rate must be positive and finite");
  }
  if (!Number.isInteger(fftSize) || fftSize < 1) {
    throw new RangeError("FFT size must be a positive integer");
  }

  return sampleRateHz / fftSize;
};

export const getBinCenters = (
  sampleRateHz: number,
  fftSize: number,
): number[] => {
  const binWidth = calculateBinWidth(sampleRateHz, fftSize);
  const firstSignedIndex = -Math.floor(fftSize / 2);

  return Array.from(
    { length: fftSize },
    (_, index) => (firstSignedIndex + index) * binWidth,
  );
};

export const getUncenteredBinCenters = (
  sampleRateHz: number,
  fftSize: number,
): number[] => {
  const binWidth = calculateBinWidth(sampleRateHz, fftSize);

  return Array.from({ length: fftSize }, (_, index) => index * binWidth);
};

export const twiddleFactor = (k: number, n: number): Complex => {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 1) {
    throw new RangeError(
      "Twiddle factor indices must use a positive integer size",
    );
  }

  const angle = (-TWO_PI * k) / n;
  return cleanComplex({
    real: Math.cos(angle),
    imaginary: Math.sin(angle),
  });
};

const multiply = (a: Complex, b: Complex): Complex =>
  cleanComplex({
    real: a.real * b.real - a.imaginary * b.imaginary,
    imaginary: a.real * b.imaginary + a.imaginary * b.real,
  });

const add = (a: Complex, b: Complex): Complex =>
  cleanComplex({
    real: a.real + b.real,
    imaginary: a.imaginary + b.imaginary,
  });

const subtract = (a: Complex, b: Complex): Complex =>
  cleanComplex({
    real: a.real - b.real,
    imaginary: a.imaginary - b.imaginary,
  });

export const butterfly = (a: Complex, b: Complex, twiddle: Complex) => {
  const twiddledB = multiply(b, twiddle);

  return {
    twiddledB,
    sum: add(a, twiddledB),
    difference: subtract(a, twiddledB),
  };
};

export const calculateLessonMagnitudes = (samples: Complex[]): number[] => {
  const size = samples.length;
  if (!Number.isInteger(Math.log2(size))) {
    throw new RangeError(
      "FFT lesson magnitude input must have a power-of-two length",
    );
  }

  const magnitudesByRawBin = Array.from({ length: size }, (_, k) => {
    let real = 0;
    let imaginary = 0;

    samples.forEach((sample, index) => {
      const twiddle = twiddleFactor(k * index, size);
      const product = multiply(sample, twiddle);
      real += product.real;
      imaginary += product.imaginary;
    });

    return Math.hypot(real, imaginary);
  });

  // Present the bins in signed-frequency order: -fs/2 ... 0 ... +fs/2.
  const firstSignedIndex = -Math.floor(size / 2);
  return Array.from({ length: size }, (_, index) => {
    const signedIndex = firstSignedIndex + index;
    const rawIndex = signedIndex < 0 ? size + signedIndex : signedIndex;
    return magnitudesByRawBin[rawIndex] ?? 0;
  });
};

const createSpectrumSamples = (size: number): Complex[] =>
  Array.from({ length: size }, (_, index) => {
    const phase = index / size;
    const deterministicNoise =
      0.035 * Math.sin(TWO_PI * 17 * phase) +
      0.02 * Math.sin(TWO_PI * 29 * phase + 0.7) +
      0.012 * Math.sin(TWO_PI * 61 * phase + 1.4);

    return {
      real:
        0.82 * Math.sin(TWO_PI * 76 * phase) +
        0.52 * Math.sin(TWO_PI * 44 * phase + 0.35) +
        deterministicNoise,
      imaginary: 0,
    };
  });

const gaussian = (value: number, center: number, width: number): number =>
  Math.exp(-0.5 * ((value - center) / width) ** 2);

export const createLessonSpectrumTrace = (
  sampleRateHz: number,
  fftSize = FFT_LESSON_SPECTRUM_SIZE,
): LessonSpectrumPoint[] => {
  calculateBinWidth(sampleRateHz, fftSize);
  if (!Number.isInteger(Math.log2(fftSize))) {
    throw new RangeError(
      "FFT lesson spectrum size must have a power-of-two length",
    );
  }

  const signedMagnitudes = calculateLessonMagnitudes(
    createSpectrumSamples(fftSize),
  );
  const maxMagnitude = Math.max(...signedMagnitudes, 1);
  const binCenters = getUncenteredBinCenters(sampleRateHz, fftSize);

  return binCenters.map((frequencyHz, index) => ({
    frequencyHz,
    // Keep a deterministic noise floor and broad shoulders so the result
    // reads like a live magnitude waveform, while retaining two tone peaks.
    magnitude: Math.min(
      1,
      0.22 +
        0.07 * Math.abs(Math.sin(TWO_PI * (index * 0.37 + 0.19))) +
        0.18 * gaussian(Math.abs(frequencyHz), 1_200, 260) +
        ((signedMagnitudes[(index + Math.floor(fftSize / 2)) % fftSize] ?? 0) /
          maxMagnitude) *
          0.62,
    ),
  }));
};

export const createLessonSpectrumTraceFromSamples = (
  samples: number[],
  sampleRateHz: number,
): LessonSpectrumPoint[] => {
  if (samples.length < 1 || !Number.isInteger(Math.log2(samples.length))) {
    throw new RangeError(
      "FFT lesson waveform samples must have a power-of-two length",
    );
  }

  const fftSize = samples.length;
  const signedMagnitudes = calculateLessonMagnitudes(
    samples.map((real) => ({ real, imaginary: 0 })),
  );
  const maxMagnitude = Math.max(...signedMagnitudes, 1);
  const binCenters = getUncenteredBinCenters(sampleRateHz, fftSize);

  return binCenters.map((frequencyHz, index) => ({
    frequencyHz,
    magnitude: Math.min(
      1,
      0.23 +
        ((signedMagnitudes[(index + Math.floor(fftSize / 2)) % fftSize] ?? 0) /
          maxMagnitude) *
          0.57,
    ),
  }));
};
