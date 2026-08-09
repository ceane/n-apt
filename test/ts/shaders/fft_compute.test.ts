import { FFT_COMPUTE_SHADER } from "@n-apt/consts/shaders/fft_compute";

describe("fft_compute.wgsl", () => {
  it("stays non-empty", () => {
    expect(FFT_COMPUTE_SHADER.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry points", () => {
    expect(FFT_COMPUTE_SHADER).toContain("fn fft_window");
    expect(FFT_COMPUTE_SHADER).toContain("fn fft_compute");
  });

  it("applies the selected window type to IQ preprocessing", () => {
    expect(FFT_COMPUTE_SHADER).toContain(
      "window_function(idx, params.input_size, params.window_type)",
    );
    expect(FFT_COMPUTE_SHADER).not.toContain(
      "window_function(idx, params.input_size, WINDOW_HANNING)",
    );
  });
});
