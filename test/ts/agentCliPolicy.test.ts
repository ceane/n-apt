import {
  evaluateCliToolRequest,
  executeAgentTool,
} from "../../scripts/cli/agent";

describe("CLI agent tool policy", () => {
  test("returns a machine-readable rejection for blocked tools", () => {
    expect(evaluateCliToolRequest("transmitSignal", false)).toEqual({
      allowed: false,
      reason: "blocked",
    });
  });

  test("requires explicit mutation opt-in", () => {
    expect(evaluateCliToolRequest("setGain", false)).toEqual({
      allowed: false,
      reason: "mutation_requires_opt_in",
    });
    expect(evaluateCliToolRequest("setGain", true)).toEqual({ allowed: true });
  });

  test("rejects HTTP-success tool responses whose backend success is false", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, error: "backend failed" }),
    } as Response);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    try {
      await expect(
        executeAgentTool(
          "http://127.0.0.1:1",
          "token",
          "getDeviceStatus",
          {},
          false,
        ),
      ).rejects.toThrow("backend failed");
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
    }
  });
});
