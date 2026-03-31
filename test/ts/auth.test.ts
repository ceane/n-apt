import {
  getStoredSession,
  storeSession,
  clearSession,
  fetchServerStatus,
  validateSession,
  authenticateWithPassword,
  buildWsUrl,
} from "../../src/ts/services/auth";

describe("auth service", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  describe("Session Storage", () => {
    test("storeSession and getStoredSession work correctly", () => {
      const token = "valid.session.token.long.enough";
      storeSession(token);
      expect(getStoredSession()).toBe(token);
      expect(localStorage.getItem("n-apt-session-token")).toBe(token);
    });

    test("clearSession removes the token", () => {
      storeSession("to-be-cleared");
      clearSession();
      expect(getStoredSession()).toBeNull();
    });
  });

  describe("REST API calls", () => {
    test("fetchServerStatus returns parsed JSON on success", async () => {
      const mockStatus = { status: "ok", version: "1.0" };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      });

      const result = await fetchServerStatus();
      expect(result).toEqual(mockStatus);
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/status"));
    });

    test("validateSession returns valid result for valid token", async () => {
      const mockValidationResponse = { valid: true, token: "new_token" };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockValidationResponse),
      });

      const result = await validateSession("valid_session_token_long_enough");
      expect(result).toEqual(mockValidationResponse);
    });

    test("validateSession returns invalid for bad format", async () => {
      const result = await validateSession("invalid-token-!!!");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("format");
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("Password Authentication", () => {
    test("authenticateWithPassword executes full flow", async () => {
      const password = "my-password";
      const challengeId = "chall-123";
      const nonce = btoa("mock-nonce");
      const authToken = "auth-token-abc";

      // 1. Mock challenge response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ challenge_id: challengeId, nonce }),
      });

      // 2. Mock verification response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: authToken, expires_in: 3600 }),
      });

      const result = await authenticateWithPassword(password);
      
      expect(result.token).toBe(authToken);
      expect(getStoredSession()).toBe(authToken);
      
      // Verify correct fetch sequence
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(1, expect.stringContaining("/auth/challenge"), expect.anything());
      expect(global.fetch).toHaveBeenNthCalledWith(2, expect.stringContaining("/auth/verify"), expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(challengeId)
      }));
    });

    test("authenticateWithPassword throws on server error", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(authenticateWithPassword("pwd")).rejects.toThrow("Server disconnected 500");
    });
  });

  describe("buildWsUrl", () => {
    test("constructs valid WebSocket URL", () => {
      const token = "foo-bar";
      const url = buildWsUrl(token);
      expect(url).toContain("ws");
      expect(url).toContain("token=foo-bar");
    });
  });
});
