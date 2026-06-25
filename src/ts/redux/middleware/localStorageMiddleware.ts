import { Middleware } from "@reduxjs/toolkit";

// Keys for localStorage persistence
const STORAGE_KEYS = {
  THEME: "napt-theme-storage",
  SDR_SETTINGS: "napt-sdr-settings-v2",
  AUTH_PASSKEYS: "n_apt_has_passkeys",
  VISUALIZER_PAUSE: "napt-visualizer-manual-paused",
  SPECTRUM_FRAMES: "napt-spectrum-frames",
  SDR_SETTINGS_CACHE: "napt-sdr-settings",
} as const;

// Safe localStorage operations
const safeSetItem = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Failed to save to localStorage (${key}):`, error);
    return false;
  }
};

const safeGetItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`Failed to read from localStorage (${key}):`, error);
    return null;
  }
};

const safeRemoveItem = (key: string): boolean => {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`Failed to remove from localStorage (${key}):`, error);
    return false;
  }
};

export const normalizePersistedTxSignalKey = (value: unknown): string => {
  if (typeof value !== "string") {
    return "wifi";
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "":
    case "apt":
      return "wifi";
    case "d":
    case "d_sharp":
    case "dsharp":
    case "wifi":
    case "5g":
    case "tone":
    case "noise":
    case "custom":
      return normalized === "dsharp" ? "d_sharp" : normalized;
    default:
      return "wifi";
  }
};

// Create localStorage middleware
const createLocalStorageMiddleware =
  (): Middleware<{}, any> => (store) => (next) => (action: any) => {
    const result = next(action);
    const state = store.getState();

    // Handle theme persistence
    if (action.type?.startsWith("theme/")) {
      const themeState = state.theme;
      const themeData = {
        appMode: themeState.appMode,
        accentColor: themeState.accentColor,
        fftColor: themeState.fftColor,
        waterfallTheme: themeState.waterfallTheme,
      };
      safeSetItem(STORAGE_KEYS.THEME, JSON.stringify(themeData));
    }

    // Handle SDR settings persistence
    if (action.type?.startsWith("spectrum/")) {
      const spectrumState = state.spectrum;
      const settingsData = {
        fftSize: spectrumState.fftSize,
        fftWindow: spectrumState.fftWindow,
        fftFrameRate: spectrumState.fftFrameRate,
        gain: spectrumState.gain,
        ppm: spectrumState.ppm,
        tunerAGC: spectrumState.tunerAGC,
        rtlAGC: spectrumState.rtlAGC,
        vizZoom: spectrumState.vizZoom,
        vizPanOffset: spectrumState.vizPanOffset,
        fftMinDb: spectrumState.fftMinDb,
        fftMaxDb: spectrumState.fftMaxDb,
        frequencyRange: spectrumState.frequencyRange,
        activeSignalArea: spectrumState.activeSignalArea,
        lastKnownRanges: spectrumState.lastKnownRanges,
        displayTemporalResolution: spectrumState.displayTemporalResolution,
      };
      safeSetItem(STORAGE_KEYS.SDR_SETTINGS, JSON.stringify(settingsData));
    }

    // Handle waterfall settings persistence
    if (action.type?.startsWith("waterfall/")) {
      const waterfallState = state.waterfall;
      if (action.type === "waterfall/setSnapshotGrid") {
        safeSetItem(
          "napt-snapshot-grid",
          JSON.stringify(waterfallState.snapshotGridPreference),
        );
      }
    }

    // Handle auth passkey settings
    if (action.type?.startsWith("auth/")) {
      const authState = state.auth;
      if (
        action.type === "auth/setHasPasskeys" ||
        action.type === "auth/setPasskeyRegistrationSuccess"
      ) {
        safeSetItem(STORAGE_KEYS.AUTH_PASSKEYS, String(authState.hasPasskeys));
      }
    }

    // Handle WebSocket data caching
    if (action.type?.startsWith("websocket/")) {
      const websocketState = state.websocket;

      // Cache spectrum frames
      if (
        action.type === "websocket/setSpectrumFrames" &&
        websocketState.spectrumFrames.length > 0
      ) {
        safeSetItem(
          STORAGE_KEYS.SPECTRUM_FRAMES,
          JSON.stringify(websocketState.spectrumFrames),
        );
      }

      // Cache SDR settings from WebSocket
      if (
        action.type === "websocket/updateDeviceState" &&
        websocketState.sdrSettings
      ) {
        safeSetItem(
          STORAGE_KEYS.SDR_SETTINGS_CACHE,
          JSON.stringify(websocketState.sdrSettings),
        );
      }
    }

    return result;
  };

// Helper functions to load persisted data
export const loadPersistedTheme = () => {
  const stored = safeGetItem(STORAGE_KEYS.THEME);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch (error) {
    console.warn("Failed to parse persisted theme data:", error);
    safeRemoveItem(STORAGE_KEYS.THEME);
    return null;
  }
};

export const loadPersistedSdrSettings = () => {
  const stored = safeGetItem(STORAGE_KEYS.SDR_SETTINGS);
  if (!stored) return {};

  try {
    const parsed = JSON.parse(stored);

    // Ensure lastKnownRanges is a valid object
    if (
      !parsed.lastKnownRanges ||
      typeof parsed.lastKnownRanges !== "object" ||
      Array.isArray(parsed.lastKnownRanges)
    ) {
      parsed.lastKnownRanges = {};
    }

    if ("powerScale" in parsed) {
      delete parsed.powerScale;
    }

    // Live sample rate should come from the websocket/backend on reconnect.
    // Persisting it here tends to reintroduce stale rates during HMR.
    if ("sampleRateHz" in parsed) {
      delete parsed.sampleRateHz;
    }

    if (!Number.isFinite(parsed.txSampleRateHz)) {
      parsed.txSampleRateHz = 2_400_000;
    }

    if (
      !Number.isFinite(parsed.txCenterFrequencyHz) ||
      parsed.txCenterFrequencyHz === 2_204_000 ||
      parsed.txCenterFrequencyHz === 1_600_000
    ) {
      parsed.txCenterFrequencyHz = 137_100_000;
    }

    if (!Number.isFinite(parsed.txPowerDbm)) {
      parsed.txPowerDbm = -18;
    }

    if (!Number.isFinite(parsed.txVgaGain)) {
      parsed.txVgaGain = 16;
    }

    parsed.txSignal = normalizePersistedTxSignalKey(parsed.txSignal);

    if (typeof parsed.txSafetyEnabled !== "boolean") {
      parsed.txSafetyEnabled = false;
    }

    if (typeof parsed.txSafetyLimit !== "string") {
      parsed.txSafetyLimit = "room";
    }

    if (typeof parsed.txHopType !== "string") {
      parsed.txHopType = "range";
    }

    if (!Number.isFinite(parsed.txHopStartFrequencyHz)) {
      parsed.txHopStartFrequencyHz = 10_000_000;
    }

    if (!Number.isFinite(parsed.txHopEndFrequencyHz)) {
      parsed.txHopEndFrequencyHz = 20_000_000;
    }

    if (!Array.isArray(parsed.txHopChannels)) {
      parsed.txHopChannels = ["a"];
    }

    if (!Number.isFinite(parsed.txHopRateHz)) {
      parsed.txHopRateHz = 10;
    }

    if (typeof parsed.txHopEnabled !== "boolean") {
      parsed.txHopEnabled = false;
    }

    // Preserve the restored live default gain if stale cache data wrote a zero
    // generic gain. Zero is a common "missing value" in older persisted state.
    if (parsed.gain === 0) {
      delete parsed.gain;
    }

    return parsed;
  } catch (error) {
    console.warn("Failed to parse persisted SDR settings:", error);
    safeRemoveItem(STORAGE_KEYS.SDR_SETTINGS);
    return {};
  }
};

export const loadPersistedPasskeys = () => {
  const stored = safeGetItem(STORAGE_KEYS.AUTH_PASSKEYS);
  return stored === "true";
};

export const loadPersistedSpectrumFrames = () => {
  const stored = safeGetItem(STORAGE_KEYS.SPECTRUM_FRAMES);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Failed to parse persisted spectrum frames:", error);
    safeRemoveItem(STORAGE_KEYS.SPECTRUM_FRAMES);
    return [];
  }
};

export const loadPersistedSdrSettingsCache = () => {
  const stored = safeGetItem(STORAGE_KEYS.SDR_SETTINGS_CACHE);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored);
    if (parsed?.gain && typeof parsed.gain === "object") {
      if (parsed.gain.tuner_gain === 0) {
        delete parsed.gain.tuner_gain;
      }
    }
    return parsed;
  } catch (error) {
    console.warn("Failed to parse persisted SDR settings cache:", error);
    safeRemoveItem(STORAGE_KEYS.SDR_SETTINGS_CACHE);
    return null;
  }
};

const localStorageMiddleware = createLocalStorageMiddleware();
export default localStorageMiddleware;
