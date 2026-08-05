import { describe, expect, it } from "vitest";
import { createDemodProcessor } from "./demodProcessors";

describe("shared demod processors", () => {
  it("uses the FM processor selected by the radio node", () => {
    const processor = createDemodProcessor("fm", { targetSampleRate: 48_000, centerFrequency: 0, bandwidth: 200_000 });
    const iq = new Uint8Array(2048);
    for (let i = 0; i < iq.length; i += 2) { const phase = i * 0.08; iq[i] = 128 + Math.round(50 * Math.cos(phase)); iq[i + 1] = 128 + Math.round(50 * Math.sin(phase)); }
    const result = processor.process(iq, 240_000);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((sample) => Math.abs(sample) > 0)).toBe(true);
  });

  it("selects APT and NAPT through the same framework-independent API", () => {
    const iq = new Uint8Array(128).fill(128);
    expect(createDemodProcessor("apt", { targetSampleRate: 48_000 }).process(iq, 240_000)).toBeInstanceOf(Float32Array);
    expect(createDemodProcessor("napt", { targetSampleRate: 48_000 }).process(iq, 240_000)).toBeInstanceOf(Float32Array);
  });
});
