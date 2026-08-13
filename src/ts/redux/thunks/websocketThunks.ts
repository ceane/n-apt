import { createAsyncThunk } from "@reduxjs/toolkit";
import { RootState } from "@n-apt/redux/store";
import {
  SDRSettings,
  CaptureRequest,
  SourceInfo,
  SpectrumFrame,
} from "@n-apt/consts/schemas/websocket";
import { FrequencyRange } from "@n-apt/consts/types";
import {
  getFrequencyRangeCenterHz,
  normalizeFrequencyRangeToHz,
} from "@n-apt/math/frequency";
import { normalizePositiveHardwareRange } from "@n-apt/math/basebandMirror";
import {
  isHackrfDevice,
  isRtlSdrDevice,
} from "@n-apt/app/infrastructure/io/sdrSampleRateGuards";

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
  // Negative frequencies are a presentation-only mirrored baseband axis.
  // Convert them to the positive acquisition window before crossing the
  // WebSocket boundary; the Rust protocol represents absolute RF Hz.
  const normalizedRange = normalizePositiveHardwareRange(
    normalizeFrequencyRangeToHz(range),
  );
  const center_frequency = getFrequencyRangeCenterHz(normalizedRange);
  return {
    min_hz: normalizedRange.min,
    max_hz: normalizedRange.max,
    center_frequency,
  };
};

const optionalIntegerHz = (value: unknown): number | undefined => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : undefined;
};

export const resolveWholeChannelSampleRateForSourceSwitch = ({
  source,
  channels,
  activeSignalArea,
}: {
  source: Pick<SourceInfo, "id" | "kind" | "name" | "sdr"> | null | undefined;
  channels: SpectrumFrame[];
  activeSignalArea?: string | null;
}): number | null => {
  if (
    !source ||
    isRtlSdrDevice({
      deviceKind: source.kind,
      backend: source.kind,
      deviceName: source.name,
    })
  ) {
    return null;
  }

  const requestedArea = activeSignalArea?.trim().toLowerCase();
  const channel =
    channels.find(
      (candidate) =>
        requestedArea && candidate.label?.trim().toLowerCase() === requestedArea,
    ) ?? channels[0];
  if (
    !channel ||
    !Number.isFinite(channel.min_hz) ||
    !Number.isFinite(channel.max_hz)
  ) {
    return null;
  }

  const channelSpan = Math.abs(channel.max_hz - channel.min_hz);
  if (!Number.isFinite(channelSpan) || channelSpan <= 0) return null;

  // Mock Tx is a synthetic monitor. Its 2.4 MHz Tx waveform does not limit
  // the visualizer's explicit Whole Channel receive view.
  if (source.kind === "mock_tx" || source.kind === "mock-tx") {
    return Math.round(channelSpan);
  }

  const configuredMaximum = source.sdr?.max_sample_rate;
  const sourceMaximum =
    typeof configuredMaximum === "number" &&
    Number.isFinite(configuredMaximum) &&
    configuredMaximum > 0
      ? configuredMaximum
      : channelSpan;
  const maximum = isHackrfDevice({
    deviceKind: source.kind,
    backend: source.kind,
    deviceName: source.name,
  })
    ? Math.max(sourceMaximum, 20_000_000)
    : sourceMaximum;

  return Math.round(Math.min(channelSpan, maximum));
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
            bandwidth_center_frequency: optionalIntegerHz(
              (state as any).demod?.bandwidthCenterFreqHz,
            ),
          },
        },
      });
    }
    return range;
  },
);

export interface RequestNextLiveFrameOptions {
  sourceId?: string | null;
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

const buildRequestNextFrameData = (
  options?: RequestNextLiveFrameOptions,
): Record<string, unknown> => {
  const data: Record<string, unknown> = {};
  if (typeof options?.sourceId === "string" && options.sourceId.trim()) {
    data.source_id = options.sourceId.trim();
  }
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
    data.sample_rate = Math.round(txSettings.sampleRateHz);
  }
  if (
    typeof txSettings.powerDbm === "number" &&
    Number.isFinite(txSettings.powerDbm)
  ) {
    data.powerDbm = txSettings.powerDbm;
  }
  if (typeof txSettings.txSignal === "string" && txSettings.txSignal.trim()) {
    data.txSignal = txSettings.txSignal;
  }
  if (
    typeof txSettings.txIfftSize === "number" &&
    Number.isFinite(txSettings.txIfftSize)
  ) {
    data.txIfftSize = Math.round(txSettings.txIfftSize);
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
          options: options ? buildRequestNextFrameData(options) : undefined,
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
      // Standby previews are one-shot. Do not open a continuous managed Tx
      // stream; that would look like automatic transmission.
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "request_next_frame",
          data: buildRequestNextFrameData(options),
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
    const data = {
      min_hz: Math.round(hardwareRange.min),
      max_hz: Math.round(hardwareRange.max),
      center_frequency: getFrequencyRangeCenterHz({
        min: Math.round(hardwareRange.min),
        max: Math.round(hardwareRange.max),
      }),
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
      const frontendSampleRate = state.spectrum?.sampleRateHz;
      const targetSource = state.websocket.sources?.find(
        (source) => source.id === sourceId,
      );
      const targetIsHackRf =
        targetSource?.kind === "hackrf_one" ||
        sourceId.toLowerCase().includes("hackrf");
      const wholeChannelSampleRate = resolveWholeChannelSampleRateForSourceSwitch({
        source: targetSource,
        channels: state.websocket.channels ?? [],
        activeSignalArea: state.spectrum?.activeSignalArea,
      });
      const requestedSampleRate =
        wholeChannelSampleRate ??
        (targetIsHackRf &&
        typeof frontendSampleRate === "number" &&
        Number.isFinite(frontendSampleRate) &&
        frontendSampleRate > 0
          ? Math.floor(frontendSampleRate)
          : null);
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "select_source",
          data: {
            source_id: sourceId,
            ...(requestedSampleRate !== null
              ? { sample_rate: requestedSampleRate }
              : {}),
          },
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
