import { detectNaptSpikeCandidates } from "@n-apt/demodulation/utils/naptSpikeDetection";

describe("detectNaptSpikeCandidates", () => {
  it("finds a clear spike above a noisy floor", () => {
    const samples = new Float32Array(128);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.05 + (i % 7) * 0.003;
    }
    samples[72] = 1.0;
    samples[73] = 0.85;
    samples[74] = 0.62;

    const result = detectNaptSpikeCandidates(samples);

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.selectedCandidate).not.toBeNull();
    expect(result.selectedCandidate?.index).toBeGreaterThanOrEqual(70);
    expect(result.selectedCandidate?.index).toBeLessThanOrEqual(74);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("stays conservative on a flat band", () => {
    const samples = new Float32Array(128).fill(0.1);
    const result = detectNaptSpikeCandidates(samples);

    expect(result.candidates.length).toBe(0);
    expect(result.selectedCandidate).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
