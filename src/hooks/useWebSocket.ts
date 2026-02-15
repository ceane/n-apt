import { useState, useEffect, useRef, useCallback } from "react";
import { decryptPayload } from "@n-apt/crypto/webcrypto";

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

export type DeviceState = "connected" | "loading" | "disconnected" | "stale" | null;
export type DeviceLoadingReason = "connect" | "restart" | null;

export type WebSocketData = {
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  serverPaused: boolean;
  backend: string | null;
  deviceInfo: string | null;
  data: any;
  error: string | null;
  sendFrequencyRange: (range: FrequencyRange) => void;
  sendPauseCommand: (isPaused: boolean) => void;
  sendSettings: (settings: SDRSettings) => void;
  sendRestartDevice: () => void;
  sendTrainingCommand: (
    action: "start" | "stop",
    label: "target" | "noise",
    signalArea: string,
  ) => void;
};

// Reconnect backoff schedule (seconds)
const RECONNECT_BACKOFF = [2, 5, 10, 30, 60, 90];

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
  const [isConnected, setIsConnected] = useState(false);
  const [deviceState, setDeviceState] = useState<DeviceState>(null);
  const [deviceLoadingReason, setDeviceLoadingReason] = useState<DeviceLoadingReason>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [serverPaused, setServerPaused] = useState(false);
  const [backend, setBackend] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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

      setIsConnected(false);
      return;
    } else {
      const connect = () => {
        try {
          const ws = new WebSocket(url);
          wsRef.current = ws;

          ws.onopen = () => {
            setIsConnected(true);
            setError(null);
            // Reset backoff on successful connection
            reconnectAttemptRef.current = 0;
          };

          ws.onmessage = (event) => {
            const raw = event.data as string;

            // ── Status messages (backend-driven device state) ────────
            if (raw.includes('"message_type":"status"')) {
              try {
                const parsedData = JSON.parse(raw);
                const paused = parsedData.paused || false;

                if (typeof parsedData.backend === "string") {
                  setBackend(parsedData.backend);
                }
                if (typeof parsedData.device_info === "string") {
                  setDeviceInfo(parsedData.device_info);
                }
                if (typeof parsedData.device_state === "string") {
                  setDeviceState(parsedData.device_state as DeviceState);
                }
                const reason = parsedData.device_loading_reason;
                if (reason === "connect" || reason === "restart" || reason === null) {
                  setDeviceLoadingReason(reason);
                }
                setServerPaused(paused);
                setIsPaused(paused);
              } catch {
                /* ignore */
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
                            setData(parsedData);
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
                    setData(parsedData);
                  } catch {
                    /* ignore */
                  }
                }
              });
            }
          };

          ws.onclose = () => {
            setIsConnected(false);
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
              setError("WebSocket connection error");
            }
          };
        } catch {
          setError("Failed to create WebSocket connection");
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
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "frequency_range",
        minFreq: range.min,
        maxFreq: range.max,
      });
      ws.send(message);
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

  return {
    isConnected,
    deviceState,
    deviceLoadingReason,
    isPaused,
    serverPaused,
    backend,
    deviceInfo,
    data,
    error,
    sendFrequencyRange,
    sendPauseCommand,
    sendSettings,
    sendRestartDevice,
    sendTrainingCommand,
  };
};
