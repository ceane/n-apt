import {
  createSourceModeStreamManager,
  type StreamEvent,
  type StreamKey,
  type StreamMessage,
  type StreamOptions,
  type StreamTransport,
} from "@n-apt/app/infrastructure/streams/sourceModeStreamManager";

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

const streamFrame = (
  sourceId: string,
  mode: "rx" | "tx",
  sequence: number,
  iqData: Uint8Array,
): StreamEvent => ({
  type: "stream_frame",
  sourceId,
  mode,
  streamEpoch: 1,
  optionsRevision: 1,
  sequence,
  timestamp: sequence,
  sampleRateHz: 2_400_000,
  iqData,
  frame: {
    type: "spectrum",
    data_type: "iq_raw",
    iq_data: iqData,
    protocol_version: 2,
    source_id: sourceId,
    stream_epoch: 1,
    sequence,
  },
});

type TestTransport = StreamTransport & {
  events: Array<StreamEvent>;
  sent: Array<StreamMessage>;
  closed: boolean;
};

const createTransportFactory = () => {
  const transports: TestTransport[] = [];
  const factory = (key: StreamKey, onEvent: (event: StreamEvent) => void) => {
    const transport: TestTransport = {
      key,
      events: [],
      sent: [],
      closed: false,
      send(event) {
        transport.sent.push(event);
      },
      close() {
        transport.closed = true;
      },
      onEvent(event) {
        transport.events.push(event);
        onEvent(event);
      },
    };
    transports.push(transport);
    return transport;
  };
  return { factory, transports };
};

describe("SourceModeStreamManager", () => {
  it("deduplicates one physical stream and fans each frame to multiple subscribers", async () => {
    const { factory, transports } = createTransportFactory();
    const manager = createSourceModeStreamManager({ transportFactory: factory });
    const first: StreamEvent[] = [];
    const second: StreamEvent[] = [];
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };

    const firstSubscription = await manager.subscribe(
      key,
      rxOptions(),
      (event) => first.push(event),
    );
    const secondSubscription = await manager.subscribe(
      key,
      rxOptions(),
      (event) => second.push(event),
    );

    expect(transports).toHaveLength(1);
    expect(firstSubscription.stream).toEqual(key);
    expect(secondSubscription.stream).toEqual(key);

    transports[0].onEvent(
      streamFrame("source-a", "rx", 7, new Uint8Array([128, 129])),
    );

    expect(first[first.length - 1]).toEqual(second[second.length - 1]);
    expect(first[first.length - 1]).toEqual(
      expect.objectContaining({ sequence: 7, streamEpoch: 1 }),
    );

    firstSubscription.unsubscribe();
    expect(transports[0].closed).toBe(false);
    secondSubscription.unsubscribe();
    expect(transports[0].closed).toBe(false);
    manager.dispose();
    expect(transports[0].closed).toBe(true);
  });

  it("does not let a late subscriber overwrite device-owned options", async () => {
    const { factory, transports } = createTransportFactory();
    const manager = createSourceModeStreamManager({ transportFactory: factory });
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };

    const firstSubscription = await manager.subscribe(key, rxOptions(), () => {
      // no-op
    });
    const secondSubscription = await manager.subscribe(
      key,
      rxOptions(101_000_000),
      () => {
        // no-op
      },
    );

    expect(transports[0].sent).toHaveLength(1);
    expect(secondSubscription.effectiveOptions).toEqual(rxOptions());
    expect(firstSubscription.effectiveOptions).toEqual(rxOptions());
  });

  it("pauses one subscriber without pausing another subscriber", async () => {
    const { factory, transports } = createTransportFactory();
    const manager = createSourceModeStreamManager({ transportFactory: factory });
    const first: StreamEvent[] = [];
    const second: StreamEvent[] = [];
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };

    const firstSubscription = await manager.subscribe(
      key,
      rxOptions(),
      (event) => first.push(event),
    );
    await manager.subscribe(key, rxOptions(), (event) => second.push(event));

    firstSubscription.setPaused(true);
    transports[0].onEvent(
      streamFrame("source-a", "rx", 8, new Uint8Array([130, 131])),
    );

    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
    expect(second[0]).toEqual(expect.objectContaining({ sequence: 8 }));
  });

  it("pauses the physical stream only when every logical subscriber is paused", async () => {
    const { factory, transports } = createTransportFactory();
    const manager = createSourceModeStreamManager({ transportFactory: factory });
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };

    const firstSubscription = await manager.subscribe(key, rxOptions(), () => {
      // no-op
    });
    const secondSubscription = await manager.subscribe(key, rxOptions(), () => {
      // no-op
    });

    firstSubscription.setPaused(true);
    expect(transports[0].sent).not.toContainEqual(
      expect.objectContaining({ type: "stream_set_paused", paused: true }),
    );

    secondSubscription.setPaused(true);
    expect(transports[0].sent).toContainEqual({
      type: "stream_set_paused",
      scope: "subscriber",
      subscriptionId: "transport-subscription-1",
      stream: key,
      paused: true,
    });

    firstSubscription.setPaused(false);
    expect(transports[0].sent).toContainEqual(
      expect.objectContaining({ type: "stream_set_paused", paused: false }),
    );
  });

  it("reconfigures the shared stream and notifies all subscribers", async () => {
    const { factory, transports } = createTransportFactory();
    const manager = createSourceModeStreamManager({ transportFactory: factory });
    const first: StreamEvent[] = [];
    const second: StreamEvent[] = [];
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };

    const firstSubscription = await manager.subscribe(
      key,
      rxOptions(),
      (event) => first.push(event),
    );
    await manager.subscribe(key, rxOptions(), (event) => second.push(event));

    transports[0].onEvent({
      type: "stream_opened",
      sourceId: key.sourceId,
      mode: key.mode,
      streamEpoch: 1,
      optionsRevision: 1,
      state: "ready",
    });

    await firstSubscription.updateOptions(rxOptions(101_000_000));

    expect(transports[0].sent).toContainEqual(
      expect.objectContaining({
        type: "stream_update_options",
        scope: "device",
        options: expect.objectContaining({ centerFrequencyHz: 101_000_000 }),
      }),
    );
    expect(first).toContainEqual(
      expect.objectContaining({
        type: "stream_options_applied",
        optionsRevision: 2,
        options: expect.objectContaining({ centerFrequencyHz: 101_000_000 }),
      }),
    );
    expect(second).toContainEqual(
      expect.objectContaining({
        type: "stream_options_applied",
        optionsRevision: 2,
      }),
    );
  });

  it("hydrates a late subscriber from the device-owned effective options", async () => {
    const { factory, transports } = createTransportFactory();
    const manager = createSourceModeStreamManager({ transportFactory: factory });
    const events: StreamEvent[] = [];
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };
    const subscription = await manager.subscribe(key, rxOptions(), (event) =>
      events.push(event),
    );
    const effectiveOptions = rxOptions(101_000_000);

    transports[0].onEvent({
      type: "stream_opened",
      sourceId: key.sourceId,
      mode: key.mode,
      streamEpoch: 7,
      optionsRevision: 4,
      state: "ready",
      options: effectiveOptions,
    });

    expect(subscription.effectiveOptions).toEqual(effectiveOptions);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "stream_opened",
        options: effectiveOptions,
        optionsRevision: 4,
      }),
    );
  });

  it("coalesces an option change made before the transport opens", async () => {
    const { factory, transports } = createTransportFactory();
    const manager = createSourceModeStreamManager({ transportFactory: factory });
    const events: StreamEvent[] = [];
    const key: StreamKey = { sourceId: "source-a", mode: "rx" };

    const subscription = await manager.subscribe(
      key,
      rxOptions(),
      (event) => events.push(event),
    );

    await subscription.updateOptions(rxOptions(101_000_000));

    expect(transports[0].sent).not.toContainEqual(
      expect.objectContaining({ type: "stream_update_options" }),
    );
    expect(subscription.effectiveOptions).toEqual(
      expect.objectContaining({ centerFrequencyHz: 101_000_000 }),
    );

    transports[0].onEvent({
      type: "stream_opened",
      sourceId: key.sourceId,
      mode: key.mode,
      streamEpoch: 0,
      optionsRevision: 1,
      state: "ready",
    });
    transports[0].onEvent(
      streamFrame("source-a", "rx", 1, new Uint8Array([128, 129])),
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: "stream_frame", sequence: 1 }),
    );
  });

  it("keeps source and mode streams independent", async () => {
    const { factory, transports } = createTransportFactory();
    const manager = createSourceModeStreamManager({ transportFactory: factory });
    const rxEvents: StreamEvent[] = [];
    const txEvents: StreamEvent[] = [];

    await manager.subscribe(
      { sourceId: "source-a", mode: "rx" },
      rxOptions(),
      (event) => rxEvents.push(event),
    );
    await manager.subscribe(
      { sourceId: "source-b", mode: "rx" },
      rxOptions(200_000_000),
      () => undefined,
    );
    await manager.subscribe(
      { sourceId: "source-a", mode: "tx" },
      txOptions(),
      (event) => txEvents.push(event),
    );

    expect(transports).toHaveLength(3);
    transports[0].onEvent(
      streamFrame("source-a", "rx", 1, new Uint8Array([1, 2])),
    );
    transports[2].onEvent(
      streamFrame("source-a", "tx", 1, new Uint8Array([3, 4])),
    );

    expect(rxEvents).toHaveLength(1);
    expect(txEvents).toHaveLength(1);
    expect(rxEvents[0]).toEqual(expect.objectContaining({ mode: "rx" }));
    expect(txEvents[0]).toEqual(expect.objectContaining({ mode: "tx" }));
  });

  it("rejects stale frames and records sequence gaps", async () => {
    const { factory, transports } = createTransportFactory();
    const manager = createSourceModeStreamManager({ transportFactory: factory });
    const events: StreamEvent[] = [];
    await manager.subscribe(
      { sourceId: "source-a", mode: "rx" },
      rxOptions(),
      (event) => events.push(event),
    );

    transports[0].onEvent(streamFrame("source-a", "rx", 1, new Uint8Array([1, 2])));
    transports[0].onEvent(streamFrame("source-a", "rx", 4, new Uint8Array([3, 4])));
    transports[0].onEvent(streamFrame("source-a", "rx", 2, new Uint8Array([5, 6])));

    expect(events).toHaveLength(2);
    expect(manager.getMetrics({ sourceId: "source-a", mode: "rx" })).toEqual(
      expect.objectContaining({ accepted: 2, rejected: 1, sequenceGaps: 2 }),
    );
  });
});
