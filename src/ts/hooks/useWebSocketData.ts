import { useCallback, useRef, useEffect, useState } from "react";

export interface WebSocketDataOptions {
  wsUrl: string;
  aesKey: CryptoKey | null;
  onFrequencyRangeChange?: (min: number, max: number) => void;
  onPauseChange?: (paused: boolean) => void;
}

export interface WebSocketDataState {
  isConnected: boolean;
  deviceState: string;
  deviceLoadingReason?: string;
  backend: any;
  deviceInfo?: any;
  maxSampleRateHz?: number;
  serverPaused: boolean;
  data: { waveform?: number[]; timestamp?: number } | null;
  captureStatus: string;
  spectrumFrames: any[];
}

export function useWebSocketData({
  wsUrl,
  aesKey,
}: WebSocketDataOptions): WebSocketDataState & {
  sendFrequencyRange: (min: number, max: number) => void;
  sendPauseCommand: (paused: boolean) => void;
  sendSettings: (settings: any) => void;
  sendRestartDevice: () => void;
  sendTrainingCommand: (command: string, label?: string) => void;
  sendCaptureCommand: (command: string) => void;
} {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<WebSocketDataState>({
    isConnected: false,
    deviceState: "disconnected",
    backend: null,
    serverPaused: false,
    data: null,
    captureStatus: "idle",
    spectrumFrames: [],
  });

  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 1000; // Start with 1 second

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!wsUrl || !aesKey) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        setState((prev) => ({ ...prev, isConnected: true }));
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case "spectrum_data":
              setState((prev: WebSocketDataState) => ({
                ...prev,
                data: {
                  waveform: message.data.waveform,
                  timestamp: message.data.timestamp,
                },
              }));
              break;

            case "device_state":
              setState((prev: WebSocketDataState) => ({
                ...prev,
                deviceState: message.state,
                deviceLoadingReason: message.reason,
                deviceInfo: message.device_info,
              }));
              break;

            case "backend_info":
              setState((prev: WebSocketDataState) => ({
                ...prev,
                backend: message.backend,
                maxSampleRateHz: message.max_sample_rate_hz,
              }));
              break;

            case "pause_state":
              setState((prev: WebSocketDataState) => ({
                ...prev,
                serverPaused: message.paused,
              }));
              break;

            case "capture_status":
              setState((prev: WebSocketDataState) => ({
                ...prev,
                captureStatus: message.status,
              }));
              break;

            default:
              console.log("Unknown message type:", message.type);
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.onclose = (event) => {
        console.log("WebSocket disconnected:", event.code, event.reason);
        setState((prev: WebSocketDataState) => ({
          ...prev,
          isConnected: false,
        }));

        // Attempt reconnection if not explicitly closed
        if (
          event.code !== 1000 &&
          reconnectAttemptsRef.current < maxReconnectAttempts
        ) {
          const delay =
            reconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            console.log(
              `Attempting reconnection (${reconnectAttemptsRef.current}/${maxReconnectAttempts})`,
            );
            connect();
          }, delay);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
    }
  }, [wsUrl, aesKey]);

  const sendFrequencyRange = useCallback((min: number, max: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "set_frequency_range",
          min,
          max,
        }),
      );
    }
  }, []);

  const sendPauseCommand = useCallback((paused: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "set_pause",
          paused,
        }),
      );
    }
  }, []);

  const sendSettings = useCallback((settings: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "set_settings",
          settings,
        }),
      );
    }
  }, []);

  const sendRestartDevice = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "restart_device",
        }),
      );
    }
  }, []);

  const sendTrainingCommand = useCallback((command: string, label?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "training_command",
          command,
          label,
        }),
      );
    }
  }, []);

  const sendCaptureCommand = useCallback((command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "capture_command",
          command,
        }),
      );
    }
  }, []);

  // Connect when URL and key are available
  useEffect(() => {
    if (wsUrl && aesKey) {
      connect();
    }

    return cleanup;
  }, [wsUrl, aesKey, connect, cleanup]);

  return {
    ...state,
    sendFrequencyRange,
    sendPauseCommand,
    sendSettings,
    sendRestartDevice,
    sendTrainingCommand,
    sendCaptureCommand,
  };
}
