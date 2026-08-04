import type { CanvasPlaceholderState } from "@n-apt/components/ui/CanvasPlaceholder";
import { useEffect, useMemo, useRef } from "react";

/** Transport milestones emitted only when a source socket changes lifecycle. */
export type SourceTransportPhase = "idle" | "warming" | "ready" | "failed";

/** Frontend-owned lifecycle phases for a selected live source. */
export type LiveSourceLifecyclePhase =
  | "idle"
  | "warming-transport"
  | "swapping-device"
  | "awaiting-frame"
  | "ready"
  | "standby"
  | "recovering"
  | "disconnected"
  | "failed";

/** Stable transport state published by the WebSocket boundary. */
export type SourceTransportLifecycle = {
  sourceId: string | null;
  phase: SourceTransportPhase;
  error: string | null;
};

/** Low-frequency readiness boundary emitted by the frame pump. */
export type SourceFrameReadiness = {
  sourceId: string;
  streamEpoch: number | null;
  sequence: number;
};

/**
 * Rendering policy owned by the live-source lifecycle.
 *
 * The route decides whether a frame belongs to the selected source; canvas
 * code only applies this policy to its mutable presentation buffers.
 */
export type LiveSourcePresentationPolicy = {
  suppressStaleFrames: boolean;
  clearStalePresentation: boolean;
  preserveMatchingPresentation: boolean;
};

/**
 * The only identity used by the paused-frame marker.
 *
 * A paused canvas may still contain a valid frame while the selected source
 * changes. Keeping this tiny decision in the lifecycle prevents presentation
 * code from accidentally substituting the selected device name for the frame
 * that is actually frozen on screen.
 */
export const resolvePausedFramePresentation = ({
  isPaused,
  isStandby,
  frameSourceId,
  frameSourceName,
}: {
  isPaused: boolean;
  isStandby: boolean;
  frameSourceId?: string | null;
  frameSourceName?: string | null;
}): { sourceId: string; label: string } | null => {
  if ((!isPaused && !isStandby) || !frameSourceId) return null;
  return {
    sourceId: frameSourceId,
    label: frameSourceName?.trim() || frameSourceId,
  };
};

/**
 * A paused/standby canvas may retain its last painted frame while transport
 * metadata catches up. Clear it when that frame is owned by another source;
 * preserve it only after the selected source has an accepted readiness frame.
 */
export const shouldClearPausedStandbyPresentation = ({
  isStandby,
  selectedSourceId,
  presentedSourceId,
  readiness,
}: {
  isStandby: boolean;
  selectedSourceId: string | null;
  presentedSourceId: string | null;
  readiness?: SourceFrameReadiness | null;
}): boolean => {
  if (!isStandby || !selectedSourceId) return false;
  const presentedFrameMatchesSelection =
    presentedSourceId === selectedSourceId;
  const selectedFrameReady = readiness?.sourceId === selectedSourceId;
  return !presentedFrameMatchesSelection || !selectedFrameReady;
};

/** Resolve source ownership rules for the current presentation boundary. */
export const resolveLiveSourcePresentationPolicy = ({
  phase,
  selectedSourceId,
  activeSourceId,
  readiness,
  presentedSourceId,
  isStandby,
}: {
  phase: LiveSourceLifecyclePhase;
  selectedSourceId: string | null;
  activeSourceId: string | null;
  readiness?: SourceFrameReadiness | null;
  presentedSourceId?: string | null;
  isStandby: boolean;
}): LiveSourcePresentationPolicy => {
  const sourceHandoff =
    !!selectedSourceId && selectedSourceId !== activeSourceId;
  const selectedFrameReady = readiness?.sourceId === selectedSourceId;
  // A null presentation is deliberately not treated as matching. The canvas
  // may still hold a last-renderable fallback from the previous source even
  // after the transport ref has been cleared, so only an explicitly tagged
  // selected-source frame is safe to preserve.
  const presentedFrameMatchesSelection =
    presentedSourceId != null && presentedSourceId === selectedSourceId;
  const standby = isStandby || phase === "standby";
  return {
    // Suppress frames only while the backend still owns the previous source.
    // A mismatched mutable presentation is cleared independently so the
    // selected source can publish immediately after the handoff commits.
    suppressStaleFrames: sourceHandoff,
    clearStalePresentation:
      sourceHandoff ||
      shouldClearPausedStandbyPresentation({
        isStandby: standby,
        selectedSourceId,
        presentedSourceId: presentedSourceId ?? null,
        readiness,
      }),
    preserveMatchingPresentation:
      standby && presentedFrameMatchesSelection && selectedFrameReady,
  };
};

/** File playback uses the same paused-frame presentation path as live data. */
export const isFilePlaybackPaused = ({
  sourceMode,
  isStitchPaused,
}: {
  sourceMode: "live" | "file";
  isStitchPaused: boolean;
}): boolean => sourceMode === "file" && isStitchPaused;

/** File playback owns its processed frame and must not restore live snapshots. */
export const shouldRestorePausedFrameSnapshot = ({
  sourceMode,
}: {
  sourceMode: "live" | "file";
}): boolean => sourceMode === "live";

/** Suppress the transient standby state while transport leaves Mock Tx. */
export const shouldPresentMockTxStandby = ({
  isSelectedMockTxSource,
  isSelectedMockTxTransmitting,
  isSelectedMockTxPaused = false,
  selectedSourceId,
  transportSourceId,
  transportPhase,
}: {
  isSelectedMockTxSource: boolean;
  isSelectedMockTxTransmitting: boolean;
  isSelectedMockTxPaused?: boolean;
  selectedSourceId: string | null | undefined;
  transportSourceId: string | null | undefined;
  transportPhase: SourceTransportPhase;
}): boolean => {
  if (
    !isSelectedMockTxSource ||
    isSelectedMockTxTransmitting ||
    isSelectedMockTxPaused
  ) {
    return false;
  }
  const isDepartingMockTx = !!(
    transportSourceId &&
    transportSourceId !== selectedSourceId &&
    transportPhase !== "failed"
  );
  return !isDepartingMockTx;
};

/**
 * A standby request is visible after the selected source owns the stream. On
 * initial device discovery the source status can arrive before the active
 * stream id, so an empty active id is also a valid initial ownership state.
 * A different non-empty active id still blocks the presentation during a
 * source handoff. Keeping this commit boundary shared by the route,
 * lifecycle, and canvas prevents a standby bar from racing ahead of the
 * frame transition.
 */
export const isCommittedStandbyPresentation = ({
  requested,
  selectedSourceId,
  activeSourceId,
  presentedSourceId,
  isTransmitting,
}: {
  requested: boolean;
  selectedSourceId: string | null | undefined;
  activeSourceId: string | null | undefined;
  presentedSourceId?: string | null;
  isTransmitting: boolean;
}): boolean =>
  requested &&
  !isTransmitting &&
  !!selectedSourceId &&
  (!activeSourceId ||
    selectedSourceId === activeSourceId ||
    selectedSourceId === presentedSourceId);

/**
 * Fire a Mock Tx standby one-shot as soon as Mock Tx is selected / cold-started.
 *
 * The backend accepts `request_next_frame` for the active source or the pending
 * select_source target, so warming/swapping must request immediately — waiting
 * for standby/ready leaves a black FFT on first Rx→Tx and on reload into Mock Tx.
 */
export const shouldRequestMockTxStandbyPreview = ({
  isSelectedMockTxSource,
  isSelectedMockTxTransmitting,
  isSelectedMockTxPaused = false,
  isConnected,
  phase,
}: {
  isSelectedMockTxSource: boolean;
  isSelectedMockTxTransmitting: boolean;
  isSelectedMockTxPaused?: boolean;
  isConnected: boolean;
  phase: LiveSourceLifecyclePhase;
}): boolean =>
  isSelectedMockTxSource &&
  !isSelectedMockTxTransmitting &&
  !isSelectedMockTxPaused &&
  isConnected &&
  phase !== "disconnected" &&
  phase !== "failed";

/**
 * Confirms that the frame pump has accepted data for the selected lifecycle.
 * V2 requires the current epoch; v1 remains valid once source ownership is
 * aligned because it has no epoch field.
 */
export const isCurrentSourceFrameReady = ({
  selectedSourceId,
  activeSourceId,
  expectedStreamEpoch,
  readiness,
}: {
  selectedSourceId: string | null | undefined;
  activeSourceId: string | null | undefined;
  expectedStreamEpoch?: number | null;
  readiness?: SourceFrameReadiness | null;
}): boolean => {
  if (
    !readiness ||
    !selectedSourceId ||
    selectedSourceId !== activeSourceId ||
    readiness.sourceId !== selectedSourceId
  ) {
    return false;
  }
  return (
    readiness.streamEpoch === null ||
    expectedStreamEpoch === null ||
    typeof expectedStreamEpoch === "undefined" ||
    readiness.streamEpoch === expectedStreamEpoch
  );
};

/** One source-scoped decision consumed by both canvases and route layout. */
export type LiveSourceLifecycle = {
  phase: LiveSourceLifecyclePhase;
  selectedSourceId: string | null;
  activeSourceId: string | null;
  transportSourceId: string | null;
  readinessSequence: number | null;
  placeholder: CanvasPlaceholderState | null;
  presentation: LiveSourcePresentationPolicy;
};

/** Structured, low-frequency transition record owned by the route lifecycle. */
export type LiveSourceLifecycleTrace = {
  owner: "SpectrumRoute/live-source-lifecycle";
  render: number;
  from: LiveSourceLifecyclePhase | null;
  to: LiveSourceLifecyclePhase;
  selectedSourceId: string | null;
  activeSourceId: string | null;
  transportSourceId: string | null;
  readinessSequence: number | null;
  transportPhase: SourceTransportPhase;
};

const RECOVERY_STATUSES = new Set(["loading", "stale"]);

/**
 * Distinguish first-boot warm-up from a killed backend.
 *
 * Bare `!isConnected` is wrong: the control socket starts disconnected and
 * passes through `connecting` before any frame can arrive. After a live
 * session has existed, reconnect polling (`reconnecting` / `connecting`) is
 * still Server Down — those statuses must not flash Loading while the backend
 * remains dead. Device handoff / transport warm-up are not backend death.
 */
export const isControlPlaneUnavailable = ({
  isConnected,
  connectionStatus = null,
  hasConnectedOnce = false,
  sourceHandoffPending: _sourceHandoffPending = false,
  transportPhase: _transportPhase = null,
}: {
  isConnected: boolean;
  connectionStatus?: string | null;
  hasConnectedOnce?: boolean;
  sourceHandoffPending?: boolean;
  transportPhase?: string | null;
}): boolean => {
  // An open control socket is never "Server Down". Stream/source failures can
  // leave connectionStatus sticky at "error" without closing the socket
  // (File → Mock Tx subscribe races); that must stay Loading/handoff, not the
  // killed-backend placeholder, or Mock APT inherits a false Server Down.
  if (isConnected) return false;
  if (connectionStatus === "error") return true;
  // After a live session, softDisconnect / reconnect polling is Server Down.
  // First-boot disconnected/connecting keep Loading instead.
  if (hasConnectedOnce === true) return true;
  return false;
};

/**
 * Resolves selection, socket warm-up, backend commit, first-frame readiness,
 * recovery, and terminal failure through one deterministic frontend model.
 * A validated current-source frame beats lagging recovery status; explicit
 * disconnection and switch failure remain blocking.
 */
export const resolveLiveSourceLifecycle = ({
  selectedSourceId,
  activeSourceId,
  transportSourceId = null,
  transportPhase = "idle",
  transportError = null,
  hasValidFrame,
  deviceStatus,
  devicePlaceholder = null,
  handoffPlaceholder = null,
  standbyPlaceholder = null,
  isLive = true,
  isConnected = true,
  connectionStatus = null,
  hasConnectedOnce = false,
  sourceHandoffPending,
  isStandby = false,
  readinessSequence = null,
  readiness = null,
  presentedSourceId = null,
}: {
  selectedSourceId: string | null;
  activeSourceId: string | null;
  transportSourceId?: string | null;
  transportPhase?: SourceTransportPhase;
  transportError?: string | null;
  hasValidFrame: boolean;
  deviceStatus: string | null;
  devicePlaceholder?: CanvasPlaceholderState | null;
  handoffPlaceholder?: CanvasPlaceholderState | null;
  standbyPlaceholder?: CanvasPlaceholderState | null;
  isLive?: boolean;
  isConnected?: boolean;
  connectionStatus?: string | null;
  hasConnectedOnce?: boolean;
  sourceHandoffPending?: boolean;
  isStandby?: boolean;
  readinessSequence?: number | null;
  readiness?: SourceFrameReadiness | null;
  presentedSourceId?: string | null;
}): LiveSourceLifecycle => {
  const result = (
    phase: LiveSourceLifecyclePhase,
    placeholder: CanvasPlaceholderState | null,
  ): LiveSourceLifecycle => ({
    phase,
    selectedSourceId,
    activeSourceId,
    transportSourceId,
    readinessSequence,
    placeholder,
    presentation: resolveLiveSourcePresentationPolicy({
      phase,
      selectedSourceId,
      activeSourceId,
      readiness,
      presentedSourceId,
      isStandby,
    }),
  });

  if (!isLive) return result("idle", null);
  // Only after a live session is lost. First-boot `disconnected`/`connecting`
  // must keep warming/loading so Mock APT can receive its first frames.
  const handoffPending =
    sourceHandoffPending ??
    (!!selectedSourceId && selectedSourceId !== activeSourceId);
  if (
    isControlPlaneUnavailable({
      isConnected,
      connectionStatus,
      hasConnectedOnce,
      sourceHandoffPending: handoffPending,
      transportPhase,
    })
  ) {
    return result("failed", {
      kind: "error",
      sourceLabel: selectedSourceId ?? undefined,
      reason: "Server down",
      message:
        "The server was disconnected due to being manually exited or an error.",
    });
  }
  if (transportPhase === "failed" && transportSourceId === selectedSourceId) {
    return result("failed", {
      kind: "error",
      sourceLabel: selectedSourceId ?? undefined,
      reason: transportError ?? "The selected source failed to start.",
      message: "The previous source transport has been restored.",
    });
  }
  if (
    deviceStatus === "disconnected" ||
    devicePlaceholder?.kind === "disconnected"
  ) {
    return result("disconnected", devicePlaceholder);
  }
  if (deviceStatus === "error" || devicePlaceholder?.kind === "error") {
    return result("failed", devicePlaceholder);
  }
  if (!selectedSourceId) return result("idle", null);

  if (selectedSourceId !== activeSourceId) {
    const targetTransportIsReady =
      transportSourceId === selectedSourceId && transportPhase === "ready";
    return result(
      targetTransportIsReady ? "swapping-device" : "warming-transport",
      handoffPlaceholder,
    );
  }

  // Standby with a committed preview frame shows the top bar over the graph.
  // Standby without a frame must stay in awaiting-frame so Loading covers the
  // canvas instead of a black FFT under the STANDBY chrome.
  if ((isStandby || standbyPlaceholder) && hasValidFrame) {
    return result("standby", standbyPlaceholder);
  }
  if (isStandby || standbyPlaceholder) {
    return result(
      "awaiting-frame",
      handoffPlaceholder ??
        createLiveSourceHandoffPlaceholder(selectedSourceId),
    );
  }

  if (hasValidFrame) return result("ready", null);

  if (RECOVERY_STATUSES.has(deviceStatus ?? "") || devicePlaceholder) {
    return result("recovering", devicePlaceholder);
  }
  return result("awaiting-frame", handoffPlaceholder);
};

/** True while the selected source must not consume the previous source frame. */
export const isLiveSourceHandoffPending = (
  lifecycle: LiveSourceLifecycle,
): boolean =>
  lifecycle.phase === "warming-transport" ||
  lifecycle.phase === "swapping-device";

/** Keeps the loading overlay visible until the first accepted frame arrives. */
export const isLiveSourceAwaitingFrame = (
  lifecycle: LiveSourceLifecycle,
): boolean =>
  isLiveSourceHandoffPending(lifecycle) || lifecycle.phase === "awaiting-frame";

/** Error reason from a lifecycle-owned error placeholder, if any. */
export const resolveLiveSourceLifecycleErrorReason = (
  lifecycle: Pick<LiveSourceLifecycle, "placeholder">,
): string | null =>
  lifecycle.placeholder?.kind === "error"
    ? (lifecycle.placeholder.reason ?? null)
    : null;

/** Default loading card while a selected live source has no accepted frame. */
export const createLiveSourceHandoffPlaceholder = (
  sourceLabel?: string | null,
): CanvasPlaceholderState => ({
  kind: "loading",
  paneLabel: "FFT",
  sourceLabel: sourceLabel ?? undefined,
  message: "Waiting for the first frame to arrive.",
});

/** Adds the phase-appropriate placeholder without recomputing lifecycle. */
export const attachLiveSourceLifecyclePlaceholder = (
  lifecycle: LiveSourceLifecycle,
  {
    devicePlaceholder = null,
    handoffPlaceholder = null,
    standbyPlaceholder = null,
  }: {
    devicePlaceholder?: CanvasPlaceholderState | null;
    handoffPlaceholder?: CanvasPlaceholderState | null;
    standbyPlaceholder?: CanvasPlaceholderState | null;
  },
): LiveSourceLifecycle => {
  const placeholder = (() => {
    switch (lifecycle.phase) {
      case "failed":
        return lifecycle.placeholder ?? devicePlaceholder;
      case "disconnected":
      case "recovering":
        return devicePlaceholder;
      case "warming-transport":
      case "swapping-device":
      case "awaiting-frame":
        // Full-canvas Loading only. A standby top-bar alone leaves a black
        // FFT while the one-shot preview is in flight.
        return (
          handoffPlaceholder ??
          (lifecycle.placeholder?.kind === "loading"
            ? lifecycle.placeholder
            : null) ??
          createLiveSourceHandoffPlaceholder(lifecycle.selectedSourceId)
        );
      case "standby":
        return standbyPlaceholder;
      case "idle":
      case "ready":
        return null;
      default: {
        const _exhaustive: never = lifecycle.phase;
        return _exhaustive;
      }
    }
  })();
  return { ...lifecycle, placeholder };
};

/** Builds a trace only when the lifecycle phase or source ownership changes. */
export const buildLiveSourceLifecycleTrace = (
  previous: LiveSourceLifecycle | null,
  next: LiveSourceLifecycle,
  render: number,
  transportPhase: SourceTransportPhase,
): LiveSourceLifecycleTrace | null => {
  if (
    previous?.phase === next.phase &&
    previous.selectedSourceId === next.selectedSourceId &&
    previous.activeSourceId === next.activeSourceId &&
    previous.transportSourceId === next.transportSourceId &&
    previous.readinessSequence === next.readinessSequence
  ) {
    return null;
  }
  return {
    owner: "SpectrumRoute/live-source-lifecycle",
    render,
    from: previous?.phase ?? null,
    to: next.phase,
    selectedSourceId: next.selectedSourceId,
    activeSourceId: next.activeSourceId,
    transportSourceId: next.transportSourceId,
    readinessSequence: next.readinessSequence,
    transportPhase,
  };
};

/**
 * Owns the route's live-source state and emits one trace per meaningful
 * transition. The render number makes accidental transition-driven render
 * loops diagnosable without subscribing the route to individual I/Q frames.
 */
export const useLiveSourceLifecycle = (
  input: Parameters<typeof resolveLiveSourceLifecycle>[0],
): LiveSourceLifecycle => {
  const renderRef = useRef(0);
  const previousRef = useRef<LiveSourceLifecycle | null>(null);
  renderRef.current += 1;
  const lifecycle = useMemo(
    () => resolveLiveSourceLifecycle(input),
    [
      input.activeSourceId,
      input.connectionStatus,
      input.deviceStatus,
      input.hasConnectedOnce,
      input.sourceHandoffPending,
      input.hasValidFrame,
      input.isConnected,
      input.isLive,
      input.isStandby,
      input.readiness,
      input.readinessSequence,
      input.presentedSourceId,
      input.selectedSourceId,
      input.transportError,
      input.transportPhase,
      input.transportSourceId,
    ],
  );
  useEffect(() => {
    const trace = buildLiveSourceLifecycleTrace(
      previousRef.current,
      lifecycle,
      renderRef.current,
      input.transportPhase ?? "idle",
    );
    if (trace) console.debug("[SpectrumRoute/live-source-lifecycle]", trace);
    previousRef.current = lifecycle;
  }, [input.transportPhase, lifecycle]);
  return lifecycle;
};
