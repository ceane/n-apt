import { FFT_COMPUTE_SHADER } from "./shaderSources";

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

  it("uses the shared per-device gain correction for dBm conversion", () => {
    expect(FFT_COMPUTE_SHADER).toContain(
      "params.gain_correction_db_per_db * params.tuner_gain_db",
    );
    expect(FFT_COMPUTE_SHADER).not.toContain(
      "interpolate_rtl_sdr_gain_offset",
    );
  });
});
