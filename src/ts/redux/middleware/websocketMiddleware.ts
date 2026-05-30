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
} from "../slices/websocketSlice";
import { setHardwareInfo } from "../slices/demodSlice";
import { decryptPayload, decryptBinaryPayload } from "@n-apt/crypto/webcrypto";
import {
  type IqRawFrame,
  type SpectrumFrame,
} from "@n-apt/consts/schemas/websocket";
import { scannerWorkerManager } from "@n-apt/workers/scannerWorkerManager";
import {
  processWebSocketMessageWithValidation,
  validateStatusMessage,
} from "@n-apt/validation";

// Module-level ref for high-frequency live frame data.
// Written directly — never goes through Redux state — so no React rerenders per frame.
export const liveDataRef: { current: IqRawFrame[] | IqRawFrame | null } = {
  current: [],
};

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

const equalSpectrumFrames = (
  a: Array<Record<string, unknown>> | null | undefined,
  b: Array<Record<string, unknown>> | null | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.label !== right.label ||
      left.min_hz !== right.min_hz ||
      left.max_hz !== right.max_hz ||
      left.description !== right.description
    ) {
      return false;
    }
  }
  return true;
};

const equalValue = (current: unknown, next: unknown): boolean => {
  if (current === next) return true;
  if (Array.isArray(current) && Array.isArray(next)) {
    return equalSpectrumFrames(
      current as Array<Record<string, unknown>>,
      next as Array<Record<string, unknown>>,
    );
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

// Batching for high-frequency data
let dataBatchFrame: number | null = null;
let pendingDataUpdate: any = null;
let statusBatchFrame: number | null = null;
let pendingStatusUpdates: any = null;
let allowNextPausedFrame = false;
let pausedFrameRequestInFlight = false;
const DISCONNECT_GRACE_MS = 150;
const DUPLICATE_FREQUENCY_RANGE_SUPPRESSION_MS = 500;
// RATIONALE for Auto FFT:
// 1. Screen widths are typically smaller than the FFT size (which is width-based).
// 2. Performance: Smaller FFTs save resources; higher resolution (larger FFT) should be reserved for zoom states.
let lastSettingsRequest: { fft_size?: number; timestamp: number } | null = null;
let lastFrameRequestTime = 0;
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

export const collapsePausedFrameBatch = <T>(data: T | T[]): T => {
  return Array.isArray(data) ? data[data.length - 1] : data;
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
  resetPausedFrameRequestGate();
  if (wsInstance.ws) {
    wsInstance.ws.onclose = null;
    wsInstance.ws.onerror = null;
    wsInstance.ws.onmessage = null;
    wsInstance.ws.onopen = null;
    wsInstance.ws = null;
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
    const isPaused = getState().websocket.isPaused;
    const sourceMode = getState().waterfall?.sourceMode;
    const isFileSource = sourceMode === "file";
    if ((!isPaused || allowNextPausedFrame) && !isFileSource) {
      if (isPaused && allowNextPausedFrame) {
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
      // Limit queue size to prevent memory leaks if processing falls behind
      if (
        Array.isArray(liveDataRef.current) &&
        liveDataRef.current.length > 100
      ) {
        liveDataRef.current = liveDataRef.current.slice(-50);
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
  statusBatchFrame = null;
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
  }

  if (dataBatchFrame === null) {
    dataBatchFrame = window.requestAnimationFrame(() =>
      processBatchedData(dispatch, getState),
    );
  }
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

  lastFrequencyRangeSendKey = null;
  lastFrequencyRangeSendAt = 0;
  lastFrequencyRangeRequest = null;
  wsInstance.disposed = true;
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
  if (parsedData?.type === "status") {
    // Additional validation for status messages
    if (!validateStatusMessage(parsedData)) {
      console.error("Status message validation failed:", parsedData);
      return;
    }

    try {
      const updates: any = {
        serverPaused: parsedData.paused || false,
      };

      if (typeof parsedData.backend === "string") {
        updates.backend = parsedData.backend;
      }
      if (typeof parsedData.device_info === "string") {
        updates.deviceInfo = parsedData.device_info;
      }
      // More aggressive device name updates - update even if empty to clear stale data
      if (typeof parsedData.device_name === "string") {
        updates.deviceName = parsedData.device_name;
      }
      if (parsedData.device_profile) {
        updates.deviceProfile = parsedData.device_profile;
      }
      if (typeof parsedData.max_sample_rate === "number") {
        updates.maxSampleRateHz = parsedData.max_sample_rate;
      }
      if (Array.isArray(parsedData.sample_rate_options)) {
        updates.sampleRateOptions = parsedData.sample_rate_options.filter(
          (rate: any) => typeof rate === "number" && Number.isFinite(rate),
        );
      }
      if (parsedData.sdr_settings) {
        let sdrSettings = parsedData.sdr_settings;

        // Anti-clobbering guard: If we recently requested a specific FFT size,
        // don't let a stale backend status overwrite it (especially if it tries to force 2048).
        if (
          lastSettingsRequest &&
          Date.now() - lastSettingsRequest.timestamp < 5000
        ) {
          const intendedFftSize = lastSettingsRequest.fft_size;
          const reportedFftSize = sdrSettings.fft?.default_size;

          if (
            intendedFftSize &&
            reportedFftSize &&
            intendedFftSize !== reportedFftSize
          ) {
            console.warn(
              `[WebsocketMiddleware] Backend reported stale FFT size (${reportedFftSize}), preserving intended client state (${intendedFftSize})`,
            );
            sdrSettings = {
              ...sdrSettings,
              fft: {
                ...sdrSettings.fft,
                default_size: intendedFftSize,
              },
            };
          }
        }

        updates.sdrSettings = sdrSettings;
        if (Array.isArray(parsedData.sdr_limit_markers)) {
          updates.sdrLimitMarkers = parsedData.sdr_limit_markers.filter(
            (marker: any) =>
              marker &&
              typeof marker.kind === "string" &&
              typeof marker.freq_hz === "number",
          );
        }
        if (typeof sdrSettings.sample_rate === "number") {
          updates.sampleRateHz = sdrSettings.sample_rate;
        }
        if (typeof sdrSettings.min_receive_sample_rate === "number") {
          updates.minReceiveSampleRateHz = sdrSettings.min_receive_sample_rate;
        }
      }
      if (typeof parsedData.device_state === "string") {
        updates.deviceState = parsedData.device_state;
        // When device connects, force immediate update of device info
        if (parsedData.device_state === "connected" && !updates.deviceName) {
          // Set a default name immediately if backend hasn't provided one yet
          updates.deviceName = updates.deviceInfo || "RTL-SDR Device";
        }
      }
      if (Array.isArray(parsedData.channels)) {
        updates.spectrumFrames = (parsedData.channels as any[]).reduce<
          SpectrumFrame[]
        >((acc, f: any) => {
          if (!(f && typeof f.id === "string")) return acc;
          const label = typeof f.label === "string" ? f.label : "";
          const min_hz = Number(f.min_hz);
          const max_hz = Number(f.max_hz);
          if (
            label.length > 0 &&
            Number.isFinite(min_hz) &&
            Number.isFinite(max_hz) &&
            max_hz > min_hz
          ) {
            acc.push({
              id: f.id,
              label,
              min_hz,
              max_hz,
              description:
                typeof f.description === "string" ? f.description : "",
            });
          }
          return acc;
        }, []);
      }

      const reason = parsedData.device_loading_reason;
      if (reason === "connect" || reason === "restart" || reason === null) {
        updates.deviceLoadingReason = reason;
        if (reason === "restart") {
          const attempt = Number(parsedData.device_loading_attempt || 0);
          const attemptMax = Number(parsedData.device_loading_attempt_max || 0);
          const nowLabel = new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          });
          console.warn(
            `[device] ${parsedData.device_name || parsedData.device_info || "Device"} restarting (${attempt}/${attemptMax}) at ${nowLabel}`,
          );
        }
      }

      if (
        updates.deviceState === "disconnected" &&
        !parsedData.device_connected &&
        isMockDeviceStatus(parsedData)
      ) {
        updates.deviceState = "connected";
        updates.deviceLoadingReason = null;
        if (!updates.deviceName) {
          updates.deviceName = "Mock APT SDR";
        }
      }

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
      console.error("Failed to parse status message:", e);
    }
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
  _getState: () => any,
  buffer: ArrayBuffer,
  aesKey: CryptoKey,
) => {
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
    }

    if (dataBatchFrame === null) {
      dataBatchFrame = window.requestAnimationFrame(() =>
        processBatchedData(dispatch, _getState),
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
                  await processBinaryMessage(
                    dispatch,
                    getState,
                    event.data,
                    wsInstance.aesKey,
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

        wsInstance.disconnectTimeout = window.setTimeout(() => {
          wsInstance.disconnectTimeout = null;
          cleanupSocket();
        }, DISCONNECT_GRACE_MS);

        if (dataBatchFrame) {
          cancelAnimationFrame(dataBatchFrame);
          dataBatchFrame = null;
        }
        resetPausedFrameRequestGate();

        dispatch(setDisconnected());
        return next(action);
      }

      case "websocket/sendMessage": {
        const { type, data }: { type: string; data: any } = action.payload;
        if (shouldSuppressDuplicateFrequencyRangeSend(type, data)) {
          return next(action);
        }
        trackFrequencyRangeRequest(type, data);

        // Track intended FFT size to prevent clobbering from status broadcasts
        const requestedFftSize =
          data?.fft_size ?? data?.fftSize ?? data?.fft_size_hz;
        if (type === "settings" && requestedFftSize) {
          lastSettingsRequest = {
            fft_size: requestedFftSize,
            timestamp: Date.now(),
          };
        }

        if (type === "request_next_frame") {
          const now = Date.now();
          if (now - lastFrameRequestTime < FRAME_REQUEST_THROTTLE_MS) {
            console.debug(
              "[WebSocket Middleware] Throttling redundant frame request",
            );
            return next(action);
          }

          if (!shouldAcceptPausedFrameRequest()) {
            return next(action);
          }

          lastFrameRequestTime = now;
          allowNextPausedFrame = true;
        }

        if (wsInstance.ws && wsInstance.ws.readyState === WebSocket.OPEN) {
          wsInstance.ws.send(JSON.stringify({ type, ...data }));
        } else {
          // Queue the message for when connection is restored
          dispatch(queueMessage({ type, data }));
        }
        return next(action);
      }

      case "websocket/setPaused": {
        const isPaused = getPausedValue(action.payload);

        if (isPaused === null) {
          return next(action);
        }

        if (wsInstance.ws && wsInstance.ws.readyState === WebSocket.OPEN) {
          wsInstance.ws.send(
            JSON.stringify({
              type: "pause",
              paused: isPaused,
            }),
          );
        }

        return next({
          ...action,
          payload: isPaused,
        });
      }

      default:
        return next(action);
    }
  };

// Export the middleware factory
const websocketMiddleware = createWebSocketMiddleware();
export default websocketMiddleware;
