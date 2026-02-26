import { useState, useEffect, useRef, useCallback } from "react";

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

export function useWebSocket(
  url: string | null,
  aesKey: CryptoKey | null,
  enabled: boolean,
): WebSocketData {
  const [isConnected, setIsConnected] = useState(false);
  const [deviceState, setDeviceState] = useState<DeviceState>(null);
  const [deviceLoadingReason, setDeviceLoadingReason] = useState<DeviceLoadingReason>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [serverPaused, setServerPaused] = useState(false);
  const [backend, setBackend] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const reconnectAttemptRef = useRef(0);

  // Mock connection logic
  useEffect(() => {
    if (!url || !enabled) {
      // Close existing connection if disabled
      setIsConnected(false);
      setDeviceState(null);
      setBackend(null);
      setDeviceInfo(null);
      setError(null);
      return;
    }

    const connect = () => {
      setIsConnected(false);
      setError(null);

      // Connect immediately for testing
      setIsConnected(true);
      setDeviceState("connected");
      setBackend("mock");
      setDeviceInfo("Mock RTL-SDR Device");
      setDeviceLoadingReason(null);
      reconnectAttemptRef.current = 0;
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      setIsConnected(false);
      setDeviceState(null);
      setBackend(null);
      setDeviceInfo(null);
    };
  }, [url, enabled]);

  // Mock data updates
  useEffect(() => {
    if (isConnected) {
      const interval = setInterval(() => {
        setData({
          waveform: new Float32Array(1024).fill(-60).map((_, i) => -60 + Math.sin(i * 0.1) * 20),
          timestamp: Date.now(),
          frequencyRange: { min: 0, max: 3.2 },
        });
      }, 100);

      return () => clearInterval(interval);
    }
  }, [isConnected]);

  const sendFrequencyRange = useCallback(
    (range: FrequencyRange) => {
      if (!isConnected) {
        setError("Not connected");
        return;
      }
      // Mock implementation
      console.log("Sending frequency range:", range);
    },
    [isConnected],
  );

  const sendPauseCommand = useCallback(
    (paused: boolean) => {
      if (!isConnected) {
        setError("Not connected");
        return;
      }
      setIsPaused(paused);
      setServerPaused(paused);
      console.log("Sending pause command:", paused);
    },
    [isConnected],
  );

  const sendSettings = useCallback(
    (settings: SDRSettings) => {
      if (!isConnected) {
        setError("Not connected");
        return;
      }
      console.log("Sending settings:", settings);
    },
    [isConnected],
  );

  const sendRestartDevice = useCallback(() => {
    if (!isConnected) {
      setError("Not connected");
      return;
    }
    setDeviceState("loading");
    setDeviceLoadingReason("restart");
    setTimeout(() => {
      setDeviceState("connected");
      setDeviceLoadingReason(null);
    }, 2000);
    console.log("Restarting device");
  }, [isConnected]);

  const sendTrainingCommand = useCallback(
    (action: "start" | "stop", label: "target" | "noise", signalArea: string) => {
      if (!isConnected) {
        setError("Not connected");
        return;
      }
      console.log("Sending training command:", { action, label, signalArea });
    },
    [isConnected],
  );

  // Mock error scenarios
  const simulateError = useCallback((errorType: "connection" | "timeout" | "device") => {
    switch (errorType) {
      case "connection":
        setError("Connection lost");
        setIsConnected(false);
        setDeviceState("disconnected");
        break;
      case "timeout":
        setError("Request timeout");
        break;
      case "device":
        setDeviceState("stale");
        setError("Device error");
        break;
    }
  }, []);

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
    simulateError,
  };
}
