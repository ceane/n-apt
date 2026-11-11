import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface SettingsState {
  // App preferences
  mirrorIqBasebandBelowZero: boolean;
  smootherWaterfall: boolean;
  waterfallHistoryFill: "accretive" | "immutable";

  // Device info (cached from WebSocket)
  deviceName: string | null;
  deviceProfile: any | null;
}

const initialState: SettingsState = {
  mirrorIqBasebandBelowZero: false,
  smootherWaterfall: false,
  waterfallHistoryFill: "accretive",

  deviceName: null,
  deviceProfile: null,
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    setMirrorIqBasebandBelowZero: (state, action: PayloadAction<boolean>) => {
      state.mirrorIqBasebandBelowZero = action.payload;
    },

    setSmootherWaterfall: (state, action: PayloadAction<boolean>) => {
      state.smootherWaterfall = action.payload;
    },
    setWaterfallHistoryFill: (
      state,
      action: PayloadAction<"accretive" | "immutable">,
    ) => {
      state.waterfallHistoryFill = action.payload;
    },

    setDeviceInfo: (
      state,
      action: PayloadAction<{
        deviceName: string | null;
        deviceProfile: any | null;
      }>,
    ) => {
      state.deviceName = action.payload.deviceName;
      state.deviceProfile = action.payload.deviceProfile;
    },

    resetSettings: (state) => {
      Object.assign(state, initialState);
    },
  },
});

export const {
  setMirrorIqBasebandBelowZero,
  setSmootherWaterfall,
  setWaterfallHistoryFill,
  setDeviceInfo,
  resetSettings,
} = settingsSlice.actions;

export default settingsSlice.reducer;
