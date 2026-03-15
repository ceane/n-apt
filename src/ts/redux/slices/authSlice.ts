import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type AuthState = "connecting" | "authenticating" | "ready" | "failed";

export interface AuthSliceState {
  authState: AuthState;
  isAuthenticated: boolean;
  authError: string | null;
  sessionToken: string | null;
  aesKey: CryptoKey | null;
  hasPasskeys: boolean;
  isInitialAuthCheck: boolean;
}

const initialState: AuthSliceState = {
  authState: "connecting",
  isAuthenticated: false,
  authError: null,
  sessionToken: null,
  aesKey: null,
  hasPasskeys: false,
  isInitialAuthCheck: true,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // Authentication flow
    setAuthenticating: (state) => {
      state.authState = "authenticating";
      state.authError = null;
    },
    
    setAuthSuccess: (state, action: PayloadAction<{ sessionToken: string; aesKey: CryptoKey }>) => {
      state.sessionToken = action.payload.sessionToken;
      state.aesKey = action.payload.aesKey;
      state.isAuthenticated = true;
      state.authState = "ready";
      state.isInitialAuthCheck = false;
      state.authError = null;
    },
    
    setAuthFailed: (state, action: PayloadAction<string>) => {
      state.authState = "failed";
      state.authError = action.payload;
      state.isAuthenticated = false;
      state.sessionToken = null;
      state.aesKey = null;
    },
    
    setAuthReady: (state, action: PayloadAction<{ hasPasskeys?: boolean }>) => {
      state.authState = "ready";
      state.isInitialAuthCheck = false;
      if (action.payload.hasPasskeys !== undefined) {
        state.hasPasskeys = action.payload.hasPasskeys;
      }
    },
    
    // Passkey management
    setHasPasskeys: (state, action: PayloadAction<boolean>) => {
      state.hasPasskeys = action.payload;
    },
    
    setPasskeyRegistrationSuccess: (state, action: PayloadAction<boolean>) => {
      state.hasPasskeys = action.payload;
      state.authState = "ready";
    },
    
    // Session management
    clearSession: (state) => {
      state.sessionToken = null;
      state.aesKey = null;
      state.isAuthenticated = false;
      state.authState = "ready";
      state.authError = null;
    },
    
    // Reset to initial state
    resetAuth: (state) => {
      Object.assign(state, initialState);
    },
    
    // Set initial auth check flag
    setInitialAuthCheckComplete: (state) => {
      state.isInitialAuthCheck = false;
    },
  },
});

export const {
  setAuthenticating,
  setAuthSuccess,
  setAuthFailed,
  setAuthReady,
  setHasPasskeys,
  setPasskeyRegistrationSuccess,
  clearSession,
  resetAuth,
  setInitialAuthCheckComplete,
} = authSlice.actions;

export default authSlice.reducer;
