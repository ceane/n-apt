import {
  buildPersistedSourceViewState,
  resolveSourceSwitchDisplaySettings,
  resolveEffectiveLiveSampleRateHz,
  normalizePersistedSourceViewState,
  shouldRequestPausedPreview,
  buildPausedPreviewSignature,
  selectLiveSampleRateForSync,
  shouldSendSignalDisplaySettings,
} from "@n-apt/hooks/useSpectrumStore";

describe("resolveSourceSwitchDisplaySettings", () => {
  it("restores the selected RTL-SDR sample and frame rates together", () => {
    expect(
      resolveSourceSwitchDisplaySettings(
        { sampleRateHz: 3_200_000, fftFrameRate: 30 },
        { sampleRateHz: 20_000_000, fftFrameRate: 12 } as any,
      ),
    ).toEqual(
      expect.objectContaining({ sampleRateHz: 3_200_000, fftFrameRate: 30 }),
    );
  });
});

describe("shouldRequestPausedPreview", () => {
  it("does not request a preview frame for a paused RTL-SDR", () => {
    expect(
      shouldRequestPausedPreview({
        id: "rtl-sdr-00000001",
        kind: "rtl_sdr",
        status: "connected",
      } as any),
    ).toBe(false);
  });

  it("keeps paused previews for Mock Tx standby", () => {
    expect(
      shouldRequestPausedPreview({
        id: "mock-tx",
        kind: "mock_tx",
        status: "connected",
      } as any),
    ).toBe(true);
  });

  it("requests a one-shot frame for a paused Rx source with raw I/Q", () => {
    expect(
      shouldRequestPausedPreview({
        id: "mock-apt",
        kind: "mock_apt",
        capability: "rx",
        supports_raw_iq_stream: true,
        status: "connected",
      } as any),
    ).toBe(true);
  });
});

describe("buildPausedPreviewSignature", () => {
  it("changes when the paused source sample rate changes", () => {
    const base = {
      frequencyRange: { min: 18_000, max: 4_390_000 },
      sampleRateHz: 4_372_000,
      vizZoom: 1,
      vizPanOffset: 0,
      txCenterFrequencyHz: 137_100_000,
      txSampleRateHz: 2_400_000,
      txPowerDbm: -18,
      txSignal: "wifi",
      txIfftSize: 65_536,
    };

    expect(
      buildPausedPreviewSignature(base),
    ).not.toBe(
      buildPausedPreviewSignature({ ...base, sampleRateHz: 12_800_000 }),
    );
  });
});

describe("selectLiveSampleRateForSync", () => {
  it("prefers the live websocket sample rate while connected", () => {
    expect(
      selectLiveSampleRateForSync({
        isConnected: true,
        websocketSampleRateHz: 20_000_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(20_000_000);
  });

  it("falls back to sdr settings when disconnected", () => {
    expect(
      selectLiveSampleRateForSync({
        isConnected: false,
        websocketSampleRateHz: 20_000_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(3_200_000);
  });

  it("uses the confirmed backend rate over a stale local whole-channel rate", () => {
    expect(
      resolveEffectiveLiveSampleRateHz({
        localSampleRateHz: 4_372_000,
        websocketSampleRateHz: 3_200_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 3_200_000,
      }),
    ).toBe(3_200_000);
  });

  it("keeps RTL-SDR whole-channel state from inheriting a stale connected rate", () => {
    expect(
      resolveEffectiveLiveSampleRateHz({
        localSampleRateHz: 4_372_000,
        websocketSampleRateHz: 4_372_000,
        sdrSettingsSampleRateHz: 3_200_000,
        minReceiveSampleRateHz: 3_200_000,
        maxSampleRateHz: 3_200_000,
        deviceKind: "rtl_sdr",
        backend: "rtl-sdr",
      }),
    ).toBe(3_200_000);
  });

  it("caps an invalid RTL-SDR configured whole-channel rate at the device maximum", () => {
    expect(
      resolveEffectiveLiveSampleRateHz({
        localSampleRateHz: 6_270_000,
        websocketSampleRateHz: 6_270_000,
        sdrSettingsSampleRateHz: 6_270_000,
        minReceiveSampleRateHz: 6_270_000,
        maxSampleRateHz: 3_200_000,
        deviceKind: "rtl_sdr",
        backend: "rtl-sdr",
      }),
    ).toBe(3_200_000);
  });

  it("falls back to websocket/backend rates when no local rate has been selected", () => {
    expect(
      resolveEffectiveLiveSampleRateHz({
        localSampleRateHz: null,
        websocketSampleRateHz: 20_000_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(20_000_000);
  });

  it("persists and restores the selected sample rate for a source view", () => {
    const persisted = buildPersistedSourceViewState({
      fftSize: 262_144,
      fftWindow: "Rectangular",
      fftFrameRate: 12,
      gain: 49.6,
      hackrfLnaGain: 0,
      hackrfVgaGain: 30,
      hackrfAmpEnabled: false,
      hackrfBasebandBandwidth: 5_200_000,
      ppm: 1,
      tunerAGC: false,
      rtlAGC: false,
      sampleRateHz: 5_200_000,
      lastKnownRanges: {},
      displayMode: "fft",
      fftAvgEnabled: false,
      fftSmoothEnabled: false,
      wfSmoothEnabled: false,
    } as any);

    expect(persisted.sampleRateHz).toBe(5_200_000);
    expect(
      normalizePersistedSourceViewState({
        ...persisted,
        sampleRateHz: 5_200_000,
      }),
    ).toEqual(expect.objectContaining({ sampleRateHz: 5_200_000 }));
  });
});

describe("shouldSendSignalDisplaySettings", () => {
  it("sends the first settings packet after a source handoff", () => {
    expect(
      shouldSendSignalDisplaySettings({
        previous: null,
        next: { sampleRateHz: 3_200_000, fftSize: 262_144, frameRate: 12 },
      }),
    ).toBe(true);
  });

  it("sends when Whole Channel changes the sample rate without changing frame rate", () => {
    expect(
      shouldSendSignalDisplaySettings({
        previous: { sampleRateHz: 3_200_000, fftSize: 262_144, frameRate: 12 },
        next: { sampleRateHz: 4_372_000, fftSize: 262_144, frameRate: 12 },
      }),
    ).toBe(true);
  });

  it("does not resend unchanged display settings", () => {
    expect(
      shouldSendSignalDisplaySettings({
        previous: { sampleRateHz: 4_372_000, fftSize: 262_144, frameRate: 12 },
        next: { sampleRateHz: 4_372_000, fftSize: 262_144, frameRate: 12 },
      }),
    ).toBe(false);
  });
});
