import { createAsyncThunk } from '@reduxjs/toolkit';
import { RootState } from '../store';
import {
  FrequencyRange,
  SDRSettings,
  CaptureRequest,
} from '@n-apt/consts/schemas/websocket';

const getSampleRateHz = (state: RootState): number | null => {
  const candidates = [
    state.websocket.sdrSettings?.sample_rate,
    state.websocket.sampleRateHz,
    state.spectrum.sampleRateHz,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
};

const buildTunedFrequencyPayload = (
  state: RootState,
  range: FrequencyRange,
): { min_mhz: number; max_mhz: number } => {
  const centerMHz = (range.min + range.max) / 2;
  const sampleRateHz = getSampleRateHz(state);
  if (!sampleRateHz) {
    return {
      min_mhz: range.min,
      max_mhz: range.max,
    };
  }
  const halfSpanMHz = sampleRateHz / 2_000_000;
  return {
    min_mhz: centerMHz - halfSpanMHz,
    max_mhz: centerMHz + halfSpanMHz,
  };
};

// Connect to WebSocket
export const connectWebSocket = createAsyncThunk(
  'websocket/connect',
  async ({ url, aesKey, enabled = true }: { url: string; aesKey: CryptoKey | null; enabled?: boolean }, { dispatch }) => {
    dispatch({ type: 'websocket/connect', payload: { url, aesKey, enabled } });
    return { url, enabled };
  }
);

// Disconnect from WebSocket
export const disconnectWebSocket = createAsyncThunk(
  'websocket/disconnect',
  async (_, { dispatch }) => {
    dispatch({ type: 'websocket/disconnect' });
  }
);

// Send frequency range to server
export const sendFrequencyRange = createAsyncThunk(
  'websocket/sendFrequencyRange',
  async (range: FrequencyRange, { dispatch, getState }) => {
    const state = getState() as RootState;
    const tunedRange = buildTunedFrequencyPayload(state, range);
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'frequency_range',
          data: tunedRange,
        },
      });
    }
    return range;
  }
);

export const sendCenterFrequency = createAsyncThunk(
  'websocket/sendCenterFrequency',
  async (centerMHz: number, { dispatch, getState }) => {
    const state = getState() as RootState;
    const sampleRateHz = getSampleRateHz(state);
    const data = sampleRateHz
      ? {
          min_mhz: centerMHz - sampleRateHz / 2_000_000,
          max_mhz: centerMHz + sampleRateHz / 2_000_000,
        }
      : {
          min_mhz: centerMHz,
          max_mhz: centerMHz,
        };
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'frequency_range',
          data,
        },
      });
    }
    return centerMHz;
  }
);

// Send pause/resume command
export const sendPauseCommand = createAsyncThunk(
  'websocket/sendPauseCommand',
  async (isPaused: boolean, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'pause',
          data: { paused: isPaused },
        },
      });
    }
    return isPaused;
  }
);

// Send SDR settings to server
export const sendSettings = createAsyncThunk(
  'websocket/sendSettings',
  async (settings: SDRSettings, { dispatch, getState }) => {
    const state = getState() as RootState;
    
    // Validate and sanitize settings
    const sanitized: Record<string, unknown> = {};
    
    const isValidPositiveInt = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value > 0;
    const isValidNonNegative = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0;
    
    if (isValidPositiveInt(settings.fftSize)) {
      sanitized.fftSize = Math.floor(settings.fftSize!);
    }
    
    if (typeof settings.fftWindow === "string" && settings.fftWindow.trim().length > 0) {
      sanitized.fftWindow = settings.fftWindow;
    }
    
    if (isValidPositiveInt(settings.frameRate)) {
      sanitized.frameRate = Math.floor(settings.frameRate!);
    }
    
    if (isValidNonNegative(settings.gain)) {
      sanitized.gain = settings.gain;
    }
    
    if (typeof settings.ppm === "number" && Number.isFinite(settings.ppm)) {
      sanitized.ppm = Math.round(settings.ppm);
    }
    
    if (typeof settings.tunerAGC === "boolean") {
      sanitized.tunerAGC = settings.tunerAGC;
    }
    
    if (typeof settings.rtlAGC === "boolean") {
      sanitized.rtlAGC = settings.rtlAGC;
    }
    
    if (Object.keys(sanitized).length === 0) {
      console.warn("[WebSocket Thunks] Ignoring settings update with no valid values", settings);
      return settings;
    }

    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'settings',
          data: sanitized,
        },
      });
    }
    
    return settings;
  }
);

// Send device restart command
export const sendRestartDevice = createAsyncThunk(
  'websocket/sendRestartDevice',
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'restart_device',
          data: {},
        },
      });
    }
  }
);

// Send training capture command
export const sendTrainingCommand = createAsyncThunk(
  'websocket/sendTrainingCommand',
  async (
    { action, label, signalArea }: { action: "start" | "stop"; label: "target" | "noise"; signalArea: string },
    { dispatch, getState }
  ) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'training_capture',
          data: { action, label, signalArea },
        },
      });
    }
    return { action, label, signalArea };
  }
);

// Request auto FFT options
export const sendGetAutoFftOptions = createAsyncThunk(
  'websocket/sendGetAutoFftOptions',
  async (screenWidth: number, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'get_auto_fft_options',
          data: { screenWidth },
        },
      });
    }
    return screenWidth;
  }
);

// Send power scale command
export const sendPowerScaleCommand = createAsyncThunk(
  'websocket/sendPowerScaleCommand',
  async (scale: "dB" | "dBm", { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'power_scale',
          data: { powerScale: scale },
        },
      });
    }
    return scale;
  }
);

// Send capture command
export const sendCaptureCommand = createAsyncThunk(
  'websocket/sendCaptureCommand',
  async (req: CaptureRequest, { dispatch, getState }) => {
    const state = getState() as RootState;
    
    // Optimistically clear previous capture status
    dispatch({ type: 'websocket/setCaptureStatus', payload: null });
    
    if (state.websocket.isConnected) {
      dispatch({
        type: 'websocket/sendMessage',
        payload: {
          type: 'capture',
          data: {
            jobId: req.jobId,
            fragments: req.fragments,
            durationS: req.durationS,
            fileType: req.fileType,
            acquisitionMode: req.acquisitionMode,
            encrypted: req.encrypted,
            fftSize: req.fftSize,
            fftWindow: req.fftWindow,
            geolocation: req.geolocation,
          },
        },
      });
    }
    
    return req;
  }
);

// Toggle visualizer pause (user action)
export const toggleVisualizerPause = createAsyncThunk(
  'websocket/toggleVisualizerPause',
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    const nextPaused = !state.websocket.isPaused;
    
    dispatch({
      type: 'websocket/setPaused',
      payload: { isPaused: nextPaused },
    });
    
    return nextPaused;
  }
);
