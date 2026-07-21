import { configureStore } from "@reduxjs/toolkit";
import websocketSlice, {
  setDisconnected,
  setSpectrumFrames,
} from "@n-apt/redux/slices/websocketSlice";
import {
  loadPersistedSdrSettings,
  loadPersistedSdrSettingsCache,
} from "@n-apt/redux/middleware/localStorageMiddleware";
import localStorageMiddleware from "@n-apt/redux/middleware/localStorageMiddleware";

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
    expect(parsed.txSignal).toBe("wifi");
    expect(parsed.txHopType).toBe("range");
  });

  it("restores independent Tx viewer defaults when persisted viewer state is partial", () => {
    localStorage.setItem(
      "napt-sdr-settings-v2",
      JSON.stringify({
        txViewerSampleRateHz: null,
        txViewerFftSize: undefined,
        txViewerFftFrameRate: 0,
        txViewerFftWindow: null,
        txViewerTemporalResolution: "invalid",
        txViewerPowerScale: "invalid",
      }),
    );

    const parsed = loadPersistedSdrSettings();

    expect(parsed.txViewerSampleRateHz).toBe(2_400_000);
    expect(parsed.txViewerFftSize).toBe(65_536);
    expect(parsed.txViewerFftFrameRate).toBe(60);
    expect(parsed.txViewerFftWindow).toBe("Rectangular");
    expect(parsed.txViewerTemporalResolution).toBe("high");
    expect(parsed.txViewerPowerScale).toBe("dB");
  });

  it("upgrades legacy apt txSignal values to wifi", () => {
    localStorage.setItem(
      "napt-sdr-settings-v2",
      JSON.stringify({
        txSignal: "apt",
      }),
    );

    const parsed = loadPersistedSdrSettings();

    expect(parsed.txSignal).toBe("wifi");
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

  it("removes persisted spectrum frames when the websocket disconnects", () => {
    const store = configureStore({
      reducer: {
        websocket: websocketSlice,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
          serializableCheck: false,
        }).concat(localStorageMiddleware),
    });

    const spectrumFrame = {
      id: "cached-frame",
      label: "cached-frame",
      min_hz: 1,
      max_hz: 2,
      description: "cached spectrum frame",
    };

    store.dispatch(setSpectrumFrames([spectrumFrame as any]));
    expect(localStorage.getItem("napt-spectrum-frames")).not.toBeNull();

    store.dispatch(setDisconnected());

    expect(localStorage.getItem("napt-spectrum-frames")).toBeNull();
  });
});
