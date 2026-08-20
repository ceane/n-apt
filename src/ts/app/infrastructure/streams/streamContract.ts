/**
 * Ownership contract for controls that operate around a shared source/mode
 * stream. A subscriber may freeze its own RX presentation, while controls
 * that change the physical source or transmitter are shared by every client.
 */
export type StreamControlScope = "subscriber" | "device";
export type StreamControlMode = "rx" | "tx";
export type StreamControlAction = "pause" | "stop" | "settings" | "tune";
export type StreamDeliveryPolicy = "latest" | "lossless";

/**
 * State owned by one logical subscriber. The stream manager may derive an
 * aggregate optimization from these states, but never treats that aggregate
 * as device state or sends it back as another subscriber's pause.
 */
export type StreamSubscriberContract = {
  paused: boolean;
  deliveryPolicy: StreamDeliveryPolicy;
};

export type StreamControlScopes = Record<
  StreamControlAction,
  StreamControlScope
>;

export const SUBSCRIBER_CONTROL_SCOPE = "subscriber" as const;
export const DEVICE_CONTROL_SCOPE = "device" as const;

export const STREAM_CONTROL_CONTRACT = {
  rx: {
    pause: "subscriber",
    stop: "device",
    settings: "device",
    tune: "device",
  },
  tx: {
    pause: "device",
    stop: "device",
    settings: "device",
    tune: "device",
  },
} as const satisfies Record<
  StreamControlMode,
  Record<StreamControlAction, StreamControlScope>
>;

export const resolveStreamControlScope = (
  mode: StreamControlMode,
  action: StreamControlAction,
): StreamControlScope => STREAM_CONTROL_CONTRACT[mode][action];
