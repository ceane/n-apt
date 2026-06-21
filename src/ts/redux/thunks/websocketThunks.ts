import { createAsyncThunk } from "@reduxjs/toolkit";
import { RootState } from "@n-apt/redux/store";
import { SDRSettings, CaptureRequest } from "@n-apt/consts/schemas/websocket";
import { FrequencyRange } from "@n-apt/consts/types";
import {
  getFrequencyRangeCenterHz,
  normalizeFrequencyRangeToHz,
} from "@n-apt/utils/frequency";

const getSampleRateHz = (state: RootState): number | null => {
  const sampleRateHz =
    state.demod?.sampleRateHz ?? state.spectrum?.sampleRateHz;
  return Number.isFinite(sampleRateHz) && sampleRateHz > 0
    ? sampleRateHz
    : null;
};

const buildTunedFrequencyPayload = (
  state: RootState,
  range: FrequencyRange,
): { min_hz: number; max_hz: number; center_frequency: number } => {
  const normalizedRange = normalizeFrequencyRangeToHz(range);
  const center_frequency = getFrequencyRangeCenterHz(normalizedRange);
  return {
    min_hz: normalizedRange.min,
    max_hz: normalizedRange.max,
    center_frequency,
  };
};

// Connect to WebSocket
export const connectWebSocket = createAsyncThunk(
  "websocket/connect",
  async (
    {
      url,
      aesKey,
      enabled = true,
    }: { url: string; aesKey: CryptoKey | null; enabled?: boolean },
    { dispatch },
  ) => {
    dispatch({ type: "websocket/connect", payload: { url, aesKey, enabled } });
    return { url, enabled };
  },
);

// Disconnect from WebSocket
export const disconnectWebSocket = createAsyncThunk(
  "websocket/disconnect",
  async (_, { dispatch }) => {
    dispatch({ type: "websocket/disconnect" });
  },
);

// Send frequency range to server
export const sendFrequencyRange = createAsyncThunk(
  "websocket/sendFrequencyRange",
  async (range: FrequencyRange, { dispatch, getState }) => {
    const state = getState() as RootState;
    const tunedRange = buildTunedFrequencyPayload(state, range);
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data: {
            ...tunedRange,
            bandwidth_center_frequency: (state as any).demod
              ?.bandwidthCenterFreqHz,
          },
        },
      });
    }
    return range;
  },
);

export const requestNextLiveFrame = createAsyncThunk(
  "websocket/requestNextLiveFrame",
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "request_next_frame",
          data: {},
        },
      });
    }
  },
);

export const requestNextPausedFrame = createAsyncThunk(
  "websocket/requestNextPausedFrame",
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "request_next_frame",
          data: {},
        },
      });
    }
  },
);

export const sendCenterFrequency = createAsyncThunk(
  "websocket/sendCenterFrequency",
  async (centerHz: number, { dispatch, getState }) => {
    const state = getState() as RootState;
    const sampleRateHz = getSampleRateHz(state);
    const data = sampleRateHz
      ? {
          min_hz: Math.round(centerHz - sampleRateHz / 2),
          max_hz: Math.round(centerHz + sampleRateHz / 2),
          center_frequency: Math.round(centerHz),
        }
      : {
          min_hz: Math.round(centerHz),
          max_hz: Math.round(centerHz),
          center_frequency: Math.round(centerHz),
        };
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "frequency_range",
          data,
        },
      });
    }
    return centerHz;
  },
);

// Send pause/resume command
export const sendPauseCommand = createAsyncThunk(
  "websocket/sendPauseCommand",
  async (
    payload: { isPaused: boolean; sourceId: string },
    { dispatch, getState },
  ) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "pause",
          data: { paused: payload.isPaused, source_id: payload.sourceId },
        },
      });
    }
    return payload.isPaused;
  },
);

// Send SDR settings to server
export const sendSettings = createAsyncThunk(
  "websocket/sendSettings",
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

    if (
      typeof settings.fftWindow === "string" &&
      settings.fftWindow.trim().length > 0
    ) {
      sanitized.fftWindow = settings.fftWindow;
    }

    if (isValidPositiveInt(settings.frameRate)) {
      sanitized.frameRate = Math.floor(settings.frameRate!);
    }

    if (isValidPositiveInt(settings.sampleRate)) {
      sanitized.sampleRate = Math.floor(settings.sampleRate!);
    }

    if (isValidNonNegative(settings.gain)) {
      sanitized.gain = settings.gain;
    }
    if (isValidNonNegative(settings.hackrfLnaGain)) {
      sanitized.hackrfLnaGain = settings.hackrfLnaGain;
    }
    if (isValidNonNegative(settings.hackrfVgaGain)) {
      sanitized.hackrfVgaGain = settings.hackrfVgaGain;
    }
    if (typeof settings.hackrfAmpEnabled === "boolean") {
      sanitized.hackrfAmpEnabled = settings.hackrfAmpEnabled;
    }
    if (
      typeof settings.tunerBandwidth === "number" &&
      Number.isFinite(settings.tunerBandwidth) &&
      settings.tunerBandwidth >= 0
    ) {
      sanitized.tunerBandwidth = Math.round(settings.tunerBandwidth);
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
      console.warn(
        "[WebSocket Thunks] Ignoring settings update with no valid values",
        settings,
      );
      return settings;
    }

    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "settings",
          data: sanitized,
        },
      });
    }

    return settings;
  },
);

// Send device restart command
export const sendRestartDevice = createAsyncThunk(
  "websocket/sendRestartDevice",
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "restart_device",
          data: {},
        },
      });
    }
  },
);

// Request the backend to make a source the active live stream
export const sendSelectSource = createAsyncThunk(
  "websocket/sendSelectSource",
  async (sourceId: string, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "select_source",
          data: { source_id: sourceId },
        },
      });
    }
    return sourceId;
  },
);

// Send training capture command
export const sendTrainingCommand = createAsyncThunk(
  "websocket/sendTrainingCommand",
  async (
    {
      action,
      label,
      signalArea,
    }: {
      action: "start" | "stop";
      label: "target" | "noise";
      signalArea: string;
    },
    { dispatch, getState },
  ) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "training_capture",
          data: { action, label, signalArea },
        },
      });
    }
    return { action, label, signalArea };
  },
);

// Send power scale command
export const sendPowerScaleCommand = createAsyncThunk(
  "websocket/sendPowerScaleCommand",
  async (scale: "dB" | "dBm", { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "power_scale",
          data: { powerScale: scale },
        },
      });
    }
    return scale;
  },
);

// Send capture command
export const sendCaptureCommand = createAsyncThunk(
  "websocket/sendCaptureCommand",
  async (req: CaptureRequest, { dispatch, getState }) => {
    const state = getState() as RootState;

    // Optimistically clear previous capture status
    dispatch({ type: "websocket/setCaptureStatus", payload: null });

    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "capture",
          data: {
            jobId: req.jobId,
            fragments: req.fragments,
            bandwidth:
              typeof req.bandwidth === "number" &&
              Number.isFinite(req.bandwidth)
                ? Math.round(req.bandwidth)
                : undefined,
            bandwidthCenterFrequency:
              typeof req.bandwidthCenterFrequency === "number" &&
              Number.isFinite(req.bandwidthCenterFrequency)
                ? Math.round(req.bandwidthCenterFrequency)
                : undefined,
            durationMode: req.durationMode,
            durationS: req.durationS,
            fileType: req.fileType,
            acquisitionMode: req.acquisitionMode,
            encrypted: req.encrypted,
            fftSize: req.fftSize,
            fftWindow: req.fftWindow,
            geolocation: req.geolocation,
            liveMode: req.liveMode,
            refBasedDemodBaseline: req.refBasedDemodBaseline,
          },
        },
      });
    }

    return req;
  },
);

// Send capture stop command (for manual mode)
export const sendCaptureStopCommand = createAsyncThunk(
  "websocket/sendCaptureStopCommand",
  async (jobId: string | undefined, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "capture_stop",
          jobId,
        },
      });
    }
  },
);

// Send scan command
export const sendScanCommand = createAsyncThunk(
  "websocket/sendScan",
  async (
    {
      jobId,
      minFreq,
      maxFreq,
      options,
    }: { jobId: string; minFreq: number; maxFreq: number; options?: any },
    { dispatch, getState },
  ) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "scan",
          job_id: jobId,
          min_freq: minFreq,
          max_freq: maxFreq,
          options,
        },
      });
    }
  },
);

// Send demodulate command
export const sendDemodulateCommand = createAsyncThunk(
  "websocket/sendDemodulate",
  async (
    { jobId, region }: { jobId: string; region: any },
    { dispatch, getState },
  ) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "demodulate",
          job_id: jobId,
          region,
        },
      });
    }
  },
);

// Toggle visualizer pause (user action)
export const toggleVisualizerPause = createAsyncThunk(
  "websocket/toggleVisualizerPause",
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    const nextPaused = !state.websocket.isPaused;

    dispatch({
      type: "websocket/setPaused",
      payload: { isPaused: nextPaused },
    });

    return nextPaused;
  },
);
