import {
  applyComplexLowPass,
  shiftIqToBaseband,
  type LowPassState,
  type ShiftState,
} from "@n-apt/demodulation/utils/demodulation";
import {
  createDemodProcessor,
  type DemodAlgorithm,
} from "@n-apt/demodulation/utils/demodProcessors";

const DEFAULT_FFT_SIZE = 4096;
const MAX_FFT_WINDOWS = 8;
const MIN_CANDIDATE_BANDWIDTH_HZ = 6_250;
const MIN_NOISE_POWER = 1e-14;

export interface AudioSurveyFrameInput {
  iqData: Uint8Array;
  sampleRateHz: number;
  frameCenterFrequencyHz: number;
  allowedRangeHz: { min: number; max: number };
  targetSampleRateHz?: number;
  fftSize?: number;
}

export interface DemodulatedAudio {
  samples: Float32Array;
  sampleRateHz: number;
}

export interface AudioSurveyCandidate {
  centerHz: number;
  bandwidthHz: number;
  snrDb: number;
  score: number;
  modulation: "am" | "fm" | "unknown";
  audioPcm: Float32Array;
  modulationScores: { am: number; fm: number };
}

export interface ChannelizedSurveyIq {
  iqData: Uint8Array;
  sampleRateHz: number;
}

export interface SurveyChannelizer {
  process: (
    iqData: Uint8Array,
    sampleRateHz: number,
    frameCenterFrequencyHz: number,
  ) => ChannelizedSurveyIq;
  reset: () => void;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const fftInPlace = (real: Float64Array, imaginary: Float64Array) => {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }

  for (let width = 2; width <= size; width <<= 1) {
    const halfWidth = width >> 1;
    const angle = (-2 * Math.PI) / width;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += width) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < halfWidth; offset++) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + halfWidth;
        const oddReal =
          real[oddIndex] * twiddleReal -
          imaginary[oddIndex] * twiddleImaginary;
        const oddImaginary =
          real[oddIndex] * twiddleImaginary +
          imaginary[oddIndex] * twiddleReal;
        real[oddIndex] = real[evenIndex] - oddReal;
        imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary;
        real[evenIndex] += oddReal;
        imaginary[evenIndex] += oddImaginary;
        const nextTwiddleReal =
          twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary =
          twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }
};

const estimatePowerSpectrum = (
  iqData: Uint8Array,
  fftSize: number,
): Float64Array => {
  const sampleCount = Math.floor(iqData.length / 2);
  const windowCount = Math.min(
    MAX_FFT_WINDOWS,
    Math.floor(sampleCount / fftSize),
  );
  const power = new Float64Array(fftSize);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    const startSample = windowIndex * fftSize;
    for (let index = 0; index < fftSize; index++) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / fftSize);
      real[index] = ((iqData[(startSample + index) * 2] ?? 128) - 128) / 128 * window;
      imaginary[index] =
        ((iqData[(startSample + index) * 2 + 1] ?? 128) - 128) / 128 * window;
    }
    fftInPlace(real, imaginary);
    for (let index = 0; index < fftSize; index++) {
      power[index] +=
        (real[index] * real[index] + imaginary[index] * imaginary[index]) /
        (fftSize * fftSize * windowCount);
    }
  }
  return power;
};

const getMedian = (values: Float64Array): number => {
  const sorted = Array.from(values).sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? MIN_NOISE_POWER;
};

const evaluateAudioEvidence = (samples: Float32Array): number => {
  if (samples.length < 8) return 0;
  let energy = 0;
  let crossings = 0;
  let previous = samples[0];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    energy += sample * sample;
    if (i > 0 && (sample < 0) !== (previous < 0)) crossings++;
    previous = sample;
  }
  const rms = Math.sqrt(energy / samples.length);
  const crossingRate = crossings / samples.length;
  const level = clamp01(rms / 0.12);
  const nonSilent = crossingRate > 0.001 && crossingRate < 0.48 ? 1 : 0.35;
  return level * nonSilent;
};

export const demodulateAudioCandidate = ({
  iqData,
  sampleRateHz,
  frameCenterFrequencyHz,
  centerFrequencyHz,
  bandwidthHz,
  modulation,
  targetSampleRateHz = 48_000,
}: {
  iqData: Uint8Array;
  sampleRateHz: number;
  frameCenterFrequencyHz: number;
  centerFrequencyHz: number;
  bandwidthHz: number;
  modulation: "am" | "fm";
  targetSampleRateHz?: number;
}): DemodulatedAudio => {
  const algorithm: DemodAlgorithm = modulation;
  const processor = createDemodProcessor(algorithm, {
    targetSampleRate: targetSampleRateHz,
    centerFrequency: centerFrequencyHz,
    bandwidth: Math.max(2_000, Math.min(sampleRateHz * 0.95, bandwidthHz)),
  });
  return {
    samples: processor.process(iqData, sampleRateHz, frameCenterFrequencyHz),
    sampleRateHz: targetSampleRateHz,
  };
};

/** Mix, low-pass, and decimate one candidate channel for compact clip storage. */
export const createAudioSurveyChannelizer = ({
  centerFrequencyHz,
  bandwidthHz,
}: {
  centerFrequencyHz: number;
  bandwidthHz: number;
}): SurveyChannelizer => {
  const shiftState: ShiftState = { phase: 0 };
  const filterState: LowPassState = { prevI: 0, prevQ: 0 };
  let decimationPhase = 0;
  let sampleRateHz = 0;
  let decimation = 1;
  let outputRateHz = 0;

  const reset = () => {
    shiftState.phase = 0;
    filterState.prevI = 0;
    filterState.prevQ = 0;
    decimationPhase = 0;
    sampleRateHz = 0;
    decimation = 1;
    outputRateHz = 0;
  };

  return {
    reset,
    process(iqData, inputRateHz, frameCenterFrequencyHz) {
      if (!Number.isFinite(inputRateHz) || inputRateHz <= 0) {
        return { iqData: new Uint8Array(), sampleRateHz: 0 };
      }
      if (sampleRateHz !== inputRateHz) {
        reset();
        sampleRateHz = inputRateHz;
        const targetRateHz = Math.min(
          inputRateHz,
          Math.max(48_000, Math.min(600_000, bandwidthHz * 2.5)),
        );
        decimation = Math.max(1, Math.floor(inputRateHz / targetRateHz));
        outputRateHz = inputRateHz / decimation;
      }

      const shifted = shiftIqToBaseband(
        iqData,
        inputRateHz,
        centerFrequencyHz - frameCenterFrequencyHz,
        shiftState,
      );
      const filtered = applyComplexLowPass(
        shifted,
        inputRateHz,
        bandwidthHz,
        filterState,
      );
      const totalSamples = Math.floor(filtered.length / 2);
      const firstOffset = (decimation - decimationPhase) % decimation;
      const outputCount = Math.max(
        0,
        Math.ceil((totalSamples - firstOffset) / decimation),
      );
      const compactIq = new Uint8Array(outputCount * 2);
      let outputIndex = 0;
      for (let sample = firstOffset; sample < totalSamples; sample += decimation) {
        const inPhase = filtered[sample * 2];
        const quadrature = filtered[sample * 2 + 1];
        compactIq[outputIndex * 2] = Math.max(
          0,
          Math.min(255, Math.round(inPhase * 127 + 128)),
        );
        compactIq[outputIndex * 2 + 1] = Math.max(
          0,
          Math.min(255, Math.round(quadrature * 127 + 128)),
        );
        outputIndex++;
      }
      decimationPhase = (decimationPhase + totalSamples) % decimation;
      return { iqData: compactIq, sampleRateHz: outputRateHz };
    },
  };
};

/**
 * Finds occupied RF regions in one independent I/Q frame, then evaluates AM
 * and FM waveform decodes. The FFT is used only to locate candidate channels;
 * all demodulation outputs remain time-domain PCM.
 */
export const analyzeAudioSurveyFrame = ({
  iqData,
  sampleRateHz,
  frameCenterFrequencyHz,
  allowedRangeHz,
  targetSampleRateHz = 48_000,
  fftSize = DEFAULT_FFT_SIZE,
}: AudioSurveyFrameInput): AudioSurveyCandidate[] => {
  if (
    iqData.length < fftSize * 2 ||
    !Number.isFinite(sampleRateHz) ||
    sampleRateHz <= 0 ||
    !Number.isFinite(frameCenterFrequencyHz) ||
    fftSize < 256 ||
    (fftSize & (fftSize - 1)) !== 0
  ) {
    return [];
  }

  const power = estimatePowerSpectrum(iqData, fftSize);
  const noiseFloor = Math.max(getMedian(power), MIN_NOISE_POWER);
  const peakPower = Math.max(...power);
  const threshold = Math.max(noiseFloor * 6, peakPower * 1e-4);
  const binWidthHz = sampleRateHz / fftSize;
  const minimumBins = 1;
  const mergeGapBins = Math.max(1, Math.ceil(2_000 / binWidthHz));
  const candidates: AudioSurveyCandidate[] = [];
  let start = -1;
  let previousActive = -2;

  const evaluateRegion = (regionStart: number, regionEnd: number) => {
    const binCount = regionEnd - regionStart + 1;
    if (binCount < minimumBins) return;
    let weightedOffset = 0;
    let weightSum = 0;
    let peakPower = 0;
    for (let bin = regionStart; bin <= regionEnd; bin++) {
      const offsetHz = bin <= fftSize / 2 ? bin * binWidthHz : (bin - fftSize) * binWidthHz;
      const weight = Math.max(0, power[bin] - noiseFloor);
      weightedOffset += offsetHz * weight;
      weightSum += weight;
      peakPower = Math.max(peakPower, power[bin]);
    }
    const offsetHz = weightSum > 0 ? weightedOffset / weightSum : 0;
    const centerHz = frameCenterFrequencyHz + offsetHz;
    const bandwidthHz = Math.max(
      MIN_CANDIDATE_BANDWIDTH_HZ,
      binCount * binWidthHz,
    );
    if (
      centerHz + bandwidthHz / 2 < allowedRangeHz.min ||
      centerHz - bandwidthHz / 2 > allowedRangeHz.max
    ) {
      return;
    }

    const snrDb = 10 * Math.log10(Math.max(peakPower, MIN_NOISE_POWER) / noiseFloor);
    const amAudio = demodulateAudioCandidate({
      iqData,
      sampleRateHz,
      frameCenterFrequencyHz,
      centerFrequencyHz: centerHz,
      bandwidthHz,
      modulation: "am",
      targetSampleRateHz,
    });
    const fmAudio = demodulateAudioCandidate({
      iqData,
      sampleRateHz,
      frameCenterFrequencyHz,
      centerFrequencyHz: centerHz,
      bandwidthHz,
      modulation: "fm",
      targetSampleRateHz,
    });
    const modulationScores = {
      am: evaluateAudioEvidence(amAudio.samples),
      fm: evaluateAudioEvidence(fmAudio.samples),
    };
    const score =
      0.55 * (1 - Math.exp(-Math.max(0, snrDb - 3) / 12)) +
      0.45 * Math.max(modulationScores.am, modulationScores.fm);
    const modulation =
      Math.max(modulationScores.am, modulationScores.fm) < 0.08 ||
      Math.abs(modulationScores.am - modulationScores.fm) < 0.035
        ? "unknown"
        : modulationScores.am > modulationScores.fm
          ? "am"
          : "fm";
    const selectedAudio =
      modulation === "fm" ? fmAudio : modulation === "am" ? amAudio :
        modulationScores.fm > modulationScores.am ? fmAudio : amAudio;

    candidates.push({
      centerHz,
      bandwidthHz,
      snrDb,
      score,
      modulation,
      audioPcm: selectedAudio.samples,
      modulationScores,
    });
  };

  for (let bin = 0; bin < fftSize; bin++) {
    if (power[bin] <= threshold) continue;
    if (start < 0) {
      start = bin;
      previousActive = bin;
    } else if (bin - previousActive <= mergeGapBins + 1) {
      previousActive = bin;
    } else {
      evaluateRegion(start, previousActive);
      start = bin;
      previousActive = bin;
    }
  }
  if (start >= 0) {
    evaluateRegion(start, previousActive);
  }

  return candidates.sort((left, right) => right.score - left.score).slice(0, 64);
};
