import { describe, expect, it, jest } from "@jest/globals";
import { waitForViteReady } from "../../../scripts/build/waitForViteReady";

const okResponse = (body: string) =>
  ({
    ok: true,
    text: async () => body,
  }) as unknown as Response;

describe("waitForViteReady", () => {
  it("requires stable consecutive successes before reporting ready", async () => {
    const fetchImpl = jest.fn(async () =>
      okResponse("<!doctype html>"),
    ) as unknown as typeof fetch;

    const result = await waitForViteReady({
      fetchImpl,
      urls: ["http://127.0.0.1:5173/"],
      timeoutMs: 1000,
      intervalMs: 5,
      requestTimeoutMs: 100,
      stableSuccesses: 3,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("probes Main.tsx as well as the document by default", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("Main.tsx") || url.endsWith("/")) {
        return okResponse("<html>ok</html>");
      }
      return okResponse("");
    }) as unknown as typeof fetch;

    const result = await waitForViteReady({
      fetchImpl,
      timeoutMs: 1000,
      intervalMs: 5,
      requestTimeoutMs: 50,
      stableSuccesses: 1,
    });

    expect(result.ok).toBe(true);
    const urls = (fetchImpl as jest.Mock).mock.calls.map((call) =>
      String(call[0]),
    );
    expect(urls.some((url) => url.includes("127.0.0.1:5173"))).toBe(true);
    expect(urls.some((url) => url.includes("Main.tsx"))).toBe(true);
  });

  it("resets the stability counter when a probe fails mid-window", async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async () => {
      calls += 1;
      if (calls === 2) {
        throw new Error("optimize freeze");
      }
      return okResponse("<html>ok</html>");
    }) as unknown as typeof fetch;

    const result = await waitForViteReady({
      fetchImpl,
      urls: ["http://127.0.0.1:5173/"],
      timeoutMs: 2000,
      intervalMs: 5,
      requestTimeoutMs: 50,
      stableSuccesses: 3,
    });

    expect(result.ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(5);
  });

  it("fails when the overall timeout elapses without a usable response", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("still optimizing");
    }) as unknown as typeof fetch;

    const result = await waitForViteReady({
      fetchImpl,
      urls: ["http://127.0.0.1:5173/"],
      timeoutMs: 40,
      intervalMs: 5,
      requestTimeoutMs: 10,
      stableSuccesses: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/timed out/i);
  });

  it("treats empty 200 bodies as not ready", async () => {
    const fetchImpl = jest.fn(async () => okResponse("")) as unknown as typeof fetch;

    const result = await waitForViteReady({
      fetchImpl,
      urls: ["http://127.0.0.1:5173/"],
      timeoutMs: 30,
      intervalMs: 5,
      requestTimeoutMs: 10,
      stableSuccesses: 1,
    });

    expect(result.ok).toBe(false);
  });

  it("stops early when cancelled", async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async () => {
      calls += 1;
      throw new Error("not ready");
    }) as unknown as typeof fetch;

    const result = await waitForViteReady({
      fetchImpl,
      urls: ["http://127.0.0.1:5173/"],
      timeoutMs: 1000,
      intervalMs: 5,
      requestTimeoutMs: 10,
      stableSuccesses: 1,
      isCancelled: () => calls >= 1,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cancelled/i);
    expect(calls).toBe(1);
  });
});
