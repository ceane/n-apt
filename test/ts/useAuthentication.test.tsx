import React from "react";
import { act, renderHook } from "@testing-library/react";
import { AuthProvider, useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import * as auth from "@n-apt/app/infrastructure/services/auth";
import { importAesKey, base64ToBytes } from "@n-apt/crypto/webcrypto";

jest.mock("@n-apt/app/infrastructure/services/auth");
jest.mock("@n-apt/crypto/webcrypto");

const service = jest.mocked(auth);
const aesKey = { type: "secret" } as CryptoKey;
const bytes = new Uint8Array([1, 2, 3]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mountAuth(skipBackendBootstrap = false) {
  return renderHook(() => useAuthentication(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <AuthProvider skipBackendBootstrap={skipBackendBootstrap}>
        {children}
      </AuthProvider>
    ),
  });
}

async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  jest.resetAllMocks();
  localStorage.clear();
  service.getStoredSession.mockReturnValue(null);
  service.fetchAuthInfo.mockResolvedValue({ has_passkeys: true });
  service.fetchVaultKey.mockResolvedValue("test-vault-key");
  service.authenticateWithPassword.mockResolvedValue({ token: "password-session", expires_in: 3600 });
  service.authenticateWithPasskey.mockResolvedValue({ token: "passkey-session", expires_in: 3600 });
  service.validateSession.mockResolvedValue({ valid: true });
  jest.mocked(base64ToBytes).mockReturnValue(bytes);
  jest.mocked(importAesKey).mockResolvedValue(aesKey);
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { get: jest.fn(), create: jest.fn() },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("Context auth compatibility", () => {
  test("bootstrap bypass stays unauthenticated without fetching or persisting", async () => {
    const { result } = mountAuth(true);
    await flush();
    expect(result.current).toMatchObject({
      authState: "ready", isAuthenticated: false, hasPasskeys: false,
      isInitialAuthCheck: false, sessionToken: null, aesKey: null,
    });
    expect(service.getStoredSession).not.toHaveBeenCalled();
    expect(service.fetchAuthInfo).not.toHaveBeenCalled();
    expect(localStorage.getItem("n_apt_has_passkeys")).toBeNull();
  });

  test("restores a stored session only after importing the vault key", async () => {
    const key = deferred<CryptoKey>();
    service.getStoredSession.mockReturnValue("stored-session");
    jest.mocked(importAesKey).mockReturnValue(key.promise);
    const { result } = mountAuth();
    await flush();
    expect(service.fetchVaultKey).toHaveBeenCalledWith("stored-session");
    expect(importAesKey).toHaveBeenCalledWith(bytes.buffer);
    expect(result.current.isAuthenticated).toBe(false);
    await act(async () => key.resolve(aesKey));
    expect(result.current).toMatchObject({
      authState: "ready", sessionToken: "stored-session", aesKey,
      isAuthenticated: true, isInitialAuthCheck: false,
    });
    expect(service.fetchAuthInfo).not.toHaveBeenCalled();
  });

  test.each(["missing", "fetch", "import"])(
    "stored vault %s failure clears storage before fetching prompt info",
    async (failure) => {
      service.getStoredSession.mockReturnValue("stored-session");
      if (failure === "missing") service.fetchVaultKey.mockResolvedValue(null);
      if (failure === "fetch") service.fetchVaultKey.mockRejectedValue(new Error("fetch failed"));
      if (failure === "import") jest.mocked(importAesKey).mockRejectedValue(new Error("import failed"));
      service.fetchAuthInfo.mockImplementation(async () => {
        expect(service.clearSession).toHaveBeenCalledTimes(1);
        return { has_passkeys: true };
      });
      const { result } = mountAuth();
      await flush();
      expect(result.current).toMatchObject({ authState: "ready", isAuthenticated: false, hasPasskeys: true });
    },
  );

  test("cancellation before validation skips vault work and passkey persistence", async () => {
    const validation = deferred<{ valid: boolean }>();
    service.getStoredSession.mockReturnValue("stored-session");
    service.validateSession.mockReturnValue(validation.promise);
    const { unmount } = mountAuth();
    unmount();
    await act(async () => validation.resolve({ valid: true }));
    expect(service.fetchVaultKey).not.toHaveBeenCalled();
    expect(service.fetchAuthInfo).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("n_apt_has_passkeys")).toBeNull();
  });

  test("cancellation during vault retrieval preserves existing failure cleanup ordering", async () => {
    const vault = deferred<string | null>();
    service.getStoredSession.mockReturnValue("stored-session");
    service.fetchVaultKey.mockReturnValue(vault.promise);
    const { unmount } = mountAuth();
    await flush();
    unmount();
    await act(async () => vault.resolve(null));
    expect(service.clearSession).toHaveBeenCalledTimes(1);
    expect(service.fetchAuthInfo).toHaveBeenCalledTimes(1);
    expect(service.clearSession.mock.invocationCallOrder[0]).toBeLessThan(service.fetchAuthInfo.mock.invocationCallOrder[0]);
    expect(localStorage.getItem("n_apt_has_passkeys")).toBeNull();
  });

  test.each(["password", "passkey"] as const)("%s waits for vault import before success", async (method) => {
    const key = deferred<CryptoKey>();
    jest.mocked(importAesKey).mockReturnValue(key.promise);
    const { result } = mountAuth(true);
    let pending!: Promise<void>;
    await act(async () => {
      pending = method === "password"
        ? result.current.handlePasswordAuth("test-password")
        : result.current.handlePasskeyAuth();
    });
    expect(result.current).toMatchObject({ authState: "authenticating", isAuthenticated: false });
    expect(service.fetchVaultKey).toHaveBeenCalledWith(`${method}-session`);
    await act(async () => {
      key.resolve(aesKey);
      await pending;
    });
    expect(result.current).toMatchObject({
      authState: "ready", isAuthenticated: true, aesKey,
      sessionToken: `${method}-session`, authError: null,
    });
  });

  test.each([
    ["password", "Password authentication succeeded but vault key retrieval failed."],
    ["passkey", "Passkey auth succeeded but vault key retrieval failed."],
  ])("%s retains its missing vault error", async (method, message) => {
    service.fetchVaultKey.mockResolvedValue(null);
    const { result } = mountAuth(true);
    await act(async () => {
      if (method === "password") await result.current.handlePasswordAuth("test-password");
      else await result.current.handlePasskeyAuth();
    });
    expect(result.current).toMatchObject({ authState: "failed", authError: message, isAuthenticated: false });
    expect(importAesKey).not.toHaveBeenCalled();
    expect(service.clearSession).not.toHaveBeenCalled();
  });

  test("failure retains Context credentials and successful restore preserves an intervening error", async () => {
    const vault = deferred<string | null>();
    service.getStoredSession.mockReturnValue("stored-session");
    service.fetchVaultKey.mockReturnValue(vault.promise);
    service.registerPasskey.mockRejectedValue(new Error("registration failed"));
    const { result } = mountAuth();
    await flush();
    await act(async () => result.current.handleRegisterPasskey());
    expect(result.current.authError).toBe("registration failed");
    await act(async () => vault.resolve("test-vault-key"));
    expect(result.current).toMatchObject({ isAuthenticated: true, authError: "registration failed" });
    service.authenticateWithPassword.mockRejectedValue(new Error("password failed"));
    await act(async () => result.current.handlePasswordAuth("test-password"));
    expect(result.current).toMatchObject({
      authState: "failed", authError: "password failed", isAuthenticated: true,
      sessionToken: "stored-session", aesKey,
    });
  });

  test.each(["password", "passkey"])("%s still classifies disconnects as server down", async (method) => {
    const error = new Error("Server disconnected");
    service.authenticateWithPassword.mockRejectedValue(error);
    service.authenticateWithPasskey.mockRejectedValue(error);
    const { result } = mountAuth(true);
    await act(async () => {
      if (method === "password") await result.current.handlePasswordAuth("test-password");
      else await result.current.handlePasskeyAuth();
    });
    expect(result.current).toMatchObject({ authState: "server_down", authError: "Server is down", isInitialAuthCheck: false });
  });

  test("passkey privacy failures keep their password fallback message", async () => {
    service.authenticateWithPasskey.mockRejectedValue(new Error("not allowed"));
    const { result } = mountAuth(true);
    await act(async () => result.current.handlePasskeyAuth());
    expect(result.current.authError).toBe("Passkeys are blocked in private browsing mode. Please use a password instead.");
  });
});

describe("passkey persistence", () => {
  test.each([true, false])("bootstrap gates backend passkeys on browser support (%s)", async (supported) => {
    if (!supported) Object.defineProperty(navigator, "credentials", { configurable: true, value: undefined });
    const { result } = mountAuth();
    await flush();
    expect(result.current.hasPasskeys).toBe(supported);
    expect(localStorage.getItem("n_apt_has_passkeys")).toBe(String(supported));
  });

  test("registration completes despite a failed storage write", async () => {
    const { result } = mountAuth(true);
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    await act(async () => result.current.handleRegisterPasskey());
    expect(setItem).toHaveBeenCalledWith("n_apt_has_passkeys", "true");
    expect(result.current).toMatchObject({ authState: "ready", hasPasskeys: true, authError: null });
  });

  test("registration info failure does not persist or report success", async () => {
    const { result } = mountAuth(true);
    service.fetchAuthInfo.mockRejectedValue(new Error("info failed"));
    await act(async () => result.current.handleRegisterPasskey());
    expect(result.current).toMatchObject({ authState: "failed", hasPasskeys: false, authError: "info failed" });
    expect(localStorage.getItem("n_apt_has_passkeys")).toBeNull();
  });

  test("heartbeat recovery persists before ready and stops polling", async () => {
    jest.useFakeTimers();
    service.fetchAuthInfo.mockRejectedValueOnce(new Error("offline"));
    const { result, unmount } = mountAuth();
    await flush();
    expect(result.current).toMatchObject({ authState: "ready", hasPasskeys: true });
    expect(localStorage.getItem("n_apt_has_passkeys")).toBe("true");
    expect(service.fetchServerStatus).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTimeAsync(3000));
    expect(service.fetchServerStatus).toHaveBeenCalledTimes(1);
    const infoCalls = service.fetchAuthInfo.mock.calls.length;
    unmount();
    await act(async () => jest.advanceTimersByTimeAsync(6000));
    expect(service.fetchAuthInfo).toHaveBeenCalledTimes(infoCalls);
  });

  test("retry updates passkeys without silently changing server-down state", async () => {
    jest.useFakeTimers();
    service.fetchAuthInfo.mockRejectedValueOnce(new Error("offline"));
    service.fetchServerStatus.mockRejectedValue(new Error("offline"));
    const { result, unmount } = mountAuth();
    await flush();
    expect(result.current.authState).toBe("server_down");
    await act(async () => jest.advanceTimersByTimeAsync(500));
    expect(result.current).toMatchObject({ authState: "server_down", hasPasskeys: true, authError: "Server is down" });
    expect(localStorage.getItem("n_apt_has_passkeys")).toBe("true");
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("cancelled prompt fetch does not persist passkeys", async () => {
    const info = deferred<{ has_passkeys: boolean }>();
    service.fetchAuthInfo.mockReturnValue(info.promise);
    const { unmount } = mountAuth();
    unmount();
    await act(async () => info.resolve({ has_passkeys: true }));
    expect(localStorage.getItem("n_apt_has_passkeys")).toBeNull();
  });
});
