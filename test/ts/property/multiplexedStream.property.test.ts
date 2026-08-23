import fc from "fast-check";
import {
  createMultiplexedStreamTransport,
  makeFrame,
} from "@n-apt/app/infrastructure/streams/multiplexedStreamTransport";
import type {
  StreamEvent,
  StreamKey,
} from "@n-apt/app/infrastructure/streams/sourceModeStreamManager";

jest.mock("@n-apt/crypto/webcrypto", () => ({
  decryptPayloadBytes: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { decryptPayloadBytes } = require("@n-apt/crypto/webcrypto");

const ANY_NUMBERISH = fc.oneof(
  fc.constant(undefined),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.string(),
  fc.integer({ min: -1000, max: 100000 }),
  fc.double({ min: -1e6, max: 1e6 }),
);

const stubKey = {} as CryptoKey;

describe("multiplexed stream makeFrame fuzz", () => {
  beforeEach(() => {
    (decryptPayloadBytes as jest.Mock).mockResolvedValue(
      new Uint8Array([1, 2, 3, 4]),
    );
  });
  afterEach(() => jest.clearAllMocks());

  it("makeFrame never rejects on garbage numeric fields and never produces NaN/Infinity", async () => {
    await fc.assert(
      fc.asyncProperty(
        ANY_NUMBERISH,
        ANY_NUMBERISH,
        ANY_NUMBERISH,
        ANY_NUMBERISH,
        fc.string({ maxLength: 40 }),
        (sequence, epoch, revision, sampleRate, sourceId) => {
          const msg: Record<string, unknown> = {
            sourceId: sourceId || "src",
            mode: "rx",
            sequence,
            streamEpoch: epoch,
            optionsRevision: revision,
            sampleRateHz: sampleRate,
            iqData: "QUJD",
          };
          return makeFrame(msg, stubKey).then((event) => {
            const frame = event as Extract<
              StreamEvent,
              { type: "stream_frame" }
            >;
            expect(Number.isFinite(frame.sequence)).toBe(true);
            expect(Number.isFinite(frame.streamEpoch)).toBe(true);
            expect(Number.isFinite(frame.optionsRevision)).toBe(true);
            expect(Number.isFinite(frame.sampleRateHz)).toBe(true);
            expect(Number.isFinite(frame.frame.sequence)).toBe(true);
            expect(Number.isFinite(frame.frame.stream_epoch)).toBe(true);
            expect(Number.isFinite(frame.frame.timestamp)).toBe(true);
          });
        },
      ),
    );
  });

  it("makeFrame keeps non-numeric centerFrequencyHz/sampleRateHz as undefined, never NaN", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant(undefined), fc.constant("x"), fc.constant(NaN)),
        fc.oneof(fc.constant(undefined), fc.constant("x"), fc.constant(NaN)),
        (cf, sr) => {
          const msg: Record<string, unknown> = {
            sourceId: "src",
            mode: "tx",
            centerFrequencyHz: cf,
            sampleRateHz: sr,
          };
          return makeFrame(msg, stubKey).then((event) => {
            const frame = event as Extract<
              StreamEvent,
              { type: "stream_frame" }
            >;
            expect(frame.frame.center_frequency_hz).toBeUndefined();
            expect(frame.frame.sample_rate).toBeUndefined();
          });
        },
      ),
    );
  });

  it("stream_frame events flow one decrypt per frame and keep numeric fields finite", async () => {
    const events: unknown[] = [];
    const sockets: any[] = [];
    const wsFactory = jest.fn(() => {
      const s = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn(),
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      };
      sockets.push(s);
      return s;
    });
    const transport = createMultiplexedStreamTransport({
      url: "ws://localhost/ws?token=test",
      aesKey: stubKey,
      webSocketFactory: wsFactory as unknown as (url: string) => WebSocket,
    });
    const key: StreamKey = { sourceId: "src", mode: "rx" };
    transport.transportFactory(key, (e) => events.push(e));
    sockets[0].onopen?.();

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            sequence: ANY_NUMBERISH,
            streamEpoch: ANY_NUMBERISH,
            optionsRevision: ANY_NUMBERISH,
          }),
          { minLength: 0, maxLength: 8 },
        ),
        async (frames) => {
          const before = events.length;
          for (const f of frames) {
            sockets[0].onmessage({
              data: JSON.stringify({
                type: "stream_frame",
                sourceId: "src",
                mode: "rx",
                ...f,
                iqData: "QUJD",
              }),
            });
          }
          // Let the async drain settle.
          await new Promise((r) => setTimeout(r, 0));
          const arrived = events
            .slice(before)
            .filter((e) => (e as { type?: string }).type === "stream_frame");
          for (const event of arrived as Array<{
            type: string;
            sequence: number;
            streamEpoch: number;
            optionsRevision: number;
            sampleRateHz: number;
          }>) {
            expect(Number.isFinite(event.sequence)).toBe(true);
            expect(Number.isFinite(event.streamEpoch)).toBe(true);
            expect(Number.isFinite(event.optionsRevision)).toBe(true);
            expect(Number.isFinite(event.sampleRateHz)).toBe(true);
          }
        },
      ),
    );
    transport.dispose();
  });
});
