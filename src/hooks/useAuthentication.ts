import React, { useReducer, useEffect, useCallback, createContext, useContext, useMemo } from "react";
import type { AuthState } from "@n-apt/components/AuthenticationPrompt";
import { deriveAesKey } from "@n-apt/crypto/webcrypto";
import {
  getStoredSession,
  validateSession,
  authenticateWithPassword,
  authenticateWithPasskey,
  registerPasskey,
  fetchAuthInfo,
  clearSession,
  type AuthInfo,
} from "@n-apt/services/auth";

interface UseAuthenticationReturn {
  authState: AuthState;
  isAuthenticated: boolean;
  authError: string | null;
  sessionToken: string | null;
  aesKey: CryptoKey | null;
  hasPasskeys: boolean;
  isInitialAuthCheck: boolean;
  handlePasswordAuth: (password: string) => Promise<void>;
  handlePasskeyAuth: () => Promise<void>;
  handleRegisterPasskey: () => Promise<void>;
}

interface AuthInternalState {
  authState: AuthState;
  isAuthenticated: boolean;
  authError: string | null;
  sessionToken: string | null;
  aesKey: CryptoKey | null;
  hasPasskeys: boolean;
  isInitialAuthCheck: boolean;
}

type AuthAction =
  | { type: "AUTHENTICATING" }
  | { type: "AUTH_SUCCESS"; sessionToken: string; aesKey: CryptoKey }
  | { type: "AUTH_FAILED"; error: string }
  | { type: "READY"; hasPasskeys?: boolean }
  | { type: "SET_PASSKEYS"; hasPasskeys: boolean }
  | { type: "REGISTER_SUCCESS"; hasPasskeys: boolean };

const initialState: AuthInternalState = {
  authState: "connecting",
  isAuthenticated: false,
  authError: null,
  sessionToken: null,
  aesKey: null,
  hasPasskeys: false,
  isInitialAuthCheck: true,
};

function authReducer(
  state: AuthInternalState,
  action: AuthAction
): AuthInternalState {
  switch (action.type) {
    case "AUTHENTICATING":
      return { ...state, authState: "authenticating", authError: null };
    case "AUTH_SUCCESS":
      return {
        ...state,
        sessionToken: action.sessionToken,
        aesKey: action.aesKey,
        isAuthenticated: true,
        authState: "ready",
        isInitialAuthCheck: false,
      };
    case "AUTH_FAILED":
      return { ...state, authState: "failed", authError: action.error };
    case "READY":
      return {
        ...state,
        authState: "ready",
        isInitialAuthCheck: false,
        ...(action.hasPasskeys !== undefined && {
          hasPasskeys: action.hasPasskeys,
        }),
      };
    case "SET_PASSKEYS":
      return { ...state, hasPasskeys: action.hasPasskeys };
    case "REGISTER_SUCCESS":
      return {
        ...state,
        hasPasskeys: action.hasPasskeys,
        authState: "ready",
      };
  }
}

const AuthContext = createContext<UseAuthenticationReturn | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuthenticationInternal();
  const value = useMemo(
    () => auth,
    [
      auth.authState,
      auth.isAuthenticated,
      auth.authError,
      auth.sessionToken,
      auth.aesKey,
      auth.hasPasskeys,
      auth.isInitialAuthCheck,
    ],
  );
  return React.createElement(AuthContext.Provider, { value }, children);
};

export const useAuthentication = (): UseAuthenticationReturn => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthentication must be used within an AuthProvider");
  }
  return context;
};

const useAuthenticationInternal = (): UseAuthenticationReturn => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const fetchAuthInfoWithTimeout = () =>
      new Promise<AuthInfo>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error("Backend timeout")), 3000);
        fetchAuthInfo()
          .then((info) => {
            clearTimeout(timeoutId);
            resolve(info);
          })
          .catch((err) => {
            clearTimeout(timeoutId);
            reject(err);
          });
      });

    const scheduleAuthInfoRetry = (attempt = 1) => {
      if (cancelled) return;
      const delay = Math.min(5000, 500 * 2 ** (attempt - 1));
      retryTimeout = setTimeout(async () => {
        retryTimeout = null;
        try {
          const info = await fetchAuthInfoWithTimeout();
          if (!cancelled) {
            dispatch({ type: "SET_PASSKEYS", hasPasskeys: info.has_passkeys });
          }
        } catch (error) {
          if (!cancelled) {
            console.debug("Auth info retry failed:", error);
            scheduleAuthInfoRetry(attempt + 1);
          }
        }
      }, delay);
    };

    const init = async () => {
      const storedToken = getStoredSession();
      if (storedToken) {
        try {
          const result = await validateSession(storedToken);
          if (!cancelled && result.valid) {
            const key = await deriveAesKey("n-apt-dev-key");
            dispatch({ type: "AUTH_SUCCESS", sessionToken: storedToken, aesKey: key });
            return;
          }
        } catch (error) {
          console.warn("Session validation failed:", error);
          clearSession();
        }
      }

      try {
        const info = await fetchAuthInfoWithTimeout();
        if (!cancelled) {
          dispatch({ type: "READY", hasPasskeys: info.has_passkeys });
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Backend unavailable, showing auth prompt:", error);
          dispatch({ type: "READY" });
          scheduleAuthInfoRetry();
        }
      }
    };

    init();
    return () => {
      cancelled = true;
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
      }
    };
  }, []);

  const handlePasswordAuth = useCallback(async (password: string) => {
    dispatch({ type: "AUTHENTICATING" });
    try {
      const result = await authenticateWithPassword(password);
      const key = await deriveAesKey(password);
      dispatch({ type: "AUTH_SUCCESS", sessionToken: result.token, aesKey: key });
    } catch (e: any) {
      dispatch({ type: "AUTH_FAILED", error: e.message || "Authentication failed" });
    }
  }, []);

  const handlePasskeyAuth = useCallback(async () => {
    dispatch({ type: "AUTHENTICATING" });
    try {
      const result = await authenticateWithPasskey();
      const key = await deriveAesKey("n-apt-dev-key");
      dispatch({ type: "AUTH_SUCCESS", sessionToken: result.token, aesKey: key });
    } catch (e: any) {
      dispatch({ type: "AUTH_FAILED", error: e.message || "Passkey authentication failed" });
    }
  }, []);

  const handleRegisterPasskey = useCallback(async () => {
    try {
      dispatch({ type: "AUTHENTICATING" });
      await registerPasskey();
      const info = await fetchAuthInfo();
      dispatch({ type: "REGISTER_SUCCESS", hasPasskeys: info.has_passkeys });
    } catch (e: any) {
      dispatch({ type: "AUTH_FAILED", error: e.message || "Passkey registration failed" });
    }
  }, []);

  return {
    ...state,
    handlePasswordAuth,
    handlePasskeyAuth,
    handleRegisterPasskey,
  };
};
