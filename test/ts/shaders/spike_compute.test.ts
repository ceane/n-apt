import { describe, expect, it } from "vitest";
import { spikeComputeShader } from "@n-apt/shaders";

describe("spike_compute.wgsl", () => {
  it("stays non-empty", () => {
    expect(spikeComputeShader.trim()).not.toHaveLength(0);
  });

  it("exports the expected spike compute entry point", () => {
    expect(spikeComputeShader).toContain("fn main");
    expect(spikeComputeShader).toContain("SpikeMarker");
    expect(spikeComputeShader).toContain("spike_count");
  });
});
