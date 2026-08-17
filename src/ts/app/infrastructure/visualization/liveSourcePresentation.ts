import type { CanvasPlaceholderState } from "@n-apt/ui/CanvasPlaceholder";
import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";

/** Payload shapes accepted by the live canvases during protocol migration. */
export type RenderableLiveFrame = Partial<IqRawFrame> & {
  data?: ArrayLike<number> | null;
  waveform?: ArrayLike<number> | null;
  protocol_version?: 1 | 2;
  stream_epoch?: number;
  sequence?: number;
};

/** Source-scoped phases exposed to route composition and characterization tests. */
export type LivePresentationPhase =
  | "idle"
  | "awaiting-source"
  | "awaiting-frame"
  | "ready"
  | "recovering"
  | "disconnected";

/** Complete presentation decision for one selected source lifecycle. */
export type LivePresentationState = {
  phase: LivePresentationPhase;
  placeholder: CanvasPlaceholderState | null;
};

/** Whether this source should show one standby Tx preview instead of playing
 * continuously. A default-flow Tx-only source is previewed too; a role-bound
 * Tx branch may use a full-duplex source, while an Rx branch never does. */
export const isTxStandbyPreviewSource = ({
  sourceRole,
  capability,
  status,
}: {
  sourceRole?: "rx" | "tx";
  capability?: string | null;
  status?: string | null;
}): boolean => {
  if (status === "transmitting") return false;
  if (sourceRole === "rx") return false;
  if (sourceRole === "tx") {
    return capability === "tx" || capability === "tx_rx";
  }
  return capability === "tx";
};

/** Isolates persisted paused-frame snapshots by source/file processing session. */
export const getSourcePresentationSessionKey = ({
  sourceMode,
  selectedFiles,
  stitchTrigger,
  presentationRevision,
}: {
  sourceMode: "live" | "file";
  selectedFiles: Array<{ id?: string; name: string }>;
  stitchTrigger: number | null | undefined;
  presentationRevision?: string | number | null;
}): string =>
  `${sourceMode}:${stitchTrigger ?? "none"}:${presentationRevision ?? "none"}:${selectedFiles
    .map((file) => file.id || file.name)
    .sort()
    .join("|")}`;

const normalizeSourceIdentity = (sourceId: string | null | undefined) =>
  sourceId?.trim() || null;

/** Returns the newest frame from the mutable live-frame buffer. */
export const getLatestLiveFrame = (
  value: RenderableLiveFrame | RenderableLiveFrame[] | null | undefined,
): RenderableLiveFrame | null => {
  if (Array.isArray(value)) {
    return value.length > 0 ? (value[value.length - 1] ?? null) : null;
  }
  return value ?? null;
};

/**
 * Keep a batched live update owned by the source currently being presented.
 *
 * Frames are delivered asynchronously, so a batch can contain the last frame
 * from the old device and the first frame from the new device. Once the
 * protocol provides source identity, an untagged frame is not safe to render
 * during that handoff and must be discarded as well.
 */
export const filterLiveFramesForSource = <T extends { source_id?: string }>(
  frames: T[],
  sourceId: string | null | undefined,
  allowUntagged = false,
): T[] => {
  const normalizedSourceId = normalizeSourceIdentity(sourceId);
  if (!normalizedSourceId) return frames;
  return frames.filter(
    (frame) =>
      normalizeSourceIdentity(frame.source_id) === normalizedSourceId ||
      (allowUntagged && !normalizeSourceIdentity(frame.source_id)),
  );
};

/** True when a frame contains samples that either live canvas can present. */
export const hasRenderableFramePayload = (
  frame: RenderableLiveFrame | null | undefined,
): boolean =>
  !!(
    frame &&
    ((frame.iq_data?.length ?? 0) > 0 ||
      (frame.waveform?.length ?? 0) > 0 ||
      (frame.data?.length ?? 0) > 0)
  );

/**
 * Proves that a buffered frame belongs to the current presentation lifecycle.
 *
 * V2 frames carry source and epoch metadata and must match both. Legacy,
 * untagged frames are accepted only after the handoff counter advances while
 * the control channel agrees on selected and active source identity.
 */
export const resolveFrameReadiness = ({
  frame,
  selectedSourceId,
  activeSourceId,
  expectedStreamEpoch,
  frameCounter,
  handoffStartedFrameCounter,
}: {
  frame: RenderableLiveFrame | null | undefined;
  selectedSourceId: string | null | undefined;
  activeSourceId: string | null | undefined;
  expectedStreamEpoch?: number | null;
  frameCounter: number;
  handoffStartedFrameCounter: number;
}): boolean => {
  if (!hasRenderableFramePayload(frame)) return false;

  const selected = normalizeSourceIdentity(selectedSourceId);
  const active = normalizeSourceIdentity(activeSourceId);
  const owner = normalizeSourceIdentity(frame?.source_id);
  if (!selected || !active || selected !== active) return false;

  if (owner && owner !== selected) return false;
  if (frame?.protocol_version === 2) {
    return (
      owner === selected &&
      (typeof expectedStreamEpoch !== "number" ||
        frame.stream_epoch === expectedStreamEpoch)
    );
  }

  if (owner === selected) return true;

  return frameCounter > handoffStartedFrameCounter;
};

/**
 * Resolve lifecycle phase and placeholder with a single precedence order.
 * Disconnect/error is absolute; otherwise validated I/Q immediately wins over
 * delayed control status, recovery, and handoff overlays.
 */
export const resolveLivePresentationState = ({
  hasSelectedSource = true,
  hasValidFrame,
  isSourceHandoff = false,
  devicePlaceholder = null,
  handoffPlaceholder = null,
  standbyPlaceholder = null,
}: {
  hasSelectedSource?: boolean;
  hasValidFrame: boolean;
  isSourceHandoff?: boolean;
  devicePlaceholder?: CanvasPlaceholderState | null;
  handoffPlaceholder?: CanvasPlaceholderState | null;
  standbyPlaceholder?: CanvasPlaceholderState | null;
}): LivePresentationState => {
  if (
    devicePlaceholder?.kind === "disconnected" ||
    devicePlaceholder?.kind === "error"
  ) {
    return { phase: "disconnected", placeholder: devicePlaceholder };
  }
  if (hasValidFrame) return { phase: "ready", placeholder: null };
  if (devicePlaceholder) {
    return { phase: "recovering", placeholder: devicePlaceholder };
  }
  if (!hasSelectedSource) {
    return { phase: "awaiting-source", placeholder: handoffPlaceholder };
  }
  if (isSourceHandoff) {
    return { phase: "awaiting-frame", placeholder: handoffPlaceholder };
  }
  if (standbyPlaceholder) {
    return { phase: "ready", placeholder: standbyPlaceholder };
  }
  return { phase: "idle", placeholder: null };
};

/**
 * Resolve a blocking device placeholder.
 *
 * A validated current-source frame is stronger readiness evidence than a
 * delayed loading/recovery status. Explicit disconnection remains blocking.
 */
export const resolveLiveDevicePlaceholderState = ({
  deviceState,
  sourceLabel,
  loadingAttempt,
  loadingAttemptMax,
  hasPlayedAtLeastOnce,
  hasRenderableCurrentFrame,
}: {
  deviceState: string | null;
  sourceLabel: string;
  loadingAttempt?: number | null;
  loadingAttemptMax?: number | null;
  sourceId?: string | null;
  hasPlayedAtLeastOnce?: boolean;
  /** Strong readiness evidence from a validated frame owned by this source. */
  hasRenderableCurrentFrame?: boolean;
}): CanvasPlaceholderState | null => {
  if (
    deviceState !== "loading" &&
    deviceState !== "stale" &&
    deviceState !== "disconnected" &&
    deviceState !== "error"
  ) {
    return null;
  }

  if (
    (hasRenderableCurrentFrame || hasPlayedAtLeastOnce) &&
    deviceState !== "disconnected" &&
    deviceState !== "error" &&
    // A device still opening has no veritable stream. A stale renderable
    // frame (previous source, earlier epoch) must not suppress the loading
    // placeholder or the canvas can show a blank/black area while the
    // selected HackRF is still loading.
    deviceState !== "loading"
  ) {
    return null;
  }

  if (deviceState === "disconnected") {
    return {
      kind: "disconnected",
      sourceLabel,
      message:
        "The device disconnected. The backend is retrying the connection.",
    };
  }

  if (deviceState === "error") {
    return {
      kind: "error",
      sourceLabel,
      reason: "The device reported an error.",
      message: "Resolve the device error before live I/Q can resume.",
    };
  }

  const normalizedAttempt =
    typeof loadingAttempt === "number" && Number.isFinite(loadingAttempt)
      ? Math.max(0, Math.floor(loadingAttempt))
      : 0;
  const normalizedAttemptMax =
    typeof loadingAttemptMax === "number" &&
    Number.isFinite(loadingAttemptMax) &&
    loadingAttemptMax > 0
      ? Math.floor(loadingAttemptMax)
      : 0;

  const message =
    deviceState === "stale"
      ? "The device is still visible but has not produced a fresh frame yet."
      : normalizedAttempt > 0
        ? `Attempting to restart the device... (${normalizedAttempt}/${normalizedAttemptMax || "?"})`
        : "The device is restarting; this can take 20-30 seconds for HackRF One.";

  return {
    kind: "loading",
    paneLabel: "device",
    sourceLabel,
    message,
  };
};
