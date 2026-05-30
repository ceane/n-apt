import { buildSnapshotSettingsLabel } from "@n-apt/hooks/useSnapshotListener";

describe("buildSnapshotSettingsLabel", () => {
  it("uses the HackRF VGA gain and baseband filter bandwidth when present", () => {
    const label = buildSnapshotSettingsLabel({
      effectiveSdrSettings: {
        gain: {
          hackrf_lna_gain: 40,
          hackrf_vga_gain: 2,
          hackrf_amp_enable: false,
        },
        ppm: 1,
      } as any,
      hackrfVgaGain: 62,
      hackrfBasebandBandwidth: 2_000_000,
      deviceKind: "hackrf_one",
    });

    expect(label).toBe(
      "Gain: LNA 40dB | VGA 62dB | AMP off | Baseband Filter: 2 MHz | PPM: 1",
    );
  });

  it("prefers live HackRF gain values over bundled settings", () => {
    const label = buildSnapshotSettingsLabel({
      effectiveSdrSettings: {
        gain: {
          hackrf_lna_gain: 40,
          hackrf_vga_gain: 2,
          hackrf_amp_enable: false,
        },
        ppm: 1,
      } as any,
      hackrfLnaGain: 40,
      hackrfVgaGain: 62,
      hackrfAmpEnabled: false,
      hackrfBasebandBandwidth: 0,
      deviceKind: "hackrf_one",
    });

    expect(label).toContain("VGA 62dB");
  });

  it("falls back to the bundled value when no live HackRF override is provided", () => {
    const label = buildSnapshotSettingsLabel({
      effectiveSdrSettings: {
        gain: {
          hackrf_lna_gain: 40,
          hackrf_vga_gain: 2,
          hackrf_amp_enable: false,
        },
        ppm: 1,
      } as any,
      hackrfBasebandBandwidth: 18_250_000,
      deviceKind: "hackrf_one",
    });

    expect(label).toContain("VGA 2dB");
  });

  it("shows the baseband filter as off when the bandwidth is disabled", () => {
    const label = buildSnapshotSettingsLabel({
      effectiveSdrSettings: {
        gain: {
          hackrf_lna_gain: 40,
          hackrf_vga_gain: 2,
          hackrf_amp_enable: false,
        },
        ppm: 1,
      } as any,
      hackrfBasebandBandwidth: 0,
      deviceKind: "hackrf_one",
    });

    expect(label).toBe(
      "Gain: LNA 40dB | VGA 2dB | AMP off | Baseband Filter: off | PPM: 1",
    );
  });

  it("shows only generic gain and omits baseband filter for non-HackRF devices", () => {
    const label = buildSnapshotSettingsLabel({
      effectiveSdrSettings: {
        gain: {
          tuner_gain: 49.6,
          hackrf_lna_gain: 40,
          hackrf_vga_gain: 2,
        },
        ppm: 1,
      } as any,
      hackrfLnaGain: 40,
      hackrfVgaGain: 2,
      hackrfBasebandBandwidth: 2_000_000,
      deviceKind: "mock_apt_sdr",
    });

    expect(label).toBe("Gain: 49.6dB | PPM: 1");
  });

  it("falls back to Auto for generic gain when tuner_gain is not specified on non-HackRF devices", () => {
    const label = buildSnapshotSettingsLabel({
      effectiveSdrSettings: {
        gain: {},
        ppm: 0,
      } as any,
      deviceKind: "rtl_sdr",
    });

    expect(label).toBe("Gain: Auto | PPM: 0");
  });
});
