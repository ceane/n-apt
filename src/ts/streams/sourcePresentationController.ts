import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import type { StreamMode } from "@n-apt/streams/sourceModeStreamManager";
import {
  writePauseSnapshot,
  readPauseSnapshot,
  type PauseSnapshot,
} from "@n-apt/hooks/pauseSnapshotStorage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Presentation lifecycle for a single source/mode slot. */
export type SourcePresentationPhase =
  | "idle"
  | "switching"
  | "warming"
  | "streaming"
  | "paused"
  | "standby"
  | "stale"
  | "transmitting"
  | "recovering"
  | "disconnected"
  | "failed";

/** Composite key for the per-source, per-mode slot map. */
export type SourceModeKey = {
  sourceId: string;
  mode: StreamMode;
};

/** The frozen frame retained when a source enters paused or standby. */
export type FrozenFrame = {
  frame: IqRawFrame;
  frozenAt: number;
  streamEpoch: number | null;
  sequence: number | null;
  centerFrequencyHz: number | null;
  sampleRateHz: number | null;
};

/** Per-source, per-mode presentation state. */
export type SourceModeSlot = {
  key: SourceModeKey;
  phase: SourcePresentationPhase;
  /** The ref the canvas reads from during streaming. Single-frame deep. */
  liveFrameRef: { current: IqRawFrame | null };
  /** The frame frozen on canvas when paused/standby. */
  frozenFrame: FrozenFrame | null;
  /** Stream epoch for frame validation. */
  streamEpoch: number | null;
  /** Last accepted sequence for duplicate rejection. */
  lastSequence: number | null;
  /** Monotonic counter advanced on every canvas-resetting transition. */
  resetEpoch: number;
  /** Diagnostic counters. */
  metrics: SourceModeSlotMetrics;
};

export type SourceModeSlotMetrics = {
  accepted: number;
  rejected: number;
  stale: number;
  frozen: number;
};

/** The active presentation target. */
export type ActivePresentation = {
  sourceId: string;
  mode: StreamMode;
  /** Set when select_source is sent but backend hasn't committed yet. */
  pendingSourceId: string | null;
};

/** Read-only snapshot of the controller state for consumers. */
export type PresentationSnapshot = {
  active: ActivePresentation;
  slot: Readonly<SourceModeSlot> | null;
  canvasKey: string;
};

/** Listener callback for state changes. */
export type PresentationListener = (snapshot: PresentationSnapshot) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const slotKeyString = ({ sourceId, mode }: SourceModeKey): string =>
  `${sourceId}\0${mode}`;

const snapshotScopeForSlot = ({ sourceId, mode }: SourceModeKey): string =>
  `${sourceId}:${mode}`;

const createEmptySlot = (key: SourceModeKey): SourceModeSlot => ({
  key: { ...key },
  phase: "idle",
  liveFrameRef: { current: null },
  frozenFrame: null,
  streamEpoch: null,
  lastSequence: null,
  resetEpoch: 0,
  metrics: { accepted: 0, rejected: 0, stale: 0, frozen: 0 },
});

const extractFrameSourceId = (frame: IqRawFrame): string | null =>
  (typeof frame.source_id === "string" && frame.source_id.trim()) || null;

const extractStreamEpoch = (frame: IqRawFrame): number | null =>
  frame.protocol_version === 2 && typeof frame.stream_epoch === "number"
    ? frame.stream_epoch
    : null;

const extractSequence = (frame: IqRawFrame): number | null =>
  frame.protocol_version === 2 && typeof frame.sequence === "number"
    ? frame.sequence
    : null;

const resolveModeFromFrame = (frame: IqRawFrame): StreamMode => {
  const status = frame.frame_status;
  if (
    status === "standby" ||
    status === "transmitting" ||
    frame.is_tx_preview === true ||
    frame.is_mock_tx_preview === true
  ) {
    return "tx";
  }
  return "rx";
};

const buildCanvasKey = (
  sourceId: string | null,
  mode: StreamMode,
  resetEpoch: number,
): string => `${sourceId ?? "no-source"}:${mode}:${resetEpoch}`;

const freezeFrame = (
  frame: IqRawFrame,
  slot: SourceModeSlot,
): FrozenFrame => ({
  frame,
  frozenAt: Date.now(),
  streamEpoch: slot.streamEpoch,
  sequence: slot.lastSequence,
  centerFrequencyHz:
    typeof frame.center_frequency_hz === "number"
      ? frame.center_frequency_hz
      : null,
  sampleRateHz:
    typeof frame.sample_rate === "number" ? frame.sample_rate : null,
});

/** Phases where new live frames are accepted for rendering. */
const STREAMING_PHASES = new Set<SourcePresentationPhase>([
  "streaming",
  "transmitting",
]);

/** Phases where the last frame is frozen and new frames are rejected. */
const FROZEN_PHASES = new Set<SourcePresentationPhase>([
  "paused",
  "standby",
]);

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export type SourcePresentationControllerOptions = {
  /** Enable session storage persistence for frozen frames. Default: true. */
  persistSnapshots?: boolean;
};

export interface SourcePresentationController {
  // --- Frame path ---
  /**
   * Called by the middleware when a frame arrives. Returns true if accepted
   * for presentation (streaming or frozen as a paused/standby preview).
   */
  acceptFrame(frame: IqRawFrame, modeOverride?: StreamMode): boolean;

  // --- Source lifecycle ---
  /** User selected a source in the sidebar. */
  selectSource(sourceId: string, mode?: StreamMode): void;
  /** Backend committed the active source. */
  commitActiveSource(sourceId: string): void;
  /** The transport for a source entered a new phase. */
  setTransportPhase(
    sourceId: string,
    phase: "warming" | "ready" | "failed",
  ): void;

  // --- Mode transitions ---
  /** Source status changed (receiving, standby, transmitting, etc). */
  setSourceStatus(sourceId: string, status: string): void;
  /** Explicit pause/resume for a source/mode. */
  setPaused(sourceId: string, mode: StreamMode, paused: boolean): void;

  // --- Reads ---
  /** The ref the active canvas should read from. */
  getPresentationRef(mode?: StreamMode): { current: IqRawFrame | null };
  /** The frozen frame for a source/mode (if any). */
  getFrozenFrame(sourceId: string, mode: StreamMode): FrozenFrame | null;
  /** Get the slot for a source/mode. */
  getSlot(sourceId: string, mode: StreamMode): Readonly<SourceModeSlot> | null;
  /** Current active presentation. */
  getActivePresentation(): Readonly<ActivePresentation>;
  /** Canvas remount key for the active presentation. */
  getCanvasKey(mode?: StreamMode): string;
  /** Full snapshot for consumers. */
  getSnapshot(mode?: StreamMode): PresentationSnapshot;
  /** All tracked source/mode slots. */
  getAllSlots(): ReadonlyMap<string, Readonly<SourceModeSlot>>;

  // --- Subscription ---
  subscribe(listener: PresentationListener): () => void;

  // --- Cleanup ---
  /** Reset a single source/mode slot. */
  resetSlot(sourceId: string, mode: StreamMode): void;
  /** Reset all state. */
  reset(): void;
}

export const createSourcePresentationController = (
  options: SourcePresentationControllerOptions = {},
): SourcePresentationController => {
  const { persistSnapshots = true } = options;

  const slots = new Map<string, SourceModeSlot>();
  const listeners = new Set<PresentationListener>();

  let active: ActivePresentation = {
    sourceId: "",
    mode: "rx",
    pendingSourceId: null,
  };

  // --- Internal helpers ---

  const ensureSlot = (key: SourceModeKey): SourceModeSlot => {
    const k = slotKeyString(key);
    let slot = slots.get(k);
    if (!slot) {
      slot = createEmptySlot(key);
      slots.set(k, slot);
    }
    return slot;
  };

  const getActiveSlot = (mode?: StreamMode): SourceModeSlot | null => {
    const effectiveSourceId = active.sourceId;
    if (!effectiveSourceId) return null;
    const effectiveMode = mode ?? active.mode;
    return slots.get(slotKeyString({ sourceId: effectiveSourceId, mode: effectiveMode })) ?? null;
  };

  const notify = (): void => {
    if (listeners.size === 0) return;
    const snapshot = getSnapshot();
    for (const listener of listeners) listener(snapshot);
  };

  const advanceResetEpoch = (slot: SourceModeSlot): void => {
    slot.resetEpoch += 1;
    slot.liveFrameRef.current = null;
    slot.lastSequence = null;
  };

  const transitionPhase = (
    slot: SourceModeSlot,
    phase: SourcePresentationPhase,
  ): void => {
    if (slot.phase === phase) return;

    const wasStreaming = STREAMING_PHASES.has(slot.phase);
    const willFreeze = FROZEN_PHASES.has(phase);

    // Freeze the current frame when entering a frozen phase
    if (wasStreaming && willFreeze) {
      const currentFrame = slot.liveFrameRef.current;
      if (currentFrame) {
        slot.frozenFrame = freezeFrame(currentFrame, slot);
        slot.metrics.frozen += 1;

        // Persist to session storage
        if (persistSnapshots) {
          try {
            writePauseSnapshot(snapshotScopeForSlot(slot.key), {
              iqData: currentFrame.iq_data ?? null,
              waterfall: null,
              waterfallDimensions: null,
            });
          } catch {
            // Ignore storage errors
          }
        }
      }
    }

    // Clear live frame when entering non-streaming phases that aren't frozen
    if (!STREAMING_PHASES.has(phase) && !FROZEN_PHASES.has(phase)) {
      slot.liveFrameRef.current = null;
    }

    // Advance reset epoch on phase transitions that invalidate the canvas
    if (
      phase === "switching" ||
      phase === "disconnected" ||
      phase === "failed"
    ) {
      advanceResetEpoch(slot);
    }

    slot.phase = phase;
    notify();
  };

  const resolvePhaseFromStatus = (
    status: string,
    currentPhase: SourcePresentationPhase,
  ): SourcePresentationPhase => {
    switch (status) {
      case "receiving":
      case "streaming":
      case "connected":
        return "streaming";
      case "standby":
        return "standby";
      case "transmitting":
        return "transmitting";
      case "paused":
        return "paused";
      case "loading":
      case "initializing":
      case "stale":
        return status === "stale" ? "stale" : "recovering";
      case "disconnected":
        return "disconnected";
      case "error":
        return "failed";
      default:
        return currentPhase;
    }
  };

  // Restore a frozen frame from session storage for a slot
  const restoreFrozenFrame = (slot: SourceModeSlot): FrozenFrame | null => {
    if (!persistSnapshots) return null;
    try {
      const snapshot = readPauseSnapshot(snapshotScopeForSlot(slot.key));
      if (!snapshot.iqData) return null;
      // Reconstruct a minimal IqRawFrame for the frozen presentation
      const restoredFrame: IqRawFrame = {
        type: "spectrum",
        data_type: "iq_raw",
        iq_data: snapshot.iqData,
        source_id: slot.key.sourceId,
      };
      return {
        frame: restoredFrame,
        frozenAt: Date.now(),
        streamEpoch: slot.streamEpoch,
        sequence: slot.lastSequence,
        centerFrequencyHz: null,
        sampleRateHz: null,
      };
    } catch {
      return null;
    }
  };

  // --- Public API ---

  const acceptFrame: SourcePresentationController["acceptFrame"] = (
    frame,
    modeOverride,
  ) => {
    const sourceId = extractFrameSourceId(frame);
    if (!sourceId) return false;

    const mode = modeOverride ?? resolveModeFromFrame(frame);
    const slot = ensureSlot({ sourceId, mode });

    const isStandbyPreviewFrame =
      frame.frame_status === "standby" ||
      frame.is_tx_preview === true ||
      frame.is_mock_tx_preview === true;

    // Reject frames during non-accepting phases. Standby Tx previews may still
    // land while the slot is "switching" so cold Mock Tx handoff does not drop
    // the first request_next_frame response.
    if (slot.phase === "disconnected" || slot.phase === "failed") {
      slot.metrics.rejected += 1;
      return false;
    }
    if (slot.phase === "switching" && !isStandbyPreviewFrame) {
      slot.metrics.rejected += 1;
      return false;
    }

    // Stream epoch validation (v2 only)
    const frameEpoch = extractStreamEpoch(frame);
    if (frameEpoch !== null) {
      if (slot.streamEpoch !== null && frameEpoch < slot.streamEpoch) {
        slot.metrics.stale += 1;
        return false;
      }
      if (slot.streamEpoch === null || frameEpoch > slot.streamEpoch) {
        slot.streamEpoch = frameEpoch;
        slot.lastSequence = null;
      }
    }

    // Sequence duplicate/reorder rejection (v2 only)
    const frameSequence = extractSequence(frame);
    if (
      frameSequence !== null &&
      slot.lastSequence !== null &&
      frameSequence <= slot.lastSequence
    ) {
      slot.metrics.stale += 1;
      return false;
    }
    if (frameSequence !== null) {
      slot.lastSequence = frameSequence;
    }

    // For the active presentation source: update the live ref
    const isActiveSource =
      sourceId === active.sourceId || sourceId === active.pendingSourceId;

    // Always update the slot's own live ref (per-source tracking)
    slot.liveFrameRef.current = frame;
    slot.metrics.accepted += 1;

    // If the slot is in a frozen phase, update the frozen frame instead
    if (FROZEN_PHASES.has(slot.phase)) {
      slot.frozenFrame = freezeFrame(frame, slot);
      slot.metrics.frozen += 1;

      if (persistSnapshots) {
        try {
          writePauseSnapshot(snapshotScopeForSlot(slot.key), {
            iqData: frame.iq_data ?? null,
            waterfall: null,
            waterfallDimensions: null,
          });
        } catch {
          // Ignore
        }
      }
      return true;
    }

    // Auto-transition idle/warming/switching -> streaming on first accepted
    // frame. Standby preview frames must freeze, not look like live transmission.
    if (
      isActiveSource &&
      (slot.phase === "idle" ||
        slot.phase === "warming" ||
        slot.phase === "switching" ||
        slot.phase === "recovering" ||
        slot.phase === "stale")
    ) {
      if (isStandbyPreviewFrame) {
        slot.frozenFrame = freezeFrame(frame, slot);
        slot.metrics.frozen += 1;
        slot.phase = "standby";
      } else {
        slot.phase = mode === "tx" ? "transmitting" : "streaming";
      }
      notify();
    }

    return true;
  };

  const selectSource: SourcePresentationController["selectSource"] = (
    sourceId,
    mode,
  ) => {
    const effectiveMode = mode ?? active.mode;

    if (active.sourceId === sourceId && active.mode === effectiveMode) return;

    // If there's already an active source, mark its slot as switching
    if (active.sourceId) {
      const currentSlot = slots.get(
        slotKeyString({ sourceId: active.sourceId, mode: active.mode }),
      );
      if (currentSlot && STREAMING_PHASES.has(currentSlot.phase)) {
        // Freeze the current frame before switching
        const currentFrame = currentSlot.liveFrameRef.current;
        if (currentFrame) {
          currentSlot.frozenFrame = freezeFrame(currentFrame, currentSlot);
          currentSlot.metrics.frozen += 1;
        }
        transitionPhase(currentSlot, "paused");
      }
    }

    active = {
      sourceId,
      mode: effectiveMode,
      pendingSourceId: sourceId !== active.sourceId ? sourceId : null,
    };

    // Ensure a slot exists for the new target
    const targetSlot = ensureSlot({ sourceId, mode: effectiveMode });

    // If the target has a frozen frame from a previous session, restore it
    if (targetSlot.frozenFrame === null && persistSnapshots) {
      targetSlot.frozenFrame = restoreFrozenFrame(targetSlot);
    }

    if (targetSlot.phase === "idle") {
      transitionPhase(targetSlot, "switching");
    }

    notify();
  };

  const commitActiveSource: SourcePresentationController["commitActiveSource"] = (
    sourceId,
  ) => {
    if (active.pendingSourceId === sourceId) {
      active = { ...active, sourceId, pendingSourceId: null };
    } else if (active.sourceId !== sourceId) {
      active = { ...active, sourceId, pendingSourceId: null };
    }

    // Transition the committed source's slot out of switching
    const slot = slots.get(
      slotKeyString({ sourceId, mode: active.mode }),
    );
    if (slot?.phase === "switching") {
      transitionPhase(slot, "warming");
    }

    notify();
  };

  const setTransportPhase: SourcePresentationController["setTransportPhase"] = (
    sourceId,
    phase,
  ) => {
    // Apply to all modes for this source
    for (const slot of slots.values()) {
      if (slot.key.sourceId !== sourceId) continue;

      switch (phase) {
        case "warming":
          if (
            slot.phase === "idle" ||
            slot.phase === "switching" ||
            slot.phase === "disconnected"
          ) {
            transitionPhase(slot, "warming");
          }
          break;
        case "ready":
          if (slot.phase === "warming" || slot.phase === "switching") {
            // Don't transition to streaming yet — wait for the first frame
            transitionPhase(slot, "warming");
          }
          break;
        case "failed":
          transitionPhase(slot, "failed");
          break;
      }
    }
  };

  const setSourceStatus: SourcePresentationController["setSourceStatus"] = (
    sourceId,
    status,
  ) => {
    // Apply to the appropriate mode slot(s)
    for (const slot of slots.values()) {
      if (slot.key.sourceId !== sourceId) continue;
      const newPhase = resolvePhaseFromStatus(status, slot.phase);
      transitionPhase(slot, newPhase);
    }
  };

  const setPaused: SourcePresentationController["setPaused"] = (
    sourceId,
    mode,
    paused,
  ) => {
    const slot = ensureSlot({ sourceId, mode });
    if (paused) {
      transitionPhase(slot, "paused");
    } else if (slot.phase === "paused") {
      // Resume: clear frozen frame and go back to streaming
      slot.frozenFrame = null;
      transitionPhase(slot, "streaming");
    }
  };

  const getPresentationRef: SourcePresentationController["getPresentationRef"] = (
    mode,
  ) => {
    const slot = getActiveSlot(mode);
    if (!slot) return { current: null };

    // Prefer a frozen preview whenever live is empty. Switching/warming must
    // still show the last Mock Tx standby graph instead of a black canvas.
    if (slot.frozenFrame && !slot.liveFrameRef.current) {
      return { current: slot.frozenFrame.frame };
    }

    // In frozen phases, return the frozen frame even if a stale live ref lingers.
    if (FROZEN_PHASES.has(slot.phase) && slot.frozenFrame) {
      return { current: slot.frozenFrame.frame };
    }

    return slot.liveFrameRef;
  };

  const getFrozenFrame: SourcePresentationController["getFrozenFrame"] = (
    sourceId,
    mode,
  ) => {
    const k = slotKeyString({ sourceId, mode });
    return slots.get(k)?.frozenFrame ?? null;
  };

  const getSlot: SourcePresentationController["getSlot"] = (
    sourceId,
    mode,
  ) => {
    const k = slotKeyString({ sourceId, mode });
    return slots.get(k) ?? null;
  };

  const getActivePresentation: SourcePresentationController["getActivePresentation"] =
    () => ({ ...active });

  const getCanvasKey: SourcePresentationController["getCanvasKey"] = (
    mode,
  ) => {
    const slot = getActiveSlot(mode);
    if (!slot) return buildCanvasKey(null, mode ?? active.mode, 0);
    return buildCanvasKey(slot.key.sourceId, slot.key.mode, slot.resetEpoch);
  };

  const getSnapshot: SourcePresentationController["getSnapshot"] = (
    mode,
  ) => {
    const slot = getActiveSlot(mode);
    return {
      active: { ...active },
      slot: slot ? { ...slot } : null,
      canvasKey: getCanvasKey(mode),
    };
  };

  const getAllSlots: SourcePresentationController["getAllSlots"] = () =>
    slots as ReadonlyMap<string, Readonly<SourceModeSlot>>;

  const subscribe: SourcePresentationController["subscribe"] = (
    listener,
  ) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const resetSlot: SourcePresentationController["resetSlot"] = (
    sourceId,
    mode,
  ) => {
    const k = slotKeyString({ sourceId, mode });
    const slot = slots.get(k);
    if (!slot) return;
    slot.phase = "idle";
    slot.liveFrameRef.current = null;
    slot.frozenFrame = null;
    slot.streamEpoch = null;
    slot.lastSequence = null;
    slot.resetEpoch += 1;
    slot.metrics = { accepted: 0, rejected: 0, stale: 0, frozen: 0 };
    notify();
  };

  const reset: SourcePresentationController["reset"] = () => {
    slots.clear();
    active = { sourceId: "", mode: "rx", pendingSourceId: null };
    notify();
  };

  return {
    acceptFrame,
    selectSource,
    commitActiveSource,
    setTransportPhase,
    setSourceStatus,
    setPaused,
    getPresentationRef,
    getFrozenFrame,
    getSlot,
    getActivePresentation,
    getCanvasKey,
    getSnapshot,
    getAllSlots,
    subscribe,
    resetSlot,
    reset,
  };
};
