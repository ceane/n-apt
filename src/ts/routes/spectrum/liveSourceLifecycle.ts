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
    (typeof expectedStreamEpoch === "number" &&
      readiness.streamEpoch === expectedStreamEpoch)
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

const RECOVERY_STATUSES = new Set(["loading", "loose", "stale"]);

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
  isStandby = false,
  readinessSequence = null,
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
  isStandby?: boolean;
  readinessSequence?: number | null;
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
  });

  if (!isLive) return result("idle", null);
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
  if (hasValidFrame && selectedSourceId === activeSourceId) {
    return result("ready", null);
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

  if (RECOVERY_STATUSES.has(deviceStatus ?? "") || devicePlaceholder) {
    return result("recovering", devicePlaceholder);
  }
  if (isStandby || standbyPlaceholder) {
    return result("standby", standbyPlaceholder);
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
        return handoffPlaceholder;
      case "standby":
        return standbyPlaceholder;
      default:
        return null;
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
      input.deviceStatus,
      input.hasValidFrame,
      input.isLive,
      input.isStandby,
      input.readinessSequence,
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
