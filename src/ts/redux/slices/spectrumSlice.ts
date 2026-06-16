import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { FrequencyRange, Alignment } from "@n-apt/consts/types";

export const getMaxTxPowerDbm = (
  frequencyHz: number,
  deviceKind: string | null,
): number => {
  if (deviceKind !== "hackrf_one") {
    return Infinity;
  }
  if (frequencyHz < 2_150_000_000) {
    return 15;
  }
  if (frequencyHz < 2_750_000_000) {
    return 15;
  }
  if (frequencyHz < 4_000_000_000) {
    return 5;
  }
  return 0;
};

export const getMinTxPowerDbm = (
  frequencyHz: number,
  deviceKind: string | null,
): number => {
  if (deviceKind !== "hackrf_one") {
    return -Infinity;
  }
  if (frequencyHz < 30_000_000) {
    return -65;
  }
  if (frequencyHz < 100_000_000) {
    return -70;
  }
  if (frequencyHz < 1_000_000_000) {
    return -75;
  }
  if (frequencyHz < 3_000_000_000) {
    return -70;
  }
  return -60;
};

export type DisplayTemporalResolution = "low" | "medium" | "high";
export type PowerScale = "dB" | "dBm";
export type SourceMode = "live" | "file";

export interface SpectrumState {
  // Signal area and frequency
  activeSignalArea: string;
  frequencyRange: FrequencyRange | null;
  lastKnownRanges: Record<string, { min: number; max: number }>;

  // Display settings
  displayTemporalResolution: DisplayTemporalResolution;
  powerScale: PowerScale;
  vizZoom: number;
  vizZoomFloor: number;
  vizZoomFloorPan: number;
  autoZoomStability: boolean;
  vizPanOffset: number;
  displayMode: "fft" | "iq";

  // FFT settings
  fftMinDb: number;
  fftMaxDb: number;
  fftSize: number;
  fftSizeOptions: number[];
  fftWindow: string;
  fftFrameRate: number;
  fftAvgEnabled: boolean;
  fftSmoothEnabled: boolean;
  wfSmoothEnabled: boolean;

  // SDR settings
  txSignal: string;
  txSampleRateHz: number;
  txCenterFrequencyHz: number;
  txPowerDbm: number;
  txVgaGain: number;
  txSafetyEnabled: boolean;
  txSafetyLimit: "person" | "room" | "min";
  txHopType: "range" | "channels";
  txHopStartFrequencyHz: number;
  txHopEndFrequencyHz: number;
  txHopChannels: string[];
  txHopRateHz: number;
  txHopEnabled: boolean;
  gain: number;
  hackrfLnaGain: number;
  hackrfVgaGain: number;
  hackrfAmpEnabled: boolean;
  hackrfBasebandBandwidth: number | null;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  sampleRateHz: number;
  minReceiveSampleRateHz: number;
  deviceKind: string | null;

  // Visualization state
  visualizerPaused: boolean;
  isWaterfallCleared: boolean;
  showSpikeOverlay: boolean;
  gpuSpikeCount: number;
  showTxSlider: boolean;

  // Diagnostic state
  diagnosticStatus: string;
  isDiagnosticRunning: boolean;
  diagnosticTrigger: number;

  // Live preview range (from SpanNode)
  previewRange: FrequencyRange | null;
  previewAlignment: Alignment;
}

const LIVE_CONTROL_DEFAULTS = {
  displayTemporalResolution: "medium" as const,
  powerScale: "dB" as const,
  vizZoom: 1,
  vizZoomFloor: 1,
  vizZoomFloorPan: 0,
  autoZoomStability: true,
  vizPanOffset: 0,
  fftMinDb: -120,
  fftMaxDb: 0,
  previewRange: null,
  fftSizeOptions: [] as number[],
  fftWindow: "Rectangular",
  fftAvgEnabled: false,
  fftSmoothEnabled: false,
  wfSmoothEnabled: false,
  gain: 49.6,
  txSignal: "apt",
  txSampleRateHz: 2_400_000,
  txCenterFrequencyHz: 137_100_000,
  txPowerDbm: -18,
  txVgaGain: 16,
  txSafetyEnabled: false,
  txSafetyLimit: "room" as "person" | "room" | "min",
  txHopType: "range" as const,
  txHopStartFrequencyHz: 10_000_000,
  txHopEndFrequencyHz: 20_000_000,
  txHopChannels: ["a"],
  txHopRateHz: 10,
  txHopEnabled: false,
  hackrfLnaGain: 0.0,
  hackrfVgaGain: 30.0,
  hackrfAmpEnabled: false,
  hackrfBasebandBandwidth: 3_200_000,
  ppm: 1,
  tunerAGC: false,
  rtlAGC: false,
};

const initialState: SpectrumState = {
  activeSignalArea: "A",
  frequencyRange: null,
  lastKnownRanges: {},

  displayTemporalResolution: "medium",
  powerScale: "dB",
  vizZoom: 1,
  vizZoomFloor: 1,
  vizZoomFloorPan: 0,
  autoZoomStability: true,
  vizPanOffset: 0,
  displayMode: "fft",

  fftMinDb: -120,
  fftMaxDb: 0, // This will be updated based on powerScale
  fftSize: 2048,
  fftSizeOptions: [],
  fftWindow: "Rectangular",
  fftFrameRate: 60,
  fftAvgEnabled: false,
  fftSmoothEnabled: false,
  wfSmoothEnabled: false,

  gain: 49.6,
  txSignal: "apt",
  txSampleRateHz: 2_400_000,
  txCenterFrequencyHz: 137_100_000,
  txPowerDbm: -18,
  txVgaGain: 16,
  txSafetyEnabled: false,
  txSafetyLimit: "room",
  txHopType: "range",
  txHopStartFrequencyHz: 10_000_000,
  txHopEndFrequencyHz: 20_000_000,
  txHopChannels: ["a"],
  txHopRateHz: 10,
  txHopEnabled: false,
  hackrfLnaGain: 0.0,
  hackrfVgaGain: 30.0,
  hackrfAmpEnabled: false,
  hackrfBasebandBandwidth: 3_200_000,
  ppm: 1,
  tunerAGC: false,
  rtlAGC: false,
  sampleRateHz: 3_200_000,
  minReceiveSampleRateHz: 3_200_000,
  deviceKind: "hackrf_one",

  visualizerPaused: false,
  isWaterfallCleared: false,
  showSpikeOverlay: false,
  gpuSpikeCount: 0,
  showTxSlider: true,
  previewRange: null,
  previewAlignment: "centered",

  diagnosticStatus: "Ready",
  isDiagnosticRunning: false,
  diagnosticTrigger: 0,
};

const spectrumSlice = createSlice({
  name: "spectrum",
  initialState,
  reducers: {
    // Signal area and frequency
    setActiveSignalArea: (state, action: PayloadAction<string>) => {
      state.activeSignalArea = action.payload;
    },

    setFrequencyRange: (state, action: PayloadAction<FrequencyRange>) => {
      // Avoid redundant updates
      if (
        state.frequencyRange &&
        state.frequencyRange.min === action.payload.min &&
        state.frequencyRange.max === action.payload.max
      ) {
        return;
      }

      state.frequencyRange = action.payload;
      if (state.activeSignalArea) {
        if (
          !state.lastKnownRanges ||
          typeof state.lastKnownRanges !== "object"
        ) {
          state.lastKnownRanges = {};
        }
        state.lastKnownRanges[state.activeSignalArea] = action.payload;
      }
    },

    setSignalAreaAndRange: (
      state,
      action: PayloadAction<{ area: string; range: FrequencyRange }>,
    ) => {
      state.activeSignalArea = action.payload.area;
      state.frequencyRange = action.payload.range;
      if (!state.lastKnownRanges || typeof state.lastKnownRanges !== "object") {
        state.lastKnownRanges = {};
      }
      state.lastKnownRanges[action.payload.area] = action.payload.range;
    },

    mergeLastKnownRanges: (
      state,
      action: PayloadAction<Record<string, FrequencyRange>>,
    ) => {
      if (!state.lastKnownRanges || typeof state.lastKnownRanges !== "object") {
        state.lastKnownRanges = {};
      }
      state.lastKnownRanges = {
        ...state.lastKnownRanges,
        ...action.payload,
      };
    },

    // Display settings
    setTemporalResolution: (
      state,
      action: PayloadAction<DisplayTemporalResolution>,
    ) => {
      state.displayTemporalResolution = action.payload;
    },

    setPowerScale: (state, action: PayloadAction<PowerScale>) => {
      const isSwitchingToDbm = action.payload === "dBm";

      // Auto-adjust dB limits when switching scales
      if (isSwitchingToDbm && state.powerScale !== "dBm") {
        state.fftMinDb = -120;
        state.fftMaxDb = 30;
      } else if (!isSwitchingToDbm && state.powerScale === "dBm") {
        state.fftMinDb = -150;
        state.fftMaxDb = 0;
      }

      state.powerScale = action.payload;
    },

    setVizZoom: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.vizZoom = action.payload;
    },

    setVizZoomFloor: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.vizZoomFloor = action.payload;
    },

    setVizZoomFloorPan: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.vizZoomFloorPan = action.payload;
    },

    setAutoZoomStability: (state, action: PayloadAction<boolean>) => {
      state.autoZoomStability = action.payload;
    },

    setVizPan: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.vizPanOffset = action.payload;
    },

    setDisplayMode: (state, action: PayloadAction<"fft" | "iq">) => {
      state.displayMode = action.payload;
    },

    // FFT settings
    setFftDbLimits: (
      state,
      action: PayloadAction<{ min: number; max: number }>,
    ) => {
      if (
        !Number.isFinite(action.payload.min) ||
        !Number.isFinite(action.payload.max)
      )
        return;
      state.fftMinDb = Math.round(action.payload.min);
      state.fftMaxDb = Math.round(action.payload.max);
    },

    setFftSize: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.fftSize = action.payload;
    },

    setFftSizeOptions: (state, action: PayloadAction<number[]>) => {
      state.fftSizeOptions = action.payload;
    },

    setFftWindow: (state, action: PayloadAction<string>) => {
      state.fftWindow = action.payload;
    },

    setFftFrameRate: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.fftFrameRate = action.payload;
    },

    setFftAvgEnabled: (state, action: PayloadAction<boolean>) => {
      state.fftAvgEnabled = action.payload;
    },

    setFftSmoothEnabled: (state, action: PayloadAction<boolean>) => {
      state.fftSmoothEnabled = action.payload;
    },

    setWfSmoothEnabled: (state, action: PayloadAction<boolean>) => {
      state.wfSmoothEnabled = action.payload;
    },

    // SDR settings
    setTxSignal: (state, action: PayloadAction<string>) => {
      state.txSignal = action.payload;
    },

    setTxSampleRateHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txSampleRateHz = action.payload;
    },

    setTxCenterFrequencyHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txCenterFrequencyHz = action.payload;
      const minPower = getMinTxPowerDbm(action.payload, state.deviceKind);
      const maxPower = getMaxTxPowerDbm(action.payload, state.deviceKind);
      const power = Number.isFinite(state.txPowerDbm) ? state.txPowerDbm : -18;
      state.txPowerDbm = Math.max(minPower, Math.min(power, maxPower));
    },

    setTxPowerDbm: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      const minPower = getMinTxPowerDbm(
        state.txCenterFrequencyHz,
        state.deviceKind,
      );
      const maxPower = getMaxTxPowerDbm(
        state.txCenterFrequencyHz,
        state.deviceKind,
      );
      state.txPowerDbm = Math.max(minPower, Math.min(action.payload, maxPower));
    },

    setTxVgaGain: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txVgaGain = action.payload;
    },

    setTxSafetyEnabled: (state, action: PayloadAction<boolean>) => {
      state.txSafetyEnabled = action.payload;
    },

    setTxSafetyLimit: (
      state,
      action: PayloadAction<"person" | "room" | "min">,
    ) => {
      state.txSafetyLimit = action.payload;
    },

    setTxHopType: (state, action: PayloadAction<"range" | "channels">) => {
      state.txHopType = action.payload;
    },

    setTxHopStartFrequencyHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txHopStartFrequencyHz = action.payload;
    },

    setTxHopEndFrequencyHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txHopEndFrequencyHz = action.payload;
    },

    setTxHopChannels: (state, action: PayloadAction<string[]>) => {
      state.txHopChannels = action.payload;
    },

    setTxHopRateHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txHopRateHz = action.payload;
    },

    setTxHopEnabled: (state, action: PayloadAction<boolean>) => {
      state.txHopEnabled = action.payload;
    },

    setGain: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.gain = action.payload;
    },

    setHackrfLnaGain: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.hackrfLnaGain = action.payload;
    },

    setHackrfVgaGain: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.hackrfVgaGain = action.payload;
    },

    setHackrfAmpEnabled: (state, action: PayloadAction<boolean>) => {
      state.hackrfAmpEnabled = action.payload;
    },

    setPpm: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.ppm = action.payload;
    },

    setTunerAGC: (state, action: PayloadAction<boolean>) => {
      state.tunerAGC = action.payload;
    },

    setRtlAGC: (state, action: PayloadAction<boolean>) => {
      state.rtlAGC = action.payload;
    },

    setSampleRate: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.sampleRateHz = action.payload;
    },

    setMinReceiveSampleRate: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.minReceiveSampleRateHz = action.payload;
    },

    setSdrSettingsBundle: (
      state,
      action: PayloadAction<Partial<SpectrumState>>,
    ) => {
      const cleanPayload: Partial<SpectrumState> = {};
      for (const [key, val] of Object.entries(action.payload)) {
        if (typeof val === "number" && !Number.isFinite(val)) {
          continue;
        }
        (cleanPayload as any)[key] = val;
      }
      Object.assign(state, cleanPayload);
      const minPower = getMinTxPowerDbm(
        state.txCenterFrequencyHz,
        state.deviceKind,
      );
      const maxPower = getMaxTxPowerDbm(
        state.txCenterFrequencyHz,
        state.deviceKind,
      );
      const power = Number.isFinite(state.txPowerDbm) ? state.txPowerDbm : -18;
      state.txPowerDbm = Math.max(minPower, Math.min(power, maxPower));
    },

    setDeviceKind: (state, action: PayloadAction<string | null>) => {
      state.deviceKind = action.payload;
      const minPower = getMinTxPowerDbm(
        state.txCenterFrequencyHz,
        action.payload,
      );
      const maxPower = getMaxTxPowerDbm(
        state.txCenterFrequencyHz,
        action.payload,
      );
      const power = Number.isFinite(state.txPowerDbm) ? state.txPowerDbm : -18;
      state.txPowerDbm = Math.max(minPower, Math.min(power, maxPower));
    },

    // Visualization state
    setVisualizerPaused: (state, action: PayloadAction<boolean>) => {
      state.visualizerPaused = action.payload;
    },

    clearWaterfall: (state) => {
      state.isWaterfallCleared = true;
    },

    resetWaterfallCleared: (state) => {
      state.isWaterfallCleared = false;
    },

    leaveVisualizer: (state) => {
      state.visualizerPaused = true;
    },

    setShowSpikeOverlay: (state, action: PayloadAction<boolean>) => {
      state.showSpikeOverlay = action.payload;
      if (!action.payload) {
        state.gpuSpikeCount = 0;
      }
    },

    setGpuSpikeCount: (state, action: PayloadAction<number>) => {
      state.gpuSpikeCount = Math.max(0, Math.floor(action.payload));
    },

    setShowTxSlider: (state, action: PayloadAction<boolean>) => {
      state.showTxSlider = action.payload;
    },

    // Diagnostic state
    setDiagnosticStatus: (state, action: PayloadAction<string>) => {
      state.diagnosticStatus = action.payload;
    },

    setDiagnosticRunning: (state, action: PayloadAction<boolean>) => {
      state.isDiagnosticRunning = action.payload;
    },

    triggerDiagnostic: (state) => {
      state.diagnosticTrigger += 1;
    },

    setPreviewRange: (state, action: PayloadAction<FrequencyRange | null>) => {
      state.previewRange = action.payload;
    },

    setPreviewAlignment: (state, action: PayloadAction<Alignment>) => {
      state.previewAlignment = action.payload;
    },

    // Reset actions
    resetZoomAndDb: (state) => {
      const isDbm = state.powerScale === "dBm";
      state.vizZoom = 1;
      state.vizZoomFloor = 1;
      state.vizZoomFloorPan = 0;
      state.autoZoomStability = true;
      state.vizPanOffset = 0;
      // dBm reset: 30dBm to -100dBm
      // dB reset: 0dB to -120dB
      state.fftMinDb = isDbm ? -100 : -120;
      state.fftMaxDb = isDbm ? 30 : 0;
    },

    resetLiveControls: (
      state,
      action: PayloadAction<{ fftSize?: number; fftFrameRate?: number }>,
    ) => {
      const isDbm = state.powerScale === "dBm";
      return {
        ...state,
        displayTemporalResolution:
          LIVE_CONTROL_DEFAULTS.displayTemporalResolution,
        vizZoom: LIVE_CONTROL_DEFAULTS.vizZoom,
        vizZoomFloor: LIVE_CONTROL_DEFAULTS.vizZoomFloor,
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
        fftSize: action.payload.fftSize ?? state.fftSize,
        fftFrameRate: action.payload.fftFrameRate ?? state.fftFrameRate,
      };
    },
  },
});

export const {
  setActiveSignalArea,
  setFrequencyRange,
  setSignalAreaAndRange,
  mergeLastKnownRanges,
  setTemporalResolution,
  setPowerScale,
  setVizZoom,
  setVizZoomFloor,
  setVizZoomFloorPan,
  setAutoZoomStability,
  setVizPan,
  setDisplayMode,
  setFftDbLimits,
  setFftSize,
  setFftSizeOptions,
  setFftWindow,
  setFftFrameRate,
  setFftAvgEnabled,
  setFftSmoothEnabled,
  setWfSmoothEnabled,
  setTxSignal,
  setTxSampleRateHz,
  setTxCenterFrequencyHz,
  setDeviceKind,
  setTxPowerDbm,
  setTxVgaGain,
  setTxSafetyEnabled,
  setTxSafetyLimit,
  setTxHopType,
  setTxHopStartFrequencyHz,
  setTxHopEndFrequencyHz,
  setTxHopChannels,
  setTxHopRateHz,
  setTxHopEnabled,
  setGain,
  setHackrfLnaGain,
  setHackrfVgaGain,
  setHackrfAmpEnabled,
  setPpm,
  setTunerAGC,
  setRtlAGC,
  setSampleRate,
  setSdrSettingsBundle,
  setVisualizerPaused,
  clearWaterfall,
  resetWaterfallCleared,
  leaveVisualizer,
  setDiagnosticStatus,
  setDiagnosticRunning,
  triggerDiagnostic,
  resetZoomAndDb,
  resetLiveControls,
  setShowSpikeOverlay,
  setGpuSpikeCount,
  setPreviewRange,
  setPreviewAlignment,
  setShowTxSlider,
} = spectrumSlice.actions;

export default spectrumSlice.reducer;
