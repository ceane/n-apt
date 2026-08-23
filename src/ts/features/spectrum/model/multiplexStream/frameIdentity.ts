/**
 * Canonical frame identity for the multiplexed stream pipeline.
 *
 * Pure module: imports nothing from app/, redux/, or react.
 * See docs/architecture/multiplex-stream-pipeline.md for the contract.
 */

/** Identity carried by every multiplexed stream frame (v2 wire format). */
export type MultiplexStreamFrameId = {
  sourceId: string | null | undefined;
  streamEpoch?: number | null;
  sequence?: number | null;
};

/** The lifecycle a consumer is currently committed to presenting. */
export type MultiplexStreamLifecycle = {
  sourceId: string | null | undefined;
  streamEpoch?: number | null;
};

/** Wire-format frame subset (IqRawFrame / envelope metadata field names). */
export type MultiplexStreamWireFrame = {
  source_id?: string | null;
  stream_epoch?: number | null;
  sequence?: number | null;
};

/** Adapts wire-format frames (snake_case) to the canonical identity shape. */
export const multiplexStreamFrameIdFromWire = (
  frame: MultiplexStreamWireFrame,
): MultiplexStreamFrameId => ({
  sourceId: frame.source_id,
  streamEpoch: frame.stream_epoch,
  sequence: frame.sequence,
});

/** `${sourceId}:${epoch}` lifecycle key; `v1` stands in for absent epochs. */
export const multiplexStreamLifecycleKey = (
  identity: MultiplexStreamFrameId,
): string => `${identity.sourceId ?? ""}:${identity.streamEpoch ?? "v1"}`;

/**
 * Exact lifecycle equality with null-tolerant epochs: identities match when
 * sources match and epochs are equal or either side is untagged. Used by
 * presentation-slot validation (a frozen frame stays valid only for the
 * exact lifecycle that froze it), distinct from the >= freshness admission
 * in `acceptsMultiplexStreamFrame`.
 */
export const sameMultiplexStreamLifecycle = (
  left: MultiplexStreamFrameId,
  right: MultiplexStreamLifecycle,
): boolean =>
  left.sourceId === right.sourceId &&
  ((left.streamEpoch ?? null) === (right.streamEpoch ?? null) ||
    left.streamEpoch == null ||
    right.streamEpoch == null);
