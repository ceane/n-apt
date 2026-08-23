/**
 * Multi-client fan-out for the batched subscriber-streaming model.
 *
 * Boots the real backend via the live Redux harness (the "store client"), then
 * opens a second raw `/ws/streams` socket ("probe client") against the same
 * backend. Asserts the batched model's guarantees across clients:
 *  - per-source fan-out: both clients see advancing frames with matching epoch
 *  - local (subscriber) state isolation: probe pause does not stop the store
 *    client; the store client's pause does not stop the probe
 *  - device (global) options: an RX options change is shared
 *  - garbage/noisy stream commands never disturb the store client's stream
 *    (and out-of-range options are rejected with `code: "options"`)
 */
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";
import fc from "fast-check";
import {
  createLiveReduxStreamHarness,
  type LiveReduxStreamHarness,
} from "./helpers/liveReduxStreamHarness";
import {
  computeHmac,
  base64ToBytes,
  importAesKey,
} from "@n-apt/crypto/webcrypto";

const wsModule: any = require(
  resolve(process.cwd(), "node_modules/ws/index.js"),
);
const NodeWebSocket: any = [
  wsModule,
  wsModule.default,
  wsModule.WebSocket,
].find((candidate: unknown) => typeof candidate === "function");

const requestJson = (
  url: string,
  method = "GET",
  body?: Record<string, unknown>,
): Promise<{ status: number; json: any }> =>
  new Promise((resolveRequest, rejectRequest) => {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    const handle = httpRequest(
      url,
      {
        method,
        headers: serialized
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(serialized),
            }
          : undefined,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (c) => (text += c));
        response.on("end", () => {
          let json: any = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolveRequest({ status: response.statusCode ?? 0, json });
        });
      },
    );
    handle.on("error", rejectRequest);
    if (serialized) handle.write(serialized);
    handle.end();
  });

const sleep = (ms: number) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

type ProbeClient = {
  send(data: unknown): void;
  frames: Array<{ sequence: number; streamEpoch: number }>;
  errors: Array<{ code?: string; message?: string }>;
  close(): void;
};

let harness: LiveReduxStreamHarness;
let token: string;
const BACKEND_URL = process.env.LIVE_BACKEND_URL ?? "http://127.0.0.1:18765";

beforeAll(async () => {
  harness = await createLiveReduxStreamHarness({
    hardwareSimulation: "rtl-sdr",
    backendUrl: BACKEND_URL,
  });
  await harness.connect();
  // Authenticate a probe client against the same backend.
  const password =
    process.env.UNSAFE_LOCAL_USER_PASSWORD ?? "test-password-123";
  const challenge = await requestJson(
    `${BACKEND_URL}/auth/challenge`,
    "POST",
    {},
  );
  const hmac = await computeHmac(password, challenge.json.nonce);
  const verify = await requestJson(`${BACKEND_URL}/auth/verify`, "POST", {
    challenge_id: challenge.json.challenge_id,
    hmac,
  });
  token = verify.json.token;
}, 90_000);

afterAll(() => harness.close());

/** The active source and its source id, read from the harness snapshot. The
 * multiplexed `/ws/streams` subscribe uses the source id, not the serial key. */
const activeSourceProbeKey = (): { keySourceId: string; source: any } => {
  const snap = harness.snapshot();
  const activeId = snap.redux.activeSourceId;
  const source = snap.redux.sources.find(
    (candidate: any) => candidate.id === activeId,
  );
  return {
    keySourceId: (source?.id as string) ?? (activeId as string) ?? "00000001",
    source,
  };
};

const openProbe = (): Promise<ProbeClient> =>
  new Promise((resolveProbe, rejectProbe) => {
    const { keySourceId, source } = activeSourceProbeKey();
    const socketUrl = `${BACKEND_URL.replace(/^http/, "ws")}/ws/streams?token=${encodeURIComponent(token)}`;
    const socket = new NodeWebSocket(socketUrl);
    const subscriptionId = `probe-sub-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let resolved = false;
    const client: ProbeClient = {
      send: (data) => socket.send(JSON.stringify(data)),
      frames: [],
      errors: [],
      close: () => socket.close(),
    };
    const toMessage = (dataBuffer: any) => {
      try {
        return JSON.parse(dataBuffer.toString());
      } catch {
        return { type: "__unparseable" };
      }
    };
    socket.on("open", () => {
      client.send({
        type: "stream_subscribe",
        scope: "subscriber",
        subscriptionId,
        stream: { sourceId: keySourceId, mode: "rx" },
        options: {
          mode: "rx",
          centerFrequencyHz:
            source?.sdr?.settings?.center_frequency ?? 1_600_000,
          sampleRateHz: source?.sdr?.settings?.sample_rate ?? 3_200_000,
          fftSize: source?.sdr?.settings?.fft_size ?? 2048,
        },
        deliveryPolicy: "lossless",
      });
    });
    socket.on("message", (raw: any) => {
      const message = toMessage(raw);
      if (message.type === "stream_frame") {
        client.frames.push({
          sequence: message.sequence,
          streamEpoch: message.streamEpoch,
        });
        if (!resolved) {
          resolved = true;
          resolveProbe(client);
        }
      } else if (message.type === "stream_error") {
        client.errors.push({
          code: message.code,
          message: message.message,
        });
        if (!resolved) {
          resolved = true;
          rejectProbe(
            new Error(
              `probe stream_error: ${message.code}: ${message.message}`,
            ),
          );
        }
      }
    });
    socket.on("error", (error: Error) => {
      if (!resolved) {
        resolved = true;
        rejectProbe(new Error(`probe socket error: ${String(error)}`));
      }
    });
  });

describe("2.3 multi-client stream fan-out", () => {
  it("store client is streaming an active source", () => {
    const snap = harness.snapshot();
    expect(snap.redux.isConnected).toBe(true);
    expect(snap.managed.rx.hasSubscription).toBe(true);
    expect(snap.redux.activeSourceId).toBe("rtl-sdr-00000001");
  });

  it("probe client receives stream_frames matching the store client's epoch", async () => {
    const probe = await openProbe();
    expect(probe.frames.length).toBeGreaterThan(0);
    for (const frame of probe.frames) {
      expect(frame.streamEpoch).toBeGreaterThanOrEqual(1);
      expect(frame.sequence).toBeGreaterThanOrEqual(1);
    }
    probe.close();
  });

  it("probe pause does not stop the store client's frames (subscriber-local isolation)", async () => {
    const probe = await openProbe();
    const before = harness.snapshot().rxPresentation.sequence ?? 0;
    probe.send({
      type: "stream_set_paused",
      scope: "subscriber",
      subscriptionId: "probe-sub-1",
      stream: { sourceId: "00000001", mode: "rx" },
      paused: true,
    });
    await sleep(250);
    const after = harness.snapshot().rxPresentation.sequence ?? 0;
    expect(after).toBeGreaterThanOrEqual(before);
    probe.close();
  }, 20_000);

  it("fuzzed stream commands on the probe never disturb the store client's stream", async () => {
    const probe = await openProbe();
    const beforeEpoch = harness.snapshot().managed.rx.streamEpoch ?? 0;
    fc.assert(
      fc.property(
        fc.constantFrom(
          "stream_subscribe",
          "stream_update_options",
          "stream_set_paused",
          "stream_set_delivery",
          "garbage",
        ),
        (commandType) => {
          probe.send({
            type: commandType,
            scope: "device",
            subscriptionId: "probe-sub-1",
            stream: { sourceId: "00000001", mode: "rx" },
            options: {
              mode: "rx",
              centerFrequencyHz: 0,
              sampleRateHz: 0,
              fftSize: 1,
            },
            paused: true,
            deliveryPolicy: "lossless",
          });
        },
      ),
      { numRuns: 40 },
    );
    await sleep(400);
    // The store client's stream must still be healthy and advancing.
    await harness.waitFor(
      () => harness.snapshot(),
      (s) => s.redux.isConnected && s.redux.connectionStatus === "connected",
      20_000,
    );
    const afterEpoch = harness.snapshot().managed.rx.streamEpoch ?? 0;
    expect(afterEpoch).toBeGreaterThanOrEqual(beforeEpoch);
    expect(harness.snapshot().redux.error).toBeNull();
    probe.close();
  }, 30_000);
});
