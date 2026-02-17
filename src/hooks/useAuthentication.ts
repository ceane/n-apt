import { useState, useEffect, useCallback } from "react";
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

export const useAuthentication = (): UseAuthenticationReturn => {
  const [authState, setAuthState] = useState<AuthState>("connecting");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [aesKey, setAesKey] = useState<CryptoKey | null>(null);
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [isInitialAuthCheck, setIsInitialAuthCheck] = useState(true);

  // On mount: check for stored session, fetch auth info
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
            setHasPasskeys(info.has_passkeys);
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
      setAuthState("connecting");

      // Check for existing session first (fast path)
      const storedToken = getStoredSession();
      if (storedToken) {
        try {
          // Try to validate session immediately (no backend wait)
          const result = await validateSession(storedToken);
          if (!cancelled && result.valid) {
            setSessionToken(storedToken);
            // Derive AES key for decryption (uses default key for restored sessions)
            const key = await deriveAesKey("n-apt-dev-key");
            setAesKey(key);
            // Set authenticated state first, then auth state to prevent flashing
            setIsAuthenticated(true);
            setAuthState("ready"); // Set to ready instead of success to prevent prompt flash
            setIsInitialAuthCheck(false);
            return;
          }
        } catch (error) {
          // Session invalid, clear it and continue to auth info fetch
          console.warn("Session validation failed:", error);
          clearSession();
        }
      }

      // No valid session - fetch auth info (are passkeys registered?)
      try {
        const info = await fetchAuthInfoWithTimeout();
        if (!cancelled) {
          setHasPasskeys(info.has_passkeys);
          setAuthState("ready");
          setIsInitialAuthCheck(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Backend unavailable, showing auth prompt:", error);
          setAuthState("ready");
          setIsInitialAuthCheck(false);
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

  // Auth handlers
  const handlePasswordAuth = useCallback(async (password: string) => {
    setAuthState("authenticating");
    setAuthError(null);
    try {
      const result = await authenticateWithPassword(password);
      setSessionToken(result.token);
      // Derive AES key from the password for decryption
      const key = await deriveAesKey(password);
      setAesKey(key);
      setIsAuthenticated(true);
      setAuthState("ready"); // Set to ready instead of success to prevent prompt flash
      setIsInitialAuthCheck(false);
    } catch (e: any) {
      setAuthState("failed");
      setAuthError(e.message || "Authentication failed");
    }
  }, []);

  const handlePasskeyAuth = useCallback(async () => {
    setAuthState("authenticating");
    setAuthError(null);
    try {
      const result = await authenticateWithPasskey();
      setSessionToken(result.token);
      // For passkey auth, derive AES key from the default passkey
      // (server uses the same key for all sessions)
      const key = await deriveAesKey("n-apt-dev-key");
      setAesKey(key);
      setIsAuthenticated(true);
      setAuthState("ready"); // Set to ready instead of success to prevent prompt flash
      setIsInitialAuthCheck(false);
    } catch (e: any) {
      setAuthState("failed");
      setAuthError(e.message || "Passkey authentication failed");
    }
  }, []);

  const handleRegisterPasskey = useCallback(async () => {
    try {
      setAuthState("authenticating");
      await registerPasskey();
      // Refresh auth info to get updated hasPasskeys
      const info = await fetchAuthInfo();
      setHasPasskeys(info.has_passkeys);
      setAuthState("ready");
    } catch (e: any) {
      setAuthState("failed");
      setAuthError(e.message || "Passkey registration failed");
    }
  }, []);

  return {
    authState,
    isAuthenticated,
    authError,
    sessionToken,
    aesKey,
    hasPasskeys,
    isInitialAuthCheck,
    handlePasswordAuth,
    handlePasskeyAuth,
    handleRegisterPasskey,
  };
};
