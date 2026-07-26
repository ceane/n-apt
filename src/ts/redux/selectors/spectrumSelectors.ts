import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "../store";

const selectFftSize = (state: RootState) => state.spectrum.fftSize;
const selectFftWindow = (state: RootState) => state.spectrum.fftWindow;
const selectFftFrameRate = (state: RootState) => state.spectrum.fftFrameRate;
const selectFftMinDb = (state: RootState) => state.spectrum.fftMinDb;
const selectFftMaxDb = (state: RootState) => state.spectrum.fftMaxDb;
const selectVizZoom = (state: RootState) => state.spectrum.vizZoom;
const selectVizPanOffset = (state: RootState) => state.spectrum.vizPanOffset;
const selectVisualizerPaused = (state: RootState) =>
  state.spectrum.visualizerPaused;
const selectDisplayTemporalResolution = (state: RootState) =>
  state.spectrum.displayTemporalResolution;
const selectPowerScale = (state: RootState) => state.spectrum.powerScale;

/** Low-frequency visualizer controls owned by the Redux spectrum slice. */
export const selectSpectrumControls = createSelector(
  [
    selectFftSize,
    selectFftWindow,
    selectFftFrameRate,
    selectFftMinDb,
    selectFftMaxDb,
    selectVizZoom,
    selectVizPanOffset,
    selectVisualizerPaused,
    selectDisplayTemporalResolution,
    selectPowerScale,
  ],
  (
    fftSize,
    fftWindow,
    fftFrameRate,
    fftMinDb,
    fftMaxDb,
    vizZoom,
    vizPanOffset,
    visualizerPaused,
    displayTemporalResolution,
    powerScale,
  ) => ({
    fftSize,
    fftWindow,
    fftFrameRate,
    fftMinDb,
    fftMaxDb,
    vizZoom,
    vizPanOffset,
    visualizerPaused,
    displayTemporalResolution,
    powerScale,
  }),
);

const selectGain = (state: RootState) => state.spectrum.gain;
const selectPpm = (state: RootState) => state.spectrum.ppm;
const selectTunerAgc = (state: RootState) => state.spectrum.tunerAGC;
const selectRtlAgc = (state: RootState) => state.spectrum.rtlAGC;
const selectSampleRateHz = (state: RootState) => state.spectrum.sampleRateHz;

/** SDR controls whose authoritative serializable state is already in Redux. */
export const selectSdrControls = createSelector(
  [selectGain, selectPpm, selectTunerAgc, selectRtlAgc, selectSampleRateHz],
  (gain, ppm, tunerAGC, rtlAGC, sampleRateHz) => ({
    gain,
    ppm,
    tunerAGC,
    rtlAGC,
    sampleRateHz,
  }),
);

const selectIsConnected = (state: RootState) => state.websocket.isConnected;
const selectConnectionStatus = (state: RootState) =>
  state.websocket.connectionStatus;
const selectReconnectAttempts = (state: RootState) =>
  state.websocket.reconnectAttempts;
const selectWebSocketError = (state: RootState) => state.websocket.error;

/** Connection status without exposing the entire WebSocket slice to consumers. */
export const selectConnectionSnapshot = createSelector(
  [
    selectIsConnected,
    selectConnectionStatus,
    selectReconnectAttempts,
    selectWebSocketError,
  ],
  (isConnected, connectionStatus, reconnectAttempts, error) => ({
    isConnected,
    connectionStatus,
    reconnectAttempts,
    error,
  }),
);

const selectActiveSourceIdValue = (state: RootState) =>
  state.websocket.activeSourceId;
const selectSourcesValue = (state: RootState) => state.websocket.sources;

/** Backend-confirmed active source; this is intentionally not user selection intent. */
export const selectActiveSourceId = createSelector(
  [selectActiveSourceIdValue],
  (activeSourceId) => activeSourceId,
);

/** Source inventory exposed as a stable, narrow Redux boundary. */
export const selectSourceInventory = (state: RootState) =>
  selectSourcesValue(state);
