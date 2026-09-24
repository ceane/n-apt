import {
  analyzeAudioSurveyFrame,
  createAudioSurveyChannelizer,
  demodulateAudioCandidate,
} from "@n-apt/demodulation/survey/audioSurveyDsp";

const makeAmIq = (
  sampleRateHz: number,
  samples: number,
  centerHz: number,
  audioHz: number,
) => {
  const iq = new Uint8Array(samples * 2);
  for (let index = 0; index < samples; index++) {
    const time = index / sampleRateHz;
    const amplitude = 0.55 + 0.35 * Math.sin(2 * Math.PI * audioHz * time);
    const phase = 2 * Math.PI * centerHz * time;
    iq[index * 2] = 128 + Math.round(120 * amplitude * Math.cos(phase));
    iq[index * 2 + 1] = 128 + Math.round(120 * amplitude * Math.sin(phase));
  }
  return iq;
};

const rms = (values: Float32Array) =>
  Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

describe("audio survey demodulation", () => {
  it("extracts an AM waveform as listenable PCM from the selected IQ channel", () => {
    const sampleRateHz = 256_000;
    const pcm = demodulateAudioCandidate({
      iqData: makeAmIq(sampleRateHz, sampleRateHz / 4, 24_000, 1_000),
      sampleRateHz,
      frameCenterFrequencyHz: 0,
      centerFrequencyHz: 24_000,
      bandwidthHz: 12_000,
      modulation: "am",
    });

    expect(pcm.sampleRateHz).toBe(48_000);
    expect(pcm.samples.length).toBeGreaterThan(10_000);
    expect(rms(pcm.samples)).toBeGreaterThan(0.02);
    expect(Array.from(pcm.samples).every(Number.isFinite)).toBe(true);
  });

  it("finds a modulated carrier near its RF center and returns both baseline decodes", () => {
    const sampleRateHz = 256_000;
    const candidates = analyzeAudioSurveyFrame({
      iqData: makeAmIq(sampleRateHz, sampleRateHz / 4, 24_000, 1_000),
      sampleRateHz,
      frameCenterFrequencyHz: 10_000_000,
      allowedRangeHz: { min: 9_900_000, max: 10_100_000 },
      targetSampleRateHz: 48_000,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].centerHz).toBeCloseTo(10_024_000, -2);
    expect(candidates[0].bandwidthHz).toBeGreaterThan(0);
    expect(candidates[0].audioPcm.length).toBeGreaterThan(0);
    expect(["am", "fm", "unknown"]).toContain(candidates[0].modulation);
  });

  it("stores a selected narrowband channel at a compact sample rate", () => {
    const sampleRateHz = 256_000;
    const channelizer = createAudioSurveyChannelizer({
      centerFrequencyHz: 24_000,
      bandwidthHz: 12_000,
    });
    const output = channelizer.process(
      makeAmIq(sampleRateHz, 16_384, 24_000, 1_000),
      sampleRateHz,
      0,
    );

    expect(output.sampleRateHz).toBeLessThan(sampleRateHz);
    expect(output.sampleRateHz).toBeGreaterThanOrEqual(48_000);
    expect(output.iqData.length).toBeLessThan(16_384 * 2);
    expect(output.iqData.length % 2).toBe(0);
  });
});
