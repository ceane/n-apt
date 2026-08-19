import { decryptPayloadBytes } from "@n-apt/crypto/webcrypto";
import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import {
  type StreamEvent,
  type StreamKey,
  type StreamCommand,
  type StreamOptions,
  type StreamTransport,
} from "./sourceModeStreamManager";

type StreamConnection = {
  key: StreamKey;
  onEvent: (event: StreamEvent) => void;
  subscriptionId: string;
  options: StreamOptions;
  paused: boolean;
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

const makeFrame = async (
  message: Record<string, unknown>,
  aesKey: CryptoKey,
): Promise<StreamEvent> => {
  const sourceId = String(message.sourceId ?? "");
  const mode = message.mode === "tx" ? "tx" : "rx";
  const sequence = Number(message.sequence ?? 0);
  const streamEpoch = Number(message.streamEpoch ?? 0);
  const optionsRevision = Number(message.optionsRevision ?? 0);
  const iqData = await decryptPayloadBytes(
    aesKey,
    String(message.iqData ?? ""),
  );
  const frame: IqRawFrame = {
    type: "spectrum",
    data_type: "iq_raw",
    source_id: sourceId,
    protocol_version: 2,
    stream_epoch: streamEpoch,
    sequence,
    timestamp: Number(message.timestamp ?? 0),
    center_frequency_hz:
      typeof message.centerFrequencyHz === "number"
        ? message.centerFrequencyHz
        : undefined,
    sample_rate:
      typeof message.sampleRateHz === "number"
        ? message.sampleRateHz
        : undefined,
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
    timestamp: frame.timestamp ?? 0,
    centerFrequencyHz: frame.center_frequency_hz,
    sampleRateHz: Number(message.sampleRateHz ?? 0),
    iqData,
    frame,
  };
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
        connection.onEvent({
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
        });
        return;
      }
      if (message.type === "stream_unsubscribe") return;
      if (message.type === "stream_frame") {
        void makeFrame(message, aesKey)
          .then((frame) => {
            connection.onEvent(frame);
          })
          .catch((error) => {
            connection.onEvent({
              type: "stream_error",
              sourceId: connection.key.sourceId,
              mode: connection.key.mode,
              streamEpoch: 0,
              optionsRevision: 0,
              code: "transport",
              message: "failed to decrypt stream frame",
            });
          });
        return;
      }
      connection.onEvent(message as unknown as StreamEvent);
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
    };
    connections.set(keyFor(key), entry);
    connect();
    return {
      key: entry.key,
      send(message) {
        if (message.type === "stream_subscribe") {
          entry.subscriptionId = message.subscriptionId;
          entry.options = message.options;
        } else if (message.type === "stream_update_options") {
          entry.options = message.options;
        } else if (message.type === "stream_set_paused") {
          entry.paused = message.paused;
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
