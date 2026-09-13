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

const rxOptions = (
  centerFrequencyHz = 100_000_000,
  sampleRateHz = 2_400_000,
): StreamOptions => ({
  mode: "rx",
  centerFrequencyHz,
  sampleRateHz,
  fftSize: 1024,
});

const txOptions = (sampleRateHz = 2_400_000): StreamOptions => ({
  mode: "tx",
  centerFrequencyHz: 100_000_000,
  sampleRateHz,
  bandwidthHz: sampleRateHz,
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
  sampleRateHz = 2_400_000,
): StreamEvent =>
  ({
    type: "stream_frame",
    sourceId,
    mode,
    streamEpoch,
    optionsRevision,
    sequence,
    timestamp: sequence,
    sampleRateHz,
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
  it("keeps independent subscribers coordinated through tune/pause/hydration churn", async () => {
    type Client = {
      manager: ReturnType<typeof createSourceModeStreamManager>;
      transport: {
        key: StreamKey;
        sent: StreamMessage[];
        onEvent: (event: StreamEvent) => void;
      };
      subscription: Awaited<
        ReturnType<ReturnType<typeof createSourceModeStreamManager>["subscribe"]>
      >;
      events: StreamEvent[];
    };

    type Broker = {
      authoritativeOptions: StreamOptions;
      optionsByRevision: Map<number, StreamOptions>;
      optionsRevision: number;
      streamEpoch: number;
      sequence: number;
      clients: Client[];
      emitFrame: (optionsRevision?: number) => void;
      hydrate: () => void;
    };

    const createBroker = (initialCenterHz: number): Broker => {
      const key: StreamKey = { sourceId: "shared-source", mode: "rx" };
      const broker: Broker = {
        authoritativeOptions: rxOptions(initialCenterHz),
        optionsByRevision: new Map([[1, rxOptions(initialCenterHz)]]),
        optionsRevision: 1,
        streamEpoch: 1,
        sequence: 0,
        clients: [],
        emitFrame: (optionsRevision = broker.optionsRevision) => {
          broker.sequence += 1;
          for (const client of broker.clients) {
            const event = frameEvent(
              key.sourceId,
              key.mode,
              broker.sequence,
              broker.streamEpoch,
              optionsRevision,
            ) as Extract<StreamEvent, { type: "stream_frame" }>;
            event.centerFrequencyHz =
              broker.optionsByRevision.get(optionsRevision)?.mode === "rx"
                ? (
                    broker.optionsByRevision.get(optionsRevision) as Extract<
                      StreamOptions,
                      { mode: "rx" }
                    >
                  ).centerFrequencyHz
                : undefined;
            event.sampleRateHz =
              broker.optionsByRevision.get(optionsRevision)?.sampleRateHz ??
              broker.authoritativeOptions.sampleRateHz;
            event.frame.center_frequency_hz = event.centerFrequencyHz;
            event.frame.sample_rate = event.sampleRateHz;
            client.transport.onEvent(event);
          }
        },
        hydrate: () => {
          for (const client of broker.clients) {
            client.transport.onEvent({
              type: "stream_opened",
              sourceId: key.sourceId,
              mode: key.mode,
              streamEpoch: broker.streamEpoch,
              optionsRevision: broker.optionsRevision,
              state: "ready",
              options: { ...broker.authoritativeOptions },
            });
          }
        },
      };

      return broker;
    };

    const makeClient = async (
      broker: Broker,
      requestedCenterHz: number,
    ): Promise<Client> => {
      const key: StreamKey = { sourceId: "shared-source", mode: "rx" };
      const events: StreamEvent[] = [];
      let transport!: Client["transport"];
      const manager = createSourceModeStreamManager({
        noSubscriberGraceMs: 10_000,
        transportFactory: (transportKey, onEvent) => {
          transport = {
            key: transportKey,
            sent: [],
            onEvent,
          };
          return {
            key: transportKey,
            send: (message: StreamCommand) => {
              transport.sent.push(message);
              if (message.type === "stream_subscribe") {
                // Subscribe is hydration, never a device tune. This is the
                // exact boundary that prevents a second tab's stale local
                // view from changing the shared source center.
                transport.onEvent({
                  type: "stream_opened",
                  sourceId: transportKey.sourceId,
                  mode: transportKey.mode,
                  streamEpoch: broker.streamEpoch,
                  optionsRevision: broker.optionsRevision,
                  state: "ready",
                  options: { ...broker.authoritativeOptions },
                });
              }
              if (message.type === "stream_update_options") {
                broker.authoritativeOptions = { ...message.options };
                broker.optionsRevision += 1;
                broker.optionsByRevision.set(
                  broker.optionsRevision,
                  { ...broker.authoritativeOptions },
                );
                for (const client of broker.clients) {
                  client.transport.onEvent({
                    type: "stream_options_applied",
                    sourceId: transportKey.sourceId,
                    mode: transportKey.mode,
                    streamEpoch: broker.streamEpoch,
                    optionsRevision: broker.optionsRevision,
                    options: { ...broker.authoritativeOptions },
                    origin: "backend",
                  });
                }
              }
            },
            close: () => undefined,
            onEvent,
          };
        },
      });
      const subscription = await manager.subscribe(
        key,
        rxOptions(requestedCenterHz),
        (event) => events.push(event),
      );
      const client = { manager, transport, subscription, events };
      broker.clients.push(client);
      return client;
    };

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          firstRequestedCenterHz: fc.integer({
            // Keep the active view away from every current signals.yaml
            // channel so an accidental channel fallback is obvious.
            min: 50_000_000,
            max: 200_000_000,
          }),
          secondRequestedCenterHz: fc.integer({
            // Deliberately emulate a stale Channel-B client snapshot.
            min: 27_170_000,
            max: 30_370_000,
          }),
          operations: fc.array(
            fc.record({
              client: fc.integer({ min: 0, max: 1 }),
              action: fc.constantFrom(
                "pause",
                "resume",
                "request",
                "tune",
                "frame",
                "stale-frame",
                "hydrate",
                "stale-hydrate",
                "sample-rate",
                "whole-channel",
              ),
              centerDeltaHz: fc.integer({ min: -2_000_000, max: 2_000_000 }),
              sampleRateHz: fc.constantFrom(
                3_200_000,
                4_372_000,
                5_200_000,
                8_000_000,
                12_800_000,
                18_250_000,
                20_000_000,
              ),
            }),
            { minLength: 1, maxLength: 100 },
          ),
        }),
        async ({
          firstRequestedCenterHz,
          secondRequestedCenterHz,
          operations,
        }) => {
          const broker = createBroker(firstRequestedCenterHz);
          const clients = [
            await makeClient(broker, firstRequestedCenterHz),
            await makeClient(broker, secondRequestedCenterHz),
          ];
          const paused = [false, false];
          const pendingFrameRequest = [false, false];

          const assertCoordinated = () => {
            for (const client of clients) {
              expect(client.subscription.effectiveOptions).toEqual(
                broker.authoritativeOptions,
              );
              for (const event of client.events) {
                if (event.type === "stream_frame") {
                  const frameOptions = broker.optionsByRevision.get(
                    event.optionsRevision,
                  );
                  expect(frameOptions).toBeDefined();
                  expect(event.centerFrequencyHz).toBe(
                    frameOptions?.mode === "rx"
                      ? frameOptions.centerFrequencyHz
                      : undefined,
                  );
                  expect(event.sampleRateHz).toBe(frameOptions?.sampleRateHz);
                }
              }
            }
          };

          // Initial requested centers intentionally disagree. Both clients
          // must hydrate to the broker's one device-owned center before any
          // fuzzed interaction begins.
          assertCoordinated();

          for (const [step, operation] of operations.entries()) {
            const clientIndex = operation.client;
            const client = clients[clientIndex];
            switch (operation.action) {
              case "pause":
                client.subscription.setPaused(true);
                paused[clientIndex] = true;
                break;
              case "resume":
                client.subscription.setPaused(false);
                paused[clientIndex] = false;
                break;
              case "request":
                client.subscription.requestNextFrame();
                pendingFrameRequest[clientIndex] = true;
                break;
              case "tune": {
                const nextCenter = Math.max(
                  1_000_000,
                  broker.authoritativeOptions.mode === "rx"
                    ? broker.authoritativeOptions.centerFrequencyHz +
                      operation.centerDeltaHz
                    : 100_000_000,
                );
                await client.subscription.updateOptions(
                  rxOptions(nextCenter, operation.sampleRateHz),
                );
                break;
              }
              case "sample-rate": {
                const currentCenter =
                  broker.authoritativeOptions.mode === "rx"
                    ? broker.authoritativeOptions.centerFrequencyHz
                    : 100_000_000;
                await client.subscription.updateOptions(
                  rxOptions(currentCenter, operation.sampleRateHz),
                );
                break;
              }
              case "whole-channel": {
                const currentCenter =
                  broker.authoritativeOptions.mode === "rx"
                    ? broker.authoritativeOptions.centerFrequencyHz
                    : 100_000_000;
                await client.subscription.updateOptions(
                  rxOptions(currentCenter, 18_250_000),
                );
                break;
              }
              case "frame": {
                const expectedFrames = clients.map(
                  (_, index) =>
                    !paused[index] || pendingFrameRequest[index] ? 1 : 0,
                );
                const before = clients.map(
                  (candidate) =>
                    candidate.events.filter(
                      (event) => event.type === "stream_frame",
                    ).length,
                );
                broker.emitFrame();
                clients.forEach((candidate, index) => {
                  const after = candidate.events.filter(
                    (event) => event.type === "stream_frame",
                  ).length;
                  expect(after - before[index]).toBe(expectedFrames[index]);
                });
                pendingFrameRequest.fill(false);
                break;
              }
              case "stale-frame":
                broker.emitFrame(Math.max(0, broker.optionsRevision - 1));
                break;
              case "hydrate":
                broker.hydrate();
                break;
              case "stale-hydrate": {
                const staleRevision = Math.max(1, broker.optionsRevision - 1);
                const staleOptions = broker.optionsByRevision.get(
                  staleRevision,
                );
                expect(staleOptions).toBeDefined();
                for (const candidate of clients) {
                  candidate.transport.onEvent({
                    type: "stream_opened",
                    sourceId: candidate.transport.key.sourceId,
                    mode: candidate.transport.key.mode,
                    streamEpoch: broker.streamEpoch,
                    optionsRevision: staleRevision,
                    state: "ready",
                    options: { ...staleOptions! },
                  });
                }
                break;
              }
            }

            assertCoordinated();
            expect(broker.optionsRevision).toBeGreaterThanOrEqual(1);
            expect(step).toBeGreaterThanOrEqual(0);
          }

          clients.forEach((client) => client.manager.dispose());
        },
      ),
      { numRuns: 100 },
    );
  });

  it("keeps per-source TX options uniform across clients through fuzzed updates", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            client: fc.integer({ min: 0, max: 1 }),
            action: fc.constantFrom("update", "hydrate", "pause", "resume", "frame"),
            sampleRateHz: fc.constantFrom(
              1_000_000,
              1_200_000,
              2_400_000,
              4_000_000,
              8_000_000,
              12_800_000,
              18_250_000,
            ),
          }),
          { minLength: 1, maxLength: 120 },
        ),
        async (operations) => {
          type TxClient = {
            manager: ReturnType<typeof createSourceModeStreamManager>;
            transport: {
              key: StreamKey;
              sent: StreamMessage[];
              onEvent: (event: StreamEvent) => void;
            };
            subscription: Awaited<
              ReturnType<
                ReturnType<typeof createSourceModeStreamManager>["subscribe"]
              >
            >;
            events: StreamEvent[];
          };

          const key: StreamKey = { sourceId: "shared-tx-source", mode: "tx" };
          const clients: TxClient[] = [];
          let authoritativeOptions = txOptions();
          const optionsByRevision = new Map<number, StreamOptions>([
            [1, authoritativeOptions],
          ]);
          let optionsRevision = 1;
          let sequence = 0;

          const hydrate = () => {
            for (const client of clients) {
              client.transport.onEvent({
                type: "stream_opened",
                sourceId: key.sourceId,
                mode: key.mode,
                streamEpoch: 1,
                optionsRevision,
                state: "ready",
                options: { ...authoritativeOptions },
              });
            }
          };

          const emitFrame = () => {
            sequence += 1;
            for (const client of clients) {
              const event = frameEvent(
                key.sourceId,
                key.mode,
                sequence,
                1,
                optionsRevision,
                authoritativeOptions.sampleRateHz,
              ) as Extract<StreamEvent, { type: "stream_frame" }>;
              event.centerFrequencyHz =
                authoritativeOptions.mode === "tx"
                  ? authoritativeOptions.centerFrequencyHz
                  : undefined;
              event.frame.center_frequency_hz = event.centerFrequencyHz;
              event.frame.sample_rate = authoritativeOptions.sampleRateHz;
              client.transport.onEvent(event);
            }
          };

          const makeClient = async (): Promise<TxClient> => {
            const events: StreamEvent[] = [];
            let transport!: TxClient["transport"];
            const manager = createSourceModeStreamManager({
              noSubscriberGraceMs: 10_000,
              transportFactory: (transportKey, onEvent) => {
                transport = { key: transportKey, sent: [], onEvent };
                return {
                  key: transportKey,
                  send: (message: StreamCommand) => {
                    transport.sent.push(message);
                    if (message.type === "stream_subscribe") {
                      transport.onEvent({
                        type: "stream_opened",
                        sourceId: key.sourceId,
                        mode: key.mode,
                        streamEpoch: 1,
                        optionsRevision,
                        state: "ready",
                        options: { ...authoritativeOptions },
                      });
                    }
                    if (message.type === "stream_update_options") {
                      authoritativeOptions = { ...message.options };
                      optionsRevision += 1;
                      optionsByRevision.set(optionsRevision, {
                        ...authoritativeOptions,
                      });
                      for (const client of clients) {
                        client.transport.onEvent({
                          type: "stream_options_applied",
                          sourceId: key.sourceId,
                          mode: key.mode,
                          streamEpoch: 1,
                          optionsRevision,
                          options: { ...authoritativeOptions },
                          origin: "backend",
                        });
                      }
                    }
                  },
                  close: () => undefined,
                  onEvent,
                } as StreamTransport;
              },
            });
            const subscription = await manager.subscribe(
              key,
              txOptions(),
              (event) => events.push(event),
            );
            const client = { manager, transport, subscription, events };
            clients.push(client);
            return client;
          };

          await makeClient();
          await makeClient();

          const assertUniform = () => {
            for (const client of clients) {
              expect(client.subscription.effectiveOptions).toEqual(
                authoritativeOptions,
              );
              for (const event of client.events) {
                if (event.type === "stream_frame") {
                  const frameOptions = optionsByRevision.get(
                    event.optionsRevision,
                  );
                  expect(frameOptions).toBeDefined();
                  expect(event.sampleRateHz).toBe(
                    frameOptions?.sampleRateHz,
                  );
                }
              }
            }
          };

          assertUniform();
          for (const operation of operations) {
            const client = clients[operation.client];
            switch (operation.action) {
              case "update":
                await client.subscription.updateOptions(
                  txOptions(operation.sampleRateHz),
                );
                break;
              case "hydrate":
                hydrate();
                break;
              case "pause":
                client.subscription.setPaused(true);
                break;
              case "resume":
                client.subscription.setPaused(false);
                break;
              case "frame":
                emitFrame();
                break;
            }
            assertUniform();
          }

          clients.forEach((client) => client.manager.dispose());
        },
      ),
      { numRuns: 100 },
    );
  });

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

  it("never delivers a frame to a subscriber during arbitrary pause/resume churn", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            paused: fc.boolean(),
            emitFrame: fc.boolean(),
          }),
          { minLength: 1, maxLength: 100 },
        ),
        async (operations) => {
          const h = makeHarness();
          const key: StreamKey = { sourceId: "src", mode: "rx" };
          const events: StreamEvent[] = [];
          const sub = await h.manager.subscribe(key, rxOptions(), (event) =>
            events.push(event),
          );
          const inject = h.byKey(key);
          let paused = false;
          let sequence = 1;
          let expectedFrames = 0;

          for (const operation of operations) {
            sub.setPaused(operation.paused);
            paused = operation.paused;
            if (operation.emitFrame) {
              inject(frameEvent("src", "rx", sequence++));
              if (!paused) expectedFrames += 1;
            }
          }

          expect(
            events.filter((event) => event.type === "stream_frame"),
          ).toHaveLength(expectedFrames);
          sub.unsubscribe();
          h.manager.dispose();
        },
      ),
    );
  });

  it("keeps requested paused previews scoped through pause/request churn", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            paused: fc.boolean(),
            requestFrame: fc.boolean(),
            emitFrame: fc.boolean(),
          }),
          { minLength: 1, maxLength: 120 },
        ),
        async (operations) => {
          const h = makeHarness();
          const key: StreamKey = { sourceId: "src", mode: "rx" };
          const pausedEvents: StreamEvent[] = [];
          const activeEvents: StreamEvent[] = [];
          const pausedSub = await h.manager.subscribe(
            key,
            rxOptions(),
            (event) => pausedEvents.push(event),
            { paused: true },
          );
          await h.manager.subscribe(key, rxOptions(), (event) =>
            activeEvents.push(event),
          );

          let paused = true;
          let pendingRequest = false;
          let sequence = 1;
          let expectedPausedFrames = 0;
          let expectedActiveFrames = 0;
          for (const operation of operations) {
            pausedSub.setPaused(operation.paused);
            paused = operation.paused;
            if (operation.requestFrame) {
              pausedSub.requestNextFrame();
              pendingRequest = true;
            }
            if (operation.emitFrame) {
              h.byKey(key)(frameEvent("src", "rx", sequence++));
              expectedActiveFrames += 1;
              if (!paused || pendingRequest) expectedPausedFrames += 1;
              pendingRequest = false;
            }
          }

          expect(
            pausedEvents.filter((event) => event.type === "stream_frame"),
          ).toHaveLength(expectedPausedFrames);
          expect(
            activeEvents.filter((event) => event.type === "stream_frame"),
          ).toHaveLength(expectedActiveFrames);
          pausedSub.unsubscribe();
          h.manager.dispose();
        },
      ),
    );
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
