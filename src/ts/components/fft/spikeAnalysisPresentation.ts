import type { SpikeAnalysis } from "@n-apt/hooks/useDrawWebGPUFFTSignal";

export interface StableSpikeClassifier {
  confidence: number;
  suspensionBridgeScore: number;
  uDipScore: number;
  floorRelativePowerScore: number;
  sincPenaltyScore: number;
  captureQualityScore: number;
  envelopeFitScore: number;
  envelopeResidualScore: number;
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
): SpikeAnalysisPresentation | null {
  if (!Number.isFinite(analysis.floorDbm)) return null;
  const floorDbm =
    previousFloorDbm === null
      ? analysis.floorDbm
      : previousFloorDbm + (analysis.floorDbm - previousFloorDbm) * 0.18;
  const smooth = (value: number, previous: number | undefined) =>
    previous === undefined ? value : previous + (value - previous) * 0.12;
  const temporalReady = analysis.multiFrameFrameCount >= 4;
  const sincPenaltyScore = smooth(
    analysis.sincPenaltyScore,
    previousClassifier?.sincPenaltyScore,
  );
  const classifier: StableSpikeClassifier = {
    confidence: smooth(analysis.confidence, previousClassifier?.confidence),
    suspensionBridgeScore: smooth(
      temporalReady
        ? analysis.multiFrameBridgeScore
        : analysis.suspensionBridgeScore,
      previousClassifier?.suspensionBridgeScore,
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
  };
  const rawDecision = temporalReady
    ? analysis.multiFrameIsNapt
    : analysis.baselineIsNapt;
  const isNapt =
    rawDecision &&
    (wasNapt ? classifier.confidence >= 0.55 : classifier.confidence >= 0.75);

  return {
    floorDbm,
    classifier,
    isNapt,
    analysis: { ...analysis, ...classifier, floorDbm, isNapt },
  };
}
