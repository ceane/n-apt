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
import { evaluateSequenceStep } from "@n-apt/math/sequenceStep";

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
 * A live frame belongs only when it has source identity, epoch, and sequence.
 * A strictly newer same-source epoch is allowed so the data plane can lead
 * control-plane metadata; older epochs never re-enter the presentation.
 */
export const acceptsMultiplexStreamFrame = (
  frame: MultiplexStreamFrameId,
  lifecycle: MultiplexStreamLifecycle,
): boolean => {
  if (!lifecycle.sourceId || frame.sourceId !== lifecycle.sourceId) {
    return false;
  }
  if (
    !Number.isSafeInteger(frame.streamEpoch) ||
    frame.streamEpoch! < 0 ||
    !Number.isSafeInteger(frame.sequence) ||
    frame.sequence! < 0
  ) {
    return false;
  }
  if (lifecycle.streamEpoch === undefined || lifecycle.streamEpoch === null) return true;
  return frame.streamEpoch! >= lifecycle.streamEpoch;
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
 * frames (file playback paths) still pass but a tagged foreign source is
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
     * (sequence <= last accepted). Frames without usable ordering are rejected.
     */
    accept(frame: MultiplexStreamFrameId): boolean {
      if (
        !Number.isSafeInteger(frame.streamEpoch) ||
        frame.streamEpoch! < 0 ||
        !Number.isSafeInteger(frame.sequence) ||
        frame.sequence! < 0
      ) {
        return false;
      }
      const epoch = frame.streamEpoch!;
      const sequence = frame.sequence!;
      if (lastSequence?.epoch === epoch) {
        const step = evaluateSequenceStep(lastSequence.value, sequence);
        if (!step.accepted) {
          duplicatesRejected += 1;
          return false;
        }
        sequenceGaps += step.sequenceGaps;
      } else if (lastSequence && epoch < lastSequence.epoch) {
        duplicatesRejected += 1;
        return false;
      }
      lastSequence = { epoch, value: sequence };
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
