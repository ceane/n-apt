import {
  measureSpikeCombPersistence,
  measureSpikeTrackPersistence,
  selectTallSpikes,
} from "@n-apt/spectrum/fft/spikeSpacing";

describe("selectTallSpikes", () => {
  it("uses floor-relative power and excludes short drawing markers", () => {
    const spikes = [
      { frequencyHz: 33_000, powerDbm: -42 },
      { frequencyHz: 66_000, powerDbm: -41 },
      { frequencyHz: 99_000, powerDbm: -40 },
      { frequencyHz: 132_000, powerDbm: -39 },
      { frequencyHz: 165_000, powerDbm: -38 },
      { frequencyHz: 198_000, powerDbm: -75 },
    ];

    expect(selectTallSpikes(spikes, -80)).toHaveLength(5);
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
  it("requires both recurring spike tracks and GPU cadence", () => {
    expect(measureSpikeCombPersistence(0.9, 0.8)).toBeCloseTo(0.72);
    expect(measureSpikeCombPersistence(0.9, 0.2)).toBeCloseTo(0.18);
    expect(measureSpikeCombPersistence(0.2, 0.9)).toBeCloseTo(0.18);
  });
});
