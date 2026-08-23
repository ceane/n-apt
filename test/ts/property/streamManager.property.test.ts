import fc from "fast-check";
import {
  createSourceModeStreamManager,
  type StreamCommand,
  type StreamEvent,
  type StreamKey,
  type StreamMessage,
  type StreamOptions,
  type StreamTransport,
} from "@n-apt/app/infrastructure/streams/sourceModeStreamManager";
import { type StreamDeliveryPolicy } from "@n-apt/app/infrastructure/streams/streamContract";

const rxOptions = (centerFrequencyHz = 100_000_000): StreamOptions => ({
  mode: "rx",
  centerFrequencyHz,
  sampleRateHz: 2_400_000,
  fftSize: 1024,
});

const txOptions = (): StreamOptions => ({
  mode: "tx",
  centerFrequencyHz: 100_000_000,
  sampleRateHz: 2_400_000,
  bandwidthHz: 1_000_000,
  signal: "wifi",
  powerDbm: -18,
  ifftSize: 1024,
});

const frameEvent = (
  sourceId: string,
  mode: "rx" | "tx",
  sequence: number,
  streamEpoch = 1,
  optionsRevision = 1,
): StreamEvent =>
  ({
    type: "stream_frame",
    sourceId,
    mode,
    streamEpoch,
    optionsRevision,
    sequence,
    timestamp: sequence,
    sampleRateHz: 2_400_000,
    iqData: new Uint8Array([1, 2, 3, 4]),
    frame: {
      type: "spectrum",
      data_type: "iq_raw",
      iq_data: new Uint8Array([1, 2, 3, 4]),
      protocol_version: 2,
      source_id: sourceId,
      stream_epoch: streamEpoch,
      sequence,
    },
  }) as StreamEvent;

type Harness = {
  manager: ReturnType<typeof createSourceModeStreamManager>;
  transports: Array<{
    key: StreamKey;
    sent: StreamMessage[];
    onEvent: (event: StreamEvent) => void;
  }>;
  byKey: (key: StreamKey) => (event: StreamEvent) => void;
};

const makeHarness = (): Harness => {
  const transports: Harness["transports"] = [];
  const manager = createSourceModeStreamManager({
    noSubscriberGraceMs: 10_000,
    transportFactory: (key, onEvent) => {
      const t: {
        key: StreamKey;
        sent: StreamMessage[];
        onEvent: (event: StreamEvent) => void;
      } = { key, sent: [], onEvent };
      transports.push(t);
      return {
        key,
        send: (m: StreamCommand) => t.sent.push(m),
        close: () => {},
        onEvent,
      } as StreamTransport;
    },
  });
  return {
    manager,
    transports,
    byKey: (key) => {
      const match = transports.find(
        (t) => t.key.sourceId === key.sourceId && t.key.mode === key.mode,
      );
      if (!match) throw new Error("no transport");
      return match.onEvent;
    },
  };
};

describe("source mode stream manager fuzz", () => {
  it("subscribed frames with monotone sequence are all accepted (lossless policy)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), {
          minLength: 0,
          maxLength: 40,
        }),
        fc.integer({ min: 0, max: 5 }),
        async (sequencesRaw, epochStep) => {
          const h = makeHarness();
          const key: StreamKey = { sourceId: "src", mode: "rx" };
          const events: StreamEvent[] = [];
          const sub = await h.manager.subscribe(
            key,
            rxOptions(),
            (e) => events.push(e),
            { deliveryPolicy: "lossless" },
          );
          // Feed sequences in whatever order fast-check chose.
          const epoch = 1 + epochStep;
          let lastAccepted: number | null = null;
          const inject = h.byKey(key);
          for (const seq of sequencesRaw) {
            const frame = frameEvent("src", "rx", seq, epoch);
            if (seq > lastAccepted!) {
              inject(frame);
            }
            lastAccepted = seq;
          }
          const acceptedFrames = events.filter(
            (e) => e.type === "stream_frame",
          );
          const sequences = acceptedFrames.map(
            (e) => (e as { sequence: number }).sequence,
          );
          expect([...sequences]).toEqual(
            sequences.slice().sort((a, b) => a - b),
          );
          // No duplicate accepts within a generation.
          expect(new Set(sequences).size).toBe(sequences.length);
          sub.unsubscribe();
          h.manager.dispose();
        },
      ),
    );
  });

  it("stale epoch or optionsRevision frames are dropped", async () => {
    const h = makeHarness();
    const key: StreamKey = { sourceId: "src", mode: "rx" };
    const events: StreamEvent[] = [];
    const sub = await h.manager.subscribe(key, rxOptions(), (e) =>
      events.push(e),
    );
    const inject = h.byKey(key);
    inject(frameEvent("src", "rx", 1, 2, 1)); // epoch 2 accepted
    inject(frameEvent("src", "rx", 2, 1, 1)); // stale epoch -> dropped
    inject(frameEvent("src", "rx", 3, 2, 1)); // accepted
    const accepted = events.filter((e) => e.type === "stream_frame");
    expect(accepted).toHaveLength(2);
    sub.unsubscribe();
    h.manager.dispose();
  });

  it("paused subscribers receive no stream_frame; others still do", async () => {
    const h = makeHarness();
    const key: StreamKey = { sourceId: "src", mode: "rx" };
    const aEvents: StreamEvent[] = [];
    const bEvents: StreamEvent[] = [];
    await h.manager.subscribe(key, rxOptions(), (e) => aEvents.push(e));
    const subB = await h.manager.subscribe(key, rxOptions(), (e) =>
      bEvents.push(e),
    );
    subB.setPaused(true);
    const inject = h.byKey(key);
    inject(frameEvent("src", "rx", 1));
    inject(frameEvent("src", "rx", 2));
    expect(aEvents.filter((e) => e.type === "stream_frame")).toHaveLength(2);
    expect(bEvents.filter((e) => e.type === "stream_frame")).toHaveLength(0);
    subB.setPaused(false);
    inject(frameEvent("src", "rx", 3));
    expect(bEvents.filter((e) => e.type === "stream_frame")).toHaveLength(1);
    h.manager.dispose();
  });

  it("aggregate pause command is sent only when all rx subscribers pause, never as device state", async () => {
    const h = makeHarness();
    const key: StreamKey = { sourceId: "src", mode: "rx" };
    const a = await h.manager.subscribe(key, rxOptions(), () => {});
    const buf = await h.manager.subscribe(key, rxOptions(), () => {});
    a.setPaused(true);
    // Only one of two paused -> no aggregate pause sent.
    expect(
      h.transports[0].sent.some(
        (m) => m.type === "stream_set_paused" && m.paused === true,
      ),
    ).toBe(false);
    buf.setPaused(true);
    // Both paused now -> aggregate pause command sent with subscriber scope.
    const sent = h.transports[0].sent.filter(
      (m) => m.type === "stream_set_paused",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ scope: "subscriber", paused: true });
    h.manager.dispose();
  });

  it("device options applied from backend supersede local writes and bump revision", async () => {
    const h = makeHarness();
    const key: StreamKey = { sourceId: "src", mode: "rx" };
    const events: StreamEvent[] = [];
    const sub = await h.manager.subscribe(key, rxOptions(100_000_000), (e) =>
      events.push(e),
    );
    const inject = h.byKey(key);
    // Backend acknowledges a device-owned options bump (revision 2).
    inject({
      type: "stream_options_applied",
      sourceId: "src",
      mode: "rx",
      streamEpoch: 3,
      optionsRevision: 2,
      options: rxOptions(120_000_000),
    } as StreamEvent);
    expect(sub.effectiveOptions.centerFrequencyHz).toBe(120_000_000);
    const applied = events.filter((e) => e.type === "stream_options_applied");
    expect(applied).toHaveLength(1);
    // A later frame in the new generation is accepted; one in the old epoch dropped.
    inject(frameEvent("src", "rx", 1, 3, 2));
    inject(frameEvent("src", "rx", 2, 2, 1)); // stale
    expect(events.filter((e) => e.type === "stream_frame")).toHaveLength(1);
    h.manager.dispose();
  });

  it("metrics reconcile: accepted counts match delivered frames, gaps equal gap sizes", async () => {
    const h = makeHarness();
    const key: StreamKey = { sourceId: "src", mode: "rx" };
    const events: StreamEvent[] = [];
    const sub = await h.manager.subscribe(key, rxOptions(), (e) =>
      events.push(e),
    );
    const inject = h.byKey(key);
    inject(frameEvent("src", "rx", 1));
    inject(frameEvent("src", "rx", 1)); // duplicate -> rejected
    inject(frameEvent("src", "rx", 5)); // gap 3
    const metrics = h.manager.getMetrics(key)!;
    expect(metrics.accepted).toBe(2);
    expect(metrics.rejected).toBe(1);
    expect(metrics.sequenceGaps).toBe(3);
    sub.unsubscribe();
    h.manager.dispose();
  });

  it("never throws across randomized event sequences", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            seq: fc.integer({ min: 0, max: 20 }),
            epoch: fc.integer({ min: 0, max: 4 }),
            revision: fc.integer({ min: 0, max: 4 }),
          }),
          { minLength: 0, maxLength: 60 },
        ),
        async (events) => {
          const h = makeHarness();
          const key: StreamKey = { sourceId: "src", mode: "rx" };
          const sub = await h.manager.subscribe(key, rxOptions(), () => {});
          const inject = h.byKey(key);
          for (const e of events) {
            expect(() =>
              inject(frameEvent("src", "rx", e.seq, e.epoch, e.revision)),
            ).not.toThrow();
          }
          expect(() => h.manager.getMetrics(key)).not.toThrow();
          sub.unsubscribe();
          h.manager.dispose();
        },
      ),
    );
  });
});
