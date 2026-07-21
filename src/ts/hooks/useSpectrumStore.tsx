import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  memo,
} from "react";
import type {
  FrequencyRange,
  SpectrumFrame,
  SdrSettingsConfig,
  DeviceProfile,
  CaptureStatus,
  SDRSettings,
  CaptureRequest,
  SourceSdrSettings,
  DeviceState,
  DeviceLoadingReason,
  SourceInfo,
  DeviceActiveMode,
} from "@n-apt/consts/schemas/websocket";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { isMockDevice, isMockTxSource } from "@n-apt/utils/deviceCapabilities";
import { buildWsUrl } from "@n-apt/services/auth";
import { useLocation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@n-apt/redux/store";
import {
  selectActiveSourceDerivedState,
  selectActiveSource,
  deriveSourceDerivedState,
} from "@n-apt/redux/selectors/performanceSelectors";
import {
  clearWaterfall,
  resetTrainingCapture,
  resetWaterfallCleared,
  setDrawSignal3D as setWaterfallDrawSignal3D,
  setGlobalNoiseFloor as setWaterfallGlobalNoiseFloor,
  setSelectedFiles as setWaterfallSelectedFiles,
  setSnapshotGrid as setWaterfallSnapshotGrid,
  setSourceMode as setWaterfallSourceMode,
  setStitchPaused as setWaterfallStitchPaused,
  setStitchSourceSettings as setWaterfallStitchSourceSettings,
  setStitchStatus as setWaterfallStitchStatus,
  toggleStitchPause as toggleWaterfallStitchPause,
  triggerStitch as triggerWaterfallStitch,
  setSdrSettingsBundle as setSdrSettingsBundleAction,
  resetLiveControls as resetLiveControlsAction,
  resetZoomAndDb as resetZoomAndDbAction,
  setShowSpikeOverlay as setShowSpikeOverlayAction,
  setDrawParams as setWaterfallDrawParams,
  setClumpParams as setWaterfallClumpParams,
  setActiveClumpIndex as setWaterfallActiveClumpIndex,
  resetDrawParams as resetWaterfallDrawParams,
  websocketActions,
} from "@n-apt/redux";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";
import {
  normalizePersistedTxSignalKey,
  normalizePersistedTxViewerSettings,
} from "@n-apt/redux/middleware/localStorageMiddleware";
import {
  connectWebSocket,
  disconnectWebSocket,
  sendPowerScaleCommand as sendPowerScaleCommandThunk,
  sendTrainingCommand as sendTrainingCommandThunk,
  sendFrequencyRange as sendFrequencyRangeThunk,
  requestNextPausedFrame as requestNextPausedFrameThunk,
  sendSettings as sendSettingsThunk,
  sendRestartDevice as sendRestartDeviceThunk,
  sendCaptureCommand as sendCaptureCommandThunk,
  sendScanCommand as sendScanCommandThunk,
  sendDemodulateCommand as sendDemodulateCommandThunk,
  sendSelectSource as sendSelectSourceThunk,
} from "@n-apt/redux/thunks/websocketThunks";
import { deriveStateFromConfig } from "@n-apt/hooks/useSdrSettings";
import { applyWaterfallStateOverrides } from "@n-apt/hooks/spectrumStoreOverrides";
import {
  createFFTVisualizerMachine,
  type FFTVisualizerMachine,
} from "@n-apt/utils/fftVisualizerMachine";
import {
  clampFrequencyRangeToBounds,
  normalizeFrequencyRangeToHz,
} from "@n-apt/utils/frequency";
import {
  getSourceViewStorageKeyForSource,
  loadStoredJson,
  saveStoredJson,
  loadSelectedSourceId,
  saveSelectedSourceId,
} from "@n-apt/utils/sourcePersistence";
import {
  clampRtlSdrFrequencyRangeToHardwareWindow,
  isRtlSdrDevice,
  resolveSourceSampleRateHz,
} from "@n-apt/utils/sdrSampleRateGuards";
import { resolveSourceFrequencyRangeSync } from "@n-apt/utils/sourceFrequencySync";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";
import {
  resolveTxSuiteControlSourceId,
  shouldPinTxSuiteToRxSource,
} from "@n-apt/utils/txSuiteSourceControl";

// Types
export type SourceMode = "live" | "file";
export type SelectedFile = { id: string; name: string; downloadUrl?: string };

const MANUAL_VISUALIZER_PAUSE_KEY = "napt-visualizer-manual-paused";
const VISUALIZER_FRAME_RATE_KEY = "napt-visualizer-frame-rate";

const getPersistedNumber = (key: string): number | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
};

const isMockSourceInfo = (source: SourceInfo | null | undefined): boolean => {
  if (!source) return false;
  return isMockDevice({
    capability: source.capability,
    id: source.id,
    name: source.name,
    backend: source.kind,
  });
};

export const resolveSelectedSourceIdForInventory = ({
  selectedSourceId,
  activeSourceId,
  pendingSourceSwitchId = null,
  selectionIntentSourceId = null,
  sources,
}: {
  selectedSourceId: string;
  activeSourceId: string;
  pendingSourceSwitchId?: string | null;
  selectionIntentSourceId?: string | null;
  sources: SourceInfo[];
}): string => {
  if (
    (pendingSourceSwitchId !== null &&
      pendingSourceSwitchId === selectedSourceId) ||
    (selectionIntentSourceId !== null &&
      selectionIntentSourceId === selectedSourceId)
  ) {
    return selectedSourceId;
  }
  if (sources.length === 0) return "";
  const active = sources.find((source) => source.id === activeSourceId);
  if (active) return active.id;
  const selected = sources.find((source) => source.id === selectedSourceId);
  const hardwareSources = sources.filter((source) => !isMockSourceInfo(source));
  const targetHardware =
    hardwareSources.find((source) => source.id === activeSourceId) ??
    hardwareSources.find(
      (source) =>
        source.status === "loading" ||
        source.status === "streaming" ||
        source.status === "connected",
    );

  if (targetHardware && (!selected || isMockSourceInfo(selected))) {
    return targetHardware.id;
  }
  if (
    selected &&
    selected.status === "disconnected" &&
    activeSourceId.startsWith("mock")
  ) {
    return activeSourceId;
  }
  if (selected) return selected.id;
  return (
    sources.find((source) => source.id === activeSourceId)?.id ?? sources[0].id
  );
};

export const shouldClearPendingSourceSwitch = ({
  pendingSourceSwitchId,
  selectedSourceId,
  activeSourceId,
}: {
  pendingSourceSwitchId: string | null;
  selectedSourceId: string;
  activeSourceId: string;
}): boolean =>
  pendingSourceSwitchId !== null &&
  pendingSourceSwitchId !== activeSourceId &&
  pendingSourceSwitchId !== selectedSourceId;

/**
 * The sidebar selection is an intent; the active source is the server's
 * confirmation of which I/Q subscription is actually delivering frames.
 * Never let optimistic selection metadata relabel an in-flight stream.
 */
export const resolveStreamingSourceForDisplay = ({
  selectedSourceId,
  activeSourceId,
  sources,
}: {
  selectedSourceId: string;
  activeSourceId: string;
  sources: SourceInfo[];
}): SourceInfo | null =>
  sources.find((source) => source.id === activeSourceId) ??
  sources.find((source) => source.id === selectedSourceId) ??
  sources[0] ??
  null;

const resolveDeviceActiveMode = (
  source: SourceInfo | null | undefined,
): DeviceActiveMode => {
  return source?.status === "transmitting" ? "tx" : "rx";
};

const isTxCapableSourceInfo = (
  source: SourceInfo | null | undefined,
): boolean => {
  if (!source) return false;
  const capability = source.capability?.toLowerCase?.() ?? "";
  const id = source.id?.toLowerCase?.() ?? "";
  return (
    capability === "tx" ||
    capability === "tx_rx" ||
    id.includes("hackrf_one") ||
    isMockTxSource({ id: source.id, kind: source.kind })
  );
};

/**
 * Paused-frame requests are source-owned previews. Tx Suite keeps Rx active so
 * this command is handled by the Rx control stream; Mock Tx previews remain
 * handled by its source-bound I/Q socket in the middleware.
 */
export const shouldRequestPausedPreview = (
  source: SourceInfo | null | undefined,
): boolean => {
  if (!source) return false;
  if (source.status === "transmitting") return false;
  if (isMockTxSource({ id: source.id, kind: source.kind })) return true;
  const isMockRxSource =
    source.id === "mock-apt" ||
    source.kind?.toLowerCase?.().startsWith("mock_apt") === true;
  return isMockRxSource && source.supports_raw_iq_stream === true;
};

export const buildPausedPreviewSignature = ({
  frequencyRange,
  sampleRateHz,
  vizZoom,
  vizPanOffset,
  txCenterFrequencyHz,
  txSampleRateHz,
  txPowerDbm,
  txSignal,
  txIfftSize,
}: {
  frequencyRange: FrequencyRange | null | undefined;
  sampleRateHz: number | null | undefined;
  vizZoom: number;
  vizPanOffset: number;
  txCenterFrequencyHz: number;
  txSampleRateHz: number;
  txPowerDbm: number;
  txSignal: string;
  txIfftSize: number;
}): string => {
  const rangeSignature = frequencyRange
    ? `${frequencyRange.min}:${frequencyRange.max}`
    : "none";
  return [
    rangeSignature,
    sampleRateHz,
    vizZoom,
    vizPanOffset,
    txCenterFrequencyHz,
    txSampleRateHz,
    txPowerDbm,
    txSignal,
    txIfftSize,
  ].join("|");
};

export const isHalfDuplexSourceInfo = (
  source: SourceInfo | null | undefined,
): boolean => {
  const duplexMode = source?.duplex_mode?.toLowerCase?.() ?? "";
  return duplexMode === "half-duplex";
};

export const shouldAutoResumeVisualizerOnSourceSwitch = (
  selectedSource: SourceInfo | null | undefined,
  autoPausedOnSourceSwitch: boolean,
): boolean =>
  autoPausedOnSourceSwitch &&
  !!selectedSource &&
  !isTxCapableSourceInfo(selectedSource);

export const shouldAutoPauseVisualizerOnRouteLeave = (
  selectedSource: SourceInfo | null | undefined,
): boolean => !!selectedSource && !isTxCapableSourceInfo(selectedSource);

export const shouldAutoResumeVisualizerOnTxSelection = (
  selectedSource: SourceInfo | null | undefined,
  manualVisualizerPaused: boolean,
): boolean =>
  !!selectedSource &&
  !isTxCapableSourceInfo(selectedSource) &&
  manualVisualizerPaused;

export const shouldSyncVisualizerPauseToBackend = (
  selectedSource: SourceInfo | null | undefined,
): boolean => !!selectedSource && !isTxCapableSourceInfo(selectedSource);

export const shouldPauseSourceOnSwitch = (
  source: SourceInfo | null | undefined,
): boolean => {
  if (!source) return false;
  return !isTxCapableSourceInfo(source);
};

export const shouldResumePausedRxSourceOnSelection = (
  source: SourceInfo | null | undefined,
  manuallyPaused: boolean,
): boolean =>
  !!source &&
  !manuallyPaused &&
  source.paused === true &&
  (!isTxCapableSourceInfo(source) ||
    (isHalfDuplexSourceInfo(source) && source.status !== "transmitting"));

const isRecoverableLiveSourceStatus = (
  status: string | null | undefined,
): boolean => {
  const normalized = status?.toLowerCase?.() ?? "";
  return ![
    "loading",
    "disconnected",
    "stale",
    "error",
    "transmitting",
  ].includes(normalized);
};

export const shouldAutoResumeVisualizerOnDeviceRecovery = (
  source: SourceInfo | null | undefined,
  manuallyPaused: boolean,
  currentDeviceState: DeviceState | null | undefined,
  previousDeviceState: DeviceState | null | undefined,
): boolean =>
  !!source &&
  !manuallyPaused &&
  previousDeviceState !== "connected" &&
  currentDeviceState === "connected" &&
  isRecoverableLiveSourceStatus(source.status);

export const isLiveVisualizerPathname = (pathname: string): boolean =>
  pathname === "/" || pathname === "/visualizer";

export const shouldSendSelectSource = ({
  isConnected,
  sourceMode,
  selectedSourceId,
  activeSourceId,
  selectionIntentSourceId,
  availableSourceIds,
}: {
  isConnected: boolean;
  sourceMode: SourceMode;
  selectedSourceId: string;
  activeSourceId: string;
  selectionIntentSourceId: string | null;
  availableSourceIds: string[];
}): boolean =>
  sourceMode === "live" &&
  isConnected &&
  selectedSourceId.length > 0 &&
  selectionIntentSourceId === selectedSourceId &&
  selectedSourceId !== activeSourceId &&
  availableSourceIds.includes(selectedSourceId);

export const resolveEffectiveSourcePaused = ({
  backendPaused,
  localPaused,
  manuallyPaused,
  autoPaused,
}: {
  backendPaused?: boolean;
  localPaused?: boolean;
  manuallyPaused: boolean;
  autoPaused: boolean;
}): boolean => localPaused ?? backendPaused ?? (manuallyPaused || autoPaused);

const estimateRefreshRateFromSamples = (samples: number[]): number | null => {
  if (samples.length === 0) return null;

  const sorted = [...samples]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  // Use the fastest stable cluster to approximate the display's max refresh.
  // Average-based estimates are easily pulled down by occasional dropped frames.
  const fastestClusterSize = Math.max(5, Math.floor(sorted.length * 0.25));
  const fastestCluster = sorted.slice(0, fastestClusterSize);
  const medianOfFastestCluster =
    fastestCluster[Math.floor(fastestCluster.length / 2)];

  if (!medianOfFastestCluster || medianOfFastestCluster <= 0) return null;

  const estimatedFps = 1000 / medianOfFastestCluster;

  // Snap to common refresh rates when we're close enough to them.
  const commonRates = [24, 30, 48, 50, 60, 90, 120, 144, 165, 240];
  const nearest = commonRates.reduce(
    (best, rate) => {
      const distance = Math.abs(rate - estimatedFps);
      return distance < best.distance ? { rate, distance } : best;
    },
    { rate: estimatedFps, distance: Number.POSITIVE_INFINITY },
  );

  return nearest.distance <= 3 ? nearest.rate : estimatedFps;
};

const detectRefreshRate = async (sampleCount = 180): Promise<number | null> => {
  if (typeof window === "undefined") return null;

  return await new Promise((resolve) => {
    const samples: number[] = [];
    let last = performance.now();
    let rafId = 0;

    const finish = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      resolve(estimateRefreshRateFromSamples(samples));
    };

    const loop = (now: number) => {
      samples.push(now - last);
      last = now;

      if (samples.length >= sampleCount) {
        finish();
        return;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
  });
};

export const LIVE_CONTROL_DEFAULTS = {
  displayTemporalResolution: "medium" as const,
  powerScale: "dB" as const,
  vizZoom: 1,
  vizZoomFloor: 1,
  vizZoomFloorPan: 0,
  autoZoomStability: true,
  vizPanOffset: 0,
  fftMinDb: -120,
  fftMaxDb: 0,
  fftWindow: "Rectangular",
  gain: 46.9,
  hackrfLnaGain: 0.0,
  hackrfVgaGain: 30.0,
  hackrfAmpEnabled: false,
  hackrfBasebandBandwidth: 3_200_000,
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
  centerOffset: number; // Unit: Hz
  peakAmplitude: number; // Unit: dB (max 0)
  simulatedNoise: number;
  beats: BeatParams[]; // Up to 2 beats
  baseSignalType?: "none" | "gaussian" | "bpsk";
  baseSignalAmplitude?: number; // dB
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
  detectedFrameRate: number | null;
  isWaterfallCleared: boolean;
  vizZoom: number;
  vizPanOffset: number;
  fftMinDb: number;
  fftMaxDb: number;
  fftSize: number;
  fftWindow: string;
  showSpikeOverlay: boolean;
  gain: number;
  txSignal: string;
  hackrfLnaGain: number;
  hackrfVgaGain: number;
  hackrfAmpEnabled: boolean;
  hackrfBasebandBandwidth: number | null;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  sampleRateHz: number;
  minReceiveSampleRateHz: number;
  sample_size: number;
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
  fftAvgEnabled: boolean;
  fftSmoothEnabled: boolean;
  wfSmoothEnabled: boolean;
  vizZoomFloor: number;
  vizZoomFloorPan: number;
  autoZoomStability: boolean;
  stitchOptions: {
    phaseCorrection: boolean;
    fmDeviationCorrection: boolean;
    antiAliasing: boolean;
    noiseFloorMatching: boolean;
    crossfading: boolean;
    chineseRemainderSynthesis: boolean;
    jsAntiAliasing: boolean;
    jsNoiseFloorMatching: boolean;
    acquisitionMode: "stepwise" | "interleaved";
  };
};

const PERSISTED_SOURCE_VIEW_FIELDS: Array<keyof SpectrumState> = [
  "activeSignalArea",
  "frequencyRange",
  "displayTemporalResolution",
  "powerScale",
  "vizZoom",
  "vizZoomFloor",
  "vizZoomFloorPan",
  "autoZoomStability",
  "vizPanOffset",
  "fftMinDb",
  "fftMaxDb",
  "fftSize",
  "fftFrameRate",
  "fftWindow",
  "showSpikeOverlay",
  "gain",
  "hackrfLnaGain",
  "hackrfVgaGain",
  "hackrfAmpEnabled",
  "hackrfBasebandBandwidth",
  "sampleRateHz",
  "ppm",
  "tunerAGC",
  "rtlAGC",
  "lastKnownRanges",
  "displayMode",
  "fftAvgEnabled",
  "fftSmoothEnabled",
  "wfSmoothEnabled",
];

export const buildPersistedSourceViewState = (
  state: SpectrumState,
): Partial<SpectrumState> => {
  const persisted: Partial<SpectrumState> = {};
  for (const key of PERSISTED_SOURCE_VIEW_FIELDS) {
    const value = state[key];
    if (typeof value !== "undefined") {
      persisted[key] = value as never;
    }
  }
  return persisted;
};

export const normalizePersistedSourceViewState = (
  persisted: Partial<SpectrumState> | null | undefined,
): Partial<SpectrumState> => {
  if (!persisted || typeof persisted !== "object") {
    return {};
  }

  const next: Partial<SpectrumState> = {};
  for (const key of PERSISTED_SOURCE_VIEW_FIELDS) {
    const value = persisted[key];
    if (typeof value !== "undefined") {
      next[key] = value as never;
    }
  }
  return next;
};

export const resolveSourceSwitchDisplaySettings = (
  restored: Partial<SpectrumState> | null | undefined,
  current: Partial<SpectrumState>,
): Partial<SpectrumState> => ({
  ...current,
  ...normalizePersistedSourceViewState(restored),
});

export type SpectrumAction =
  | { type: "SET_SIGNAL_AREA"; area: string }
  | { type: "SET_FREQUENCY_RANGE"; range: FrequencyRange }
  | {
      type: "SET_SIGNAL_AREA_AND_RANGE";
      area: string;
      range: FrequencyRange;
    }
  | {
      type: "MERGE_LAST_KNOWN_RANGES";
      ranges: Record<string, FrequencyRange>;
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
  | { type: "SET_DETECTED_FRAME_RATE"; detectedFrameRate: number | null }
  | { type: "CLEAR_WATERFALL" }
  | { type: "RESET_WATERFALL_CLEARED" }
  | { type: "SET_VIZ_ZOOM"; zoom: number }
  | { type: "SET_VIZ_ZOOM_FLOOR"; zoomFloor: number }
  | { type: "SET_VIZ_ZOOM_FLOOR_PAN"; pan: number }
  | { type: "SET_AUTO_ZOOM_STABILITY"; enabled: boolean }
  | { type: "SET_VIZ_PAN"; pan: number }
  | { type: "SET_FFT_DB_LIMITS"; min: number; max: number }
  | { type: "SET_SHOW_SPIKE_OVERLAY"; enabled: boolean }
  | { type: "SET_SAMPLE_RATE"; sampleRateHz: number }
  | { type: "SET_MIN_RECEIVE_SAMPLE_RATE"; minReceiveSampleRateHz: number }
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
  | { type: "SET_FFT_WINDOW"; fftWindow: string }
  | {
      type: "SET_STITCH_OPTION";
      option: keyof SpectrumState["stitchOptions"];
      enabled: boolean;
    }
  | {
      type: "SET_STITCH_OPTION_VALUE";
      option: keyof SpectrumState["stitchOptions"];
      value: any;
    };

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
      centerOffset: 1_500_000,
      peakAmplitude: -40, // -40 dB
      simulatedNoise: 0.05,
      beats: [],
      baseSignalType: "none",
      baseSignalAmplitude: -55,
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
  detectedFrameRate: null,
  isWaterfallCleared: false,
  vizZoom: 1,
  vizZoomFloor: 1,
  vizZoomFloorPan: 0,
  autoZoomStability: true,
  vizPanOffset: 0,
  fftMinDb: -120,
  fftMaxDb: 0,
  fftSize: 32768,
  fftWindow: "Rectangular",
  showSpikeOverlay: false,
  gain: 10,
  txSignal: "wifi",
  hackrfLnaGain: 0.0,
  hackrfVgaGain: 0.0,
  hackrfAmpEnabled: true,
  hackrfBasebandBandwidth: null,
  ppm: 0,
  tunerAGC: false,
  rtlAGC: false,
  sampleRateHz: 3_200_000,
  minReceiveSampleRateHz: 3_200_000,
  sample_size: 3_200_000,
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
  fftAvgEnabled: false,
  fftSmoothEnabled: false,
  wfSmoothEnabled: false,
  stitchOptions: {
    phaseCorrection: true,
    fmDeviationCorrection: true,
    antiAliasing: true,
    noiseFloorMatching: true,
    crossfading: true,
    chineseRemainderSynthesis: false,
    jsAntiAliasing: false,
    jsNoiseFloorMatching: false,
    acquisitionMode: "interleaved",
  },
};

export { applyWaterfallStateOverrides } from "@n-apt/hooks/spectrumStoreOverrides";

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
    // Ensure lastKnownRanges is a valid object (not null, undefined, or non-object)
    if (
      !parsed.lastKnownRanges ||
      typeof parsed.lastKnownRanges !== "object" ||
      Array.isArray(parsed.lastKnownRanges)
    ) {
      parsed.lastKnownRanges = {};
    }

    // The live sample rate must stay in sync with the websocket/backend.
    // Keeping a persisted value here causes HMR/reload drift.
    if ("sampleRateHz" in parsed) {
      delete parsed.sampleRateHz;
    }

    if (!Number.isFinite(parsed.txSampleRateHz)) {
      parsed.txSampleRateHz = 2_400_000;
    }

    if (
      !Number.isFinite(parsed.txCenterFrequencyHz) ||
      parsed.txCenterFrequencyHz === 2_204_000 ||
      parsed.txCenterFrequencyHz === 1_600_000
    ) {
      parsed.txCenterFrequencyHz = 137_100_000;
    }

    if (!Number.isFinite(parsed.txPowerDbm)) {
      parsed.txPowerDbm = -18;
    }

    if (!Number.isFinite(parsed.txVgaGain)) {
      parsed.txVgaGain = 16;
    }

    normalizePersistedTxViewerSettings(parsed);

    parsed.txSignal = normalizePersistedTxSignalKey(parsed.txSignal);

    if (typeof parsed.txSafetyEnabled !== "boolean") {
      parsed.txSafetyEnabled = false;
    }

    if (typeof parsed.txSafetyLimit !== "string") {
      parsed.txSafetyLimit = "room";
    }

    if (typeof parsed.txHopType !== "string") {
      parsed.txHopType = "range";
    }

    if (!Number.isFinite(parsed.txHopStartFrequencyHz)) {
      parsed.txHopStartFrequencyHz = 10_000_000;
    }

    if (!Number.isFinite(parsed.txHopEndFrequencyHz)) {
      parsed.txHopEndFrequencyHz = 20_000_000;
    }

    if (!Array.isArray(parsed.txHopChannels)) {
      parsed.txHopChannels = ["a"];
    }

    if (!Number.isFinite(parsed.txHopRateHz)) {
      parsed.txHopRateHz = 10;
    }

    if (typeof parsed.txHopEnabled !== "boolean") {
      parsed.txHopEnabled = false;
    }

    // Older persisted spectrum state can contain gain=0 as a placeholder.
    // That should not override the live default restored from the backend.
    if (parsed.gain === 0) {
      delete parsed.gain;
    }

    return parsed;
  } catch {
    return {};
  }
};

export const selectLiveSampleRateForSync = ({
  isConnected,
  websocketSampleRateHz,
  sdrSettingsSampleRateHz,
  minReceiveSampleRateHz,
  maxSampleRateHz,
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
}: {
  isConnected: boolean;
  websocketSampleRateHz?: number | null;
  sdrSettingsSampleRateHz?: number | null;
  minReceiveSampleRateHz?: number | null;
  maxSampleRateHz?: number | null;
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isRtlSdr?: boolean | null;
}): number | null => {
  const isRtlDevice = isRtlSdrDevice({
    deviceKind,
    backend,
    deviceName,
    isRtlSdr,
  });
  const candidates = isRtlDevice
    ? [minReceiveSampleRateHz, sdrSettingsSampleRateHz, maxSampleRateHz]
    : isConnected
      ? [websocketSampleRateHz, sdrSettingsSampleRateHz, maxSampleRateHz]
      : [sdrSettingsSampleRateHz, maxSampleRateHz];

  return resolveSourceSampleRateHz({ candidates, maxSampleRateHz });
};

export const resolveEffectiveLiveSampleRateHz = ({
  localSampleRateHz,
  websocketSampleRateHz,
  sdrSettingsSampleRateHz,
  minReceiveSampleRateHz,
  maxSampleRateHz,
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
}: {
  localSampleRateHz?: number | null;
  websocketSampleRateHz?: number | null;
  sdrSettingsSampleRateHz?: number | null;
  minReceiveSampleRateHz?: number | null;
  maxSampleRateHz?: number | null;
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isRtlSdr?: boolean | null;
}): number | null => {
  const isRtlDevice = isRtlSdrDevice({
    deviceKind,
    backend,
    deviceName,
    isRtlSdr,
  });
  const candidates = isRtlDevice
    ? [
        minReceiveSampleRateHz,
        sdrSettingsSampleRateHz,
        localSampleRateHz,
        maxSampleRateHz,
        websocketSampleRateHz,
      ]
    : [
        websocketSampleRateHz,
        sdrSettingsSampleRateHz,
        localSampleRateHz,
        maxSampleRateHz,
      ];

  return resolveSourceSampleRateHz({ candidates, maxSampleRateHz });
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
      const safeRanges =
        state.lastKnownRanges && typeof state.lastKnownRanges === "object"
          ? state.lastKnownRanges
          : {};
      return {
        ...state,
        frequencyRange: action.range,
        lastKnownRanges: state.activeSignalArea
          ? { ...safeRanges, [state.activeSignalArea]: action.range }
          : safeRanges,
      };
    case "SET_SIGNAL_AREA_AND_RANGE":
      const safeRanges2 =
        state.lastKnownRanges && typeof state.lastKnownRanges === "object"
          ? state.lastKnownRanges
          : {};
      return {
        ...state,
        activeSignalArea: action.area,
        frequencyRange: action.range,
        lastKnownRanges: { ...safeRanges2, [action.area]: action.range },
      };
    case "MERGE_LAST_KNOWN_RANGES":
      return {
        ...state,
        lastKnownRanges: {
          ...(state.lastKnownRanges && typeof state.lastKnownRanges === "object"
            ? state.lastKnownRanges
            : {}),
          ...action.ranges,
        },
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
    case "SET_DETECTED_FRAME_RATE":
      return { ...state, detectedFrameRate: action.detectedFrameRate };
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
    case "SET_VIZ_ZOOM_FLOOR":
      return { ...state, vizZoomFloor: action.zoomFloor };
    case "SET_VIZ_ZOOM_FLOOR_PAN":
      return { ...state, vizZoomFloorPan: action.pan };
    case "SET_AUTO_ZOOM_STABILITY":
      return { ...state, autoZoomStability: action.enabled };
    case "SET_VIZ_PAN":
      return { ...state, vizPanOffset: action.pan };
    case "SET_FFT_DB_LIMITS":
      return {
        ...state,
        fftMinDb: Math.round(action.min),
        fftMaxDb: Math.round(action.max),
      };
    case "SET_SHOW_SPIKE_OVERLAY":
      return { ...state, showSpikeOverlay: action.enabled };
    case "SET_SAMPLE_RATE":
      return {
        ...state,
        sampleRateHz: action.sampleRateHz,
        sample_size: action.sampleRateHz,
      };
    case "SET_MIN_RECEIVE_SAMPLE_RATE":
      return {
        ...state,
        minReceiveSampleRateHz: action.minReceiveSampleRateHz,
      };
    case "SET_SDR_SETTINGS_BUNDLE":
      return {
        ...state,
        ...action.settings,
        sample_size:
          typeof action.settings.sampleRateHz === "number"
            ? action.settings.sampleRateHz
            : state.sample_size,
      };
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
        vizZoomFloor: 1,
        vizZoomFloorPan: 0,
        autoZoomStability: true,
        vizPanOffset: 0,
        fftMinDb: isDbm ? -100 : -120,
        fftMaxDb: isDbm ? 30 : 0,
      };
    }
    case "RESET_DRAW_PARAMS":
      return {
        ...state,
        drawParams: JSON.parse(
          JSON.stringify(INITIAL_SPECTRUM_STATE.drawParams),
        ),
        globalNoiseFloor: INITIAL_SPECTRUM_STATE.globalNoiseFloor,
        activeClumpIndex: 0,
      };
    case "RESET_LIVE_CONTROLS": {
      const isDbm = state.powerScale === "dBm";
      return {
        ...state,
        displayTemporalResolution:
          LIVE_CONTROL_DEFAULTS.displayTemporalResolution,
        vizZoom: LIVE_CONTROL_DEFAULTS.vizZoom,
        vizZoomFloor: 1,
        vizZoomFloorPan: 0,
        autoZoomStability: true,
        vizPanOffset: LIVE_CONTROL_DEFAULTS.vizPanOffset,
        fftMinDb: isDbm ? -100 : -120,
        fftMaxDb: isDbm ? 30 : 0,
        fftWindow: LIVE_CONTROL_DEFAULTS.fftWindow,
        gain: LIVE_CONTROL_DEFAULTS.gain,
        hackrfLnaGain: LIVE_CONTROL_DEFAULTS.hackrfLnaGain,
        hackrfVgaGain: LIVE_CONTROL_DEFAULTS.hackrfVgaGain,
        hackrfAmpEnabled: LIVE_CONTROL_DEFAULTS.hackrfAmpEnabled,
        hackrfBasebandBandwidth: LIVE_CONTROL_DEFAULTS.hackrfBasebandBandwidth,
        ppm: LIVE_CONTROL_DEFAULTS.ppm,
        tunerAGC: LIVE_CONTROL_DEFAULTS.tunerAGC,
        rtlAGC: LIVE_CONTROL_DEFAULTS.rtlAGC,
        fftAvgEnabled: false,
        fftSmoothEnabled: false,
        wfSmoothEnabled: false,
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
    case "SET_STITCH_OPTION":
      return {
        ...state,
        stitchOptions: {
          ...state.stitchOptions,
          [action.option]: action.enabled,
        },
      };
    case "SET_STITCH_OPTION_VALUE":
      return {
        ...state,
        stitchOptions: {
          ...state.stitchOptions,
          [action.option]: action.value,
        },
      };
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
  selectedSourceId: string;
  setSelectedSourceId: React.Dispatch<React.SetStateAction<string>>;
  selectedSource: SourceInfo | null;
  selectedSourceDerived: {
    deviceState: DeviceState | null;
    deviceName: string | null;
    deviceProfile: DeviceProfile | null;
    deviceInfo: string | null;
    backend: string | null;
    maxSampleRateHz: number | null;
    sampleRateOptions: number[];
    sampleRateHz: number | null;
    sdrSettings: Partial<SdrSettingsConfig> | SourceSdrSettings | null;
  };
  effectiveFrames: SpectrumFrame[];
  effectiveSdrSettings:
    | Partial<SdrSettingsConfig>
    | SourceSdrSettings
    | null
    | undefined;
  sampleRateHzEffective: number | null;
  signalAreaBounds: Record<string, { min: number; max: number }> | null;
  wsConnection: {
    isConnected: boolean;
    activeSourceId: string | null;
    deviceState: DeviceState;
    deviceLoadingReason: DeviceLoadingReason;
    isPaused: boolean;
    serverPaused: boolean;
    backend: string | null;
    deviceInfo: string | null;
    deviceName: string | null;
    deviceProfile: DeviceProfile | null;
    maxSampleRateHz: number | null;
    sampleRateOptions: number[];
    sampleRateHz: number | null;
    sdrSettings: Partial<SdrSettingsConfig> | SourceSdrSettings | null;
    sdrLimitMarkers: Array<{
      kind: string;
      freq_hz: number;
      label?: string;
    }>;
    dataRef: React.MutableRefObject<any>;
    spectrumFrames: SpectrumFrame[];
    sources: SourceInfo[];
    captureStatus: CaptureStatus;
    error: string | null;
    cryptoCorrupted: boolean;
    sendFrequencyRange: (range: FrequencyRange) => void;
    sendPauseCommand: (isPaused: boolean, sourceId: string) => void;
    sendSettings: (settings: SDRSettings) => void;
    sendRestartDevice: () => void;
    sendCaptureCommand: (req: CaptureRequest) => void;
    sendScanCommand: (
      jobId: string,
      minFreq: number,
      maxFreq: number,
      options?: any,
    ) => void;
    sendDemodulateCommand: (jobId: string, region: any) => void;
    sendTrainingCommand: (
      action: "start" | "stop",
      label: "target" | "noise",
      signalArea: string,
    ) => void;
    sendPowerScaleCommand: (scale: "dB" | "dBm") => void;
    sendTransmitMode: (
      enabled: boolean,
      device: string,
      txSettings: {
        serialNumber: string;
        centerFrequencyHz?: number | null;
        viewCenterHz?: number | null;
        bandwidthHz?: number | null;
        sampleRateHz?: number | null;
        ifftSize?: number | null;
        powerDbm?: number | null;
        lnaGainDb?: number | null;
        vgaGainDb?: number | null;
        ampEnabled?: boolean | null;
        tunerAgc?: boolean | null;
        rtlAgc?: boolean | null;
        ppm?: number | null;
        txSafetyEnabled?: boolean | null;
        txSafetyLimit?: string | null;
        txSignal?: string | null;
        txHopEnabled?: boolean | null;
        txHopType?: string | null;
        txHopStartFrequencyHz?: number | null;
        txHopEndFrequencyHz?: number | null;
        txHopChannels?: string[] | null;
        txHopRateHz?: number | null;
      },
    ) => void;
  };
  toggleVisualizerPause: (sourceId?: string) => void;
  cryptoCorrupted: boolean;
  deviceName: string | null;
  deviceProfile: DeviceProfile | null;
  sources: SourceInfo[];
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

const SpectrumProviderReal: React.FC<{ children: React.ReactNode }> = memo(
  ({ children }) => {
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
    const cryptoCorrupted = useAppSelector((s) => s.websocket.cryptoCorrupted);
    const activeSource = useAppSelector(selectActiveSource);
    const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);
    const websocketSources = useAppSelector((s) => s.websocket.sources);
    const websocketChannels = useAppSelector((s) => s.websocket.channels);
    const sourceStatuses = useAppSelector((s) => s.websocket.sourceStatuses);
    const txSuiteSourceId = useAppSelector(
      (s) =>
        s.sourceRouting?.bindings[sourceBindingKey("tx-suite", "tx")] ?? null,
    );
    const txSuiteRxSourceId = useAppSelector(
      (s) =>
        s.sourceRouting?.bindings[sourceBindingKey("tx-suite", "rx")] ?? null,
    );
    const isTxSuiteFlow = useAppSelector(
      (s) => s.sourceRouting?.selectionModes?.["tx-suite"] === "multi",
    );
    const txSuiteSource = useAppSelector((s) =>
      txSuiteSourceId
        ? (s.websocket.sources ?? []).find(
            (source) => source.id === txSuiteSourceId,
          ) ?? null
        : null,
    );
    const deviceState = activeSourceDerived.deviceState;
    const backend = activeSourceDerived.backend;
    const deviceName = activeSourceDerived.deviceName;
    const deviceProfile = activeSourceDerived.deviceProfile;
    const maxSampleRateHz = activeSourceDerived.maxSampleRateHz;
    const sampleRateHz = activeSourceDerived.sampleRateHz;
    const sdrSettings = activeSourceDerived.sdrSettings;
    const activeSourceId = activeSource?.id ?? "";
    const [selectedSourceId, setSelectedSourceIdState] = useState<string>(
      () => {
        const stored = loadSelectedSourceId();
        return stored || activeSourceId || websocketSources[0]?.id || "";
      },
    );
    const selectionIntentSourceIdRef = useRef<string | null>(null);
    const setSelectedSourceId = useCallback<
      React.Dispatch<React.SetStateAction<string>>
    >((nextSourceId) => {
      if (typeof nextSourceId === "function") {
        setSelectedSourceIdState((currentSourceId) => {
          const resolvedSourceId = nextSourceId(currentSourceId);
          selectionIntentSourceIdRef.current = resolvedSourceId;
          return resolvedSourceId;
        });
        return;
      }
      selectionIntentSourceIdRef.current = nextSourceId;
      setSelectedSourceIdState(nextSourceId);
    }, []);

    useEffect(() => {
      const hasBoundRxTransport =
        typeof txSuiteRxSourceId === "string" &&
        websocketSources.some((source) => source.id === txSuiteRxSourceId);
      if (
        state.sourceMode !== "live" ||
        !hasBoundRxTransport ||
        !shouldPinTxSuiteToRxSource({
          isTxSuite: isTxSuiteFlow,
          rxSourceId: txSuiteRxSourceId,
          selectedSourceId,
        })
      ) {
        return;
      }

      const controlSourceId = resolveTxSuiteControlSourceId({
        isTxSuite: isTxSuiteFlow,
        rxSourceId: txSuiteRxSourceId,
        selectedSourceId,
        activeSourceId,
      });
      if (controlSourceId && controlSourceId !== selectedSourceId) {
        setSelectedSourceId(controlSourceId);
      }
    }, [
      activeSourceId,
      isTxSuiteFlow,
      selectedSourceId,
      setSelectedSourceId,
      state.sourceMode,
      txSuiteRxSourceId,
      websocketSources,
    ]);
    const [localSourcePauseOverrides, setLocalSourcePauseOverrides] = useState<
      Record<string, boolean>
    >({});
    const currentSourceStateRef = useRef(state);
    const selectedSourceViewKeyRef = useRef<string | null>(null);
    const skipNextSourceViewPersistRef = useRef<string | null>(null);
    const deferredFrequencyRangeSyncSourceIdRef = useRef<string | null>(null);
    const pendingSourceSwitchRef = useRef<string | null>(null);
    const sourceSwitchTimeoutRef = useRef<number | null>(null);
    const manualPausedSourceIdsRef = useRef<Set<string>>(new Set());
    const autoPausedSourceIdsRef = useRef<Set<string>>(new Set());
    const previousSelectedSourceIdRef = useRef<string | null>(null);
    const previousIsVisualizerRouteRef = useRef(
      isLiveVisualizerPathname(location.pathname),
    );
    useEffect(() => {
      currentSourceStateRef.current = state;
    }, [state]);
    const effectiveWebsocketSources = useMemo(
      () =>
        websocketSources.map((source) => {
          const paused = resolveEffectiveSourcePaused({
            backendPaused: source.paused,
            localPaused: localSourcePauseOverrides[source.id],
            manuallyPaused: manualPausedSourceIdsRef.current.has(source.id),
            autoPaused: autoPausedSourceIdsRef.current.has(source.id),
          });
          return source.paused === paused ? source : { ...source, paused };
        }),
      [localSourcePauseOverrides, websocketSources],
    );
    const selectedSource = useMemo(() => {
      if (
        !Array.isArray(effectiveWebsocketSources) ||
        effectiveWebsocketSources.length === 0
      ) {
        return null;
      }

      return (
        effectiveWebsocketSources.find(
          (source) => source.id === selectedSourceId,
        ) ??
        effectiveWebsocketSources.find(
          (source) => source.id === activeSourceId,
        ) ??
        effectiveWebsocketSources[0] ??
        null
      );
    }, [activeSourceId, effectiveWebsocketSources, selectedSourceId]);
    const selectedSourceViewKey = useMemo(
      () => getSourceViewStorageKeyForSource(selectedSource),
      [selectedSource],
    );
    const streamingSource = useMemo(
      () =>
        resolveStreamingSourceForDisplay({
          selectedSourceId,
          activeSourceId,
          sources: effectiveWebsocketSources,
        }),
      [activeSourceId, effectiveWebsocketSources, selectedSourceId],
    );
    const selectedSourceDerived = useMemo(
      () => deriveSourceDerivedState(streamingSource),
      [streamingSource],
    );
    const wsSpectrumFrames = useAppSelector((s) => s.websocket.spectrumFrames);
    const captureStatus = useAppSelector((s) => s.websocket.captureStatus);
    const error = useAppSelector((s) => s.websocket.error);
    const waterfallState = useAppSelector((s) => s.waterfall);
    // liveDataRef is written directly by the middleware — never goes through Redux.
    const dataRef = liveDataRef;

    const reduxSpectrumState = useAppSelector((s) => s.spectrum);

    useEffect(() => {
      const nextSourceId = resolveSelectedSourceIdForInventory({
        selectedSourceId,
        activeSourceId,
        pendingSourceSwitchId: pendingSourceSwitchRef.current,
        selectionIntentSourceId: selectionIntentSourceIdRef.current,
        sources: websocketSources,
      });
      if (nextSourceId !== selectedSourceId) {
        setSelectedSourceIdState(nextSourceId);
      }
    }, [activeSourceId, selectedSourceId, websocketSources]);

    useEffect(() => {
      if (!selectedSourceId || !selectedSourceViewKey) {
        return;
      }

      // Source-specific controls must change with the active I/Q stream, not
      // with a click that the backend has not accepted yet. Otherwise a RTL
      // sample rate/options can be painted over HackRF frames during a warm
      // switch.
      if (
        state.sourceMode === "live" &&
        activeSourceId.length > 0 &&
        selectedSourceId !== activeSourceId
      ) {
        return;
      }

      const previousSourceViewKey = selectedSourceViewKeyRef.current;
      if (
        previousSourceViewKey &&
        previousSourceViewKey !== selectedSourceViewKey
      ) {
        saveStoredJson(
          previousSourceViewKey,
          buildPersistedSourceViewState(currentSourceStateRef.current),
        );
      }

      if (previousSourceViewKey !== selectedSourceViewKey) {
        const restoredState = resolveSourceSwitchDisplaySettings(
          loadStoredJson<Partial<SpectrumState>>(selectedSourceViewKey),
          {},
        );
        skipNextSourceViewPersistRef.current = selectedSourceViewKey;
        if (Object.keys(restoredState).length > 0) {
          if (restoredState.frequencyRange) {
            // The range sync effect runs later in this commit. Defer it once so
            // it cannot send the previous source's range before this restored
            // source view has reached React state.
            deferredFrequencyRangeSyncSourceIdRef.current = selectedSourceId;
          }
          dispatch({
            type: "SET_SDR_SETTINGS_BUNDLE",
            settings: restoredState,
          });
          reduxDispatch(setSdrSettingsBundleAction(restoredState));
        }
        selectedSourceViewKeyRef.current = selectedSourceViewKey;
      }

      saveSelectedSourceId(selectedSourceId);
    }, [
      activeSourceId,
      dispatch,
      reduxDispatch,
      selectedSourceId,
      selectedSourceViewKey,
      state.sourceMode,
    ]);

    useEffect(() => {
      const availableSourceIds = Array.isArray(websocketSources)
        ? websocketSources.map((source) => source.id)
        : [];
      if (
        !shouldSendSelectSource({
          isConnected,
          sourceMode: state.sourceMode,
          selectedSourceId,
          activeSourceId,
          selectionIntentSourceId: selectionIntentSourceIdRef.current,
          availableSourceIds,
        })
      ) {
        if (
          shouldClearPendingSourceSwitch({
            pendingSourceSwitchId: pendingSourceSwitchRef.current,
            selectedSourceId,
            activeSourceId,
          })
        ) {
          pendingSourceSwitchRef.current = null;
        }
        return;
      }

      if (pendingSourceSwitchRef.current === selectedSourceId) {
        return;
      }

      liveDataRef.current = [];
      reduxDispatch(sendSelectSourceThunk(selectedSourceId));
      pendingSourceSwitchRef.current = selectedSourceId;
      if (sourceSwitchTimeoutRef.current !== null) {
        window.clearTimeout(sourceSwitchTimeoutRef.current);
      }
      sourceSwitchTimeoutRef.current = window.setTimeout(() => {
        if (pendingSourceSwitchRef.current === selectedSourceId) {
          pendingSourceSwitchRef.current = null;
        }
        sourceSwitchTimeoutRef.current = null;
      }, 3_000);
    }, [
      activeSourceId,
      isConnected,
      reduxDispatch,
      selectedSource,
      selectedSourceId,
      state.sourceMode,
      websocketSources,
    ]);

    useEffect(() => {
      const pendingSourceId = pendingSourceSwitchRef.current;
      if (!pendingSourceId || pendingSourceId !== activeSourceId) {
        return;
      }
      pendingSourceSwitchRef.current = null;
      if (selectionIntentSourceIdRef.current === activeSourceId) {
        selectionIntentSourceIdRef.current = null;
      }
      if (sourceSwitchTimeoutRef.current !== null) {
        window.clearTimeout(sourceSwitchTimeoutRef.current);
        sourceSwitchTimeoutRef.current = null;
      }
    }, [activeSourceId]);

    useEffect(
      () => () => {
        if (sourceSwitchTimeoutRef.current !== null) {
          window.clearTimeout(sourceSwitchTimeoutRef.current);
        }
      },
      [],
    );

    useEffect(() => {
      if (!selectedSourceId || !selectedSourceViewKey) {
        return;
      }

      if (skipNextSourceViewPersistRef.current === selectedSourceViewKey) {
        skipNextSourceViewPersistRef.current = null;
        return;
      }

      saveStoredJson(
        selectedSourceViewKey,
        buildPersistedSourceViewState(state),
      );
    }, [selectedSourceId, selectedSourceViewKey, state]);

    const mergedState = useMemo(
      () => ({
        ...applyWaterfallStateOverrides(state, waterfallState),
        fftSize: reduxSpectrumState.fftSize,
        fftWindow: reduxSpectrumState.fftWindow,
        fftFrameRate: reduxSpectrumState.fftFrameRate,
        gain: reduxSpectrumState.gain,
        ppm: reduxSpectrumState.ppm,
        tunerAGC: reduxSpectrumState.tunerAGC,
        rtlAGC: reduxSpectrumState.rtlAGC,
        sampleRateHz: reduxSpectrumState.sampleRateHz,
        minReceiveSampleRateHz: reduxSpectrumState.minReceiveSampleRateHz,
      }),
      [state, waterfallState, reduxSpectrumState],
    );

    const storeDispatch = useCallback(
      (action: SpectrumAction) => {
        switch (action.type) {
          case "SET_SOURCE_MODE":
            reduxDispatch(setWaterfallSourceMode(action.mode));
            return;
          case "SET_SELECTED_FILES":
            reduxDispatch(setWaterfallSelectedFiles(action.files));
            return;
          case "SET_SNAPSHOT_GRID":
            reduxDispatch(setWaterfallSnapshotGrid(action.preference));
            dispatch(action);
            return;
          case "SET_GLOBAL_NOISE_FLOOR":
            reduxDispatch(setWaterfallGlobalNoiseFloor(action.noise));
            return;
          case "SET_STITCH_STATUS":
            reduxDispatch(setWaterfallStitchStatus(action.status));
            return;
          case "TRIGGER_STITCH":
            reduxDispatch(triggerWaterfallStitch());
            return;
          case "TOGGLE_STITCH_PAUSE":
            reduxDispatch(toggleWaterfallStitchPause());
            return;
          case "SET_STITCH_SOURCE_SETTINGS":
            reduxDispatch(setWaterfallStitchSourceSettings(action.settings));
            return;
          case "SET_STITCH_PAUSED":
            reduxDispatch(setWaterfallStitchPaused(action.paused));
            return;
          case "CLEAR_WATERFALL":
            reduxDispatch(clearWaterfall());
            return;
          case "RESET_WATERFALL_CLEARED":
            reduxDispatch(resetWaterfallCleared());
            return;
          case "SET_DRAW_SIGNAL_3D":
            reduxDispatch(setWaterfallDrawSignal3D(action.enabled));
            return;
          case "SET_SDR_SETTINGS_BUNDLE":
            reduxDispatch(setSdrSettingsBundleAction(action.settings as any));
            dispatch(action);
            return;
          case "RESET_LIVE_CONTROLS":
            reduxDispatch(
              resetLiveControlsAction({
                fftSize: action.fftSize,
                fftFrameRate: action.fftFrameRate,
              }),
            );
            dispatch(action);
            return;
          case "RESET_ZOOM_AND_DB":
            reduxDispatch(resetZoomAndDbAction());
            dispatch(action);
            return;
          case "SET_VIZ_ZOOM_FLOOR":
            dispatch(action);
            return;
          case "TRAINING_STOP":
            reduxDispatch(resetTrainingCapture());
            return;
          case "SET_DRAW_PARAMS":
            reduxDispatch(setWaterfallDrawParams(action.params));
            dispatch(action);
            return;
          case "SET_CLUMP_PARAMS":
            reduxDispatch(
              setWaterfallClumpParams({
                index: action.index,
                params: action.params,
              }),
            );
            dispatch(action);
            return;
          case "SET_ACTIVE_CLUMP_INDEX":
            reduxDispatch(setWaterfallActiveClumpIndex(action.index));
            dispatch(action);
            return;
          case "RESET_DRAW_PARAMS":
            reduxDispatch(resetWaterfallDrawParams());
            dispatch(action);
            return;
          case "SET_SHOW_SPIKE_OVERLAY":
            reduxDispatch(setShowSpikeOverlayAction(action.enabled));
            dispatch(action);
            return;
          default:
            dispatch(action);
        }
      },
      [reduxDispatch],
    );

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
      (paused: boolean, sourceId?: string) => {
        const pauseSourceId = sourceId || selectedSourceId || activeSourceId;
        if (!pauseSourceId) {
          return;
        }
        const pauseTargetSource =
          effectiveWebsocketSources.find(
            (source) => source.id === pauseSourceId,
          ) ?? (selectedSourceId === pauseSourceId ? selectedSource : null);
        const duplexMode =
          pauseTargetSource?.duplex_mode?.toLowerCase?.() === "half-duplex"
            ? "half_duplex"
            : undefined;
        const activeMode = resolveDeviceActiveMode(pauseTargetSource);
        reduxDispatch({
          type: "websocket/setPaused",
          payload: {
            isPaused: paused,
            sourceId: pauseSourceId,
            duplexMode,
            activeMode,
          },
        });
      },
      [
        activeSourceId,
        effectiveWebsocketSources,
        reduxDispatch,
        selectedSource,
        selectedSourceId,
      ],
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
        reduxDispatch(
          sendScanCommandThunk({ jobId, minFreq, maxFreq, options }),
        );
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

    const sendPowerScaleCommand = useCallback(
      (scale: "dB" | "dBm") => {
        reduxDispatch(sendPowerScaleCommandThunk(scale));
      },
      [reduxDispatch],
    );

    const sendTransmitModeCommand = useCallback(
      (
        enabled: boolean,
        device: string,
        txSettings: {
          serialNumber: string;
          centerFrequencyHz?: number | null;
          viewCenterHz?: number | null;
          bandwidthHz?: number | null;
          sampleRateHz?: number | null;
          ifftSize?: number | null;
          powerDbm?: number | null;
          lnaGainDb?: number | null;
          vgaGainDb?: number | null;
          ampEnabled?: boolean | null;
          tunerAgc?: boolean | null;
          rtlAgc?: boolean | null;
          ppm?: number | null;
          txSafetyEnabled?: boolean | null;
          txSafetyLimit?: string | null;
          txSignal?: string | null;
          txHopEnabled?: boolean | null;
          txHopType?: string | null;
          txHopStartFrequencyHz?: number | null;
          txHopEndFrequencyHz?: number | null;
          txHopChannels?: string[] | null;
          txHopRateHz?: number | null;
        },
      ) => {
        if (!isConnected) {
          return;
        }
        const { ifftSize, ...txSettingsWithoutIfftSize } = txSettings;
        reduxDispatch({
          type: "websocket/sendMessage",
          payload: {
            type: "tx_mode",
            data: {
              active_mode: enabled ? "tx" : "rx",
              txDevice: device,
              txSafetyEnabled: reduxSpectrumState.txSafetyEnabled,
              txSafetyLimit: reduxSpectrumState.txSafetyLimit,
              txSignal: reduxSpectrumState.txSignal,
              txHopEnabled: reduxSpectrumState.txHopEnabled,
              txHopType: reduxSpectrumState.txHopType,
              txHopStartFrequencyHz: reduxSpectrumState.txHopStartFrequencyHz,
              txHopEndFrequencyHz: reduxSpectrumState.txHopEndFrequencyHz,
              txHopChannels: reduxSpectrumState.txHopChannels,
              txHopRateHz: reduxSpectrumState.txHopRateHz,
              ...txSettingsWithoutIfftSize,
              txIfftSize:
                typeof ifftSize === "number" ? Math.round(ifftSize) : ifftSize,
            },
          },
        });
      },
      [isConnected, reduxDispatch, reduxSpectrumState],
    );

    const wsConnection = useMemo(
      () => ({
        isConnected,
        activeSourceId: activeSourceId || null,
        deviceState: activeSourceDerived.deviceState,
        deviceLoadingReason: (activeSource?.status === "loading"
          ? "connect"
          : null) as DeviceLoadingReason,
        isPaused,
        serverPaused,
        backend: activeSourceDerived.backend,
        deviceInfo: activeSourceDerived.deviceInfo,
        deviceName: activeSourceDerived.deviceName,
        deviceProfile: activeSourceDerived.deviceProfile,
        maxSampleRateHz: activeSourceDerived.maxSampleRateHz,
        sampleRateOptions: activeSourceDerived.sampleRateOptions,
        sampleRateHz: activeSourceDerived.sampleRateHz,
        sdrSettings: activeSourceDerived.sdrSettings,
        sdrLimitMarkers: activeSource?.sdr.fft_display.markers ?? [],
        dataRef,
        spectrumFrames: wsSpectrumFrames,
        sources: effectiveWebsocketSources,
        captureStatus,
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
        sendPowerScaleCommand,
        sendTransmitMode: sendTransmitModeCommand,
      }),
      [
        isConnected,
        activeSourceId,
        activeSourceDerived.deviceState,
        activeSource,
        activeSourceDerived,
        isPaused,
        serverPaused,
        dataRef,
        effectiveWebsocketSources,
        captureStatus,
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
        sendPowerScaleCommand,
        sendTransmitModeCommand,
      ],
    );

    // Track active spectrum route globally
    const isVisualizerRoute = isLiveVisualizerPathname(location.pathname);
    const [manualVisualizerPaused, setManualVisualizerPaused] = useState(false);
    const previousDeviceStateRef = useRef<DeviceState | null>(null);

    // Track if we've already synced backend connection settings
    const hasInitializedBackendSettingsRef = useRef(false);

    const wasConnectedRef = useRef(false);
    useEffect(() => {
      if (isConnected && !wasConnectedRef.current) {
        hasInitializedBackendSettingsRef.current = false;
      }
      wasConnectedRef.current = isConnected;
    }, [isConnected]);

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
      useState<SourceSdrSettings | null>(() => {
        if (typeof window === "undefined") return null;
        try {
          const raw = sessionStorage.getItem("napt-sdr-settings");
          if (!raw) return null;
          return JSON.parse(raw) as SourceSdrSettings;
        } catch {
          return null;
        }
      });
    const lastLiveSourceIdRef = useRef<string | null>(null);

    const syncSelectedSourcePauseState = useCallback(
      (sourceId: string | null | undefined) => {
        const sourcePaused = sourceId
          ? effectiveWebsocketSources.find((source) => source.id === sourceId)
              ?.paused
          : undefined;
        const nextPaused =
          !!sourceId &&
          (sourcePaused !== undefined
            ? sourcePaused
            : manualPausedSourceIdsRef.current.has(sourceId) ||
              autoPausedSourceIdsRef.current.has(sourceId));
        if (manualVisualizerPaused === nextPaused) {
          return;
        }
        setManualVisualizerPaused(nextPaused);
        storeDispatch({
          type: "SET_VISUALIZER_PAUSED",
          paused: nextPaused,
        });
      },
      [effectiveWebsocketSources, manualVisualizerPaused, storeDispatch],
    );

    useEffect(() => {
      if (!isConnected || !selectedSourceId || !selectedSource) {
        return;
      }

      const previousSelectedSourceId = previousSelectedSourceIdRef.current;
      previousSelectedSourceIdRef.current = selectedSourceId;

      if (
        previousSelectedSourceId &&
        previousSelectedSourceId !== selectedSourceId
      ) {
        const previousSource = effectiveWebsocketSources.find(
          (source) => source.id === previousSelectedSourceId,
        );
        const previouslyManuallyPaused = manualPausedSourceIdsRef.current.has(
          previousSelectedSourceId,
        );
        const previouslyAutoPaused = autoPausedSourceIdsRef.current.has(
          previousSelectedSourceId,
        );
        if (
          previousSource &&
          shouldPauseSourceOnSwitch(previousSource) &&
          !previouslyManuallyPaused &&
          !previouslyAutoPaused
        ) {
          autoPausedSourceIdsRef.current.add(previousSelectedSourceId);
          setLocalSourcePauseOverrides((current) => ({
            ...current,
            [previousSelectedSourceId]: true,
          }));
          wsConnection.sendPauseCommand(true, previousSelectedSourceId);
        }
      }

      if (
        shouldResumePausedRxSourceOnSelection(
          selectedSource,
          manualPausedSourceIdsRef.current.has(selectedSourceId),
        )
      ) {
        autoPausedSourceIdsRef.current.delete(selectedSourceId);
        setLocalSourcePauseOverrides((current) => ({
          ...current,
          [selectedSourceId]: false,
        }));
        wsConnection.sendPauseCommand(false, selectedSourceId);
        syncSelectedSourcePauseState(selectedSourceId);
        return;
      }

      if (isTxCapableSourceInfo(selectedSource)) {
        syncSelectedSourcePauseState(selectedSourceId);
        return;
      }

      if (autoPausedSourceIdsRef.current.has(selectedSourceId)) {
        autoPausedSourceIdsRef.current.delete(selectedSourceId);
        setLocalSourcePauseOverrides((current) => ({
          ...current,
          [selectedSourceId]: false,
        }));
        wsConnection.sendPauseCommand(false, selectedSourceId);
      }

      syncSelectedSourcePauseState(selectedSourceId);
    }, [
      isConnected,
      selectedSource,
      selectedSourceId,
      syncSelectedSourcePauseState,
      effectiveWebsocketSources,
      wsConnection,
    ]);

    useEffect(() => {
      if (state.sourceMode !== "live") {
        lastLiveSourceIdRef.current = null;
        return;
      }

      const currentLiveSourceId =
        activeSourceId ?? selectedSource?.id ?? selectedSourceId ?? null;
      if (!currentLiveSourceId) {
        return;
      }

      if (lastLiveSourceIdRef.current === currentLiveSourceId) {
        return;
      }

      lastLiveSourceIdRef.current = currentLiveSourceId;
      liveDataRef.current = null;
      setCachedFrames([]);
      try {
        sessionStorage.removeItem("napt-spectrum-frames");
      } catch {
        /* ignore */
      }
    }, [activeSourceId, selectedSource, selectedSourceId, state.sourceMode]);

    useEffect(() => {
      const previousDeviceState = previousDeviceStateRef.current;
      previousDeviceStateRef.current = deviceState;

      if (!isConnected || !selectedSourceId || !selectedSource) {
        return;
      }

      if (!manualVisualizerPaused) {
        return;
      }

      if (
        !shouldAutoResumeVisualizerOnDeviceRecovery(
          selectedSource,
          manualPausedSourceIdsRef.current.has(selectedSourceId),
          deviceState,
          previousDeviceState,
        )
      ) {
        return;
      }

      autoPausedSourceIdsRef.current.delete(selectedSourceId);
      setLocalSourcePauseOverrides((current) => ({
        ...current,
        [selectedSourceId]: false,
      }));
      wsConnection.sendPauseCommand(false, selectedSourceId);
      syncSelectedSourcePauseState(selectedSourceId);
    }, [
      deviceState,
      isConnected,
      manualVisualizerPaused,
      selectedSource,
      selectedSourceId,
      syncSelectedSourcePauseState,
      wsConnection,
    ]);

    useEffect(() => {
      const wasVisualizerRoute = previousIsVisualizerRouteRef.current;
      previousIsVisualizerRouteRef.current = isVisualizerRoute;

      if (!selectedSourceId || !selectedSource) {
        return;
      }

      if (wasVisualizerRoute && !isVisualizerRoute) {
        if (
          isTxCapableSourceInfo(selectedSource) ||
          manualPausedSourceIdsRef.current.has(selectedSourceId) ||
          autoPausedSourceIdsRef.current.has(selectedSourceId)
        ) {
          return;
        }

        autoPausedSourceIdsRef.current.add(selectedSourceId);
        setLocalSourcePauseOverrides((current) => ({
          ...current,
          [selectedSourceId]: true,
        }));
        wsConnection.sendPauseCommand(true, selectedSourceId);
        syncSelectedSourcePauseState(selectedSourceId);
        return;
      }

      if (!wasVisualizerRoute && isVisualizerRoute) {
        if (!autoPausedSourceIdsRef.current.has(selectedSourceId)) {
          syncSelectedSourcePauseState(selectedSourceId);
          return;
        }

        autoPausedSourceIdsRef.current.delete(selectedSourceId);
        setLocalSourcePauseOverrides((current) => ({
          ...current,
          [selectedSourceId]: false,
        }));
        wsConnection.sendPauseCommand(false, selectedSourceId);
        syncSelectedSourcePauseState(selectedSourceId);
      }
    }, [
      isVisualizerRoute,
      selectedSource,
      selectedSourceId,
      syncSelectedSourcePauseState,
      storeDispatch,
      wsConnection,
    ]);

    // Persist SDR settings when they change
    useEffect(() => {
      const settingsToPersist = {
        fftSize: state.fftSize,
        fftWindow: state.fftWindow,
        fftFrameRate: state.fftFrameRate,
        detectedFrameRate: state.detectedFrameRate,
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
        snapshotGridPreference: mergedState.snapshotGridPreference,
        sampleRateHz: state.sampleRateHz,
        sample_size: state.sample_size,
      };
      sessionStorage.setItem(
        SDR_SETTINGS_KEY,
        JSON.stringify(settingsToPersist),
      );
    }, [
      state.fftSize,
      state.fftWindow,
      state.fftFrameRate,
      state.detectedFrameRate,
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
      mergedState.snapshotGridPreference,
      state.sampleRateHz,
      state.sample_size,
    ]);

    const lastSentPowerScaleRef = useRef<"dB" | "dBm" | null>(null);
    useEffect(() => {
      if (!isConnected || lastSentPowerScaleRef.current === state.powerScale)
        return;
      wsConnection.sendPowerScaleCommand(state.powerScale);
      lastSentPowerScaleRef.current = state.powerScale;
    }, [isConnected, wsConnection.sendPowerScaleCommand, state.powerScale]);

    const pausedPreviewTimeoutRef = useRef<number | null>(null);
    const lastPausedPreviewSignatureRef = useRef<string | null>(null);
    const wasPausedForPreviewRef = useRef(false);
    useEffect(() => {
      const isLiveSource = state.sourceMode === "live";
      const isPausedForPreview =
        manualVisualizerPaused &&
        isConnected &&
        shouldRequestPausedPreview(selectedSource);
      const isSwitchingSource =
        activeSourceId !== null &&
        selectedSourceId !== null &&
        activeSourceId !== selectedSourceId;

      if (!isLiveSource || !isPausedForPreview || isSwitchingSource) {
        if (pausedPreviewTimeoutRef.current !== null) {
          window.clearTimeout(pausedPreviewTimeoutRef.current);
          pausedPreviewTimeoutRef.current = null;
        }
        lastPausedPreviewSignatureRef.current = null;
        wasPausedForPreviewRef.current = isPausedForPreview;
        return;
      }

      if (!wasPausedForPreviewRef.current && isPausedForPreview) {
        wasPausedForPreviewRef.current = true;
      }

      const nextSignature = buildPausedPreviewSignature({
        frequencyRange: state.frequencyRange,
        sampleRateHz: reduxSpectrumState.sampleRateHz,
        vizZoom: state.vizZoom,
        vizPanOffset: state.vizPanOffset,
        txCenterFrequencyHz: reduxSpectrumState.txCenterFrequencyHz,
        txSampleRateHz: reduxSpectrumState.txSampleRateHz,
        txPowerDbm: reduxSpectrumState.txPowerDbm,
        txSignal: reduxSpectrumState.txSignal,
        txIfftSize: reduxSpectrumState.txIfftSize,
      });

      if (nextSignature === lastPausedPreviewSignatureRef.current) {
        return;
      }

      if (pausedPreviewTimeoutRef.current !== null) {
        window.clearTimeout(pausedPreviewTimeoutRef.current);
      }

      pausedPreviewTimeoutRef.current = window.setTimeout(() => {
        reduxDispatch(
          requestNextPausedFrameThunk({
            txSettings: {
              centerFrequencyHz: reduxSpectrumState.txCenterFrequencyHz,
              bandwidthHz: reduxSpectrumState.txSampleRateHz,
              powerDbm: reduxSpectrumState.txPowerDbm,
              txSignal: reduxSpectrumState.txSignal,
              txIfftSize: reduxSpectrumState.txIfftSize,
            },
          }),
        );
        lastPausedPreviewSignatureRef.current = nextSignature;
        pausedPreviewTimeoutRef.current = null;
      }, 120);

      return () => {
        if (pausedPreviewTimeoutRef.current !== null) {
          window.clearTimeout(pausedPreviewTimeoutRef.current);
          pausedPreviewTimeoutRef.current = null;
        }
      };
    }, [
      activeSourceId,
      isConnected,
      manualVisualizerPaused,
      reduxDispatch,
      reduxSpectrumState.txCenterFrequencyHz,
      reduxSpectrumState.txIfftSize,
      reduxSpectrumState.txPowerDbm,
      reduxSpectrumState.txSampleRateHz,
      reduxSpectrumState.txSignal,
      selectedSourceId,
      selectedSource,
      state.frequencyRange,
      reduxSpectrumState.sampleRateHz,
      state.sourceMode,
      state.vizPanOffset,
      state.vizZoom,
    ]);

    const lastSentFrameRateRef = useRef<number | null>(null);
    useEffect(() => {
      if (!isConnected || state.detectedFrameRate == null || !activeSourceId)
        return;
      if (lastSentFrameRateRef.current === state.detectedFrameRate) return;
      reduxDispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "signal_display_settings",
          data: {
            source_id: activeSourceId,
            sample_rate: state.sampleRateHz,
            fft_size: state.fftSize,
            frame_rate: Math.round(state.detectedFrameRate),
          },
        },
      });
      lastSentFrameRateRef.current = state.detectedFrameRate;
    }, [
      isConnected,
      reduxDispatch,
      state.detectedFrameRate,
      state.sampleRateHz,
      state.fftSize,
      activeSourceId,
    ]);

    const lastSentTxSettingsRef = useRef<string | null>(null);
    const txSettingsThrottleTimeoutRef = useRef<number | null>(null);
    const txSettingsLastSentTimeRef = useRef<number>(0);
    const latestTxSettingsRef = useRef<any>(null);

    // Clean up throttle timeout on unmount
    useEffect(() => {
      return () => {
        if (txSettingsThrottleTimeoutRef.current !== null) {
          clearTimeout(txSettingsThrottleTimeoutRef.current);
        }
      };
    }, []);

    // Synchronize transmit settings changes to backend if currently transmitting
    useEffect(() => {
      const controlSourceId = txSuiteSourceId ?? activeSourceId;
      const controlSource = txSuiteSource ?? activeSource;
      if (!isConnected || !controlSourceId) return;

      const currentStatus = sourceStatuses?.[controlSourceId] ?? controlSource?.status;
      if (currentStatus !== "transmitting") {
        lastSentTxSettingsRef.current = null;
        if (txSettingsThrottleTimeoutRef.current !== null) {
          clearTimeout(txSettingsThrottleTimeoutRef.current);
          txSettingsThrottleTimeoutRef.current = null;
        }
        return;
      }

      const settings = {
        centerFrequencyHz: reduxSpectrumState.txCenterFrequencyHz,
        bandwidthHz: reduxSpectrumState.txSampleRateHz,
        powerDbm: reduxSpectrumState.txPowerDbm,
        vgaGainDb: reduxSpectrumState.txVgaGain,
        txSafetyEnabled: reduxSpectrumState.txSafetyEnabled,
        txSafetyLimit: reduxSpectrumState.txSafetyLimit,
        txSignal: reduxSpectrumState.txSignal,
        txHopEnabled: reduxSpectrumState.txHopEnabled,
        txHopType: reduxSpectrumState.txHopType,
        txHopStartFrequencyHz: reduxSpectrumState.txHopStartFrequencyHz,
        txHopEndFrequencyHz: reduxSpectrumState.txHopEndFrequencyHz,
        txHopChannels: reduxSpectrumState.txHopChannels,
        txHopRateHz: reduxSpectrumState.txHopRateHz,
      };

      latestTxSettingsRef.current = settings;

      const runSync = () => {
        const freshSettings = latestTxSettingsRef.current;
        if (!freshSettings) return;
        const settingsStr = JSON.stringify(freshSettings);
        if (lastSentTxSettingsRef.current === settingsStr) return;

        lastSentTxSettingsRef.current = settingsStr;
        txSettingsLastSentTimeRef.current = Date.now();
        sendTransmitModeCommand(true, controlSourceId, {
          serialNumber: controlSource?.serial_number ?? controlSourceId,
          ...freshSettings,
        });
      };

      const settingsStr = JSON.stringify(settings);
      if (lastSentTxSettingsRef.current === settingsStr) return;

      const now = Date.now();
      const timeSinceLastSend = now - txSettingsLastSentTimeRef.current;
      const throttleDelay = 50; // 50ms throttle limit for smooth interaction

      if (timeSinceLastSend >= throttleDelay) {
        if (txSettingsThrottleTimeoutRef.current !== null) {
          clearTimeout(txSettingsThrottleTimeoutRef.current);
          txSettingsThrottleTimeoutRef.current = null;
        }
        runSync();
      } else {
        // If a timeout is already scheduled, it will run with the latest settings,
        // so we don't need to reschedule or postpone it.
        if (txSettingsThrottleTimeoutRef.current === null) {
          const remaining = throttleDelay - timeSinceLastSend;
          txSettingsThrottleTimeoutRef.current = window.setTimeout(() => {
            txSettingsThrottleTimeoutRef.current = null;
            runSync();
          }, remaining);
        }
      }
    }, [
      isConnected,
      activeSource,
      activeSourceId,
      txSuiteSource,
      txSuiteSourceId,
      sourceStatuses,
      reduxSpectrumState.txCenterFrequencyHz,
      reduxSpectrumState.txSampleRateHz,
      reduxSpectrumState.txPowerDbm,
      reduxSpectrumState.txVgaGain,
      reduxSpectrumState.txSafetyEnabled,
      reduxSpectrumState.txSafetyLimit,
      reduxSpectrumState.txSignal,
      reduxSpectrumState.txHopEnabled,
      reduxSpectrumState.txHopType,
      reduxSpectrumState.txHopStartFrequencyHz,
      reduxSpectrumState.txHopEndFrequencyHz,
      reduxSpectrumState.txHopChannels,
      reduxSpectrumState.txHopRateHz,
      activeSource,
      sendTransmitModeCommand,
    ]);

    // Revert power scale to dB if not supported by the current device
    useEffect(() => {
      if (
        deviceProfile &&
        !deviceProfile.supports_approx_dbm &&
        state.powerScale === "dBm"
      ) {
        storeDispatch({ type: "SET_POWER_SCALE", powerScale: "dB" });
      }
    }, [deviceProfile, state.powerScale, storeDispatch]);

    useEffect(() => {
      if (!isConnected) {
        setCachedFrames([]);
        try {
          sessionStorage.removeItem("napt-spectrum-frames");
        } catch {
          /* ignore */
        }
        return;
      }
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
    }, [isConnected, wsSpectrumFrames]);

    useEffect(() => {
      if (!isConnected) {
        setCachedSdrSettings(null);
        try {
          sessionStorage.removeItem("napt-sdr-settings");
        } catch {
          /* ignore */
        }
        return;
      }
      if (!sdrSettings) return;
      setCachedSdrSettings(sdrSettings);
      try {
        sessionStorage.setItem(
          "napt-sdr-settings",
          JSON.stringify(sdrSettings),
        );
        localStorage.setItem("napt-sdr-settings", JSON.stringify(sdrSettings));
      } catch {
        /* ignore */
      }
      reduxDispatch(
        websocketActions.updateDeviceState({
          sdrSettings: sdrSettings as any,
        }),
      );
    }, [isConnected, sdrSettings, reduxDispatch]);

    const hydratedBackendSampleRateRef = useRef(false);

    useEffect(() => {
      hydratedBackendSampleRateRef.current = false;
      hasInitializedBackendSettingsRef.current = false;
      // Force re-sending the current frequency range to the newly activated
      // device so it tunes to the user's last frequency, not the backend default.
      lastSentFrequencyRangeRef.current = null;
    }, [activeSourceId, selectedSourceViewKey]);

    // Hydrate sample rate from backend once. After user interaction, the
    // frontend is authoritative because sample-rate changes are one-way.
    useEffect(() => {
      const rate = selectLiveSampleRateForSync({
        isConnected,
        websocketSampleRateHz: sampleRateHz,
        sdrSettingsSampleRateHz: sdrSettings?.sample_rate,
        minReceiveSampleRateHz: sdrSettings?.min_receive_sample_rate,
        maxSampleRateHz,
        deviceKind: deviceProfile?.kind,
        backend,
        deviceName,
        isRtlSdr: deviceProfile?.is_rtl_sdr,
      });
      const hasValidLocalRate =
        typeof state.sampleRateHz === "number" &&
        Number.isFinite(state.sampleRateHz) &&
        state.sampleRateHz > 0;
      const shouldHydrateRate =
        typeof rate === "number" &&
        rate > 0 &&
        (!hasValidLocalRate || !hydratedBackendSampleRateRef.current);

      if (shouldHydrateRate && rate !== state.sampleRateHz) {
        storeDispatch({ type: "SET_SAMPLE_RATE", sampleRateHz: rate });
      }
      if (typeof rate === "number" && rate > 0) {
        hydratedBackendSampleRateRef.current = true;
      }
      const minReceiveRate =
        sdrSettings?.min_receive_sample_rate ??
        sdrSettings?.sample_rate ??
        rate;
      if (
        typeof minReceiveRate === "number" &&
        minReceiveRate > 0 &&
        minReceiveRate !== state.minReceiveSampleRateHz
      ) {
        storeDispatch({
          type: "SET_MIN_RECEIVE_SAMPLE_RATE",
          minReceiveSampleRateHz: minReceiveRate,
        });
      }
    }, [
      sdrSettings?.sample_rate,
      sdrSettings?.min_receive_sample_rate,
      sampleRateHz,
      maxSampleRateHz,
      isConnected,
      deviceProfile?.kind,
      deviceProfile?.is_rtl_sdr,
      backend,
      deviceName,
      state.sampleRateHz,
      state.minReceiveSampleRateHz,
      storeDispatch,
    ]);

    const effectiveFrames: SpectrumFrame[] = !isConnected
      ? []
      : Array.isArray(wsSpectrumFrames) && wsSpectrumFrames.length > 0
        ? wsSpectrumFrames
        : Array.isArray(cachedFrames)
          ? cachedFrames
          : [];
    const effectiveSdrSettings = isConnected
      ? (sdrSettings ?? cachedSdrSettings)
      : null;

    const sampleRateHzEffective = resolveEffectiveLiveSampleRateHz({
      localSampleRateHz: mergedState.sampleRateHz,
      websocketSampleRateHz: sampleRateHz,
      sdrSettingsSampleRateHz: effectiveSdrSettings?.sample_rate,
      minReceiveSampleRateHz: effectiveSdrSettings?.min_receive_sample_rate,
      maxSampleRateHz,
      deviceKind: deviceProfile?.kind,
      backend,
      deviceName,
      isRtlSdr: deviceProfile?.is_rtl_sdr,
    });

    const signalAreaBounds = useMemo(() => {
      if (!Array.isArray(effectiveFrames) || effectiveFrames.length === 0) {
        return null;
      }
      const bounds: Record<string, { min: number; max: number }> = {};
      effectiveFrames.forEach((frame) => {
        const label = frame.label;
        if (!label) return;
        bounds[label] = { min: frame.min_hz, max: frame.max_hz };
        bounds[label.toLowerCase()] = { min: frame.min_hz, max: frame.max_hz };
      });
      return bounds;
    }, [effectiveFrames]);

    const activeSignalAreaBounds =
      signalAreaBounds?.[mergedState.activeSignalArea] ??
      signalAreaBounds?.[mergedState.activeSignalArea?.toLowerCase?.()] ??
      null;

    const clampLiveFrequencyRange = useCallback(
      (range: FrequencyRange) => {
        const bounds = mergedState.vizZoom > 1 ? null : activeSignalAreaBounds;
        if (!bounds) return normalizeFrequencyRangeToHz(range);

        const rangeSpan = range.max - range.min;
        const boundsSpan = bounds.max - bounds.min;
        const rtlClampedRange = clampRtlSdrFrequencyRangeToHardwareWindow({
          range,
          channelBounds: bounds,
          hardwareSampleRateHz: sampleRateHzEffective,
          deviceKind: deviceProfile?.kind,
          backend,
          deviceName,
          isRtlSdr: deviceProfile?.is_rtl_sdr,
        });
        if (
          rtlClampedRange.min !== range.min ||
          rtlClampedRange.max !== range.max
        ) {
          return normalizeFrequencyRangeToHz(rtlClampedRange);
        }

        if (Number.isFinite(rangeSpan) && rangeSpan > boundsSpan) {
          return normalizeFrequencyRangeToHz(range);
        }

        return normalizeFrequencyRangeToHz(
          clampFrequencyRangeToBounds(range, bounds),
        );
      },
      [
        activeSignalAreaBounds,
        backend,
        deviceName,
        deviceProfile?.is_rtl_sdr,
        deviceProfile?.kind,
        mergedState.vizZoom,
        sampleRateHzEffective,
      ],
    );

    const lastSentFrequencyRangeRef = useRef<FrequencyRange | null>(null);
    const previousFrequencyRangeSyncSourceIdRef = useRef<string | null>(null);

    useEffect(() => {
      if (!isConnected || deviceState !== "connected") {
        lastSentFrequencyRangeRef.current = null;
      }
    }, [deviceState, isConnected]);

    // A persisted Whole Channel range can be wider than the RTL-SDR window.
    // Normalize it as soon as the connected source reveals its real maximum;
    // otherwise the old channel span survives the handoff as a fake rate.
    useEffect(() => {
      const currentRange = mergedState.frequencyRange;
      if (
        !isConnected ||
        deviceState !== "connected" ||
        !currentRange ||
        !isRtlSdrDevice({
          deviceKind: deviceProfile?.kind,
          backend,
          deviceName,
          isRtlSdr: deviceProfile?.is_rtl_sdr,
        })
      ) {
        return;
      }

      const nextRange = clampLiveFrequencyRange(currentRange);
      if (
        nextRange.min === currentRange.min &&
        nextRange.max === currentRange.max
      ) {
        return;
      }

      storeDispatch({ type: "SET_FREQUENCY_RANGE", range: nextRange });
      wsConnection.sendFrequencyRange(nextRange);
      lastSentFrequencyRangeRef.current = nextRange;
    }, [
      backend,
      clampLiveFrequencyRange,
      deviceName,
      deviceProfile?.is_rtl_sdr,
      deviceProfile?.kind,
      deviceState,
      isConnected,
      mergedState.frequencyRange,
      storeDispatch,
      wsConnection.sendFrequencyRange,
    ]);

    // Initialize frequencyRange if either it is null or unset
    // based on the first available frame (usually area 'A')
    // and the current sample rate. This is placed after variable
    // declarations to satisfy closure requirements.
    useEffect(() => {
      if (mergedState.frequencyRange) return;
      if (!isConnected) return;
      if (
        !activeSourceId ||
        selectedSourceId !== activeSourceId ||
        isMockTxSource({ id: activeSourceId, kind: activeSource?.kind })
      ) {
        return;
      }
      const sourceChannels =
        effectiveFrames.length > 0
          ? effectiveFrames
          : Array.isArray(websocketChannels) && websocketChannels.length > 0
            ? websocketChannels
            : [];
      if (!Array.isArray(sourceChannels) || sourceChannels.length === 0) return;

      const primaryFrame =
        sourceChannels.find((frame) => frame.label?.toLowerCase?.() === "a") ??
        sourceChannels[0];
      if (!primaryFrame) return;

      const min = primaryFrame.min_hz;
      const initialSampleRateHz = sampleRateHzEffective ?? sampleRateHz;
      const max = initialSampleRateHz
        ? Math.max(
            min,
            Math.min(primaryFrame.max_hz, min + initialSampleRateHz),
          )
        : primaryFrame.max_hz;
      const nextRange = clampLiveFrequencyRange({ min, max });

      const range = nextRange;
      if (
        lastSentFrequencyRangeRef.current?.min === range.min &&
        lastSentFrequencyRangeRef.current?.max === range.max
      )
        return;

      storeDispatch({ type: "SET_FREQUENCY_RANGE", range: nextRange });
      wsConnection.sendFrequencyRange(nextRange);
      lastSentFrequencyRangeRef.current = nextRange;
    }, [
      mergedState.frequencyRange,
      sampleRateHz,
      sampleRateHzEffective,
      effectiveFrames,
      websocketChannels,
      isConnected,
      activeSourceId,
      activeSource?.kind,
      selectedSourceId,
      deviceState,
      wsConnection.sendFrequencyRange,
      storeDispatch,
      clampLiveFrequencyRange,
    ]);

    // Execute exactly once to absorb backend default configurations (like signals.yaml gain)
    useEffect(() => {
      if (
        !isConnected ||
        !sdrSettings ||
        hasInitializedBackendSettingsRef.current
      )
        return;

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
      storeDispatch({
        type: "SET_SDR_SETTINGS_BUNDLE",
        settings: {
          ...derived,
          fftSize:
            typeof mergedState.fftSize === "number" && mergedState.fftSize > 0
              ? mergedState.fftSize
              : derived.fftSize,
          fftFrameRate:
            typeof mergedState.fftFrameRate === "number" &&
            mergedState.fftFrameRate > 0
              ? mergedState.fftFrameRate
              : derived.fftFrameRate,
        },
      });
    }, [
      isConnected,
      sdrSettings,
      sampleRateHzEffective,
      storeDispatch,
      mergedState.fftSize,
      mergedState.fftFrameRate,
    ]);

    useEffect(() => {
      const currentRange = mergedState.frequencyRange;
      const range = currentRange ? clampLiveFrequencyRange(currentRange) : null;
      const isRestoringSourceView =
        !!activeSourceId &&
        deferredFrequencyRangeSyncSourceIdRef.current === activeSourceId;
      const syncPlan = resolveSourceFrequencyRangeSync({
        connected: isConnected,
        selectedSourceId,
        activeSourceId: activeSourceId || null,
        previousActiveSourceId: previousFrequencyRangeSyncSourceIdRef.current,
        activeSourceIsMockTx: isMockTxSource({
          id: activeSourceId,
          kind: activeSource?.kind,
        }),
        frequencyRange: range,
        lastSentFrequencyRange: lastSentFrequencyRangeRef.current,
        isRestoringSourceView,
      });
      previousFrequencyRangeSyncSourceIdRef.current =
        syncPlan.nextActiveSourceId;
      if (syncPlan.clearLastSentFrequencyRange) {
        lastSentFrequencyRangeRef.current = null;
      }
      if (isRestoringSourceView) {
        deferredFrequencyRangeSyncSourceIdRef.current = null;
        return;
      }
      if (!currentRange || !range || !syncPlan.rangeToSend) return;
      if (range.min !== currentRange.min || range.max !== currentRange.max) {
        storeDispatch({ type: "SET_FREQUENCY_RANGE", range });
      }
      wsConnection.sendFrequencyRange(syncPlan.rangeToSend);
      lastSentFrequencyRangeRef.current = syncPlan.rangeToSend;
    }, [
      isConnected,
      activeSourceId,
      activeSource?.kind,
      selectedSourceId,
      mergedState.frequencyRange,
      clampLiveFrequencyRange,
      storeDispatch,
      wsConnection.sendFrequencyRange,
    ]);

    useEffect(() => {
      if (!isVisualizerRoute) return;
      if (state.detectedFrameRate != null) return;

      const persistedFrameRate = getPersistedNumber(VISUALIZER_FRAME_RATE_KEY);
      if (persistedFrameRate != null) {
        storeDispatch({
          type: "SET_DETECTED_FRAME_RATE",
          detectedFrameRate: persistedFrameRate,
        });
        return;
      }

      let cancelled = false;
      void detectRefreshRate().then((frameRate) => {
        if (cancelled || frameRate == null) return;

        const rounded = Math.round(frameRate);
        storeDispatch({
          type: "SET_DETECTED_FRAME_RATE",
          detectedFrameRate: rounded,
        });
        try {
          sessionStorage.setItem(VISUALIZER_FRAME_RATE_KEY, String(rounded));
        } catch {
          /* ignore */
        }
      });

      return () => {
        cancelled = true;
      };
    }, [isVisualizerRoute, state.detectedFrameRate, storeDispatch]);

    const toggleVisualizerPause = useCallback(
      (sourceId?: string) => {
        if (mergedState.sourceMode === "file") {
          const nextPaused = !mergedState.isStitchPaused;
          storeDispatch({ type: "SET_STITCH_PAUSED", paused: nextPaused });
          return;
        }

        const pauseSourceId = sourceId || selectedSourceId || activeSourceId;
        if (!pauseSourceId) {
          return;
        }

        const pauseTargetSource =
          effectiveWebsocketSources.find(
            (source) => source.id === pauseSourceId,
          ) ?? (selectedSourceId === pauseSourceId ? selectedSource : null);
        const pauseTargetSourceId = pauseTargetSource?.id ?? pauseSourceId;
        const targetIsTxCapable = isTxCapableSourceInfo(pauseTargetSource);
        const currentPaused =
          pauseTargetSource?.paused ??
          (pauseTargetSourceId === selectedSourceId
            ? manualVisualizerPaused
            : false);
        const nextPaused = !currentPaused;

        if (targetIsTxCapable && !isHalfDuplexSourceInfo(pauseTargetSource)) {
          return;
        }

        if (nextPaused) {
          manualPausedSourceIdsRef.current.add(pauseTargetSourceId);
          autoPausedSourceIdsRef.current.delete(pauseTargetSourceId);
        } else {
          manualPausedSourceIdsRef.current.delete(pauseTargetSourceId);
          autoPausedSourceIdsRef.current.delete(pauseTargetSourceId);
        }
        setLocalSourcePauseOverrides((current) => ({
          ...current,
          [pauseTargetSourceId]: nextPaused,
        }));

        if (pauseTargetSourceId === selectedSourceId) {
          setManualVisualizerPaused(nextPaused);
          storeDispatch({
            type: "SET_VISUALIZER_PAUSED",
            paused: nextPaused,
          });
        }

        wsConnection.sendPauseCommand(nextPaused, pauseTargetSourceId);
      },
      [
        activeSourceId,
        manualVisualizerPaused,
        mergedState.isStitchPaused,
        mergedState.sourceMode,
        selectedSource,
        selectedSourceId,
        storeDispatch,
        effectiveWebsocketSources,
        wsConnection,
      ],
    );

    const value = useMemo(
      () => ({
        state: mergedState,
        dispatch: storeDispatch,
        fftVisualizerMachine,
        manualVisualizerPaused,
        setManualVisualizerPaused,
        selectedSourceId,
        setSelectedSourceId,
        selectedSource,
        selectedSourceDerived,
        effectiveFrames,
        effectiveSdrSettings,
        sampleRateHzEffective,
        signalAreaBounds,
        wsConnection,
        toggleVisualizerPause,
        cryptoCorrupted,
        deviceName,
        deviceProfile,
        sources: effectiveWebsocketSources,
      }),
      [
        mergedState,
        storeDispatch,
        fftVisualizerMachine,
        manualVisualizerPaused,
        selectedSourceId,
        selectedSource,
        selectedSourceDerived,
        effectiveFrames,
        effectiveSdrSettings,
        sampleRateHzEffective,
        signalAreaBounds,
        wsConnection,
        toggleVisualizerPause,
        cryptoCorrupted,
        deviceName,
        deviceProfile,
        effectiveWebsocketSources,
      ],
    );

    return (
      <SpectrumStoreContext.Provider value={value}>
        {children}
      </SpectrumStoreContext.Provider>
    );
  },
);

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
  return <SpectrumProviderReal>{children}</SpectrumProviderReal>;
};
