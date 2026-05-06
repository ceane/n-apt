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

export type DeviceState =
  | "connected"
  | "loading"
  | "disconnected"
  | "stale"
  | null;
export type DeviceLoadingReason = "connect" | "restart" | null;

export type SpectrumFrame = {
  id: string;
  label: string;
  min_hz: number;
  max_hz: number;
  description: string;
};

export type SdrSettingsConfig = {
  sample_rate: number;
  center_frequency: number;
  gain?: {
    tuner_gain: number;
    rtl_agc: boolean;
    tuner_agc: boolean;
  };
  ppm?: number;
  fft?: {
    default_size: number;
    default_frame_rate: number;
    max_size: number;
    max_frame_rate: number;
    size_to_frame_rate?: Record<string, number>;
  };
  display?: {
    min_db: number;
    max_db: number;
    padding: number;
  };
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
  maxSampleRateHz: number | null;
  sampleRateHz: number | null;
  sdrSettings: SdrSettingsConfig | null;
  dataRef: React.MutableRefObject<any>;
  spectrumFrames: SpectrumFrame[];
  captureStatus: any;
  autoFftOptions: any;
  error: string | null;
  sendFrequencyRange: (range: FrequencyRange) => void;
  sendPauseCommand: (isPaused: boolean) => void;
  sendSettings: (settings: SDRSettings) => void;
  sendRestartDevice: () => void;
  sendCaptureCommand: (req: any) => void;
  sendTrainingCommand: (
    action: "start" | "stop",
    label: "target" | "noise",
    signalArea: string,
  ) => void;
  sendGetAutoFftOptions: (screenWidth: number) => void;
  // Included in mock for historical reasons
  simulateError?: (errorType: "connection" | "timeout" | "device") => void;
};

export function useWebSocket(
  url: string | null,
  aesKey: CryptoKey | null,
  enabled: boolean,
): WebSocketData {
  const [isConnected, setIsConnected] = useState(false);
  const [deviceState, setDeviceState] = useState<DeviceState>(null);
  const [deviceLoadingReason, setDeviceLoadingReason] =
    useState<DeviceLoadingReason>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [serverPaused, setServerPaused] = useState(false);
  const [backend, setBackend] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spectrumFrames, setSpectrumFrames] = useState<SpectrumFrame[]>([]);
  const [sdrSettings, setSdrSettings] = useState<SdrSettingsConfig | null>(null);

  const dataRef = useRef<any>(null);

  // Mock connection logic
  useEffect(() => {
    if (!url || !enabled) {
      setIsConnected(false);
      setDeviceState(null);
      setBackend(null);
      setDeviceInfo(null);
      setError(null);
      setSpectrumFrames([]);
      setSdrSettings(null);
      return;
    }

    setIsConnected(true);
    setDeviceState("connected");
    setBackend("mock");
    setDeviceInfo("Mock RTL-SDR Device");
    setDeviceLoadingReason(null);
    setSpectrumFrames([]);
    setSdrSettings(null);
  }, [url, enabled]);

  const sendFrequencyRange = useCallback((_range: FrequencyRange) => {}, []);
  const sendPauseCommand = useCallback((paused: boolean) => {
    setIsPaused(paused);
    setServerPaused(paused);
  }, []);
  const sendSettings = useCallback((_settings: SDRSettings) => {}, []);
  const sendRestartDevice = useCallback(() => {}, []);
  const sendTrainingCommand = useCallback(() => {}, []);
  const sendCaptureCommand = useCallback((_req: any) => {}, []);
  const sendGetAutoFftOptions = useCallback((_screenWidth: number) => {}, []);

  const simulateError = useCallback(
    (errorType: "connection" | "timeout" | "device") => {
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
    deviceName: "Mock Device",
    maxSampleRateHz: 3_200_000,
    sampleRateHz: 3_200_000,
    sdrSettings,
    dataRef,
    spectrumFrames,
    captureStatus: null,
    autoFftOptions: null,
    error,
    sendFrequencyRange,
    sendPauseCommand,
    sendSettings,
    sendRestartDevice,
    sendCaptureCommand,
    sendTrainingCommand,
    sendGetAutoFftOptions,
    simulateError,
  };
}
