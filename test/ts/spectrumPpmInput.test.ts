import { prepareSpectrumIqWindow } from "@n-apt/spectrum/fft/spectrumPpmInput";

const bytes = (sampleCount: number) =>
  Uint8Array.from({ length: sampleCount * 2 }, (_, index) => index & 0xff);

describe("raw IQ window selection for GPU PPM correction", () => {
  it("selects the raw samples aligned to the newest corrected FFT window", () => {
    const raw = bytes(20);
    const frame = {
      iq_data: bytes(8),
      spectrum_iq_data: raw,
      spectrum_ppm_correction: {
        correction_hz: 41.2,
        input_per_output: 1.5,
        source_offset: 0.25,
      },
    } as any;

    const selected = prepareSpectrumIqWindow(frame, 2);

    // Two output samples start at raw position 9.25, requiring source samples
    // 9 through 11 for the shader's linear interpolation.
    expect(selected.iq).toEqual(raw.subarray(18, 24));
    expect(selected.correction).toEqual({
      correctionHz: 41.2,
      inputPerOutput: 1.5,
      sourceOffset: 0.25,
    });
  });

  it("falls back to already corrected IQ if the raw resampling window is short", () => {
    const corrected = bytes(8);
    const frame = {
      iq_data: corrected,
      spectrum_iq_data: bytes(2),
      spectrum_ppm_correction: {
        correction_hz: 41.2,
        input_per_output: 1.5,
        source_offset: 0.25,
      },
    } as any;

    const selected = prepareSpectrumIqWindow(frame, 2);

    expect(selected.iq).toEqual(corrected.subarray(12));
    expect(selected.correction).toBeUndefined();
  });
});
