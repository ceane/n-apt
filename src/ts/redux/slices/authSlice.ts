import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  getAuthTransition,
  reduxAuthPolicy,
  type AuthenticationState,
} from "@n-apt/app/auth/authTransitions";

export type {
  AuthState,
  AuthenticationState as AuthSliceState,
} from "@n-apt/app/auth/authTransitions";

const initialState: AuthenticationState = {
  authState: "connecting",
  isAuthenticated: false,
  authError: null,
  sessionToken: null,
  aesKey: null,
  hasPasskeys: false,
  isInitialAuthCheck: true,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    // Authentication flow
    setAuthenticating: (state) => {
      Object.assign(
        state,
        getAuthTransition({ type: "AUTHENTICATING" }, reduxAuthPolicy),
      );
    },

    setAuthSuccess: (
      state,
      action: PayloadAction<{ sessionToken: string; aesKey: CryptoKey }>,
    ) => {
      Object.assign(
        state,
        getAuthTransition(
          { type: "AUTH_SUCCESS", ...action.payload },
          reduxAuthPolicy,
        ),
      );
    },

    setAuthFailed: (state, action: PayloadAction<string>) => {
      Object.assign(
        state,
        getAuthTransition(
          { type: "AUTH_FAILED", error: action.payload },
          reduxAuthPolicy,
        ),
      );
    },

    setAuthReady: (state, action: PayloadAction<{ hasPasskeys?: boolean }>) => {
      Object.assign(
        state,
        getAuthTransition({ type: "READY", ...action.payload }, reduxAuthPolicy),
      );
    },

    // Passkey management
    setHasPasskeys: (state, action: PayloadAction<boolean>) => {
      Object.assign(
        state,
        getAuthTransition(
          { type: "SET_PASSKEYS", hasPasskeys: action.payload },
          reduxAuthPolicy,
        ),
      );
    },

    setPasskeyRegistrationSuccess: (
      state,
      action: PayloadAction<boolean>,
    ) => {
      Object.assign(
        state,
        getAuthTransition(
          { type: "REGISTER_SUCCESS", hasPasskeys: action.payload },
          reduxAuthPolicy,
        ),
      );
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
