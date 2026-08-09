import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import {
  decodeIqFrameEnvelope,
  type DecodedIqFrameEnvelope,
} from "./iqStreamProtocol";

/** Source lifecycle used to reject decrypted work after an async handoff. */
export type IqFramePumpLifecycle = {
  sourceId: string | null;
  streamEpoch?: number | null;
};

/** Diagnostic counters for bounded live-frame delivery. */
export type IqFramePumpStats = {
  accepted: number;
  rejected: number;
  dropped: number;
  sequenceGaps: number;
  decryptionFailures: number;
};

/** Imperative socket-local frame queue with read-only diagnostic counters. */
export type IqFramePump = {
  enqueue(buffer: ArrayBuffer, fallbackSourceId: string): void;
  reset(): void;
  stats(): Readonly<IqFramePumpStats>;
};

type PendingEnvelope = DecodedIqFrameEnvelope;

const sameLifecycle = (
  envelope: PendingEnvelope,
  lifecycle: IqFramePumpLifecycle,
): boolean => {
  if (envelope.metadata.source_id !== lifecycle.sourceId) return false;
  if (envelope.metadata.protocol_version === 1) return true;
  if (envelope.metadata.stream_epoch === undefined) return false;
  return (
    lifecycle.streamEpoch == null ||
    envelope.metadata.stream_epoch >= lifecycle.streamEpoch
  );
};

/**
 * Create a bounded, ordered decrypt queue for high-frequency I/Q frames.
 *
 * Work is revalidated after every await so a frame from a replaced socket can
 * never publish into an older source lifecycle. A newer same-source v2 epoch
 * is adopted from the data plane when control metadata lags. Queue pressure
 * replaces pending work and preserves only the freshest visualization frame.
 * The frame currently being decrypted is not counted as pending, so one newer
 * frame can always replace the queue while asynchronous work is in flight.
 */
export const createIqFramePump = ({
  decrypt,
  publish,
  getLifecycle,
  maxPending = 1,
  onDecryptionFailure,
  onLifecycleChange,
  onFirstFrameAccepted,
}: {
  decrypt: (payload: Uint8Array) => Promise<Uint8Array>;
  publish: (frame: IqRawFrame) => void;
  getLifecycle: () => IqFramePumpLifecycle;
  maxPending?: number;
  onDecryptionFailure?: () => void;
  onLifecycleChange?: (sourceId: string, streamEpoch: number) => void;
  /** Emits once per source/epoch after validation and decryption succeed. */
  onFirstFrameAccepted?: (frame: IqRawFrame) => void;
}): IqFramePump => {
  const pending: PendingEnvelope[] = [];
  const counters: IqFramePumpStats = {
    accepted: 0,
    rejected: 0,
    dropped: 0,
    sequenceGaps: 0,
    decryptionFailures: 0,
  };
  let draining = false;
  let generation = 0;
  let lastSequence: { epoch: number; value: number } | null = null;
  let lastReadyLifecycleKey: string | null = null;

  const drain = async () => {
    if (draining) return;
    draining = true;
    const drainGeneration = generation;
    try {
      while (pending.length > 0 && drainGeneration === generation) {
        const envelope = pending.shift()!;
        if (!sameLifecycle(envelope, getLifecycle())) {
          counters.rejected += 1;
          continue;
        }

        let iqData: Uint8Array;
        try {
          iqData = await decrypt(envelope.encryptedPayload);
        } catch {
          counters.decryptionFailures += 1;
          onDecryptionFailure?.();
          continue;
        }
        if (
          drainGeneration !== generation ||
          !sameLifecycle(envelope, getLifecycle())
        ) {
          counters.rejected += 1;
          continue;
        }

        const { metadata } = envelope;
        if (
          metadata.protocol_version === 2 &&
          metadata.stream_epoch !== undefined &&
          metadata.sequence !== undefined
        ) {
          const lifecycle = getLifecycle();
          if (
            lifecycle.streamEpoch == null ||
            metadata.stream_epoch > lifecycle.streamEpoch
          ) {
            onLifecycleChange?.(metadata.source_id, metadata.stream_epoch);
          }
          if (
            lastSequence?.epoch === metadata.stream_epoch &&
            metadata.sequence <= lastSequence.value
          ) {
            counters.rejected += 1;
            continue;
          }
          if (
            lastSequence?.epoch === metadata.stream_epoch &&
            metadata.sequence > lastSequence.value + 1
          ) {
            counters.sequenceGaps += metadata.sequence - lastSequence.value - 1;
          }
          lastSequence = {
            epoch: metadata.stream_epoch,
            value: metadata.sequence,
          };
        }

        const framePayload = {
          type: "spectrum",
          data_type: "iq_raw",
          is_mock_apt: (metadata.flags ?? 0) & 1 ? true : false,
          center_frequency_hz: metadata.center_frequency_hz,
          waveform_span_hz: null,
          timestamp: metadata.timestamp,
          sample_rate: metadata.sample_rate,
          iq_data: iqData,
        } as const;
        const publishedFrame: IqRawFrame =
          metadata.protocol_version === 2
            ? {
                ...framePayload,
                protocol_version: 2,
                source_id: metadata.source_id,
                stream_epoch: metadata.stream_epoch!,
                sequence: metadata.sequence!,
                frame_status: metadata.frame_status,
                ...(metadata.frame_status === "standby"
                  ? { is_tx_preview: true }
                  : {}),
              }
            : {
                ...framePayload,
                protocol_version: 1,
                source_id: metadata.source_id,
              };
        publish(publishedFrame);
        const readyLifecycleKey = `${metadata.source_id}:${metadata.stream_epoch ?? "v1"}`;
        if (readyLifecycleKey !== lastReadyLifecycleKey) {
          lastReadyLifecycleKey = readyLifecycleKey;
          onFirstFrameAccepted?.(publishedFrame);
        }
        counters.accepted += 1;
      }
    } finally {
      draining = false;
      if (pending.length > 0) void drain();
    }
  };

  return {
    enqueue(buffer, fallbackSourceId) {
      let envelope: PendingEnvelope;
      try {
        envelope = decodeIqFrameEnvelope(buffer, fallbackSourceId);
      } catch {
        counters.rejected += 1;
        return;
      }
      if (envelope.metadata.data_type !== 1) {
        counters.rejected += 1;
        return;
      }
      const queuedLimit = Math.max(1, maxPending);
      while (pending.length >= queuedLimit) {
        pending.shift();
        counters.dropped += 1;
      }
      pending.push(envelope);
      void drain();
    },
    reset() {
      generation += 1;
      counters.dropped += pending.length;
      pending.length = 0;
      lastSequence = null;
      lastReadyLifecycleKey = null;
    },
    stats() {
      return { ...counters };
    },
  };
};
