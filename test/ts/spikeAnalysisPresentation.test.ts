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
  aboveFloorFraction: 0.18,
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

  it("keeps recurring spike-and-spacing evidence through pulse-off frames", () => {
    const fixedSpikes = [18_000, 50_829, 83_657, 118_049, 152_441, 186_832].map(
      (frequencyHz, index) => ({ frequencyHz, powerDbm: -20, index }),
    );
    let result = null;
    for (let frame = 0; frame < 12; frame += 1) {
      result = presentSpikeAnalysis(
        {
          ...analysis,
          spikes: frame < 2 || frame % 2 === 0 ? fixedSpikes : [],
        },
        result?.classifier ?? null,
        result?.isNapt ?? false,
        -80,
        1_618_000,
      );
    }

    expect(result?.classifier.spikePresenceScore).toBeGreaterThan(0.7);
    expect(result?.analysis.spacingHz).toBeGreaterThan(32_000);
    expect(result?.analysis.spacingHz).toBeLessThan(35_000);
  });

  it("promotes a pulsing, regularly spaced comb when shape evidence is strong", () => {
    const firstCadenceFrame = presentSpikeAnalysis(
      {
        ...analysis,
        isNapt: false,
        baselineIsNapt: false,
        baselineConfidence: 0.65,
        multiFrameIsNapt: false,
        multiFrameConfidence: 0.65,
        multiFramePersistence: 1,
        multiFrameFrameCount: 8,
        sincPenaltyScore: 0.51,
        captureQualityScore: 0.48,
        spikes: [18_000, 50_829, 83_657, 118_049, 152_441, 186_832].map(
          (frequencyHz, index) => ({
            frequencyHz,
            powerDbm: -20 - (index % 3),
            index,
          }),
        ),
      },
      null,
      false,
      -80,
    );
    const result = presentSpikeAnalysis(
      {
        ...analysis,
        isNapt: false,
        baselineIsNapt: false,
        multiFrameIsNapt: false,
        multiFrameFrameCount: 8,
        multiFramePersistence: 1,
        sincPenaltyScore: 0.51,
        captureQualityScore: 0.48,
        spikes: [18_000, 50_829, 83_657, 118_049, 152_441, 186_832].map(
          (frequencyHz, index) => ({
            frequencyHz,
            powerDbm: -20 - (index % 3),
            index,
          }),
        ),
      },
      firstCadenceFrame?.classifier ?? null,
      false,
      -80,
    );

    expect(result?.isNapt).toBe(true);
    expect(result?.analysis.spacingHz).toBeGreaterThan(32_000);
    expect(result?.analysis.spacingHz).toBeLessThan(35_000);

    const jittered = presentSpikeAnalysis(
      {
        ...analysis,
        isNapt: false,
        baselineIsNapt: false,
        multiFrameIsNapt: false,
        multiFrameFrameCount: 8,
        multiFramePersistence: 1,
        spikes: [0, 30_000, 60_000, 90_000, 120_000, 150_000].map(
          (frequencyHz, index) => ({ frequencyHz, powerDbm: -25, index }),
        ),
      },
      result?.classifier ?? null,
      false,
      -80,
    );

    expect(jittered?.analysis.spacingHz).toBe(result?.analysis.spacingHz);

    const pulsedAwayAnalysis = {
      ...analysis,
      isNapt: false,
      baselineIsNapt: false,
      multiFrameIsNapt: false,
      multiFrameFrameCount: 8,
      multiFramePersistence: 1,
      sincPenaltyScore: 0.51,
      captureQualityScore: 0.48,
      spikes: [10_000, 27_000, 49_000, 78_000, 112_000].map(
        (frequencyHz, index) => ({ frequencyHz, powerDbm: -30, index }),
      ),
    };
    let pulsedAway = presentSpikeAnalysis(
      pulsedAwayAnalysis,
      result?.classifier ?? null,
      false,
      -80,
    );

    expect(pulsedAway?.analysis.spacingHz).toBe(result?.analysis.spacingHz);
    expect(pulsedAway?.isNapt).toBe(true);

    for (let frame = 0; frame < 4; frame += 1) {
      pulsedAway = presentSpikeAnalysis(
        pulsedAwayAnalysis,
        pulsedAway?.classifier ?? null,
        pulsedAway?.isNapt ?? false,
        -80,
      );
    }
    expect(pulsedAway?.analysis.spacingHz).toBe(result?.analysis.spacingHz);
    expect(pulsedAway?.isNapt).toBe(true);

    for (let frame = 0; frame < 8; frame += 1) {
      pulsedAway = presentSpikeAnalysis(
        pulsedAwayAnalysis,
        pulsedAway?.classifier ?? null,
        pulsedAway?.isNapt ?? false,
        -80,
      );
    }
    expect(pulsedAway?.analysis.spacingHz).toBeNull();
    expect(pulsedAway?.isNapt).toBe(false);
  });
});
