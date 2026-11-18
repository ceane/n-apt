import { shouldApplyFrontendSpectrumPpmCorrection } from "@n-apt/spectrum/fft/ppmCorrectionPolicy";

describe("frontend spectrum PPM correction policy", () => {
  it("does not correct RTL-SDR samples a second time after the device pipeline", () => {
    expect(shouldApplyFrontendSpectrumPpmCorrection(true)).toBe(false);
  });

  it("retains the existing frontend correction for other sources", () => {
    expect(shouldApplyFrontendSpectrumPpmCorrection(false)).toBe(true);
  });

  it("does not apply the app correction when its mode is disabled", () => {
    expect(shouldApplyFrontendSpectrumPpmCorrection(false, false)).toBe(false);
  });
});
