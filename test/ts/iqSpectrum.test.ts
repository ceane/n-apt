import { computeIqToDbSpectrumScalar } from "@n-apt/spectrum/fft/iqSpectrum";

function buildToneIqSamples(sampleCount: number, cycles: number): Uint8Array {
  const iq = new Uint8Array(sampleCount * 2);
  for (let index = 0; index < sampleCount; index++) {
    const phase = (2 * Math.PI * cycles * index) / sampleCount;
    iq[index * 2] = Math.round(128 + 100 * Math.cos(phase));
    iq[index * 2 + 1] = Math.round(128 + 100 * Math.sin(phase));
  }
  return iq;
}

function peakIndex(spectrum: Float32Array): number {
  return spectrum.reduce(
    (peak, value, index) => (value > spectrum[peak] ? index : peak),
    0,
  );
}

describe("frequency translation in the FFT path", () => {
  const fftSize = 1024;
  const sampleRateHz = 1_024_000;
  const centerFrequencyHz = 10_000_000;
  const input = buildToneIqSamples(fftSize, 4);
  const options = {
    fftSize,
    offsetDb: 0,
    windowType: "rectangular",
    enabled: true,
    centerFrequencyHz,
    sampleRateHz,
  };

  it("moves a positive PPM correction up in the complex spectrum", () => {
    const spectrum = computeIqToDbSpectrumScalar(input, {
      ...options,
      ppm: 100,
      applyPpmCorrection: true,
    });

    expect(peakIndex(spectrum)).toBe(fftSize / 2 + 5);
  });

  it("moves a negative PPM correction down in the complex spectrum", () => {
    const spectrum = computeIqToDbSpectrumScalar(input, {
      ...options,
      ppm: -100,
      applyPpmCorrection: true,
    });

    expect(peakIndex(spectrum)).toBe(fftSize / 2 + 3);
  });

  it("uses the hardware-model sample-clock ratio before the FFT", () => {
    const rawInput = buildToneIqSamples(1280, 5);
    const spectrum = computeIqToDbSpectrumScalar(rawInput, {
      ...options,
      applyPpmCorrection: true,
      ppm: 0,
      ppmCorrectionHz: 0,
      ppmInputPerOutput: 1.25,
      ppmSourceOffset: 0,
    });

    expect(peakIndex(spectrum)).toBe(fftSize / 2 + 5);
  });

  it("uses the modeled tuner shift rather than center-frequency times PPM", () => {
    const spectrum = computeIqToDbSpectrumScalar(input, {
      ...options,
      applyPpmCorrection: true,
      ppm: 0,
      ppmCorrectionHz: sampleRateHz / fftSize,
      ppmInputPerOutput: 1,
      ppmSourceOffset: 0,
    });

    expect(peakIndex(spectrum)).toBe(fftSize / 2 + 5);
  });
});
