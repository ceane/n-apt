import { useReducer, useEffect, useRef, useCallback } from "react";
import { decryptPayload, decryptBinaryPayload } from "@n-apt/crypto/webcrypto";

import {
  DeviceState,
  DeviceLoadingReason,
  FrequencyRange,
  SDRSettings,
  CaptureFileType,
  CaptureRequest,
  CaptureStatus,
  SpectrumFrame,
  AutoFftOptionsResponse,
  DeviceProfile,
  SdrSettingsConfig,
  WebSocketMessage
} from "@n-apt/consts/schemas/websocket";

export type {
  DeviceState,
  DeviceLoadingReason,
  FrequencyRange,
  SDRSettings,
  CaptureFileType,
  CaptureRequest,
  CaptureStatus,
  SpectrumFrame,
  AutoFftOptionsResponse,
  DeviceProfile,
  SdrSettingsConfig,
  WebSocketMessage
};

export type WebSocketData = {
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  serverPaused: boolean;
  backend: string | null;
  deviceInfo: string | null;
  deviceName: string | null;
  deviceProfile: DeviceProfile | null;
  maxSampleRateHz: number | null;
  sampleRateHz: number | null;
  sdrSettings: SdrSettingsConfig | null;
  dataRef: React.MutableRefObject<any>;
  spectrumFrames: SpectrumFrame[];
  captureStatus: CaptureStatus;
  autoFftOptions: AutoFftOptionsResponse | null;
  error: string | null;
  cryptoCorrupted: boolean;
  sendFrequencyRange: (range: FrequencyRange) => void;
  sendPauseCommand: (isPaused: boolean) => void;
  sendSettings: (settings: SDRSettings) => void;
  sendRestartDevice: () => void;
  sendCaptureCommand: (req: CaptureRequest) => void;
  sendTrainingCommand: (
    action: "start" | "stop",
    label: "target" | "noise",
    signalArea: string,
  ) => void;
  sendGetAutoFftOptions: (screenWidth: number) => void;
  sendPowerScaleCommand: (scale: "dB" | "dBm") => void;
};



type WsState = {
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  serverPaused: boolean;
  backend: string | null;
  deviceInfo: string | null;
  deviceName: string | null;
  deviceProfile: DeviceProfile | null;
  maxSampleRateHz: number | null;
  sampleRateHz: number | null;
  sdrSettings: SdrSettingsConfig | null;
  data: any;
  spectrumFrames: SpectrumFrame[];
  captureStatus: CaptureStatus;
  autoFftOptions: AutoFftOptionsResponse | null;
  error: string | null;
  cryptoCorrupted: boolean;
};

type WsAction =
  | { type: "CONNECTED" }
  | { type: "DISCONNECTED" }
  | { type: "RESET" }
  | { type: "ERROR"; error: string }
  | { type: "STATUS"; updates: Partial<WsState> }
  | { type: "CAPTURE_STATUS"; status: CaptureStatus }
  | { type: "AUTO_FFT_OPTIONS"; options: AutoFftOptionsResponse }
  | { type: "DATA"; data: any }
  | { type: "CRYPTO_CORRUPTED" };

const INITIAL_WS_STATE: WsState = {
  isConnected: false,
  deviceState: null,
  deviceLoadingReason: null,
  isPaused: false,
  serverPaused: false,
  backend: null,
  deviceInfo: null,
  deviceName: null,
  deviceProfile: null,
  maxSampleRateHz: null,
  sampleRateHz: null,
  sdrSettings: null,
  data: null,
  spectrumFrames: [],
  captureStatus: null,
  autoFftOptions: null,
  error: null,
  cryptoCorrupted: false,
};

function wsReducer(state: WsState, action: WsAction): WsState {
  switch (action.type) {
    case "CONNECTED":
      return { ...state, isConnected: true, error: null, cryptoCorrupted: false };
    case "DISCONNECTED":
      return { ...state, isConnected: false };
    case "RESET":
      return INITIAL_WS_STATE;
    case "ERROR":
      return { ...state, error: action.error };
    case "STATUS":
      return { ...state, ...action.updates };
    case "CAPTURE_STATUS":
      return { ...state, captureStatus: action.status };
    case "AUTO_FFT_OPTIONS":
      return { ...state, autoFftOptions: action.options };
    case "DATA":
      return { ...state, data: action.data };
    case "CRYPTO_CORRUPTED":
      return { ...state, cryptoCorrupted: true };
    default:
      return state;
  }
}

/**
 * WebSocket hook for authenticated streaming.
 *
 * The `url` should already include the session token as a query parameter
 * (e.g. `ws://host:port/ws?token=...`). Auth is handled separately via REST.
 * The `aesKey` is used to decrypt encrypted spectrum payloads.
 *
 * Device state is driven entirely by the backend's `device_state` field
 * in status messages. No frontend inference or polling.
 */
export const useWebSocket = (
  url: string,
  aesKey: CryptoKey | null,
  enabled: boolean = true,
): WebSocketData => {
  const [state, dispatch] = useReducer(wsReducer, INITIAL_WS_STATE);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Exponential backoff counter
  const reconnectAttemptRef = useRef(0);

  // Keep a ref to the AES key so the message handler always sees the latest
  const aesKeyRef = useRef<CryptoKey | null>(aesKey);
  aesKeyRef.current = aesKey;

  // Mutable ref for high-frequency spectrum data to avoid React re-renders
  const dataRef = useRef<any>(null);

  useEffect(() => {
    // Shared cleanup: close any existing connection and cancel pending reconnects
    const cleanup = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      const ws = wsRef.current;
      if (ws) {
        // Prevent the onclose handler from scheduling a reconnect during teardown
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
        wsRef.current = null;
      }
    };

    if (!enabled || !url) {
      cleanup();
      dispatch({ type: "DISCONNECTED" });
      return cleanup;
    }

    // Clean up any previous connection before opening a new one
    cleanup();
    reconnectAttemptRef.current = 0;

    let disposed = false;

    const connect = () => {
      if (disposed) return;
      try {
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
          if (disposed) { ws.close(); return; }
          dispatch({ type: "CONNECTED" });
          reconnectAttemptRef.current = 0;
        };

        // WebSocket message handler with rAF-batched processing
        ws.onmessage = (event) => {
          if (disposed) return;

          // Binary fast-path for spectrum data
          if (event.data instanceof ArrayBuffer) {
            if (aesKeyRef.current) {
              try {
                const buffer = event.data;
                const view = new DataView(buffer);

                // 1. Extract metadata: [timestamp: 8 bytes][center_frequency: 8 bytes][data_type: 4 bytes][sample_rate: 4 bytes]
                const timestamp = Number(view.getBigUint64(0, true)); // true = little-endian
                const centerFrequencyHz = Number(view.getBigUint64(8, true));
                const dataType = Number(view.getUint32(16, true)); // 0 = spectrum, 1 = I/Q
                const sampleRate = Number(view.getUint32(20, true)); // Sample rate for I/Q data

                // 2. Extract encrypted payload - always 24-byte header now
                const encryptedPayload = new Uint8Array(buffer, 24);

                // 3. Decrypt the binary payload
                decryptBinaryPayload(aesKeyRef.current, encryptedPayload)
                  .then((decryptedBytes) => {
                    if (disposed) return;
                    
                    // 4. Process based on data type
                    if (dataType === 1) {
                      // I/Q data: keep as Uint8Array for WebGPU processing
                      const spectrumData = {
                        type: "spectrum",
                        waveform: new Float32Array(decryptedBytes.length / 2), // Placeholder for compatibility
                        is_mock_apt: false,
                        center_frequency_hz: centerFrequencyHz,
                        waveform_span_mhz: null,
                        timestamp: timestamp,
                        data_type: "iq_raw",
                        sample_rate: sampleRate,
                        iq_data: decryptedBytes, // Raw I/Q data for WebGPU
                      };
                      dataRef.current = spectrumData;
                    } else {
                      // Spectrum data: convert to Float32Array as before
                      const waveform = new Float32Array(
                        decryptedBytes.buffer,
                        decryptedBytes.byteOffset,
                        decryptedBytes.byteLength / 4,
                      );
                      const spectrumData = {
                        type: "spectrum",
                        waveform: waveform,
                        is_mock_apt: false,
                        center_frequency_hz: centerFrequencyHz,
                        waveform_span_mhz: null,
                        timestamp: timestamp,
                        data_type: "spectrum_db",
                        sample_rate: sampleRate,
                      };
                      dataRef.current = spectrumData;
                    }
                  })
                  .catch((e) => {
                    console.error("Binary decryption failed:", e);
                    dispatch({ type: "CRYPTO_CORRUPTED" });
                  });
              } catch (e) {
                console.error("Failed to parse binary WebSocket payload:", e);
              }
            }
            return;
          }

          const raw = event.data as string;

          // JSON spectrum path for live multi-hop metadata (waveform_span_mhz)
          if (raw.includes('"type":"spectrum"')) {
            try {
              const parsedData = JSON.parse(raw);
              if (parsedData.type === "spectrum") {
                dataRef.current = parsedData;
              }
            } catch {
              /* ignore */
            }
            return;
          }

          // Backwards compatibility / mock mode handling (still using JSON)
          if (raw.includes('"type":"encrypted_spectrum"')) {
            if (aesKeyRef.current) {
              try {
                const envelope = JSON.parse(raw);
                if (
                  envelope.type === "encrypted_spectrum" &&
                  typeof envelope.payload === "string"
                ) {
                  decryptPayload(aesKeyRef.current, envelope.payload)
                    .then((plaintext) => {
                      if (disposed) return;
                      const parsedData = JSON.parse(plaintext);
                      // Store in mutable state instead of React state to avoid re-renders
                      if (
                        parsedData.type === "batch" &&
                        parsedData.messages &&
                        parsedData.messages.length > 0
                      ) {
                        const firstMessage = JSON.parse(
                          parsedData.messages[0],
                        );
                        dataRef.current = firstMessage;
                      } else {
                        dataRef.current = parsedData;
                      }
                    })
                    .catch(() => {
                      // Decryption failed — likely wrong key or corrupted frame
                    });
                }
              } catch {
                /* ignore */
              }
            }
            return;
          }

          // Status messages are low-frequency and MUST be processed
          // immediately — rAF batching would drop intermediate state
          // transitions (e.g. loading → connected) causing stale UI.
          if (!disposed) {
            processSingleMessage(raw);
          }
        };

        const processSingleMessage = (raw: string) => {
          // ── Status messages (backend-driven device state) ────────
          if (raw.includes('"type":"status"')) {
            try {
              const parsedData = JSON.parse(raw);
              const paused = parsedData.paused || false;
              const updates: Partial<WsState> = {
                serverPaused: paused,
                // NOTE: Do NOT set isPaused here. isPaused is owned by the
                // user's explicit play/pause toggle (via SpectrumProvider).
                // Device-status broadcasts fire on every hotplug transition
                // and would reset the user's intent.
              };

              if (typeof parsedData.backend === "string") {
                updates.backend = parsedData.backend;
              }
              if (typeof parsedData.device_info === "string") {
                updates.deviceInfo = parsedData.device_info;
              }
              if (typeof parsedData.device_name === "string") {
                updates.deviceName = parsedData.device_name;
              }
              if (
                parsedData.device_profile &&
                typeof parsedData.device_profile.kind === "string" &&
                typeof parsedData.device_profile.is_rtl_sdr === "boolean" &&
                typeof parsedData.device_profile.supports_approx_dbm === "boolean" &&
                typeof parsedData.device_profile.supports_raw_iq_stream === "boolean"
              ) {
                updates.deviceProfile = parsedData.device_profile as DeviceProfile;
              }
              if (typeof parsedData.max_sample_rate === "number") {
                updates.maxSampleRateHz = parsedData.max_sample_rate;
              }
              if (parsedData.sdr_settings) {
                updates.sdrSettings = parsedData.sdr_settings;
                if (typeof parsedData.sdr_settings.sample_rate === "number") {
                  updates.sampleRateHz = parsedData.sdr_settings.sample_rate;
                }
              }
              if (typeof parsedData.device_state === "string") {
                updates.deviceState = parsedData.device_state as DeviceState;
              }
              if (Array.isArray(parsedData.channels)) {
                updates.spectrumFrames = parsedData.channels
                  .filter((f: any) => f && typeof f.id === "string")
                  .map((f: any) => ({
                    id: f.id,
                    label: typeof f.label === "string" ? f.label : "",
                    min_mhz: Number(f.min_mhz),
                    max_mhz: Number(f.max_mhz),
                    description:
                      typeof f.description === "string" ? f.description : "",
                  }))
                  .filter(
                    (f: SpectrumFrame) =>
                      typeof f.label === "string" &&
                      f.label.length > 0 &&
                      Number.isFinite(f.min_mhz) &&
                      Number.isFinite(f.max_mhz) &&
                      f.max_mhz > f.min_mhz,
                  );
              }
              const reason = parsedData.device_loading_reason;
              if (
                reason === "connect" ||
                reason === "restart" ||
                reason === null
              ) {
                updates.deviceLoadingReason = reason;
              }
              dispatch({ type: "STATUS", updates });
            } catch {
              /* ignore */
            }
          }

          // ── Capture status messages (plaintext) ─────────────────
          if (raw.includes('"type":"capture_status"')) {
            try {
              const parsed = JSON.parse(raw);
              const statusObj = parsed.status || {};
              if (
                typeof statusObj.jobId === "string" &&
                (statusObj.status === "started" ||
                  statusObj.status === "progress" ||
                  statusObj.status === "done" ||
                  statusObj.status === "failed")
              ) {
                const newStatus: any = {
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
                };
                if (statusObj.error) {
                  newStatus.error = statusObj.error;
                }
                dispatch({ type: "CAPTURE_STATUS", status: newStatus });
              }
            } catch (e) {
              // Silently handle JSON parsing errors
            }
          }

          // ── Auto FFT options messages (plaintext) ─────────────────
          if (raw.includes('"type":"auto_fft_options"')) {
            try {
              const parsed = JSON.parse(raw);
              if (
                Array.isArray(parsed.autoSizes) &&
                typeof parsed.recommended === "number"
              ) {
                const options: AutoFftOptionsResponse = {
                  type: "auto_fft_options",
                  autoSizes: parsed.autoSizes,
                  recommended: parsed.recommended,
                };
                dispatch({ type: "AUTO_FFT_OPTIONS", options });
              }
            } catch (e) {
              // Silently handle JSON parsing errors
            }
          }
        };

        ws.onclose = () => {
          if (disposed) return;
          dispatch({ type: "DISCONNECTED" });
          
          // Exponential backoff reconnection logic
          const maxAttempts = 5;
          if (reconnectAttemptRef.current < maxAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
            reconnectTimeoutRef.current = window.setTimeout(() => {
              reconnectAttemptRef.current++;
              connect();
            }, delay);
          }
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
        };

      } catch (error) {
        console.error("Failed to create WebSocket:", error);
        dispatch({ type: "DISCONNECTED" });
      }
    };

    connect();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [url, aesKey, enabled, dispatch]);

  // Function to send settings updates to the server
  const sendSettings = useCallback((settings: SDRSettings) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

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
      console.warn(
        "[useWebSocket] Ignoring settings update with no valid values",
        settings,
      );
      return;
    }

    sanitized.type = "settings";
    ws.send(JSON.stringify(sanitized));
  }, []);

  // Function to send device restart command to the server
  const sendRestartDevice = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "restart_device",
      });
      ws.send(message);
    }
  }, []);

  // Function to send training capture commands to the server
  const sendTrainingCommand = useCallback(
    (
      action: "start" | "stop",
      label: "target" | "noise",
      signalArea: string,
    ) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({
          type: "training_capture",
          action,
          label,
          signalArea,
        });
        ws.send(message);
      }
    },
    [],
  );

  // Function to request auto FFT options from the server
  const sendGetAutoFftOptions = useCallback((screenWidth: number) => {
    // Check if we already have auto FFT options cached
    if (state.autoFftOptions) {
      console.log('Auto FFT options already cached, skipping WebSocket request');
      return;
    }
    
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "get_auto_fft_options",
        screenWidth: screenWidth,
      });
      ws.send(message);
    }
  }, [state.autoFftOptions]);

  // Function to send pause/resume commands to the server
  const sendPauseCommand = useCallback((isPaused: boolean) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "pause",
        paused: isPaused,
      });
      ws.send(message);
    }
  }, []);

  // Function to send frequency range updates to the server
  const sendFrequencyRange = useCallback((range: FrequencyRange) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "frequency_range",
        min_mhz: range.min,
        max_mhz: range.max,
      });
      ws.send(message);
    }
  }, []);

  // Function to send capture commands to the server
  const sendCaptureCommand = useCallback(
    (req: CaptureRequest) => {
      const ws = wsRef.current;

      if (ws && ws.readyState === WebSocket.OPEN) {
        // Optimistically clear previous capture status
        dispatch({ type: "CAPTURE_STATUS", status: null });

        const message = JSON.stringify({
          type: "capture",
          jobId: req.jobId,
          fragments: req.fragments,
          durationS: req.durationS,
          fileType: req.fileType,
          acquisitionMode: req.acquisitionMode,
          encrypted: req.encrypted,
          fftSize: req.fftSize,
          fftWindow: req.fftWindow,
          geolocation: req.geolocation,
        });
        ws.send(message);
      }
    },
    [dispatch],
  );

  // Function to send power scale command to the server
  const sendPowerScaleCommand = useCallback((scale: "dB" | "dBm") => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = JSON.stringify({
      type: 'power_scale',
      data: { powerScale: scale },
    });
    ws.send(message);
  }, []);

  return {
    ...state,
    dataRef,
    sendFrequencyRange,
    sendPauseCommand,
    sendSettings,
    sendRestartDevice,
    sendCaptureCommand,
    sendTrainingCommand,
    sendGetAutoFftOptions,
    sendPowerScaleCommand,
  };
};
