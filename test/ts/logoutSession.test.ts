import { logoutSession } from "@n-apt/app/infrastructure/services/auth";

describe("logoutSession", () => {
  it("uses the backend auth endpoint rather than the SPA logout route", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await logoutSession("session/token");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer session/token" },
        credentials: "include",
        keepalive: true,
      }),
    );
  });
});
