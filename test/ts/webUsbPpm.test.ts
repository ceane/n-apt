import {
  normalizePpm,
} from "../../src/ts/webusb/rtlSdrWebUsb";
import { getRtlSdrOptionState } from "../../src/ts/webusb/rtlSdrOptionState";

describe("WebUSB PPM settings", () => {
  it("accepts signed calibration values in the shared range", () => {
    expect(normalizePpm(-200)).toBe(-200);
    expect(normalizePpm(-1)).toBe(-1);
    expect(normalizePpm(201)).toBe(200);
  });

  it("keeps app correction mode separate from the calibration value", () => {
    expect(
      getRtlSdrOptionState({
        centerFrequencyText: "1.618",
        centerFrequencyUnit: "MHz",
        sampleRateText: "3.2",
        sampleRateUnit: "MHz",
        fftSizeText: "32768",
        gainText: "49.6",
        ppmText: "-1",
        useAppPpmCorrection: true,
      }),
    ).toMatchObject({ ppm: -1, useAppPpmCorrection: true });
  });
});
