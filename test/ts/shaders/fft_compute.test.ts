import { FFT_COMPUTE_SHADER } from "../../../src/ts/consts/shaders/fft_compute";

describe("fft_compute.wgsl", () => {
  it("stays non-empty", () => {
    expect(FFT_COMPUTE_SHADER.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry points", () => {
    expect(FFT_COMPUTE_SHADER).toContain("fn fft_window");
    expect(FFT_COMPUTE_SHADER).toContain("fn fft_compute");
  });
});
