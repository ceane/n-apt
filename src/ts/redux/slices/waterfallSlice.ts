import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type SourceMode = "live" | "file";
export type SelectedFile = { name: string; file: File; downloadUrl?: string };
export type TrainingLabel = "target" | "noise";
export type ActivePlaybackMetadata = {
  activeChannel: number;
  channelCount: number;
  center_frequency_hz?: number;
  capture_sample_rate_hz?: number;
  frame_rate?: number;
  hardware_sample_rate_hz?: number;
  frequency_range?: [number, number];
};

export interface BeatParams {
  offsetHz: number;
}

export interface DrawParams {
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
}

export interface WaterfallState {
  // File and source management
  sourceMode: SourceMode;
  selectedFiles: SelectedFile[];
  snapshotGridPreference: boolean;
  
  // Draw signal parameters
  drawParams: DrawParams[];
  activeClumpIndex: number;
  globalNoiseFloor: number; // Unit: dB
  
  // Stitching and processing
  stitchStatus: string;
  stitchTrigger: number;
  stitchSourceSettings: { gain: number; ppm: number };
  isStitchPaused: boolean;
  activePlaybackMetadata: ActivePlaybackMetadata | null;
  
  // Training capture
  isTrainingCapturing: boolean;
  trainingCaptureLabel: TrainingLabel | null;
  trainingCapturedSamples: number;
  
  // Visualization options
  drawSignal3D: boolean;
  isWaterfallCleared: boolean;
}

const INITIAL_DRAW_PARAMS: DrawParams = {
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
};

const initialState: WaterfallState = {
  sourceMode: "live",
  selectedFiles: [],
  snapshotGridPreference: true,
  
  drawParams: [INITIAL_DRAW_PARAMS],
  activeClumpIndex: 0,
  globalNoiseFloor: -100, // Default changed to -100dB
  
  stitchStatus: "",
  stitchTrigger: 0,
  stitchSourceSettings: { gain: 10, ppm: 0 },
  isStitchPaused: false,
  activePlaybackMetadata: null,
  
  isTrainingCapturing: false,
  trainingCaptureLabel: null,
  trainingCapturedSamples: 0,
  
  drawSignal3D: false,
  isWaterfallCleared: false,
};

const waterfallSlice = createSlice({
  name: 'waterfall',
  initialState,
  reducers: {
    // Source and file management
    setSourceMode: (state, action: PayloadAction<SourceMode>) => {
      // When switching away from file mode, reset processing state but keep files
      if (state.sourceMode === "file" && action.payload !== "file") {
        state.sourceMode = action.payload;
        state.stitchStatus = "";
        state.isStitchPaused = true;
        // Keep selectedFiles so they're still there when returning
      } else {
        state.sourceMode = action.payload;
      }
    },
    
    setSelectedFiles: (state, action: PayloadAction<SelectedFile[]>) => {
      state.selectedFiles = action.payload;
      state.activePlaybackMetadata = null;
    },
    
    setSnapshotGrid: (state, action: PayloadAction<boolean>) => {
      state.snapshotGridPreference = action.payload;
    },
    
    // Draw parameters
    setDrawParams: (state, action: PayloadAction<DrawParams[]>) => {
      state.drawParams = action.payload;
    },
    
    setClumpParams: (state, action: PayloadAction<{ index: number; params: DrawParams }>) => {
      const newParams = [...state.drawParams];
      newParams[action.payload.index] = action.payload.params;
      state.drawParams = newParams;
    },
    
    setActiveClumpIndex: (state, action: PayloadAction<number>) => {
      state.activeClumpIndex = action.payload;
    },
    
    setGlobalNoiseFloor: (state, action: PayloadAction<number>) => {
      state.globalNoiseFloor = action.payload;
    },
    
    // Stitching and processing
    setStitchStatus: (state, action: PayloadAction<string>) => {
      state.stitchStatus = action.payload;
    },
    
    triggerStitch: (state) => {
      state.isStitchPaused = true;
      state.stitchStatus = "";
      state.stitchTrigger += 1;
    },
    
    toggleStitchPause: (state) => {
      state.isStitchPaused = !state.isStitchPaused;
    },
    
    setStitchSourceSettings: (state, action: PayloadAction<{ gain: number; ppm: number }>) => {
      state.stitchSourceSettings = action.payload;
    },
    
    setStitchPaused: (state, action: PayloadAction<boolean>) => {
      state.isStitchPaused = action.payload;
    },

    setActivePlaybackMetadata: (state, action: PayloadAction<ActivePlaybackMetadata>) => {
      state.activePlaybackMetadata = action.payload;
    },

    clearActivePlaybackMetadata: (state) => {
      state.activePlaybackMetadata = null;
    },
    
    // Training capture
    startTrainingCapture: (state, action: PayloadAction<TrainingLabel>) => {
      state.isTrainingCapturing = true;
      state.trainingCaptureLabel = action.payload;
    },
    
    stopTrainingCapture: (state) => {
      state.isTrainingCapturing = false;
      state.trainingCaptureLabel = null;
      state.trainingCapturedSamples += 1;
    },
    
    // Visualization options
    setDrawSignal3D: (state, action: PayloadAction<boolean>) => {
      state.drawSignal3D = action.payload;
    },
    
    clearWaterfall: (state) => {
      state.isWaterfallCleared = true;
    },
    
    resetWaterfallCleared: (state) => {
      state.isWaterfallCleared = false;
    },
    
    // Reset actions
    resetDrawParams: (state) => {
      state.drawParams = [INITIAL_DRAW_PARAMS];
      state.globalNoiseFloor = -100;
      state.activeClumpIndex = 0;
    },
    
    resetTrainingCapture: (state) => {
      state.isTrainingCapturing = false;
      state.trainingCaptureLabel = null;
      state.trainingCapturedSamples = 0;
    },
  },
});

export const {
  setSourceMode,
  setSelectedFiles,
  setSnapshotGrid,
  setDrawParams,
  setClumpParams,
  setActiveClumpIndex,
  setGlobalNoiseFloor,
  setStitchStatus,
  triggerStitch,
  toggleStitchPause,
  setStitchSourceSettings,
  setStitchPaused,
  setActivePlaybackMetadata,
  clearActivePlaybackMetadata,
  startTrainingCapture,
  stopTrainingCapture,
  setDrawSignal3D,
  clearWaterfall,
  resetWaterfallCleared,
  resetDrawParams,
  resetTrainingCapture,
} = waterfallSlice.actions;

export default waterfallSlice.reducer;
