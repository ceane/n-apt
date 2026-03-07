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
import {
  useWebSocket,
  FrequencyRange,
  SpectrumFrame,
  SdrSettingsConfig,
} from "@n-apt/hooks/useWebSocket";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { buildWsUrl } from "@n-apt/services/auth";
import { useLocation } from "react-router-dom";
import { deriveStateFromConfig } from "@n-apt/hooks/useSdrSettings";

// Types
export type SourceMode = "live" | "file";
export type SelectedFile = { name: string; file: File; downloadUrl?: string };

const MANUAL_VISUALIZER_PAUSE_KEY = "napt-visualizer-manual-paused";

export type DrawParams = {
  spikeCount: number;
  spikeWidth: number;
  centerSpikeBoost: number;
  floorAmplitude: number;
  decayRate: number;
  envelopeWidth: number;
};

export type SpectrumState = {
  activeSignalArea: string;
  frequencyRange: FrequencyRange | null;
  displayTemporalResolution: "low" | "medium" | "high";
  selectedFiles: SelectedFile[];
  snapshotGridPreference: boolean;
  drawParams: DrawParams;
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
  gain: number;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  lastKnownRanges: Record<string, { min: number; max: number }>;
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
  | { type: "SET_SELECTED_FILES"; files: SelectedFile[] }
  | { type: "SET_SNAPSHOT_GRID"; preference: boolean }
  | { type: "SET_DRAW_PARAMS"; params: DrawParams }
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
  | { type: "SET_SDR_SETTINGS_BUNDLE"; settings: Partial<SpectrumState> }
  | { type: "RESET_ZOOM_AND_DB" };

export const INITIAL_SPECTRUM_STATE: SpectrumState = {
  activeSignalArea: "A",
  frequencyRange: null,
  displayTemporalResolution: "medium",
  selectedFiles: [],
  snapshotGridPreference: true,
  drawParams: {
    spikeCount: 40,
    spikeWidth: 0.4,
    centerSpikeBoost: 4.9,
    floorAmplitude: 0.5,
    decayRate: 0.2,
    envelopeWidth: 10,
  },
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
  gain: 10,
  ppm: 0,
  tunerAGC: false,
  rtlAGC: false,
  lastKnownRanges: {},
};

const SDR_SETTINGS_KEY = "napt-sdr-settings-v2";

const loadPersistedSdrSettings = (): Partial<SpectrumState> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SDR_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Ensure lastKnownRanges is an object
    if (parsed.lastKnownRanges && typeof parsed.lastKnownRanges !== "object") {
      parsed.lastKnownRanges = {};
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
    case "SET_SELECTED_FILES":
      return { ...state, selectedFiles: action.files };
    case "SET_SNAPSHOT_GRID":
      return { ...state, snapshotGridPreference: action.preference };
    case "SET_DRAW_PARAMS":
      return { ...state, drawParams: action.params };
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
    case "SET_SDR_SETTINGS_BUNDLE":
      return { ...state, ...action.settings };
    case "RESET_ZOOM_AND_DB":
      return {
        ...state,
        vizZoom: 1,
        vizPanOffset: 0,
        fftMinDb: -120,
        fftMaxDb: 0,
      };
    default:
      return state;
  }
}

// Complex Return Type
type SpectrumStoreContextValue = {
  state: SpectrumState;
  dispatch: React.Dispatch<SpectrumAction>;
  manualVisualizerPaused: boolean;
  setManualVisualizerPaused: React.Dispatch<React.SetStateAction<boolean>>;
  effectiveFrames: SpectrumFrame[];
  effectiveSdrSettings: SdrSettingsConfig | null | undefined;
  sampleRateHzEffective: number | null;
  sampleRateMHz: number | null;
  signalAreaBounds: Record<string, { min: number; max: number }> | null;
  lastSentPauseRef: React.MutableRefObject<boolean | null>;
  wsConnection: ReturnType<typeof useWebSocket>;
  toggleVisualizerPause: () => void;
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

export const SpectrumProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(spectrumReducer, {
    ...INITIAL_SPECTRUM_STATE,
    ...loadPersistedSdrSettings(),
  });
  const location = useLocation();

  const { isAuthenticated, sessionToken, aesKey } = useAuthentication();
  const wsUrl = sessionToken ? buildWsUrl(sessionToken) : "";
  const wsConnection = useWebSocket(wsUrl, aesKey, isAuthenticated);
  const {
    sdrSettings,
    spectrumFrames: wsSpectrumFrames,
    isConnected,
    sendPauseCommand,
  } = wsConnection;

  // Track active spectrum route globally
  const isVisualizerRoute =
    location.pathname === "/" || location.pathname === "/visualizer";

  const [manualVisualizerPaused, setManualVisualizerPaused] = useState(() => {
    if (typeof window === "undefined") return false;
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
      sendPauseCommand(manualVisualizerPaused);
      lastSentPauseRef.current = manualVisualizerPaused;
    }
  }, [manualVisualizerPaused, isConnected, sendPauseCommand]);

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
    state.snapshotGridPreference,
  ]);

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

  const effectiveFrames =
    wsSpectrumFrames.length > 0 ? wsSpectrumFrames : cachedFrames;
  const effectiveSdrSettings = sdrSettings ?? cachedSdrSettings;

  const sampleRateHzEffective =
    typeof effectiveSdrSettings?.sample_rate === "number" &&
      Number.isFinite(effectiveSdrSettings.sample_rate)
      ? effectiveSdrSettings.sample_rate
      : (wsConnection.sampleRateHz ?? wsConnection.maxSampleRateHz ?? null);

  const sampleRateMHz =
    typeof sampleRateHzEffective === "number" &&
      Number.isFinite(sampleRateHzEffective)
      ? sampleRateHzEffective / 1_000_000
      : null;

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

    dispatch({ type: "SET_FREQUENCY_RANGE", range: nextRange });
    wsConnection.sendFrequencyRange(nextRange);
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
  }, [isVisualizerRoute, isConnected, wsConnection.sendGetAutoFftOptions]);

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
    }),
    [
      state,
      manualVisualizerPaused,
      effectiveFrames,
      effectiveSdrSettings,
      sampleRateHzEffective,
      sampleRateMHz,
      signalAreaBounds,
      wsConnection,
      toggleVisualizerPause,
    ],
  );

  return (
    <SpectrumStoreContext.Provider value={value}>
      {children}
    </SpectrumStoreContext.Provider>
  );
};
