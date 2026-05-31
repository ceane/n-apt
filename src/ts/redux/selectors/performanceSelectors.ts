import { createSelector } from "@reduxjs/toolkit";
import { RootState } from "../store";
import type { SourceInfo } from "@n-apt/consts/schemas/websocket";

// Basic memoized selectors for individual state slices
export const selectAuthState = (state: RootState) => state.auth;
export const selectSpectrumState = (state: RootState) => state.spectrum;
export const selectWaterfallState = (state: RootState) => state.waterfall;
export const selectThemeState = (state: RootState) => state.theme;
export const selectSettingsState = (state: RootState) => state.settings;
export const selectWebSocketState = (state: RootState) => state.websocket;

// Auth selectors
export const selectIsAuthenticated = createSelector(
  [selectAuthState],
  (auth) => auth.isAuthenticated,
);

export const selectAuthError = createSelector(
  [selectAuthState],
  (auth) => auth.authError,
);

export const selectSessionToken = createSelector(
  [selectAuthState],
  (auth) => auth.sessionToken,
);

export const selectHasPasskeys = createSelector(
  [selectAuthState],
  (auth) => auth.hasPasskeys,
);

// Spectrum selectors
export const selectFrequencyRange = createSelector(
  [selectSpectrumState],
  (spectrum) => spectrum.frequencyRange,
);

export const selectActiveSignalArea = createSelector(
  [selectSpectrumState],
  (spectrum) => spectrum.activeSignalArea,
);

export const selectPowerScale = createSelector(
  [selectSpectrumState],
  (spectrum) => spectrum.powerScale,
);

export const selectFftSettings = createSelector(
  [selectSpectrumState],
  (spectrum) => ({
    fftSize: spectrum.fftSize,
    fftWindow: spectrum.fftWindow,
    fftFrameRate: spectrum.fftFrameRate,
    fftMinDb: spectrum.fftMinDb,
    fftMaxDb: spectrum.fftMaxDb,
  }),
);

export const selectVisualizationSettings = createSelector(
  [selectSpectrumState],
  (spectrum) => ({
    vizZoom: spectrum.vizZoom,
    vizPanOffset: spectrum.vizPanOffset,
    visualizerPaused: spectrum.visualizerPaused,
    displayTemporalResolution: spectrum.displayTemporalResolution,
  }),
);

export const selectSdrSettings = createSelector(
  [selectSpectrumState],
  (spectrum) => ({
    gain: spectrum.gain,
    ppm: spectrum.ppm,
    tunerAGC: spectrum.tunerAGC,
    rtlAGC: spectrum.rtlAGC,
    sampleRateHz: spectrum.sampleRateHz,
  }),
);

// Waterfall selectors
export const selectDrawParams = createSelector(
  [selectWaterfallState],
  (waterfall) => waterfall.drawParams,
);

export const selectActiveDrawParams = createSelector(
  [selectWaterfallState],
  (waterfall) =>
    waterfall.drawParams[waterfall.activeClumpIndex] || waterfall.drawParams[0],
);

export const selectTrainingCaptureState = createSelector(
  [selectWaterfallState],
  (waterfall) => ({
    isTrainingCapturing: waterfall.isTrainingCapturing,
    trainingCaptureLabel: waterfall.trainingCaptureLabel,
    trainingCapturedSamples: waterfall.trainingCapturedSamples,
  }),
);

export const selectStitchState = createSelector(
  [selectWaterfallState],
  (waterfall) => ({
    stitchStatus: waterfall.stitchStatus,
    isStitchPaused: waterfall.isStitchPaused,
    stitchTrigger: waterfall.stitchTrigger,
    stitchSourceSettings: waterfall.stitchSourceSettings,
  }),
);

// Theme selectors
export const selectThemeColors = createSelector(
  [selectThemeState],
  (theme) => ({
    accentColor: theme.accentColor,
    fftColor: theme.fftColor,
    appMode: theme.appMode,
    waterfallTheme: theme.waterfallTheme,
  }),
);

// WebSocket selectors
export const selectConnectionState = createSelector(
  [selectWebSocketState],
  (websocket) => ({
    isConnected: websocket.isConnected,
    connectionStatus: websocket.connectionStatus,
    reconnectAttempts: websocket.reconnectAttempts,
    error: websocket.error,
  }),
);

export const selectDeviceState = createSelector(
  [selectWebSocketState],
  (websocket) => ({
    activeSourceId: websocket.activeSourceId,
    activeSourceMode: websocket.activeSourceMode,
    sources: websocket.sources,
    sourceStatuses: websocket.sourceStatuses,
  }),
);

export const selectDeviceSettings = createSelector(
  [selectWebSocketState],
  (websocket) => ({
    isPaused: websocket.isPaused,
    serverPaused: websocket.serverPaused,
  }),
);

export const selectActiveSource = createSelector(
  [selectWebSocketState],
  (websocket): SourceInfo | null => {
    if (!Array.isArray(websocket.sources) || websocket.sources.length === 0) {
      return null;
    }
    return (
      websocket.sources.find(
        (source) => source.id === websocket.activeSourceId,
      ) ?? websocket.sources[0] ?? null
    );
  },
);

export const selectActiveSourceDerivedState = createSelector(
  [selectActiveSource],
  (source) => {
    if (!source) {
      return {
        deviceState: null,
        deviceName: null,
        deviceProfile: null,
        deviceInfo: null,
        backend: null,
        maxSampleRateHz: null,
        sampleRateOptions: [] as number[],
        sampleRateHz: null,
        sdrSettings: null,
      };
    }

    return {
      deviceState:
        source.status === "streaming" ? "connected" : source.status,
      deviceName: source.name,
      deviceProfile: {
        kind: source.kind,
        is_rtl_sdr: source.capability === "rx",
        supports_approx_dbm: source.supports_approx_dbm,
        supports_raw_iq_stream: source.supports_raw_iq_stream,
      },
      deviceInfo: source.name,
      backend: source.kind,
      maxSampleRateHz: source.sdr.max_sample_rate,
      sampleRateOptions: source.sdr.sample_rate_options,
      sampleRateHz: source.sdr.settings.sample_rate ?? null,
      sdrSettings: source.sdr.settings,
    };
  },
);

export const selectSpectrumData = createSelector(
  [selectWebSocketState],
  (websocket) => ({
    spectrumFrames: websocket.spectrumFrames,
    captureStatus: websocket.captureStatus,
  }),
);

// Complex computed selectors
export const selectEffectiveFrequencyRange = createSelector(
  [selectFrequencyRange, selectActiveSignalArea, selectSpectrumState],
  (frequencyRange, activeSignalArea, spectrum) => {
    if (frequencyRange) return frequencyRange;

    // Fallback to last known range for active area
    const lastKnownRanges = spectrum.lastKnownRanges;
    const lastKnown =
      lastKnownRanges && typeof lastKnownRanges === "object"
        ? lastKnownRanges[activeSignalArea]
        : null;
    return lastKnown || null;
  },
);

export const selectSampleRateHz = createSelector(
  [selectSpectrumState],
  (spectrum) => spectrum.sampleRateHz,
);

export const selectSignalAreaBounds = createSelector(
  [selectSpectrumData],
  (spectrumData) => {
    if (
      !Array.isArray(spectrumData.spectrumFrames) ||
      spectrumData.spectrumFrames.length === 0
    ) {
      return null;
    }

    const bounds: Record<string, { min: number; max: number }> = {};
    spectrumData.spectrumFrames.forEach((frame) => {
      const label = frame.label;
      if (!label) return;
      bounds[label] = { min: frame.min_hz, max: frame.max_hz };
      bounds[label.toLowerCase()] = { min: frame.min_hz, max: frame.max_hz };
    });
    return bounds;
  },
);

export const selectIsVisualizerRouteActive = createSelector(
  [() => "/"], // Default to home since router state isn't available yet
  (pathname) => pathname === "/" || pathname === "/visualizer",
);

export const selectThemeObject = createSelector(
  [selectThemeColors],
  (colors) => {
    const primaryAlpha = colors.accentColor.startsWith("#")
      ? `${colors.accentColor}33`
      : colors.accentColor;
    const primaryAnchor = colors.accentColor.startsWith("#")
      ? `${colors.accentColor}1a`
      : colors.accentColor;

    return {
      primary: colors.accentColor,
      primaryAlpha,
      primaryAnchor,
      fft: colors.fftColor,
      mode: colors.appMode,
      waterfallTheme: colors.waterfallTheme,
    };
  },
);

// selectHighFrequencyData: live frame data is now in liveDataRef (middleware module ref),
// not in Redux state. Import liveDataRef from websocketMiddleware directly instead.
// This selector is kept as a no-op stub for backward compatibility only.
export const selectHighFrequencyData = (_state: any) => null;

// Selector for WebSocket connection readiness
export const selectIsWebSocketReady = createSelector(
  [selectConnectionState, selectActiveSourceDerivedState],
  (connection, device) => {
    return (
      connection.isConnected &&
      connection.connectionStatus === "connected" &&
      device.deviceState !== null
    );
  },
);

// Selector for device capabilities
export const selectDeviceCapabilities = createSelector(
  [selectActiveSourceDerivedState],
  (device) => ({
    supportsApproxDbm: device.deviceProfile?.supports_approx_dbm || false,
    supportsRawIqStream: device.deviceProfile?.supports_raw_iq_stream || false,
    isRtlSdr: device.deviceProfile?.is_rtl_sdr || false,
  }),
);
