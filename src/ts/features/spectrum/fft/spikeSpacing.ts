export interface SpikeSpacingPoint {
  frequencyHz: number;
  powerDbm?: number;
  index?: number;
}

export interface SpikeSpacingAnalysis {
  spacingHz: number | null;
  toleranceHz: number | null;
  score: number;
  support: number;
  inlierCount: number;
  gapCount: number;
}

const MIN_SPACING_HZ = 12_000;
const MAX_SPACING_HZ = 80_000;
const HISTOGRAM_BIN_HZ = 2_000;
const MIN_TALL_SPIKES = 5;
const MIN_PEAK_PROMINENCE_DB = 6;
const PEAK_MAD_MULTIPLIER = 3;
const NORMAL_OFF_CADENCE_TOLERANCE = 0.4;
const INTERFERENCE_FULL_SCALE_RATIO = 0.7;
const BROAD_FLOOR_LIFT_ONSET = 0.28;
const BROAD_FLOOR_LIFT_FULL = 0.44;
const VALLEY_FILL_ONSET = 0.45;
const VALLEY_FILL_FULL = 0.9;
const FLOOR_VARIATION_ONSET_DB = 1.5;
const FLOOR_VARIATION_FULL_DB = 7.5;

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const emptySpacing = (): SpikeSpacingAnalysis => ({
  spacingHz: null,
  toleranceHz: null,
  score: 0,
  support: 0,
  inlierCount: 0,
  gapCount: 0,
});

const measureOffCadencePeakRatio = (
  frequencies: number[],
  spacingHz: number,
): number | null => {
  if (frequencies.length < MIN_TALL_SPIKES) return null;
  // Refit the local comb using adjacent gaps before measuring phase error.
  // Small frame-to-frame drift in the held cadence must not turn an otherwise
  // regular set of peaks into a false off-grid/interference report.
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
  const phases = frequencies.map((frequencyHz) => {
    const phase =
      ((frequencyHz % fittedSpacingHz) + fittedSpacingHz) % fittedSpacingHz;
    return phase;
  });
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
  // A few off-grid peaks are normal in a real comb and are not, by themselves,
  // USB-hub interference. Report only the excess beyond that tolerance.
  return Math.max(
    0,
    Math.min(
      1,
      (offCadenceRatio - NORMAL_OFF_CADENCE_TOLERANCE) /
        (INTERFERENCE_FULL_SCALE_RATIO - NORMAL_OFF_CADENCE_TOLERANCE),
    ),
  );
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
  // Tests and callers without a measured floor cannot make a truthful
  // floor-relative peak selection, so use their explicitly supplied markers.
  if (!Number.isFinite(floorDbm)) return poweredSpikes;

  const powers = poweredSpikes.map((spike) => spike.powerDbm as number);
  const robustFloor = floorDbm!;
  const medianPeakPower = median(powers);
  const powerMad = median(
    powers.map((power) => Math.abs(power - medianPeakPower)),
  );
  const minProminence = Math.max(
    MIN_PEAK_PROMINENCE_DB,
    Math.min(12, powerMad * PEAK_MAD_MULTIPLIER),
  );
  const thresholdDbm = robustFloor + minProminence;
  const tallSpikes = poweredSpikes.filter(
    (spike) => (spike.powerDbm as number) >= thresholdDbm,
  );

  // Short drawing markers are not cadence evidence. If too few tall peaks
  // remain, the caller reports no fresh spacing measurement and may hold its
  // last confirmed cadence separately.
  return tallSpikes;
};

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
 * Scores recurring peak locations over a short frame window. Empty frames are
 * retained so a fully absent signal decays naturally, while regularly pulsing
 * peaks remain present when they reappear at the same frequencies. Valley
 * contents and drawing-marker state are intentionally not inputs.
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
      for (let neighborBucket = bucket - 1; neighborBucket <= bucket + 1; neighborBucket += 1) {
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

/** Both recurring peak coverage and cadence must remain strong. */
export const measureSpikeCombPersistence = (
  spikeTrackScore: number,
  spacingScore: number,
): number => {
  if (
    !Number.isFinite(spikeTrackScore) ||
    !Number.isFinite(spacingScore)
  ) {
    return 0;
  }
  return (
    Math.max(0, Math.min(1, spikeTrackScore)) *
    Math.max(0, Math.min(1, spacingScore))
  );
};

/**
 * Distinguishes broad interference humps from a clean but toothy comb.
 * Off-cadence peaks alone are deliberately excluded: real N-APT captures can
 * contain many non-periodic teeth while their floor remains narrow and clean.
 */
export const measureInterferencePresence = (
  broadFloorFraction: number,
  valleyFillScore: number | null,
  broadFloorVariationScore: number,
): number | null => {
  if (
    !Number.isFinite(broadFloorFraction) ||
    !Number.isFinite(broadFloorVariationScore)
  ) {
    return null;
  }
  const broadFloorLiftScore = Math.max(
    0,
    Math.min(
      1,
      (broadFloorFraction - BROAD_FLOOR_LIFT_ONSET) /
        (BROAD_FLOOR_LIFT_FULL - BROAD_FLOOR_LIFT_ONSET),
    ),
  );
  const localizedValleyFillScore =
    valleyFillScore === null || !Number.isFinite(valleyFillScore)
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            (valleyFillScore - VALLEY_FILL_ONSET) /
              (VALLEY_FILL_FULL - VALLEY_FILL_ONSET),
          ),
        );
  // Require broad lift and a frequency-localized change in the floor.
  // Either cue by itself is
  // common in a clean, high-contrast comb: tall blades can raise the fraction
  // above the mean floor, and coherent bridge shoulders can raise valleys.
  const localizedFloorVariation = Math.max(
    0,
    Math.min(1, broadFloorVariationScore),
  );
  return (
    broadFloorLiftScore *
    localizedFloorVariation *
    (0.5 + localizedValleyFillScore * 0.5)
  );
};

/**
 * Measures how much the low spectral floor changes across frequency bands.
 * A lower-quartile estimate in each band ignores narrow, regularly-spaced
 * grass-blade peaks while retaining broad humps that lift the local floor.
 */
export const measureBroadFloorVariation = (
  samples: ArrayLike<number>,
): number | null => {
  const bandCount = 16;
  if (samples.length < bandCount * 8) return null;
  const bandWidth = Math.floor(samples.length / bandCount);
  const bandFloors: number[] = [];
  for (let band = 0; band < bandCount; band += 1) {
    const start = band * bandWidth;
    const end = band === bandCount - 1 ? samples.length : start + bandWidth;
    const levels: number[] = [];
    for (let index = start; index < end; index += 1) {
      const value = samples[index];
      if (Number.isFinite(value)) levels.push(value);
    }
    if (levels.length === 0) continue;
    levels.sort((left, right) => left - right);
    bandFloors.push(levels[Math.floor((levels.length - 1) * 0.2)]);
  }
  if (bandFloors.length < bandCount * 0.75) return null;
  bandFloors.sort((left, right) => left - right);
  const lowFloor = bandFloors[Math.floor((bandFloors.length - 1) * 0.1)];
  const highFloor = bandFloors[Math.floor((bandFloors.length - 1) * 0.9)];
  const spreadDb = highFloor - lowFloor;
  return Math.max(
    0,
    Math.min(
      1,
      (spreadDb - FLOOR_VARIATION_ONSET_DB) /
        (FLOOR_VARIATION_FULL_DB - FLOOR_VARIATION_ONSET_DB),
    ),
  );
};

/**
 * Scores broad humps that fill the valleys between a confirmed comb's blades.
 * The local FFT spectrum is required: peak markers alone cannot distinguish a
 * narrow spike from a wide mound with its own local maximum.
 */
export const measureSpikeValleyFill = (
  spikes: SpikeSpacingPoint[],
  floorDbm: number,
  spacingHz: number | null,
  spectrum: {
    samples: ArrayLike<number>;
    minFrequencyHz: number;
    maxFrequencyHz: number;
  },
): number | null => {
  const { samples, minFrequencyHz, maxFrequencyHz } = spectrum;
  const frequencySpanHz = maxFrequencyHz - minFrequencyHz;
  if (
    spacingHz === null ||
    !Number.isFinite(spacingHz) ||
    spacingHz <= 0 ||
    !Number.isFinite(floorDbm) ||
    samples.length < 32 ||
    !Number.isFinite(frequencySpanHz) ||
    frequencySpanHz <= spacingHz * 5
  ) {
    return null;
  }

  const phaseToleranceHz = spacingHz * 0.12;
  const spikePhases = spikes
    .filter(
      (spike) =>
        Number.isFinite(spike.frequencyHz) &&
        Number.isFinite(spike.powerDbm) &&
        spike.powerDbm! >= floorDbm + 4,
    )
    .map((spike) => {
      const offset = spike.frequencyHz - minFrequencyHz;
      return ((offset % spacingHz) + spacingHz) % spacingHz;
    });
  if (spikePhases.length < MIN_TALL_SPIKES) return null;

  let phase = spikePhases[0];
  let bestSupport = 0;
  for (const candidate of spikePhases) {
    const support = spikePhases.filter((observed) => {
      const distance = Math.abs(observed - candidate);
      return Math.min(distance, spacingHz - distance) <= phaseToleranceHz;
    }).length;
    if (support > bestSupport) {
      bestSupport = support;
      phase = candidate;
    }
  }
  if (bestSupport < MIN_TALL_SPIKES) return null;

  const binsPerHz = (samples.length - 1) / frequencySpanHz;
  const spacingBins = spacingHz * binsPerHz;
  const peakRadius = Math.max(1, Math.floor(spacingBins * 0.1));
  const valleyRadius = Math.max(1, Math.floor(spacingBins * 0.07));
  const observations: Array<{
    peakDbm: number;
    valleyDbm: number;
  } | null> = [];
  const firstCycle = Math.ceil((0 - phase) / spacingHz);
  const lastCycle = Math.floor((frequencySpanHz - phase) / spacingHz);

  const medianSamples = (center: number, radius: number) => {
    const values: number[] = [];
    for (
      let index = Math.max(0, center - radius);
      index <= Math.min(samples.length - 1, center + radius);
      index += 1
    ) {
      const value = samples[index];
      if (Number.isFinite(value)) values.push(value);
    }
    return values.length > 0 ? median(values) : Number.NaN;
  };

  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    const peakFrequencyOffset = phase + cycle * spacingHz;
    const valleyFrequencyOffset = peakFrequencyOffset + spacingHz / 2;
    if (valleyFrequencyOffset > frequencySpanHz) continue;
    const peakIndex = Math.round(peakFrequencyOffset * binsPerHz);
    const valleyIndex = Math.round(valleyFrequencyOffset * binsPerHz);
    let peakDbm = Number.NEGATIVE_INFINITY;
    for (
      let index = Math.max(0, peakIndex - peakRadius);
      index <= Math.min(samples.length - 1, peakIndex + peakRadius);
      index += 1
    ) {
      peakDbm = Math.max(peakDbm, samples[index]);
    }
    const valleyDbm = medianSamples(valleyIndex, valleyRadius);
    if (!Number.isFinite(peakDbm) || !Number.isFinite(valleyDbm)) {
      observations.push(null);
      continue;
    }
    observations.push({ peakDbm, valleyDbm });
  }

  const valleyLevels = observations
    .filter((observation): observation is NonNullable<typeof observation> =>
      observation !== null,
    )
    .map((observation) => observation.valleyDbm)
    .sort((left, right) => left - right);
  if (valleyLevels.length < 5) return null;
  // Use the lower quartile as the local clean-valley reference. A broad hump
  // can raise valleys well above that reference without requiring a fixed
  // receiver noise-floor calibration or an absolute dBm threshold.
  const floorReferenceDbm = valleyLevels[
    Math.floor((valleyLevels.length - 1) * 0.25)
  ];
  const valleyFill = observations.map((observation) => {
    if (
      observation === null ||
      observation.peakDbm < floorReferenceDbm + 5
    ) {
      return null;
    }
    const peakReliefDb = observation.peakDbm - floorReferenceDbm;
    const valleyLiftDb = Math.max(
      0,
      observation.valleyDbm - floorReferenceDbm,
    );
    return Math.max(0, Math.min(1, valleyLiftDb / peakReliefDb));
  });

  // One filled valley can be a normal side feature. Require a short run of
  // filled valleys so a broad interfering mound, rather than one stray bin,
  // raises the score.
  let strongestHumpRun = 0;
  for (let start = 0; start <= valleyFill.length - 5; start += 1) {
    const active = valleyFill
      .slice(start, start + 5)
      .filter((value): value is number => value !== null);
    if (active.length < 3) continue;
    const runScore = active.reduce((sum, value) => sum + value, 0) / active.length;
    strongestHumpRun = Math.max(strongestHumpRun, runScore);
  }
  return valleyFill.length >= 5 ? strongestHumpRun : null;
};

/**
 * Finds a repeated frequency gap from tall, floor-relative peaks.
 *
 * A pulse can make individual spikes rise and fall, so selecting only the
 * Short markers can be useful for drawing, but they should not define the
 * classifier cadence. Strong peaks are selected relative to the current
 * floor; if a pulsing frame has too few strong peaks, the prior presentation
 * state can hold the last confirmed cadence while drawing continues.
 */
export const analyzeSpikeSpacing = (
  spikes: SpikeSpacingPoint[],
  floorDbm?: number,
): SpikeSpacingAnalysis => {
  const frequencies = selectTallSpikes(spikes, floorDbm)
    .map((spike) => spike.frequencyHz)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (frequencies.length < 5) return emptySpacing();

  const gaps: number[] = [];
  for (let index = 1; index < frequencies.length; index += 1) {
    const gap = frequencies[index] - frequencies[index - 1];
    if (gap >= MIN_SPACING_HZ && gap <= MAX_SPACING_HZ) gaps.push(gap);
  }
  if (gaps.length < 4) return emptySpacing();

  const histogram = new Map<number, number>();
  for (const gap of gaps) {
    const bin = Math.round(gap / HISTOGRAM_BIN_HZ);
    histogram.set(bin, (histogram.get(bin) ?? 0) + 1);
  }
  const [modeBin, modeCount] = [...histogram.entries()].sort(
    ([leftBin, leftCount], [rightBin, rightCount]) =>
      rightCount - leftCount || leftBin - rightBin,
  )[0] ?? [0, 0];
  if (modeCount < 3) return emptySpacing();

  const modeHz = modeBin * HISTOGRAM_BIN_HZ;
  const toleranceHz = Math.max(HISTOGRAM_BIN_HZ * 2.25, modeHz * 0.12);
  const inliers = gaps.filter((gap) => Math.abs(gap - modeHz) <= toleranceHz);
  const support = inliers.length / gaps.length;
  if (inliers.length < 4 || support < 0.35) return emptySpacing();

  const spacingHz = median(inliers);
  const deviation = median(inliers.map((gap) => Math.abs(gap - spacingHz)));
  const regularity = Math.max(
    0,
    1 - deviation / Math.max(HISTOGRAM_BIN_HZ, spacingHz * 0.12),
  );
  // Raw support is intentionally separate from confidence: weak/intervening
  // peaks can dilute the adjacent-gap fraction even when the dominant cadence
  // repeats cleanly. Five or more tight observations are enough to establish
  // a high-confidence cadence; irregular fields still fail the mode-count and
  // regularity gates above.
  const cadenceSupport = Math.min(1, modeCount / 5);
  const score = Math.max(
    0,
    Math.min(1, cadenceSupport * 0.7 + regularity * 0.3),
  );
  return {
    spacingHz,
    toleranceHz,
    score,
    support,
    inlierCount: inliers.length,
    gapCount: gaps.length,
  };
};
