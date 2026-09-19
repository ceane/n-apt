import {
  getAuthTransition,
  contextAuthPolicy,
  reduxAuthPolicy,
  type AuthenticationState,
} from "@n-apt/app/auth/authTransitions";
import authReducer, {
  setAuthenticating,
  setAuthSuccess,
  setAuthFailed,
  setAuthReady,
  setHasPasskeys,
  setPasskeyRegistrationSuccess,
  clearSession,
  resetAuth,
  setInitialAuthCheckComplete,
} from "@n-apt/redux/slices/authSlice";

const aesKey = { type: "secret" } as CryptoKey;
const state: AuthenticationState = {
  authState: "failed",
  isAuthenticated: true,
  authError: "previous error",
  sessionToken: "test-session",
  aesKey,
  hasPasskeys: true,
  isInitialAuthCheck: true,
};

describe("shared auth transitions", () => {
  test.each([
    ["Context", contextAuthPolicy, "previous error"],
    ["Redux", reduxAuthPolicy, null],
  ])("%s success retains its error policy", (_name, policy, authError) => {
    const next = {
      ...state,
      ...getAuthTransition(
        { type: "AUTH_SUCCESS", sessionToken: "next-session", aesKey },
        policy,
      ),
    };
    expect(next).toEqual({
      ...state,
      authState: "ready",
      isInitialAuthCheck: false,
      sessionToken: "next-session",
      authError,
    });
    expect(state.authError).toBe("previous error");
  });

  test.each([
    ["Context", contextAuthPolicy, true],
    ["Redux", reduxAuthPolicy, false],
  ])("%s failure retains its session policy", (_name, policy, retained) => {
    expect({
      ...state,
      ...getAuthTransition({ type: "AUTH_FAILED", error: "failed" }, policy),
    }).toEqual({
      ...state,
      authError: "failed",
      isAuthenticated: retained,
      sessionToken: retained ? state.sessionToken : null,
      aesKey: retained ? aesKey : null,
    });
    expect(state.sessionToken).toBe("test-session");
  });

  test.each([contextAuthPolicy, reduxAuthPolicy])(
    "shared transitions only update their owned fields",
    (policy) => {
      expect(getAuthTransition({ type: "AUTHENTICATING" }, policy)).toEqual({
        authState: "authenticating",
        authError: null,
      });
      expect(getAuthTransition({ type: "SERVER_DOWN" }, policy)).toEqual({
        authState: "server_down",
        authError: "Server is down",
        isInitialAuthCheck: false,
      });
      expect(getAuthTransition({ type: "READY" }, policy)).toEqual({
        authState: "ready",
        isInitialAuthCheck: false,
      });
      expect(
        getAuthTransition({ type: "READY", hasPasskeys: false }, policy),
      ).toEqual({
        authState: "ready",
        isInitialAuthCheck: false,
        hasPasskeys: false,
      });
      expect(
        getAuthTransition({ type: "SET_PASSKEYS", hasPasskeys: false }, policy),
      ).toEqual({ hasPasskeys: false });
      expect(
        getAuthTransition({ type: "REGISTER_SUCCESS", hasPasskeys: true }, policy),
      ).toEqual({ authState: "ready", hasPasskeys: true });
    },
  );
});

describe("Redux auth compatibility", () => {
  test("success clears errors and failure clears credentials without ending the initial check", () => {
    expect(authReducer(state, setAuthSuccess({ sessionToken: "next-session", aesKey }))).toEqual({
      ...state,
      authState: "ready",
      authError: null,
      sessionToken: "next-session",
      isInitialAuthCheck: false,
    });
    expect(authReducer(state, setAuthFailed("failed"))).toEqual({
      ...state,
      authError: "failed",
      isAuthenticated: false,
      sessionToken: null,
      aesKey: null,
    });
  });

  test("existing action names and unrelated state fields are preserved", () => {
    expect(setHasPasskeys(false).type).toBe("auth/setHasPasskeys");
    expect(setPasskeyRegistrationSuccess(true).type).toBe("auth/setPasskeyRegistrationSuccess");
    expect(authReducer(state, setAuthenticating())).toEqual({
      ...state, authState: "authenticating", authError: null,
    });
    expect(authReducer(state, setAuthReady({}))).toEqual({
      ...state, authState: "ready", isInitialAuthCheck: false,
    });
    expect(authReducer(state, setAuthReady({ hasPasskeys: false })).hasPasskeys).toBe(false);
    expect(authReducer(state, setHasPasskeys(false))).toEqual({ ...state, hasPasskeys: false });
    expect(authReducer(state, setPasskeyRegistrationSuccess(false))).toEqual({
      ...state, authState: "ready", hasPasskeys: false,
    });
    expect(authReducer(state, clearSession())).toEqual({
      ...state, authState: "ready", authError: null,
      isAuthenticated: false, sessionToken: null, aesKey: null,
    });
    expect(authReducer(state, setInitialAuthCheckComplete())).toEqual({
      ...state, isInitialAuthCheck: false,
    });
    expect(authReducer(state, resetAuth())).toEqual(authReducer(undefined, { type: "init" }));
  });

  test("unchanged transitions preserve Redux state identity", () => {
    const ready = authReducer(state, setAuthReady({}));
    expect(authReducer(ready, setAuthReady({}))).toBe(ready);
    expect(authReducer(ready, setHasPasskeys(true))).toBe(ready);
  });
});
