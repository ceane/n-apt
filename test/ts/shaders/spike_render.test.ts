import { describe, expect, it } from "vitest";
import { spikeRenderShader } from "@n-apt/shaders";

describe("spike_render.wgsl", () => {
  it("stays non-empty", () => {
    expect(spikeRenderShader.trim()).not.toHaveLength(0);
  });

  it("exports the expected spike render entry points", () => {
    expect(spikeRenderShader).toContain("fn vs_line");
    expect(spikeRenderShader).toContain("fn fs_line");
    expect(spikeRenderShader).toContain("fn vs_circle");
    expect(spikeRenderShader).toContain("fn fs_circle");
  });
});
