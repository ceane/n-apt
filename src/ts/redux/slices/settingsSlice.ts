import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface SettingsState {
  // App preferences
  snapshotGridPreference: boolean;
  
  // Diagnostic state
  diagnosticStatus: string;
  isDiagnosticRunning: boolean;
  diagnosticTrigger: number;
  
  // Device info (cached from WebSocket)
  deviceName: string | null;
  deviceProfile: any | null;
  cryptoCorrupted: boolean;
}

const initialState: SettingsState = {
  snapshotGridPreference: true,
  
  diagnosticStatus: "Ready",
  isDiagnosticRunning: false,
  diagnosticTrigger: 0,
  
  deviceName: null,
  deviceProfile: null,
  cryptoCorrupted: false,
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setSnapshotGrid: (state, action: PayloadAction<boolean>) => {
      state.snapshotGridPreference = action.payload;
    },
    
    setDiagnosticStatus: (state, action: PayloadAction<string>) => {
      state.diagnosticStatus = action.payload;
    },
    
    setDiagnosticRunning: (state, action: PayloadAction<boolean>) => {
      state.isDiagnosticRunning = action.payload;
    },
    
    triggerDiagnostic: (state) => {
      state.diagnosticTrigger += 1;
    },
    
    setDeviceInfo: (state, action: PayloadAction<{ deviceName: string | null; deviceProfile: any | null }>) => {
      state.deviceName = action.payload.deviceName;
      state.deviceProfile = action.payload.deviceProfile;
    },
    
    setCryptoCorrupted: (state, action: PayloadAction<boolean>) => {
      state.cryptoCorrupted = action.payload;
    },
    
    resetSettings: (state) => {
      Object.assign(state, initialState);
    },
  },
});

export const {
  setSnapshotGrid,
  setDiagnosticStatus,
  setDiagnosticRunning,
  triggerDiagnostic,
  setDeviceInfo,
  setCryptoCorrupted,
  resetSettings,
} = settingsSlice.actions;

export default settingsSlice.reducer;
