// Redux store and hooks
export { store, useAppDispatch, useAppSelector } from './store';
export type { RootState, AppDispatch } from './store';

// Export slice actions
export {
  setAuthenticating,
  setAuthSuccess,
  setAuthFailed,
  setAuthReady,
  setHasPasskeys,
  setPasskeyRegistrationSuccess,
  clearSession,
  resetAuth,
  setInitialAuthCheckComplete,
} from './slices/authSlice';

// Import auth actions for collective export
import {
  setAuthenticating,
  setAuthSuccess,
  setAuthFailed,
  setAuthReady,
  setHasPasskeys,
  setPasskeyRegistrationSuccess,
  clearSession,
  resetAuth,
  setInitialAuthCheckComplete,
} from './slices/authSlice';

// Export collective action objects for convenience
export const authActions = {
  setAuthenticating,
  setAuthSuccess,
  setAuthFailed,
  setAuthReady,
  setHasPasskeys,
  setPasskeyRegistrationSuccess,
  clearSession,
  resetAuth,
  setInitialAuthCheckComplete,
};

export {
  createNoteCardFromSpectrum,
  hydrateNoteCards,
  updateNoteCardText,
  updateNoteCardPosition,
  updateNoteCardSize,
  attachNoteCardSnapshot,
  setActiveNoteCard,
  removeNoteCard,
  clearNoteCards,
  setNoteCardsCollapsed,
} from './slices/noteCardsSlice';

export { selectNoteCards, selectActiveNoteCard, selectNoteCardsCollapsed } from './slices/noteCardsSlice';

// Import spectrum actions for collective export
import {
  setFrequencyRange,
  setActiveSignalArea,
  setSignalAreaAndRange,
  setVizZoom,
  setVizPan,
  setDisplayMode,
  setFftDbLimits,
  setFftSize,
  setFftSizeOptions,
  setFftWindow,
  setFftFrameRate,
  setAutoFftApplied,
  setFftAvgEnabled,
  setFftSmoothEnabled,
  setWfSmoothEnabled,
  setGain,
  setPpm,
  setTunerAGC,
  setRtlAGC,
  setSampleRate,
  setSdrSettingsBundle,
  setVisualizerPaused,
  setDiagnosticStatus,
  setDiagnosticRunning,
  triggerDiagnostic,
  resetZoomAndDb,
  resetLiveControls,
  setTemporalResolution,
  setPowerScale,
} from './slices/spectrumSlice';

// Export spectrum actions as individual
export {
  setFrequencyRange,
  setActiveSignalArea,
  setSignalAreaAndRange,
  setVizZoom,
  setVizPan,
  setDisplayMode,
  setFftDbLimits,
  setFftSize,
  setFftSizeOptions,
  setFftWindow,
  setFftFrameRate,
  setAutoFftApplied,
  setFftAvgEnabled,
  setFftSmoothEnabled,
  setWfSmoothEnabled,
  setGain,
  setPpm,
  setTunerAGC,
  setRtlAGC,
  setSampleRate,
  setSdrSettingsBundle,
  setVisualizerPaused,
  setDiagnosticStatus,
  setDiagnosticRunning,
  triggerDiagnostic,
  resetZoomAndDb,
  resetLiveControls,
  setTemporalResolution,
  setPowerScale,
} from './slices/spectrumSlice';

// Export collective action objects for convenience
export const spectrumActions = {
  setFrequencyRange,
  setActiveSignalArea,
  setSignalAreaAndRange,
  setVizZoom,
  setVizPan,
  setDisplayMode,
  setFftDbLimits,
  setFftSize,
  setFftSizeOptions,
  setFftWindow,
  setFftFrameRate,
  setAutoFftApplied,
  setFftAvgEnabled,
  setFftSmoothEnabled,
  setWfSmoothEnabled,
  setGain,
  setPpm,
  setTunerAGC,
  setRtlAGC,
  setSampleRate,
  setSdrSettingsBundle,
  setVisualizerPaused,
  setDiagnosticStatus,
  setDiagnosticRunning,
  triggerDiagnostic,
  resetZoomAndDb,
  resetLiveControls,
  setTemporalResolution,
  setPowerScale,
};

export {
  setSourceMode,
  setSelectedFiles,
  setDrawSignal3D,
  setStitchPaused,
  setStitchStatus,
  setStitchSourceSettings,
  setActivePlaybackMetadata,
  clearActivePlaybackMetadata,
  incrementPlaybackFrameCounter,
  triggerStitch,
  toggleStitchPause,
  resetDrawParams,
  resetTrainingCapture,
  setGlobalNoiseFloor,
  clearWaterfall,
  resetWaterfallCleared,
} from './slices/waterfallSlice';

export {
  setAppMode,
  setAccentColor,
  setFftColor,
  setWaterfallTheme,
  resetTheme,
} from './slices/themeSlice';

// Import theme actions for collective export
import {
  setAppMode,
  setAccentColor,
  setFftColor,
  setWaterfallTheme,
  resetTheme,
  updateThemeSettings,
} from './slices/themeSlice';

// Export collective action objects for convenience
export const themeActions = {
  setAppMode,
  setAccentColor,
  setFftColor,
  setWaterfallTheme,
  resetTheme,
  updateThemeSettings,
};

export {
  setSnapshotGrid,
  setDeviceInfo,
  setCryptoCorrupted,
  resetSettings,
} from './slices/settingsSlice';

// Import websocket actions for collective export
import {
  setConnecting,
  setConnected,
  setDisconnected,
  setReconnecting,
  setError,
  updateDeviceState,
  setCaptureStatus,
  setAutoFftOptions,
  setSpectrumFrames,
  setPaused,
} from './slices/websocketSlice';

export {
  setConnecting,
  setConnected,
  setDisconnected,
  setReconnecting,
  setError,
  updateDeviceState,
  setCaptureStatus,
  setAutoFftOptions,
  setSpectrumFrames,
  setPaused,
} from './slices/websocketSlice';

// Export collective action objects for convenience
export const websocketActions = {
  setConnecting,
  setConnected,
  setDisconnected,
  setReconnecting,
  setError,
  updateDeviceState,
  setCaptureStatus,
  setAutoFftOptions,
  setSpectrumFrames,
  setPaused,
};

// Export thunks - explicit exports to prevent Safari issues
export {
  connectWebSocket,
  disconnectWebSocket,
  sendFrequencyRange,
  sendCenterFrequency,
  sendPauseCommand,
  sendSettings,
  sendRestartDevice,
  sendTrainingCommand,
  sendGetAutoFftOptions,
  sendPowerScaleCommand,
  sendCaptureCommand,
  sendCaptureStopCommand,
  sendScanCommand,
  sendDemodulateCommand,
  toggleVisualizerPause,
} from './thunks/websocketThunks';

// Export selectors - explicit exports to prevent Safari issues
export {
  selectAuthState,
  selectSpectrumState,
  selectWaterfallState,
  selectThemeState,
  selectSettingsState,
  selectWebSocketState,
  selectIsAuthenticated,
  selectAuthError,
  selectSessionToken,
  selectHasPasskeys,
  selectFrequencyRange,
  selectActiveSignalArea,
  selectPowerScale,
  selectFftSettings,
  selectVisualizationSettings,
  selectSdrSettings,
  selectDrawParams,
  selectActiveDrawParams,
  selectTrainingCaptureState,
  selectStitchState,
  selectThemeColors,
  selectConnectionState,
  selectDeviceState,
  selectDeviceSettings,
  selectSpectrumData,
  selectEffectiveFrequencyRange,
  selectSampleRateMHz,
  selectSignalAreaBounds,
  selectIsVisualizerRouteActive,
  selectThemeObject,
  selectHighFrequencyData,
  selectIsWebSocketReady,
  selectDeviceCapabilities,
} from './selectors/performanceSelectors';

// Export middleware (for advanced usage)
export { default as websocketMiddleware } from './middleware/websocketMiddleware';
export { default as localStorageMiddleware } from './middleware/localStorageMiddleware';

// Export persistence helpers
export {
  loadPersistedTheme,
  loadPersistedSdrSettings,
  loadPersistedPasskeys,
  loadPersistedSpectrumFrames,
  loadPersistedSdrSettingsCache,
} from './middleware/localStorageMiddleware';
