/**
 * Presentation-batch admission rules for managed multiplex stream frames.
 *
 * Extracted verbatim from the websocket middleware's batch processor so the
 * store layer only *applies* these decisions. Pure module.
 */

import type { MultiplexStreamWireFrame } from "./frameIdentity";

/**
 * A frame that belongs to a Tx presentation rather than the Rx spectrum:
 * standby previews, active transmit frames, and their legacy aliases.
 */
export const isMultiplexStreamTxPresentationFrame = (
  frame: MultiplexStreamWireFrame & Record<string, unknown>,
): boolean =>
  frame?.frame_status === "standby" ||
  frame?.frame_status === "transmitting" ||
  frame?.is_tx_preview === true ||
  frame?.is_mock_tx_preview === true;

export const hasMultiplexStreamTxPreviewFrame = (
  frames: Array<MultiplexStreamWireFrame & Record<string, unknown>>,
): boolean => frames.some((frame) => isMultiplexStreamTxPresentationFrame(frame));

export const filterMultiplexStreamTxPreviewFrames = <
  T extends MultiplexStreamWireFrame & Record<string, unknown>,
>(
  frames: T[],
): T[] =>
  frames.filter(
    (frame) =>
      frame?.frame_status === "standby" ||
      frame?.is_tx_preview === true ||
      frame?.is_mock_tx_preview === true,
  );

export type MultiplexStreamPresentationBatchInput = {
  /** Frames left after source/mode filtering; zero short-circuits to reject. */
  frameCount: number;
  isFileSource: boolean;
  isPaused: boolean;
  /** A paused one-shot response is armed (request_next_frame in flight). */
  pausedRequestInFlight: boolean;
  isActiveTxMonitorStandby: boolean;
  isActiveBoundTxPreviewStandby: boolean;
  isSelectedTxPresentationStandby: boolean;
  isActiveTxMonitorTransmitting: boolean;
  isSelectedTxPresentationTransmitting: boolean;
  hasTxPreviewFrame: boolean;
};

export type MultiplexStreamPresentationBatchDecision = {
  /** Accept the batch into the shared live-data ref at all. */
  accept: boolean;
  /**
   * Replace-mode (collapse to the newest frame, consume the pause gate)
   * instead of appending to the retained queue. Only meaningful when accepted.
   */
  replacePausedPresentation: boolean;
};

/**
 * Decides whether a batch of presentation frames may enter the shared
 * FFT/Waterfall ref, and whether it does so as a paused/standby replacement
 * (one-shot preview semantics) or as ordinary streaming append.
 */
export const resolveMultiplexStreamPresentationBatch = ({
  frameCount,
  isFileSource,
  isPaused,
  pausedRequestInFlight,
  isActiveTxMonitorStandby,
  isActiveBoundTxPreviewStandby,
  isSelectedTxPresentationStandby,
  isActiveTxMonitorTransmitting,
  isSelectedTxPresentationTransmitting,
  hasTxPreviewFrame,
}: MultiplexStreamPresentationBatchInput): MultiplexStreamPresentationBatchDecision => {
  if (frameCount <= 0 || isFileSource) {
    return { accept: false, replacePausedPresentation: false };
  }

  const isPausedOneShotFrame = isPaused && pausedRequestInFlight;
  // A paused Rx source publishes exactly one frame per request_next_frame.
  // It has no Tx-preview tag, so acceptance gates on the armed request. The
  // gate is consumed after the first frame so idle background frames cannot
  // bleed in.
  const shouldAcceptPausedFrame = hasTxPreviewFrame || isPausedOneShotFrame;

  const liveStreamingAccepted =
    !isPaused &&
    !isActiveTxMonitorStandby &&
    !isActiveBoundTxPreviewStandby &&
    !isSelectedTxPresentationStandby;

  if (
    !liveStreamingAccepted &&
    !shouldAcceptPausedFrame &&
    !isActiveTxMonitorTransmitting
  ) {
    return { accept: false, replacePausedPresentation: false };
  }

  const replacePausedPresentation =
    (isPaused ||
      isActiveTxMonitorStandby ||
      isActiveBoundTxPreviewStandby ||
      isSelectedTxPresentationStandby) &&
    (shouldAcceptPausedFrame || hasTxPreviewFrame) &&
    !isActiveTxMonitorTransmitting &&
    !isSelectedTxPresentationTransmitting;

  return { accept: true, replacePausedPresentation };
};

/**
 * Retune-oscillation guard: after an authoritative device hydration
 * (`stream_options_applied`, non-local), state-derived option builds can read
 * values older than the newest user gesture; publishing them tunes the device
 * backwards and sustains an oscillation between stale windows.
 *
 * A candidate is suppressed only when ALL hold:
 * - we are inside the post-hydration suppression window,
 * - a gesture intent center is known,
 * - the candidate does NOT match that intent.
 */
export const shouldSuppressRxOptionsCandidate = ({
  hydrationSuppressionActive,
  latestGestureCenterHz,
  candidateCenterHz,
}: {
  hydrationSuppressionActive: boolean;
  latestGestureCenterHz: number | null;
  candidateCenterHz: number | null | undefined;
}): boolean =>
  hydrationSuppressionActive &&
  latestGestureCenterHz !== null &&
  candidateCenterHz !== latestGestureCenterHz;
