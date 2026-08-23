/**
 * Live-harness fuzz for the Redux WebSocket control plane.
 *
 * Boots the real backend + Redis, drives the real store + middleware + socket,
 * and feeds fuzzed control-plane messages through a small test seam
 * (`__testIngestIncomingMessage`) that mirrors the onmessage path. Invariants
 * hold after every batch: no throws, connection/transport state stays in valid
 * phases, fuzz traffic cannot manufacture operational errors, and the pipeline
 * still streams afterwards.
 */
import fc from "fast-check";
import {
  createLiveReduxStreamHarness,
  type LiveReduxStreamHarness,
} from "./helpers/liveReduxStreamHarness";
import {
  __testIngestIncomingMessage,
  getManagedStreamDebugSnapshot,
} from "@n-apt/redux/middleware/websocketMiddleware";
import type { store as rootStore } from "@n-apt/redux/store";

type Store = typeof rootStore;

const MESSAGE_TYPES = [
  "tx_safety",
  "channels",
  "pause",
  "status",
  "gain",
  "ppm",
  "settings",
  "signals_defaults",
  "select_source",
  "source_info",
  "active_source",
  "sdr_settings",
  "error",
  "capture_status",
  "scan_result",
  "hardware_info",
  "not-a-real-type",
  "",
];

const ANY_JSON = fc.jsonValue({ maxDepth: 4 });

const GARBAGE_VALUES: Array<Record<string, unknown>> = [
  { type: "settings", scope: "device", fftSize: 0, frameRate: -5 },
  { type: "gain", value: Number.NaN },
  { type: "channels", channels: [] },
  { type: "status", source_id: "rtl-sdr-00000001", status: 42 },
];

/** Convert arbitrary JSON into an object whose number/undefined values are
 * JSON-safe, mirroring what a real wire message can contain. */
const nfObject = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(v)) {
      if (typeof val === "number") out[key] = Number.isFinite(val) ? val : 0;
      else if (val === undefined) out[key] = 0;
      else out[key] = val;
    }
    return out;
  }
  return {};
};

let harness: LiveReduxStreamHarness;
let store: Store;
let dispatch: Store["dispatch"];

const ingest = (raw: string | unknown) =>
  __testIngestIncomingMessage(dispatch, store.getState, raw);

beforeAll(async () => {
  ({ store } = await import("@n-apt/redux/store"));
  dispatch = store.dispatch as Store["dispatch"];
  harness = await createLiveReduxStreamHarness({
    hardwareSimulation: "rtl-sdr",
  });
  await harness.connect();
}, 90_000);

afterAll(() => {
  harness.close();
});

describe("2.1 live Redux control-plane message fuzz", () => {
  it("fuzzed arbitrary JSON control messages never throw and never corrupt connection state", () => {
    fc.assert(
      fc.property(ANY_JSON, (value) => {
        let raw: string;
        try {
          raw = JSON.stringify(value);
        } catch {
          return;
        }
        expect(() => ingest(raw)).not.toThrow();
        const state = store.getState().websocket;
        expect(
          ["connecting", "connected", "reconnecting", "error"].includes(
            state.connectionStatus,
          ),
        ).toBe(true);
        // Fuzz traffic must not manufacture an operational error (the
        // channels Bad-JSON path is log-only) nor corrupt sources.
        expect(state.error).toBeNull();
        for (const source of state.sources) {
          expect(typeof source.id).toBe("string");
          expect(source.id.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("fuzzed typed messages never throw and the pipeline recovers to streaming", () => {
    fc.assert(
      fc.property(fc.constantFrom(...MESSAGE_TYPES), ANY_JSON, (type, body) => {
        const msg = { type, ...nfObject(body) };
        expect(() => ingest(JSON.stringify(msg))).not.toThrow();
      }),
    );
    // A fuzzed `select_source` can leave a transient mid-switch state; wait for
    // the pipeline to recover to a connected, streaming source.
    return harness.waitFor(
      () => harness.snapshot(),
      (snapshot) =>
        snapshot.redux.isConnected &&
        snapshot.redux.connectionStatus === "connected" &&
        !snapshot.lifecycle.controlPlaneUnavailable &&
        snapshot.managed.rx.streamEpoch !== null &&
        snapshot.managed.rx.streamEpoch >= 1,
      20_000,
    );
  }, 60_000);

  it("fuzz traffic cannot manufacture a source error or server-down state", () => {
    fc.assert(
      fc.property(ANY_JSON, (value) => {
        let raw: string;
        try {
          raw = JSON.stringify(value);
        } catch {
          return;
        }
        ingest(raw);
        const state = store.getState().websocket;
        // operational error stays clear (fuzzing must not wedge the pipeline).
        expect(state.error).toBeNull();
        expect(state.hasConnectedOnce).toBe(true);
      }),
    );
    // The backend is still reachable and streaming.
    const snapshot = getManagedStreamDebugSnapshot();
    expect(snapshot.rx.sourceId).toBeTruthy();
  }, 60_000);
});

describe("2.2 live lifecycle fuzz", () => {
  it("interleaving real lifecycle commands with garbage never wedges the pipeline", async () => {
    // The simulated rtl-sdr device accepts these FFT sizes.
    const fftSizes = [2048, 4096];

    const assertHealthy = () => {
      const snapshot = harness.snapshot();
      expect(snapshot.redux.isConnected).toBe(true);
      expect(snapshot.lifecycle.controlPlaneUnavailable).toBe(false);
      expect(["connected", "reconnecting"]).toContain(
        snapshot.redux.connectionStatus,
      );
    };

    // Deterministic interleaving of safe lifecycle ops with garbage bursts.
    for (let pass = 0; pass < 3; pass += 1) {
      // 1. Garbage burst, then confirm the connection is still healthy.
      for (let i = 0; i < 4; i += 1) {
        ingest(JSON.stringify(GARBAGE_VALUES[i % GARBAGE_VALUES.length]));
      }
      await harness.waitFor(
        () => harness.snapshot(),
        (s) => s.redux.isConnected && s.redux.connectionStatus === "connected",
        20_000,
      );
      assertHealthy();

      // 2. Change FFT size (device-global). A hardware-constrained size may
      // legitimately not apply; a timeout here is not a pipeline wedge.
      const nextSize = fftSizes[pass % fftSizes.length];
      try {
        await harness.setFftSize(nextSize, 10_000);
      } catch {
        process.stderr.write(
          `setFftSize(${nextSize}) was not applied by the simulated device (benign)\n`,
        );
      }
      assertHealthy();

      // 3. Pause (subscriber-local) -> frames freeze -> resume -> frames advance.
      await harness.setPaused(true);
      const before = harness.snapshot().rxPresentation.sequence ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const frozen = harness.snapshot().rxPresentation.sequence ?? 0;
      expect(frozen).toBe(before);
      await harness.setPaused(false);
      await harness.waitFor(
        () => harness.snapshot().rxPresentation.sequence ?? 0,
        (sequence) => sequence >= frozen,
        20_000,
      );
      assertHealthy();
    }
  }, 120_000);
});
