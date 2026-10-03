import type { SpikeAnalysis } from "@n-apt/spectrum/hooks/useDrawWebGPUFFTSignal";
import {
  measureSpikeCombPersistence,
  measureSpikeTrackPersistence,
  selectTallSpikes,
} from "@n-apt/spectrum/fft/spikeSpacing";

const SPACING_HOLD_FRAMES = 8;
const SPACING_SWITCH_CONFIRMATIONS = 3;
const SPACING_STABILITY_FRAMES = 12;
const FLOOR_STABILITY_SMOOTHING = 0.12;
const TUNING_PERSISTENCE_HOLD_FRAMES = 12;
// Verdict bands: below 50% is No, 50-74% is Likely, and 75%+ is Yes.
// Keep every positive rescue and hysteresis path on this same boundary.
const YES_CONFIDENCE_THRESHOLD = 0.75;
// The primary evidence combines bridge geometry, U-dip, floor-relative power,
// and spike cadence equally. The GPU temporal score is a smaller cross-check;
// recurrent Coherence / Truncation is a tiny positive-only term, never a
// penalty when the signal is temporarily at a poor alignment angle.
const PRIMARY_FEATURE_WEIGHT = 0.22;
const CORE_CONFIDENCE_WEIGHT = 0.1;
const COALESCING_CONFIDENCE_WEIGHT = 0.02;
const MIN_VALIDATED_BRIDGE_SCORE = 0.7;

const scoreRepeatedSpacing = (frameScore: number, stableFrames: number) => {
  const temporalSupport =
    (Math.min(SPACING_STABILITY_FRAMES, stableFrames) /
      SPACING_STABILITY_FRAMES) *
    0.85;
  return frameScore + (1 - frameScore) * temporalSupport;
};

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

export interface StableSpikeClassifier {
  confidence: number;
  suspensionBridgeScore: number;
  unimodalBridgeScore: number;
  partialBridgeScore: number;
  apexProminenceScore: number;
  shoulderSymmetryScore: number;
  coalescingScore: number;
  uDipScore: number;
  floorRelativePowerScore: number;
  sincPenaltyScore: number;
  captureQualityScore: number;
  envelopeFitScore: number;
  envelopeResidualScore: number;
  tuningPersistence: number;
  tuningPersistenceArmed: boolean;
  tuningPersistenceMissingFrames: number;
  spacingScore: number;
  spacingHz: number | null;
  spacingToleranceHz: number | null;
  spacingSupport: number;
  spacingMissingFrames: number;
  spacingPendingHz: number | null;
  spacingPendingFrames: number;
  spacingStableFrames: number;
  spacingCenterFrequencyHz: number | null;
  floorStabilityScore: number | null;
  floorStabilityFrames: number;
  spikeValleyFillScore: number | null;
  interferenceScore: number | null;
  interferenceEvidenceFrames: number;
  interferenceMissingFrames: number;
  spikePresenceHistory: number[][];
  spikePresenceScore: number;
}

export interface SpikeAnalysisPresentation {
  floorDbm: number;
  classifier: StableSpikeClassifier;
  isNapt: boolean;
  analysis: SpikeAnalysis & StableSpikeClassifier;
}

export function presentSpikeAnalysis(
  analysis: SpikeAnalysis,
  previousClassifier: StableSpikeClassifier | null,
  wasNapt: boolean,
  previousFloorDbm: number | null = null,
  centerFrequencyHz: number | null = null,
  spectrum?: {
    samples: ArrayLike<number>;
    minFrequencyHz: number;
    maxFrequencyHz: number;
  },
): SpikeAnalysisPresentation | null {
  if (!Number.isFinite(analysis.floorDbm)) return null;
  // Spacing is measured from the GPU's finalized frame metrics. This layer
  // retains and stabilizes the cadence across pulse-off frames, but does not
  // independently reclassify marker gaps on the CPU.
  const measuredSpacingHz =
    analysis.spacingHz !== null &&
    analysis.spacingHz !== undefined &&
    Number.isFinite(analysis.spacingHz) &&
    analysis.spacingHz > 0
      ? analysis.spacingHz
      : null;
  const spacing = {
    spacingHz: measuredSpacingHz,
    toleranceHz:
      analysis.spacingToleranceHz !== null &&
      analysis.spacingToleranceHz !== undefined &&
      Number.isFinite(analysis.spacingToleranceHz) &&
      analysis.spacingToleranceHz > 0
        ? analysis.spacingToleranceHz
        : null,
    score: Number.isFinite(analysis.spacingScore)
      ? analysis.spacingScore ?? 0
      : 0,
    support: Number.isFinite(analysis.spacingSupport)
      ? analysis.spacingSupport ?? 0
      : 0,
  };
  const centerFrequencyChanged =
    centerFrequencyHz !== null &&
    previousClassifier?.spacingCenterFrequencyHz !== null &&
    previousClassifier?.spacingCenterFrequencyHz !== undefined &&
    previousClassifier.spacingCenterFrequencyHz !== centerFrequencyHz;
  const previousSpacingHz = centerFrequencyChanged
    ? null
    : (previousClassifier?.spacingHz ?? null);
  let spacingHz = previousSpacingHz;
  let spacingToleranceHz = centerFrequencyChanged
    ? null
    : (previousClassifier?.spacingToleranceHz ?? null);
  let spacingSupport = centerFrequencyChanged
    ? 0
    : (previousClassifier?.spacingSupport ?? 0);
  let spacingScore = centerFrequencyChanged
    ? 0
    : (previousClassifier?.spacingScore ?? 0);
  let spacingMissingFrames = centerFrequencyChanged
    ? 0
    : (previousClassifier?.spacingMissingFrames ?? 0);
  let spacingPendingHz = centerFrequencyChanged
    ? null
    : (previousClassifier?.spacingPendingHz ?? null);
  let spacingPendingFrames = centerFrequencyChanged
    ? 0
    : (previousClassifier?.spacingPendingFrames ?? 0);
  let spacingStableFrames = centerFrequencyChanged
    ? 0
    : (previousClassifier?.spacingStableFrames ?? 0);
  if (spacing.spacingHz === null) {
    spacingMissingFrames += 1;
    spacingPendingHz = null;
    spacingPendingFrames = 0;
    if (spacingHz === null) {
      spacingHz = null;
      spacingToleranceHz = null;
      spacingSupport = 0;
      spacingScore = 0;
    }
  } else if (spacingHz === null) {
    // Do not publish the first frame-local mode. Require it to repeat once so
    // a transient gap histogram cannot become the displayed cadence.
    const pendingTolerance = Math.max(
      spacing.toleranceHz ?? 0,
      spacing.spacingHz * 0.12,
    );
    if (
      spacingPendingHz !== null &&
      Math.abs(spacing.spacingHz - spacingPendingHz) <= pendingTolerance
    ) {
      spacingPendingFrames += 1;
      if (spacingPendingFrames >= 2) {
        spacingHz = (spacing.spacingHz + spacingPendingHz) / 2;
        spacingToleranceHz = spacing.toleranceHz;
        spacingSupport = spacing.support;
        spacingStableFrames = spacingPendingFrames;
        spacingScore = scoreRepeatedSpacing(spacing.score, spacingStableFrames);
        spacingPendingHz = null;
        spacingPendingFrames = 0;
        spacingMissingFrames = 0;
      }
    } else {
      spacingPendingHz = spacing.spacingHz;
      spacingPendingFrames = 1;
    }
  } else {
    const stableTolerance = Math.max(2_000, spacingHz * 0.08);
    if (Math.abs(spacing.spacingHz - spacingHz) <= stableTolerance) {
      // Follow small measurement changes slowly; the cadence must not jump
      // when one pulse changes which adjacent markers are visible.
      spacingHz += (spacing.spacingHz - spacingHz) * 0.2;
      spacingToleranceHz = spacing.toleranceHz;
      spacingSupport = spacing.support;
      spacingStableFrames = Math.min(
        SPACING_STABILITY_FRAMES,
        spacingStableFrames + 1,
      );
      spacingScore = scoreRepeatedSpacing(spacing.score, spacingStableFrames);
      spacingMissingFrames = 0;
      spacingPendingHz = null;
      spacingPendingFrames = 0;
    } else {
      spacingMissingFrames += 1;
      const pendingTolerance = Math.max(
        spacing.toleranceHz ?? 0,
        spacing.spacingHz * 0.12,
      );
      if (
        spacingPendingHz !== null &&
        Math.abs(spacing.spacingHz - spacingPendingHz) <= pendingTolerance
      ) {
        spacingPendingFrames += 1;
      } else {
        spacingPendingHz = spacing.spacingHz;
        spacingPendingFrames = 1;
      }
      if (spacingPendingFrames >= SPACING_SWITCH_CONFIRMATIONS) {
        spacingHz = spacing.spacingHz;
        spacingToleranceHz = spacing.toleranceHz;
        spacingSupport = spacing.support;
        spacingStableFrames = spacingPendingFrames;
        spacingScore = scoreRepeatedSpacing(spacing.score, spacingStableFrames);
        spacingMissingFrames = 0;
        spacingPendingHz = null;
        spacingPendingFrames = 0;
      }
    }
  }
  // Use the retained, same-acquisition cadence rather than a provisional
  // per-frame histogram mode. This is only a secondary interference cue;
  // stable floor and clean bridge geometry carry the main evidence.
  const sameAcquisitionCenter =
    centerFrequencyHz !== null &&
    previousClassifier?.spacingCenterFrequencyHz === centerFrequencyHz &&
    !centerFrequencyChanged;
  const floorStepDb =
    previousFloorDbm === null
      ? null
      : Math.abs(analysis.floorDbm - previousFloorDbm);
  const measuredFloorStability =
    floorStepDb === null
      ? null
      : Math.max(0, Math.min(1, 1 - Math.max(0, floorStepDb - 5) / 10));
  let floorStabilityFrames = sameAcquisitionCenter
    ? (previousClassifier?.floorStabilityFrames ?? 0)
    : 0;
  let floorStabilityScore = sameAcquisitionCenter
    ? (previousClassifier?.floorStabilityScore ?? null)
    : null;
  if (measuredFloorStability !== null && sameAcquisitionCenter) {
    floorStabilityFrames += 1;
    floorStabilityScore =
      floorStabilityScore === null
        ? measuredFloorStability
        : floorStabilityScore +
          (measuredFloorStability - floorStabilityScore) *
            FLOOR_STABILITY_SMOOTHING;
  }
  const temporalReady = analysis.multiFrameFrameCount >= 4;
  const priorSpikePresenceHistory = centerFrequencyChanged
    ? []
    : (previousClassifier?.spikePresenceHistory ?? []);
  const spikePresenceHistory = [
    ...priorSpikePresenceHistory,
    selectTallSpikes(analysis.spikes, analysis.floorDbm).map(
      (spike) => spike.frequencyHz,
    ),
  ].slice(-8);
  const spikePresenceToleranceHz = Math.max(
    2_000,
    spectrum
      ? ((spectrum.maxFrequencyHz - spectrum.minFrequencyHz) /
          spectrum.samples.length) *
          1.5
      : 2_000,
  );
  const spikeTrackPersistenceScore = measureSpikeTrackPersistence(
    spikePresenceHistory,
    spikePresenceToleranceHz,
  );
  const hasConfirmedSpacing =
    spacingHz !== null && spacingStableFrames >= 3;
  const spikePresenceScore = hasConfirmedSpacing
    ? measureSpikeCombPersistence(
        spikeTrackPersistenceScore,
        spacingScore,
      )
    : 0;
  const shapeBridgeScore = temporalReady
    ? analysis.multiFrameBridgeScore
    : analysis.suspensionBridgeScore;
  const shapeApexScore = temporalReady
    ? (analysis.multiFrameApexProminenceScore ?? analysis.apexProminenceScore)
    : analysis.apexProminenceScore;
  const shapeShoulderScore = temporalReady
    ? (analysis.multiFrameShoulderSymmetryScore ??
      analysis.shoulderSymmetryScore)
    : analysis.shoulderSymmetryScore;
  // Per-frame valley-fill and broad-floor evidence are computed by the GPU
  // classifier. This layer only stabilizes those frame-local outputs.
  const spikeValleyFillScore = Number.isFinite(analysis.spikeValleyFillScore)
    ? analysis.spikeValleyFillScore ?? null
    : null;
  const measuredInterferenceScore = Number.isFinite(analysis.interferenceScore)
    ? analysis.interferenceScore ?? null
    : null;
  // Interference confirmation and clearing are performed by the GPU temporal
  // pass. Do not smooth this score again on the CPU or reintroduce stale holds.
  const interferenceScore = measuredInterferenceScore;
  const interferenceEvidenceFrames = analysis.interferenceEvidenceFrames ?? 0;
  const interferenceMissingFrames = analysis.interferenceMissingFrames ?? 0;
  const floorDbm =
    previousFloorDbm === null
      ? analysis.floorDbm
      : previousFloorDbm + (analysis.floorDbm - previousFloorDbm) * 0.18;
  const smooth = (value: number, previous: number | undefined) =>
    previous === undefined ? value : previous + (value - previous) * 0.12;
  const coalescingEvidence = temporalReady
    ? (analysis.multiFrameCoalescingScore ?? 0)
    : 0;
  const spikePowers = analysis.spikes
    .map((spike) => spike.powerDbm)
    .filter(Number.isFinite);
  const medianSpikePower = median(spikePowers);
  const spikePowerMad = median(
    spikePowers.map((power) => Math.abs(power - medianSpikePower)),
  );
  const floorMarginDb = Math.max(4, Math.min(8, spikePowerMad * 0.75));
  const floorClearedSpikeCount = analysis.spikes.filter(
    (spike) =>
      Number.isFinite(spike.powerDbm) &&
      spike.powerDbm - analysis.floorDbm >= floorMarginDb,
  ).length;
  const primaryEvidence = [
    temporalReady
      ? analysis.multiFrameBridgeScore
      : analysis.suspensionBridgeScore,
    temporalReady
      ? analysis.multiFrameUDipScore
      : analysis.uDipScore,
    analysis.floorRelativePowerScore,
    ...(hasConfirmedSpacing ? [spikePresenceScore] : []),
    ...(spacingHz !== null ? [spacingScore] : []),
  ];
  const coalescingIsAvailable = coalescingEvidence >= 0.2;
  const confidenceWeight =
    primaryEvidence.length * PRIMARY_FEATURE_WEIGHT +
    CORE_CONFIDENCE_WEIGHT +
    (coalescingIsAvailable ? COALESCING_CONFIDENCE_WEIGHT : 0);
  const fusedConfidence =
    (primaryEvidence.reduce(
      (sum, value) => sum + value * PRIMARY_FEATURE_WEIGHT,
      0,
    ) +
      analysis.confidence * CORE_CONFIDENCE_WEIGHT +
      (coalescingIsAvailable
        ? coalescingEvidence * COALESCING_CONFIDENCE_WEIGHT
        : 0)) /
    confidenceWeight;
  // Peak prominence and shoulder symmetry describe individual teeth. They
  // cannot substitute for connected bridge morphology in a regularly spaced
  // but malformed Mock comb.
  const characteristicShapeScore = temporalReady
    ? analysis.multiFrameBridgeScore
    : analysis.suspensionBridgeScore;
  const validatedBridgeShape =
    characteristicShapeScore >= MIN_VALIDATED_BRIDGE_SCORE;
  const combPersistenceScore = Math.max(
    analysis.multiFramePersistence,
    analysis.temporalStability,
  );
  const repeatedCombConfidence =
    (analysis.floorRelativePowerScore +
      spacingScore +
      combPersistenceScore +
      characteristicShapeScore) /
    4;
  // A clean bridge can be partially coalesced at a poor tuning/sample-rate
  // angle. Strong floor-relative peaks, a repeatedly confirmed cadence, and
  // persistent curved/bridged morphology together are sufficient positive
  // evidence even when the frame-local U-dip or full-bridge score is weak.
  const repeatedStrongComb =
    temporalReady &&
    analysis.spikes.length >= 12 &&
    floorClearedSpikeCount >= 5 &&
    analysis.floorRelativePowerScore >= 0.85 &&
    spacingHz !== null &&
    spacingScore >= 0.7 &&
    spacingSupport >= 0.35 &&
    spacingStableFrames >= 4 &&
    spacingMissingFrames <= SPACING_HOLD_FRAMES &&
    combPersistenceScore >= 0.7 &&
    validatedBridgeShape &&
    analysis.sincPenaltyScore <= 0.7;
  const sincPenaltyScore = smooth(
    temporalReady
      ? (analysis.multiFrameSincPenaltyScore ?? analysis.sincPenaltyScore)
      : analysis.sincPenaltyScore,
    previousClassifier?.sincPenaltyScore,
  );
  const classifier: StableSpikeClassifier = {
    confidence: Math.max(
      smooth(fusedConfidence, previousClassifier?.confidence),
      repeatedStrongComb ? repeatedCombConfidence : 0,
    ),
    suspensionBridgeScore: smooth(
      temporalReady
        ? analysis.multiFrameBridgeScore
        : analysis.suspensionBridgeScore,
      previousClassifier?.suspensionBridgeScore,
    ),
    unimodalBridgeScore: smooth(
      temporalReady
        ? (analysis.multiFrameUnimodalBridgeScore ??
            analysis.unimodalBridgeScore)
        : analysis.unimodalBridgeScore,
      previousClassifier?.unimodalBridgeScore,
    ),
    partialBridgeScore: smooth(
      temporalReady
        ? (analysis.multiFramePartialBridgeScore ?? analysis.partialBridgeScore)
        : analysis.partialBridgeScore,
      previousClassifier?.partialBridgeScore,
    ),
    apexProminenceScore: smooth(
      temporalReady
        ? (analysis.multiFrameApexProminenceScore ??
            analysis.apexProminenceScore)
        : analysis.apexProminenceScore,
      previousClassifier?.apexProminenceScore,
    ),
    shoulderSymmetryScore: smooth(
      temporalReady
        ? (analysis.multiFrameShoulderSymmetryScore ??
            analysis.shoulderSymmetryScore)
        : analysis.shoulderSymmetryScore,
      previousClassifier?.shoulderSymmetryScore,
    ),
    coalescingScore: smooth(
      temporalReady ? (analysis.multiFrameCoalescingScore ?? 0) : 0,
      previousClassifier?.coalescingScore,
    ),
    uDipScore: smooth(
      temporalReady ? analysis.multiFrameUDipScore : analysis.uDipScore,
      previousClassifier?.uDipScore,
    ),
    floorRelativePowerScore: smooth(
      analysis.floorRelativePowerScore,
      previousClassifier?.floorRelativePowerScore,
    ),
    sincPenaltyScore,
    captureQualityScore: Math.max(0, Math.min(1, 1 - sincPenaltyScore)),
    envelopeFitScore: smooth(
      analysis.envelopeFitScore,
      previousClassifier?.envelopeFitScore,
    ),
    envelopeResidualScore: smooth(
      analysis.envelopeResidualScore,
      previousClassifier?.envelopeResidualScore,
    ),
    tuningPersistence: previousClassifier?.tuningPersistence ?? 0,
    tuningPersistenceArmed: previousClassifier?.tuningPersistenceArmed ?? false,
    tuningPersistenceMissingFrames:
      previousClassifier?.tuningPersistenceMissingFrames ?? 0,
    spacingScore,
    spacingHz,
    spacingToleranceHz,
    spacingSupport,
    spacingMissingFrames,
    spacingPendingHz,
    spacingPendingFrames,
    spacingStableFrames,
    spacingCenterFrequencyHz:
      centerFrequencyHz ??
      previousClassifier?.spacingCenterFrequencyHz ??
      null,
    floorStabilityScore,
    floorStabilityFrames,
    spikeValleyFillScore,
    interferenceScore,
    interferenceEvidenceFrames,
    interferenceMissingFrames,
    spikePresenceHistory,
    spikePresenceScore,
  };
  // The one-frame baseline is diagnostic only. The final UI verdict waits for
  // the GPU history window so a baseline-only pulse cannot flash Yes.
  const rawDecision = temporalReady && analysis.multiFrameIsNapt;
  if (!rawDecision && !validatedBridgeShape) {
    // Keep a negative structural decision out of the Yes band even when
    // cadence, power, coalescing, or generic peak-shape diagnostics saturate.
    classifier.confidence = Math.min(classifier.confidence, 0.49);
  }
  // A pulsing N-APT comb can retain its frequency cadence while individual
  // spikes rise and fall between frames. When the GPU decision is held back by
  // the artifact penalty, promote only if the cadence is well-supported and
  // the independent bridge/U evidence is already strong.
  const spacingRescue =
    !rawDecision &&
    temporalReady &&
    validatedBridgeShape &&
    spacingScore >= 0.55 &&
    spacingSupport >= 0.5 &&
    spacingHz !== null &&
    spacingMissingFrames <= SPACING_HOLD_FRAMES &&
    classifier.suspensionBridgeScore >= 0.7 &&
    classifier.uDipScore >= 0.65 &&
    classifier.captureQualityScore >= 0.35 &&
    classifier.sincPenaltyScore <= 0.65;
  // Coalescing is a positive-only path for recurrent partial bridges. It
  // bridges short tuning/sample-rate alignment gaps, but cannot override weak
  // floor-relative power, weak bridge geometry, or sinc artifacts.
  // This gate intentionally uses fresh temporal evidence and relative shape
  // metrics only; it must not favor Channel A/B or any absolute RF location.
  const coalescingRescue =
    !rawDecision &&
    validatedBridgeShape &&
    temporalReady &&
    (analysis.multiFrameCoalescingScore ?? 0) >= 0.72 &&
    classifier.floorRelativePowerScore >= 0.7 &&
    classifier.apexProminenceScore >= 0.65 &&
    classifier.shoulderSymmetryScore >= 0.65 &&
    classifier.sincPenaltyScore <= 0.45;
  // All positive paths, including a prior-Yes frame, require the same
  // confidence. Hysteresis stabilizes the measurements; it must not lower
  // the evidence needed to report Yes.
  const positiveCandidate =
    (rawDecision || spacingRescue || coalescingRescue || repeatedStrongComb) &&
    classifier.confidence >= YES_CONFIDENCE_THRESHOLD;
  const classifierDecision = positiveCandidate;
  const priorFloorPowerScore =
    previousClassifier?.floorRelativePowerScore ??
    analysis.floorRelativePowerScore;
  const floorPowerThreshold = Math.max(
    0.35,
    Math.min(0.6, priorFloorPowerScore * 0.5),
  );
  const tuningSignalQualifies =
    analysis.spikes.length >= 4 &&
    floorClearedSpikeCount >= 4 &&
    analysis.floorRelativePowerScore >= floorPowerThreshold;
  const previousTuningArmed =
    previousClassifier?.tuningPersistenceArmed ?? false;
  const previousTuningMissingFrames =
    previousClassifier?.tuningPersistenceMissingFrames ?? 0;
  let tuningPersistence = 0;
  let tuningPersistenceMissingFrames = 0;
  let tuningPersistenceArmed = false;

  if (classifierDecision && tuningSignalQualifies) {
    tuningPersistence = 1;
    tuningPersistenceArmed = true;
  } else if (
    previousTuningArmed &&
    tuningSignalQualifies
  ) {
    tuningPersistenceMissingFrames = previousTuningMissingFrames + 1;
    tuningPersistence = Math.max(
      0,
      1 - tuningPersistenceMissingFrames / TUNING_PERSISTENCE_HOLD_FRAMES,
    );
    tuningPersistenceArmed =
      tuningPersistenceMissingFrames < TUNING_PERSISTENCE_HOLD_FRAMES;
  }

  classifier.tuningPersistence = tuningPersistence;
  classifier.tuningPersistenceArmed = tuningPersistenceArmed;
  classifier.tuningPersistenceMissingFrames = tuningPersistenceMissingFrames;
  const tuningHold =
    previousTuningArmed &&
    wasNapt &&
    tuningPersistenceArmed &&
    tuningPersistenceMissingFrames > 0 &&
    classifier.confidence >= YES_CONFIDENCE_THRESHOLD;
  const isNapt = classifierDecision || tuningHold;

  // The displayed cadence can ride through pulsing peaks while tuning
  // persistence still confirms that the floor-relative signal is present.
  // Once that evidence expires, allow the normal short spacing hold to clear.
  if (
    spacing.spacingHz === null &&
    spacingMissingFrames > SPACING_HOLD_FRAMES &&
    !tuningPersistenceArmed
  ) {
    spacingHz = null;
    spacingToleranceHz = null;
    spacingSupport = 0;
    spacingScore = 0;
    spacingStableFrames = 0;
  }

  return {
    floorDbm,
    classifier,
    isNapt,
    analysis: {
      ...analysis,
      ...classifier,
      floorDbm,
      isNapt,
      spacingHz,
      spacingToleranceHz,
      spacingSupport,
    },
  };
}
