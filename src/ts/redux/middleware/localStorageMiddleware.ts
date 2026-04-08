import { Middleware } from '@reduxjs/toolkit';

// Keys for localStorage persistence
const STORAGE_KEYS = {
  THEME: 'napt-theme-storage',
  SDR_SETTINGS: 'napt-sdr-settings-v2',
  AUTH_PASSKEYS: 'n_apt_has_passkeys',
  VISUALIZER_PAUSE: 'napt-visualizer-manual-paused',
  SPECTRUM_FRAMES: 'napt-spectrum-frames',
  SDR_SETTINGS_CACHE: 'napt-sdr-settings',
  AUTO_FFT_OPTIONS: 'napt-auto-fft-options',
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

// Create localStorage middleware
const createLocalStorageMiddleware = (): Middleware<{}, any> => (store) => (next) => (action: any) => {
  const result = next(action);
  const state = store.getState();

  // Handle theme persistence
  if (action.type?.startsWith('theme/')) {
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
  if (action.type?.startsWith('spectrum/')) {
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
      sampleRateHz: spectrumState.sampleRateHz,
    };
    safeSetItem(STORAGE_KEYS.SDR_SETTINGS, JSON.stringify(settingsData));
  }

  // Handle waterfall settings persistence
  if (action.type?.startsWith('waterfall/')) {
    const waterfallState = state.waterfall;
    if (action.type === 'waterfall/setSnapshotGrid') {
      safeSetItem('napt-snapshot-grid', JSON.stringify(waterfallState.snapshotGridPreference));
    }
  }

  // Handle auth passkey settings
  if (action.type?.startsWith('auth/')) {
    const authState = state.auth;
    if (action.type === 'auth/setHasPasskeys' || action.type === 'auth/setPasskeyRegistrationSuccess') {
      safeSetItem(STORAGE_KEYS.AUTH_PASSKEYS, String(authState.hasPasskeys));
    }
  }

  // Handle WebSocket data caching
  if (action.type?.startsWith('websocket/')) {
    const websocketState = state.websocket;
    
    // Cache spectrum frames
    if (action.type === 'websocket/setSpectrumFrames' && websocketState.spectrumFrames.length > 0) {
      safeSetItem(STORAGE_KEYS.SPECTRUM_FRAMES, JSON.stringify(websocketState.spectrumFrames));
    }
    
    // Cache SDR settings from WebSocket
    if (action.type === 'websocket/updateDeviceState' && websocketState.sdrSettings) {
      safeSetItem(STORAGE_KEYS.SDR_SETTINGS_CACHE, JSON.stringify(websocketState.sdrSettings));
    }
    
    // Cache auto FFT options
    if (action.type === 'websocket/setAutoFftOptions' && websocketState.autoFftOptions) {
      safeSetItem(STORAGE_KEYS.AUTO_FFT_OPTIONS, JSON.stringify(websocketState.autoFftOptions));
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
    console.warn('Failed to parse persisted theme data:', error);
    safeRemoveItem(STORAGE_KEYS.THEME);
    return null;
  }
};

export const loadPersistedSdrSettings = () => {
  const stored = safeGetItem(STORAGE_KEYS.SDR_SETTINGS);
  if (!stored) return {};
  
  try {
    const parsed = JSON.parse(stored);
    
    // Ensure lastKnownRanges is an object
    if (parsed.lastKnownRanges && typeof parsed.lastKnownRanges !== 'object') {
      parsed.lastKnownRanges = {};
    }

    if ('powerScale' in parsed) {
      delete parsed.powerScale;
    }

    // Fix outdated cached dB ranges
    if (parsed.fftMaxDb !== 0) {
      parsed.fftMaxDb = 0;
      parsed.fftMinDb = -120;
    }

    return parsed;
  } catch (error) {
    console.warn('Failed to parse persisted SDR settings:', error);
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
    console.warn('Failed to parse persisted spectrum frames:', error);
    safeRemoveItem(STORAGE_KEYS.SPECTRUM_FRAMES);
    return [];
  }
};

export const loadPersistedSdrSettingsCache = () => {
  const stored = safeGetItem(STORAGE_KEYS.SDR_SETTINGS_CACHE);
  if (!stored) return null;
  
  try {
    return JSON.parse(stored);
  } catch (error) {
    console.warn('Failed to parse persisted SDR settings cache:', error);
    safeRemoveItem(STORAGE_KEYS.SDR_SETTINGS_CACHE);
    return null;
  }
};

export const loadPersistedAutoFftOptions = () => {
  const stored = safeGetItem(STORAGE_KEYS.AUTO_FFT_OPTIONS);
  if (!stored) return null;
  
  try {
    const parsed = JSON.parse(stored);
    // Validate the structure
    if (parsed && 
        parsed.type === 'auto_fft_options' && 
        Array.isArray(parsed.autoSizes) && 
        typeof parsed.recommended === 'number') {
      return parsed;
    }
    // If invalid, remove it
    safeRemoveItem(STORAGE_KEYS.AUTO_FFT_OPTIONS);
    return null;
  } catch (error) {
    console.warn('Failed to parse persisted auto FFT options:', error);
    safeRemoveItem(STORAGE_KEYS.AUTO_FFT_OPTIONS);
    return null;
  }
};

const localStorageMiddleware = createLocalStorageMiddleware();
export default localStorageMiddleware;
