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
import type { AudioSurveyDecoderStrategy } from "@n-apt/demodulation/survey/audioSurveyModel";

const DEFAULT_FFT_SIZE = 4096;
const MAX_FFT_WINDOWS = 8;
const MIN_CANDIDATE_BANDWIDTH_HZ = 6_250;
const OBSERVED_SPIKE_SPACING_HZ = 34_000;
const MIN_SPIKE_WALK_BANDWIDTH_HZ = 2 * OBSERVED_SPIKE_SPACING_HZ;
const MIN_NOISE_POWER = 1e-14;

export interface AudioSurveyFrameInput {
  iqData: Uint8Array;
  sampleRateHz: number;
  frameCenterFrequencyHz: number;
  allowedRangeHz: { min: number; max: number };
  decoderStrategy?: AudioSurveyDecoderStrategy | null | "auto";
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
  spikeValleyPairs?: number;
  spikeSpacingHz?: number;
  snrDb: number;
  score: number;
  modulation: "am" | "fm" | "apt" | "unknown";
  audioPcm: Float32Array;
  modulationScores: { am: number; fm: number; apt: number };
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

/** Return the decimated I/Q rate used to capture a selected channel. */
export const getAudioSurveyChannelizedSampleRateHz = (
  inputSampleRateHz: number,
  bandwidthHz: number,
): number => {
  if (
    !Number.isFinite(inputSampleRateHz) ||
    inputSampleRateHz <= 0 ||
    !Number.isFinite(bandwidthHz) ||
    bandwidthHz <= 0
  ) {
    return 0;
  }
  const targetRateHz = Math.min(
    inputSampleRateHz,
    Math.max(48_000, Math.min(600_000, bandwidthHz * 2.5)),
  );
  const decimation = Math.max(1, Math.floor(inputSampleRateHz / targetRateHz));
  return inputSampleRateHz / decimation;
};

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
          real[oddIndex] * twiddleReal - imaginary[oddIndex] * twiddleImaginary;
        const oddImaginary =
          real[oddIndex] * twiddleImaginary + imaginary[oddIndex] * twiddleReal;
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
      real[index] =
        (((iqData[(startSample + index) * 2] ?? 128) - 128) / 128) * window;
      imaginary[index] =
        (((iqData[(startSample + index) * 2 + 1] ?? 128) - 128) / 128) * window;
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

export interface SpikeValleyWidthWalk {
  startBin: number;
  endBin: number;
  anchorBin?: number;
  pairCount?: number;
  spikeSpacingHz?: number;
  stopReason:
    | "weak-next-spike"
    | "pair-limit"
    | "spectrum-edge"
    | "insufficient-spikes";
}

/**
 * Walks local spike/valley pairs rightward from the strongest local peak.
 * Two pairs to the right are required before this walk replaces the
 * occupied-bandwidth bounds; it can extend to seven, stopping at a valley
 * before a weak spike or at the last included spike when the pair limit is hit.
 */
export const walkSpectralSpikeValleys = ({
  power,
  startBin,
  endBin,
  centerBin,
  threshold,
  binWidthHz = 1,
  minPairs = 2,
  maxPairs = 7,
  weakSpikeRatio = 0.7,
  acceptedPeakBins,
}: {
  power: Float64Array;
  startBin: number;
  endBin: number;
  centerBin: number;
  threshold: number;
  binWidthHz?: number;
  minPairs?: number;
  maxPairs?: number;
  weakSpikeRatio?: number;
  /** Optional peaks selected by the WebGPU-compatible local shape detector. */
  acceptedPeakBins?: ReadonlySet<number>;
}): SpikeValleyWidthWalk => {
  const firstBin = Math.max(0, Math.min(power.length - 1, Math.ceil(startBin)));
  const lastBin = Math.max(
    firstBin,
    Math.min(power.length - 1, Math.floor(endBin)),
  );
  const fallback = {
    startBin: firstBin,
    endBin: lastBin,
    stopReason: "insufficient-spikes" as const,
  };
  const requiredPairs = Math.max(1, Math.floor(minPairs));
  const pairLimit = Math.max(requiredPairs, Math.floor(maxPairs));
  if (
    power.length < 3 ||
    firstBin >= lastBin ||
    !Number.isFinite(centerBin) ||
    !Number.isFinite(threshold) ||
    !Number.isFinite(binWidthHz) ||
    binWidthHz <= 0 ||
    !Number.isFinite(weakSpikeRatio) ||
    weakSpikeRatio < 0
  ) {
    return fallback;
  }

  const peaks: number[] = [];
  for (
    let bin = Math.max(1, firstBin);
    bin <= Math.min(power.length - 2, lastBin);
    bin++
  ) {
    if (
      (acceptedPeakBins
        ? acceptedPeakBins.has(bin)
        : power[bin] >= threshold) &&
      power[bin] >= power[bin - 1] &&
      power[bin] > power[bin + 1]
    ) {
      peaks.push(bin);
    }
  }
  if (peaks.length < requiredPairs + 1) return fallback;

  let anchorPosition = 0;
  for (let position = 1; position < peaks.length; position++) {
    if (
      power[peaks[position]] > power[peaks[anchorPosition]] ||
      (power[peaks[position]] === power[peaks[anchorPosition]] &&
        Math.abs(peaks[position] - centerBin) <
          Math.abs(peaks[anchorPosition] - centerBin))
    ) {
      anchorPosition = position;
    }
  }

  const findValley = (leftPeak: number, rightPeak: number) => {
    const lower = Math.min(leftPeak, rightPeak);
    const upper = Math.max(leftPeak, rightPeak);
    let minimum = Number.POSITIVE_INFINITY;
    let firstMinimum = lower;
    let lastMinimum = lower;
    for (let bin = lower + 1; bin < upper; bin++) {
      if (power[bin] < minimum) {
        minimum = power[bin];
        firstMinimum = bin;
        lastMinimum = bin;
      } else if (power[bin] === minimum) {
        lastMinimum = bin;
      }
    }
    return {
      bin: Math.round((firstMinimum + lastMinimum) / 2),
      power: Number.isFinite(minimum)
        ? minimum
        : Math.min(power[lower], power[upper]),
    };
  };

  const anchorBin = peaks[anchorPosition];
  const anchorLevel = power[anchorBin];
  const baseLevel = threshold + Math.max(0, anchorLevel - threshold) * 0.1;
  let leftBoundary = anchorBin;
  while (leftBoundary > firstBin && power[leftBoundary - 1] >= baseLevel) {
    leftBoundary--;
  }
  if (leftBoundary > firstBin) leftBoundary--;

  let pairCount = 0;
  let currentPeakPosition = anchorPosition;
  let rightBoundary = anchorBin;
  let stopReason: SpikeValleyWidthWalk["stopReason"] = "spectrum-edge";
  const recentProminences: number[] = [];
  const pairSpacingsHz: number[] = [];
  const recentMedian = () => {
    const recent = recentProminences
      .slice(-3)
      .sort((left, right) => left - right);
    return recent[Math.floor(recent.length / 2)] ?? 0;
  };

  while (pairCount < pairLimit && currentPeakPosition < peaks.length - 1) {
    const nextPeak = peaks[currentPeakPosition + 1];
    const currentPeak = peaks[currentPeakPosition];
    const valley = findValley(currentPeak, nextPeak);
    const prominence = Math.max(0, power[nextPeak] - valley.power);
    if (
      pairCount >= requiredPairs &&
      recentProminences.length > 0 &&
      prominence < recentMedian() * weakSpikeRatio
    ) {
      rightBoundary = valley.bin;
      stopReason = "weak-next-spike";
      break;
    }

    pairCount++;
    recentProminences.push(prominence);
    pairSpacingsHz.push((nextPeak - currentPeak) * binWidthHz);
    currentPeakPosition++;
    rightBoundary = nextPeak;
  }
  if (pairCount >= pairLimit) stopReason = "pair-limit";
  if (pairCount < requiredPairs) return fallback;

  return {
    startBin: leftBoundary,
    endBin: rightBoundary,
    anchorBin,
    pairCount,
    spikeSpacingHz: pairSpacingsHz.sort((left, right) => left - right)[
      Math.floor(pairSpacingsHz.length / 2)
    ],
    stopReason,
  };
};

/**
 * JavaScript port of spike_compute.wgsl scoring, applied to raw survey FFT
 * bins in dB. Neighborhood radius and thresholds match the display shader;
 * the 34 kHz spacing remains a separate channel-width prior.
 */
export const detectWebGpuStyleSpectrumSpikes = (
  power: Float64Array,
): number[] => {
  const length = power.length;
  if (length < 3) return [];
  const waveform = new Float64Array(length);
  let floorSum = 0;
  for (let index = 0; index < length; index++) {
    waveform[index] = 10 * Math.log10(Math.max(power[index], MIN_NOISE_POWER));
    floorSum += waveform[index];
  }
  const globalFloor = floorSum / length;
  const radius = 12;
  const suppressionRadius = 2;
  const edgeBandBins = 10;
  const accepted = new Set<number>();

  for (let index = 0; index < length; index++) {
    const value = waveform[index];
    const left = index > 0 ? waveform[index - 1] : value - 1;
    const right = index + 1 < length ? waveform[index + 1] : value - 1;
    const inRightEdgeBand = index + edgeBandBins >= length;
    let isEdgeBandMax = true;
    if (inRightEdgeBand) {
      for (
        let edge = Math.max(0, length - edgeBandBins);
        edge < length;
        edge++
      ) {
        if (
          waveform[edge] > value ||
          (waveform[edge] === value && edge > index)
        ) {
          isEdgeBandMax = false;
          break;
        }
      }
    }
    if (
      !(value >= left && value > right) &&
      !(inRightEdgeBand && isEdgeBandMax)
    ) {
      continue;
    }

    const left2 = index > 1 ? waveform[index - 2] : left;
    const right2 = index + 2 < length ? waveform[index + 2] : right;
    const immediateProminence = value - Math.max(left, right, left2, right2);
    const leftFar = index > 2 ? waveform[index - 3] : left2;
    const rightFar = index + 3 < length ? waveform[index + 3] : right2;
    const sharpness =
      value - (left + right + left2 + right2 + leftFar + rightFar) / 6;
    const start = Math.max(0, index - radius);
    const end = Math.min(length - 1, index + radius);
    let localSum = 0;
    let localCount = 0;
    let localMax = Number.NEGATIVE_INFINITY;
    let hasDominatingNeighbor = false;
    let leftValley = value;
    let rightValley = value;
    for (let neighbor = start; neighbor <= end; neighbor++) {
      const sample = waveform[neighbor];
      const distance = Math.abs(neighbor - index);
      if (
        distance <= suppressionRadius &&
        neighbor !== index &&
        (sample > value || (sample === value && neighbor > index))
      ) {
        hasDominatingNeighbor = true;
      }
      if (neighbor < index) leftValley = Math.min(leftValley, sample);
      else if (neighbor > index) rightValley = Math.min(rightValley, sample);
      if (distance > 1) {
        localSum += sample;
        localCount++;
        localMax = Math.max(localMax, sample);
      }
    }
    if (hasDominatingNeighbor || localCount === 0) continue;

    const localAverage = localSum / localCount;
    const averageProminence = value - localAverage;
    const globalFloorScore = value - globalFloor;
    const competitorGap = value - localMax;
    const valleyProminence = value - Math.max(leftValley, rightValley);
    const valley =
      valleyProminence >= 1.5 &&
      immediateProminence >= 0.15 &&
      sharpness >= 0.15;
    const cluster =
      averageProminence >= 3.5 &&
      immediateProminence >= 0.2 &&
      sharpness >= 0.3 &&
      competitorGap >= -6;
    const broad =
      averageProminence >= 4 && globalFloorScore >= 4.5 && sharpness >= 0.1;
    const global = globalFloorScore >= 4.5 && sharpness >= 0.3;
    const edge =
      (index < radius || index + radius >= length) &&
      globalFloorScore >= 3.5 &&
      sharpness >= 0.2;
    const edgeRise = value - leftValley;
    const edgeCorner = value - (left + (left - left2));
    const rightEdge =
      inRightEdgeBand &&
      isEdgeBandMax &&
      edgeRise >= 0.35 &&
      (edgeCorner >= 0.1 || immediateProminence >= 0.05);
    const average = averageProminence >= 5;
    const recovery =
      globalFloorScore >= 3 &&
      ((valleyProminence >= 1 &&
        immediateProminence >= 0.1 &&
        sharpness >= 0.1) ||
        (averageProminence >= 4 &&
          immediateProminence >= 0.1 &&
          sharpness >= 0.15));
    if (
      valley ||
      average ||
      cluster ||
      broad ||
      global ||
      edge ||
      rightEdge ||
      recovery
    ) {
      accepted.add(index);
    }
  }
  return [...accepted].sort((left, right) => left - right).slice(0, 1024);
};

const evaluateAudioEvidence = (samples: Float32Array): number => {
  if (samples.length < 8) return 0;
  let energy = 0;
  let crossings = 0;
  let previous = samples[0];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    energy += sample * sample;
    if (i > 0 && sample < 0 !== previous < 0) crossings++;
    previous = sample;
  }
  const rms = Math.sqrt(energy / samples.length);
  const crossingRate = crossings / samples.length;
  const level = clamp01(rms / 0.12);
  const nonSilent = crossingRate > 0.001 && crossingRate < 0.48 ? 1 : 0.35;
  return level * nonSilent;
};

/** Score the complete positive APT envelope without cropping its peaks/valleys. */
const evaluateAptAmplitudeEvidence = (
  samples: Float32Array,
): { score: number; plausible: boolean } => {
  if (samples.length < 16) return { score: 0, plausible: false };
  const sampled: number[] = [];
  const stride = Math.max(1, Math.ceil(samples.length / 512));
  let total = 0;
  let negativeCount = 0;
  for (let index = 0; index < samples.length; index++) {
    total += samples[index];
    if (samples[index] < 0) negativeCount++;
    if (index % stride === 0) sampled.push(samples[index]);
  }
  sampled.sort((left, right) => left - right);
  const low = sampled[Math.floor((sampled.length - 1) * 0.1)] ?? 0;
  const high = sampled[Math.floor((sampled.length - 1) * 0.9)] ?? 0;
  const mean = total / samples.length;
  const contrast = clamp01((high - low) / Math.max(high, 0.025) / 0.65);
  const level = clamp01(mean / 0.25);
  return {
    score: 0.8 * contrast + 0.2 * level,
    plausible:
      negativeCount <= samples.length * 0.01 &&
      high >= 0.12 &&
      high - low >= 0.08,
  };
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
  modulation: "am" | "fm" | "apt";
  targetSampleRateHz?: number;
}): DemodulatedAudio => {
  const algorithm: DemodAlgorithm =
    modulation === "apt" ? "aptImage" : modulation;
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
        outputRateHz = getAudioSurveyChannelizedSampleRateHz(
          inputRateHz,
          bandwidthHz,
        );
        decimation = Math.max(1, Math.round(inputRateHz / outputRateHz));
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
      for (
        let sample = firstOffset;
        sample < totalSamples;
        sample += decimation
      ) {
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
  decoderStrategy = "auto",
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
  const threshold = noiseFloor * 1.1;
  const spikeBins = detectWebGpuStyleSpectrumSpikes(power);
  const acceptedPeakBins = new Set(spikeBins);
  const binWidthHz = sampleRateHz / fftSize;
  const minimumBins = 1;
  // The observed average spike spacing is about 34 kHz. Use that only to
  // assemble a possible spike train; the walk below sets its actual bounds.
  const mergeGapBins = Math.max(
    1,
    Math.ceil(OBSERVED_SPIKE_SPACING_HZ / binWidthHz),
  );
  const candidates: AudioSurveyCandidate[] = [];
  let start = -1;
  let previousActive = -2;

  const evaluateRegion = (regionStart: number, regionEnd: number) => {
    const binCount = regionEnd - regionStart + 1;
    if (binCount < minimumBins) return;
    let initialWeightedOffset = 0;
    let initialWeightSum = 0;
    for (let bin = regionStart; bin <= regionEnd; bin++) {
      const offsetHz =
        bin <= fftSize / 2 ? bin * binWidthHz : (bin - fftSize) * binWidthHz;
      const weight = Math.max(0, power[bin] - noiseFloor);
      initialWeightedOffset += offsetHz * weight;
      initialWeightSum += weight;
    }
    const initialOffsetHz =
      initialWeightSum > 0 ? initialWeightedOffset / initialWeightSum : 0;
    const centerBin =
      ((Math.round(initialOffsetHz / binWidthHz) % fftSize) + fftSize) %
      fftSize;
    const widthWalk = walkSpectralSpikeValleys({
      power,
      startBin: regionStart,
      endBin: regionEnd,
      centerBin,
      threshold,
      binWidthHz,
      acceptedPeakBins,
    });
    const measuredStart =
      widthWalk.pairCount === undefined ? regionStart : widthWalk.startBin;
    const measuredEnd =
      widthWalk.pairCount === undefined ? regionEnd : widthWalk.endBin;
    const measuredBinCount = measuredEnd - measuredStart + 1;
    let weightedOffset = 0;
    let weightSum = 0;
    let peakPower = 0;
    for (let bin = measuredStart; bin <= measuredEnd; bin++) {
      const offsetHz =
        bin <= fftSize / 2 ? bin * binWidthHz : (bin - fftSize) * binWidthHz;
      const weight = Math.max(0, power[bin] - noiseFloor);
      weightedOffset += offsetHz * weight;
      weightSum += weight;
      peakPower = Math.max(peakPower, power[bin]);
    }
    const signedBinOffsetHz = (bin: number) =>
      bin <= fftSize / 2 ? bin * binWidthHz : (bin - fftSize) * binWidthHz;
    const offsetHz =
      widthWalk.pairCount !== undefined
        ? (signedBinOffsetHz(measuredStart) + signedBinOffsetHz(measuredEnd)) /
          2
        : weightSum > 0
          ? weightedOffset / weightSum
          : initialOffsetHz;
    const centerHz = frameCenterFrequencyHz + offsetHz;
    const measuredBandwidthHz = measuredBinCount * binWidthHz;
    const bandwidthHz =
      widthWalk.pairCount === undefined
        ? Math.max(MIN_CANDIDATE_BANDWIDTH_HZ, measuredBandwidthHz)
        : Math.max(MIN_SPIKE_WALK_BANDWIDTH_HZ, measuredBandwidthHz);
    if (
      centerHz + bandwidthHz / 2 < allowedRangeHz.min ||
      centerHz - bandwidthHz / 2 > allowedRangeHz.max
    ) {
      return;
    }

    const snrDb =
      10 * Math.log10(Math.max(peakPower, MIN_NOISE_POWER) / noiseFloor);
    const selectedBaseline =
      decoderStrategy === "apt-style" ? "apt" : decoderStrategy;
    const runAllBaselines = selectedBaseline === "auto";
    const runAm = runAllBaselines || selectedBaseline === "am";
    const runFm = runAllBaselines || selectedBaseline === "fm";
    const runApt = runAllBaselines || selectedBaseline === "apt";
    const amAudio = runAm
      ? demodulateAudioCandidate({
          iqData,
          sampleRateHz,
          frameCenterFrequencyHz,
          centerFrequencyHz: centerHz,
          bandwidthHz,
          modulation: "am",
          targetSampleRateHz,
        })
      : null;
    const fmAudio = runFm
      ? demodulateAudioCandidate({
          iqData,
          sampleRateHz,
          frameCenterFrequencyHz,
          centerFrequencyHz: centerHz,
          bandwidthHz,
          modulation: "fm",
          targetSampleRateHz,
        })
      : null;
    const aptAudio = runApt
      ? demodulateAudioCandidate({
          iqData,
          sampleRateHz,
          frameCenterFrequencyHz,
          centerFrequencyHz: centerHz,
          bandwidthHz,
          modulation: "apt",
          targetSampleRateHz,
        })
      : null;
    const aptEvidence = aptAudio
      ? evaluateAptAmplitudeEvidence(aptAudio.samples)
      : { score: 0, plausible: false };
    const modulationScores = {
      am: amAudio ? evaluateAudioEvidence(amAudio.samples) : 0,
      fm: fmAudio ? evaluateAudioEvidence(fmAudio.samples) : 0,
      apt: aptEvidence.score,
    };
    const rankedModulations = [
      ...(amAudio
        ? [
            {
              modulation: "am" as const,
              score: modulationScores.am,
              audio: amAudio,
            },
          ]
        : []),
      ...(fmAudio
        ? [
            {
              modulation: "fm" as const,
              score: modulationScores.fm,
              audio: fmAudio,
            },
          ]
        : []),
      ...(aptAudio
        ? [
            {
              modulation: "apt" as const,
              score: modulationScores.apt,
              audio: aptAudio,
            },
          ]
        : []),
    ].sort((left, right) => right.score - left.score);
    const best = rankedModulations[0];
    const secondBest = rankedModulations[1];
    const score =
      0.55 * (1 - Math.exp(-Math.max(0, snrDb - 3) / 12)) +
      0.45 * (best?.score ?? 0);
    const aptDominates =
      aptEvidence.plausible && modulationScores.apt >= (best?.score ?? 0) * 0.6;
    const modulation = runAllBaselines
      ? aptDominates
        ? "apt"
        : (best?.score ?? 0) < 0.08 ||
            (best?.score ?? 0) - (secondBest?.score ?? 0) < 0.035
          ? "unknown"
          : best!.modulation
      : selectedBaseline === "am" ||
          selectedBaseline === "fm" ||
          selectedBaseline === "apt"
        ? selectedBaseline
        : "unknown";
    const selectedAudio =
      runAllBaselines && modulation === "unknown"
        ? best?.audio
        : rankedModulations.find((item) => item.modulation === modulation)
            ?.audio;

    candidates.push({
      centerHz,
      bandwidthHz,
      ...(widthWalk.pairCount === undefined
        ? {}
        : { spikeValleyPairs: widthWalk.pairCount }),
      ...(widthWalk.spikeSpacingHz === undefined
        ? {}
        : { spikeSpacingHz: widthWalk.spikeSpacingHz }),
      snrDb,
      score,
      modulation,
      audioPcm: selectedAudio?.samples ?? new Float32Array(0),
      modulationScores,
    });
  };

  for (const bin of spikeBins) {
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

  return candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, 64);
};
