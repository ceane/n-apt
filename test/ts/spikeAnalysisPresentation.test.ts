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

  it("does not publish the one-frame baseline as a final Yes before GPU history is ready", () => {
    const result = presentSpikeAnalysis(
      {
        ...analysis,
        baselineIsNapt: true,
        baselineConfidence: 0.99,
        multiFrameIsNapt: false,
        multiFrameFrameCount: 1,
      },
      null,
      false,
      -80,
    );

    expect(result?.isNapt).toBe(false);
  });

  it("uses GPU spacing metrics instead of re-measuring marker locations on the CPU", () => {
    const gpuAnalysis = {
      ...analysis,
      spacingHz: 27_000,
      spacingToleranceHz: 4_000,
      spacingScore: 0.92,
      spacingSupport: 0.9,
      spikes: [18_000, 53_000, 88_000, 123_000, 158_000, 193_000].map(
        (frequencyHz, index) => ({ frequencyHz, powerDbm: -20, index }),
      ),
    };
    const first = presentSpikeAnalysis(gpuAnalysis, null, false, -80);
    const second = presentSpikeAnalysis(
      gpuAnalysis,
      first?.classifier ?? null,
      false,
      -80,
    );

    expect(second?.analysis.spacingHz).toBe(27_000);
    expect(second?.classifier.spacingScore).toBeGreaterThan(0.9);
  });

  it("uses GPU valley-fill and interference metrics without rescanning the spectrum on CPU", () => {
    const gpuAnalysis = {
      ...analysis,
      spikeValleyFillScore: 0.86,
      broadFloorVariationScore: 0.91,
      interferenceScore: 0.78,
      interferenceEvidenceFrames: 5,
    };
    const result = presentSpikeAnalysis(gpuAnalysis, null, false, -80);

    expect(result?.classifier.spikeValleyFillScore).toBe(0.86);
    expect(result?.classifier.interferenceScore).toBe(0.78);
    expect(result?.classifier.interferenceEvidenceFrames).toBe(5);
    expect(result?.analysis.broadFloorVariationScore).toBe(0.91);
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
          spacingHz: frame < 2 || frame % 2 === 0 ? 33_000 : null,
          spacingToleranceHz: frame < 2 || frame % 2 === 0 ? 4_000 : null,
          spacingScore: frame < 2 || frame % 2 === 0 ? 0.92 : 0,
          spacingSupport: frame < 2 || frame % 2 === 0 ? 0.9 : 0,
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
        spacingHz: 33_000,
        spacingToleranceHz: 4_000,
        spacingScore: 0.92,
        spacingSupport: 0.9,
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
        spacingHz: 33_000,
        spacingToleranceHz: 4_000,
        spacingScore: 0.92,
        spacingSupport: 0.9,
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
    expect(pulsedAway?.analysis.spacingHz).toBe(result?.analysis.spacingHz);
    expect(pulsedAway?.classifier.tuningPersistenceArmed).toBe(true);

    for (let frame = 0; frame < 13; frame += 1) {
      pulsedAway = presentSpikeAnalysis(
        { ...pulsedAwayAnalysis, spikes: [] },
        pulsedAway?.classifier ?? null,
        pulsedAway?.isNapt ?? false,
        -80,
      );
    }
    expect(pulsedAway?.analysis.spacingHz).toBeNull();
    expect(pulsedAway?.isNapt).toBe(false);
  });

  it("does not promote a strong comb from coalescing and generic peak shape without a validated bridge", () => {
    const strongCombWithWrongShape = presentSpikeAnalysis(
      {
        ...analysis,
        isNapt: false,
        baselineIsNapt: false,
        baselineConfidence: 0.65,
        multiFrameIsNapt: false,
        multiFrameConfidence: 0.65,
        multiFrameFrameCount: 8,
        multiFramePersistence: 1,
        multiFrameBridgeScore: 0.55,
        multiFrameUDipScore: 0.95,
        multiFrameCoalescingScore: 0.95,
        suspensionBridgeScore: 0.55,
        uDipScore: 0.95,
        floorRelativePowerScore: 1,
        apexProminenceScore: 1,
        shoulderSymmetryScore: 1,
        sincPenaltyScore: 0.05,
        spikes: Array.from({ length: 16 }, (_, index) => ({
          frequencyHz: 20_000 + index * 33_000,
          powerDbm: -20,
          index,
        })),
      },
      null,
      false,
      -80,
      1_618_000,
    );

    expect(strongCombWithWrongShape?.isNapt).toBe(false);
    expect(strongCombWithWrongShape?.classifier.confidence).toBeLessThan(0.75);
  });

});
