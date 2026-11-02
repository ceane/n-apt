import { createAsyncThunk } from "@reduxjs/toolkit";
import { RootState } from "@n-apt/redux/store";
import {
  SDRSettings,
  CaptureRequest,
} from "@n-apt/consts/schemas/websocket";
import { FrequencyRange } from "@n-apt/consts/types";
import {
  getFrequencyRangeCenterHz,
  normalizeFrequencyRangeToHz,
} from "@n-apt/math/frequency";
import {
  normalizePositiveHardwareRange,
} from "@n-apt/math/basebandMirror";
import { DEVICE_CONTROL_SCOPE } from "@n-apt/app/infrastructure/streams/streamContract";
import type { TxStreamOptions } from "@n-apt/app/infrastructure/streams/sourceModeStreamManager";
import { restartRequested } from "@n-apt/redux/slices/websocketSlice";
import { CLIENT_ORIGIN_ID } from "@n-apt/redux/clientOrigin";
import { clampFrameRateToProtocolLimit } from "@n-apt/math/signals";

const getSampleRateHz = (state: RootState): number | null => {
  const sampleRateHz =
    state.demod?.sampleRateHz ?? state.spectrum?.sampleRateHz;
  return Number.isFinite(sampleRateHz) && sampleRateHz > 0
    ? sampleRateHz
    : null;
};

const optionalIntegerHz = (value: unknown): number | undefined => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : undefined;
};

const buildManagedRxFrequencyOptions = (
  state: RootState,
  range: FrequencyRange,
): {
  originId: string;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  centerFrequencyHz: number;
  signalArea?: string;
} => {
  // Negative frequencies are a presentation-only mirrored baseband axis.
  // Convert them to the positive acquisition window before crossing the
  // WebSocket boundary; the Rust protocol represents absolute RF Hz.
  const normalizedRange = normalizePositiveHardwareRange(
    normalizeFrequencyRangeToHz(range),
  );
  const signalArea = state.spectrum?.activeSignalArea;
  return {
    originId: CLIENT_ORIGIN_ID,
    minFrequencyHz: Math.round(normalizedRange.min),
    maxFrequencyHz: Math.round(normalizedRange.max),
    centerFrequencyHz: getFrequencyRangeCenterHz(normalizedRange),
    ...(typeof signalArea === "string" && signalArea.trim()
      ? { signalArea }
      : {}),
  };
};

export type FrequencyRangeSyncRequest =
  | FrequencyRange
  | {
      range: FrequencyRange;
      displayRange?: FrequencyRange | null;
    };

const resolveFrequencyRangeSyncRequest = (
  request: FrequencyRangeSyncRequest,
): { range: FrequencyRange; displayRange: FrequencyRange | null } => {
  if ("range" in request) {
    return {
      range: request.range,
      displayRange: request.displayRange ?? null,
    };
  }
  return { range: request, displayRange: null };
};

const buildManagedRxSettingsOptions = (
  settings: SDRSettings,
): Record<string, unknown> => {
  const options: Record<string, unknown> = {};
  const number = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const setPositive = (
    key: string,
    value: unknown,
    map: (value: number) => number = Math.round,
  ) => {
    const numeric = number(value);
    if (numeric !== null && numeric > 0) options[key] = map(numeric);
  };

  setPositive("sampleRateHz", settings.sampleRate);
  setPositive("fftSize", settings.fftSize, Math.floor);
  if (typeof settings.fftWindow === "string" && settings.fftWindow.trim()) {
    options.fftWindow = settings.fftWindow;
  }
  const frameRate = number(settings.frameRate);
  if (frameRate !== null && frameRate > 0) {
    options.frameRate = clampFrameRateToProtocolLimit(frameRate);
  }
  const maxFrameRate = number(settings.maxFrameRate);
  if (maxFrameRate !== null && maxFrameRate > 0) {
    options.maxFrameRate = clampFrameRateToProtocolLimit(maxFrameRate);
  }
  const gain = number(settings.gain);
  if (gain !== null && gain >= 0 && gain <= 100) options.gain = gain;
  const ppm = number(settings.ppm);
  if (ppm !== null && ppm >= 0 && ppm <= 200) options.ppm = Math.round(ppm);
  const lnaGain = number(settings.hackrfLnaGain);
  if (lnaGain !== null && lnaGain >= 0 && lnaGain <= 49.6) {
    options.hackrfLnaGain = lnaGain;
  }
  const vgaGain = number(settings.hackrfVgaGain);
  if (vgaGain !== null && vgaGain >= 0 && vgaGain <= 62) {
    options.hackrfVgaGain = vgaGain;
  }
  const tunerBandwidth = number(settings.tunerBandwidth);
  if (tunerBandwidth !== null && tunerBandwidth > 0 && tunerBandwidth <= 20_000_000) {
    options.tunerBandwidth = Math.round(tunerBandwidth);
  }
  for (const [key, value] of [
    ["hackrfAmpEnable", settings.hackrfAmpEnabled],
    ["tunerAgc", settings.tunerAGC],
    ["rtlAgc", settings.rtlAGC],
    ["offsetTuning", settings.offsetTuning],
    ["mirrorSpectrumBelowZero", settings.mirrorSpectrumBelowZero],
  ] as const) {
    if (typeof value === "boolean") options[key] = value;
  }
  const directSampling = number(settings.directSampling);
  if (directSampling !== null && Number.isInteger(directSampling) && directSampling >= 0) {
    options.directSampling = directSampling;
  }
  return options;
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
  async (request: FrequencyRangeSyncRequest, { dispatch, getState }) => {
    const state = getState() as RootState;
    const { range } = resolveFrequencyRangeSyncRequest(request);
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/updateRxStreamOptions",
        payload: {
          options: buildManagedRxFrequencyOptions(state, range),
          publishMode: "gesture",
        },
      });
    }
    return range;
  },
);

export interface RequestNextLiveFrameOptions {
  sourceId?: string | null;
  /** The current viewport associated with a paused one-shot request. */
  frequencyRange?: FrequencyRange | null;
  txSettings?: {
    centerFrequencyHz?: number | null;
    viewCenterHz?: number | null;
    bandwidthHz?: number | null;
    sampleRateHz?: number | null;
    powerDbm?: number | null;
    txSignal?: string | null;
    txIfftSize?: number | null;
  };
}

const buildManagedTxOptionOverrides = (
  options?: RequestNextLiveFrameOptions,
): Partial<Omit<TxStreamOptions, "mode">> => {
  const data: Partial<Omit<TxStreamOptions, "mode">> = {};
  const txSettings = options?.txSettings;
  if (!txSettings) return data;
  if (
    typeof txSettings.centerFrequencyHz === "number" &&
    Number.isFinite(txSettings.centerFrequencyHz)
  ) {
    data.centerFrequencyHz = Math.round(txSettings.centerFrequencyHz);
  }
  if (
    typeof txSettings.viewCenterHz === "number" &&
    Number.isFinite(txSettings.viewCenterHz)
  ) {
    data.viewCenterHz = Math.round(txSettings.viewCenterHz);
  }
  if (
    typeof txSettings.bandwidthHz === "number" &&
    Number.isFinite(txSettings.bandwidthHz)
  ) {
    const bandwidthHz = Math.round(txSettings.bandwidthHz);
    data.bandwidthHz = bandwidthHz;
  }
  if (
    typeof txSettings.sampleRateHz === "number" &&
    Number.isFinite(txSettings.sampleRateHz)
  ) {
    data.sampleRateHz = Math.round(txSettings.sampleRateHz);
  }
  if (
    typeof txSettings.powerDbm === "number" &&
    Number.isFinite(txSettings.powerDbm)
  ) {
    data.powerDbm = txSettings.powerDbm;
  }
  if (typeof txSettings.txSignal === "string" && txSettings.txSignal.trim()) {
    data.signal = txSettings.txSignal;
  }
  if (
    typeof txSettings.txIfftSize === "number" &&
    Number.isFinite(txSettings.txIfftSize)
  ) {
    data.ifftSize = Math.round(txSettings.txIfftSize);
  }
  return data;
};

export const requestNextLiveFrame = createAsyncThunk(
  "websocket/requestNextLiveFrame",
  async (
    options: RequestNextLiveFrameOptions | undefined,
    { dispatch, getState },
  ) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/refreshStream",
        payload: {
          mode: options?.txSettings ? "tx" : "rx",
          options: options?.txSettings
            ? buildManagedTxOptionOverrides(options)
            : undefined,
        },
      });
    }
  },
);

export const requestNextPausedFrame = createAsyncThunk(
  "websocket/requestNextPausedFrame",
  async (
    options: RequestNextLiveFrameOptions | undefined,
    { dispatch, getState },
  ) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      const mode = options?.txSettings ? "tx" : "rx";
      const sourceId =
        typeof options?.sourceId === "string" && options.sourceId.trim()
          ? options.sourceId.trim()
          : undefined;
      const frequencyRange =
        options?.frequencyRange ?? state.spectrum?.frequencyRange;
      const rxOptions =
        mode === "rx" && frequencyRange
          ? buildManagedRxFrequencyOptions(state, frequencyRange)
          : undefined;
      dispatch({
        type: "websocket/requestManagedStreamFrame",
        payload: {
          sourceId,
          mode,
          options:
            mode === "tx"
              ? buildManagedTxOptionOverrides(options)
              : rxOptions,
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
    const requestedRange = sampleRateHz
      ? {
          min: centerHz - sampleRateHz / 2,
          max: centerHz + sampleRateHz / 2,
        }
      : { min: centerHz, max: centerHz };
    const hardwareRange = normalizePositiveHardwareRange(requestedRange);
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/updateRxStreamOptions",
        payload: {
          options: buildManagedRxFrequencyOptions(state, hardwareRange),
          publishMode: "gesture",
        },
      });
    }
    return centerHz;
  },
);

// Send SDR settings to server
export const sendSettings = createAsyncThunk(
  "websocket/sendSettings",
  async (settings: SDRSettings, { dispatch, getState }) => {
    const state = getState() as RootState;

    const options = buildManagedRxSettingsOptions(settings);

    if (Object.keys(options).length === 0) {
      console.warn(
        "[WebSocket Thunks] Ignoring settings update with no valid values",
        settings,
      );
      return settings;
    }

    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/updateRxStreamOptions",
        payload: {
          options,
          publishMode: "immediate",
        },
      });
    }

    return settings;
  },
);

// Send device restart command. When `sourceId` is provided the backend
// restarts only that source (in place, without changing the active source);
// otherwise it restarts the active device.
export const sendRestartDevice = createAsyncThunk(
  "websocket/sendRestartDevice",
  async (sourceId: string | undefined, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "restart_device",
          data: {
            scope: DEVICE_CONTROL_SCOPE,
            ...(sourceId ? { source_id: sourceId } : {}),
          },
        },
      });
      if (sourceId) {
        dispatch(restartRequested(sourceId));
      }
    }
    return sourceId ?? null;
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
          data: {
            scope: DEVICE_CONTROL_SCOPE,
            source_id: sourceId,
          },
        },
      });
    }
    return sourceId;
  },
);

// Select a source for this page's subscriber-scoped visualization without
// changing the backend's one-device active-source control path.
export const sendViewSource = createAsyncThunk(
  "websocket/sendViewSource",
  async (sourceId: string, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/viewSource",
        payload: { sourceId },
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
            sourceId: req.sourceId,
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
            fidoVault: req.fidoVault,
            sampleRateHz: req.sampleRateHz,
            fftSize: req.fftSize,
            fftWindow: req.fftWindow,
            frameRate: req.frameRate,
            geolocation: req.geolocation,
            liveMode: req.liveMode,
            refBasedDemodBaseline: req.refBasedDemodBaseline,
            captureLabels: req.captureLabels,
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
      // The backend scan protocol only accepts non-negative absolute
      // frequencies. VFO panning can briefly produce a negative visual
      // lower bound near 0 Hz, so sanitize only the wire payload here.
      const safeMinFreq = Math.max(0, Math.min(minFreq, maxFreq));
      const safeMaxFreq = Math.max(safeMinFreq, maxFreq);
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "scan",
          job_id: jobId,
          min_freq: safeMinFreq,
          max_freq: safeMaxFreq,
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
