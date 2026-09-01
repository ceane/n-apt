import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import {
  STREAM_CONTROL_CONTRACT,
  type StreamSubscriberContract,
  type StreamControlScopes,
  type StreamDeliveryPolicy,
} from "./streamContract";

export type StreamMode = "rx" | "tx";

export type StreamKey = {
  sourceId: string;
  mode: StreamMode;
};

export type RxStreamOptions = {
  mode: "rx";
  centerFrequencyHz: number;
  sampleRateHz: number;
  fftSize: number;
  fftWindow?: string;
  frameRate?: number;
  gain?: number;
};

export type TxStreamOptions = {
  mode: "tx";
  centerFrequencyHz: number;
  sampleRateHz: number;
  bandwidthHz: number;
  signal: string;
  powerDbm: number;
  ifftSize: number;
};

export type StreamOptions = RxStreamOptions | TxStreamOptions;

export type StreamFrame = {
  type: "stream_frame";
  sourceId: string;
  mode: StreamMode;
  streamEpoch: number;
  optionsRevision: number;
  sequence: number;
  timestamp: number;
  centerFrequencyHz?: number;
  sampleRateHz: number;
  iqData: Uint8Array;
  frame: IqRawFrame;
};

export type StreamStateEvent = {
  type: "stream_opened" | "stream_state" | "stream_closed";
  sourceId: string;
  mode: StreamMode;
  streamEpoch: number;
  optionsRevision: number;
  state?: "opening" | "ready" | "stopping" | "unavailable" | "error";
  reason?: string;
  /** Authoritative device-owned settings returned during subscription hydration. */
  options?: StreamOptions;
  controlScopes?: StreamControlScopes;
  deliveryPolicy?: StreamDeliveryPolicy;
};

export type StreamOptionsAppliedEvent = {
  type: "stream_options_applied";
  sourceId: string;
  mode: StreamMode;
  streamEpoch: number;
  optionsRevision: number;
  options: StreamOptions;
  /** Identifies an optimistic local echo before backend acknowledgement. */
  origin?: "local" | "backend";
};

export type StreamErrorEvent = {
  type: "stream_error";
  sourceId: string;
  mode: StreamMode;
  streamEpoch: number;
  optionsRevision: number;
  code: string;
  message: string;
};

export type StreamEvent =
  | StreamFrame
  | StreamStateEvent
  | StreamOptionsAppliedEvent
  | StreamErrorEvent;

export type StreamSubscribeCommand = {
  type: "stream_subscribe";
  scope: "subscriber";
  subscriptionId: string;
  stream: StreamKey;
  options: StreamOptions;
  deliveryPolicy?: StreamDeliveryPolicy;
};

export type StreamUpdateOptionsCommand = {
  type: "stream_update_options";
  scope: "device";
  subscriptionId: string;
  stream: StreamKey;
  options: StreamOptions;
};

export type StreamUnsubscribeCommand = {
  type: "stream_unsubscribe";
  scope: "subscriber";
  subscriptionId: string;
  stream: StreamKey;
};

export type StreamSetPausedCommand = {
  type: "stream_set_paused";
  scope: "subscriber";
  subscriptionId: string;
  stream: StreamKey;
  paused: boolean;
};

export type StreamRequestFrameCommand = {
  type: "stream_request_frame";
  scope: "subscriber";
  subscriptionId: string;
  stream: StreamKey;
};

export type StreamSetDeliveryCommand = {
  type: "stream_set_delivery";
  scope: "subscriber";
  subscriptionId: string;
  stream: StreamKey;
  deliveryPolicy: StreamDeliveryPolicy;
};

export type StreamCommand =
  | StreamSubscribeCommand
  | StreamUpdateOptionsCommand
  | StreamUnsubscribeCommand
  | StreamSetPausedCommand
  | StreamRequestFrameCommand
  | StreamSetDeliveryCommand;

export type StreamMessage = StreamEvent | StreamCommand;

export type StreamTransport = {
  key: StreamKey;
  send(message: StreamCommand): void;
  close(): void;
  onEvent(event: StreamEvent): void;
};

export type StreamMetrics = {
  accepted: number;
  rejected: number;
  sequenceGaps: number;
  subscribers: number;
};

export type StreamSubscription = {
  subscriptionId: string;
  stream: StreamKey;
  readonly effectiveOptions: StreamOptions;
  readonly streamEpoch: number;
  readonly deliveryPolicy: StreamDeliveryPolicy;
  setPaused(paused: boolean): void;
  /** Request one fresh frame without resuming continuous delivery. */
  requestNextFrame(): void;
  setDeliveryPolicy(policy: StreamDeliveryPolicy): void;
  unsubscribe(): void;
  updateOptions(options: StreamOptions): Promise<void>;
};

type StreamSubscriber = StreamSubscriberContract & {
  handler: (event: StreamEvent) => void;
  pendingFrameRequest: boolean;
};

type StreamEntry = {
  key: StreamKey;
  options: StreamOptions;
  streamEpoch: number;
  optionsRevision: number;
  lastSequence: number | null;
  transport: StreamTransport;
  subscribers: Map<string, StreamSubscriber>;
  metrics: StreamMetrics;
  localOptionsRevision: number | null;
  transportReady: boolean;
  transportSubscriptionId: string;
  transportDeliveryPolicy: StreamDeliveryPolicy;
};

type SourceModeStreamManagerOptions = {
  transportFactory: (
    key: StreamKey,
    onEvent: (event: StreamEvent) => void,
  ) => StreamTransport;
  noSubscriberGraceMs?: number;
};

const keyFor = ({ sourceId, mode }: StreamKey): string => `${sourceId}\u0000${mode}`;

const cloneOptions = (options: StreamOptions): StreamOptions => ({ ...options });

const optionsEqual = (left: StreamOptions, right: StreamOptions): boolean => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value]) => right[key as keyof StreamOptions] === value);
};

const isOwnedBy = (event: StreamEvent, key: StreamKey): boolean =>
  event.sourceId === key.sourceId && event.mode === key.mode;

export const createSourceModeStreamManager = ({
  transportFactory,
  noSubscriberGraceMs = 250,
}: SourceModeStreamManagerOptions) => {
  const streams = new Map<string, StreamEntry>();
  const pendingCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let nextSubscriptionId = 1;

  const notify = (entry: StreamEntry, event: StreamEvent): void => {
    for (const subscriber of entry.subscribers.values()) {
      if (event.type === "stream_frame") {
        const requestedWhilePaused = subscriber.pendingFrameRequest;
        subscriber.pendingFrameRequest = false;
        if (subscriber.paused && !requestedWhilePaused) continue;
      }
      subscriber.handler(event);
    }
  };

  const applyOptions = (
    entry: StreamEntry,
    options: StreamOptions,
    notifySubscribers: boolean,
  ): void => {
    if (optionsEqual(entry.options, options)) return;

    // The initial subscribe can resolve locally before the WebSocket opens.
    // Fold an early settings change into the desired subscribe options; there
    // is no physical stream to reconfigure yet, so keep revision 1.
    if (!entry.transportReady) {
      entry.options = cloneOptions(options);
      entry.transport.send({
        type: "stream_subscribe",
        scope: "subscriber",
        subscriptionId: entry.transportSubscriptionId,
        stream: entry.key,
        options: cloneOptions(options),
      });
      if (notifySubscribers) {
        notify(entry, {
          type: "stream_options_applied",
          sourceId: entry.key.sourceId,
          mode: entry.key.mode,
          streamEpoch: entry.streamEpoch,
          optionsRevision: entry.optionsRevision,
          origin: "local",
          options: cloneOptions(entry.options),
        });
      }
      return;
    }

    entry.options = cloneOptions(options);
    entry.optionsRevision += 1;
    entry.lastSequence = null;
    entry.localOptionsRevision = entry.optionsRevision;
    entry.transport.send({
      type: "stream_update_options",
      scope: STREAM_CONTROL_CONTRACT[entry.key.mode].settings,
      subscriptionId: entry.transportSubscriptionId,
      stream: entry.key,
      options: cloneOptions(options),
    });
    if (notifySubscribers) {
      notify(entry, {
        type: "stream_options_applied",
        sourceId: entry.key.sourceId,
        mode: entry.key.mode,
        streamEpoch: entry.streamEpoch,
        optionsRevision: entry.optionsRevision,
        origin: "local",
        options: cloneOptions(entry.options),
      });
    }
  };

  const aggregatePausedState = (entry: StreamEntry): boolean | null => {
    if (entry.subscribers.size === 0) return null;
    return [...entry.subscribers.values()].every(
      (subscriber) => subscriber.paused,
    );
  };

  const syncAggregatePausedState = (
    entry: StreamEntry,
    previousAggregate: boolean | null,
  ): void => {
    const nextAggregate = aggregatePausedState(entry);
    if (
      (previousAggregate === null && nextAggregate !== true) ||
      previousAggregate === nextAggregate ||
      nextAggregate === null ||
      entry.key.mode !== "rx"
    ) {
      return;
    }
    entry.transport.send({
      type: "stream_set_paused",
      scope: "subscriber",
      subscriptionId: entry.transportSubscriptionId,
      stream: entry.key,
      paused: nextAggregate,
    });
  };

  const aggregateDeliveryPolicy = (
    entry: StreamEntry,
  ): StreamDeliveryPolicy =>
    [...entry.subscribers.values()].some(
      (subscriber) => subscriber.deliveryPolicy === "lossless",
    )
      ? "lossless"
      : "latest";

  const syncDeliveryPolicy = (entry: StreamEntry): void => {
    const nextPolicy = aggregateDeliveryPolicy(entry);
    if (nextPolicy === entry.transportDeliveryPolicy) return;
    entry.transportDeliveryPolicy = nextPolicy;
    entry.transport.send({
      type: "stream_set_delivery",
      scope: "subscriber",
      subscriptionId: entry.transportSubscriptionId,
      stream: entry.key,
      deliveryPolicy: nextPolicy,
    });
  };

  const handleEvent = (entry: StreamEntry, event: StreamEvent): void => {
    if (!isOwnedBy(event, entry.key)) return;

    if (event.type === "stream_frame") {
      if (event.optionsRevision < entry.optionsRevision) {
        return;
      }
      if (event.streamEpoch < entry.streamEpoch) {
        return;
      }
      if (event.optionsRevision > entry.optionsRevision) {
        entry.optionsRevision = event.optionsRevision;
        entry.lastSequence = null;
      }
      if (event.streamEpoch > entry.streamEpoch) {
        entry.streamEpoch = event.streamEpoch;
        entry.lastSequence = null;
      }
      if (
        entry.lastSequence !== null &&
        event.sequence <= entry.lastSequence
      ) {
        entry.metrics.rejected += 1;
        return;
      }
      if (
        entry.lastSequence !== null &&
        event.sequence > entry.lastSequence + 1
      ) {
        entry.metrics.sequenceGaps += event.sequence - entry.lastSequence - 1;
      }
      entry.lastSequence = event.sequence;
      entry.metrics.accepted += 1;
      notify(entry, event);
      return;
    }

    if (event.type === "stream_options_applied") {
      if (event.optionsRevision < entry.optionsRevision) return;
      // Revisions are device-global, while localOptionsRevision is only this
      // manager's optimistic counter. Another subscriber may have advanced
      // the backend revision before our acknowledgement arrives, so revision
      // equality is not enough to identify our own echo. Matching the pending
      // effective options is safe: every logical subscriber already received
      // the optimistic local event, and there is no state change to re-emit.
      if (
        entry.localOptionsRevision !== null &&
        optionsEqual(event.options, entry.options)
      ) {
        entry.streamEpoch = Math.max(entry.streamEpoch, event.streamEpoch);
        entry.optionsRevision = event.optionsRevision;
        entry.lastSequence = null;
        entry.localOptionsRevision = null;
        return;
      }
      entry.options = cloneOptions(event.options);
      entry.optionsRevision = event.optionsRevision;
      entry.streamEpoch = Math.max(entry.streamEpoch, event.streamEpoch);
      entry.lastSequence = null;
      notify(entry, event);
      return;
    }

    if (event.type === "stream_opened") {
      entry.transportReady = true;
      if (event.options) {
        // The device snapshot wins over the options a subscriber requested.
        // This is the hydration path for late subscribers and reconnects.
        entry.options = cloneOptions(event.options);
      }
      if (event.streamEpoch > 0) {
        // A reconnect starts a fresh physical stream. The server's subscribe
        // response is authoritative for its epoch and revision.
        entry.streamEpoch = event.streamEpoch;
        entry.optionsRevision = event.optionsRevision;
        entry.lastSequence = null;
        entry.localOptionsRevision = null;
      }
    }
    if (event.type === "stream_state" && event.state === "opening") {
      entry.transportReady = false;
    }
    notify(entry, event);
  };

  const closeEntry = (entryKey: string): void => {
    const entry = streams.get(entryKey);
    if (!entry || entry.subscribers.size > 0) return;
    entry.transport.send({
      type: "stream_unsubscribe",
      scope: "subscriber",
      subscriptionId: entry.transportSubscriptionId,
      stream: entry.key,
    });
    entry.transport.close();
    streams.delete(entryKey);
  };

  const subscribe = async (
    key: StreamKey,
    options: StreamOptions,
    handler: (event: StreamEvent) => void,
    subscriberOptions: {
      deliveryPolicy?: StreamDeliveryPolicy;
      paused?: boolean;
    } = {},
  ): Promise<StreamSubscription> => {
    if (key.mode !== options.mode) {
      throw new Error("Stream key mode must match stream options mode");
    }
    if (!key.sourceId.trim()) throw new Error("Stream sourceId is required");
    const deliveryPolicy = subscriberOptions.deliveryPolicy ?? "latest";

    const entryKey = keyFor(key);
    const pendingClose = pendingCloseTimers.get(entryKey);
    if (pendingClose) {
      clearTimeout(pendingClose);
      pendingCloseTimers.delete(entryKey);
    }

    let entry = streams.get(entryKey);
    if (!entry) {
      entry = {
        key: { ...key },
        options: cloneOptions(options),
        streamEpoch: 0,
        optionsRevision: 1,
        lastSequence: null,
        transport: undefined as unknown as StreamTransport,
        subscribers: new Map(),
        metrics: { accepted: 0, rejected: 0, sequenceGaps: 0, subscribers: 0 },
        localOptionsRevision: null,
        transportReady: false,
        transportSubscriptionId: `transport-subscription-${nextSubscriptionId}`,
        transportDeliveryPolicy: deliveryPolicy,
      };
      entry.transport = transportFactory(entry.key, (event) =>
        handleEvent(entry!, event),
      );
      streams.set(entryKey, entry);
      entry.transport.send({
        type: "stream_subscribe",
        scope: "subscriber",
        subscriptionId: entry.transportSubscriptionId,
        stream: entry.key,
        options: cloneOptions(options),
        deliveryPolicy,
      });
    } else {
      // Subscribe is a read/hydration operation once the shared stream
      // exists. Device-scoped changes must use updateOptions; otherwise a
      // late subscriber's stale local settings could overwrite every client.
    }

    const subscriptionId = `stream-subscription-${nextSubscriptionId++}`;
    const previousAggregate = aggregatePausedState(entry);
    entry.subscribers.set(subscriptionId, {
      handler,
      paused: subscriberOptions.paused === true,
      deliveryPolicy,
      pendingFrameRequest: false,
    });
    entry.metrics.subscribers = entry.subscribers.size;
    syncAggregatePausedState(entry, previousAggregate);
    syncDeliveryPolicy(entry);
    let active = true;
    const subscription: StreamSubscription = {
      subscriptionId,
      stream: { ...entry.key },
      get effectiveOptions() {
        return cloneOptions(entry!.options);
      },
      get streamEpoch() {
        return entry!.streamEpoch;
      },
      get deliveryPolicy() {
        return entry!.subscribers.get(subscriptionId)?.deliveryPolicy ?? deliveryPolicy;
      },
      setPaused: (paused) => {
        if (!active) return;
        const subscriber = entry!.subscribers.get(subscriptionId);
        if (!subscriber || subscriber.paused === paused) return;
        const previousAggregate = aggregatePausedState(entry!);
        subscriber.paused = paused;
        syncAggregatePausedState(entry!, previousAggregate);
      },
      requestNextFrame: () => {
        if (!active) return;
        const subscriber = entry!.subscribers.get(subscriptionId);
        if (!subscriber) return;
        subscriber.pendingFrameRequest = true;
        entry!.transport.send({
          type: "stream_request_frame",
          scope: "subscriber",
          subscriptionId: entry!.transportSubscriptionId,
          stream: entry!.key,
        });
      },
      setDeliveryPolicy: (nextPolicy) => {
        if (!active) return;
        const subscriber = entry!.subscribers.get(subscriptionId);
        if (!subscriber || subscriber.deliveryPolicy === nextPolicy) return;
        subscriber.deliveryPolicy = nextPolicy;
        syncDeliveryPolicy(entry!);
      },
      unsubscribe: () => {
        if (!active) return;
        active = false;
        const previousAggregate = aggregatePausedState(entry!);
        entry!.subscribers.delete(subscriptionId);
        entry!.metrics.subscribers = entry!.subscribers.size;
        syncAggregatePausedState(entry!, previousAggregate);
        syncDeliveryPolicy(entry!);
        if (entry!.subscribers.size === 0) {
          const timer = setTimeout(() => {
            pendingCloseTimers.delete(entryKey);
            closeEntry(entryKey);
          }, noSubscriberGraceMs);
          pendingCloseTimers.set(entryKey, timer);
        }
      },
      updateOptions: async (nextOptions) => {
        if (!active) throw new Error("Stream subscription is closed");
        if (nextOptions.mode !== entry!.key.mode) {
          throw new Error("Stream options mode cannot change");
        }
        applyOptions(entry!, nextOptions, true);
      },
    };
    return subscription;
  };

  return {
    subscribe,
    getMetrics: (key: StreamKey): StreamMetrics | null => {
      const entry = streams.get(keyFor(key));
      return entry ? { ...entry.metrics } : null;
    },
    dispose: () => {
      for (const timer of pendingCloseTimers.values()) clearTimeout(timer);
      pendingCloseTimers.clear();
      for (const entry of streams.values()) {
        entry.transport.send({
          type: "stream_unsubscribe",
          scope: "subscriber",
          subscriptionId: entry.transportSubscriptionId,
          stream: entry.key,
        });
        entry.transport.close();
      }
      streams.clear();
    },
  };
};

export type SourceModeStreamManager = ReturnType<
  typeof createSourceModeStreamManager
>;
