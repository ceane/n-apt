import React, { useMemo, useReducer, useEffect, useCallback, useRef, createContext, useContext } from "react";
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

const getInitialHasPasskeys = () => {
  try {
    return localStorage.getItem("n_apt_has_passkeys") === "true";
  } catch (e) {
    return false;
  }
};

const initialState: AuthInternalState = {
  authState: "connecting",
  isAuthenticated: false,
  authError: null,
  sessionToken: null,
  aesKey: null,
  hasPasskeys: getInitialHasPasskeys(),
  isInitialAuthCheck: true,
};

function authReducer(
  state: AuthInternalState,
  action: AuthAction,
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

const AuthContext = createContext<UseAuthenticationReturn | undefined>(
  undefined,
);

export const AuthProvider: React.FC<{
  children: React.ReactNode;
  skipBackendBootstrap?: boolean;
}> = ({ children, skipBackendBootstrap = false }) => {
  const auth = useAuthenticationInternal(skipBackendBootstrap);
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

const useAuthenticationInternal = (
  skipBackendBootstrap = false,
): UseAuthenticationReturn => {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const hasLoggedWebAuthnIdeNoticeRef = useRef(false);

  const deriveConfiguredAesKey = useCallback(async (): Promise<CryptoKey> => {
    const configuredPassword = import.meta.env.VITE_UNSAFE_LOCAL_USER_PASSWORD;
    if (
      typeof configuredPassword !== "string" ||
      configuredPassword.trim().length === 0
    ) {
      throw new Error(
        "Missing VITE_UNSAFE_LOCAL_USER_PASSWORD; cannot derive the AES session key for encrypted WebSocket data.",
      );
    }
    return deriveAesKey(configuredPassword);
  }, []);

  // Check if WebAuthn is available in the browser
  const isWebAuthnAvailable = useMemo(() => {
    // Basic API availability check
    if (
      typeof window === "undefined" ||
      !window.navigator ||
      !window.navigator.credentials ||
      typeof window.navigator.credentials.get !== "function" ||
      typeof window.navigator.credentials.create !== "function"
    ) {
      return false;
    }

    // Conservative approach: disable WebAuthn in IDE/development environments
    // since they often don't support proper biometric prompts
    const userAgent = window.navigator.userAgent;
    const isLikelyIDEBrowser =
      userAgent.includes("Electron") ||
      userAgent.includes("Code") ||
      userAgent.includes("VSCode") ||
      userAgent.includes("Windsurf") ||
      (window.location.hostname === "localhost" &&
        window.location.port === "8080") ||
      window.location.search.includes("ide=true");

    if (isLikelyIDEBrowser) {
      if (!hasLoggedWebAuthnIdeNoticeRef.current) {
        console.warn(
          "🔒 Passkeys disabled in IDE browser. Use password authentication for in-IDE browsing.",
        );
        hasLoggedWebAuthnIdeNoticeRef.current = true;
      }
      return false;
    }

    // Do not invoke navigator.credentials.get here to avoid biometric prompts on load.
    return true;
  }, []);

  useEffect(() => {
    if (skipBackendBootstrap) {
      dispatch({ type: "READY", hasPasskeys: false });
      return;
    }

    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const fetchAuthInfoWithTimeout = () =>
      new Promise<AuthInfo>((resolve, reject) => {
        const timeoutId = setTimeout(
          () => reject(new Error("Backend timeout")),
          3000,
        );
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
            // Only show passkey option if both backend has passkeys AND browser supports WebAuthn
            const effectiveHasPasskeys =
              info.has_passkeys && isWebAuthnAvailable;
            try {
              localStorage.setItem(
                "n_apt_has_passkeys",
                effectiveHasPasskeys ? "true" : "false",
              );
            } catch (e) {}
            dispatch({
              type: "SET_PASSKEYS",
              hasPasskeys: effectiveHasPasskeys,
            });
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
            try {
              const key = await deriveConfiguredAesKey();
              dispatch({
                type: "AUTH_SUCCESS",
                sessionToken: storedToken,
                aesKey: key,
              });
              return;
            } catch (error) {
              console.warn("Stored session cannot be resumed securely:", error);
              clearSession();
            }
          }
        } catch (error) {
          console.warn("Session validation failed:", error);
          clearSession();
        }
      }

      try {
        const info = await fetchAuthInfoWithTimeout();
        if (!cancelled) {
          // Only show passkey option if both backend has passkeys AND browser supports WebAuthn
          const effectiveHasPasskeys = info.has_passkeys && isWebAuthnAvailable;
          try {
            localStorage.setItem(
              "n_apt_has_passkeys",
              effectiveHasPasskeys ? "true" : "false",
            );
          } catch (e) {}
          dispatch({ type: "READY", hasPasskeys: effectiveHasPasskeys });
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
  }, [deriveConfiguredAesKey, isWebAuthnAvailable, skipBackendBootstrap]);

  const handlePasswordAuth = useCallback(async (password: string) => {
    dispatch({ type: "AUTHENTICATING" });
    try {
      const result = await authenticateWithPassword(password);
      const key = await deriveAesKey(password);
      dispatch({
        type: "AUTH_SUCCESS",
        sessionToken: result.token,
        aesKey: key,
      });
    } catch (e: any) {
      dispatch({
        type: "AUTH_FAILED",
        error: e.message || "Authentication failed",
      });
    }
  }, []);

  const handlePasskeyAuth = useCallback(async () => {
    dispatch({ type: "AUTHENTICATING" });
    try {
      const result = await authenticateWithPasskey();
      const key = await deriveConfiguredAesKey();
      dispatch({
        type: "AUTH_SUCCESS",
        sessionToken: result.token,
        aesKey: key,
      });
    } catch (e: any) {
      const errorMessage = e.message || "Passkey authentication failed";
      if (
        errorMessage.includes("privacy-considerations-client") ||
        errorMessage.includes("not allowed")
      ) {
        dispatch({
          type: "AUTH_FAILED",
          error:
            "Passkeys are blocked in private browsing mode. Please use a password instead.",
        });
      } else {
        dispatch({ type: "AUTH_FAILED", error: errorMessage });
      }
    }
  }, []);

  const handleRegisterPasskey = useCallback(async () => {
    // Check if WebAuthn is available before attempting registration
    if (!isWebAuthnAvailable) {
      dispatch({
        type: "AUTH_FAILED",
        error: "Passkeys are not supported in this browser",
      });
      return;
    }

    try {
      dispatch({ type: "AUTHENTICATING" });
      await registerPasskey();
      const info = await fetchAuthInfo();
      // Only show passkey option if both backend has passkeys AND browser supports WebAuthn
      const effectiveHasPasskeys = info.has_passkeys && isWebAuthnAvailable;
      try {
        localStorage.setItem(
          "n_apt_has_passkeys",
          effectiveHasPasskeys ? "true" : "false",
        );
      } catch (e) {}
      dispatch({ type: "REGISTER_SUCCESS", hasPasskeys: effectiveHasPasskeys });
    } catch (e: any) {
      dispatch({
        type: "AUTH_FAILED",
        error: e.message || "Passkey registration failed",
      });
    }
  }, [isWebAuthnAvailable]);

  return {
    ...state,
    handlePasswordAuth,
    handlePasskeyAuth,
    handleRegisterPasskey,
  };
};
