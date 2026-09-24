export interface SpikeSpacingPoint {
  frequencyHz: number;
  powerDbm?: number;
  index?: number;
}

const MIN_SPACING_HZ = 12_000;
const MAX_SPACING_HZ = 80_000;
const HISTOGRAM_BIN_HZ = 2_000;
const MIN_TALL_SPIKES = 5;
const MIN_PEAK_PROMINENCE_DB = 6;
const PEAK_MAD_MULTIPLIER = 3;
const NORMAL_OFF_CADENCE_TOLERANCE = 0.4;
const INTERFERENCE_FULL_SCALE_RATIO = 0.7;

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

export const selectTallSpikes = (
  spikes: SpikeSpacingPoint[],
  floorDbm?: number,
): SpikeSpacingPoint[] => {
  const poweredSpikes = spikes.filter(
    (spike) =>
      Number.isFinite(spike.frequencyHz) && Number.isFinite(spike.powerDbm),
  );
  if (poweredSpikes.length < MIN_TALL_SPIKES) return spikes;
  if (!Number.isFinite(floorDbm)) return poweredSpikes;

  const powers = poweredSpikes.map((spike) => spike.powerDbm as number);
  const medianPeakPower = median(powers);
  const powerMad = median(
    powers.map((power) => Math.abs(power - medianPeakPower)),
  );
  const minProminence = Math.max(
    MIN_PEAK_PROMINENCE_DB,
    Math.min(12, powerMad * PEAK_MAD_MULTIPLIER),
  );
  const thresholdDbm = floorDbm! + minProminence;
  return poweredSpikes.filter(
    (spike) => (spike.powerDbm as number) >= thresholdDbm,
  );
};

const measureOffCadencePeakRatio = (
  frequencies: number[],
  spacingHz: number,
): number | null => {
  if (frequencies.length < MIN_TALL_SPIKES) return null;
  const gaps = frequencies.slice(1).map((frequency, index) =>
    frequency - frequencies[index],
  );
  let fittedSpacingHz = spacingHz;
  let bestFitScore = -1;
  for (const gap of gaps) {
    for (let harmonic = 1; harmonic <= 3; harmonic += 1) {
      const candidate = gap / harmonic;
      if (
        candidate < spacingHz * 0.88 ||
        candidate > spacingHz * 1.12 ||
        candidate < MIN_SPACING_HZ ||
        candidate > MAX_SPACING_HZ
      ) {
        continue;
      }
      let inlierCount = 0;
      let directGapCount = 0;
      for (const observedGap of gaps) {
        const multiple = Math.round(observedGap / candidate);
        const error = Math.abs(observedGap - multiple * candidate);
        if (
          multiple >= 1 &&
          multiple <= 3 &&
          error <= Math.max(HISTOGRAM_BIN_HZ * 1.5, candidate * 0.08)
        ) {
          inlierCount += 1;
          if (multiple === 1) directGapCount += 1;
        }
      }
      const fitScore = inlierCount + directGapCount * 0.5;
      if (fitScore > bestFitScore) {
        bestFitScore = fitScore;
        fittedSpacingHz = candidate;
      }
    }
  }
  const phases = frequencies.map((frequencyHz) =>
    ((frequencyHz % fittedSpacingHz) + fittedSpacingHz) % fittedSpacingHz,
  );
  const inlierTolerance = Math.max(
    HISTOGRAM_BIN_HZ * 1.5,
    fittedSpacingHz * 0.12,
  );
  let bestInlierCount = 0;
  for (const phase of phases) {
    const inlierCount = phases.filter((candidate) => {
      const distance = Math.abs(candidate - phase);
      return Math.min(distance, fittedSpacingHz - distance) <= inlierTolerance;
    }).length;
    bestInlierCount = Math.max(bestInlierCount, inlierCount);
  }
  const offCadenceRatio = 1 - bestInlierCount / phases.length;
  return Math.max(
    0,
    Math.min(
      1,
      (offCadenceRatio - NORMAL_OFF_CADENCE_TOLERANCE) /
        (INTERFERENCE_FULL_SCALE_RATIO - NORMAL_OFF_CADENCE_TOLERANCE),
    ),
  );
};

/** Off-cadence teeth remain a harness diagnostic, not N-APT evidence. */
export const measureSpikeInterference = (
  spikes: SpikeSpacingPoint[],
  floorDbm: number,
  confirmedSpacingHz: number | null,
): number | null => {
  if (confirmedSpacingHz === null || !Number.isFinite(confirmedSpacingHz)) {
    return null;
  }
  const frequencies = selectTallSpikes(spikes, floorDbm)
    .map((spike) => spike.frequencyHz)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return measureOffCadencePeakRatio(frequencies, confirmedSpacingHz);
};

/**
 * Tracks recurring peak locations through pulse-off frames. This is temporal
 * presentation state; frame-local cadence, valley-fill, and interference
 * measurements are computed in napt_classify.wgsl.
 */
export const measureSpikeTrackPersistence = (
  frames: number[][],
  toleranceHz: number,
  minimumTrackCount = 6,
): number => {
  if (
    frames.length < 3 ||
    !Number.isFinite(toleranceHz) ||
    toleranceHz <= 0 ||
    minimumTrackCount <= 0
  ) {
    return 0;
  }
  const requiredFrames = Math.max(2, Math.ceil(frames.length / 2));
  const tracks: Array<{ centerHz: number; frameIndices: Set<number> }> = [];
  const trackBuckets = new Map<number, number[]>();
  for (const [frameIndex, frame] of frames.entries()) {
    const frameFrequencies = [...new Set(frame.filter(Number.isFinite))].sort(
      (left, right) => left - right,
    );
    const matchedTracks = new Set<number>();
    for (const frequencyHz of frameFrequencies) {
      let bestTrackIndex = -1;
      let bestDistance = toleranceHz;
      const bucket = Math.round(frequencyHz / toleranceHz);
      for (
        let neighborBucket = bucket - 1;
        neighborBucket <= bucket + 1;
        neighborBucket += 1
      ) {
        for (const trackIndex of trackBuckets.get(neighborBucket) ?? []) {
          if (matchedTracks.has(trackIndex)) continue;
          const distance = Math.abs(frequencyHz - tracks[trackIndex].centerHz);
          if (distance <= bestDistance) {
            bestDistance = distance;
            bestTrackIndex = trackIndex;
          }
        }
      }
      if (bestTrackIndex < 0) {
        const trackIndex = tracks.length;
        tracks.push({
          centerHz: frequencyHz,
          frameIndices: new Set([frameIndex]),
        });
        const bucketTracks = trackBuckets.get(bucket) ?? [];
        bucketTracks.push(trackIndex);
        trackBuckets.set(bucket, bucketTracks);
        matchedTracks.add(trackIndex);
      } else {
        const track = tracks[bestTrackIndex];
        const priorObservations = track.frameIndices.size;
        track.centerHz =
          (track.centerHz * priorObservations + frequencyHz) /
          (priorObservations + 1);
        track.frameIndices.add(frameIndex);
        matchedTracks.add(bestTrackIndex);
      }
    }
  }
  const persistentTrackCount = tracks.filter(
    (track) => track.frameIndices.size >= requiredFrames,
  ).length;
  return Math.min(1, persistentTrackCount / minimumTrackCount);
};

/** Both recurring peak coverage and GPU cadence must remain strong. */
export const measureSpikeCombPersistence = (
  spikeTrackScore: number,
  spacingScore: number,
): number => {
  if (!Number.isFinite(spikeTrackScore) || !Number.isFinite(spacingScore)) {
    return 0;
  }
  return (
    Math.max(0, Math.min(1, spikeTrackScore)) *
    Math.max(0, Math.min(1, spacingScore))
  );
};
