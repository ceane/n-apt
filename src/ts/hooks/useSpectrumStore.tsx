import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import type {
  FrequencyRange,
  SpectrumFrame,
  SdrSettingsConfig,
  DeviceProfile,
  CaptureStatus,
  AutoFftOptionsResponse,
  SDRSettings,
  CaptureRequest,
} from "@n-apt/consts/schemas/websocket";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { buildWsUrl } from "@n-apt/services/auth";
import { useLocation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@n-apt/redux/store";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";
import {
  connectWebSocket,
  disconnectWebSocket,
  sendPauseCommand as sendPauseCommandThunk,
  sendPowerScaleCommand as sendPowerScaleCommandThunk,
  sendGetAutoFftOptions as sendGetAutoFftOptionsThunk,
  sendTrainingCommand as sendTrainingCommandThunk,
  sendFrequencyRange as sendFrequencyRangeThunk,
  sendSettings as sendSettingsThunk,
  sendRestartDevice as sendRestartDeviceThunk,
  sendCaptureCommand as sendCaptureCommandThunk,
  sendScanCommand as sendScanCommandThunk,
  sendDemodulateCommand as sendDemodulateCommandThunk,
} from "@n-apt/redux/thunks/websocketThunks";
import { deriveStateFromConfig } from "@n-apt/hooks/useSdrSettings";
import {
  createFFTVisualizerMachine,
  type FFTVisualizerMachine,
} from "@n-apt/utils/fftVisualizerMachine";

// Types
export type SourceMode = "live" | "file";
export type SelectedFile = { id: string; name: string; downloadUrl?: string };

const MANUAL_VISUALIZER_PAUSE_KEY = "napt-visualizer-manual-paused";

export const LIVE_CONTROL_DEFAULTS = {
  displayTemporalResolution: "medium" as const,
  powerScale: "dB" as const,
  vizZoom: 1,
  vizPanOffset: 0,
  fftMinDb: -120,
  fftMaxDb: 0,
  fftWindow: "Rectangular",
  gain: 49.6,
  ppm: 1,
  tunerAGC: false,
  rtlAGC: false,
};

export type BeatParams = {
  offsetHz: number;
};

export type DrawParams = {
  spikeCount: number;
  spikeWidth: number;
  centerSpikeBoost: number;
  spikesAmplitude: number; // Unit: dB (max 0)
  decayRate: number;
  envelopeWidth: number;
  centerOffset: number;    // Unit: MHz
  peakAmplitude: number;   // Unit: dB (max 0)
  simulatedNoise: number;
  beats: BeatParams[];     // Up to 2 beats
};

export type SpectrumState = {
  activeSignalArea: string;
  frequencyRange: FrequencyRange | null;
  displayTemporalResolution: "low" | "medium" | "high";
  powerScale: "dB" | "dBm";
  selectedFiles: SelectedFile[];
  snapshotGridPreference: boolean;
  drawParams: DrawParams[];
  activeClumpIndex: number;
  globalNoiseFloor: number; // Unit: dB
  sourceMode: SourceMode;
  stitchStatus: string;
  visualizerPaused: boolean;
  isTrainingCapturing: boolean;
  trainingCaptureLabel: "target" | "noise" | null;
  trainingCapturedSamples: number;
  stitchTrigger: number;
  stitchSourceSettings: { gain: number; ppm: number };
  isStitchPaused: boolean;
  fftFrameRate: number;
  isAutoFftApplied: boolean;
  isWaterfallCleared: boolean;
  vizZoom: number;
  vizPanOffset: number;
  fftMinDb: number;
  fftMaxDb: number;
  fftSize: number;
  fftWindow: string;
  showSpikeOverlay: boolean;
  gain: number;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  sampleRateHz: number;
  heterodyningVerifyRequestId: number;
  heterodyningStatusText: string;
  heterodyningVerifyDisabled: boolean;
  heterodyningDetected: boolean;
  heterodyningConfidence: number | null;
  heterodyningHighlightedBins: Array<{ start: number; end: number }>;
  lastKnownRanges: Record<string, { min: number; max: number }>;
  diagnosticStatus: string;
  isDiagnosticRunning: boolean;
  diagnosticTrigger: number;
  drawSignal3D: boolean;
  displayMode: "fft" | "iq";
};

export type SpectrumAction =
  | { type: "SET_SIGNAL_AREA"; area: string }
  | { type: "SET_FREQUENCY_RANGE"; range: FrequencyRange }
  | {
    type: "SET_SIGNAL_AREA_AND_RANGE";
    area: string;
    range: FrequencyRange;
  }
  | {
    type: "SET_TEMPORAL_RESOLUTION";
    resolution: "low" | "medium" | "high";
  }
  | { type: "SET_POWER_SCALE"; powerScale: "dB" | "dBm" }
  | { type: "SET_SELECTED_FILES"; files: SelectedFile[] }
  | { type: "SET_SNAPSHOT_GRID"; preference: boolean }
  | { type: "SET_DRAW_PARAMS"; params: DrawParams[] }
  | { type: "SET_CLUMP_PARAMS"; index: number; params: DrawParams }
  | { type: "SET_ACTIVE_CLUMP_INDEX"; index: number }
  | { type: "SET_GLOBAL_NOISE_FLOOR"; noise: number }
  | { type: "SET_SOURCE_MODE"; mode: SourceMode }
  | { type: "SET_STITCH_STATUS"; status: string }
  | { type: "SET_VISUALIZER_PAUSED"; paused: boolean }
  | { type: "TRAINING_START"; label: "target" | "noise" }
  | { type: "TRAINING_STOP" }
  | { type: "TRIGGER_STITCH" }
  | { type: "TOGGLE_STITCH_PAUSE" }
  | {
    type: "SET_STITCH_SOURCE_SETTINGS";
    settings: { gain: number; ppm: number };
  }
  | { type: "SET_STITCH_PAUSED"; paused: boolean }
  | { type: "LEAVE_VISUALIZER" }
  | { type: "SET_FFT_FRAME_RATE"; fftFrameRate: number }
  | { type: "SET_AUTO_FFT_APPLIED"; applied: boolean }
  | { type: "CLEAR_WATERFALL" }
  | { type: "RESET_WATERFALL_CLEARED" }
  | { type: "SET_VIZ_ZOOM"; zoom: number }
  | { type: "SET_VIZ_PAN"; pan: number }
  | { type: "SET_FFT_DB_LIMITS"; min: number; max: number }
  | { type: "SET_SHOW_SPIKE_OVERLAY"; enabled: boolean }
  | { type: "SET_SAMPLE_RATE"; sampleRateHz: number }
  | { type: "SET_SDR_SETTINGS_BUNDLE"; settings: Partial<SpectrumState> }
  | { type: "REQUEST_HETERODYNING_VERIFY" }
  | { type: "SET_HETERODYNING_VERIFY_DISABLED"; disabled: boolean }
  | {
    type: "SET_HETERODYNING_RESULT";
    detected: boolean;
    confidence: number | null;
    statusText: string;
    highlightedBins: Array<{ start: number; end: number }>;
  }
  | { type: "RESET_ZOOM_AND_DB" }
  | { type: "RESET_DRAW_PARAMS" }
  | { type: "RESET_LIVE_CONTROLS"; fftSize?: number; fftFrameRate?: number }
  | { type: "SET_DIAGNOSTIC_STATUS"; status: string }
  | { type: "SET_DIAGNOSTIC_RUNNING"; running: boolean }
  | { type: "TRIGGER_DIAGNOSTIC" }
  | { type: "SET_DRAW_SIGNAL_3D"; enabled: boolean }
  | { type: "SET_DISPLAY_MODE"; displayMode: "fft" | "iq" }
  | { type: "SET_FFT_WINDOW"; fftWindow: string };

export const INITIAL_SPECTRUM_STATE: SpectrumState = {
  activeSignalArea: "A",
  frequencyRange: null,
  displayTemporalResolution: "medium",
  powerScale: "dB",
  selectedFiles: [],
  snapshotGridPreference: true,
  drawParams: [
    {
      spikeCount: 40,
      spikeWidth: 0.25,
      centerSpikeBoost: 4.9,
      spikesAmplitude: -10, // dB
      decayRate: 0.2,
      envelopeWidth: 10,
      centerOffset: 1.5,
      peakAmplitude: -40,    // -40 dB
      simulatedNoise: 0.05,
      beats: [],
    },
  ],
  activeClumpIndex: 0,
  globalNoiseFloor: -100, // Default changed to -100dB
  sourceMode: "live",
  stitchStatus: "",
  visualizerPaused: false,
  isTrainingCapturing: false,
  trainingCaptureLabel: null,
  trainingCapturedSamples: 0,
  stitchTrigger: 0,
  stitchSourceSettings: { gain: 10, ppm: 0 },
  isStitchPaused: false,
  fftFrameRate: 60,
  isAutoFftApplied: false,
  isWaterfallCleared: false,
  vizZoom: 1,
  vizPanOffset: 0,
  fftMinDb: -120,
  fftMaxDb: 0,
  fftSize: 32768,
  fftWindow: "Rectangular",
  showSpikeOverlay: false,
  gain: 10,
  ppm: 0,
  tunerAGC: false,
  rtlAGC: false,
  sampleRateHz: 3_200_000,
  heterodyningVerifyRequestId: 0,
  heterodyningStatusText: "Idle",
  heterodyningVerifyDisabled: false,
  heterodyningDetected: false,
  heterodyningConfidence: null,
  heterodyningHighlightedBins: [],
  lastKnownRanges: {},
  diagnosticStatus: "Ready",
  isDiagnosticRunning: false,
  diagnosticTrigger: 0,
  drawSignal3D: false,
  displayMode: "fft",
};

const SDR_SETTINGS_KEY = "napt-sdr-settings-v2";

const loadPersistedSdrSettings = (): Partial<SpectrumState> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SDR_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if ("powerScale" in parsed) {
      delete parsed.powerScale;
    }
    // Ensure lastKnownRanges is an object
    if (parsed.lastKnownRanges && typeof parsed.lastKnownRanges !== "object") {
      parsed.lastKnownRanges = {};
    }

    // Fix outdated cached dB ranges
    if (parsed.fftMaxDb !== 0) {
      parsed.fftMaxDb = 0;
      parsed.fftMinDb = -120;
    }

    return parsed;
  } catch {
    return {};
  }
};

export function spectrumReducer(
  state: SpectrumState,
  action: SpectrumAction,
): SpectrumState {
  switch (action.type) {
    case "SET_SIGNAL_AREA":
      return { ...state, activeSignalArea: action.area };
    case "SET_FREQUENCY_RANGE":
      if (
        state.frequencyRange &&
        state.frequencyRange.min === action.range.min &&
        state.frequencyRange.max === action.range.max
      ) {
        return state;
      }
      return {
        ...state,
        frequencyRange: action.range,
        lastKnownRanges: state.activeSignalArea
          ? { ...state.lastKnownRanges, [state.activeSignalArea]: action.range }
          : state.lastKnownRanges,
      };
    case "SET_SIGNAL_AREA_AND_RANGE":
      return {
        ...state,
        activeSignalArea: action.area,
        frequencyRange: action.range,
        lastKnownRanges: { ...state.lastKnownRanges, [action.area]: action.range },
      };
    case "SET_TEMPORAL_RESOLUTION":
      return {
        ...state,
        displayTemporalResolution: action.resolution,
      };
    case "SET_POWER_SCALE": {
      const isSwitchingToDbm = action.powerScale === "dBm";
      const currentMin = state.fftMinDb;
      const currentMax = state.fftMaxDb;

      let nextMin = currentMin;
      let nextMax = currentMax;

      if (isSwitchingToDbm) {
        nextMin = -100;
        nextMax = 30;
      } else {
        nextMin = -120;
        nextMax = 0;
      }

      return {
        ...state,
        powerScale: action.powerScale,
        fftMinDb: nextMin,
        fftMaxDb: nextMax,
      };
    }
    case "SET_SELECTED_FILES":
      return { ...state, selectedFiles: action.files };
    case "SET_SNAPSHOT_GRID":
      return { ...state, snapshotGridPreference: action.preference };
    case "SET_DRAW_PARAMS":
      return { ...state, drawParams: action.params };
    case "SET_CLUMP_PARAMS": {
      const newParams = [...state.drawParams];
      newParams[action.index] = action.params;
      return { ...state, drawParams: newParams };
    }
    case "SET_ACTIVE_CLUMP_INDEX":
      return { ...state, activeClumpIndex: action.index };
    case "SET_GLOBAL_NOISE_FLOOR":
      return { ...state, globalNoiseFloor: action.noise };
    case "SET_SOURCE_MODE":
      // When switching away from file mode, reset processing state but keep files
      if (state.sourceMode === "file" && action.mode !== "file") {
        return {
          ...state,
          sourceMode: action.mode,
          stitchStatus: "",
          isStitchPaused: true,
          // Keep selectedFiles so they're still there when returning
        };
      }
      return { ...state, sourceMode: action.mode };
    case "SET_STITCH_STATUS":
      return { ...state, stitchStatus: action.status };
    case "SET_VISUALIZER_PAUSED":
      return { ...state, visualizerPaused: action.paused };
    case "TRAINING_START":
      return {
        ...state,
        isTrainingCapturing: true,
        trainingCaptureLabel: action.label,
      };
    case "TRAINING_STOP":
      return {
        ...state,
        isTrainingCapturing: false,
        trainingCaptureLabel: null,
        trainingCapturedSamples: state.trainingCapturedSamples + 1,
      };
    case "TRIGGER_STITCH":
      return {
        ...state,
        isStitchPaused: true,
        stitchStatus: "",
        stitchTrigger: state.stitchTrigger + 1,
      };
    case "TOGGLE_STITCH_PAUSE":
      return { ...state, isStitchPaused: !state.isStitchPaused };
    case "SET_STITCH_SOURCE_SETTINGS":
      return { ...state, stitchSourceSettings: action.settings };
    case "SET_STITCH_PAUSED":
      return { ...state, isStitchPaused: action.paused };
    case "SET_FFT_FRAME_RATE":
      return { ...state, fftFrameRate: action.fftFrameRate };
    case "SET_AUTO_FFT_APPLIED":
      return { ...state, isAutoFftApplied: action.applied };
    case "LEAVE_VISUALIZER":
      return {
        ...state,
        visualizerPaused: true,
        isStitchPaused: true,
      };
    case "CLEAR_WATERFALL":
      return { ...state, isWaterfallCleared: true };
    case "RESET_WATERFALL_CLEARED":
      return { ...state, isWaterfallCleared: false };
    case "SET_VIZ_ZOOM":
      return { ...state, vizZoom: action.zoom };
    case "SET_VIZ_PAN":
      return { ...state, vizPanOffset: action.pan };
    case "SET_FFT_DB_LIMITS":
      return { ...state, fftMinDb: Math.round(action.min), fftMaxDb: Math.round(action.max) };
    case "SET_SHOW_SPIKE_OVERLAY":
      return { ...state, showSpikeOverlay: action.enabled };
    case "SET_SAMPLE_RATE":
      return { ...state, sampleRateHz: action.sampleRateHz };
    case "SET_SDR_SETTINGS_BUNDLE":
      return { ...state, ...action.settings };
    case "REQUEST_HETERODYNING_VERIFY":
      return {
        ...state,
        heterodyningVerifyRequestId: state.heterodyningVerifyRequestId + 1,
        heterodyningStatusText: "Scanning…",
        heterodyningConfidence: null,
        heterodyningDetected: false,
        heterodyningHighlightedBins: [],
      };
    case "SET_HETERODYNING_VERIFY_DISABLED":
      return {
        ...state,
        heterodyningVerifyDisabled: action.disabled,
        ...(action.disabled
          ? {
            heterodyningStatusText: "Unavailable",
            heterodyningConfidence: null,
            heterodyningDetected: false,
            heterodyningHighlightedBins: [],
          }
          : {}),
      };
    case "SET_HETERODYNING_RESULT":
      return {
        ...state,
        heterodyningDetected: action.detected,
        heterodyningConfidence: action.confidence,
        heterodyningStatusText: action.statusText,
        heterodyningHighlightedBins: action.highlightedBins,
      };
    case "RESET_ZOOM_AND_DB": {
      const isDbm = state.powerScale === "dBm";
      return {
        ...state,
        vizZoom: 1,
        vizPanOffset: 0,
        fftMinDb: isDbm ? -100 : -120,
        fftMaxDb: isDbm ? 30 : 0,
      };
    }
    case "RESET_DRAW_PARAMS":
      return {
        ...state,
        drawParams: JSON.parse(JSON.stringify(INITIAL_SPECTRUM_STATE.drawParams)),
        globalNoiseFloor: INITIAL_SPECTRUM_STATE.globalNoiseFloor,
        activeClumpIndex: 0,
      };
    case "RESET_LIVE_CONTROLS": {
      const isDbm = state.powerScale === "dBm";
      return {
        ...state,
        displayTemporalResolution: LIVE_CONTROL_DEFAULTS.displayTemporalResolution,
        vizZoom: LIVE_CONTROL_DEFAULTS.vizZoom,
        vizPanOffset: LIVE_CONTROL_DEFAULTS.vizPanOffset,
        fftMinDb: isDbm ? -100 : -120,
        fftMaxDb: isDbm ? 30 : 0,
        fftWindow: LIVE_CONTROL_DEFAULTS.fftWindow,
        gain: LIVE_CONTROL_DEFAULTS.gain,
        ppm: LIVE_CONTROL_DEFAULTS.ppm,
        tunerAGC: LIVE_CONTROL_DEFAULTS.tunerAGC,
        rtlAGC: LIVE_CONTROL_DEFAULTS.rtlAGC,
        fftSize: action.fftSize ?? state.fftSize,
        fftFrameRate: action.fftFrameRate ?? state.fftFrameRate,
        globalNoiseFloor: isDbm ? -120 : -150,
      };
    }
    case "SET_DIAGNOSTIC_STATUS":
      return { ...state, diagnosticStatus: action.status };
    case "SET_DIAGNOSTIC_RUNNING":
      return { ...state, isDiagnosticRunning: action.running };
    case "TRIGGER_DIAGNOSTIC":
      return { ...state, diagnosticTrigger: state.diagnosticTrigger + 1 };
    case "SET_DRAW_SIGNAL_3D":
      return { ...state, drawSignal3D: action.enabled };
    case "SET_DISPLAY_MODE":
      return { ...state, displayMode: action.displayMode };
    case "SET_FFT_WINDOW":
      return { ...state, fftWindow: action.fftWindow };
    default:
      return state;
  }
}

// Complex Return Type
export type SpectrumStoreContextValue = {
  state: SpectrumState;
  dispatch: React.Dispatch<SpectrumAction>;
  fftVisualizerMachine: FFTVisualizerMachine;
  manualVisualizerPaused: boolean;
  setManualVisualizerPaused: React.Dispatch<React.SetStateAction<boolean>>;
  effectiveFrames: SpectrumFrame[];
  effectiveSdrSettings: SdrSettingsConfig | null | undefined;
  sampleRateHzEffective: number | null;
  sampleRateMHz: number | null;
  signalAreaBounds: Record<string, { min: number; max: number }> | null;
  lastSentPauseRef: React.MutableRefObject<boolean | null>;
  wsConnection: {
    isConnected: boolean;
    deviceState: "connected" | "loading" | "disconnected" | "stale" | null;
    deviceLoadingReason: "connect" | "restart" | null;
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
    sendScanCommand: (jobId: string, minFreq: number, maxFreq: number, options?: any) => void;
    sendDemodulateCommand: (jobId: string, region: any) => void;
    sendTrainingCommand: (
      action: "start" | "stop",
      label: "target" | "noise",
      signalArea: string,
    ) => void;
    sendGetAutoFftOptions: (screenWidth: number) => void;
    sendPowerScaleCommand: (scale: "dB" | "dBm") => void;
  };
  toggleVisualizerPause: () => void;
  cryptoCorrupted: boolean;
  deviceName: string | null;
  deviceProfile: DeviceProfile | null;
};

const SpectrumStoreContext = createContext<SpectrumStoreContextValue | null>(
  null,
);

export const useSpectrumStore = () => {
  const context = useContext(SpectrumStoreContext);
  if (!context) {
    throw new Error("useSpectrumStore must be used within a SpectrumProvider");
  }
  return context;
};

interface SpectrumProviderProps {
  children: React.ReactNode;
  mockValue?: SpectrumStoreContextValue;
}

export const SpectrumProvider: React.FC<SpectrumProviderProps> = ({
  children,
  mockValue,
}) => {
  if (mockValue) {
    return (
      <SpectrumStoreContext.Provider value={mockValue}>
        {children}
      </SpectrumStoreContext.Provider>
    );
  }

  const [state, dispatch] = useReducer(spectrumReducer, {
    ...INITIAL_SPECTRUM_STATE,
    ...loadPersistedSdrSettings(),
  });
  const fftVisualizerMachineRef = useRef<FFTVisualizerMachine | null>(null);
  if (!fftVisualizerMachineRef.current) {
    fftVisualizerMachineRef.current = createFFTVisualizerMachine();
  }
  const fftVisualizerMachine = fftVisualizerMachineRef.current;
  const location = useLocation();
  const reduxDispatch = useAppDispatch();

  const { isAuthenticated, sessionToken, aesKey } = useAuthentication();
  const wsUrl = sessionToken ? buildWsUrl(sessionToken) : "";
  const isConnected = useAppSelector((s) => s.websocket.isConnected);
  const isPaused = useAppSelector((s) => s.websocket.isPaused);
  const serverPaused = useAppSelector((s) => s.websocket.serverPaused);
  const backend = useAppSelector((s) => s.websocket.backend);
  const deviceInfo = useAppSelector((s) => s.websocket.deviceInfo);
  const cryptoCorrupted = useAppSelector((s) => s.websocket.cryptoCorrupted);
  const deviceName = useAppSelector((s) => s.websocket.deviceName);
  const deviceProfile = useAppSelector((s) => s.websocket.deviceProfile);
  const deviceLoadingReason = useAppSelector((s) => s.websocket.deviceLoadingReason);
  const maxSampleRateHz = useAppSelector((s) => s.websocket.maxSampleRateHz);
  const sampleRateHz = useAppSelector((s) => s.websocket.sampleRateHz);
  const sdrSettings = useAppSelector((s) => s.websocket.sdrSettings);
  const wsSpectrumFrames = useAppSelector((s) => s.websocket.spectrumFrames);
  const captureStatus = useAppSelector((s) => s.websocket.captureStatus);
  const autoFftOptions = useAppSelector((s) => s.websocket.autoFftOptions);
  const error = useAppSelector((s) => s.websocket.error);
  const deviceState = useAppSelector((s) => s.websocket.deviceState);
  // liveDataRef is written directly by the middleware — never goes through Redux.
  const dataRef = liveDataRef;

  useEffect(() => {
    reduxDispatch(
      connectWebSocket({
        url: wsUrl,
        aesKey,
        enabled: isAuthenticated,
      }),
    );
    return () => {
      reduxDispatch(disconnectWebSocket());
    };
  }, [reduxDispatch, wsUrl, aesKey, isAuthenticated]);

  const sendFrequencyRangeCommand = useCallback(
    (range: FrequencyRange) => {
      reduxDispatch(sendFrequencyRangeThunk(range));
    },
    [reduxDispatch],
  );

  const sendPauseCommand = useCallback(
    (paused: boolean) => {
      reduxDispatch(sendPauseCommandThunk(paused));
    },
    [reduxDispatch],
  );

  const sendSettingsCommand = useCallback(
    (settings: SDRSettings) => {
      reduxDispatch(sendSettingsThunk(settings));
    },
    [reduxDispatch],
  );

  const sendRestartDeviceCommand = useCallback(() => {
    reduxDispatch(sendRestartDeviceThunk());
  }, [reduxDispatch]);

  const sendCaptureCommand = useCallback(
    (req: CaptureRequest) => {
      reduxDispatch(sendCaptureCommandThunk(req));
    },
    [reduxDispatch],
  );

  const sendScanCommand = useCallback(
    (jobId: string, minFreq: number, maxFreq: number, options?: any) => {
      reduxDispatch(sendScanCommandThunk({ jobId, minFreq, maxFreq, options }));
    },
    [reduxDispatch],
  );

  const sendDemodulateCommand = useCallback(
    (jobId: string, region: any) => {
      reduxDispatch(sendDemodulateCommandThunk({ jobId, region }));
    },
    [reduxDispatch],
  );

  const sendTrainingCommand = useCallback(
    (
      action: "start" | "stop",
      label: "target" | "noise",
      signalArea: string,
    ) => {
      reduxDispatch(sendTrainingCommandThunk({ action, label, signalArea }));
    },
    [reduxDispatch],
  );

  const sendGetAutoFftOptionsCommand = useCallback(
    (screenWidth: number) => {
      reduxDispatch(sendGetAutoFftOptionsThunk(screenWidth));
    },
    [reduxDispatch],
  );

  const sendPowerScaleCommand = useCallback(
    (scale: "dB" | "dBm") => {
      reduxDispatch(sendPowerScaleCommandThunk(scale));
    },
    [reduxDispatch],
  );

  const wsConnection = useMemo(
    () => ({
      isConnected,
      deviceState,
      deviceLoadingReason,
      isPaused,
      serverPaused,
      backend,
      deviceInfo,
      deviceName,
      deviceProfile,
      maxSampleRateHz,
      sampleRateHz,
      sdrSettings,
      dataRef,
      spectrumFrames: wsSpectrumFrames,
      captureStatus,
      autoFftOptions,
      error,
      cryptoCorrupted,
      sendFrequencyRange: sendFrequencyRangeCommand,
      sendPauseCommand,
      sendSettings: sendSettingsCommand,
      sendRestartDevice: sendRestartDeviceCommand,
      sendCaptureCommand,
      sendScanCommand,
      sendDemodulateCommand,
      sendTrainingCommand,
      sendGetAutoFftOptions: sendGetAutoFftOptionsCommand,
      sendPowerScaleCommand,
    }),
    [
      isConnected,
      deviceState,
      deviceLoadingReason,
      isPaused,
      serverPaused,
      backend,
      deviceInfo,
      deviceName,
      deviceProfile,
      maxSampleRateHz,
      sampleRateHz,
      sdrSettings,
      dataRef,
      captureStatus,
      autoFftOptions,
      error,
      cryptoCorrupted,
      sendFrequencyRangeCommand,
      sendPauseCommand,
      sendSettingsCommand,
      sendRestartDeviceCommand,
      sendCaptureCommand,
      sendScanCommand,
      sendDemodulateCommand,
      sendTrainingCommand,
      sendGetAutoFftOptionsCommand,
      sendPowerScaleCommand,
    ],
  );

  // Track active spectrum route globally
  const isVisualizerRoute =
    location.pathname === "/" || location.pathname === "/visualizer";

  const [manualVisualizerPaused, setManualVisualizerPaused] = useState(() => {
    if (typeof window === "undefined") return false;
    // On the visualizer route, always start unpaused so the first render
    // doesn't race with the mount effect and send a stale pause=true.
    const path = window.location.pathname;
    if (path === "/" || path === "/visualizer") return false;
    return sessionStorage.getItem(MANUAL_VISUALIZER_PAUSE_KEY) === "true";
  });

  const lastSentPauseRef = useRef<boolean | null>(null);

  // Track if we've already synced backend connection settings
  const hasInitializedBackendSettingsRef = useRef(false);

  const [cachedFrames, setCachedFrames] = useState<SpectrumFrame[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem("napt-spectrum-frames");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as SpectrumFrame[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [cachedSdrSettings, setCachedSdrSettings] =
    useState<SdrSettingsConfig | null>(() => {
      if (typeof window === "undefined") return null;
      try {
        const raw = sessionStorage.getItem("napt-sdr-settings");
        if (!raw) return null;
        return JSON.parse(raw) as SdrSettingsConfig;
      } catch {
        return null;
      }
    });

  // 1. Clear manual pause on EXACTLY / if on fresh mount
  useEffect(() => {
    if (location.pathname === "/") {
      setManualVisualizerPaused(false);
      sessionStorage.setItem(MANUAL_VISUALIZER_PAUSE_KEY, "false");
    }
  }, []); // Only once on mount

  // 2. Auto-pause when navigating AWAY. We don't auto-resume.
  useEffect(() => {
    if (!isVisualizerRoute && !manualVisualizerPaused) {
      setManualVisualizerPaused(true);
      sessionStorage.setItem(MANUAL_VISUALIZER_PAUSE_KEY, "true");
    }
  }, [isVisualizerRoute, manualVisualizerPaused]);

  // 3. Sync store visualizerPaused with manualVisualizerPaused
  useEffect(() => {
    if (state.visualizerPaused !== manualVisualizerPaused) {
      dispatch({ type: "SET_VISUALIZER_PAUSED", paused: manualVisualizerPaused });
    }
  }, [manualVisualizerPaused, state.visualizerPaused, dispatch]);

  // 4. Sync backend with manualVisualizerPaused
  useEffect(() => {
    if (isConnected && lastSentPauseRef.current !== manualVisualizerPaused) {
      wsConnection.sendPauseCommand(manualVisualizerPaused);
      lastSentPauseRef.current = manualVisualizerPaused;
    }
  }, [manualVisualizerPaused, isConnected, wsConnection]);

  // Persist SDR settings when they change
  useEffect(() => {
    const settingsToPersist = {
      fftSize: state.fftSize,
      fftWindow: state.fftWindow,
      fftFrameRate: state.fftFrameRate,
      gain: state.gain,
      ppm: state.ppm,
      tunerAGC: state.tunerAGC,
      rtlAGC: state.rtlAGC,
      vizZoom: state.vizZoom,
      vizPanOffset: state.vizPanOffset,
      fftMinDb: state.fftMinDb,
      fftMaxDb: state.fftMaxDb,
      frequencyRange: state.frequencyRange,
      activeSignalArea: state.activeSignalArea,
      lastKnownRanges: state.lastKnownRanges,
      displayTemporalResolution: state.displayTemporalResolution,
      snapshotGridPreference: state.snapshotGridPreference,
      sampleRateHz: state.sampleRateHz,
    };
    sessionStorage.setItem(SDR_SETTINGS_KEY, JSON.stringify(settingsToPersist));
  }, [
    state.fftSize,
    state.fftWindow,
    state.fftFrameRate,
    state.gain,
    state.ppm,
    state.tunerAGC,
    state.rtlAGC,
    state.vizZoom,
    state.vizPanOffset,
    state.fftMinDb,
    state.fftMaxDb,
    state.frequencyRange,
    state.activeSignalArea,
    state.lastKnownRanges,
    state.displayTemporalResolution,
    state.powerScale,
    state.snapshotGridPreference,
    state.sampleRateHz,
  ]);

  const lastSentPowerScaleRef = useRef<"dB" | "dBm" | null>(null);
  useEffect(() => {
    if (!isConnected || lastSentPowerScaleRef.current === state.powerScale) return;
    wsConnection.sendPowerScaleCommand(state.powerScale);
    lastSentPowerScaleRef.current = state.powerScale;
  }, [isConnected, wsConnection.sendPowerScaleCommand, state.powerScale]);

  // Revert power scale to dB if not supported by the current device
  useEffect(() => {
    if (deviceProfile && !deviceProfile.supports_approx_dbm && state.powerScale === "dBm") {
      dispatch({ type: "SET_POWER_SCALE", powerScale: "dB" });
    }
  }, [deviceProfile, state.powerScale, dispatch]);

  useEffect(() => {
    if (wsSpectrumFrames.length === 0) return;
    setCachedFrames(wsSpectrumFrames);
    try {
      sessionStorage.setItem(
        "napt-spectrum-frames",
        JSON.stringify(wsSpectrumFrames),
      );
    } catch {
      /* ignore */
    }
  }, [wsSpectrumFrames]);

  useEffect(() => {
    if (!sdrSettings) return;
    setCachedSdrSettings(sdrSettings);
    try {
      sessionStorage.setItem("napt-sdr-settings", JSON.stringify(sdrSettings));
    } catch {
      /* ignore */
    }
  }, [sdrSettings]);

  // Sync sample rate from backend to store state
  useEffect(() => {
    const rate = sdrSettings?.sample_rate ?? sampleRateHz ?? maxSampleRateHz;
    if (typeof rate === "number" && rate > 0 && rate !== state.sampleRateHz) {
      dispatch({ type: "SET_SAMPLE_RATE", sampleRateHz: rate });
    }
  }, [sdrSettings?.sample_rate, sampleRateHz, maxSampleRateHz, state.sampleRateHz, dispatch]);

  const effectiveFrames =
    wsSpectrumFrames.length > 0 ? wsSpectrumFrames : cachedFrames;
  const effectiveSdrSettings = sdrSettings ?? cachedSdrSettings;

  const sampleRateHzEffective = state.sampleRateHz;

  const sampleRateMHz = sampleRateHzEffective / 1_000_000;

  const signalAreaBounds = useMemo(() => {
    if (!Array.isArray(effectiveFrames) || effectiveFrames.length === 0) {
      return null;
    }
    const bounds: Record<string, { min: number; max: number }> = {};
    effectiveFrames.forEach((frame) => {
      const label = frame.label;
      if (!label) return;
      bounds[label] = { min: frame.min_mhz, max: frame.max_mhz };
      bounds[label.toLowerCase()] = { min: frame.min_mhz, max: frame.max_mhz };
    });
    return bounds;
  }, [effectiveFrames]);

  // Initialize frequencyRange if either it is null or unset
  // based on the first available frame (usually area 'A')
  // and the current sample rate. This is placed after variable
  // declarations to satisfy closure requirements.
  useEffect(() => {
    if (state.frequencyRange) return;
    if (!Array.isArray(effectiveFrames) || effectiveFrames.length === 0) return;

    const primaryFrame =
      effectiveFrames.find((frame) => frame.label.toLowerCase() === "a") ??
      effectiveFrames[0];
    if (!primaryFrame) return;

    const min = primaryFrame.min_mhz;
    const max = sampleRateMHz
      ? Math.min(primaryFrame.max_mhz, min + sampleRateMHz)
      : primaryFrame.max_mhz;
    const nextRange = { min, max };

    const range = nextRange;
    if (lastSentFrequencyRangeRef.current?.min === range.min && lastSentFrequencyRangeRef.current?.max === range.max) return;

    dispatch({ type: "SET_FREQUENCY_RANGE", range: nextRange });
    wsConnection.sendFrequencyRange(nextRange);
    lastSentFrequencyRangeRef.current = nextRange;
  }, [
    state.frequencyRange,
    sampleRateMHz,
    effectiveFrames,
    wsConnection.sendFrequencyRange,
  ]);

  // Execute exactly once to absorb backend default configurations (like signals.yaml gain)
  useEffect(() => {
    if (!sdrSettings || hasInitializedBackendSettingsRef.current) return;

    // Validate we actually received meaningful backend config (e.g. valid sample rate)
    if (
      sdrSettings.sample_rate === 0 &&
      (sdrSettings.center_frequency === 0 ||
        sdrSettings.center_frequency === undefined)
    )
      return;

    // Once valid, sync it into the global store immediately.
    hasInitializedBackendSettingsRef.current = true;

    const derived = deriveStateFromConfig(
      sampleRateHzEffective ?? 0,
      sdrSettings,
    );
    dispatch({
      type: "SET_SDR_SETTINGS_BUNDLE",
      settings: derived,
    });
  }, [sdrSettings, sampleRateHzEffective, dispatch]);

  const lastSentFrequencyRangeRef = useRef<FrequencyRange | null>(null);
  useEffect(() => {
    if (!isConnected || !state.frequencyRange) return;
    const range = state.frequencyRange;
    if (lastSentFrequencyRangeRef.current?.min === range.min && lastSentFrequencyRangeRef.current?.max === range.max) return;

    wsConnection.sendFrequencyRange(range);
    lastSentFrequencyRangeRef.current = range;
  }, [isConnected, state.frequencyRange, wsConnection.sendFrequencyRange]);

  // Screen width detection for auto FFT options
  useEffect(() => {
    if (!isVisualizerRoute || !isConnected) return;

    const detectScreenWidth = () => {
      const cssWidth =
        window.innerWidth ||
        document.documentElement.clientWidth ||
        document.body.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      wsConnection.sendGetAutoFftOptions(Math.round(cssWidth * dpr));
    };

    // Only request if we don't have cached auto FFT options
    if (!autoFftOptions) {
      // Initial detection on route load
      detectScreenWidth();

      // Listen for resize events (with debouncing)
      let resizeTimeout: NodeJS.Timeout;
      const handleResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(detectScreenWidth, 500);
      };

      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", handleResize);
        clearTimeout(resizeTimeout);
      };
    }
  }, [isVisualizerRoute, isConnected, wsConnection.sendGetAutoFftOptions, autoFftOptions]);

  const toggleVisualizerPause = useCallback(() => {
    const nextPaused = !manualVisualizerPaused;
    setManualVisualizerPaused(nextPaused);
    sessionStorage.setItem(MANUAL_VISUALIZER_PAUSE_KEY, String(nextPaused));

    // Force an immediate update of the store state
    dispatch({ type: "SET_VISUALIZER_PAUSED", paused: nextPaused });

    // Send command immediately for responsiveness
    if (isConnected) {
      wsConnection.sendPauseCommand(nextPaused);
      lastSentPauseRef.current = nextPaused;
    }
  }, [manualVisualizerPaused, isConnected, wsConnection.sendPauseCommand]);

  const value = useMemo(
    () => ({
      state,
      dispatch,
      fftVisualizerMachine,
      manualVisualizerPaused,
      setManualVisualizerPaused,
      effectiveFrames,
      effectiveSdrSettings,
      sampleRateHzEffective,
      sampleRateMHz,
      signalAreaBounds,
      lastSentPauseRef,
      wsConnection,
      toggleVisualizerPause,
      cryptoCorrupted,
      deviceName,
      deviceProfile,
    }),
    [
      state,
      fftVisualizerMachine,
      manualVisualizerPaused,
      effectiveFrames,
      effectiveSdrSettings,
      sampleRateHzEffective,
      sampleRateMHz,
      signalAreaBounds,
      wsConnection,
      toggleVisualizerPause,
      cryptoCorrupted,
      deviceName,
      deviceProfile,
    ],
  );

  return (
    <SpectrumStoreContext.Provider value={value}>
      {children}
    </SpectrumStoreContext.Provider>
  );
};
