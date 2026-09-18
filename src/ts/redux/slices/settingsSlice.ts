import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface SettingsState {
  // App preferences
  mirrorIqBasebandBelowZero: boolean;

  // Device info (cached from WebSocket)
  deviceName: string | null;
  deviceProfile: any | null;
}

const initialState: SettingsState = {
  mirrorIqBasebandBelowZero: false,

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
  setDeviceInfo,
  resetSettings,
} = settingsSlice.actions;

export default settingsSlice.reducer;
