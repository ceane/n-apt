import {
  analyzeSpikeSpacing,
  measureBroadFloorVariation,
  measureSpikeCombPersistence,
  measureInterferencePresence,
  measureSpikeValleyFill,
  measureSpikeTrackPersistence,
} from "@n-apt/spectrum/fft/spikeSpacing";

describe("analyzeSpikeSpacing", () => {
  it("finds a dominant approximately 33 kHz cadence despite extra peaks", () => {
    const frequencies = [
      18_000, 50_829, 83_657, 118_049, 152_441, 186_832, 221_224, 254_053,
      288_445, 322_836, 357_228, 390_057, 424_448, 458_840, 493_232, 527_624,
      560_452, 594_844, 629_236, 663_628, 698_020, 730_848, 751_171, 765_240,
      785_562, 834_023, 876_232,
    ];

    const result = analyzeSpikeSpacing(
      frequencies.map((frequencyHz, index) => ({
        frequencyHz,
        powerDbm: -20 - (index % 4),
        index,
      })),
    );

    expect(result.spacingHz).toBeGreaterThan(32_000);
    expect(result.spacingHz).toBeLessThan(35_000);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.support).toBeGreaterThan(0.5);
  });

  it("does not call an irregular spike field regularly spaced", () => {
    const result = analyzeSpikeSpacing(
      [
        10_000, 27_000, 49_000, 78_000, 112_000, 151_000, 197_000, 250_000,
        311_000,
      ].map((frequencyHz, index) => ({
        frequencyHz,
        powerDbm: -30,
        index,
      })),
    );

    expect(result.spacingHz).toBeNull();
    expect(result.score).toBe(0);
    expect(result.support).toBe(0);
  });

  it("measures cadence from tall peaks while ignoring short drawing dots", () => {
    const tallCadence = [
      18_000, 51_000, 84_000, 117_000, 150_000, 183_000, 216_000,
    ];
    const shortDots = Array.from(
      { length: 24 },
      (_, index) => 25_000 + index * 8_000,
    );
    const spikes = [...tallCadence, ...shortDots]
      .sort((left, right) => left - right)
      .map((frequencyHz, index) => ({
        frequencyHz,
        powerDbm: tallCadence.includes(frequencyHz) ? -12 : -35,
        index,
      }));

    const result = analyzeSpikeSpacing(spikes, -37);

    expect(result.spacingHz).toBeGreaterThan(32_000);
    expect(result.spacingHz).toBeLessThan(34_000);
    expect(result.score).toBeGreaterThan(0.9);
  });
});

describe("measureBroadFloorVariation", () => {
  const makeSpectrum = (raisedRange?: [number, number]) => {
    const samples = new Float32Array(1024).fill(-80);
    for (let index = 12; index < samples.length; index += 21) {
      samples[index] = -42;
      samples[index - 1] = -58;
      samples[index + 1] = -58;
    }
    if (raisedRange) {
      for (let index = raisedRange[0]; index < raisedRange[1]; index += 1) {
        samples[index] = Math.max(samples[index], -70);
      }
    }
    return samples;
  };

  it("ignores narrow, regularly repeated spike blades over a stable floor", () => {
    expect(measureBroadFloorVariation(makeSpectrum())).toBe(0);
  });

  it("detects a frequency-localized broad hump above the clean floor", () => {
    expect(measureBroadFloorVariation(makeSpectrum([320, 704]))).toBeGreaterThan(0.8);
  });
});

describe("measureSpikeTrackPersistence", () => {
  it("retains recurring fixed spikes through pulse-off frames", () => {
    const fixedSpikes = [100_000, 133_000, 166_000, 199_000, 232_000, 265_000];
    const frames = [
      fixedSpikes,
      [],
      fixedSpikes.map((frequency) => frequency + 800),
      [],
      fixedSpikes,
      [],
      fixedSpikes.map((frequency) => frequency - 600),
      [],
    ];

    expect(measureSpikeTrackPersistence(frames, 2_000)).toBe(1);
  });

  it("decays to absent when no spike tracks recur in the window", () => {
    expect(measureSpikeTrackPersistence(Array.from({ length: 8 }, () => []), 2_000)).toBe(0);
  });

  it("does not mark one-frame random teeth as persistent spikes", () => {
    const frames = Array.from({ length: 8 }, (_, frameIndex) =>
      frameIndex === 3
        ? [101_000, 137_000, 171_000, 209_000, 246_000]
        : [],
    );

    expect(measureSpikeTrackPersistence(frames, 2_000)).toBe(0);
  });
});

describe("measureSpikeCombPersistence", () => {
  it("requires both recurring spike tracks and stable spacing", () => {
    expect(measureSpikeCombPersistence(0.9, 0.8)).toBeCloseTo(0.72);
    expect(measureSpikeCombPersistence(0.9, 0.2)).toBeCloseTo(0.18);
    expect(measureSpikeCombPersistence(0.2, 0.9)).toBeCloseTo(0.18);
  });
});

describe("measureSpikeValleyFill", () => {
  const makeComb = (raisedValleys: number[] = []) => {
    const spacingHz = 33_000;
    const spanHz = spacingHz * 30;
    const samples = new Float32Array(4096).fill(-80);
    const spikes = Array.from({ length: 30 }, (_, index) => {
      const frequencyHz = (index + 1) * spacingHz;
      const bin = Math.round((frequencyHz / spanHz) * (samples.length - 1));
      for (let offset = -3; offset <= 3; offset += 1) {
        samples[bin + offset] = -48;
      }
      const valleyBin = Math.round(
        ((frequencyHz + spacingHz / 2) / spanHz) * (samples.length - 1),
      );
      if (raisedValleys.includes(index)) {
        for (let offset = -15; offset <= 15; offset += 1) {
          samples[valleyBin + offset] = -55;
        }
      }
      return { frequencyHz, powerDbm: -48, index: bin };
    });
    return { spikes, spacingHz, spanHz, samples };
  };

  it("keeps clean, separated blades low", () => {
    const comb = makeComb();
    const score = measureSpikeValleyFill(comb.spikes, -80, comb.spacingHz, {
      samples: comb.samples,
      minFrequencyHz: 0,
      maxFrequencyHz: comb.spanHz,
    });

    expect(score).toBeLessThan(0.05);
  });

  it("raises interference when a sustained hump fills consecutive blade valleys", () => {
    const comb = makeComb([10, 11, 12, 13, 14, 15, 16]);
    const score = measureSpikeValleyFill(comb.spikes, -80, comb.spacingHz, {
      samples: comb.samples,
      minFrequencyHz: 0,
      maxFrequencyHz: comb.spanHz,
    });

    expect(score).toBeGreaterThan(0.7);
  });
});

describe("measureInterferencePresence", () => {
  it("keeps a clean toothy comb in single-digit interference scores", () => {
    expect(measureInterferencePresence(0.18, 0.264, 0)).toBe(0);
  });

  it("scores broad floor lift and filled valleys as clear interference", () => {
    expect(measureInterferencePresence(0.44, 0.92, 1)).toBe(1);
  });

  it("does not mistake coherent bridge valleys for interference when the floor is level", () => {
    expect(measureInterferencePresence(0.44, 0.92, 0)).toBe(0);
  });
});
