/**
 * Frame acceptance rules for the multiplexed stream pipeline.
 *
 * This module is the single owner of "does this frame belong here". It
 * absorbs the acceptance rules that previously lived independently in the
 * retired IQ frame pump (`sameLifecycle`), the canvas frame gate
 * (`shouldAcceptWebGpuStreamFrame`), and the presentation-slot epoch
 * validation in `frameRuntime`.
 *
 * Pure module: imports nothing from app/, redux/, or react.
 * See docs/architecture/multiplex-stream-pipeline.md for the contract.
 */

import {
  multiplexStreamFrameIdFromWire,
  multiplexStreamLifecycleKey,
  type MultiplexStreamFrameId,
  type MultiplexStreamLifecycle,
} from "./frameIdentity";

export {
  multiplexStreamFrameIdFromWire,
  sameMultiplexStreamLifecycle,
  type MultiplexStreamFrameId,
  type MultiplexStreamLifecycle,
  type MultiplexStreamWireFrame,
} from "./frameIdentity";

/** Per-stream sequence gate statistics. */
export type SequenceGateStats = {
  duplicatesRejected: number;
  sequenceGaps: number;
};

/**
 * Whether a frame belongs to the given presentation lifecycle (ingress rule).
 *
 * Rules (harvested from the retired IQ frame pump's `sameLifecycle`):
 * - A frame whose source differs from the committed source never belongs.
 * - A frame without an epoch (v1 wire format / legacy untagged paths) belongs
 *   once the source matches — there is no epoch to invalidate it.
 * - An epoch-tagged frame belongs when its epoch is at least the committed
 *   epoch. A strictly newer same-source epoch is allowed so the data plane
 *   can lead control-plane metadata; consumers adopt the newer epoch via
 *   `onLifecycleChange`-style updates when they observe it.
 */
export const acceptsMultiplexStreamFrame = (
  frame: MultiplexStreamFrameId,
  lifecycle: MultiplexStreamLifecycle,
): boolean => {
  if (!lifecycle.sourceId || frame.sourceId !== lifecycle.sourceId) {
    return false;
  }
  if (frame.streamEpoch === undefined || frame.streamEpoch === null) {
    return true;
  }
  if (lifecycle.streamEpoch === undefined || lifecycle.streamEpoch === null) {
    return true;
  }
  return frame.streamEpoch >= lifecycle.streamEpoch;
};

/** Convenience predicate over wire-format frames. */
export const acceptsMultiplexStreamWireFrame = (
  frame: Parameters<typeof multiplexStreamFrameIdFromWire>[0],
  lifecycle: MultiplexStreamLifecycle,
): boolean =>
  acceptsMultiplexStreamFrame(multiplexStreamFrameIdFromWire(frame), lifecycle);

/**
 * Presentation-side admission (canvas rule, deliberately permissive):
 * without an expected source every frame is acceptable; with one, untagged
 * frames (legacy/file paths) still pass but a tagged foreign source is
 * rejected. Harvested verbatim from `shouldAcceptWebGpuStreamFrame`.
 */
export const matchesMultiplexStreamSelection = ({
  expectedSourceId,
  frameSourceId,
  fallbackFrameSourceId,
}: {
  expectedSourceId: string | null | undefined;
  frameSourceId: string | null | undefined;
  fallbackFrameSourceId?: string | null;
}): boolean => {
  const effectiveFrameSourceId = frameSourceId ?? fallbackFrameSourceId;
  return (
    !expectedSourceId ||
    !effectiveFrameSourceId ||
    expectedSourceId === effectiveFrameSourceId
  );
};

export const createMultiplexStreamSequenceGate = () => {
  let lastSequence: { epoch: number; value: number } | null = null;
  let duplicatesRejected = 0;
  let sequenceGaps = 0;
  let readyLifecycleKey: string | null = null;

  return {
    /**
     * Returns false when the frame is a duplicate or reorder within its epoch
     * (sequence <= last accepted). Epoch-less frames (v1) always pass.
     */
    accept(frame: MultiplexStreamFrameId): boolean {
      if (frame.streamEpoch === undefined || frame.streamEpoch === null) {
        return true;
      }
      if (frame.sequence === undefined || frame.sequence === null) {
        return true;
      }
      if (
        lastSequence?.epoch === frame.streamEpoch &&
        frame.sequence <= lastSequence.value
      ) {
        duplicatesRejected += 1;
        return false;
      }
      if (
        lastSequence?.epoch === frame.streamEpoch &&
        frame.sequence > lastSequence.value + 1
      ) {
        sequenceGaps += frame.sequence - lastSequence.value - 1;
      }
      lastSequence = { epoch: frame.streamEpoch, value: frame.sequence };
      return true;
    },

    /**
     * Fires once per source:epoch transition — the readiness boundary.
     */
    consumeFirstFrameBoundary(frame: MultiplexStreamFrameId): string | null {
      const key = multiplexStreamLifecycleKey(frame);
      if (readyLifecycleKey === key) return null;
      readyLifecycleKey = key;
      return key;
    },

    reset(): void {
      lastSequence = null;
      readyLifecycleKey = null;
    },

    stats(): SequenceGateStats {
      return { duplicatesRejected, sequenceGaps };
    },
  };
};
