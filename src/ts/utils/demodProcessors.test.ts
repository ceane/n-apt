import { describe, expect, it } from "vitest";
import { createDemodProcessor } from "./demodProcessors";

describe("shared demod processors", () => {
  it("uses the FM processor selected by the radio node", () => {
    const processor = createDemodProcessor("fm", {
      targetSampleRate: 48_000,
      centerFrequency: 0,
      bandwidth: 200_000,
    });
    const iq = new Uint8Array(2048);
    for (let i = 0; i < iq.length; i += 2) {
      const phase = i * 0.08;
      iq[i] = 128 + Math.round(50 * Math.cos(phase));
      iq[i + 1] = 128 + Math.round(50 * Math.sin(phase));
    }
    const result = processor.process(iq, 240_000);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((sample) => Math.abs(sample) > 0)).toBe(true);
  });

  it("selects APTAudio and APTImage through the same framework-independent API", () => {
    const iq = new Uint8Array(128).fill(128);
    expect(
      createDemodProcessor("aptAudio", { targetSampleRate: 48_000 }).process(
        iq,
        240_000,
      ),
    ).toBeInstanceOf(Float32Array);
    expect(
      createDemodProcessor("aptImage", { targetSampleRate: 48_000 }).process(
        iq,
        240_000,
      ),
    ).toBeInstanceOf(Float32Array);
  });

  it("keeps resampling phase across live IQ frame boundaries", () => {
    const processor = createDemodProcessor("fm", {
      targetSampleRate: 48_000,
      centerFrequency: 93_300_000,
      bandwidth: 200_000,
    });
    const frameSamples = 16_384;
    let outputSamples = 0;

    for (let frame = 0; frame < 4; frame += 1) {
      const iq = new Uint8Array(frameSamples * 2);
      for (let sample = 0; sample < frameSamples; sample += 1) {
        const phase = (frame * frameSamples + sample) * 0.08;
        iq[sample * 2] = 128 + Math.round(50 * Math.cos(phase));
        iq[sample * 2 + 1] = 128 + Math.round(50 * Math.sin(phase));
      }
      outputSamples += processor.process(iq, 3_200_000, 93_300_000).length;
    }

    expect(outputSamples).toBeGreaterThan(980);
    expect(outputSamples).toBeLessThanOrEqual(984);
  });
});
