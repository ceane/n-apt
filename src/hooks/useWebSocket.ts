import { useReducer, useEffect, useRef, useCallback } from "react";
import { decryptPayload, decryptBinaryPayload } from "@n-apt/crypto/webcrypto";

// Types
export type FrequencyRange = {
  min: number;
  max: number;
};

export type SDRSettings = {
  fftSize?: number;
  fftWindow?: string;
  frameRate?: number;
  gain?: number;
  ppm?: number;
  tunerAGC?: boolean;
  rtlAGC?: boolean;
};

export type CaptureFileType = ".napt" | ".wav";

export type CaptureRequest = {
  jobId: string;
  minFreq: number;
  maxFreq: number;
  durationS: number;
  fileType: CaptureFileType;
  encrypted: boolean;
  fftSize: number;
  fftWindow: string;
};

export type CaptureStatus = {
  jobId: string;
  status: "started" | "failed" | "done";
  error?: string;
  downloadUrl?: string;
  filename?: string;
  fileCount?: number;
} | null;

export type DeviceState = "connected" | "loading" | "disconnected" | "stale" | null;
export type DeviceLoadingReason = "connect" | "restart" | null;

export type SpectrumFrame = {
  id: string;
  label: string;
  min_mhz: number;
  max_mhz: number;
  description: string;
};

export type AutoFftOptionsResponse = {
  message_type: "auto_fft_options";
  autoSizes: number[];
  recommended: number;
};

export type WebSocketData = {
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  serverPaused: boolean;
  backend: string | null;
  deviceInfo: string | null;
  maxSampleRateHz: number | null;
  dataRef: React.MutableRefObject<any>;
  spectrumFrames: SpectrumFrame[];
  captureStatus: CaptureStatus;
  autoFftOptions: AutoFftOptionsResponse | null;
  error: string | null;
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
};

// Reconnect backoff schedule (seconds)
const RECONNECT_BACKOFF = [2, 5, 10, 30, 60, 90];

type WsState = {
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  serverPaused: boolean;
  backend: string | null;
  deviceInfo: string | null;
  maxSampleRateHz: number | null;
  data: any;
  spectrumFrames: SpectrumFrame[];
  captureStatus: CaptureStatus;
  autoFftOptions: AutoFftOptionsResponse | null;
  error: string | null;
};

type WsAction =
  | { type: "CONNECTED" }
  | { type: "DISCONNECTED" }
  | { type: "RESET" }
  | { type: "ERROR"; error: string }
  | { type: "STATUS"; updates: Partial<WsState> }
  | { type: "CAPTURE_STATUS"; status: CaptureStatus }
  | { type: "AUTO_FFT_OPTIONS"; options: AutoFftOptionsResponse }
  | { type: "DATA"; data: any };

const INITIAL_WS_STATE: WsState = {
  isConnected: false,
  deviceState: null,
  deviceLoadingReason: null,
  isPaused: false,
  serverPaused: false,
  backend: null,
  deviceInfo: null,
  maxSampleRateHz: null,
  data: null,
  spectrumFrames: [],
  captureStatus: null,
  autoFftOptions: null,
  error: null,
};

function wsReducer(state: WsState, action: WsAction): WsState {
  switch (action.type) {
    case "CONNECTED":
      return { ...state, isConnected: true, error: null };
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
  // Store raw message string — only JSON.parse inside rAF to avoid parsing discarded frames
  const pendingRawRef = useRef<string | null>(null);
  const processingRef = useRef(false);
  // Exponential backoff counter
  const reconnectAttemptRef = useRef(0);
  // Error debounce — only set error state once per cooldown
  const lastErrorTimeRef = useRef(0);
  // Keep a ref to the AES key so the message handler always sees the latest
  const aesKeyRef = useRef<CryptoKey | null>(aesKey);
  aesKeyRef.current = aesKey;
  
  // Mutable ref for high-frequency spectrum data to avoid React re-renders
  const dataRef = useRef<any>(null);

  useEffect(() => {
    if (!enabled || !url) {
      // Close existing connection if disabled
      const ws = wsRef.current;
      wsRef.current = null;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (ws) {
        ws.close();
      }

      dispatch({ type: "DISCONNECTED" });
      return;
    } else {
      const connect = () => {
        try {
          const ws = new WebSocket(url);
          ws.binaryType = "arraybuffer"; // Set to receive binary payloads
          wsRef.current = ws;

          ws.onopen = () => {
            dispatch({ type: "CONNECTED" });
            reconnectAttemptRef.current = 0;
          };

          // WebSocket message handler with rAF-batched processing
          ws.onmessage = (event) => {
            // Binary fast-path for spectrum data
            if (event.data instanceof ArrayBuffer) {
              if (aesKeyRef.current) {
                try {
                  const buffer = event.data;
                  const view = new DataView(buffer);
                  
                  // 1. Extract metadata: [timestamp: 8 bytes][center_frequency: 8 bytes]
                  const timestamp = Number(view.getBigUint64(0, true)); // true = little-endian
                  const centerFrequencyHz = Number(view.getBigUint64(8, true));
                  
                  // 2. Extract encrypted payload
                  const encryptedPayload = new Uint8Array(buffer, 16);
                  
                  // 3. Decrypt the binary payload
                  decryptBinaryPayload(aesKeyRef.current, encryptedPayload)
                    .then((decryptedBytes) => {
                      // 4. Convert decrypted bytes back to Float32Array
                      const waveform = new Float32Array(
                        decryptedBytes.buffer,
                        decryptedBytes.byteOffset,
                        decryptedBytes.byteLength / 4
                      );
                      
                      // 5. Reconstruct the SpectrumData object format expected by the frontend
                      const spectrumData = {
                        message_type: "spectrum",
                        waveform: waveform,
                        is_mock: false, // We'll assume real unless backend tells us otherwise (binary fast path is mostly real)
                        center_frequency_hz: centerFrequencyHz,
                        timestamp: timestamp,
                      };
                      
                      dataRef.current = spectrumData;
                    })
                    .catch((e) => {
                      console.error("Binary decryption failed:", e);
                    });
                } catch (e) {
                  console.error("Failed to parse binary WebSocket payload:", e);
                }
              }
              return;
            }

            const raw = event.data as string;
            
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
                        const parsedData = JSON.parse(plaintext);
                        // Store in mutable state instead of React state to avoid re-renders
                        if (
                          parsedData.message_type === "batch" &&
                          parsedData.messages &&
                          parsedData.messages.length > 0
                        ) {
                          const firstMessage = JSON.parse(parsedData.messages[0]);
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

            // For all other messages (status, etc.), batch them
            messageBatch.push(raw);

            if (batchRafId === null) {
              batchRafId = requestAnimationFrame(() => {
                // Keep only the most recent message to avoid heavy per-frame work
                const latest = messageBatch.pop();
                messageBatch = [];
                batchRafId = null;

                if (latest) {
                  processSingleMessage(latest);
                }
              });
            }
          };

          // Message batching for performance (defer work off the WS handler)
          let messageBatch: string[] = [];
          let batchRafId: number | null = null;

          const processSingleMessage = (raw: string) => {
            // ── Status messages (backend-driven device state) ────────
            if (raw.includes('"message_type":"status"')) {
              try {
                const parsedData = JSON.parse(raw);
                const paused = parsedData.paused || false;
                const updates: Partial<WsState> = {
                  serverPaused: paused,
                  isPaused: paused,
                };

                if (typeof parsedData.backend === "string") {
                  updates.backend = parsedData.backend;
                }
                if (typeof parsedData.device_info === "string") {
                  updates.deviceInfo = parsedData.device_info;
                }
                if (typeof parsedData.max_sample_rate === "number") {
                  updates.maxSampleRateHz = parsedData.max_sample_rate;
                }
                if (typeof parsedData.device_state === "string") {
                  updates.deviceState = parsedData.device_state as DeviceState;
                }
                if (Array.isArray(parsedData.spectrum_frames)) {
                  updates.spectrumFrames = parsedData.spectrum_frames
                    .filter((f: any) => f && typeof f.id === "string")
                    .map((f: any) => ({
                      id: f.id,
                      label: typeof f.label === "string" ? f.label : "",
                      min_mhz: Number(f.min_mhz),
                      max_mhz: Number(f.max_mhz),
                      description: typeof f.description === "string" ? f.description : "",
                    }))
                    .filter(
                      (f: SpectrumFrame) =>
                        typeof f.label === "string" &&
                        f.label.length > 0 &&
                        f.label.length <= 2 &&
                        Number.isFinite(f.min_mhz) &&
                        Number.isFinite(f.max_mhz) &&
                        f.max_mhz > f.min_mhz,
                    );
                }
                const reason = parsedData.device_loading_reason;
                if (reason === "connect" || reason === "restart" || reason === null) {
                  updates.deviceLoadingReason = reason;
                }
                dispatch({ type: "STATUS", updates });
              } catch {
                /* ignore */
              }
              return;
            }

            // ── Capture status messages (plaintext) ─────────────────
            if (raw.includes('"message_type":"capture_status"')) {
              console.log("Received capture status message:", raw);
              try {
                const parsed = JSON.parse(raw);
                console.log("Parsed capture status:", parsed);
                if (
                  typeof parsed.job_id === "string" &&
                  (parsed.status === "started" ||
                    parsed.status === "failed" ||
                    parsed.status === "done")
                ) {
                  const newStatus = {
                    jobId: parsed.job_id,
                    status: parsed.status,
                    error: typeof parsed.error === "string" ? parsed.error : undefined,
                    downloadUrl:
                      typeof parsed.download_url === "string" ? parsed.download_url : undefined,
                    filename: typeof parsed.filename === "string" ? parsed.filename : undefined,
                    fileCount:
                      typeof parsed.file_count === "number" ? parsed.file_count : undefined,
                  };
                  console.log("Setting capture status:", newStatus);
                  dispatch({ type: "CAPTURE_STATUS", status: newStatus });
                }
              } catch (e) {
                console.error("Failed to parse capture status:", e);
              }
              return;
            }

            // ── Auto FFT options messages (plaintext) ─────────────────
            if (raw.includes('"message_type":"auto_fft_options"')) {
              console.log("Received auto FFT options message:", raw);
              try {
                const parsed = JSON.parse(raw);
                if (
                  Array.isArray(parsed.autoSizes) &&
                  typeof parsed.recommended === "number"
                ) {
                  const options: AutoFftOptionsResponse = {
                    message_type: "auto_fft_options",
                    autoSizes: parsed.autoSizes,
                    recommended: parsed.recommended,
                  };
                  console.log("Setting auto FFT options:", options);
                  dispatch({ type: "AUTO_FFT_OPTIONS", options });
                }
              } catch (e) {
                console.error("Failed to parse auto FFT options:", e);
              }
              return;
            }

            // ── Encrypted spectrum data ─────────────────────────────
            if (raw.includes('"type":"encrypted_spectrum"')) {
              pendingRawRef.current = raw;

              if (!processingRef.current) {
                processingRef.current = true;
                requestAnimationFrame(() => {
                  const pending = pendingRawRef.current;
                  pendingRawRef.current = null;
                  processingRef.current = false;

                  if (pending && aesKeyRef.current) {
                    try {
                      const envelope = JSON.parse(pending);
                      if (
                        envelope.type === "encrypted_spectrum" &&
                        typeof envelope.payload === "string"
                      ) {
                        decryptPayload(aesKeyRef.current, envelope.payload)
                          .then((plaintext) => {
                            const parsedData = JSON.parse(plaintext);

                            // Handle batched messages
                            if (
                              parsedData.message_type === "batch" &&
                              parsedData.messages &&
                              parsedData.messages.length > 0
                            ) {
                              const firstMessage = JSON.parse(parsedData.messages[0]);
                              dispatch({ type: "DATA", data: firstMessage });
                            } else {
                              dispatch({ type: "DATA", data: parsedData });
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
                });
              }
              return;
            }

            // ── Legacy unencrypted spectrum data (fallback) ─────────
            pendingRawRef.current = raw;

            if (!processingRef.current) {
              processingRef.current = true;
              requestAnimationFrame(() => {
                const pending = pendingRawRef.current;
                pendingRawRef.current = null;
                processingRef.current = false;

                if (pending) {
                  try {
                    const parsedData = JSON.parse(pending);
                    dispatch({ type: "DATA", data: parsedData });
                  } catch {
                    /* ignore */
                  }
                }
              });
            }
          };

          ws.onclose = () => {
            dispatch({ type: "DISCONNECTED" });
            // Only attempt to reconnect if we haven't been cleaned up
            if (wsRef.current !== null) {
              const attempt = reconnectAttemptRef.current;
              const delaySec = RECONNECT_BACKOFF[Math.min(attempt, RECONNECT_BACKOFF.length - 1)];
              reconnectAttemptRef.current = attempt + 1;
              const timeoutId = setTimeout(connect, delaySec * 1000) as any;
              reconnectTimeoutRef.current = timeoutId;
            }
          };

          ws.onerror = () => {
            // Debounce error state — only update once per 10 seconds
            const now = Date.now();
            if (now - lastErrorTimeRef.current > 10_000) {
              lastErrorTimeRef.current = now;
              dispatch({ type: "ERROR", error: "WebSocket connection error" });
            }
          };
        } catch {
          dispatch({ type: "ERROR", error: "Failed to create WebSocket connection" });
        }
      };

      connect();

      return () => {
        // Cleanup function - set wsRef to null first to prevent reconnection attempts
        const ws = wsRef.current;
        wsRef.current = null;

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        if (ws) {
          ws.close();
        }
      };
    }
  }, [url, enabled]);

  // Function to send frequency range updates to the server
  const sendFrequencyRange = useCallback((range: FrequencyRange) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "set_frequency_range",
          minFreq: range.min,
          maxFreq: range.max,
        }),
      );
    }
  }, []);

  const sendCaptureCommand = useCallback((req: CaptureRequest) => {
    console.log("sendCaptureCommand called with:", req);
    const ws = wsRef.current;
    const readyStateText = ws
      ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][ws.readyState] || "UNKNOWN"
      : "NO_WS";
    console.log("WebSocket state:", {
      exists: !!ws,
      readyState: ws?.readyState,
      OPEN: WebSocket.OPEN,
      readyStateText,
    });

    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "capture",
        action: "start",
        jobId: req.jobId,
        minFreq: req.minFreq,
        maxFreq: req.maxFreq,
        durationS: req.durationS,
        fileType: req.fileType,
        encrypted: req.encrypted,
        fftSize: req.fftSize,
        fftWindow: req.fftWindow,
      });
      console.log("Sending WebSocket message:", message);
      ws.send(message);
      console.log("WebSocket message sent successfully");
    } else {
      console.log("WebSocket not ready - message not sent");
    }
  }, []);

  // Function to send pause/resume commands to the server
  const sendPauseCommand = useCallback((paused: boolean) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "pause",
        paused: paused,
      });
      ws.send(message);
    }
  }, []);

  // Function to send settings updates to the server
  const sendSettings = useCallback((settings: SDRSettings) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "settings",
        ...settings,
      });
      ws.send(message);
    }
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
    (action: "start" | "stop", label: "target" | "noise", signalArea: string) => {
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
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "get_auto_fft_options",
        screenWidth: screenWidth,
      });
      console.log("Requesting auto FFT options for screen width:", screenWidth);
      ws.send(message);
    }
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
  };
};
