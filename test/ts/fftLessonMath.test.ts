import {
  FFT_LESSON_FFT_SIZE,
  FFT_LESSON_SAMPLE_COUNT,
  calculateLessonMagnitudes,
  calculateBinWidth,
  createLessonIqSamples,
  createLessonSpectrumTrace,
  createLessonSpectrumTraceFromSamples,
  createLessonNaturalWaveformSamples,
  createLessonWaveformPoints,
  getBinCenters,
  getUncenteredBinCenters,
  twiddleFactor,
  butterfly,
} from "@n-apt/learn/canvas/fftLessonMath";

describe("FFT lesson math", () => {
  it("creates the requested number of finite I/Q samples", () => {
    const samples = createLessonIqSamples();

    expect(samples).toHaveLength(FFT_LESSON_SAMPLE_COUNT);
    expect(
      samples.every(
        ({ real, imaginary }) =>
          Number.isFinite(real) && Number.isFinite(imaginary),
      ),
    ).toBe(true);
  });

  it("keeps every rendered sample point on the one-cycle sine curve", () => {
    const points = createLessonWaveformPoints();

    expect(points).toHaveLength(FFT_LESSON_SAMPLE_COUNT);
    points.forEach((point, index) => {
      expect(point.normalizedTime).toBeCloseTo(index / FFT_LESSON_SAMPLE_COUNT);
      expect(point.value).toBeCloseTo(
        Math.sin((2 * Math.PI * index) / FFT_LESSON_SAMPLE_COUNT),
      );
      expect(point.imaginary).toBeCloseTo(
        Math.cos((2 * Math.PI * index) / FFT_LESSON_SAMPLE_COUNT),
      );
    });
  });

  it("creates a centered natural waveform in signed 8-bit amplitude", () => {
    const samples = createLessonNaturalWaveformSamples();

    expect(samples).toHaveLength(FFT_LESSON_SAMPLE_COUNT);
    expect(samples.every((value) => Number.isInteger(value))).toBe(true);
    expect(samples.every((value) => value >= -128 && value <= 127)).toBe(true);
    expect(Math.min(...samples)).toBeLessThan(0);
    expect(Math.max(...samples)).toBeGreaterThan(0);
    expect(new Set(samples).size).toBeGreaterThan(50);
  });

  it("calculates bin width and signed bin centers across the captured span", () => {
    expect(calculateBinWidth(8_000, FFT_LESSON_FFT_SIZE)).toBe(1_000);
    expect(getBinCenters(8_000, FFT_LESSON_FFT_SIZE)).toEqual([
      -4_000, -3_000, -2_000, -1_000, 0, 1_000, 2_000, 3_000,
    ]);
    expect(getUncenteredBinCenters(8_000, 8)).toEqual([
      0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000,
    ]);
  });

  it("generates the expected negative-quarter-turn twiddle factor", () => {
    expect(twiddleFactor(0, 8)).toEqual({ real: 1, imaginary: 0 });
    expect(twiddleFactor(2, 8).real).toBeCloseTo(0);
    expect(twiddleFactor(2, 8).imaginary).toBeCloseTo(-1);
  });

  it("computes the sum and difference outputs of a butterfly", () => {
    const result = butterfly(
      { real: 1, imaginary: 2 },
      { real: 3, imaginary: 4 },
      { real: 0, imaginary: -1 },
    );

    expect(result.twiddledB).toEqual({ real: 4, imaginary: -3 });
    expect(result.sum).toEqual({ real: 5, imaginary: -1 });
    expect(result.difference).toEqual({ real: -3, imaginary: 5 });
  });

  it("produces two-sided magnitude peaks for the one-cycle sine example", () => {
    const magnitudes = calculateLessonMagnitudes(
      createLessonIqSamples(FFT_LESSON_FFT_SIZE),
    );

    expect(magnitudes).toHaveLength(FFT_LESSON_FFT_SIZE);
    expect(magnitudes[3]).toBeCloseTo(4);
    expect(magnitudes[5]).toBeCloseTo(4);
    expect(magnitudes.filter((value) => value > 0.001)).toHaveLength(2);
  });

  it("creates a deterministic DC-centered magnitude waveform", () => {
    const trace = createLessonSpectrumTrace(8_000, 512);

    expect(trace).toHaveLength(512);
    expect(
      trace.every(
        ({ frequencyHz, magnitude }) =>
          Number.isFinite(frequencyHz) && Number.isFinite(magnitude),
      ),
    ).toBe(true);
    expect(trace[0]?.frequencyHz).toBe(0);
    expect(trace[76]?.frequencyHz).toBe(1_187.5);
    expect(trace[511]?.frequencyHz).toBeCloseTo(7_984.375);
    expect(trace[76]?.magnitude).toBeGreaterThan(0.5);
    expect(trace[512 - 76]?.magnitude).toBeGreaterThan(0.5);
    expect(trace[0]?.magnitude).toBeGreaterThan(0.2);
  });

  it("derives the magnitude bins from the same natural waveform samples", () => {
    const samples = createLessonNaturalWaveformSamples();
    const trace = createLessonSpectrumTraceFromSamples(samples, 8_000);

    expect(samples).toHaveLength(2_048);
    expect(trace).toHaveLength(samples.length);
    expect(trace[0]?.frequencyHz).toBe(0);
    expect(trace[trace.length - 1]?.frequencyHz).toBeCloseTo(7_996.09375);
    expect(trace.every(({ magnitude }) => Number.isFinite(magnitude))).toBe(
      true,
    );
    expect(
      Math.min(...trace.map(({ magnitude }) => magnitude)),
    ).toBeGreaterThan(0.2);
  });
});
