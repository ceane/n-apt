export type AuthState =
  | "connecting"
  | "server_down"
  | "authenticating"
  | "ready"
  | "failed";

export interface AuthenticationState {
  authState: AuthState;
  isAuthenticated: boolean;
  authError: string | null;
  sessionToken: string | null;
  aesKey: CryptoKey | null;
  hasPasskeys: boolean;
  isInitialAuthCheck: boolean;
}

export type AuthAction =
  | { type: "AUTHENTICATING" }
  | { type: "AUTH_SUCCESS"; sessionToken: string; aesKey: CryptoKey }
  | { type: "AUTH_FAILED"; error: string }
  | { type: "SERVER_DOWN" }
  | { type: "READY"; hasPasskeys?: boolean }
  | { type: "SET_PASSKEYS"; hasPasskeys: boolean }
  | { type: "REGISTER_SUCCESS"; hasPasskeys: boolean };

interface AuthTransitionPolicy {
  successError: "preserve" | "clear";
  failureSession: "preserve" | "clear";
}

export const contextAuthPolicy: AuthTransitionPolicy = {
  successError: "preserve",
  failureSession: "preserve",
};

export const reduxAuthPolicy: AuthTransitionPolicy = {
  successError: "clear",
  failureSession: "clear",
};

export function getAuthTransition(
  action: AuthAction,
  policy: AuthTransitionPolicy,
): Partial<AuthenticationState> {
  switch (action.type) {
    case "AUTHENTICATING":
      return { authState: "authenticating", authError: null };
    case "AUTH_SUCCESS":
      return {
        sessionToken: action.sessionToken,
        aesKey: action.aesKey,
        isAuthenticated: true,
        authState: "ready",
        isInitialAuthCheck: false,
        ...(policy.successError === "clear" && { authError: null }),
      };
    case "AUTH_FAILED":
      return {
        authState: "failed",
        authError: action.error,
        ...(policy.failureSession === "clear" && {
          isAuthenticated: false,
          sessionToken: null,
          aesKey: null,
        }),
      };
    case "SERVER_DOWN":
      return {
        authState: "server_down",
        authError: "Server is down",
        isInitialAuthCheck: false,
      };
    case "READY":
      return {
        authState: "ready",
        isInitialAuthCheck: false,
        ...(action.hasPasskeys !== undefined && {
          hasPasskeys: action.hasPasskeys,
        }),
      };
    case "SET_PASSKEYS":
      return { hasPasskeys: action.hasPasskeys };
    case "REGISTER_SUCCESS":
      return { hasPasskeys: action.hasPasskeys, authState: "ready" };
  }
}
