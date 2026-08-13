import {
  canUseWholeChannelSnapshot,
  clampRtlSdrFrequencyRangeToHardwareWindow,
  isHackrfDevice,
  resolveRenderableFrequencyRange,
  resolveCaptureAcquisitionMode,
  resolveCanonicalDisplaySampleRateHz,
  resolveDisplaySampleRateHz,
} from "@n-apt/app/infrastructure/io/sdrSampleRateGuards";

describe("resolveDisplaySampleRateHz", () => {
  it("uses the active Whole Channel rate instead of the stale source floor", () => {
    expect(
      resolveCanonicalDisplaySampleRateHz({
        activeSampleRateHz: 4_372_000,
        configuredSampleRateHz: 3_200_000,
        derivedSampleRateHz: 3_200_000,
        maxSampleRateHz: 18_250_000,
        deviceKind: "mock_apt",
      }),
    ).toBe(4_372_000);
  });

  it("uses the configured RTL-SDR rate instead of a wider rendered frame rate", () => {
    expect(
      resolveDisplaySampleRateHz({
        isRtlSdr: true,
        configuredSampleRateHz: 3_200_000,
        derivedSampleRateHz: 6_270_000,
      }),
    ).toBe(3_200_000);
  });

  it("uses an accepted RTL-SDR I/Q frame rate over stale settings", () => {
    expect(
      resolveDisplaySampleRateHz({
        isRtlSdr: true,
        frameSampleRateHz: 3_200_000,
        configuredSampleRateHz: 6_270_000,
        derivedSampleRateHz: 6_270_000,
      }),
    ).toBe(3_200_000);
  });

  it("does not let a stale Whole Channel frame rate exceed the source maximum", () => {
    expect(
      resolveDisplaySampleRateHz({
        isRtlSdr: true,
        frameSampleRateHz: 6_270_000,
        configuredSampleRateHz: 6_270_000,
        derivedSampleRateHz: 6_270_000,
        maxSampleRateHz: 3_200_000,
      }),
    ).toBe(3_200_000);
  });

  it("preserves Mock APT whole-channel metadata up to the configured ceiling", () => {
    expect(
      resolveDisplaySampleRateHz({
        deviceKind: "mock_apt",
        frameSampleRateHz: 4_372_000,
        configuredSampleRateHz: 4_372_000,
        derivedSampleRateHz: 4_372_000,
        maxSampleRateHz: 4_372_000,
      }),
    ).toBe(4_372_000);
  });

  it("rejects stale Mock APT metadata above the configured whole-channel ceiling", () => {
    expect(
      resolveDisplaySampleRateHz({
        deviceKind: "mock_apt",
        frameSampleRateHz: 6_270_000,
        configuredSampleRateHz: 6_270_000,
        derivedSampleRateHz: 6_270_000,
        maxSampleRateHz: 4_372_000,
      }),
    ).toBe(4_372_000);
  });
});

describe("sdrSampleRateGuards", () => {
  it("allows whole-channel snapshots as a source-independent acquisition intent", () => {
    expect(
      canUseWholeChannelSnapshot({
        requestedWhole: true,
        deviceKind: "rtl_sdr",
        backend: "rtl-sdr",
        deviceName: "RTL-SDR Blog V4",
      }),
    ).toBe(true);
  });

  it("keeps onscreen Whole Channel intent when the backend may split oversized captures", () => {
    expect(
      resolveCaptureAcquisitionMode({
        requestedMode: "whole_sample",
        isOnscreenActive: true,
        onscreenSpanHz: 4_390_000,
        hardwareSampleRateHz: 3_200_000,
        deviceKind: "rtl_sdr",
        backend: "rtl-sdr",
      }),
    ).toBe("whole_sample");
  });

  it("allows exact current-window whole_sample captures at the RTL-SDR sample rate", () => {
    expect(
      resolveCaptureAcquisitionMode({
        requestedMode: "stepwise",
        isOnscreenActive: true,
        onscreenSpanHz: 3_200_000,
        hardwareSampleRateHz: 3_200_000,
        deviceKind: "rtl_sdr",
        backend: "rtl-sdr",
      }),
    ).toBe("whole_sample");
  });

  it("keeps Onscreen captures in Whole Sample mode with a dynamic channel rate", () => {
    expect(
      resolveCaptureAcquisitionMode({
        requestedMode: "stepwise",
        isOnscreenActive: true,
        onscreenSpanHz: 4_000_000,
        hardwareSampleRateHz: 3_200_000,
        isRtlSdr: true,
      }),
    ).toBe("whole_sample");
  });

  it("start-anchors stale RTL-SDR full-channel render requests instead of using frame center", () => {
    expect(
      resolveRenderableFrequencyRange({
        requestedRange: { min: 18_000, max: 4_390_000 },
        centerFrequencyHz: 2_204_000,
        hardwareSampleRateHz: 3_200_000,
        deviceKind: "rtl_sdr",
      }),
    ).toEqual({
      min: 18_000,
      max: 3_218_000,
    });
  });

  it("uses DeviceProfile.is_rtl_sdr when kind is only the generic rx capability without centering", () => {
    expect(
      resolveRenderableFrequencyRange({
        requestedRange: { min: 18_000, max: 4_390_000 },
        centerFrequencyHz: 2_204_000,
        hardwareSampleRateHz: 3_200_000,
        deviceKind: "rx",
        isRtlSdr: true,
      }),
    ).toEqual({
      min: 18_000,
      max: 3_218_000,
    });
  });

  it("preserves RTL-SDR requested render windows that already fit the hardware sample rate", () => {
    expect(
      resolveRenderableFrequencyRange({
        requestedRange: { min: 900_000, max: 4_100_000 },
        centerFrequencyHz: 2_204_000,
        hardwareSampleRateHz: 3_200_000,
        deviceKind: "rtl_sdr",
      }),
    ).toEqual({
      min: 900_000,
      max: 4_100_000,
    });
  });

  it("preserves explicit file playback windows when frame metadata is narrower than the capture", () => {
    expect(
      resolveRenderableFrequencyRange({
        requestedRange: { min: 18_000, max: 3_218_000 },
        centerFrequencyHz: 1_372_840,
        hardwareSampleRateHz: 2_841_120,
        deviceKind: "rtl_sdr",
        preferRequestedRange: true,
      }),
    ).toEqual({
      min: 18_000,
      max: 3_218_000,
    });
  });

  it("keeps a render window within the generic sample-rate capability", () => {
    expect(
      resolveRenderableFrequencyRange({
        requestedRange: { min: 0, max: 1_000_000 },
        deviceKind: "mock_tx",
      }),
    ).toEqual({ min: 0, max: 1_000_000 });
  });

  it("normalizes a mirrored negative request back to a positive hardware window", () => {
    expect(
      resolveRenderableFrequencyRange({
        requestedRange: { min: -2_000_000, max: 2_000_000 },
        hardwareSampleRateHz: 4_000_000,
      }),
    ).toEqual({ min: 0, max: 4_000_000 });
  });

  it("clamps a persisted RTL-SDR full-channel range to a start-anchored hardware-sized VFO range", () => {
    expect(
      clampRtlSdrFrequencyRangeToHardwareWindow({
        range: { min: 18_000, max: 4_390_000 },
        channelBounds: { min: 18_000, max: 4_390_000 },
        hardwareSampleRateHz: 3_200_000,
        isRtlSdr: true,
      }),
    ).toEqual({
      min: 18_000,
      max: 3_218_000,
    });
  });

  it("preserves a user-scrolled RTL-SDR hardware-sized VFO range", () => {
    expect(
      clampRtlSdrFrequencyRangeToHardwareWindow({
        range: { min: 900_000, max: 4_100_000 },
        channelBounds: { min: 18_000, max: 4_390_000 },
        hardwareSampleRateHz: 3_200_000,
        isRtlSdr: true,
      }),
    ).toEqual({
      min: 900_000,
      max: 4_100_000,
    });
  });
});

describe("isHackrfDevice", () => {
  it("identifies HackRF One from deviceKind, backend, deviceName, or sourceId", () => {
    expect(isHackrfDevice({ deviceKind: "hackrf_one" })).toBe(true);
    expect(isHackrfDevice({ backend: "hackrf" })).toBe(true);
    expect(isHackrfDevice({ deviceName: "HackRF One SDR" })).toBe(true);
    expect(isHackrfDevice({ sourceId: "hackrf-one-0" })).toBe(true);
  });

  it("returns false for non-HackRF devices", () => {
    expect(isHackrfDevice({ deviceKind: "rtl-sdr" })).toBe(false);
    expect(isHackrfDevice({ backend: "mock_apt" })).toBe(false);
  });
});
