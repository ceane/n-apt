import { decryptPayloadBytes } from "@n-apt/crypto/webcrypto";
import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import {
  type StreamEvent,
  type StreamKey,
  type StreamCommand,
  type StreamOptions,
  type StreamTransport,
} from "./sourceModeStreamManager";
import type { StreamDeliveryPolicy } from "./streamContract";

type StreamInboundItem =
  | {
      kind: "frame";
      message: Record<string, unknown>;
      deliveryPolicy: StreamDeliveryPolicy;
    }
  | {
      kind: "control";
      message: Record<string, unknown>;
    };

type StreamConnection = {
  key: StreamKey;
  onEvent: (event: StreamEvent) => void;
  subscriptionId: string;
  options: StreamOptions;
  paused: boolean;
  deliveryPolicy: StreamDeliveryPolicy;
  inboundQueue: StreamInboundItem[];
  inboundItemInFlight: boolean;
  losslessLagReported: boolean;
  minimumOptionsRevision: number;
};

type MultiplexedStreamTransportOptions = {
  url: string;
  aesKey: CryptoKey;
  reconnectDelayMs?: number;
  webSocketFactory?: (url: string) => WebSocket;
};

const keyFor = ({ sourceId, mode }: StreamKey): string =>
  `${sourceId}\u0000${mode}`;

const toBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const isStreamOptionsForMode = (
  value: unknown,
  mode: StreamKey["mode"],
): value is StreamOptions => {
  if (!value || typeof value !== "object") return false;
  const options = value as Record<string, unknown>;
  if (
    options.mode !== mode ||
    typeof options.centerFrequencyHz !== "number" ||
    typeof options.sampleRateHz !== "number"
  ) {
    return false;
  }
  return mode === "rx"
    ? typeof options.fftSize === "number"
    : typeof options.bandwidthHz === "number" &&
        typeof options.ifftSize === "number" &&
        typeof options.signal === "string" &&
        typeof options.powerDbm === "number";
};

const streamUrl = (controlUrl: string): string => {
  const url = new URL(controlUrl, window.location.href);
  url.pathname = url.pathname.replace(/\/ws\/?$/, "/ws/streams");
  if (!url.pathname.endsWith("/ws/streams")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/streams`;
  }
  return url.toString();
};

const nsToFinite = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Test seam: exposed so property tests can fuzz frame assembly directly. */
export const makeFrame = async (
  message: Record<string, unknown>,
  aesKey: CryptoKey,
): Promise<StreamEvent> => {
  const sourceId = String(message.sourceId ?? "");
  const mode = message.mode === "tx" ? "tx" : "rx";
  // Garbage numeric fields must never flow NaN/Infinity into the frame — the
  // stream manager's epoch/revision/sequence gating relies on finite numbers.
  const sequence = nsToFinite(message.sequence ?? 0);
  const streamEpoch = nsToFinite(message.streamEpoch ?? 0);
  const optionsRevision = nsToFinite(message.optionsRevision ?? 0);
  const timestamp = nsToFinite(message.timestamp ?? 0);
  const iqData = await decryptPayloadBytes(
    aesKey,
    String(message.iqData ?? ""),
  );
  const centerFrequencyHz =
    typeof message.centerFrequencyHz === "number" &&
    Number.isFinite(message.centerFrequencyHz)
      ? message.centerFrequencyHz
      : undefined;
  const sampleRateHz =
    typeof message.sampleRateHz === "number" &&
    Number.isFinite(message.sampleRateHz)
      ? message.sampleRateHz
      : undefined;
  const frame: IqRawFrame = {
    type: "spectrum",
    data_type: "iq_raw",
    source_id: sourceId,
    protocol_version: 2,
    stream_epoch: streamEpoch,
    sequence,
    timestamp,
    center_frequency_hz: centerFrequencyHz,
    sample_rate: sampleRateHz,
    frame_status: mode === "tx" ? "transmitting" : "receiving",
    iq_data: iqData,
  };
  return {
    type: "stream_frame",
    sourceId,
    mode,
    streamEpoch,
    optionsRevision,
    sequence,
    timestamp,
    centerFrequencyHz,
    sampleRateHz: sampleRateHz ?? 0,
    iqData,
    frame,
  };
};

const MAX_PENDING_LOSSLESS_FRAMES = 32;

const frameOptionsRevision = (item: StreamInboundItem): number =>
  item.kind === "frame" ? Number(item.message.optionsRevision ?? 0) : 0;

const advanceOptionsRevision = (
  connection: StreamConnection,
  optionsRevision: number,
): void => {
  if (
    !Number.isFinite(optionsRevision) ||
    optionsRevision <= connection.minimumOptionsRevision
  ) {
    return;
  }
  connection.minimumOptionsRevision = optionsRevision;
  // Lossless applies within one tuning contract. Frames from an older device
  // window can no longer be presented after a retune and must not delay the
  // first frame that matches the new center frequency.
  connection.inboundQueue = connection.inboundQueue.filter(
    (item) =>
      item.kind !== "frame" ||
      frameOptionsRevision(item) >= connection.minimumOptionsRevision,
  );
  connection.losslessLagReported = false;
};

const drainInbound = (
  connection: StreamConnection,
  aesKey: CryptoKey,
): void => {
  if (connection.inboundItemInFlight) return;

  const nextItem = connection.inboundQueue.shift();
  if (!nextItem) return;
  if (nextItem.kind === "control") {
    connection.onEvent(nextItem.message as unknown as StreamEvent);
    drainInbound(connection, aesKey);
    return;
  }
  connection.inboundItemInFlight = true;

  void makeFrame(nextItem.message, aesKey)
    .then((frame) => {
      if (frame.optionsRevision >= connection.minimumOptionsRevision) {
        connection.onEvent(frame);
      }
    })
    .catch(() => {
      connection.onEvent({
        type: "stream_error",
        sourceId: connection.key.sourceId,
        mode: connection.key.mode,
        streamEpoch: 0,
        optionsRevision: 0,
        code: "transport",
        message: "failed to decrypt stream frame",
      });
    })
    .finally(() => {
      connection.inboundItemInFlight = false;
      const queuedLosslessFrames = connection.inboundQueue.filter(
        (item) =>
          item.kind === "frame" && item.deliveryPolicy === "lossless",
      ).length;
      if (queuedLosslessFrames < MAX_PENDING_LOSSLESS_FRAMES) {
        connection.losslessLagReported = false;
      }
      drainInbound(connection, aesKey);
    });
};

const enqueueFrame = (
  connection: StreamConnection,
  message: Record<string, unknown>,
  aesKey: CryptoKey,
): void => {
  const optionsRevision = Number(message.optionsRevision ?? 0);
  if (optionsRevision > connection.minimumOptionsRevision) {
    advanceOptionsRevision(connection, optionsRevision);
  }
  if (optionsRevision < connection.minimumOptionsRevision) return;

  if (connection.deliveryPolicy === "lossless") {
    const queuedLosslessFrames = connection.inboundQueue.filter(
      (item) => item.kind === "frame" && item.deliveryPolicy === "lossless",
    ).length;
    if (queuedLosslessFrames >= MAX_PENDING_LOSSLESS_FRAMES) {
      if (!connection.losslessLagReported) {
        connection.losslessLagReported = true;
        connection.onEvent({
          type: "stream_error",
          sourceId: connection.key.sourceId,
          mode: connection.key.mode,
          streamEpoch: 0,
          optionsRevision: 0,
          code: "lagged",
          message: `lossless subscriber decode queue exceeded ${MAX_PENDING_LOSSLESS_FRAMES} frames`,
        });
      }
      return;
    }
    connection.inboundQueue.push({
      kind: "frame",
      message,
      deliveryPolicy: "lossless",
    });
  } else {
    // Decryption is asynchronous. Keep one frame in flight and replace the
    // queued frame while it is pending so a slow browser cannot accumulate
    // crypto work for frames that the visualizer will never paint.
    const lastItem = connection.inboundQueue[connection.inboundQueue.length - 1];
    if (
      lastItem?.kind === "frame" &&
      lastItem.deliveryPolicy === "latest"
    ) {
      lastItem.message = message;
    } else {
      connection.inboundQueue.push({
        kind: "frame",
        message,
        deliveryPolicy: "latest",
      });
    }
  }

  drainInbound(connection, aesKey);
};

const enqueueControl = (
  connection: StreamConnection,
  message: Record<string, unknown>,
  aesKey: CryptoKey,
): void => {
  connection.inboundQueue.push({ kind: "control", message });
  drainInbound(connection, aesKey);
};

/**
 * One authenticated browser WebSocket carrying every active source/mode
 * subscription. The stream manager owns logical subscriptions; this adapter
 * owns only the shared transport and restores its desired subscriptions after
 * reconnect.
 */
export const createMultiplexedStreamTransport = ({
  url,
  aesKey,
  reconnectDelayMs = 250,
  webSocketFactory = (socketUrl) => new WebSocket(socketUrl),
}: MultiplexedStreamTransportOptions) => {
  const connections = new Map<string, StreamConnection>();
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const send = (message: StreamCommand): void => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const sendAllSubscriptions = (): void => {
    for (const connection of connections.values()) {
      send({
        type: "stream_subscribe",
        scope: "subscriber",
        subscriptionId: connection.subscriptionId,
        stream: connection.key,
        options: connection.options,
        deliveryPolicy: connection.deliveryPolicy,
      });
      if (connection.paused && connection.key.mode === "rx") {
        send({
          type: "stream_set_paused",
          scope: "subscriber",
          subscriptionId: connection.subscriptionId,
          stream: connection.key,
          paused: true,
        });
      }
    }
  };

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer !== null || connections.size === 0) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  };

  const connect = (): void => {
    if (disposed || socket || connections.size === 0) return;
    const nextSocket = webSocketFactory(streamUrl(url));
    socket = nextSocket;
    nextSocket.onopen = () => {
      if (socket !== nextSocket) return;
      // Put the subscribe commands on the wire before notifying consumers.
      // Consumers may immediately re-read settings in response to the open
      // event, and those updates must follow the server-side subscribe.
      sendAllSubscriptions();
      for (const connection of connections.values()) {
        connection.onEvent({
          type: "stream_opened",
          sourceId: connection.key.sourceId,
          mode: connection.key.mode,
          streamEpoch: 0,
          optionsRevision: 1,
          state: "ready",
        });
      }
    };
    nextSocket.onmessage = (event) => {
      if (socket !== nextSocket || typeof event.data !== "string") return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      const key =
        typeof message.sourceId === "string" &&
        (message.mode === "rx" || message.mode === "tx")
          ? keyFor({
              sourceId: message.sourceId,
              mode: message.mode,
            })
          : null;
      if (!key) return;
      const connection = connections.get(key);
      if (!connection) return;
      if (message.type === "stream_subscribed") {
        const effectiveOptions = isStreamOptionsForMode(
          message.effectiveOptions,
          connection.key.mode,
        )
          ? message.effectiveOptions
          : undefined;
        const effectiveDeliveryPolicy: StreamDeliveryPolicy =
          message.deliveryPolicy === "latest" ? "latest" : "lossless";
        connection.deliveryPolicy = effectiveDeliveryPolicy;
        advanceOptionsRevision(
          connection,
          Number(message.optionsRevision ?? 1),
        );
        enqueueControl(connection, {
          type: "stream_opened",
          sourceId: connection.key.sourceId,
          mode: connection.key.mode,
          streamEpoch: Number(message.streamEpoch ?? 0),
          optionsRevision: Number(message.optionsRevision ?? 1),
          state:
            message.state === "unavailable" || message.state === "opening"
              ? message.state
              : "ready",
          options: effectiveOptions,
          controlScopes:
            message.controlScopes as import("./streamContract").StreamControlScopes,
          deliveryPolicy: effectiveDeliveryPolicy,
        }, aesKey);
        return;
      }
      if (message.type === "stream_unsubscribe") return;
      if (message.type === "stream_frame") {
        enqueueFrame(connection, message, aesKey);
        return;
      }
      if (message.type === "stream_options_applied") {
        advanceOptionsRevision(
          connection,
          Number(message.optionsRevision ?? 0),
        );
      }
      enqueueControl(connection, message, aesKey);
    };
    nextSocket.onerror = () => nextSocket.close();
    nextSocket.onclose = () => {
      if (socket !== nextSocket) return;
      socket = null;
      for (const connection of connections.values()) {
        connection.onEvent({
          type: "stream_state",
          sourceId: connection.key.sourceId,
          mode: connection.key.mode,
          streamEpoch: 0,
          optionsRevision: 1,
          state: "opening",
          reason: "stream transport reconnecting",
        });
      }
      scheduleReconnect();
    };
  };

  const transportFactory = (
    key: StreamKey,
    onEvent: (event: StreamEvent) => void,
  ): StreamTransport => {
    const entry: StreamConnection = {
      key: { ...key },
      onEvent,
      subscriptionId: `transport-${keyFor(key)}`,
      options: { mode: key.mode } as StreamOptions,
      paused: false,
      deliveryPolicy: "lossless",
      inboundQueue: [],
      inboundItemInFlight: false,
      losslessLagReported: false,
      minimumOptionsRevision: 1,
    };
    connections.set(keyFor(key), entry);
    connect();
    return {
      key: entry.key,
      send(message) {
        if (message.type === "stream_subscribe") {
          entry.subscriptionId = message.subscriptionId;
          entry.options = message.options;
          entry.deliveryPolicy = message.deliveryPolicy ?? "lossless";
        } else if (message.type === "stream_update_options") {
          entry.options = message.options;
          advanceOptionsRevision(entry, entry.minimumOptionsRevision + 1);
        } else if (message.type === "stream_set_paused") {
          entry.paused = message.paused;
        } else if (message.type === "stream_set_delivery") {
          entry.deliveryPolicy = message.deliveryPolicy;
        }
        send(message);
      },
      close() {
        connections.delete(keyFor(key));
        if (connections.size === 0 && reconnectTimer !== null) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      },
      onEvent,
    };
  };

  return {
    transportFactory,
    dispose() {
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      connections.clear();
      socket?.close();
      socket = null;
    },
  };
};
