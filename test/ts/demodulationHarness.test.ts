import {
  prepareDemodulation,
  runDemodulationAlgorithm,
} from "@n-apt/demodulation/utils/demodHarness";

describe("demodulation harness", () => {
  it("locks lossless quality and chooses a 60 FPS FFT floor", () => {
    const plan = prepareDemodulation({ centerFrequencyHz: 100e6, frequencyRangeHz: [99.9e6, 100.1e6], sampleRateHz: 2.4e6, targetFps: 60, algorithm: "fm" });
    expect(plan.temporalResolution).toBe("lossless");
    expect(plan.fftSize).toBeGreaterThanOrEqual(65_536);
    expect(plan.frequencyRangeHz).toEqual([99.9e6, 100.1e6]);
  });

  it("dispatches algorithms without coupling to React Flow", () => {
    expect(runDemodulationAlgorithm("fm", new Uint8Array([1, 2]))).toBeInstanceOf(Float32Array);
    expect(() => runDemodulationAlgorithm("unknown", new Uint8Array())).toThrow(/unsupported/i);
  });
});
