import { describe, expect, it } from "vitest";
import { spectrumShader } from "@n-apt/shaders";

describe("spectrum.wgsl", () => {
  it("stays non-empty", () => {
    expect(spectrumShader.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry points", () => {
    expect(spectrumShader).toContain("fn vs_line");
    expect(spectrumShader).toContain("fn vs_fill");
    expect(spectrumShader).toContain("fn fs_line");
    expect(spectrumShader).toContain("fn fs_fill");
  });
});
