import { describe, expect, it } from "@jest/globals";
import {
  evaluateSdrReadiness,
  extractDeviceState,
  extractSourceKinds,
  formatSdrReadyFailure,
  isHardwareSourceKind,
  waitForProcessExit,
  waitForSdrReady,
  type FetchLike,
} from "../../../scripts/build/rustHotReloadHandoff";

const deviceConnected = {
  device: { connected: true, state: "connected", info: "HackRF One" },
};
const deviceMock = {
  device: { connected: false, state: "disconnected", info: "Mock APT SDR" },
};
const snapshotWithoutRadio = {
  status: { sources: [{ id: "mock-apt", kind: "mock_apt" }] },
};
const snapshotWithHackRf = {
  status: {
    sources: [
      { id: "hackrf_one-abc", kind: "hackrf_one" },
      { id: "mock-apt", kind: "mock_apt" },
    ],
  },
};

/** A virtual clock driven by the injected sleep, so polls are deterministic. */
function createHarness(options: {
  device?: unknown;
  snapshot?: unknown;
  fetchImpl?: FetchLike;
}) {
  const clock = { value: 0 };
  const fetchImpl: FetchLike =
    options.fetchImpl ??
    (async (url: string) => {
      const path = new URL(url).pathname;
      const body = path === "/api/agent/status" ? options.device : options.snapshot;
      if (body === undefined) return { ok: false, json: async () => null };
      return { ok: true, json: async () => body };
    });

  return {
    clock,
    fetchImpl,
    now: () => clock.value,
    sleep: async (ms: number) => {
      clock.value += ms;
    },
  };
}

describe("Rust hot reload handoff", () => {
  it("distinguishes exclusive hardware sources from simulations", () => {
    expect(isHardwareSourceKind("hackrf_one")).toBe(true);
    expect(isHardwareSourceKind("rtl-sdr")).toBe(true);
    expect(isHardwareSourceKind("mock_apt")).toBe(false);
    expect(isHardwareSourceKind("mock_tx")).toBe(false);
  });

  it("reads source kinds from the backend snapshot", () => {
    expect(extractSourceKinds(snapshotWithHackRf)).toEqual([
      "hackrf_one",
      "mock_apt",
    ]);
    expect(extractSourceKinds({ status: { sources: [{ id: "x" }, null] } })).toEqual(
      [],
    );
    expect(extractSourceKinds({ status: {} })).toEqual([]);
    expect(extractSourceKinds(null)).toEqual([]);
  });

  it("reads device state from the agent status payload only", () => {
    expect(extractDeviceState(deviceConnected)).toEqual({
      connected: true,
      state: "connected",
      info: "HackRF One",
    });
    // The flat `/status` route carries no device block.
    expect(extractDeviceState(snapshotWithHackRf)).toBeNull();
    // A device block without a boolean connection flag is not usable.
    expect(extractDeviceState({ device: { state: "connected" } })).toBeNull();
    expect(extractDeviceState(null)).toBeNull();
  });

  it("treats a reported connection as ready", () => {
    expect(evaluateSdrReadiness(deviceConnected.device, ["hackrf_one"])).toEqual({
      ready: true,
      outcome: "connected",
    });
  });

  it("allows the reload when no supported radio is attached", () => {
    expect(evaluateSdrReadiness(deviceMock.device, ["mock_apt"])).toEqual({
      ready: true,
      outcome: "no-hardware",
    });
    expect(evaluateSdrReadiness(null, [])).toEqual({
      ready: true,
      outcome: "no-hardware",
    });
  });

  it("keeps waiting while an attached radio has not connected", () => {
    expect(evaluateSdrReadiness(deviceMock.device, ["hackrf_one"])).toEqual({
      ready: false,
      outcome: "waiting",
    });
  });

  it("names the radio that failed to connect", () => {
    const message = formatSdrReadyFailure({
      ok: false,
      outcome: "failed",
      device: { connected: false, state: "disconnected", info: "Mock APT SDR" },
      hardwareSourceKinds: ["hackrf_one", "mock_apt"],
    });

    expect(message).toContain("hackrf_one");
    expect(message).toContain("state=disconnected");
    expect(message).not.toContain("mock_apt");
  });

  it("resolves as soon as the replacement backend reports a connection", async () => {
    const harness = createHarness({
      device: deviceConnected,
      snapshot: snapshotWithHackRf,
    });

    const result = await waitForSdrReady({
      baseUrl: "http://127.0.0.1:9000",
      fetchImpl: harness.fetchImpl,
      sleep: harness.sleep,
      now: harness.now,
    });

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("connected");
    expect(result.device?.info).toBe("HackRF One");
    expect(harness.clock.value).toBe(0);
  });

  it("accepts an absent radio once the inventory has settled", async () => {
    const harness = createHarness({
      device: deviceMock,
      snapshot: snapshotWithoutRadio,
    });

    const result = await waitForSdrReady({
      baseUrl: "http://127.0.0.1:9000",
      settleMs: 500,
      pollMs: 100,
      timeoutMs: 5000,
      fetchImpl: harness.fetchImpl,
      sleep: harness.sleep,
      now: harness.now,
    });

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("no-hardware");
    expect(harness.clock.value).toBeGreaterThanOrEqual(500);
  });

  it("does not trust an empty inventory before the settle window elapses", async () => {
    const harness = createHarness({
      device: deviceMock,
      snapshot: snapshotWithoutRadio,
    });

    const result = await waitForSdrReady({
      baseUrl: "http://127.0.0.1:9000",
      settleMs: 1500,
      pollMs: 250,
      timeoutMs: 800,
      fetchImpl: harness.fetchImpl,
      sleep: harness.sleep,
      now: harness.now,
    });

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
  });

  it("fails when an attached radio never connects", async () => {
    const harness = createHarness({
      device: deviceMock,
      snapshot: snapshotWithHackRf,
    });

    const result = await waitForSdrReady({
      baseUrl: "http://127.0.0.1:9000",
      settleMs: 0,
      pollMs: 250,
      timeoutMs: 1000,
      fetchImpl: harness.fetchImpl,
      sleep: harness.sleep,
      now: harness.now,
    });

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.hardwareSourceKinds).toContain("hackrf_one");
    expect(formatSdrReadyFailure(result)).toContain("hackrf_one");
  });

  it("does not mistake an unreachable backend for a machine with no radio", async () => {
    const harness = createHarness({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    const result = await waitForSdrReady({
      baseUrl: "http://127.0.0.1:9000",
      settleMs: 0,
      pollMs: 250,
      timeoutMs: 1000,
      fetchImpl: harness.fetchImpl,
      sleep: harness.sleep,
      now: harness.now,
    });

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
  });

  it("remembers a radio enumerated before the inventory went empty", async () => {
    let snapshotPolls = 0;
    const harness = createHarness({
      fetchImpl: async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/api/agent/status") {
          return { ok: true, json: async () => deviceMock };
        }
        snapshotPolls += 1;
        return {
          ok: true,
          json: async () =>
            snapshotPolls === 1 ? snapshotWithHackRf : snapshotWithoutRadio,
        };
      },
    });

    const result = await waitForSdrReady({
      baseUrl: "http://127.0.0.1:9000",
      settleMs: 0,
      pollMs: 250,
      timeoutMs: 1000,
      fetchImpl: harness.fetchImpl,
      sleep: harness.sleep,
      now: harness.now,
    });

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.hardwareSourceKinds).toContain("hackrf_one");
  });

  it("reports cancellation without claiming a handoff", async () => {
    const harness = createHarness({
      device: deviceMock,
      snapshot: snapshotWithHackRf,
    });

    const result = await waitForSdrReady({
      baseUrl: "http://127.0.0.1:9000",
      fetchImpl: harness.fetchImpl,
      sleep: harness.sleep,
      now: harness.now,
      isCancelled: () => true,
    });

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("cancelled");
  });

  it("waits for a pid to disappear and gives up when it outlives the timeout", async () => {
    const noSleep = async () => {};

    const exited = await waitForProcessExit({
      pid: 4242,
      timeoutMs: 1000,
      pollMs: 100,
      isAlive: () => false,
      sleep: noSleep,
    });
    expect(exited).toBe(true);

    // A process that only disappears after the deadline is not awaited again.
    let aliveChecks = 0;
    const stubborn = await waitForProcessExit({
      pid: 4242,
      timeoutMs: 0,
      isAlive: () => {
        aliveChecks += 1;
        return true;
      },
      sleep: noSleep,
    });
    expect(stubborn).toBe(false);
    expect(aliveChecks).toBeGreaterThan(0);
  });
});
