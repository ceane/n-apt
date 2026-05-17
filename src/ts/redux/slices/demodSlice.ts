import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface DemodState {
  sourceMode: "live" | "file";
  sourceRange: { min: number; max: number } | null;
  sourceRangeReason: string | null;
  spanRange: { min: number; max: number } | null;
  hardwareRange: { min: number; max: number } | null;
  sampleRateHz: number | null;
  algorithm: "fm" | "apt" | "napt";
  bandwidthKhz: number;
  centerFreqHz: number | null;
  bandwidthCenterFreqHz: number | null;
  isListening: boolean;
  
  hardwareSpanHz: number;
  bandwidthHz: number;
  bandwidthStartHz: number;
  alignment: "centered" | "start" | "end";
}

const initialState: DemodState = {
  sourceMode: "live",
  sourceRange: null,
  sourceRangeReason: null,
  spanRange: null,
  hardwareRange: null,
  sampleRateHz: null,
  algorithm: "fm",
  bandwidthKhz: 200,
  centerFreqHz: null,
  bandwidthCenterFreqHz: null,
  isListening: false,

  hardwareSpanHz: 3_200_000,
  bandwidthHz: 500_000,
  bandwidthStartHz: 25_750_000,
  alignment: "centered",
};

const demodSlice = createSlice({
  name: "demod",
  initialState,
  reducers: {
    setHardwareInfo: (
      state,
      action: PayloadAction<{
        range: { min: number; max: number };
        sampleRate: number;
      }>,
    ) => {
      state.hardwareRange = action.payload.range;
      state.sampleRateHz = action.payload.sampleRate;
    },
    setSourceContext: (
      state,
      action: PayloadAction<{
        sourceMode: "live" | "file";
        range: { min: number; max: number } | null;
        reason: string | null;
      }>,
    ) => {
      state.sourceMode = action.payload.sourceMode;
      state.sourceRange = action.payload.range;
      state.sourceRangeReason = action.payload.reason;
    },
    setSpanRange: (
      state,
      action: PayloadAction<{ min: number; max: number }>,
    ) => {
      state.spanRange = action.payload;
    },
    setAlgorithm: (state, action: PayloadAction<"fm" | "apt" | "napt">) => {
      state.algorithm = action.payload;
    },
    setBandwidth: (state, action: PayloadAction<number>) => {
      state.bandwidthKhz = action.payload;
    },
    setCenterFreq: (state, action: PayloadAction<number>) => {
      state.centerFreqHz = action.payload;
    },
    setBandwidthCenterFreq: (state, action: PayloadAction<number>) => {
      state.bandwidthCenterFreqHz = action.payload;
    },
    setListening: (state, action: PayloadAction<boolean>) => {
      state.isListening = action.payload;
    },
    setHardwareSpanHz: (state, action: PayloadAction<number>) => {
      state.hardwareSpanHz = action.payload;
    },
    setBandwidthHz: (state, action: PayloadAction<number>) => {
      state.bandwidthHz = action.payload;
    },
    setBandwidthStartHz: (state, action: PayloadAction<number>) => {
      state.bandwidthStartHz = action.payload;
    },
    setAlignment: (state, action: PayloadAction<"centered" | "start" | "end">) => {
      state.alignment = action.payload;
    },
  },
});

export const {
  setHardwareInfo,
  setSourceContext,
  setSpanRange,
  setAlgorithm,
  setBandwidth,
  setCenterFreq,
  setBandwidthCenterFreq,
  setListening,
  setHardwareSpanHz,
  setBandwidthHz,
  setBandwidthStartHz,
  setAlignment,
} = demodSlice.actions;

export default demodSlice.reducer;
