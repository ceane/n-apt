import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface DemodState {
  spanRange: { min: number; max: number } | null;
  hardwareRange: { min: number; max: number } | null;
  sampleRateHz: number | null;
  algorithm: 'fm' | 'apt';
  bandwidthKhz: number;
  centerFreqMHz: number | null;
  isListening: boolean;
}

const initialState: DemodState = {
  spanRange: null,
  hardwareRange: null,
  sampleRateHz: null,
  algorithm: 'fm',
  bandwidthKhz: 200,
  centerFreqMHz: null,
  isListening: false,
};

const demodSlice = createSlice({
  name: 'demod',
  initialState,
  reducers: {
    setHardwareInfo: (
      state,
      action: PayloadAction<{ range: { min: number; max: number }; sampleRate: number }>,
    ) => {
      state.hardwareRange = action.payload.range;
      state.sampleRateHz = action.payload.sampleRate;
    },
    setSpanRange: (state, action: PayloadAction<{ min: number; max: number }>) => {
      state.spanRange = action.payload;
    },
    setAlgorithm: (state, action: PayloadAction<'fm' | 'apt'>) => {
      state.algorithm = action.payload;
    },
    setBandwidth: (state, action: PayloadAction<number>) => {
      state.bandwidthKhz = action.payload;
    },
    setCenterFreq: (state, action: PayloadAction<number>) => {
      state.centerFreqMHz = action.payload;
    },
    setListening: (state, action: PayloadAction<boolean>) => {
      state.isListening = action.payload;
    },
  },
});

export const {
  setHardwareInfo,
  setSpanRange,
  setAlgorithm,
  setBandwidth,
  setCenterFreq,
  setListening,
} = demodSlice.actions;

export default demodSlice.reducer;
