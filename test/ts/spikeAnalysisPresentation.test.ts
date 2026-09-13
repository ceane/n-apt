import { presentSpikeAnalysis } from "@n-apt/spectrum/fft/spikeAnalysisPresentation";

const analysis = {
  isNapt: true,
  confidence: 0.9,
  baselineIsNapt: true,
  baselineConfidence: 0.9,
  multiFrameIsNapt: true,
  multiFrameConfidence: 0.9,
  multiFramePersistence: 1,
  multiFrameFrameCount: 4,
  multiFrameBridgeScore: 0.8,
  multiFrameUDipScore: 0.7,
  floorDbm: -80,
  spikes: [],
  suspensionBridgeScore: 0.8,
  clumpCount: 1,
  bridgeWidthScore: 0.8,
  bridgeShoulderScore: 0.8,
  uDipScore: 0.7,
  floorRelativePowerScore: 0.8,
  temporalStability: 0.8,
  bandwidthPrior: 0.8,
  envelopeFitScore: 0.8,
  envelopeResidualScore: 0.2,
  envelopeSupportCount: 1,
  sincPenaltyScore: 0.1,
  unimodalBridgeScore: 0.8,
  partialBridgeScore: 0.8,
  apexProminenceScore: 0.8,
  shoulderSymmetryScore: 0.8,
  captureQualityScore: 0.9,
};

describe("presentSpikeAnalysis", () => {
  it("smooths classifier and floor values while preserving hysteresis", () => {
    const result = presentSpikeAnalysis(analysis, null, false, -82);

    expect(result?.floorDbm).toBeCloseTo(-81.64);
    expect(result?.isNapt).toBe(true);
    expect(result?.analysis.captureQualityScore).toBeCloseTo(0.9);
  });

  it("ignores invalid floor readback", () => {
    expect(
      presentSpikeAnalysis({ ...analysis, floorDbm: Number.NaN }, null, false),
    ).toBeNull();
  });
});
