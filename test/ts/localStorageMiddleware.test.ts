import {
  loadPersistedSdrSettings,
  loadPersistedSdrSettingsCache,
} from "@n-apt/redux/middleware/localStorageMiddleware";

describe("loadPersistedSdrSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preserves persisted dBm ranges instead of flattening them to 0 dBm", () => {
    localStorage.setItem(
      "napt-sdr-settings-v2",
      JSON.stringify({
        fftMinDb: -100,
        fftMaxDb: 30,
        powerScale: "dBm",
        sampleRateHz: 5_200_000,
      }),
    );

    const parsed = loadPersistedSdrSettings();

    expect(parsed.fftMinDb).toBe(-100);
    expect(parsed.fftMaxDb).toBe(30);
    expect(parsed.powerScale).toBeUndefined();
    expect(parsed.sampleRateHz).toBeUndefined();
  });

  it("restores Tx defaults when persisted spectrum state is partial", () => {
    localStorage.setItem(
      "napt-sdr-settings-v2",
      JSON.stringify({
        fftSize: 1024,
      }),
    );

    const parsed = loadPersistedSdrSettings();

    expect(parsed.txSampleRateHz).toBe(2_400_000);
    expect(parsed.txCenterFrequencyHz).toBe(137_100_000);
    expect(parsed.txSignal).toBe("apt");
    expect(parsed.txHopType).toBe("range");
  });

  it("drops stale zero gain so the restored default survives hydration", () => {
    localStorage.setItem(
      "napt-sdr-settings-v2",
      JSON.stringify({
        gain: 0,
        fftSize: 2048,
      }),
    );

    const parsed = loadPersistedSdrSettings();

    expect(parsed.gain).toBeUndefined();
    expect(parsed.fftSize).toBe(2048);
  });

  it("drops stale zero tuner gain from cached websocket settings", () => {
    localStorage.setItem(
      "napt-sdr-settings",
      JSON.stringify({
        gain: { tuner_gain: 0, rtl_agc: false, tuner_agc: false },
        sample_rate: 3_200_000,
      }),
    );

    const parsed = loadPersistedSdrSettingsCache();

    expect(parsed?.gain?.tuner_gain).toBeUndefined();
    expect(parsed?.gain?.rtl_agc).toBe(false);
  });
});
