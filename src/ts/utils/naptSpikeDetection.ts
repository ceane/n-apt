export interface NaptSpikeCandidate {
  index: number;
  normalizedIndex: number;
  score: number;
  prominence: number;
  baseline: number;
  peak: number;
  startIndex: number;
  endIndex: number;
}

export interface NaptSpikeSegment {
  candidate: NaptSpikeCandidate;
  samples: Float32Array;
  normalizedSamples: Float32Array;
  localMean: number;
  localMedian: number;
  localNoiseFloor: number;
}

export interface NaptSpikeDetectionResult {
  candidates: NaptSpikeCandidate[];
  selectedCandidate: NaptSpikeCandidate | null;
  confidence: number;
  segmentStats: NaptSpikeSegment[];
  noiseFloor: number;
  selectedBandwidth: { min: number; max: number } | null;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const mean = (values: number[]) => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const movingAverage = (values: Float32Array, windowSize: number) => {
  const output = new Float32Array(values.length);
  const half = Math.max(1, Math.floor(windowSize / 2));
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      sum += values[j];
      count += 1;
    }
    output[i] = count > 0 ? sum / count : values[i];
  }
  return output;
};

export const normalizeSection = (samples: Float32Array) => {
  const values = Array.from(samples);
  const localMean = mean(values);
  const localMedian = median(values);
  const deviations = values.map((value) => Math.abs(value - localMedian));
  const localNoiseFloor = median(deviations) || 1e-6;
  const scale = Math.max(localNoiseFloor * 4, 1e-6);
  const normalizedSamples = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    normalizedSamples[i] = clamp01((samples[i] - localMedian) / scale);
  }

  return {
    normalizedSamples,
    localMean,
    localMedian,
    localNoiseFloor,
  };
};

export const detectNaptSpikeCandidates = (
  magnitude: Float32Array,
  options?: {
    minProminenceRatio?: number;
    minPeakDistance?: number;
    maxCandidates?: number;
  },
): NaptSpikeDetectionResult => {
  const smoothed = movingAverage(magnitude, 9);
  const values = Array.from(smoothed);
  const noiseFloor = median(values) || 1e-6;
  const mad = median(values.map((value) => Math.abs(value - noiseFloor))) || 1e-6;
  const threshold = noiseFloor + mad * (options?.minProminenceRatio ?? 2.5);
  const minPeakDistance = options?.minPeakDistance ?? Math.max(12, Math.floor(magnitude.length / 64));
  const maxCandidates = options?.maxCandidates ?? 5;

  const peaks: NaptSpikeCandidate[] = [];
  let lastPeakIndex = -minPeakDistance;

  for (let i = 1; i < values.length - 1; i++) {
    const value = values[i];
    if (value < threshold) continue;
    if (value < values[i - 1] || value < values[i + 1]) continue;
    if (i - lastPeakIndex < minPeakDistance) {
      const current = peaks[peaks.length - 1];
      if (current && value > current.peak) {
        peaks[peaks.length - 1] = {
          ...current,
          index: i,
          normalizedIndex: i / Math.max(1, values.length - 1),
          peak: value,
        };
        lastPeakIndex = i;
      }
      continue;
    }

    const localWindow = Math.max(4, Math.floor(minPeakDistance / 2));
    const left = Math.max(0, i - localWindow);
    const right = Math.min(values.length - 1, i + localWindow);
    const localBaseline = median(values.slice(left, right + 1));
    const prominence = value - localBaseline;
    const score = prominence / Math.max(mad, 1e-6);

    peaks.push({
      index: i,
      normalizedIndex: i / Math.max(1, values.length - 1),
      score,
      prominence,
      baseline: localBaseline,
      peak: value,
      startIndex: left,
      endIndex: right,
    });
    lastPeakIndex = i;
  }

  peaks.sort((a, b) => b.score - a.score || b.prominence - a.prominence);
  const candidates = peaks.slice(0, maxCandidates);
  const selectedCandidate = candidates[0] ?? null;
  const confidence = selectedCandidate
    ? clamp01(Math.min(1, selectedCandidate.score / 8) * 0.9 + Math.min(1, selectedCandidate.prominence / Math.max(noiseFloor, 1e-6)) * 0.1)
    : 0;

  const segmentStats = candidates.map((candidate) => {
    const raw = magnitude.slice(candidate.startIndex, candidate.endIndex + 1);
    const { normalizedSamples, localMean, localMedian, localNoiseFloor } =
      normalizeSection(raw);

    return {
      candidate,
      samples: raw,
      normalizedSamples,
      localMean,
      localMedian,
      localNoiseFloor,
    };
  });

  return {
    candidates,
    selectedCandidate,
    confidence,
    segmentStats,
    noiseFloor,
    selectedBandwidth: null,
  };
};

