import { describe, expect, it } from "vitest";
import { fftComputeShader } from "@n-apt/shaders";

describe("fft_compute.wgsl", () => {
  it("stays non-empty", () => {
    expect(fftComputeShader.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry points", () => {
    expect(fftComputeShader).toContain("fn fft_window");
    expect(fftComputeShader).toContain("fn fft_compute");
    expect(fftComputeShader).toContain("fn fft_bit_reversal");
  });
});
