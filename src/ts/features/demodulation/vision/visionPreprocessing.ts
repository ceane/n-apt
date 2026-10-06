import { VISION_PREPROCESSING, type VisionConfig } from "./visionModel";

export const VISION_FEATURE_COUNT = VISION_PREPROCESSING.tensorShape.reduce(
  (product, dimension) => product * dimension,
  1,
);

const fftSize = VISION_PREPROCESSING.fftSize;
const hopSamples = VISION_PREPROCESSING.hopSamples;
const sliceCount = VISION_PREPROCESSING.temporalSlices;
const window = Float64Array.from(
  { length: fftSize },
  (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / fftSize),
);
const windowEnergy = window.reduce((sum, value) => sum + value * value, 0);

const fft = (real: Float64Array, imaginary: Float64Array) => {
  for (let index = 1, reversed = 0; index < fftSize; index++) {
    let bit = fftSize >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [
        imaginary[reversed],
        imaginary[index],
      ];
    }
  }

  for (let width = 2; width <= fftSize; width <<= 1) {
    const halfWidth = width >> 1;
    const angle = (-2 * Math.PI) / width;
    for (let start = 0; start < fftSize; start += width) {
      for (let offset = 0; offset < halfWidth; offset++) {
        const phase = angle * offset;
        const cosine = Math.cos(phase);
        const sine = Math.sin(phase);
        const even = start + offset;
        const odd = even + halfWidth;
        const oddReal = real[odd] * cosine - imaginary[odd] * sine;
        const oddImaginary = real[odd] * sine + imaginary[odd] * cosine;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
      }
    }
  }
};

/**
 * Convert one verified, contiguous 100 ms, interleaved unsigned I/Q context to
 * [10 time slices, 1024 fftshift bins, log-power/phase-delta] features.
 * The caller must verify source, tune, producer sample index and stream
 * continuity before calling; this function rejects incomplete byte contexts.
 */
export function preprocessVisionIqContext(
  iqData: Uint8Array,
  sampleRateHz: number,
): Float32Array {
  if (!(iqData instanceof Uint8Array) || iqData.length % 2 !== 0)
    throw new Error("Vision preprocessing requires complete I/Q pairs");
  if (
    !Number.isInteger(sampleRateHz) ||
    sampleRateHz < 3_200_000 ||
    sampleRateHz % 100 !== 0
  )
    throw new Error("Unsupported vision I/Q sample rate");

  const contextSamples = (sampleRateHz * VISION_PREPROCESSING.contextMs) / 1000;
  if (iqData.length !== contextSamples * 2)
    throw new Error(
      "Vision preprocessing requires an exact 100 ms I/Q context",
    );
  const samplesPerSlice = contextSamples / sliceCount;
  if (!Number.isInteger(samplesPerSlice) || samplesPerSlice < fftSize)
    throw new Error("Sample rate cannot produce ten complete time slices");

  const output = new Float32Array(VISION_FEATURE_COUNT);
  const logPowerSums = new Float64Array(sliceCount * fftSize);
  const phaseRealSums = new Float64Array(sliceCount * fftSize);
  const phaseImaginarySums = new Float64Array(sliceCount * fftSize);
  const windowsPerSlice = new Uint32Array(sliceCount);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const previousReal = new Float64Array(fftSize);
  const previousImaginary = new Float64Array(fftSize);
  const previousPower = new Float64Array(fftSize);
  let hasPrevious = false;

  for (let start = 0; start + fftSize <= contextSamples; start += hopSamples) {
    const slice = Math.min(sliceCount - 1, Math.floor(start / samplesPerSlice));
    windowsPerSlice[slice]++;
    for (let tap = 0; tap < fftSize; tap++) {
      const source = (start + tap) * 2;
      real[tap] = ((iqData[source] - 128) / 127) * window[tap];
      imaginary[tap] = ((iqData[source + 1] - 128) / 127) * window[tap];
    }
    fft(real, imaginary);

    for (let bin = 0; bin < fftSize; bin++) {
      const shiftedBin = (bin + fftSize / 2) % fftSize;
      const target = slice * fftSize + shiftedBin;
      const currentPower = real[bin] ** 2 + imaginary[bin] ** 2;
      logPowerSums[target] += Math.log1p(currentPower / windowEnergy);
      if (hasPrevious && currentPower > 0 && previousPower[bin] > 0) {
        const crossReal =
          real[bin] * previousReal[bin] +
          imaginary[bin] * previousImaginary[bin];
        const crossImaginary =
          imaginary[bin] * previousReal[bin] -
          real[bin] * previousImaginary[bin];
        phaseRealSums[target] += crossReal;
        phaseImaginarySums[target] += crossImaginary;
      }
      previousReal[bin] = real[bin];
      previousImaginary[bin] = imaginary[bin];
      previousPower[bin] = currentPower;
    }
    hasPrevious = true;
  }

  for (let slice = 0; slice < sliceCount; slice++) {
    const count = windowsPerSlice[slice];
    if (count === 0) throw new Error("Missing vision preprocessing time slice");
    for (let bin = 0; bin < fftSize; bin++) {
      const target = (slice * fftSize + bin) * 2;
      output[target] = logPowerSums[slice * fftSize + bin] / count;
      const phaseReal = phaseRealSums[slice * fftSize + bin];
      const phaseImaginary = phaseImaginarySums[slice * fftSize + bin];
      output[target + 1] =
        phaseReal === 0 && phaseImaginary === 0
          ? 0
          : Math.atan2(phaseImaginary, phaseReal);
    }
  }
  return output;
}

export interface VisionFeatureSample {
  trialId: string;
  artifactChecksum: string;
  sourceId: string;
  streamEpoch: number;
  optionsRevision: number;
  centerFrequencyHz: number;
  sampleRateHz: number;
  /** First producer sample in the 100 ms context. */
  firstSampleIndex: number;
  /** Backend epoch timestamp at the context's final sample. */
  timestampBackendMs: number;
  features: Float32Array;
}

export const visionFeatureSampleMatchesConfig = (
  sample: VisionFeatureSample,
  config: VisionConfig,
) =>
  sample.sourceId === config.sourceId &&
  sample.streamEpoch === config.streamEpoch &&
  sample.optionsRevision === config.optionsRevision &&
  sample.centerFrequencyHz === config.centerFrequencyHz &&
  sample.sampleRateHz === config.sampleRateHz;
