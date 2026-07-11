import { Middleware, Dispatch } from "@reduxjs/toolkit";
import {
  setConnecting,
  setConnected,
  setDisconnected,
  setReconnecting,
  setError,
  updateDeviceState,
  setCaptureStatus,
  setCryptoCorrupted,
  queueMessage,
  clearQueuedMessages,
  incrementDataFrameCounter,
  setSpectrumFrames,
} from "../slices/websocketSlice";
import {
  setSignalAreaAndRange,
  setFrequencyRange,
} from "../slices/spectrumSlice";
import { setHardwareInfo } from "../slices/demodSlice";
import { decryptPayload, decryptBinaryPayload } from "@n-apt/crypto/webcrypto";
import {
  type DeviceState,
  type SourceErrorMessage,
  type SourceInfo,
  type SourceInfoMessage,
  type SourceSdrSettingsMessage,
  type SourceStatusMessage,
  type IqRawFrame,
  type SpectrumFrame,
} from "@n-apt/consts/schemas/websocket";
import { scannerWorkerManager } from "@n-apt/workers/scannerWorkerManager";
import {
  processWebSocketMessageWithValidation,
  isValidChannelsMessageEnhanced,
  isValidSourceInfoMessage,
  isValidSourceStatusMessage,
  isValidSourceSdrSettingsMessage,
  isValidSourceErrorMessage,
  isValidActiveSourceMessage,
} from "@n-apt/validation";

// Module-level ref for high-frequency live frame data.
// Written directly — never goes through Redux state — so no React rerenders per frame.
export const liveDataRef: { current: IqRawFrame[] | IqRawFrame | null } = {
  current: [],
};

// Tracks the requested/selected source during transition to filter out old frames
let requestedSourceId: string | null = null;


/** Keep the client frame gate aligned with the server's active-source mode. */
export const isSourceModePaused = (sourceMode: unknown): boolean =>
  sourceMode === "file";

const shallowEqualObject = (
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

const equalArrayValues = (
  a: unknown[] | null | undefined,
  b: unknown[] | null | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!equalValue(left, right)) {
      return false;
    }
  }
  return true;
};

const equalValue = (current: unknown, next: unknown): boolean => {
  if (current === next) return true;
  if (Array.isArray(current) && Array.isArray(next)) {
    return equalArrayValues(current, next);
  }
  if (
    current &&
    next &&
    typeof current === "object" &&
    typeof next === "object"
  ) {
    return shallowEqualObject(
      current as Record<string, unknown>,
      next as Record<string, unknown>,
    );
  }
  return false;
};

const getDeviceKindFromSource = (source: SourceInfo): string => {
  const kind = source.kind?.toLowerCase?.() ?? "";
  const capability = source.capability?.toLowerCase?.() ?? "";
  if (
    kind === "hackrf_one" ||
    kind === "mock_tx" ||
    kind === "tx_rx" ||
    kind === "tx" ||
    kind === "mock_apt"
  ) {
    return kind;
  }
  if (
    kind.includes("mock_apt") ||
    kind.includes("mock-apt") ||
    source.id === "mock-apt"
  ) {
    return "mock_apt";
  }
  if (capability === "mock" || kind.includes("mock")) return "mock_tx";
  if (capability.includes("tx")) return "tx";
  return source.kind;
};

const deriveLegacyStateFromSource = (source: SourceInfo) => {
  const sourceStatus = source.status ?? "disconnected";
  const sourceGain = source.sdr.settings.gain;
  const tunerGain =
    typeof sourceGain === "number" ? sourceGain : sourceGain?.tuner_gain;
  return {
    deviceState: sourceStatus,
    deviceLoadingReason: sourceStatus === "loading" ? "connect" : null,
    backend: source.kind,
    deviceInfo: source.name,
    deviceName: source.name,
    deviceProfile: {
      kind: getDeviceKindFromSource(source),
      is_rtl_sdr: source.capability === "rx",
      supports_approx_dbm: source.supports_approx_dbm,
      supports_raw_iq_stream: source.supports_raw_iq_stream,
    },
    maxSampleRateHz: source.sdr.max_sample_rate,
    sampleRateOptions: source.sdr.sample_rate_options,
    sampleRateHz: source.sdr.settings.sample_rate ?? null,
    sdrSettings: {
      fftSize: source.sdr.settings.fft_size,
      fftWindow: source.sdr.settings.fft_window,
      frameRate: source.sdr.settings.frame_rate,
      sampleRate: source.sdr.settings.sample_rate,
      gain: tunerGain,
      hackrfLnaGain: source.sdr.settings.hackrf_lna_gain,
      hackrfVgaGain: source.sdr.settings.hackrf_vga_gain,
      hackrfAmpEnabled: source.sdr.settings.hackrf_amp_enable,
      ppm: source.sdr.settings.ppm,
      tunerAGC: source.sdr.settings.tuner_agc,
      rtlAGC: source.sdr.settings.rtl_agc,
    },
    sdrLimitMarkers: source.sdr.fft_display.markers,
  };
};

const mapSourceStatusToDeviceState = (
  status: SourceInfo["status"],
): DeviceState => {
  return status;
};

const normalizeTxIdentity = (value: unknown): string =>
  typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "")
    : "";

const normalizeDeviceActiveMode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "rx" || normalized === "tx" || normalized === "rx_tx"
    ? normalized
    : null;
};

const isTxModeActiveMode = (value: unknown): boolean => {
  const normalized = normalizeDeviceActiveMode(value);
  return normalized === "tx" || normalized === "rx_tx";
};

const isMockTxIdentity = (value: unknown): boolean => {
  const normalized = normalizeTxIdentity(value);
  return normalized === "mocktx" || normalized === "mocktxsdr";
};

const sourceMatchesTxRequest = (
  source: SourceInfo,
  data: Record<string, unknown>,
): boolean => {
  const serialNumber = normalizeTxIdentity(data.serialNumber);
  const txDevice = normalizeTxIdentity(data.txDevice);
  const sourceId = normalizeTxIdentity(source.id);
  const sourceSerial = normalizeTxIdentity(source.serial_number);
  const sourceName = normalizeTxIdentity(source.name);

  if (
    serialNumber &&
    (serialNumber === sourceId || serialNumber === sourceSerial)
  ) {
    return true;
  }

  if (txDevice && (txDevice === sourceName || txDevice === sourceId)) {
    return true;
  }

  return (
    (isMockTxIdentity(data.serialNumber) || isMockTxIdentity(data.txDevice)) &&
    (source.kind === "mock_tx" || source.id === "mock-tx")
  );
};

const applyOptimisticTransmitStatus = (
  dispatch: Dispatch,
  getState: () => any,
  data: Record<string, unknown>,
) => {
  const enabled = isTxModeActiveMode(data.active_mode);
  const websocketState = getState().websocket;
  const currentSources: SourceInfo[] = websocketState.sources ?? [];
  if (currentSources.length === 0) {
    return;
  }

  const targetSource =
    currentSources.find((source) => sourceMatchesTxRequest(source, data)) ??
    currentSources.find(
      (source) =>
        source.capability === "tx" ||
        source.capability === "tx_rx" ||
        source.kind === "mock_tx",
    );
  if (!targetSource) {
    return;
  }

  const nextStatus: SourceInfo["status"] = enabled
    ? "transmitting"
    : "connected";
  const nextSources = currentSources.map((source) => {
    if (source.id === targetSource.id) {
      return { ...source, status: nextStatus };
    }
    if (enabled && source.status === "transmitting") {
      return { ...source, status: "connected" as const };
    }
    return source;
  });
  const nextSourceStatuses = Object.fromEntries(
    nextSources.map((source) => [source.id, source.status]),
  );
  const activeSource =
    nextSources.find((source) => source.id === websocketState.activeSourceId) ??
    nextSources.find((source) => source.id === targetSource.id) ??
    nextSources[0] ??
    null;
  const derived = activeSource ? deriveLegacyStateFromSource(activeSource) : {};

  dispatch(
    updateDeviceState({
      sources: nextSources,
      sourceStatuses: nextSourceStatuses,
      ...derived,
    }),
  );
};

interface WebSocketInstance {
  ws: WebSocket | null;
  reconnectTimeout: number | null;
  disconnectTimeout: number | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  url: string;
  aesKey: CryptoKey | null;
  enabled: boolean;
  disposed: boolean;
}

interface SourceIqWebSocketInstance {
  ws: WebSocket | null;
  url: string;
  sourceId: string | null;
  reconnectTimeout: number | null;
}

// Store WebSocket instance reference in middleware closure
let wsInstance: WebSocketInstance = {
  ws: null,
  reconnectTimeout: null,
  disconnectTimeout: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  url: "",
  aesKey: null,
  enabled: false,
  disposed: false,
};

let sourceIqWsInstance: SourceIqWebSocketInstance = {
  ws: null,
  url: "",
  sourceId: null,
  reconnectTimeout: null,
};

// Batching for high-frequency data
let dataBatchFrame: number | null = null;
let pendingDataUpdate: any = null;
let statusBatchFrame: number | null = null;
let pendingStatusUpdates: any = null;
let allowNextPausedFrame = false;
let pausedFrameRequestInFlight = false;
const MAX_RETAINED_LIVE_FRAMES = 8;
const DISCONNECT_GRACE_MS = 150;
const DUPLICATE_FREQUENCY_RANGE_SUPPRESSION_MS = 500;
// RATIONALE for Auto FFT:
// 1. Screen widths are typically smaller than the FFT size (which is width-based).
// 2. Performance: Smaller FFTs save resources; higher resolution (larger FFT) should be reserved for zoom states.
let lastSettingsRequest: { fft_size?: number; timestamp: number } | null = null;
let lastFrameRequestTime = 0;
let pendingTrailingFrameRequestTimeout: ReturnType<typeof setTimeout> | null =
  null;
const FRAME_REQUEST_THROTTLE_MS = 100;
const RETUNE_CENTER_TOLERANCE_HZ = 10;
const RETUNE_WATCHDOG_GRACE_MS = 500;
const RETUNE_WATCHDOG_MIN_MISMATCH_FRAMES = 8;
const RETUNE_WATCHDOG_RESEND_MS = 1000;
let lastFrequencyRangeRequest: {
  data: any;
  centerHz: number;
  requestedAt: number;
  lastResendAt: number;
  mismatchFrames: number;
} | null = null;
let lastFrequencyRangeSendKey: string | null = null;
let lastFrequencyRangeSendAt = 0;

const roundHzField = (value: unknown): number | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.round(numeric);
};

export const normalizeFrequencyRangeMessageData = (
  type: string,
  data: any,
): any => {
  if (type !== "frequency_range" && type !== "set_frequency_range") {
    return data;
  }

  const normalized = { ...(data ?? {}) };
  const integerFields = [
    "min_hz",
    "max_hz",
    "min_freq",
    "max_freq",
    "center_frequency",
    "bandwidth_center_frequency",
  ] as const;

  for (const field of integerFields) {
    if (normalized[field] !== undefined && normalized[field] !== null) {
      const rounded = roundHzField(normalized[field]);
      if (rounded === undefined) {
        delete normalized[field];
      } else {
        normalized[field] = rounded;
      }
    }
  }

  return normalized;
};

export const buildSourceIqWebSocketUrl = (
  controlUrl: string,
  source: Pick<SourceInfo, "id" | "stream_key"> | null | undefined,
): string | null => {
  const streamKey = source?.stream_key?.trim() || source?.id?.trim();
  if (!controlUrl || !streamKey) return null;

  const url = new URL(controlUrl, window.location.href);
  url.pathname = url.pathname.replace(/\/ws\/?$/, "/ws");
  url.pathname = `${url.pathname}/source/${encodeURIComponent(streamKey)}/iq`;
  return url.toString();
};

export const collapsePausedFrameBatch = <T>(data: T | T[]): T => {
  return Array.isArray(data) ? data[data.length - 1] : data;
};

export const trimLiveFrameQueue = <T>(frames: T[]): T[] => {
  return frames.length > MAX_RETAINED_LIVE_FRAMES
    ? frames.slice(-MAX_RETAINED_LIVE_FRAMES)
    : frames;
};

const trimPendingDataUpdate = () => {
  if (Array.isArray(pendingDataUpdate)) {
    pendingDataUpdate = trimLiveFrameQueue(pendingDataUpdate);
  }
};

export const shouldAcceptPausedFrameRequest = (): boolean => {
  if (pausedFrameRequestInFlight) {
    return false;
  }
  pausedFrameRequestInFlight = true;
  return true;
};

export const resetPausedFrameRequestGate = (): void => {
  pausedFrameRequestInFlight = false;
};

export const resetWebSocketMiddlewareState = (): void => {
  lastSettingsRequest = null;
  lastFrameRequestTime = 0;
  lastFrequencyRangeRequest = null;
  lastFrequencyRangeSendKey = null;
  lastFrequencyRangeSendAt = 0;
  allowNextPausedFrame = false;
  pendingDataUpdate = null;
  pendingStatusUpdates = null;
  liveDataRef.current = null;
  resetPausedFrameRequestGate();
  if (dataBatchFrame !== null) {
    cancelAnimationFrame(dataBatchFrame);
    dataBatchFrame = null;
  }
  if (statusBatchFrame !== null) {
    cancelAnimationFrame(statusBatchFrame);
    statusBatchFrame = null;
  }
  if (wsInstance.ws) {
    wsInstance.ws.onclose = null;
    wsInstance.ws.onerror = null;
    wsInstance.ws.onmessage = null;
    wsInstance.ws.onopen = null;
    wsInstance.ws = null;
  }
  if (sourceIqWsInstance.ws) {
    sourceIqWsInstance.ws.onclose = null;
    sourceIqWsInstance.ws.onerror = null;
    sourceIqWsInstance.ws.onmessage = null;
    sourceIqWsInstance.ws.onopen = null;
    sourceIqWsInstance.ws.close();
    sourceIqWsInstance.ws = null;
  }
  if (sourceIqWsInstance.reconnectTimeout !== null) {
    clearTimeout(sourceIqWsInstance.reconnectTimeout);
    sourceIqWsInstance.reconnectTimeout = null;
  }
  sourceIqWsInstance.url = "";
  sourceIqWsInstance.sourceId = null;
  if (wsInstance.reconnectTimeout !== null) {
    clearTimeout(wsInstance.reconnectTimeout);
    wsInstance.reconnectTimeout = null;
  }
  if (wsInstance.disconnectTimeout !== null) {
    clearTimeout(wsInstance.disconnectTimeout);
    wsInstance.disconnectTimeout = null;
  }
  wsInstance.reconnectTimeout = null;
  wsInstance.disconnectTimeout = null;
  wsInstance.reconnectAttempts = 0;
  wsInstance.url = "";
  wsInstance.aesKey = null;
  wsInstance.enabled = false;
  wsInstance.disposed = false;
};

// Process batched data updates — writes directly to liveDataRef, no Redux dispatch.
const processBatchedData = (dispatch: Dispatch, getState: () => any) => {
  if (pendingDataUpdate !== null) {
    const state = getState();
    const isPaused = state.websocket.isPaused;
    const sourceMode = state.waterfall?.sourceMode;
    const isFileSource = sourceMode === "file";
    const activeSourceId = state.websocket.activeSourceId;
    const activeSource = (state.websocket.sources ?? []).find(
      (source: SourceInfo) => source.id === activeSourceId,
    );
    const isActiveMockTxTransmitting =
      activeSourceId === "mock-tx" &&
      (activeSource?.status === "transmitting" ||
        state.websocket.sourceStatuses?.[activeSourceId] === "transmitting");
    const isActiveMockTxStandby =
      activeSourceId === "mock-tx" && !isActiveMockTxTransmitting;
    if (
      ((!isPaused && !isActiveMockTxStandby) ||
        allowNextPausedFrame ||
        isActiveMockTxTransmitting) &&
      !isFileSource
    ) {
      if (
        (isPaused || isActiveMockTxStandby) &&
        allowNextPausedFrame &&
        !isActiveMockTxTransmitting
      ) {
        liveDataRef.current = collapsePausedFrameBatch(pendingDataUpdate);
      } else if (Array.isArray(pendingDataUpdate)) {
        if (Array.isArray(liveDataRef.current)) {
          liveDataRef.current.push(...pendingDataUpdate);
        } else if (liveDataRef.current) {
          liveDataRef.current = [liveDataRef.current, ...pendingDataUpdate];
        } else {
          liveDataRef.current = [...pendingDataUpdate];
        }
      } else {
        if (Array.isArray(liveDataRef.current)) {
          liveDataRef.current.push(pendingDataUpdate);
        } else if (liveDataRef.current) {
          liveDataRef.current = [liveDataRef.current, pendingDataUpdate];
        } else {
          liveDataRef.current = pendingDataUpdate;
        }
      }
      if (Array.isArray(liveDataRef.current)) {
        liveDataRef.current = trimLiveFrameQueue(liveDataRef.current);
      }
      // Dispatch action to trigger state machine updates
      dispatch(incrementDataFrameCounter());
      allowNextPausedFrame = false;
      resetPausedFrameRequestGate();
    }
    pendingDataUpdate = null;
  }
  dataBatchFrame = null;
};

const processBatchedStatus = (dispatch: Dispatch, getState: () => any) => {
  if (pendingStatusUpdates !== null) {
    const websocketState = getState().websocket;
    const hasChanges = Object.entries(pendingStatusUpdates).some(
      ([key, value]) => {
        return !equalValue(websocketState[key], value);
      },
    );
    if (hasChanges) {
      dispatch(updateDeviceState(pendingStatusUpdates));
    }
    pendingStatusUpdates = null;
  }
  syncSourceIqSocket(dispatch, getState);
  statusBatchFrame = null;
};

const applyStatusUpdates = (
  dispatch: Dispatch,
  getState: () => any,
  updates: Record<string, unknown>,
) => {
  const websocketState = getState().websocket;
  const hasChanges = Object.entries(updates).some(([key, value]) => {
    return !equalValue(websocketState[key], value);
  });
  if (hasChanges) {
    dispatch(updateDeviceState(updates));
  }
  syncSourceIqSocket(dispatch, getState);
};

const getPausedValue = (payload: unknown): boolean | null => {
  if (typeof payload === "boolean") {
    return payload;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "isPaused" in payload &&
    typeof (payload as { isPaused?: unknown }).isPaused === "boolean"
  ) {
    return (payload as { isPaused: boolean }).isPaused;
  }

  return null;
};

const getPauseDuplexMode = (payload: unknown): string | null => {
  if (
    payload &&
    typeof payload === "object" &&
    "duplexMode" in payload &&
    typeof (payload as { duplexMode?: unknown }).duplexMode === "string" &&
    (payload as { duplexMode: string }).duplexMode.trim().length > 0
  ) {
    return (payload as { duplexMode: string }).duplexMode;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "duplex_mode" in payload &&
    typeof (payload as { duplex_mode?: unknown }).duplex_mode === "string" &&
    (payload as { duplex_mode: string }).duplex_mode.trim().length > 0
  ) {
    return (payload as { duplex_mode: string }).duplex_mode;
  }

  return null;
};

const getPauseActiveMode = (payload: unknown): string | null => {
  const normalized = normalizeDeviceActiveMode(
    payload && typeof payload === "object" && "activeMode" in payload
      ? (payload as { activeMode?: unknown }).activeMode
      : undefined,
  );
  if (normalized) return normalized;

  return normalizeDeviceActiveMode(
    payload && typeof payload === "object" && "active_mode" in payload
      ? (payload as { active_mode?: unknown }).active_mode
      : undefined,
  );
};

const getPauseSourceId = (payload: unknown): string | null => {
  if (
    payload &&
    typeof payload === "object" &&
    "sourceId" in payload &&
    typeof (payload as { sourceId?: unknown }).sourceId === "string" &&
    (payload as { sourceId: string }).sourceId.trim().length > 0
  ) {
    return (payload as { sourceId: string }).sourceId;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "source_id" in payload &&
    typeof (payload as { source_id?: unknown }).source_id === "string" &&
    (payload as { source_id: string }).source_id.trim().length > 0
  ) {
    return (payload as { source_id: string }).source_id;
  }

  return null;
};

export const isFrameStale = (_centerFrequencyHz: number): boolean => false;

export const getFrequencyRequestCenterHz = (
  type: string,
  data: any,
): number | null => {
  if (type !== "frequency_range" && type !== "set_frequency_range") {
    return null;
  }

  const explicitCenter = Number(data?.center_frequency);
  if (Number.isFinite(explicitCenter) && explicitCenter > 0) {
    return explicitCenter;
  }

  const minHz = Number(data?.min_hz ?? data?.min_freq);
  const maxHz = Number(data?.max_hz ?? data?.max_freq);
  if (Number.isFinite(minHz) && Number.isFinite(maxHz) && maxHz >= minHz) {
    return (minHz + maxHz) / 2;
  }

  return null;
};

export const shouldResendRetuneRequest = ({
  expectedCenterHz,
  frameCenterHz,
  requestedAt,
  lastResendAt,
  mismatchFrames,
  now,
}: {
  expectedCenterHz: number;
  frameCenterHz: number;
  requestedAt: number;
  lastResendAt: number;
  mismatchFrames: number;
  now: number;
}): boolean => {
  if (
    Math.abs(frameCenterHz - expectedCenterHz) <= RETUNE_CENTER_TOLERANCE_HZ
  ) {
    return false;
  }
  if (now - requestedAt < RETUNE_WATCHDOG_GRACE_MS) {
    return false;
  }
  if (mismatchFrames < RETUNE_WATCHDOG_MIN_MISMATCH_FRAMES) {
    return false;
  }
  return now - lastResendAt >= RETUNE_WATCHDOG_RESEND_MS;
};

const trackFrequencyRangeRequest = (type: string, data: any) => {
  const centerHz = getFrequencyRequestCenterHz(type, data);
  if (centerHz === null) return;

  const requestKey = JSON.stringify({
    type,
    centerHz,
    min_hz: Number(data?.min_hz ?? data?.min_freq ?? null),
    max_hz: Number(data?.max_hz ?? data?.max_freq ?? null),
    bandwidth_center_frequency: Number(
      data?.bandwidth_center_frequency ?? null,
    ),
  });

  const now = Date.now();
  if (
    lastFrequencyRangeSendKey === requestKey &&
    now - lastFrequencyRangeSendAt < DUPLICATE_FREQUENCY_RANGE_SUPPRESSION_MS
  ) {
    return;
  }
  lastFrequencyRangeSendKey = requestKey;
  lastFrequencyRangeSendAt = now;

  lastFrequencyRangeRequest = {
    data,
    centerHz,
    requestedAt: Date.now(),
    lastResendAt: 0,
    mismatchFrames: 0,
  };
};

const shouldSuppressDuplicateFrequencyRangeSend = (
  type: string,
  data: any,
): boolean => {
  if (type !== "frequency_range" && type !== "set_frequency_range") {
    return false;
  }

  const requestKey = JSON.stringify({
    type,
    centerHz: getFrequencyRequestCenterHz(type, data),
    min_hz: Number(data?.min_hz ?? data?.min_freq ?? null),
    max_hz: Number(data?.max_hz ?? data?.max_freq ?? null),
    bandwidth_center_frequency: Number(
      data?.bandwidth_center_frequency ?? null,
    ),
  });

  const now = Date.now();
  if (
    lastFrequencyRangeSendKey === requestKey &&
    now - lastFrequencyRangeSendAt < DUPLICATE_FREQUENCY_RANGE_SUPPRESSION_MS
  ) {
    return true;
  }

  lastFrequencyRangeSendKey = requestKey;
  lastFrequencyRangeSendAt = now;
  return false;
};

const shouldClearStaleSpectrumFrames = (
  deviceState: DeviceState | null | undefined,
): boolean =>
  deviceState === "disconnected";

const clearLiveSpectrumFrames = (dispatch: Dispatch) => {
  liveDataRef.current = null;
  dispatch(setSpectrumFrames([]));
};

const checkRetuneWatchdog = (frameCenterHz: number) => {
  const request = lastFrequencyRangeRequest;
  if (!request || !Number.isFinite(frameCenterHz)) return;

  if (
    Math.abs(frameCenterHz - request.centerHz) <= RETUNE_CENTER_TOLERANCE_HZ
  ) {
    lastFrequencyRangeRequest = null;
    return;
  }

  request.mismatchFrames += 1;
  const now = Date.now();
  if (
    shouldResendRetuneRequest({
      expectedCenterHz: request.centerHz,
      frameCenterHz,
      requestedAt: request.requestedAt,
      lastResendAt: request.lastResendAt,
      mismatchFrames: request.mismatchFrames,
      now,
    }) &&
    wsInstance.ws &&
    wsInstance.ws.readyState === WebSocket.OPEN
  ) {
    wsInstance.ws.send(
      JSON.stringify({ type: "frequency_range", ...request.data }),
    );
    request.lastResendAt = now;
  }
};

const queueLiveData = (data: any, dispatch: Dispatch, getState: () => any) => {
  const centerFrequencyHz = data?.center_frequency_hz;
  if (typeof centerFrequencyHz === "number") {
    checkRetuneWatchdog(centerFrequencyHz);
  }
  if (
    typeof centerFrequencyHz === "number" &&
    isFrameStale(centerFrequencyHz)
  ) {
    return;
  }

  if (pendingDataUpdate === null) {
    pendingDataUpdate = [data];
  } else {
    pendingDataUpdate.push(data);
    trimPendingDataUpdate();
  }

  if (dataBatchFrame === null) {
    dataBatchFrame = window.requestAnimationFrame(() =>
      processBatchedData(dispatch, getState),
    );
  }
};

export const __testQueueLiveDataForMiddleware = (
  data: any,
  dispatch: Dispatch,
  getState: () => any,
) => {
  queueLiveData(data, dispatch, getState);
};

const sameAesKeyReference = (
  current: CryptoKey | null,
  next: CryptoKey | null,
): boolean => current === next;

const isMockBackend = (value: unknown): boolean => {
  return (
    typeof value === "string" &&
    (value === "mock_apt" ||
      value === "mock_apt_metal" ||
      value.includes("mock"))
  );
};

const isMockDeviceStatus = (parsedData: Record<string, unknown>): boolean => {
  return (
    isMockBackend(parsedData.backend) ||
    isMockBackend(parsedData.device) ||
    isMockBackend(parsedData.device_info) ||
    isMockBackend(parsedData.device_name)
  );
};

const cleanupSocket = () => {
  if (wsInstance.reconnectTimeout) {
    clearTimeout(wsInstance.reconnectTimeout);
    wsInstance.reconnectTimeout = null;
  }

  if (wsInstance.ws) {
    wsInstance.ws.onclose = null;
    wsInstance.ws.onerror = null;
    wsInstance.ws.onmessage = null;
    wsInstance.ws.onopen = null;
    wsInstance.ws.close();
    wsInstance.ws = null;
  }
  cleanupSourceIqSocket();

  lastFrequencyRangeSendKey = null;
  lastFrequencyRangeSendAt = 0;
  lastFrequencyRangeRequest = null;
  pendingDataUpdate = null;
  pendingStatusUpdates = null;
  liveDataRef.current = null;
  wsInstance.disposed = true;
};

const cleanupSourceIqSocket = () => {
  if (sourceIqWsInstance.ws) {
    sourceIqWsInstance.ws.onclose = null;
    sourceIqWsInstance.ws.onerror = null;
    sourceIqWsInstance.ws.onmessage = null;
    sourceIqWsInstance.ws.onopen = null;
    sourceIqWsInstance.ws.close();
    sourceIqWsInstance.ws = null;
  }
  if (sourceIqWsInstance.reconnectTimeout !== null) {
    clearTimeout(sourceIqWsInstance.reconnectTimeout);
    sourceIqWsInstance.reconnectTimeout = null;
  }
  sourceIqWsInstance.url = "";
  sourceIqWsInstance.sourceId = null;
};

export const shouldAcceptSourceIqSocketMessage = ({
  socketIsCurrent,
  socketSourceId,
  activeSourceId,
  requestedSourceId = null,
}: {
  socketIsCurrent: boolean;
  socketSourceId: string;
  activeSourceId: string | null;
  requestedSourceId?: string | null;
}): boolean =>
  socketIsCurrent &&
  socketSourceId.length > 0 &&
  socketSourceId === activeSourceId &&
  (requestedSourceId === null || socketSourceId === requestedSourceId);

const syncSourceIqSocket = (dispatch: Dispatch, getState: () => any) => {
  if (!wsInstance.enabled || !wsInstance.url || !wsInstance.aesKey) {
    cleanupSourceIqSocket();
    return;
  }
  if (wsInstance.ws?.readyState !== WebSocket.OPEN) {
    cleanupSourceIqSocket();
    return;
  }

  const state = getState().websocket;
  const activeSourceId = state.activeSourceId;
  const activeSource = (state.sources ?? []).find(
    (source: SourceInfo) => source.id === activeSourceId,
  );
  if (!activeSource?.supports_raw_iq_stream) {
    cleanupSourceIqSocket();
    return;
  }

  const nextUrl = buildSourceIqWebSocketUrl(wsInstance.url, activeSource);
  if (!nextUrl) {
    cleanupSourceIqSocket();
    return;
  }

  const existing = sourceIqWsInstance.ws;
  if (
    existing &&
    sourceIqWsInstance.url === nextUrl &&
    sourceIqWsInstance.sourceId === activeSource.id &&
    (existing.readyState === WebSocket.CONNECTING ||
      existing.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  cleanupSourceIqSocket();
  const ws = new WebSocket(nextUrl);
  ws.binaryType = "arraybuffer";
  sourceIqWsInstance.ws = ws;
  sourceIqWsInstance.url = nextUrl;
  sourceIqWsInstance.sourceId = activeSource.id;
  sourceIqWsInstance.reconnectTimeout = null;
  const socketSourceId = activeSource.id;
  console.info("[source-switch] opening I/Q socket", {
    sourceId: socketSourceId,
    streamKey: activeSource.stream_key ?? socketSourceId,
  });

  ws.onopen = () => {
    console.info("[source-switch] I/Q socket connected for", socketSourceId);
    if (socketSourceId === "mock-tx") {
      const state = getState();
      const isTransmitting =
        state.websocket.sources?.find((s: any) => s.id === "mock-tx")
          ?.status === "transmitting" ||
        state.websocket.sourceStatuses?.["mock-tx"] === "transmitting";
      if (!isTransmitting) {
        const txSettings = state.spectrum;
        const viewSampleRateHz = state.waterfall?.frequencyRange
          ? state.waterfall.frequencyRange.max - state.waterfall.frequencyRange.min
          : undefined;
        if (wsInstance.ws && wsInstance.ws.readyState === WebSocket.OPEN) {
          console.info("[source-switch] requesting initial mock-tx standby frame");
          wsInstance.ws.send(
            JSON.stringify({
              type: "request_next_frame",
              centerFrequencyHz: txSettings.txCenterFrequencyHz,
              viewCenterHz: txSettings.txCenterFrequencyHz,
              bandwidthHz: txSettings.txSampleRateHz,
              sample_rate: viewSampleRateHz,
              powerDbm: txSettings.txPowerDbm,
              txSignal: txSettings.txSignal,
              txIfftSize: txSettings.txIfftSize,
            }),
          );
        }
      }
    }
  };

  ws.onmessage = async (event) => {
    if (
      event.data instanceof ArrayBuffer &&
      wsInstance.aesKey &&
      shouldAcceptSourceIqSocketMessage({
        socketIsCurrent: sourceIqWsInstance.ws === ws,
        socketSourceId,
        activeSourceId: getState().websocket.activeSourceId,
        requestedSourceId,
      })
    ) {
      await processBinaryMessage(
        dispatch,
        getState,
        event.data,
        wsInstance.aesKey,
        socketSourceId,
      );
    }
  };
  ws.onerror = (error) => {
    console.error("Source I/Q WebSocket error:", error);
  };
  ws.onclose = () => {
    if (sourceIqWsInstance.ws === ws) {
      sourceIqWsInstance.ws = null;
      if (
        wsInstance.enabled &&
        !wsInstance.disposed &&
        sourceIqWsInstance.url === nextUrl &&
        sourceIqWsInstance.sourceId === activeSource.id &&
        sourceIqWsInstance.reconnectTimeout === null
      ) {
        sourceIqWsInstance.reconnectTimeout = window.setTimeout(() => {
          sourceIqWsInstance.reconnectTimeout = null;
          syncSourceIqSocket(dispatch, getState);
        }, 250);
      }
    }
  };
};

// WebSocket message processing
const processMessage = (
  dispatch: Dispatch,
  getState: () => any,
  parsedData: any,
) => {
  // Validate the message first (skip binary data for performance)
  if (!processWebSocketMessageWithValidation(dispatch, getState, parsedData)) {
    console.warn("WebSocket message failed validation:", parsedData);
    return;
  }

  // Status messages (backend-driven device state)
  if (parsedData?.type === "source_info") {
    if (!isValidSourceInfoMessage(parsedData)) {
      console.error("Source info message validation failed:", parsedData);
      return;
    }

    try {
      const previousActiveSourceId = getState().websocket.activeSourceId;
      if (parsedData.active_source !== previousActiveSourceId) {
        console.info("[source-switch] server source_info", {
          previousActiveSourceId,
          activeSourceId: parsedData.active_source,
          sources: parsedData.sources.map((source: SourceInfo) => ({
            id: source.id,
            status: source.status,
            streamKey: source.stream_key ?? null,
          })),
        });
      }
      if (parsedData.active_source !== previousActiveSourceId) {
        pendingDataUpdate = null;
      }
      const activeSource =
        parsedData.sources.find(
          (source: SourceInfo) => source.id === parsedData.active_source,
        ) ??
        parsedData.sources[0] ??
        null;
      const derived = activeSource
        ? deriveLegacyStateFromSource(activeSource)
        : {};
      if (
        "deviceState" in derived &&
        shouldClearStaleSpectrumFrames(derived.deviceState as any)
      ) {
        clearLiveSpectrumFrames(dispatch);
      }
      const sourceStatuses = Object.fromEntries(
        parsedData.sources.map((source: SourceInfo) => [
          source.id,
          source.status,
        ]),
      );
      if (parsedData.active_source === requestedSourceId) {
        requestedSourceId = null;
      }
      const updates: any = {
        activeSourceId: parsedData.active_source,
        activeSourceMode: parsedData.active_source_mode,
        isPaused: isSourceModePaused(parsedData.active_source_mode),
        sources: parsedData.sources,
        sourceStatuses,
        ...derived,
      };
      applyStatusUpdates(dispatch, getState, updates);
    } catch (e) {
      console.error("Failed to parse source_info message:", e);
    }
    return;
  }

  if (parsedData?.type === "active_source") {
    if (!isValidActiveSourceMessage(parsedData)) {
      console.error("Active source message validation failed:", parsedData);
      return;
    }

    try {
      const previousActiveSourceId = getState().websocket.activeSourceId;
      if (parsedData.source_id !== previousActiveSourceId) {
        console.info("[source-switch] server active_source", {
          previousActiveSourceId,
          activeSourceId: parsedData.source_id,
          sourceMode: parsedData.source_mode,
        });
      }
      if (parsedData.source_id !== previousActiveSourceId) {
        pendingDataUpdate = null;
      }
      if (parsedData.source_id === requestedSourceId) {
        requestedSourceId = null;
      }
      const updates: any = {
        activeSourceId: parsedData.source_id,
        activeSourceMode: parsedData.source_mode,
        isPaused: isSourceModePaused(parsedData.source_mode),
      };

      const currentSources: SourceInfo[] = getState().websocket.sources ?? [];
      const activeSource =
        currentSources.find(
          (source: SourceInfo) => source.id === parsedData.source_id,
        ) ??
        currentSources[0] ??
        null;
      const derived = activeSource
        ? deriveLegacyStateFromSource(activeSource)
        : {};
      if (
        "deviceState" in derived &&
        shouldClearStaleSpectrumFrames(derived.deviceState as any)
      ) {
        clearLiveSpectrumFrames(dispatch);
      }

      const combinedUpdates = {
        ...updates,
        ...derived,
      };

      applyStatusUpdates(dispatch, getState, combinedUpdates);
    } catch (e) {
      console.error("Failed to parse active_source message:", e);
    }
    return;
  }

  if (parsedData?.type === "channels") {
    if (!isValidChannelsMessageEnhanced(parsedData)) {
      console.error("Channels message validation failed:", parsedData);
      dispatch(setError("Error: Bad JSON"));
      return;
    }

    try {
      const channels = parsedData.channels as SpectrumFrame[];
      const firstChannel = channels[0];
      if (!firstChannel) {
        dispatch(setError("Error: Bad JSON"));
        return;
      }

      const nextRange = {
        min: firstChannel.min_hz,
        max: firstChannel.max_hz,
      };
      dispatch(
        setSignalAreaAndRange({
          area: parsedData.active_signal_area ?? firstChannel.label ?? "A",
          range: nextRange,
        }),
      );
      dispatch(setFrequencyRange(nextRange));
      dispatch(
        updateDeviceState({
          channels,
        }),
      );
      if (parsedData.error) {
        dispatch(setError(`Error: ${parsedData.error}`));
      }
    } catch (e) {
      console.error("Failed to parse channels message:", e);
      dispatch(setError("Error: Bad JSON"));
    }
    return;
  }

  if (parsedData?.type === "status" && "source_id" in parsedData) {
    if (!isValidSourceStatusMessage(parsedData)) {
      console.error("Source status message validation failed:", parsedData);
      return;
    }

    try {
      if (parsedData.status === "loading") {
        console.info("[source-switch] server accepted", {
          sourceId: parsedData.source_id,
          status: parsedData.status,
        });
      }
      const currentSources: SourceInfo[] = getState().websocket.sources ?? [];
      const nextSources = currentSources.map((source) =>
        source.id === parsedData.source_id
          ? {
              ...source,
              status: parsedData.status,
              loading_attempt:
                parsedData.loading_attempt ?? source.loading_attempt,
              loading_attempt_max:
                parsedData.loading_attempt_max ?? source.loading_attempt_max,
            }
          : source,
      );
      const activeSource =
        nextSources.find(
          (source) => source.id === getState().websocket.activeSourceId,
        ) ??
        nextSources[0] ??
        null;
      const derived = activeSource
        ? deriveLegacyStateFromSource(activeSource)
        : {};
      const sourceStatuses = {
        ...(getState().websocket.sourceStatuses ?? {}),
      };
      sourceStatuses[parsedData.source_id] = parsedData.status;
      const updates: any = {
        sourceStatuses,
        sources: nextSources,
        ...derived,
      };
      if (parsedData.source_id === getState().websocket.activeSourceId) {
        updates.deviceState = mapSourceStatusToDeviceState(parsedData.status);
        updates.deviceLoadingReason =
          parsedData.status === "loading" ? "connect" : null;
        if (
          parsedData.status === "loading" ||
          parsedData.status === "stale" ||
          parsedData.status === "disconnected"
        ) {
          clearLiveSpectrumFrames(dispatch);
        }
      }
      applyStatusUpdates(dispatch, getState, updates);
    } catch (e) {
      console.error("Failed to parse source status message:", e);
    }
    return;
  }

  if (parsedData?.type === "sdr_settings" && "source_id" in parsedData) {
    if (!isValidSourceSdrSettingsMessage(parsedData)) {
      console.error(
        "Source sdr settings message validation failed:",
        parsedData,
      );
      return;
    }

    try {
      const currentSources: SourceInfo[] = getState().websocket.sources ?? [];
      const nextSources = currentSources.map((source) =>
        source.id === parsedData.source_id
          ? {
              ...source,
              sdr: {
                ...source.sdr,
                settings: {
                  ...source.sdr.settings,
                  ...parsedData.sdr,
                },
              },
            }
          : source,
      );
      const activeSource =
        nextSources.find(
          (source) => source.id === getState().websocket.activeSourceId,
        ) ??
        nextSources[0] ??
        null;
      const derived = activeSource
        ? deriveLegacyStateFromSource(activeSource)
        : {};
      const updates: any = {
        sources: nextSources,
        ...derived,
      };
      if (pendingStatusUpdates === null) {
        pendingStatusUpdates = updates;
      } else {
        pendingStatusUpdates = { ...pendingStatusUpdates, ...updates };
      }
      if (statusBatchFrame === null) {
        statusBatchFrame = window.requestAnimationFrame(() =>
          processBatchedStatus(dispatch, getState),
        );
      }
    } catch (e) {
      console.error("Failed to parse source sdr settings message:", e);
    }
    return;
  }

  if (parsedData?.type === "error" && "source_id" in parsedData) {
    if (!isValidSourceErrorMessage(parsedData)) {
      console.error("Source error message validation failed:", parsedData);
      return;
    }

    if (parsedData.code === "source_switch_failed") {
      console.error("[source-switch] rejected by server", {
        sourceId: parsedData.source_id,
        message: parsedData.message,
      });
    }
    dispatch(setError(parsedData.message));
    return;
  }

  if (false && parsedData?.type === "status") {
    return;
  }

  // Capture status messages
  if (parsedData?.type === "capture_status") {
    // Temporarily skip strict validation to allow I/Q capture to work
    // TODO: Fix schema validation issue and re-enable proper validation

    // const statusData = parsedData.status || parsedData;
    // if (!validateCaptureStatus(statusData)) {
    //   console.error('Capture status validation failed:', statusData);
    //   return;
    // }

    try {
      const statusObj = parsedData.status || {};

      if (
        typeof statusObj.jobId === "string" &&
        (statusObj.status === "started" ||
          statusObj.status === "progress" ||
          statusObj.status === "done" ||
          statusObj.status === "failed")
      ) {
        const newStatus = {
          jobId: statusObj.jobId,
          status: statusObj.status,
          message: statusObj.message,
          progress: statusObj.progress,
          downloadUrl: statusObj.downloadUrl,
          filename: statusObj.filename,
          fileCount:
            typeof statusObj.fileCount === "number"
              ? statusObj.fileCount
              : undefined,
          ephemeral:
            typeof statusObj.ephemeral === "boolean"
              ? statusObj.ephemeral
              : undefined,
          timestamp:
            typeof statusObj.timestamp === "number"
              ? statusObj.timestamp
              : undefined,
          fileSize:
            typeof statusObj.fileSize === "number"
              ? statusObj.fileSize
              : undefined,
          duration:
            typeof statusObj.duration === "number"
              ? statusObj.duration
              : undefined,
        };
        if (statusObj.error) {
          (newStatus as any).error = statusObj.error;
        }
        const currentStatus = getState().websocket.captureStatus;
        if (!equalValue(currentStatus, newStatus)) {
          dispatch(setCaptureStatus(newStatus));
        }
      }
    } catch (e) {
      console.error("Failed to parse capture status:", e);
    }
    return;
  }

  // Scan and Demodulation result messages
  if (
    parsedData?.type === "scan_result" ||
    parsedData?.type === "scan_progress" ||
    parsedData?.type === "demod_result"
  ) {
    scannerWorkerManager.handleWSResponse(parsedData);
    return;
  }

  // Hardware info messages
  if (parsedData?.type === "hardware_info") {
    try {
      if (
        parsedData.hardwareFreqRange &&
        typeof parsedData.sampleRate === "number"
      ) {
        dispatch(
          setHardwareInfo({
            range: {
              min: parsedData.hardwareFreqRange.min,
              max: parsedData.hardwareFreqRange.max,
            },
            sampleRate: parsedData.sampleRate,
          }),
        );
      }
    } catch (e) {
      console.error("Failed to parse hardware info:", e);
    }
    return;
  }

  // APT Analysis result messages
  if (parsedData?.type === "apt_analysis_result") {
    try {
      // Dispatch custom event for APT analysis results
      // This will be handled by the DemodContext
      const event = new CustomEvent("aptAnalysisResult", {
        detail: parsedData,
      });
      window.dispatchEvent(event);
    } catch (e) {
      console.error("Failed to process APT analysis result:", e);
    }
    return;
  }
};

// Binary message processing
const processBinaryMessage = async (
  dispatch: Dispatch,
  getState: () => any,
  buffer: ArrayBuffer,
  aesKey: CryptoKey,
  sourceId: string,
) => {
  const activeSourceId = getState().websocket.activeSourceId;
  if (sourceId !== activeSourceId) {
    return;
  }

  try {
    const view = new DataView(buffer);

    // Extract metadata
    const timestamp = Number(view.getBigUint64(0, true));
    const centerFrequencyHz = Number(view.getBigUint64(8, true));
    const dataType = Number(view.getUint32(16, true));
    const sampleRate = Number(view.getUint32(20, true));

    // Extract encrypted payload
    const encryptedPayload = new Uint8Array(buffer, 24);

    // Decrypt the binary payload
    const decryptedBytes = await decryptBinaryPayload(aesKey, encryptedPayload);
    // Decryption is asynchronous. A source switch may have completed while
    // this frame was in flight, so verify the immutable socket identity again
    // before allowing an old device's IQ bytes into the live frame ref.
    if (sourceId !== getState().websocket.activeSourceId) {
      return;
    }
    if (dataType !== 1) {
      console.warn("Ignoring unexpected non-IQ binary payload", {
        dataType,
        centerFrequencyHz,
        sampleRate,
        byteLength: decryptedBytes.byteLength,
      });
      return;
    }

    if (isFrameStale(centerFrequencyHz)) {
      return;
    }
    checkRetuneWatchdog(centerFrequencyHz);

    const spectrumData = {
      type: "spectrum",
      is_mock_apt: false,
      center_frequency_hz: centerFrequencyHz,
      waveform_span_hz: null,
      timestamp: timestamp,
      data_type: "iq_raw",
      sample_rate: sampleRate,
      iq_data: decryptedBytes,
    };

    // Batch the data update to prevent excessive re-renders
    if (pendingDataUpdate === null) {
      pendingDataUpdate = [spectrumData];
    } else {
      pendingDataUpdate.push(spectrumData);
      trimPendingDataUpdate();
    }

    if (dataBatchFrame === null) {
      dataBatchFrame = window.requestAnimationFrame(() =>
        processBatchedData(dispatch, getState),
      );
    }
  } catch (e) {
    console.error("Binary decryption failed:", e);
    dispatch(setCryptoCorrupted());
  }
};

// Create WebSocket middleware
const createWebSocketMiddleware =
  (): Middleware<{}, any> => (store) => (next) => (action: any) => {
    const { dispatch, getState } = store;

    // Handle WebSocket connection management actions
    switch (action.type) {
      case "websocket/connect": {
        const { url, aesKey, enabled = true } = action.payload;

        if (wsInstance.disconnectTimeout) {
          clearTimeout(wsInstance.disconnectTimeout);
          wsInstance.disconnectTimeout = null;
        }

        const existingSocket = wsInstance.ws;
        const hasReusableSocket =
          !!existingSocket &&
          !wsInstance.disposed &&
          wsInstance.enabled === enabled &&
          wsInstance.url === url &&
          sameAesKeyReference(wsInstance.aesKey, aesKey) &&
          (existingSocket.readyState === WebSocket.CONNECTING ||
            existingSocket.readyState === WebSocket.OPEN);

        if (hasReusableSocket) {
          if (existingSocket?.readyState === WebSocket.OPEN) {
            dispatch(setConnected());
            syncSourceIqSocket(dispatch, getState);
          } else {
            dispatch(setConnecting());
          }
          return next(action);
        }

        // Cleanup existing connection
        cleanupSocket();
        liveDataRef.current = [];
        pendingDataUpdate = null;

        if (!enabled || !url) {
          dispatch(setDisconnected());
          return next(action);
        }

        wsInstance.url = url;
        wsInstance.aesKey = aesKey;
        wsInstance.enabled = enabled;
        wsInstance.reconnectAttempts = 0;
        wsInstance.disposed = false;

        const connect = () => {
          if (wsInstance.disposed) return;

          try {
            dispatch(setConnecting());
            const ws = new WebSocket(url);
            ws.binaryType = "arraybuffer";
            wsInstance.ws = ws;

            ws.onopen = () => {
              if (wsInstance.disposed) {
                ws.close();
                return;
              }
              dispatch(setConnected());
              wsInstance.reconnectAttempts = 0;
              syncSourceIqSocket(dispatch, getState);

              // Send queued messages
              const state = getState();
              const queuedMessages = state.websocket.queuedMessages;
              if (queuedMessages.length > 0) {
                queuedMessages.forEach(
                  ({ type, data }: { type: string; data: any }) => {
                    ws.send(JSON.stringify({ type, ...data }));
                  },
                );
                dispatch(clearQueuedMessages());
              }
            };

            ws.onmessage = async (event) => {
              if (wsInstance.disposed) return;

              // Binary fast-path for spectrum data
              if (event.data instanceof ArrayBuffer) {
                if (wsInstance.aesKey) {
                  const activeSourceId = getState().websocket.activeSourceId;
                  await processBinaryMessage(
                    dispatch,
                    getState,
                    event.data,
                    wsInstance.aesKey,
                    activeSourceId ?? "",
                  );
                }
                return;
              }

              const raw = event.data as string;
              let parsed: any;
              try {
                parsed = JSON.parse(raw);
              } catch (e) {
                console.error("Failed to parse websocket message:", e);
                return;
              }

              // Priority: Handle critical control messages immediately before any other processing
              if (
                parsed?.type === "status" ||
                parsed?.type === "capture_status"
              ) {
                processMessage(dispatch, getState, parsed);
                return;
              }

              if (parsed?.type === "spectrum") {
                queueLiveData(parsed, dispatch, getState);
                return;
              }

              if (parsed?.type === "encrypted_spectrum") {
                if (wsInstance.aesKey && typeof parsed.payload === "string") {
                  try {
                    const plaintext = await decryptPayload(
                      wsInstance.aesKey,
                      parsed.payload,
                    );
                    const decrypted = JSON.parse(plaintext);
                    if (
                      decrypted?.type === "batch" &&
                      Array.isArray(decrypted.messages) &&
                      decrypted.messages.length > 0
                    ) {
                      queueLiveData(
                        JSON.parse(decrypted.messages[0]),
                        dispatch,
                        getState,
                      );
                    } else {
                      if (pendingDataUpdate === null) {
                        pendingDataUpdate = [decrypted];
                      } else {
                        pendingDataUpdate.push(decrypted);
                        trimPendingDataUpdate();
                      }
                    }
                  } catch (e) {
                    console.error("Failed to decrypt spectrum data:", e);
                  }
                }
                return;
              }

              // Process status and control messages
              processMessage(dispatch, getState, parsed);
            };

            ws.onclose = () => {
              if (wsInstance.disposed) return;
              dispatch(setDisconnected());

              // Exponential backoff reconnection
              if (
                wsInstance.reconnectAttempts < wsInstance.maxReconnectAttempts
              ) {
                const delay = Math.min(
                  1000 * Math.pow(2, wsInstance.reconnectAttempts),
                  30000,
                );
                wsInstance.reconnectTimeout = window.setTimeout(() => {
                  wsInstance.reconnectAttempts++;
                  dispatch(setReconnecting(wsInstance.reconnectAttempts));
                  connect();
                }, delay);
              }
            };

            ws.onerror = (error) => {
              console.error("WebSocket error:", error);
              dispatch(setError("WebSocket connection error"));
            };
          } catch (error) {
            console.error("Failed to create WebSocket:", error);
            dispatch(setError("Failed to create WebSocket connection"));
          }
        };

        connect();
        return next(action);
      }

      case "websocket/disconnect": {
        if (wsInstance.disconnectTimeout) {
          clearTimeout(wsInstance.disconnectTimeout);
        }

        wsInstance.disposed = true;
        wsInstance.enabled = false;
        if (wsInstance.reconnectTimeout) {
          clearTimeout(wsInstance.reconnectTimeout);
          wsInstance.reconnectTimeout = null;
        }

        liveDataRef.current = null;
        pendingDataUpdate = null;
        pendingStatusUpdates = null;
        if (statusBatchFrame !== null) {
          cancelAnimationFrame(statusBatchFrame);
          statusBatchFrame = null;
        }

        wsInstance.disconnectTimeout = window.setTimeout(() => {
          wsInstance.disconnectTimeout = null;
          cleanupSocket();
        }, DISCONNECT_GRACE_MS);

        if (dataBatchFrame !== null) {
          cancelAnimationFrame(dataBatchFrame);
          dataBatchFrame = null;
        }
        cleanupSourceIqSocket();
        resetPausedFrameRequestGate();

        dispatch(setDisconnected());
        return next(action);
      }

      case "websocket/sendMessage": {
        const { type, data }: { type: string; data: any } = action.payload;
        const normalizedData = normalizeFrequencyRangeMessageData(type, data);
        if (shouldSuppressDuplicateFrequencyRangeSend(type, normalizedData)) {
          return next(action);
        }
        trackFrequencyRangeRequest(type, normalizedData);

        // Track intended FFT size to prevent clobbering from status broadcasts
        const requestedFftSize =
          normalizedData?.fft_size ??
          normalizedData?.fftSize ??
          normalizedData?.fft_size_hz;
        if (type === "settings" && requestedFftSize) {
          lastSettingsRequest = {
            fft_size: requestedFftSize,
            timestamp: Date.now(),
          };
        }

        if (
          type === "tx_mode" &&
          wsInstance.ws &&
          wsInstance.ws.readyState === WebSocket.OPEN
        ) {
          applyOptimisticTransmitStatus(
            dispatch,
            getState,
            normalizedData ?? {},
          );
        }

        if (type === "request_next_frame") {
          const now = Date.now();
          if (now - lastFrameRequestTime < FRAME_REQUEST_THROTTLE_MS) {
            console.debug(
              "[WebSocket Middleware] Throttling redundant frame request",
            );
            if (pendingTrailingFrameRequestTimeout) {
              clearTimeout(pendingTrailingFrameRequestTimeout);
            }
            pendingTrailingFrameRequestTimeout = setTimeout(
              () => {
                pendingTrailingFrameRequestTimeout = null;
                dispatch(action);
              },
              FRAME_REQUEST_THROTTLE_MS - (now - lastFrameRequestTime),
            );
            return next(action);
          }

          if (pendingTrailingFrameRequestTimeout) {
            clearTimeout(pendingTrailingFrameRequestTimeout);
            pendingTrailingFrameRequestTimeout = null;
          }

          if (!shouldAcceptPausedFrameRequest()) {
            return next(action);
          }

          lastFrameRequestTime = now;
          allowNextPausedFrame = true;
        }

        if (type === "select_source") {
          requestedSourceId = (normalizedData?.source_id as string | null) ?? null;
        }

        if (wsInstance.ws && wsInstance.ws.readyState === WebSocket.OPEN) {
          if (type === "select_source") {
            console.info("[source-switch] control message sent", {
              sourceId: normalizedData?.source_id ?? null,
              activeSourceId: getState().websocket.activeSourceId,
            });
          }
          wsInstance.ws.send(JSON.stringify({ type, ...normalizedData }));
        } else if (type === "tx_mode" || type === "request_next_frame") {
          allowNextPausedFrame = false;
          resetPausedFrameRequestGate();
        } else {
          if (type === "select_source") {
            console.warn("[source-switch] control socket unavailable; queued", {
              sourceId: normalizedData?.source_id ?? null,
              readyState: wsInstance.ws?.readyState ?? null,
            });
          }
          // Queue the message for when connection is restored
          dispatch(queueMessage({ type, data: normalizedData }));
        }
        return next(action);
      }

      case "websocket/setPaused": {
        const isPaused = getPausedValue(action.payload);
        const sourceId =
          getPauseSourceId(action.payload) ??
          (getState().websocket.activeSourceId as string | null);

        if (isPaused === null) {
          return next(action);
        }

        if (
          sourceId &&
          wsInstance.ws &&
          wsInstance.ws.readyState === WebSocket.OPEN
        ) {
          const pausePayload: Record<string, unknown> = {
            type: "pause",
            paused: isPaused,
            source_id: sourceId,
          };
          const duplexMode = getPauseDuplexMode(action.payload);
          const activeMode = getPauseActiveMode(action.payload);
          if (duplexMode) {
            pausePayload.duplex_mode = duplexMode;
          }
          if (activeMode) {
            pausePayload.active_mode = activeMode;
          }
          wsInstance.ws.send(JSON.stringify(pausePayload));
        }

        return next({
          ...action,
          payload: isPaused,
        });
      }

      case "websocket/updateDeviceState": {
        const previousState = getState().websocket;
        const previousActiveSourceId = previousState.activeSourceId;
        const result = next(action);
        const nextState = getState().websocket;
        const activeSourceChanged =
          typeof nextState.activeSourceId === "string" &&
          nextState.activeSourceId !== previousActiveSourceId;
        if (
          activeSourceChanged ||
          shouldClearStaleSpectrumFrames(nextState.deviceState)
        ) {
          clearLiveSpectrumFrames(dispatch);
        }
        if (activeSourceChanged) {
          syncSourceIqSocket(dispatch, getState);
        }
        return result;
      }

      default:
        return next(action);
    }
  };

// Export the middleware factory
const websocketMiddleware = createWebSocketMiddleware();
export default websocketMiddleware;
