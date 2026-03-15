import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { FrequencyRange } from '@n-apt/consts/schemas/websocket';

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
  vizPanOffset: number;
  
  // FFT settings
  fftMinDb: number;
  fftMaxDb: number;
  fftSize: number;
  fftSizeOptions: number[];
  fftWindow: string;
  fftFrameRate: number;
  isAutoFftApplied: boolean;
  fftAvgEnabled: boolean;
  fftSmoothEnabled: boolean;
  wfSmoothEnabled: boolean;
  
  // SDR settings
  gain: number;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  sampleRateHz: number;
  
  // Visualization state
  visualizerPaused: boolean;
  isWaterfallCleared: boolean;
  
  // Diagnostic state
  diagnosticStatus: string;
  isDiagnosticRunning: boolean;
  diagnosticTrigger: number;
}

const LIVE_CONTROL_DEFAULTS = {
  displayTemporalResolution: "medium" as const,
  powerScale: "dB" as const,
  vizZoom: 1,
  vizPanOffset: 0,
  fftMinDb: -120,
  fftMaxDb: 0,
  fftSizeOptions: [] as number[],
  fftWindow: "Rectangular",
  fftAvgEnabled: false,
  fftSmoothEnabled: false,
  wfSmoothEnabled: false,
  gain: 49.6,
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
  vizPanOffset: 0,
  
  fftMinDb: -120,
  fftMaxDb: 0,
  fftSize: 32768,
  fftSizeOptions: [],
  fftWindow: "Rectangular",
  fftFrameRate: 60,
  isAutoFftApplied: false,
  fftAvgEnabled: false,
  fftSmoothEnabled: false,
  wfSmoothEnabled: false,
  
  gain: 10,
  ppm: 0,
  tunerAGC: false,
  rtlAGC: false,
  sampleRateHz: 3_200_000,
  
  visualizerPaused: false,
  isWaterfallCleared: false,
  
  diagnosticStatus: "Ready",
  isDiagnosticRunning: false,
  diagnosticTrigger: 0,
};

const spectrumSlice = createSlice({
  name: 'spectrum',
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
        state.lastKnownRanges[state.activeSignalArea] = action.payload;
      }
    },
    
    setSignalAreaAndRange: (state, action: PayloadAction<{ area: string; range: FrequencyRange }>) => {
      state.activeSignalArea = action.payload.area;
      state.frequencyRange = action.payload.range;
      state.lastKnownRanges[action.payload.area] = action.payload.range;
    },
    
    // Display settings
    setTemporalResolution: (state, action: PayloadAction<DisplayTemporalResolution>) => {
      state.displayTemporalResolution = action.payload;
    },
    
    setPowerScale: (state, action: PayloadAction<PowerScale>) => {
      const isSwitchingToDbm = action.payload === "dBm";
      
      // Auto-adjust dB limits when switching scales
      if (isSwitchingToDbm && state.powerScale !== "dBm") {
        state.fftMinDb = -100;
        state.fftMaxDb = 30;
      } else if (!isSwitchingToDbm && state.powerScale === "dBm") {
        state.fftMinDb = -120;
        state.fftMaxDb = 0;
      }
      
      state.powerScale = action.payload;
    },
    
    setVizZoom: (state, action: PayloadAction<number>) => {
      state.vizZoom = action.payload;
    },
    
    setVizPan: (state, action: PayloadAction<number>) => {
      state.vizPanOffset = action.payload;
    },
    
    // FFT settings
    setFftDbLimits: (state, action: PayloadAction<{ min: number; max: number }>) => {
      state.fftMinDb = Math.round(action.payload.min);
      state.fftMaxDb = Math.round(action.payload.max);
    },
    
    setFftSize: (state, action: PayloadAction<number>) => {
      state.fftSize = action.payload;
    },
    
    setFftSizeOptions: (state, action: PayloadAction<number[]>) => {
      state.fftSizeOptions = action.payload;
    },
    
    setFftWindow: (state, action: PayloadAction<string>) => {
      state.fftWindow = action.payload;
    },
    
    setFftFrameRate: (state, action: PayloadAction<number>) => {
      state.fftFrameRate = action.payload;
    },
    
    setAutoFftApplied: (state, action: PayloadAction<boolean>) => {
      state.isAutoFftApplied = action.payload;
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
    setGain: (state, action: PayloadAction<number>) => {
      state.gain = action.payload;
    },
    
    setPpm: (state, action: PayloadAction<number>) => {
      state.ppm = action.payload;
    },
    
    setTunerAGC: (state, action: PayloadAction<boolean>) => {
      state.tunerAGC = action.payload;
    },
    
    setRtlAGC: (state, action: PayloadAction<boolean>) => {
      state.rtlAGC = action.payload;
    },
    
    setSampleRate: (state, action: PayloadAction<number>) => {
      state.sampleRateHz = action.payload;
    },
    
    // Bundle updates for efficiency
    setSdrSettingsBundle: (state, action: PayloadAction<Partial<SpectrumState>>) => {
      Object.assign(state, action.payload);
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
    
    // Reset actions
    resetZoomAndDb: (state) => {
      const isDbm = state.powerScale === "dBm";
      state.vizZoom = 1;
      state.vizPanOffset = 0;
      state.fftMinDb = isDbm ? -100 : -120;
      state.fftMaxDb = isDbm ? 30 : 0;
    },
    
    resetLiveControls: (state, action: PayloadAction<{ fftSize?: number; fftFrameRate?: number }>) => {
      state.displayTemporalResolution = LIVE_CONTROL_DEFAULTS.displayTemporalResolution;
      state.powerScale = LIVE_CONTROL_DEFAULTS.powerScale;
      state.vizZoom = LIVE_CONTROL_DEFAULTS.vizZoom;
      state.vizPanOffset = LIVE_CONTROL_DEFAULTS.vizPanOffset;
      state.fftMinDb = LIVE_CONTROL_DEFAULTS.fftMinDb;
      state.fftMaxDb = LIVE_CONTROL_DEFAULTS.fftMaxDb;
      state.fftSize = action.payload.fftSize ?? state.fftSize;
      state.fftFrameRate = action.payload.fftFrameRate ?? state.fftFrameRate;
      state.fftWindow = LIVE_CONTROL_DEFAULTS.fftWindow;
      state.fftAvgEnabled = false;
      state.fftSmoothEnabled = false;
      state.wfSmoothEnabled = false;
      state.gain = LIVE_CONTROL_DEFAULTS.gain;
      state.ppm = LIVE_CONTROL_DEFAULTS.ppm;
      state.tunerAGC = LIVE_CONTROL_DEFAULTS.tunerAGC;
      state.rtlAGC = LIVE_CONTROL_DEFAULTS.rtlAGC;
    },
  },
});

export const {
  setActiveSignalArea,
  setFrequencyRange,
  setSignalAreaAndRange,
  setTemporalResolution,
  setPowerScale,
  setVizZoom,
  setVizPan,
  setFftDbLimits,
  setFftSize,
  setFftSizeOptions,
  setFftWindow,
  setFftFrameRate,
  setAutoFftApplied,
  setFftAvgEnabled,
  setFftSmoothEnabled,
  setWfSmoothEnabled,
  setGain,
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
} = spectrumSlice.actions;

export default spectrumSlice.reducer;
