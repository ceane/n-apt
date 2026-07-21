import React, {
  useMemo,
  useReducer,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
} from "react";
import type { AuthState } from "@n-apt/routes/AuthenticationRoute";
import {
  getStoredSession,
  validateSession,
  authenticateWithPassword,
  authenticateWithPasskey,
  registerPasskey,
  fetchAuthInfo,
  fetchServerStatus,
  fetchVaultKey,
  clearSession,
  type AuthInfo,
} from "@n-apt/services/auth";
import { importAesKey, base64ToBytes } from "@n-apt/crypto/webcrypto";

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
  logout: () => void;
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
  | { type: "SERVER_DOWN" }
  | { type: "READY"; hasPasskeys?: boolean }
  | { type: "SET_PASSKEYS"; hasPasskeys: boolean }
  | { type: "REGISTER_SUCCESS"; hasPasskeys: boolean };

const getInitialHasPasskeys = () => {
  try {
    return localStorage.getItem("n_apt_has_passkeys") === "true";
  } catch {
    // Safari private mode or localStorage blocked
    console.warn(
      "localStorage unavailable, assuming no passkeys (likely Safari private mode)",
    );
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
      console.log("AuthReducer: AUTH_SUCCESS. aesKey set?", !!action.aesKey);
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
    case "SERVER_DOWN":
      return {
        ...state,
        authState: "server_down",
        authError: "Server is down",
        isInitialAuthCheck: false,
      };
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
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatActiveRef = useRef(false);

  const importBase64Key = useCallback(
    async (base64: string): Promise<CryptoKey> => {
      const bytes = base64ToBytes(base64);
      return importAesKey(bytes.buffer as ArrayBuffer);
    },
    [],
  );

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
      userAgent.includes("Cursor") ||
      (window.location.hostname === "localhost" &&
        window.location.port === "8080") ||
      window.location.search.includes("ide=true");

    // Check for Safari private mode
    const isSafariPrivateMode = (() => {
      try {
        localStorage.setItem("test", "test");
        localStorage.removeItem("test");
        return false;
      } catch {
        return true;
      }
    })();

    if (isLikelyIDEBrowser) {
      if (!hasLoggedWebAuthnIdeNoticeRef.current) {
        console.warn(
          "🔒 Passkeys disabled in IDE browser. Use password authentication for in-IDE browsing.",
        );
        hasLoggedWebAuthnIdeNoticeRef.current = true;
      }
      return false;
    }

    if (isSafariPrivateMode) {
      if (!hasLoggedWebAuthnIdeNoticeRef.current) {
        console.warn(
          "🔒 Passkeys disabled in Safari private mode. Use password authentication.",
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

    const stopHeartbeat = () => {
      heartbeatActiveRef.current = false;
      if (heartbeatTimerRef.current !== null) {
        clearTimeout(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };

    const startHeartbeat = () => {
      if (heartbeatActiveRef.current) return;
      heartbeatActiveRef.current = true;

      const tick = async () => {
        try {
          await fetchServerStatus();
          const info = await fetchAuthInfo();
          if (!cancelled) {
            const effectiveHasPasskeys =
              info.has_passkeys && isWebAuthnAvailable;
            try {
              localStorage.setItem(
                "n_apt_has_passkeys",
                effectiveHasPasskeys ? "true" : "false",
              );
            } catch {
              console.debug("localStorage unavailable for auth state");
            }
            dispatch({
              type: "READY",
              hasPasskeys: effectiveHasPasskeys,
            });
            stopHeartbeat();
            return;
          }
        } catch {
          if (!cancelled) {
            dispatch({ type: "SERVER_DOWN" });
          }
        }

        if (!cancelled) {
          heartbeatTimerRef.current = setTimeout(tick, 3000);
        }
      };

      void tick();
    };

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
            } catch {
              // Safari private mode - localStorage not available
              console.debug("localStorage unavailable for auth state");
            }
            dispatch({
              type: "SET_PASSKEYS",
              hasPasskeys: effectiveHasPasskeys,
            });
          }
        } catch {
          if (!cancelled) {
            console.debug("Auth info retry failed:");
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
              const vaultKeyB64 = await fetchVaultKey(storedToken);
              if (vaultKeyB64) {
                const key = await importBase64Key(vaultKeyB64);

                console.log(
                  "AuthInit: Setting session from storage. Key fetched?",
                  !!vaultKeyB64,
                );
                dispatch({
                  type: "AUTH_SUCCESS",
                  sessionToken: storedToken,
                  aesKey: key,
                });
                return;
              }
              throw new Error("Could not fetch vault key for session");
            } catch {
              console.warn("Stored session cannot be resumed securely:");
              clearSession();
            }
          }
        } catch {
          console.warn("Session validation failed:");
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
          } catch {
            // Safari private mode - localStorage not available
            console.debug("localStorage unavailable for session persistence");
          }
          dispatch({ type: "READY", hasPasskeys: effectiveHasPasskeys });
        }
      } catch {
        if (!cancelled) {
          console.warn("Backend unavailable, showing auth prompt:");
          dispatch({ type: "SERVER_DOWN" });
          startHeartbeat();
          scheduleAuthInfoRetry();
        }
      }
    };

    init();
    return () => {
      cancelled = true;
      stopHeartbeat();
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
      }
    };
  }, [isWebAuthnAvailable, skipBackendBootstrap]);

  const handlePasswordAuth = useCallback(async (password: string) => {
    dispatch({ type: "AUTHENTICATING" });
    try {
      const result = await authenticateWithPassword(password);
      const vaultKeyB64 = await fetchVaultKey(result.token);
      if (!vaultKeyB64) {
        throw new Error(
          "Password authentication succeeded but vault key retrieval failed.",
        );
      }
      const key = await importBase64Key(vaultKeyB64);

      dispatch({
        type: "AUTH_SUCCESS",
        sessionToken: result.token,
        aesKey: key,
      });
    } catch (e: any) {
      if (
        e?.message?.includes("Server disconnected") ||
        e?.message?.includes("Failed to start passkey authentication") ||
        e?.message?.includes("The app isn't running")
      ) {
        dispatch({ type: "SERVER_DOWN" });
        return;
      }
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
      const vaultKeyB64 = await fetchVaultKey(result.token);
      if (!vaultKeyB64) {
        throw new Error(
          "Passkey auth succeeded but vault key retrieval failed.",
        );
      }
      const key = await importBase64Key(vaultKeyB64);
      dispatch({
        type: "AUTH_SUCCESS",
        sessionToken: result.token,
        aesKey: key,
      });
    } catch (e: any) {
      const errorMessage = e.message || "Passkey authentication failed";
      if (
        errorMessage.includes("Server disconnected") ||
        errorMessage.includes("Failed to start passkey authentication") ||
        errorMessage.includes("The app isn't running")
      ) {
        dispatch({ type: "SERVER_DOWN" });
        return;
      }
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
      } catch {
        // Safari private mode - localStorage not available
        console.debug("localStorage unavailable for passkey state");
      }
      dispatch({ type: "REGISTER_SUCCESS", hasPasskeys: effectiveHasPasskeys });
    } catch (e: any) {
      dispatch({
        type: "AUTH_FAILED",
        error: e.message || "Passkey registration failed",
      });
    }
  }, [isWebAuthnAvailable]);

  const logout = useCallback(() => {
    const token = state.sessionToken;
    clearSession();
    dispatch({ type: "READY" });

    // Trigger backend logout to revoke token and clear site data.
    // We use window.location.href to ensure a full navigation, which is
    // required for Clear-Site-Data to be processed reliably and to
    // handle the server-side redirect back to the root.
    const logoutUrl = token
      ? `/auth/logout?token=${encodeURIComponent(token)}`
      : "/auth/logout";
    window.location.href = logoutUrl;
  }, [state.sessionToken]);

  return {
    ...state,
    handlePasswordAuth,
    handlePasskeyAuth,
    handleRegisterPasskey,
    logout,
  };
};
