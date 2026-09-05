import React, {
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  memo,
} from "react";
import type {
  FrequencyRange,
  SpectrumFrame,
  SdrSettingsConfig,
  DeviceProfile,
  CaptureStatus,
  SDRSettings,
  CaptureRequest,
  SourceSdrSettings,
  DeviceState,
  DeviceLoadingReason,
  SourceInfo,
  DeviceActiveMode,
} from "@n-apt/consts/schemas/websocket";
import { isMockDevice, isMockTxSource } from "@n-apt/app/infrastructure/services/deviceCapabilities";
import { useLocation } from "react-router";
import { FRONTEND_VISUALIZER_DEFAULTS, getVisualizerDefaultDbLimits } from "@n-apt/consts/visualizerControls";
import { useAppDispatch, useAppSelector } from "@n-apt/redux/store";
import {
  selectActiveSourceDerivedState,
  selectActiveSource,
  selectSourceSelectionLifecycle,
  deriveSourceDerivedState,
} from "@n-apt/redux/selectors/performanceSelectors";
import {
  clearWaterfall,
  resetTrainingCapture,
  resetWaterfallCleared,
  setDrawSignal3D as setWaterfallDrawSignal3D,
  setGlobalNoiseFloor as setWaterfallGlobalNoiseFloor,
  setSelectedFiles as setWaterfallSelectedFiles,
  setSnapshotGrid as setWaterfallSnapshotGrid,
  setSourceMode as setWaterfallSourceMode,
  setStitchPaused as setWaterfallStitchPaused,
  setStitchSourceSettings as setWaterfallStitchSourceSettings,
  setStitchStatus as setWaterfallStitchStatus,
  toggleStitchPause as toggleWaterfallStitchPause,
  triggerStitch as triggerWaterfallStitch,
  setSdrSettingsBundle as setSdrSettingsBundleAction,
  setFrequencyRange as setFrequencyRangeAction,
  setActiveSignalArea,
  setSignalAreaAndRange,
  setTemporalResolution,
  setFftFrameRate,
  setFftWindow,
  setDisplayMode,
  setDiagnosticStatus,
  setDiagnosticRunning,
  setStitchOption,
  setStitchOptionValue,
  setVizZoom,
  setSampleRate as setSampleRateAction,
  setMinReceiveSampleRate as setMinReceiveSampleRateAction,
  setVisualizerPaused as setVisualizerPausedAction,
  setDetectedFrameRate,
  setVizZoomFloor as setVizZoomFloorAction,
  setVizZoomFloorPan as setVizZoomFloorPanAction,
  setAutoZoomStability as setAutoZoomStabilityAction,
  setVizPan as setVizPanAction,
  setFftDbLimits as setFftDbLimitsAction,
  setPowerScale as setPowerScaleAction,
  resetLiveControls as resetLiveControlsAction,
  resetZoomAndDb as resetZoomAndDbAction,
  setShowSpikeOverlay as setShowSpikeOverlayAction,
  setRemoveDcSpike as setRemoveDcSpikeAction,
  setDrawParams as setWaterfallDrawParams,
  setClumpParams as setWaterfallClumpParams,
  setActiveClumpIndex as setWaterfallActiveClumpIndex,
  resetDrawParams as resetWaterfallDrawParams,
  setSelectedSourceId as setReduxSelectedSourceId,
  setSelectionIntentSourceId as setReduxSelectionIntentSourceId,
  restoreSelectedSource as restoreReduxSelectedSource,
  selectSource as selectReduxSource,
  setPendingSourceSwitchId as setReduxPendingSourceSwitchId,
} from "@n-apt/redux";
import {
  liveDataBySourceRef,
  liveDataRef,
  presentationController,
  sourceVisualizationRuntime,
} from "@n-apt/redux/middleware/websocketMiddleware";
import { SpectrumStoreContext } from "@n-apt/spectrum/hooks/spectrumStoreContext";
import { sourceSpectrumRuntime } from "@n-apt/app/infrastructure/visualization/sourceVisualizationRuntime";
import { getLiveFrameRefForSource } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import {
  sendPowerScaleCommand as sendPowerScaleCommandThunk,
  sendTrainingCommand as sendTrainingCommandThunk,
  sendFrequencyRange as sendFrequencyRangeThunk,
  requestNextPausedFrame as requestNextPausedFrameThunk,
  sendSettings as sendSettingsThunk,
  sendRestartDevice as sendRestartDeviceThunk,
  sendCaptureCommand as sendCaptureCommandThunk,
  sendScanCommand as sendScanCommandThunk,
  sendDemodulateCommand as sendDemodulateCommandThunk,
  sendViewSource as sendViewSourceThunk,
} from "@n-apt/redux/thunks/websocketThunks";
import { deriveStateFromConfig } from "@n-apt/settings/public/useSdrSettings";
import { applyWaterfallStateOverrides } from "@n-apt/spectrum/hooks/spectrumStoreOverrides";
import { resolvePausedPreviewRequestSourceId } from "@n-apt/app/routes/pages/spectrum/mockTxPreview";
import {
  createFFTVisualizerMachine,
  type FFTVisualizerMachine,
} from "@n-apt/app/infrastructure/visualization/fftVisualizerMachine";
import {
  clampFrequencyRangeToBounds,
  normalizeFrequencyRangeToHz,
} from "@n-apt/math/frequency";
import {
  getSourceViewStorageKeyForSource,
  loadStoredJson,
  saveStoredJson,
  loadSelectedSourceId,
  saveSelectedSourceId,
  shouldSkipSelectedSourcePersistence,
} from "@n-apt/spectrum/utils/sourcePersistence";
import {
  clampRtlSdrFrequencyRangeToHardwareWindow,
  isHackrfDevice,
  isRtlSdrDevice,
  resolveSourceSampleRateHz,
} from "@n-apt/app/infrastructure/io/sdrSampleRateGuards";
import {
  resolveSourceFrequencyRangeSync,
  shouldSkipDeviceFrequencyRangeEcho,
} from "@n-apt/spectrum/utils/sourceFrequencySync";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";
import { resolveSourceModeManagement } from "@n-apt/app/infrastructure/streams/sourceModeManagement";
import {
  resolveTxSuiteControlSourceId,
  shouldPinTxSuiteToRxSource,
} from "@n-apt/transmit/public/txSuiteSourceControl";
import { resolveMockTxTransmitSettings } from "@n-apt/transmit/public/txSliderPlacement";
import type { TemporalResolution } from "@n-apt/math/temporalResolution";
import { normalizePositiveHardwareRange } from "@n-apt/math/basebandMirror";

// Types
export type SourceMode = "live" | "file";
export type SelectedFile = { id: string; name: string; downloadUrl?: string };

const MANUAL_VISUALIZER_PAUSE_KEY = "napt-visualizer-manual-paused";
const VISUALIZER_FRAME_RATE_KEY = "napt-visualizer-frame-rate";

export const persistManualVisualizerPaused = (paused: boolean): void => {
  if (typeof window === "undefined") return;
  try {
    // Pause is presentation state owned by this browser session. localStorage
    // is shared by windows/tabs and would make one subscriber pause another.
    window.sessionStorage.setItem(
      MANUAL_VISUALIZER_PAUSE_KEY,
      JSON.stringify(paused),
    );
  } catch {
    /* ignore */
  }
};

export const loadPersistedManualVisualizerPaused = (): boolean | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(MANUAL_VISUALIZER_PAUSE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) === true;
  } catch {
    return null;
  }
};

/**
 * A full page load starts a new live presentation. A session marker can be
 * left behind by a renderer freeze or an interrupted pause command, so it
 * must not force the fresh stream into a paused state.
 */
export const resolveColdStartVisualizerPauseState = ({
  persistedPaused: _persistedPaused,
}: {
  persistedPaused?: boolean | null;
}): boolean => false;

export const updateLocalSourcePauseOverride = (
  current: Record<string, boolean>,
  sourceId: string,
  paused: boolean,
): Record<string, boolean> => {
  if (
    current[sourceId] === paused ||
    (paused === false && current[sourceId] === undefined)
  ) {
    return current;
  }
  return { ...current, [sourceId]: paused };
};

const getPersistedNumber = (key: string): number | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
};

const isMockSourceInfo = (source: SourceInfo | null | undefined): boolean => {
  if (!source) return false;
  return isMockDevice({
    capability: source.capability,
    id: source.id,
    name: source.name,
    backend: source.kind,
  });
};

export const resolveSelectedSourceIdForInventory = ({
  selectedSourceId,
  activeSourceId,
  pendingSourceSwitchId = null,
  selectionIntentSourceId = null,
  sources,
}: {
  selectedSourceId: string;
  activeSourceId: string;
  pendingSourceSwitchId?: string | null;
  selectionIntentSourceId?: string | null;
  sources: SourceInfo[];
}): string => {
  const selectedSourceIsInInventory = sources.some(
    (source) => source.id === selectedSourceId,
  );
  const selectedSource = sources.find(
    (source) => source.id === selectedSourceId,
  );
  const selectedSourceIsUnavailable = ["disconnected", "error"].includes(
    selectedSource?.status ?? "",
  );
  const explicitIntentSourceId =
    pendingSourceSwitchId ?? selectionIntentSourceId;
  if (explicitIntentSourceId && !selectedSourceId) {
    return explicitIntentSourceId;
  }
  const hasExplicitSelectionIntent =
    (pendingSourceSwitchId !== null &&
      pendingSourceSwitchId === selectedSourceId) ||
    (selectionIntentSourceId !== null &&
      selectionIntentSourceId === selectedSourceId);
  if (
    hasExplicitSelectionIntent &&
    selectedSourceIsInInventory &&
    !selectedSourceIsUnavailable
  ) {
    return selectedSourceId;
  }
  // Cold-start source_info can omit Mock Tx for a tick while Mock APT is
  // still active. Snapping to active here reverts the click before
  // select_source is even dispatched.
  if (
    hasExplicitSelectionIntent &&
    sources.some((source) => source.id === activeSourceId) &&
    activeSourceId !== selectedSourceId &&
    !selectedSourceIsUnavailable
  ) {
    return selectedSourceId;
  }
  // Inventory is briefly empty during reconnect/startup. Clearing here races
  // the persisted-selection hydration effect, producing an endless
  // selected ID -> "" -> selected ID cycle.
  if (sources.length === 0) return selectedSourceId;
  const active = sources.find((source) => source.id === activeSourceId);
  const selected = sources.find((source) => source.id === selectedSourceId);
  const hardwareSources = sources.filter((source) => !isMockSourceInfo(source));
  const targetHardware =
    hardwareSources.find((source) => source.id === activeSourceId) ??
    hardwareSources.find(
      (source) =>
        source.status === "initializing" ||
        source.status === "loading" ||
        source.status === "streaming" ||
        source.status === "connected",
    );

  // The backend may keep Mock APT active while a real device is being
  // enumerated or recovered. Prefer the usable hardware in that transient
  // state so the UI can issue the source switch instead of settling on the
  // fallback forever.
  if (
    active &&
    isMockSourceInfo(active) &&
    targetHardware &&
    (!selected ||
      isMockSourceInfo(selected) ||
      (!isMockSourceInfo(selected) && selected.id === targetHardware.id))
  ) {
    return targetHardware.id;
  }
  // The backend active source is global, but the selected source is a tab-local
  // presentation/stream preference. Keep an available selection when another
  // client changes the backend's active source; only an explicit intent should
  // request a new global handoff.
  const selectedSourceIsMockTx =
    selected?.id === "mock-tx" || selected?.kind === "mock_tx";
  const activeSourceIsHardware = active && !isMockSourceInfo(active);
  if (
    selectedSourceIsInInventory &&
    !selectedSourceIsUnavailable &&
    (!activeSourceIsHardware || selectedSourceIsMockTx)
  ) {
    return selectedSourceId;
  }
  if (active) return active.id;

  if (targetHardware && (!selected || isMockSourceInfo(selected))) {
    return targetHardware.id;
  }
  if (
    selected &&
    selected.status === "disconnected" &&
    activeSourceId.startsWith("mock")
  ) {
    return activeSourceId;
  }
  if (selected) return selected.id;
  return (
    sources.find((source) => source.id === activeSourceId)?.id ?? sources[0].id
  );
};

/**
 * Preserve an explicit inventory choice as a source-switch intent when the
 * server is still presenting a fallback source (for example Mock APT after a
 * HackRF reconnect). Without this intent the selection effect correctly
 * treats the ID as passive UI state and never sends select_source.
 */
export const resolveInventorySelectionIntent = ({
  selectedSourceId,
  activeSourceId,
  pendingSourceSwitchId = null,
  selectionIntentSourceId = null,
  sources,
}: {
  selectedSourceId: string;
  activeSourceId: string;
  pendingSourceSwitchId?: string | null;
  selectionIntentSourceId?: string | null;
  sources: SourceInfo[];
}): string | null => {
  const nextSourceId = resolveSelectedSourceIdForInventory({
    selectedSourceId,
    activeSourceId,
    pendingSourceSwitchId,
    selectionIntentSourceId,
    sources,
  });
  const selectedSource = sources.find(
    (source) => source.id === selectedSourceId,
  );
  const selectionIntentSource = selectionIntentSourceId
    ? sources.find((source) => source.id === selectionIntentSourceId)
    : null;
  if (
    selectionIntentSourceId &&
    !selectionIntentSource &&
    sources.some((source) => source.id === activeSourceId)
  ) {
    return null;
  }
  if (
    selectedSource &&
    ["disconnected", "error"].includes(selectedSource.status ?? "") &&
    sources.some((source) => source.id === activeSourceId)
  ) {
    return null;
  }
  if (nextSourceId && nextSourceId !== activeSourceId) {
    const hasExplicitSelectionIntent =
      pendingSourceSwitchId === selectedSourceId ||
      selectionIntentSourceId === selectedSourceId;
    const nextSource = sources.find((source) => source.id === nextSourceId);
    const activeSource = sources.find((source) => source.id === activeSourceId);
    const isAutomaticHardwareSelection =
      nextSourceId !== selectedSourceId &&
      isMockSourceInfo(activeSource) &&
      !isMockSourceInfo(nextSource);
    const isAutomaticHardwareRecovery =
      nextSourceId === selectedSourceId &&
      isMockSourceInfo(activeSource) &&
      !isMockSourceInfo(nextSource);
    if (
      hasExplicitSelectionIntent ||
      isAutomaticHardwareSelection ||
      isAutomaticHardwareRecovery
    ) {
      return nextSourceId;
    }
    // The active source may have changed in another tab. Keep this tab's
    // selected source without replaying it as a new global switch request.
    return selectionIntentSourceId;
  }
  return selectionIntentSourceId;
};

export const resolveInitialSourceSelection = ({
  activeSourceId,
  storedSourceId,
  sources,
}: {
  activeSourceId: string;
  storedSourceId: string | null;
  sources: SourceInfo[];
}): { selectedSourceId: string | null; selectionIntentSourceId: string | null } => {
  const hardwareSources = sources.filter((source) => !isMockSourceInfo(source));
  const soleHardwareSourceId =
    hardwareSources.length === 1 ? hardwareSources[0]?.id : null;
  const storedSourceIsInInventory =
    !!storedSourceId && sources.some((source) => source.id === storedSourceId);
  const selectedSourceId =
    soleHardwareSourceId ||
    (storedSourceIsInInventory ? storedSourceId : null) ||
    sources[0]?.id ||
    null;
  return {
    selectedSourceId,
    selectionIntentSourceId:
      selectedSourceId && !activeSourceId
        ? selectedSourceId
        : null,
  };
};

export const shouldClearPendingSourceSwitch = ({
  pendingSourceSwitchId,
  selectedSourceId,
  activeSourceId,
  selectionIntentSourceId = null,
}: {
  pendingSourceSwitchId: string | null;
  selectedSourceId: string;
  activeSourceId: string;
  selectionIntentSourceId?: string | null;
}): boolean =>
  pendingSourceSwitchId !== null &&
  pendingSourceSwitchId !== activeSourceId &&
  pendingSourceSwitchId !== selectedSourceId &&
  pendingSourceSwitchId !== selectionIntentSourceId;

/**
 * Resolve the source represented by this client. The selected source is a
 * tab-local presentation choice; the backend active source is only a
 * fallback while this client has not selected anything yet.
 */
export const resolveStreamingSourceForDisplay = ({
  selectedSourceId,
  activeSourceId,
  sources,
}: {
  selectedSourceId: string;
  activeSourceId: string;
  sources: SourceInfo[];
}): SourceInfo | null =>
  sources.find((source) => source.id === selectedSourceId) ??
  sources.find((source) => source.id === activeSourceId) ??
  sources[0] ??
  null;

/**
 * Resolve the live frame owner for this browser client. Backend active-source
 * state is global device control state, not a subscriber's presentation
 * choice, so a foreign client's Tx transition must not clear this client's
 * selected RX stream.
 */
export const resolveClientLiveSourceId = ({
  selectedSourceId,
  activeSourceId,
}: {
  selectedSourceId: string | null | undefined;
  activeSourceId: string | null | undefined;
}): string | null => selectedSourceId ?? activeSourceId ?? null;

export const resolveDeviceActiveMode = (
  source: SourceInfo | null | undefined,
): DeviceActiveMode => {
  return source?.status === "transmitting" ||
    source?.status === "standby" ||
    isMockTxSource({ id: source?.id, kind: source?.kind })
    ? "tx"
    : "rx";
};

const isTxCapableSourceInfo = (
  source: SourceInfo | null | undefined,
): boolean => {
  if (!source) return false;
  const capability = source.capability?.toLowerCase?.() ?? "";
  return (
    capability === "tx" ||
    capability === "tx_rx" ||
    isMockTxSource({ id: source.id, kind: source.kind })
  );
};

/**
 * Paused-frame requests are source-owned previews. A TX/RX device can still
 * be an RX view, while Mock Tx and a source bound to the TX view remain owned
 * by their source-bound preview path.
 */
export const shouldRequestPausedPreview = (
  source: SourceInfo | null | undefined,
  txBindingSourceId?: string | null,
): boolean => {
  if (!source) return false;
  if (source.status === "transmitting") return false;
  // SpectrumRoute owns Mock Tx one-shots; stacking an incomplete request here
  // can leave the monitor on a noise-floor / Loading path.
  if (isMockTxSource({ id: source.id, kind: source.kind })) return false;
  // Capability describes what a device can do, not which view currently owns
  // it. A TX/RX device still needs paused RX view refreshes unless it is bound
  // to the TX presentation.
  const sourceMode = resolveSourceModeManagement({
    source,
    txBindingSourceId,
  });
  return (
    sourceMode.isRxMode &&
    sourceMode.shouldRequestRxFrame &&
    source.iq_format != null
  );
};

/** Persist per-source view only for the committed active stream. */
export const shouldPersistSelectedSourceView = ({
  selectedSourceId,
  activeSourceId,
  sourceMode,
}: {
  selectedSourceId?: string | null;
  activeSourceId?: string | null;
  sourceMode: string;
}): boolean => {
  if (!selectedSourceId) return false;
  if (
    sourceMode === "live" &&
    typeof activeSourceId === "string" &&
    activeSourceId.length > 0 &&
    selectedSourceId !== activeSourceId
  ) {
    return false;
  }
  return true;
};

/** Snapshot only subscriber-local presentation state at source selection time. */
export const resolveLeavingSourceViewSnapshot = ({
  previousSelectedSourceId,
  nextSelectedSourceId,
  previousSourceViewKey,
  state,
}: {
  previousSelectedSourceId: string | null;
  nextSelectedSourceId?: string | null;
  previousSourceViewKey: string | null;
  state: SpectrumState;
}): {
  key: string;
  view: ReturnType<typeof buildPersistedSourceViewState>;
} | null => {
  if (!nextSelectedSourceId || !previousSelectedSourceId) return null;
  if (previousSelectedSourceId === nextSelectedSourceId) return null;
  if (!previousSourceViewKey) return null;
  return {
    key: previousSourceViewKey,
    view: buildPersistedSourceViewState(state),
  };
};

export const buildPausedPreviewSignature = ({
  frequencyRange,
  sampleRateHz,
  fftSize,
  fftWindow,
  vizZoom,
  vizPanOffset,
  txCenterFrequencyHz,
  txSampleRateHz,
  txPowerDbm,
  txSignal,
  txIfftSize,
}: {
  frequencyRange: FrequencyRange | null | undefined;
  sampleRateHz: number | null | undefined;
  fftSize: number | null | undefined;
  fftWindow: string | null | undefined;
  vizZoom: number;
  vizPanOffset: number;
  txCenterFrequencyHz: number;
  txSampleRateHz: number;
  txPowerDbm: number;
  txSignal: string;
  txIfftSize: number;
}): string => {
  const rangeSignature = frequencyRange
    ? `${frequencyRange.min}:${frequencyRange.max}`
    : "none";
  return [
    rangeSignature,
    sampleRateHz,
    fftSize,
    fftWindow,
    vizZoom,
    vizPanOffset,
    txCenterFrequencyHz,
    txSampleRateHz,
    txPowerDbm,
    txSignal,
    txIfftSize,
  ].join("|");
};

export const isHalfDuplexSourceInfo = (
  source: SourceInfo | null | undefined,
): boolean => {
  const duplexMode = source?.duplex_mode?.toLowerCase?.() ?? "";
  return duplexMode === "half-duplex";
};

export const shouldAutoResumeVisualizerOnSourceSwitch = (
  selectedSource: SourceInfo | null | undefined,
  autoPausedOnSourceSwitch: boolean,
): boolean =>
  autoPausedOnSourceSwitch &&
  !!selectedSource &&
  !isTxCapableSourceInfo(selectedSource);

export const shouldAutoPauseVisualizerOnRouteLeave = (
  selectedSource: SourceInfo | null | undefined,
): boolean => !!selectedSource && !isTxCapableSourceInfo(selectedSource);

export const shouldAutoResumeVisualizerOnTxSelection = (
  selectedSource: SourceInfo | null | undefined,
  manualVisualizerPaused: boolean,
): boolean =>
  !!selectedSource &&
  !isTxCapableSourceInfo(selectedSource) &&
  manualVisualizerPaused;

export const shouldSyncVisualizerPauseToBackend = (
  selectedSource: SourceInfo | null | undefined,
): boolean => !!selectedSource && !isTxCapableSourceInfo(selectedSource);

export const shouldPauseSourceOnSwitch = (
  source: SourceInfo | null | undefined,
  nextSource?: SourceInfo | null,
): boolean => {
  if (!source) return false;
  // This is a subscriber-local pause. It stops this tab's inactive RX
  // subscription without changing another client viewing the same source.
  // Keep the destination in the signature because callers compare the
  // complete source transition, but do not use global TX capability as a
  // reason to leave this tab's old RX stream running.
  void nextSource;
  if (
    source.status === "transmitting" ||
    resolveSourceModeManagement({ source }).isTxMode
  ) {
    return false;
  }
  return (
    isHalfDuplexSourceInfo(source) || !isTxCapableSourceInfo(source)
  );
};

export const shouldResumePausedRxSourceOnSelection = (
  source: SourceInfo | null | undefined,
  manuallyPaused: boolean,
  txBindingSourceId?: string | null,
): boolean =>
  !!source &&
  !manuallyPaused &&
  source.id !== txBindingSourceId &&
  source.paused === true &&
  source.status !== "standby" &&
  (!isTxCapableSourceInfo(source) ||
      (isHalfDuplexSourceInfo(source) && source.status !== "transmitting"));

/** Resolve a pause transition without allowing stale transport state to invert it. */
export const resolveNextVisualizerPauseState = ({
  currentPaused,
  requestedPaused,
}: {
  currentPaused: boolean;
  requestedPaused?: boolean;
}): boolean =>
  typeof requestedPaused === "boolean" ? requestedPaused : !currentPaused;

const isRecoverableLiveSourceStatus = (
  status: string | null | undefined,
): boolean => {
  const normalized = status?.toLowerCase?.() ?? "";
  return ![
    "loading",
    "disconnected",
    "stale",
    "error",
    "standby",
    "transmitting",
  ].includes(normalized);
};

export const shouldAutoResumeVisualizerOnDeviceRecovery = (
  source: SourceInfo | null | undefined,
  manuallyPaused: boolean,
  currentDeviceState: DeviceState | null | undefined,
  previousDeviceState: DeviceState | null | undefined,
): boolean =>
  !!source &&
  !manuallyPaused &&
  previousDeviceState !== "connected" &&
  currentDeviceState === "connected" &&
  isRecoverableLiveSourceStatus(source.status);

export const isLiveVisualizerPathname = (pathname: string): boolean =>
  pathname === "/" || pathname === "/visualizer";

export const shouldSendSelectSource = ({
  isConnected,
  sourceMode,
  selectedSourceId,
  activeSourceId,
  selectionIntentSourceId,
  selectedSourceStatus,
  availableSourceIds,
}: {
  isConnected: boolean;
  sourceMode: SourceMode;
  selectedSourceId: string;
  activeSourceId: string;
  selectionIntentSourceId: string | null;
  selectedSourceStatus?: string | null;
  availableSourceIds: string[];
}): boolean => {
  // Page source selection is subscriber-local. Device-wide source control is
  // owned by the explicit TX/RX control commands, never by changing which
  // source this browser tab is viewing.
  if (
    sourceMode !== "live" ||
    !isConnected ||
    selectedSourceId.length === 0 ||
    selectedSourceId === activeSourceId ||
    !availableSourceIds.includes(selectedSourceId)
  ) {
    return false;
  }

  if (["disconnected", "stale", "error"].includes(selectedSourceStatus ?? "")) {
    return false;
  }
  void selectionIntentSourceId;
  return false;
};

/**
 * A local view request is still required when selection returns to the
 * process-wide active source after this tab was viewing another source. The
 * middleware uses that request to replace its transient handoff target;
 * otherwise the previous source remains the frame filter even though Redux
 * now points at the active source.
 */
export const shouldRequestSubscriberViewSource = ({
  selectedSourceId,
  activeSourceId,
  presentationSourceId,
  lastRequestedSourceId,
}: {
  selectedSourceId: string | null | undefined;
  activeSourceId: string | null | undefined;
  /** Current local presentation binding; null means the controller was reset. */
  presentationSourceId?: string | null;
  lastRequestedSourceId: string | null | undefined;
}): boolean =>
  !!selectedSourceId &&
  selectedSourceId !== lastRequestedSourceId &&
  (selectedSourceId !== activeSourceId ||
    !!lastRequestedSourceId ||
    (presentationSourceId !== undefined &&
      presentationSourceId !== selectedSourceId));

export const resolveEffectiveSourcePaused = ({
  backendPaused,
  localPaused,
  manuallyPaused,
  autoPaused,
}: {
  backendPaused?: boolean;
  localPaused?: boolean;
  manuallyPaused: boolean;
  autoPaused: boolean;
}): boolean => {
  // Refs update synchronously on click; backend snapshots and React local
  // overrides can still say "live" for a frame. A stale `false` must not
  // win over an in-flight user pause.
  if (manuallyPaused || autoPaused) return true;
  return localPaused ?? backendPaused ?? false;
};

/**
 * The button pause state is owned entirely by the client: the manual/auto
 * latches and the local override. The backend snapshot is never consulted, so
 * a live backend report cannot unpause a stream the user paused locally, and a
 * stale paused backend report cannot re-pin a stream the user resumed.
 */
export const resolveClientPauseState = ({
  localPaused,
  manuallyPaused,
  autoPaused,
}: {
  localPaused?: boolean;
  manuallyPaused: boolean;
  autoPaused: boolean;
}): boolean =>
  localPaused === true || manuallyPaused || autoPaused;

/**
 * Compute a button toggle from client-owned state, not a possibly stale
 * source_info snapshot. This is used while a stream is opening and during
 * source handoff, when the backend's paused bit can lag the user's click.
 */
export const resolveToggleVisualizerPauseState = ({
  backendPaused,
  localPaused,
  manuallyPaused,
  autoPaused,
}: {
  backendPaused?: boolean;
  localPaused?: boolean;
  manuallyPaused: boolean;
  autoPaused: boolean;
}): boolean =>
  !resolveEffectiveSourcePaused({
    backendPaused,
    localPaused,
    manuallyPaused,
    autoPaused,
  });

/** Pause the playing stream unless the caller named a specific source. */
export const resolvePauseTargetSourceId = ({
  requestedSourceId,
  selectedSourceId,
  activeSourceId,
}: {
  requestedSourceId?: string;
  selectedSourceId: string;
  activeSourceId: string;
}): string => requestedSourceId || activeSourceId || selectedSourceId;

export const shouldReplayManualPauseOnSourceActivation = ({
  activeSourceId,
  selectedSourceId,
  manuallyPaused,
  backendPaused,
  pauseReplaySentForSourceId,
}: {
  activeSourceId: string;
  selectedSourceId: string;
  manuallyPaused: boolean;
  backendPaused?: boolean;
  pauseReplaySentForSourceId: string | null;
}): boolean =>
  !!activeSourceId &&
  activeSourceId === selectedSourceId &&
  manuallyPaused &&
  backendPaused !== true &&
  pauseReplaySentForSourceId !== activeSourceId;

export const shouldCarryManualPauseToSelectedSource = ({
  requestedPaused,
  selectedSourceId,
  pauseTargetSourceId,
}: {
  requestedPaused: boolean;
  selectedSourceId: string;
  pauseTargetSourceId: string;
}): boolean =>
  requestedPaused &&
  !!selectedSourceId &&
  selectedSourceId !== pauseTargetSourceId;

const estimateRefreshRateFromSamples = (samples: number[]): number | null => {
  if (samples.length === 0) return null;

  const sorted = [...samples]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  // Use the fastest stable cluster to approximate the display's max refresh.
  // Average-based estimates are easily pulled down by occasional dropped frames.
  const fastestClusterSize = Math.max(5, Math.floor(sorted.length * 0.25));
  const fastestCluster = sorted.slice(0, fastestClusterSize);
  const medianOfFastestCluster =
    fastestCluster[Math.floor(fastestCluster.length / 2)];

  if (!medianOfFastestCluster || medianOfFastestCluster <= 0) return null;

  const estimatedFps = 1000 / medianOfFastestCluster;

  // Snap to common refresh rates when we're close enough to them.
  const commonRates = [24, 30, 48, 50, 60, 90, 120, 144, 165, 240];
  const nearest = commonRates.reduce(
    (best, rate) => {
      const distance = Math.abs(rate - estimatedFps);
      return distance < best.distance ? { rate, distance } : best;
    },
    { rate: estimatedFps, distance: Number.POSITIVE_INFINITY },
  );

  return nearest.distance <= 3 ? nearest.rate : estimatedFps;
};

const detectRefreshRate = async (sampleCount = 180): Promise<number | null> => {
  if (typeof window === "undefined") return null;

  return await new Promise((resolve) => {
    const samples: number[] = [];
    let last = performance.now();
    let rafId = 0;

    const finish = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      resolve(estimateRefreshRateFromSamples(samples));
    };

    const loop = (now: number) => {
      samples.push(now - last);
      last = now;

      if (samples.length >= sampleCount) {
        finish();
        return;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
  });
};

export const LIVE_CONTROL_DEFAULTS = {
  displayTemporalResolution: "reduced" as const,
  powerScale: "dB" as const,
  vizZoom: FRONTEND_VISUALIZER_DEFAULTS.zoom,
  vizZoomFloor: FRONTEND_VISUALIZER_DEFAULTS.zoomFloor,
  vizZoomFloorPan: FRONTEND_VISUALIZER_DEFAULTS.zoomFloorPan,
  autoZoomStability: true,
  vizPanOffset: 0,
  fftMinDb: getVisualizerDefaultDbLimits("dB").min,
  fftMaxDb: getVisualizerDefaultDbLimits("dB").max,
  fftWindow: "Rectangular",
  gain: 46.9,
  hackrfLnaGain: 0.0,
  hackrfVgaGain: 30.0,
  hackrfAmpEnabled: false,
  hackrfBasebandBandwidth: 3_200_000,
  ppm: 1,
  tunerAGC: false,
  rtlAGC: false,
};

export type BeatParams = {
  offsetHz: number;
};

export type DrawParams = {
  spikeCount: number;
  spikeWidth: number;
  centerSpikeBoost: number;
  spikesAmplitude: number; // Unit: dB (max 0)
  decayRate: number;
  envelopeWidth: number;
  centerOffset: number; // Unit: Hz
  peakAmplitude: number; // Unit: dB (max 0)
  simulatedNoise: number;
  beats: BeatParams[]; // Up to 2 beats
  baseSignalType?: "none" | "gaussian" | "bpsk";
  baseSignalAmplitude?: number; // dB
};

export type SpectrumState = {
  activeSignalArea: string;
  frequencyRange: FrequencyRange | null;
  tuningPreviewActive: boolean;
  displayTemporalResolution: TemporalResolution;
  powerScale: "dB" | "dBm";
  selectedFiles: SelectedFile[];
  snapshotGridPreference: boolean;
  drawParams: DrawParams[];
  activeClumpIndex: number;
  globalNoiseFloor: number; // Unit: dB
  sourceMode: SourceMode;
  stitchStatus: string;
  visualizerPaused: boolean;
  isTrainingCapturing: boolean;
  trainingCaptureLabel: "target" | "noise" | null;
  trainingCapturedSamples: number;
  stitchTrigger: number;
  stitchSourceSettings: { gain: number; ppm: number };
  isStitchPaused: boolean;
  fftFrameRate: number;
  detectedFrameRate: number | null;
  isWaterfallCleared: boolean;
  vizZoom: number;
  vizPanOffset: number;
  fftMinDb: number;
  fftMaxDb: number;
  fftSize: number;
  fftWindow: string;
  showSpikeOverlay: boolean;
  removeDcSpike: boolean;
  gain: number;
  txSignal: string;
  hackrfLnaGain: number;
  hackrfVgaGain: number;
  hackrfAmpEnabled: boolean;
  hackrfBasebandBandwidth: number | null;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  sampleRateHz: number;
  minReceiveSampleRateHz: number;
  lastKnownRanges: Record<string, { min: number; max: number }>;
  diagnosticStatus: string;
  isDiagnosticRunning: boolean;
  diagnosticTrigger: number;
  drawSignal3D: boolean;
  displayMode: "fft" | "iq";
  fftAvgEnabled: boolean;
  fftSmoothEnabled: boolean;
  wfSmoothEnabled: boolean;
  vizZoomFloor: number;
  vizZoomFloorPan: number;
  autoZoomStability: boolean;
  stitchOptions: {
    phaseCorrection: boolean;
    fmDeviationCorrection: boolean;
    antiAliasing: boolean;
    noiseFloorMatching: boolean;
    crossfading: boolean;
    chineseRemainderSynthesis: boolean;
    jsAntiAliasing: boolean;
    jsNoiseFloorMatching: boolean;
    acquisitionMode: "stepwise" | "interleaved";
  };
};

// Only subscriber-local presentation state belongs in a browser's source
// view cache. The live center/range is device-scoped SSOT: persisting it here
// lets a second client replay a trapped range during hydration and retune the
// shared source, which later appears as a pause/unpause frequency jump.
const PERSISTED_SOURCE_VIEW_FIELDS: Array<keyof SpectrumState> = [
  "displayTemporalResolution",
  "powerScale",
  "vizZoom",
  "vizZoomFloor",
  "vizZoomFloorPan",
  "autoZoomStability",
  "vizPanOffset",
  "fftMinDb",
  "fftMaxDb",
  "showSpikeOverlay",
  "removeDcSpike",
  "displayMode",
  "fftAvgEnabled",
  "fftSmoothEnabled",
  "wfSmoothEnabled",
];

/**
 * Live acquisition bounds are device-scoped. A channel frame is only a
 * hydration fallback; letting it win at 1x makes a subscriber's zoom history
 * decide whether the shared source can reach an edge such as 0 Hz.
 */
export const resolveLiveAcquisitionBounds = ({
  hardwareBounds,
  channelBounds,
}: {
  hardwareBounds?: FrequencyRange | null;
  channelBounds?: FrequencyRange | null;
}): FrequencyRange | null => {
  if (
    hardwareBounds &&
    Number.isFinite(hardwareBounds.min) &&
    Number.isFinite(hardwareBounds.max) &&
    hardwareBounds.max > hardwareBounds.min
  ) {
    return hardwareBounds;
  }
  return channelBounds ?? null;
};

// Every persisted source-view field is subscriber-local and safe to restore
// immediately; device options come from the current live stream instead.
const INITIAL_SOURCE_HYDRATION_LOCAL_FIELDS = PERSISTED_SOURCE_VIEW_FIELDS;

export const buildPersistedSourceViewState = (
  state: SpectrumState,
): Partial<SpectrumState> => {
  const persisted: Partial<SpectrumState> = {};
  for (const key of PERSISTED_SOURCE_VIEW_FIELDS) {
    const value = state[key];
    if (typeof value !== "undefined") {
      persisted[key] = value as never;
    }
  }
  return persisted;
};

export const normalizePersistedSourceViewState = (
  persisted: Partial<SpectrumState> | null | undefined,
): Partial<SpectrumState> => {
  if (!persisted || typeof persisted !== "object") {
    return {};
  }

  const next: Partial<SpectrumState> = {};
  for (const key of PERSISTED_SOURCE_VIEW_FIELDS) {
    const value = persisted[key];
    if (typeof value !== "undefined") {
      next[key] = value as never;
    }
  }
  return next;
};

export const resolveInitialSourceHydrationSettings = (
  restored: Partial<SpectrumState> | null | undefined,
): Partial<SpectrumState> => {
  const normalized = normalizePersistedSourceViewState(restored);
  const localSettings: Partial<SpectrumState> = {};

  for (const key of INITIAL_SOURCE_HYDRATION_LOCAL_FIELDS) {
    const value = normalized[key];
    if (typeof value !== "undefined") {
      localSettings[key] = value as never;
    }
  }

  return localSettings;
};

export const resolveSourceSwitchDisplaySettings = (
  restored: Partial<SpectrumState> | null | undefined,
  current: Partial<SpectrumState>,
): Partial<SpectrumState> => ({
  ...current,
  ...normalizePersistedSourceViewState(restored),
});

export type SpectrumAction =
  | { type: "SET_SIGNAL_AREA"; area: string }
  | { type: "SET_FREQUENCY_RANGE"; range: FrequencyRange }
  | {
      type: "SET_SIGNAL_AREA_AND_RANGE";
      area: string;
      range: FrequencyRange;
    }
  | {
      type: "MERGE_LAST_KNOWN_RANGES";
      ranges: Record<string, FrequencyRange>;
    }
  | {
      type: "SET_TEMPORAL_RESOLUTION";
      resolution: TemporalResolution;
    }
  | { type: "SET_POWER_SCALE"; powerScale: "dB" | "dBm" }
  | { type: "SET_SELECTED_FILES"; files: SelectedFile[] }
  | { type: "SET_SNAPSHOT_GRID"; preference: boolean }
  | { type: "SET_DRAW_PARAMS"; params: DrawParams[] }
  | { type: "SET_CLUMP_PARAMS"; index: number; params: DrawParams }
  | { type: "SET_ACTIVE_CLUMP_INDEX"; index: number }
  | { type: "SET_GLOBAL_NOISE_FLOOR"; noise: number }
  | { type: "SET_SOURCE_MODE"; mode: SourceMode }
  | { type: "SET_STITCH_STATUS"; status: string }
  | { type: "SET_VISUALIZER_PAUSED"; paused: boolean }
  | { type: "TRAINING_START"; label: "target" | "noise" }
  | { type: "TRAINING_STOP" }
  | { type: "TRIGGER_STITCH" }
  | { type: "TOGGLE_STITCH_PAUSE" }
  | {
      type: "SET_STITCH_SOURCE_SETTINGS";
      settings: { gain: number; ppm: number };
    }
  | { type: "SET_STITCH_PAUSED"; paused: boolean }
  | { type: "LEAVE_VISUALIZER" }
  | { type: "SET_FFT_FRAME_RATE"; fftFrameRate: number }
  | { type: "SET_DETECTED_FRAME_RATE"; detectedFrameRate: number | null }
  | { type: "CLEAR_WATERFALL" }
  | { type: "RESET_WATERFALL_CLEARED" }
  | { type: "SET_VIZ_ZOOM"; zoom: number }
  | { type: "SET_VIZ_ZOOM_FLOOR"; zoomFloor: number }
  | { type: "SET_VIZ_ZOOM_FLOOR_PAN"; pan: number }
  | { type: "SET_AUTO_ZOOM_STABILITY"; enabled: boolean }
  | { type: "SET_VIZ_PAN"; pan: number }
  | { type: "SET_FFT_DB_LIMITS"; min: number; max: number }
  | { type: "SET_SHOW_SPIKE_OVERLAY"; enabled: boolean }
  | { type: "SET_REMOVE_DC_SPIKE"; enabled: boolean }
  | {
      type: "SET_SAMPLE_RATE";
      sampleRateHz: number;
      frequencyRange?: FrequencyRange;
    }
  | { type: "SET_MIN_RECEIVE_SAMPLE_RATE"; minReceiveSampleRateHz: number }
  | { type: "SET_SDR_SETTINGS_BUNDLE"; settings: Partial<SpectrumState> }
  | { type: "RESET_ZOOM_AND_DB" }
  | { type: "RESET_DRAW_PARAMS" }
  | { type: "RESET_LIVE_CONTROLS"; fftSize?: number; fftFrameRate?: number }
  | { type: "SET_DIAGNOSTIC_STATUS"; status: string }
  | { type: "SET_DIAGNOSTIC_RUNNING"; running: boolean }
  | { type: "TRIGGER_DIAGNOSTIC" }
  | { type: "SET_DRAW_SIGNAL_3D"; enabled: boolean }
  | { type: "SET_DISPLAY_MODE"; displayMode: "fft" | "iq" }
  | { type: "SET_FFT_WINDOW"; fftWindow: string }
  | {
      type: "SET_STITCH_OPTION";
      option: keyof SpectrumState["stitchOptions"];
      enabled: boolean;
    }
  | {
      type: "SET_STITCH_OPTION_VALUE";
      option: keyof SpectrumState["stitchOptions"];
      value: any;
    };

export const INITIAL_SPECTRUM_STATE: SpectrumState = {
  activeSignalArea: "A",
  frequencyRange: null,
  tuningPreviewActive: false,
  displayTemporalResolution: "reduced",
  powerScale: "dB",
  selectedFiles: [],
  snapshotGridPreference: true,
  drawParams: [
    {
      spikeCount: 40,
      spikeWidth: 0.25,
      centerSpikeBoost: 4.9,
      spikesAmplitude: -10, // dB
      decayRate: 0.2,
      envelopeWidth: 10,
      centerOffset: 1_500_000,
      peakAmplitude: -40, // -40 dB
      simulatedNoise: 0.05,
      beats: [],
      baseSignalType: "none",
      baseSignalAmplitude: -55,
    },
  ],
  activeClumpIndex: 0,
  globalNoiseFloor: -100, // Default changed to -100dB
  sourceMode: "live",
  stitchStatus: "",
  visualizerPaused: false,
  isTrainingCapturing: false,
  trainingCaptureLabel: null,
  trainingCapturedSamples: 0,
  stitchTrigger: 0,
  stitchSourceSettings: { gain: 10, ppm: 0 },
  isStitchPaused: false,
  fftFrameRate: 60,
  detectedFrameRate: null,
  isWaterfallCleared: false,
  vizZoom: 1,
  vizZoomFloor: 1,
  vizZoomFloorPan: 0,
  autoZoomStability: true,
  vizPanOffset: 0,
  fftMinDb: -120,
  fftMaxDb: 0,
  fftSize: 32768,
  fftWindow: "Rectangular",
  showSpikeOverlay: false,
  removeDcSpike: false,
  gain: 10,
  txSignal: "wifi",
  hackrfLnaGain: 0.0,
  hackrfVgaGain: 0.0,
  hackrfAmpEnabled: true,
  hackrfBasebandBandwidth: null,
  ppm: 0,
  tunerAGC: false,
  rtlAGC: false,
  sampleRateHz: 3_200_000,
  minReceiveSampleRateHz: 3_200_000,
  lastKnownRanges: {},
  diagnosticStatus: "Ready",
  isDiagnosticRunning: false,
  diagnosticTrigger: 0,
  drawSignal3D: false,
  displayMode: "fft",
  fftAvgEnabled: false,
  fftSmoothEnabled: false,
  wfSmoothEnabled: false,
  stitchOptions: {
    phaseCorrection: true,
    fmDeviationCorrection: true,
    antiAliasing: true,
    noiseFloorMatching: true,
    crossfading: true,
    chineseRemainderSynthesis: false,
    jsAntiAliasing: false,
    jsNoiseFloorMatching: false,
    acquisitionMode: "interleaved",
  },
};

export { applyWaterfallStateOverrides } from "@n-apt/spectrum/hooks/spectrumStoreOverrides";

const SDR_SETTINGS_KEY = "napt-sdr-settings-v2";

export const selectLiveSampleRateForSync = ({
  isConnected,
  websocketSampleRateHz,
  sdrSettingsSampleRateHz,
  minReceiveSampleRateHz,
  maxSampleRateHz,
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
}: {
  isConnected: boolean;
  websocketSampleRateHz?: number | null;
  sdrSettingsSampleRateHz?: number | null;
  minReceiveSampleRateHz?: number | null;
  maxSampleRateHz?: number | null;
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isRtlSdr?: boolean | null;
}): number | null => {
  const isRtlDevice = isRtlSdrDevice({
    deviceKind,
    backend,
    deviceName,
    isRtlSdr,
  });
  const candidates = isRtlDevice
    ? [minReceiveSampleRateHz, sdrSettingsSampleRateHz, maxSampleRateHz]
    : isConnected
      ? [websocketSampleRateHz, sdrSettingsSampleRateHz, maxSampleRateHz]
      : [sdrSettingsSampleRateHz, maxSampleRateHz];

  return resolveSourceSampleRateHz({ candidates, maxSampleRateHz });
};

export const shouldHydrateLiveSampleRate = ({
  rate,
  localSampleRateHz,
  pendingLocalSampleRateHz,
  hydratedBackendSampleRate,
}: {
  rate?: number | null;
  localSampleRateHz?: number | null;
  pendingLocalSampleRateHz?: number | null;
  hydratedBackendSampleRate: boolean;
}): boolean => {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return false;
  }

  if (
    typeof pendingLocalSampleRateHz === "number" &&
    Number.isFinite(pendingLocalSampleRateHz) &&
    pendingLocalSampleRateHz > 0 &&
    Math.round(rate) !== Math.round(pendingLocalSampleRateHz)
  ) {
    // The local selector is already showing an intentional request. A stale
    // source snapshot must not turn that request back into a device update.
    return false;
  }

  const hasValidLocalRate =
    typeof localSampleRateHz === "number" &&
    Number.isFinite(localSampleRateHz) &&
    localSampleRateHz > 0;
  return !hasValidLocalRate || !hydratedBackendSampleRate;
};

type SignalDisplaySettings = {
  sampleRateHz: number | null;
  fftSize: number | null;
  frameRate: number | null;
};

export const shouldSendSignalDisplaySettings = ({
  previous,
  next,
}: {
  previous: SignalDisplaySettings | null;
  next: SignalDisplaySettings;
}): boolean =>
  previous === null ||
  previous.sampleRateHz !== next.sampleRateHz ||
  previous.fftSize !== next.fftSize ||
  previous.frameRate !== next.frameRate;

const areSdrSettingValuesEqual = (
  current: unknown,
  next: unknown,
): boolean => {
  if (Object.is(current, next)) return true;
  if (Array.isArray(current) || Array.isArray(next)) {
    return (
      Array.isArray(current) &&
      Array.isArray(next) &&
      current.length === next.length &&
      current.every((value, index) =>
        areSdrSettingValuesEqual(value, next[index]),
      )
    );
  }
  if (
    !current ||
    !next ||
    typeof current !== "object" ||
    typeof next !== "object"
  ) {
    return false;
  }

  const currentRecord = current as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const currentKeys = Object.keys(currentRecord);
  const nextKeys = Object.keys(nextRecord);
  return (
    currentKeys.length === nextKeys.length &&
    currentKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(nextRecord, key) &&
        areSdrSettingValuesEqual(currentRecord[key], nextRecord[key]),
    )
  );
};

export const shouldSyncSdrSettingsCache = (
  current: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): boolean => {
  return !areSdrSettingValuesEqual(current, next);
};

/**
 * Keep cache hydration referentially stable when source_info rebuilds an
 * equivalent settings object.
 */
export const resolveCachedSdrSettings = (
  current: SourceSdrSettings | null,
  next: SourceSdrSettings,
): SourceSdrSettings =>
  shouldSyncSdrSettingsCache(current, next) ? next : (current ?? next);

export const resolveEffectiveSdrSettingsForConnection = ({
  isConnected,
  liveSettings,
  cachedSettings,
}: {
  isConnected: boolean;
  liveSettings: SourceSdrSettings | null | undefined;
  cachedSettings: SourceSdrSettings | null | undefined;
}): SourceSdrSettings | null =>
  isConnected ? (liveSettings ?? cachedSettings ?? null) : null;


export const resolveEffectiveLiveSampleRateHz = ({
  localSampleRateHz,
  websocketSampleRateHz,
  sdrSettingsSampleRateHz,
  minReceiveSampleRateHz,
  maxSampleRateHz,
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
}: {
  localSampleRateHz?: number | null;
  websocketSampleRateHz?: number | null;
  sdrSettingsSampleRateHz?: number | null;
  minReceiveSampleRateHz?: number | null;
  maxSampleRateHz?: number | null;
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isRtlSdr?: boolean | null;
}): number | null => {
  const isRtlDevice = isRtlSdrDevice({
    deviceKind,
    backend,
    deviceName,
    isRtlSdr,
  });
  // The accepted source rate owns the live display. A local selector value is
  // only a request until source_info acknowledges it; allowing local intent to
  // win indefinitely leaves the sidebar in Whole Channel while frames still
  // arrive at 3.2 MHz and re-arms the channel/rate feedback loop.
  const candidates = isRtlDevice
    ? [
        minReceiveSampleRateHz,
        sdrSettingsSampleRateHz,
        localSampleRateHz,
        maxSampleRateHz,
        websocketSampleRateHz,
      ]
    : [
        websocketSampleRateHz,
        sdrSettingsSampleRateHz,
        localSampleRateHz,
        maxSampleRateHz,
      ];

  return resolveSourceSampleRateHz({ candidates, maxSampleRateHz });
};

function _spectrumReducer(
  state: SpectrumState,
  action: SpectrumAction,
): SpectrumState {
  switch (action.type) {
    case "SET_SIGNAL_AREA":
      return { ...state, activeSignalArea: action.area };
    case "SET_FREQUENCY_RANGE":
      if (
        state.frequencyRange &&
        state.frequencyRange.min === action.range.min &&
        state.frequencyRange.max === action.range.max
      ) {
        return state;
      }
      const safeRanges =
        state.lastKnownRanges && typeof state.lastKnownRanges === "object"
          ? state.lastKnownRanges
          : {};
      return {
        ...state,
        frequencyRange: action.range,
        lastKnownRanges: state.activeSignalArea
          ? { ...safeRanges, [state.activeSignalArea]: action.range }
          : safeRanges,
      };
    case "SET_SIGNAL_AREA_AND_RANGE":
      const safeRanges2 =
        state.lastKnownRanges && typeof state.lastKnownRanges === "object"
          ? state.lastKnownRanges
          : {};
      return {
        ...state,
        activeSignalArea: action.area,
        frequencyRange: action.range,
        lastKnownRanges: { ...safeRanges2, [action.area]: action.range },
      };
    case "MERGE_LAST_KNOWN_RANGES":
      return {
        ...state,
        lastKnownRanges: {
          ...(state.lastKnownRanges && typeof state.lastKnownRanges === "object"
            ? state.lastKnownRanges
            : {}),
          ...action.ranges,
        },
      };
    case "SET_TEMPORAL_RESOLUTION":
      return {
        ...state,
        displayTemporalResolution: action.resolution,
      };
    case "SET_POWER_SCALE": {
      const isSwitchingToDbm = action.powerScale === "dBm";
      const currentMin = state.fftMinDb;
      const currentMax = state.fftMaxDb;

      let nextMin = currentMin;
      let nextMax = currentMax;

      if (isSwitchingToDbm) {
        nextMin = -100;
        nextMax = 30;
      } else {
        nextMin = -120;
        nextMax = 0;
      }

      return {
        ...state,
        powerScale: action.powerScale,
        fftMinDb: nextMin,
        fftMaxDb: nextMax,
      };
    }
    case "SET_SELECTED_FILES":
      return { ...state, selectedFiles: action.files };
    case "SET_SNAPSHOT_GRID":
      return { ...state, snapshotGridPreference: action.preference };
    case "SET_DRAW_PARAMS":
      return { ...state, drawParams: action.params };
    case "SET_CLUMP_PARAMS": {
      const newParams = [...state.drawParams];
      newParams[action.index] = action.params;
      return { ...state, drawParams: newParams };
    }
    case "SET_ACTIVE_CLUMP_INDEX":
      return { ...state, activeClumpIndex: action.index };
    case "SET_GLOBAL_NOISE_FLOOR":
      return { ...state, globalNoiseFloor: action.noise };
    case "SET_SOURCE_MODE":
      // When switching away from file mode, reset processing state but keep files
      if (state.sourceMode === "file" && action.mode !== "file") {
        return {
          ...state,
          sourceMode: action.mode,
          stitchStatus: "",
          isStitchPaused: true,
          // Keep selectedFiles so they're still there when returning
        };
      }
      return { ...state, sourceMode: action.mode };
    case "SET_STITCH_STATUS":
      return { ...state, stitchStatus: action.status };
    case "SET_VISUALIZER_PAUSED":
      return { ...state, visualizerPaused: action.paused };
    case "TRAINING_START":
      return {
        ...state,
        isTrainingCapturing: true,
        trainingCaptureLabel: action.label,
      };
    case "TRAINING_STOP":
      return {
        ...state,
        isTrainingCapturing: false,
        trainingCaptureLabel: null,
        trainingCapturedSamples: state.trainingCapturedSamples + 1,
      };
    case "TRIGGER_STITCH":
      return {
        ...state,
        isStitchPaused: true,
        stitchStatus: "",
        stitchTrigger: state.stitchTrigger + 1,
      };
    case "TOGGLE_STITCH_PAUSE":
      return { ...state, isStitchPaused: !state.isStitchPaused };
    case "SET_STITCH_SOURCE_SETTINGS":
      return { ...state, stitchSourceSettings: action.settings };
    case "SET_STITCH_PAUSED":
      return { ...state, isStitchPaused: action.paused };
    case "SET_FFT_FRAME_RATE":
      return { ...state, fftFrameRate: action.fftFrameRate };
    case "SET_DETECTED_FRAME_RATE":
      return { ...state, detectedFrameRate: action.detectedFrameRate };
    case "LEAVE_VISUALIZER":
      return {
        ...state,
        visualizerPaused: true,
        isStitchPaused: true,
      };
    case "CLEAR_WATERFALL":
      return { ...state, isWaterfallCleared: true };
    case "RESET_WATERFALL_CLEARED":
      return { ...state, isWaterfallCleared: false };
    case "SET_VIZ_ZOOM":
      return { ...state, vizZoom: action.zoom };
    case "SET_VIZ_ZOOM_FLOOR":
      return { ...state, vizZoomFloor: action.zoomFloor };
    case "SET_VIZ_ZOOM_FLOOR_PAN":
      return { ...state, vizZoomFloorPan: action.pan };
    case "SET_AUTO_ZOOM_STABILITY":
      return { ...state, autoZoomStability: action.enabled };
    case "SET_VIZ_PAN":
      return { ...state, vizPanOffset: action.pan };
    case "SET_FFT_DB_LIMITS":
      return {
        ...state,
        fftMinDb: Math.round(action.min),
        fftMaxDb: Math.round(action.max),
      };
    case "SET_SHOW_SPIKE_OVERLAY":
      return { ...state, showSpikeOverlay: action.enabled };
    case "SET_REMOVE_DC_SPIKE":
      return { ...state, removeDcSpike: action.enabled };
    case "SET_SAMPLE_RATE":
      return {
        ...state,
        sampleRateHz: action.sampleRateHz,
      };
    case "SET_MIN_RECEIVE_SAMPLE_RATE":
      return {
        ...state,
        minReceiveSampleRateHz: action.minReceiveSampleRateHz,
      };
    case "SET_SDR_SETTINGS_BUNDLE":
      return {
        ...state,
        ...action.settings,
      };
    case "RESET_ZOOM_AND_DB": {
      const isDbm = state.powerScale === "dBm";
      return {
        ...state,
        vizZoom: 1,
        vizZoomFloor: 1,
        vizZoomFloorPan: 0,
        autoZoomStability: true,
        vizPanOffset: 0,
        fftMinDb: isDbm ? -100 : -120,
        fftMaxDb: isDbm ? 30 : 0,
      };
    }
    case "RESET_DRAW_PARAMS":
      return {
        ...state,
        drawParams: JSON.parse(
          JSON.stringify(INITIAL_SPECTRUM_STATE.drawParams),
        ),
        globalNoiseFloor: INITIAL_SPECTRUM_STATE.globalNoiseFloor,
        activeClumpIndex: 0,
      };
    case "RESET_LIVE_CONTROLS": {
      const isDbm = state.powerScale === "dBm";
      return {
        ...state,
        displayTemporalResolution:
          LIVE_CONTROL_DEFAULTS.displayTemporalResolution,
        vizZoom: LIVE_CONTROL_DEFAULTS.vizZoom,
        vizZoomFloor: 1,
        vizZoomFloorPan: 0,
        autoZoomStability: true,
        vizPanOffset: LIVE_CONTROL_DEFAULTS.vizPanOffset,
        fftMinDb: isDbm ? -100 : -120,
        fftMaxDb: isDbm ? 30 : 0,
        fftWindow: LIVE_CONTROL_DEFAULTS.fftWindow,
        gain: LIVE_CONTROL_DEFAULTS.gain,
        hackrfLnaGain: LIVE_CONTROL_DEFAULTS.hackrfLnaGain,
        hackrfVgaGain: LIVE_CONTROL_DEFAULTS.hackrfVgaGain,
        hackrfAmpEnabled: LIVE_CONTROL_DEFAULTS.hackrfAmpEnabled,
        hackrfBasebandBandwidth: LIVE_CONTROL_DEFAULTS.hackrfBasebandBandwidth,
        ppm: LIVE_CONTROL_DEFAULTS.ppm,
        tunerAGC: LIVE_CONTROL_DEFAULTS.tunerAGC,
        rtlAGC: LIVE_CONTROL_DEFAULTS.rtlAGC,
        fftAvgEnabled: false,
        fftSmoothEnabled: false,
        wfSmoothEnabled: false,
        fftSize: action.fftSize ?? state.fftSize,
        fftFrameRate: action.fftFrameRate ?? state.fftFrameRate,
        globalNoiseFloor: isDbm ? -120 : -150,
      };
    }
    case "SET_DIAGNOSTIC_STATUS":
      return { ...state, diagnosticStatus: action.status };
    case "SET_DIAGNOSTIC_RUNNING":
      return { ...state, isDiagnosticRunning: action.running };
    case "TRIGGER_DIAGNOSTIC":
      return { ...state, diagnosticTrigger: state.diagnosticTrigger + 1 };
    case "SET_DRAW_SIGNAL_3D":
      return { ...state, drawSignal3D: action.enabled };
    case "SET_DISPLAY_MODE":
      return { ...state, displayMode: action.displayMode };
    case "SET_FFT_WINDOW":
      return { ...state, fftWindow: action.fftWindow };
    case "SET_STITCH_OPTION":
      return {
        ...state,
        stitchOptions: {
          ...state.stitchOptions,
          [action.option]: action.enabled,
        },
      };
    case "SET_STITCH_OPTION_VALUE":
      return {
        ...state,
        stitchOptions: {
          ...state.stitchOptions,
          [action.option]: action.value,
        },
      };
    default:
      return state;
  }
}

// Complex Return Type
export type SpectrumStoreContextValue = {
  state: SpectrumState;
  dispatch: React.Dispatch<SpectrumAction>;
  fftVisualizerMachine: FFTVisualizerMachine;
  manualVisualizerPaused: boolean;
  setManualVisualizerPaused: React.Dispatch<React.SetStateAction<boolean>>;
  selectedSourceId: string;
  selectionIntentSourceId?: string | null;
  pendingSourceSwitchId?: string | null;
  setSelectedSourceId: React.Dispatch<React.SetStateAction<string>>;
  selectedSource: SourceInfo | null;
  selectedSourceDerived: {
    deviceState: DeviceState | null;
    deviceName: string | null;
    deviceProfile: DeviceProfile | null;
    deviceInfo: string | null;
    backend: string | null;
    maxSampleRateHz: number | null;
    sampleRateOptions: number[];
    sampleRateHz: number | null;
    sdrSettings: Partial<SdrSettingsConfig> | SourceSdrSettings | null;
    supportsBasebandFilter?: boolean;
  };
  effectiveFrames: SpectrumFrame[];
  effectiveSdrSettings:
    | Partial<SdrSettingsConfig>
    | SourceSdrSettings
    | null
    | undefined;
  sampleRateHzEffective: number | null;
  signalAreaBounds: Record<string, { min: number; max: number }> | null;
  wsConnection: {
    isConnected: boolean;
    activeSourceId: string | null;
    deviceState: DeviceState;
    deviceLoadingReason: DeviceLoadingReason;
    isPaused: boolean;
    serverPaused: boolean;
    backend: string | null;
    deviceInfo: string | null;
    deviceName: string | null;
    deviceProfile: DeviceProfile | null;
    maxSampleRateHz: number | null;
    sampleRateOptions: number[];
    sampleRateHz: number | null;
    supportsBasebandFilter?: boolean;
    sdrSettings: Partial<SdrSettingsConfig> | SourceSdrSettings | null;
    sdrLimitMarkers: Array<{
      kind: string;
      freq_hz: number;
      label?: string;
    }>;
    dataRef: React.MutableRefObject<any>;
    spectrumFrames: SpectrumFrame[];
    sources: SourceInfo[];
    captureStatus: CaptureStatus;
    error: string | null;
    cryptoCorrupted: boolean;
    sendFrequencyRange: (range: FrequencyRange) => void;
    sendPauseCommand: (isPaused: boolean, sourceId: string) => void;
    sendSettings: (settings: SDRSettings) => void;
    sendRestartDevice: (sourceId?: string) => void;
    sendCaptureCommand: (req: CaptureRequest) => void;
    sendScanCommand: (
      jobId: string,
      minFreq: number,
      maxFreq: number,
      options?: any,
    ) => void;
    sendDemodulateCommand: (jobId: string, region: any) => void;
    sendTrainingCommand: (
      action: "start" | "stop",
      label: "target" | "noise",
      signalArea: string,
    ) => void;
    sendPowerScaleCommand: (scale: "dB" | "dBm") => void;
    sendTransmitStatus: (
      enabled: boolean,
      device: string,
      txSettings: {
        serialNumber: string;
        centerFrequencyHz?: number | null;
        viewCenterHz?: number | null;
        bandwidthHz?: number | null;
        sampleRateHz?: number | null;
        ifftSize?: number | null;
        powerDbm?: number | null;
        lnaGainDb?: number | null;
        vgaGainDb?: number | null;
        ampEnabled?: boolean | null;
        tunerAgc?: boolean | null;
        rtlAgc?: boolean | null;
        ppm?: number | null;
        txSafetyEnabled?: boolean | null;
        txSafetyLimit?: string | null;
        txSignal?: string | null;
        txHopEnabled?: boolean | null;
        txHopType?: string | null;
        txHopStartFrequencyHz?: number | null;
        txHopEndFrequencyHz?: number | null;
        txHopChannels?: string[] | null;
        txHopRateHz?: number | null;
      },
    ) => void;
  };
  toggleVisualizerPause: (sourceId?: string) => void;
  setVisualizerPause?: (paused: boolean, sourceId?: string) => void;
  cryptoCorrupted: boolean;
  deviceName: string | null;
  deviceProfile: DeviceProfile | null;
  sources: SourceInfo[];
};

export const useSpectrumStore = () => {
  const context = useContext(SpectrumStoreContext) as
    | SpectrumStoreContextValue
    | null;
  if (!context) {
    throw new Error("useSpectrumStore must be used within a SpectrumProvider");
  }
  return context;
};

export const useOptionalSpectrumStore =
  (): SpectrumStoreContextValue | null => {
    return useContext(SpectrumStoreContext) as SpectrumStoreContextValue | null;
  };

interface SpectrumProviderProps {
  children: React.ReactNode;
  mockValue?: SpectrumStoreContextValue;
}

const SpectrumProviderReal: React.FC<{ children: React.ReactNode }> = memo(
  ({ children }) => {
    const fftVisualizerMachineRef = useRef<FFTVisualizerMachine | null>(null);
    if (!fftVisualizerMachineRef.current) {
      fftVisualizerMachineRef.current = createFFTVisualizerMachine();
    }
    const fftVisualizerMachine = fftVisualizerMachineRef.current;
    const location = useLocation();
    const reduxDispatch = useAppDispatch();
    const waterfallState = useAppSelector((s) => s.waterfall);
    const reduxSpectrumState = useAppSelector((s) => s.spectrum);
    const state = useMemo(
      () =>
        ({
          ...INITIAL_SPECTRUM_STATE,
          ...reduxSpectrumState,
          ...waterfallState,
        }) as SpectrumState,
      [reduxSpectrumState, waterfallState],
    );
    const isVisualizerRoute = isLiveVisualizerPathname(location.pathname);

    const isConnected = useAppSelector((s) => s.websocket.isConnected);
    const hardwareSpectrumBounds = useAppSelector(
      (s) => s.demod.hardwareRange,
    );
    const isPaused = useAppSelector((s) => s.websocket.isPaused);
    const serverPaused = useAppSelector((s) => s.websocket.serverPaused);
    const cryptoCorrupted = useAppSelector((s) => s.websocket.cryptoCorrupted);
    const activeSource = useAppSelector(selectActiveSource);
    const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);
    const websocketSources = useAppSelector((s) => s.websocket.sources);
    const websocketChannels = useAppSelector((s) => s.websocket.channels);
    const sourceStatuses = useAppSelector((s) => s.websocket.sourceStatuses);
    const txSuiteSourceId = useAppSelector(
      (s) =>
        s.sourceRouting?.bindings[sourceBindingKey("tx-suite", "tx")] ?? null,
    );
    const txSuiteRxSourceId = useAppSelector(
      (s) =>
        s.sourceRouting?.bindings[sourceBindingKey("tx-suite", "rx")] ?? null,
    );
    const isTxSuiteFlow = useAppSelector(
      (s) => s.sourceRouting?.selectionModes?.["tx-suite"] === "multi",
    );
    const txSuiteSource = useAppSelector((s) =>
      txSuiteSourceId
        ? ((s.websocket.sources ?? []).find(
            (source) => source.id === txSuiteSourceId,
          ) ?? null)
        : null,
    );
    const deviceState = activeSourceDerived.deviceState;
    const backend = activeSourceDerived.backend;
    const deviceName = activeSourceDerived.deviceName;
    const deviceProfile = activeSourceDerived.deviceProfile;
    const maxSampleRateHz = activeSourceDerived.maxSampleRateHz;
    const sampleRateHz = activeSourceDerived.sampleRateHz;
    const sdrSettings = activeSourceDerived.sdrSettings;
    const activeSourceId = activeSource?.id ?? "";
    const { selectedSourceId, selectionIntentSourceId, pendingSourceSwitchId } =
      useAppSelector(selectSourceSelectionLifecycle);
    const setSelectedSourceId = useCallback<
      React.Dispatch<React.SetStateAction<string>>
    >(
      (nextSourceId) => {
        if (typeof nextSourceId === "function") {
          const resolvedSourceId = nextSourceId(selectedSourceId);
          // Source selection is tab-local intent. Persist it at the click
          // boundary; waiting for source-view hydration loses Mock Tx when a
          // refresh lands before the asynchronous view effect runs.
          saveSelectedSourceId(resolvedSourceId);
          reduxDispatch(selectReduxSource(resolvedSourceId));
          return;
        }
        // See above: this must precede the Redux/effect cycle so reloads
        // restore the source the user actually chose, not the first source
        // present when the inventory hydrates.
        saveSelectedSourceId(nextSourceId);
        reduxDispatch(selectReduxSource(nextSourceId));
      },
      [reduxDispatch, selectedSourceId],
    );

    // Inventory hydration can optimistically seed the backend's first source
    // before this hook's effects run. Consume the tab-local selection once,
    // after the inventory exists, so that optimistic seed cannot win a cold
    // reload over the source the user last selected.
    const hasRestoredStoredSelectionRef = useRef(false);
    const pendingStoredSelectionHydrationRef = useRef<string | null>(null);

    useEffect(() => {
      const stored = loadSelectedSourceId();
      if (!hasRestoredStoredSelectionRef.current && websocketSources.length) {
        hasRestoredStoredSelectionRef.current = true;
        if (stored && websocketSources.some((source) => source.id === stored)) {
          if (selectedSourceId !== stored) {
            // This effect and the source-view persistence effect run in the
            // same commit. Defer that write once so the optimistic first
            // source cannot overwrite the stored selection first.
            pendingStoredSelectionHydrationRef.current = stored;
            reduxDispatch(restoreReduxSelectedSource(stored));
          }
          return;
        }
      }
      if (selectedSourceId) return;
      const initialSelection = resolveInitialSourceSelection({
        activeSourceId,
        storedSourceId: stored,
        sources: websocketSources,
      });
      if (initialSelection.selectedSourceId) {
        if (initialSelection.selectionIntentSourceId) {
          reduxDispatch(
            restoreReduxSelectedSource(initialSelection.selectedSourceId),
          );
        } else {
          reduxDispatch(setReduxSelectedSourceId(initialSelection.selectedSourceId));
        }
      }
    }, [
      activeSourceId,
      reduxDispatch,
      selectedSourceId,
      selectionIntentSourceId,
      websocketSources,
    ]);

    useEffect(() => {
      const hasBoundRxTransport =
        typeof txSuiteRxSourceId === "string" &&
        websocketSources.some((source) => source.id === txSuiteRxSourceId);
      if (
        state.sourceMode !== "live" ||
        !hasBoundRxTransport ||
        !shouldPinTxSuiteToRxSource({
          isTxSuite: isTxSuiteFlow,
          isTxSuiteRouteActive: !isVisualizerRoute,
          rxSourceId: txSuiteRxSourceId,
          selectedSourceId,
        })
      ) {
        return;
      }

      const controlSourceId = resolveTxSuiteControlSourceId({
        isTxSuite: isTxSuiteFlow,
        isTxSuiteRouteActive: !isVisualizerRoute,
        rxSourceId: txSuiteRxSourceId,
        selectedSourceId,
        activeSourceId,
      });
      if (controlSourceId && controlSourceId !== selectedSourceId) {
        setSelectedSourceId(controlSourceId);
      }
    }, [
      activeSourceId,
      isVisualizerRoute,
      isTxSuiteFlow,
      selectedSourceId,
      setSelectedSourceId,
      state.sourceMode,
      txSuiteRxSourceId,
      websocketSources,
    ]);
    const [localSourcePauseOverrides, setLocalSourcePauseOverrides] = useState<
      Record<string, boolean>
    >({});
    const currentSourceStateRef = useRef(state);
    const lastRequestedSubscriberViewSourceIdRef = useRef<string | null>(null);
    const selectedSourceViewKeyRef = useRef<string | null>(null);
    const previousSelectedSourceIdForViewRef = useRef<string | null>(
      selectedSourceId || null,
    );
    const previousInventorySourceIdsRef = useRef<Set<string>>(new Set());
    const skipNextSourceViewPersistRef = useRef<string | null>(null);
    const pendingLocalSampleRateRef = useRef<number | null>(null);

    // Capture the leaving source before SpectrumRoute effects jump Mock Tx
    // geometry onto the shared frequencyRange (would otherwise poison APT).
    const leavingSourceViewSnapshot = resolveLeavingSourceViewSnapshot({
      previousSelectedSourceId: previousSelectedSourceIdForViewRef.current,
      nextSelectedSourceId: selectedSourceId,
      previousSourceViewKey: selectedSourceViewKeyRef.current,
      state,
    });
    if (leavingSourceViewSnapshot) {
      saveStoredJson(
        leavingSourceViewSnapshot.key,
        leavingSourceViewSnapshot.view,
      );
    }
    if (previousSelectedSourceIdForViewRef.current !== (selectedSourceId || null)) {
      previousSelectedSourceIdForViewRef.current = selectedSourceId || null;
    }
    const deferredFrequencyRangeSyncSourceIdRef = useRef<string | null>(null);
    const manualPausedSourceIdsRef = useRef<Set<string>>(new Set());
    const pauseReplaySentForSourceIdRef = useRef<string | null>(null);
    const autoPausedSourceIdsRef = useRef<Set<string>>(new Set());
    const previousSelectedSourceIdRef = useRef<string | null>(null);
    const previousIsVisualizerRouteRef = useRef(
      isLiveVisualizerPathname(location.pathname),
    );
    useEffect(() => {
      currentSourceStateRef.current = state;
    }, [state]);
    const effectiveWebsocketSources = useMemo(
      () =>
        websocketSources.map((source) => {
          const paused = resolveEffectiveSourcePaused({
            backendPaused: source.paused,
            localPaused: localSourcePauseOverrides[source.id],
            manuallyPaused: manualPausedSourceIdsRef.current.has(source.id),
            autoPaused: autoPausedSourceIdsRef.current.has(source.id),
          });
          return source.paused === paused ? source : { ...source, paused };
        }),
      [localSourcePauseOverrides, websocketSources],
    );
    const selectedSource = useMemo(() => {
      if (
        !Array.isArray(effectiveWebsocketSources) ||
        effectiveWebsocketSources.length === 0
      ) {
        return null;
      }

      return (
        effectiveWebsocketSources.find(
          (source) => source.id === selectedSourceId,
        ) ??
        effectiveWebsocketSources.find(
          (source) => source.id === activeSourceId,
        ) ??
        effectiveWebsocketSources[0] ??
        null
      );
    }, [activeSourceId, effectiveWebsocketSources, selectedSourceId]);
    const selectedSourceViewKey = useMemo(
      () => getSourceViewStorageKeyForSource(selectedSource),
      [selectedSource],
    );
    const streamingSource = useMemo(
      () =>
        resolveStreamingSourceForDisplay({
          selectedSourceId,
          activeSourceId,
          sources: effectiveWebsocketSources,
        }),
      [activeSourceId, effectiveWebsocketSources, selectedSourceId],
    );
    const selectedSourceDerived = useMemo(
      () => deriveSourceDerivedState(streamingSource),
      [streamingSource],
    );
    const wsSpectrumFrames = useAppSelector((s) => s.websocket.spectrumFrames);
    const signalsDefaults = useAppSelector((s) => s.websocket.signalsDefaults);
    const captureStatus = useAppSelector((s) => s.websocket.captureStatus);
    const error = useAppSelector((s) => s.websocket.error);
    // liveDataRef is written directly by the middleware — never goes through Redux.
    const selectedSourceStatus = selectedSource
      ? (sourceStatuses?.[selectedSource.id] ?? selectedSource.status)
      : null;
    const selectedSourceMode = resolveSourceModeManagement({
      source: selectedSource
        ? { ...selectedSource, status: selectedSourceStatus }
        : null,
      txBindingSourceId: txSuiteSourceId,
    });
    const dataRef = getLiveFrameRefForSource(
      selectedSourceId || activeSourceId,
      selectedSourceMode.isTxMode ? "tx" : "rx",
    );
    const presentationSourceId =
      presentationController.getActivePresentation().sourceId || null;


    useEffect(() => {
      // The hydration effect may have found the user's stored source while
      // this render still contains the optimistic first source. Do not let
      // inventory reconciliation dispatch that fallback before the restore
      // action is committed.
      if (pendingStoredSelectionHydrationRef.current) {
        return;
      }
      const previousInventorySourceIds = previousInventorySourceIdsRef.current;
      const newlyAvailableHardware = websocketSources.find(
        (source) =>
          !previousInventorySourceIds.has(source.id) &&
          !isMockSourceInfo(source) &&
          ["initializing", "loading", "connected", "receiving", "streaming"].includes(
            source.status ?? "",
          ),
      );
      previousInventorySourceIdsRef.current = new Set(
        websocketSources.map((source) => source.id),
      );
      if (
        newlyAvailableHardware &&
        newlyAvailableHardware.id !== activeSourceId &&
        newlyAvailableHardware.id !== selectedSourceId
      ) {
        reduxDispatch(setReduxSelectionIntentSourceId(newlyAvailableHardware.id));
        reduxDispatch(setReduxSelectedSourceId(newlyAvailableHardware.id));
        return;
      }
      const nextSourceId = resolveSelectedSourceIdForInventory({
        selectedSourceId,
        activeSourceId,
        pendingSourceSwitchId,
        selectionIntentSourceId,
        sources: websocketSources,
      });
      const nextSelectionIntent = resolveInventorySelectionIntent({
        selectedSourceId,
        activeSourceId,
        pendingSourceSwitchId,
        selectionIntentSourceId,
        sources: websocketSources,
      });
      if (
        selectionIntentSourceId &&
        nextSelectionIntent === null &&
        nextSourceId === activeSourceId
      ) {
        reduxDispatch(setReduxSelectionIntentSourceId(null));
      }
      if (
        nextSelectionIntent === nextSourceId &&
        selectionIntentSourceId !== nextSelectionIntent
      ) {
        reduxDispatch(setReduxSelectionIntentSourceId(nextSelectionIntent));
      }
      if (nextSourceId !== selectedSourceId) {
        reduxDispatch(setReduxSelectedSourceId(nextSourceId));
      }
    }, [
      activeSourceId,
      pendingSourceSwitchId,
      reduxDispatch,
      selectedSourceId,
      selectionIntentSourceId,
      websocketSources,
    ]);

    useEffect(() => {
      if (!selectedSourceId || !selectedSourceViewKey) {
        return;
      }

      // Source-specific controls must change with the active I/Q stream, not
      // with a click that the backend has not accepted yet. Otherwise a RTL
      // sample rate/options can be painted over HackRF frames during a warm
      // switch.
      if (state.sourceMode !== "live") return;

      const previousSourceViewKey = selectedSourceViewKeyRef.current;
      // Previous source was already snapshotted at selection time (before Tx
      // monitor jumps). Only restore the committed source here.
      if (previousSourceViewKey !== selectedSourceViewKey) {
        const persistedSourceView = loadStoredJson<Partial<SpectrumState>>(
          selectedSourceViewKey,
        );
        const restoredState =
          previousSourceViewKey === null
            ? resolveInitialSourceHydrationSettings(persistedSourceView)
            : resolveSourceSwitchDisplaySettings(persistedSourceView, {});
        skipNextSourceViewPersistRef.current = selectedSourceViewKey;
        if (Object.keys(restoredState).length > 0) {
          if (restoredState.frequencyRange) {
            // The range sync effect runs later in this commit. Defer it once so
            // it cannot send the previous source's range before this restored
            // source view has reached React state.
            deferredFrequencyRangeSyncSourceIdRef.current = selectedSourceId;
          }
          reduxDispatch(setSdrSettingsBundleAction(restoredState));
        }
        selectedSourceViewKeyRef.current = selectedSourceViewKey;
      }

      if (
        shouldSkipSelectedSourcePersistence({
          pendingHydrationSourceId: pendingStoredSelectionHydrationRef.current,
          currentSelectedSourceId: selectedSourceId,
        })
      ) {
        pendingStoredSelectionHydrationRef.current = null;
        return;
      }
      pendingStoredSelectionHydrationRef.current = null;
      saveSelectedSourceId(selectedSourceId);
    }, [
      activeSourceId,
      reduxDispatch,
      selectedSourceId,
      selectedSourceViewKey,
      state.sourceMode,
    ]);

    useEffect(() => {
      const availableSourceIds = Array.isArray(websocketSources)
        ? websocketSources.map((source) => source.id)
        : [];
      if (
        state.sourceMode !== "live" ||
        !isConnected ||
        !selectedSourceId ||
        !availableSourceIds.includes(selectedSourceId) ||
        ["disconnected", "stale", "error"].includes(selectedSourceStatus ?? "")
      ) {
        return;
      }

      if (
        !shouldRequestSubscriberViewSource({
          selectedSourceId,
          activeSourceId,
          presentationSourceId,
          lastRequestedSourceId:
            lastRequestedSubscriberViewSourceIdRef.current,
        })
      ) {
        return;
      }

      lastRequestedSubscriberViewSourceIdRef.current = selectedSourceId;
      liveDataRef.current = [];
      // The selected source owns a persistent frame slot for fast rendering.
      // Invalidate that slot at the handoff boundary so a previous-session
      // frame cannot appear before this switch commits.
      sourceVisualizationRuntime.reset(selectedSourceId);
      sourceSpectrumRuntime.reset(selectedSourceId);
      liveDataBySourceRef.current[selectedSourceId] =
        sourceVisualizationRuntime.getSourceRef(selectedSourceId);
      reduxDispatch(sendViewSourceThunk(selectedSourceId));
    }, [
      activeSourceId,
      isConnected,
      presentationSourceId,
      reduxDispatch,
      selectedSource,
      selectedSourceId,
      selectedSourceStatus,
      state.sourceMode,
      websocketSources,
    ]);

    useEffect(() => {
      if (!selectedSourceId || !selectedSourceViewKey) {
        return;
      }

      // Do not write the still-active source's geometry into the pending
      // selection's slot (Mock Tx center leaking into Mock APT on switch).
      if (
        !shouldPersistSelectedSourceView({
          selectedSourceId,
          activeSourceId,
          sourceMode: state.sourceMode,
        })
      ) {
        return;
      }

      if (skipNextSourceViewPersistRef.current === selectedSourceViewKey) {
        skipNextSourceViewPersistRef.current = null;
        return;
      }

      saveStoredJson(
        selectedSourceViewKey,
        buildPersistedSourceViewState(state),
      );
    }, [
      activeSourceId,
      selectedSourceId,
      selectedSourceViewKey,
      state,
      state.sourceMode,
    ]);

    const mergedState = useMemo(
      () => ({
        ...applyWaterfallStateOverrides(state, waterfallState),
        ...reduxSpectrumState,
        fftSize: reduxSpectrumState.fftSize,
        fftWindow: reduxSpectrumState.fftWindow,
        fftFrameRate: reduxSpectrumState.fftFrameRate,
        gain: reduxSpectrumState.gain,
        ppm: reduxSpectrumState.ppm,
        tunerAGC: reduxSpectrumState.tunerAGC,
        rtlAGC: reduxSpectrumState.rtlAGC,
        sampleRateHz: reduxSpectrumState.sampleRateHz,
        minReceiveSampleRateHz: reduxSpectrumState.minReceiveSampleRateHz,
        detectedFrameRate: reduxSpectrumState.detectedFrameRate,
      }),
      [state, waterfallState, reduxSpectrumState],
    );

    const storeDispatch = useCallback(
      (action: SpectrumAction) => {
        switch (action.type) {
          case "SET_SOURCE_MODE":
            reduxDispatch(setWaterfallSourceMode(action.mode));
            return;
          case "SET_SIGNAL_AREA":
            reduxDispatch(setActiveSignalArea(action.area));
            return;
          case "SET_FREQUENCY_RANGE":
            reduxDispatch(setFrequencyRangeAction(action.range));
            return;
          case "SET_SIGNAL_AREA_AND_RANGE":
            reduxDispatch(
              setSignalAreaAndRange({ area: action.area, range: action.range }),
            );
            return;
          case "SET_TEMPORAL_RESOLUTION":
            reduxDispatch(setTemporalResolution(action.resolution));
            return;
          case "SET_POWER_SCALE":
            reduxDispatch(setPowerScaleAction(action.powerScale));
            return;
          case "SET_FFT_FRAME_RATE":
            reduxDispatch(setFftFrameRate(action.fftFrameRate));
            return;
          case "SET_SAMPLE_RATE":
            pendingLocalSampleRateRef.current = action.sampleRateHz;
            reduxDispatch({
              ...setSampleRateAction(action.sampleRateHz),
              ...(action.frequencyRange
                ? { meta: { managedRxFrequencyRange: action.frequencyRange } }
                : {}),
            });
            return;
          case "SET_MIN_RECEIVE_SAMPLE_RATE":
            reduxDispatch(
              setMinReceiveSampleRateAction(action.minReceiveSampleRateHz),
            );
            return;
          case "SET_VISUALIZER_PAUSED":
            reduxDispatch(setVisualizerPausedAction(action.paused));
            return;
          case "SET_VIZ_ZOOM":
            reduxDispatch(setVizZoom(action.zoom));
            return;
          case "SET_FFT_WINDOW":
            reduxDispatch(setFftWindow(action.fftWindow));
            return;
          case "SET_DISPLAY_MODE":
            reduxDispatch(setDisplayMode(action.displayMode));
            return;
          case "SET_DIAGNOSTIC_STATUS":
            reduxDispatch(setDiagnosticStatus(action.status));
            return;
          case "SET_DIAGNOSTIC_RUNNING":
            reduxDispatch(setDiagnosticRunning(action.running));
            return;
          case "SET_STITCH_OPTION":
            reduxDispatch(
              setStitchOption({
                option: action.option,
                enabled: action.enabled,
              } as never),
            );
            return;
          case "SET_STITCH_OPTION_VALUE":
            reduxDispatch(
              setStitchOptionValue({
                option: action.option,
                value: action.value,
              } as never),
            );
            return;
          case "SET_SELECTED_FILES":
            reduxDispatch(setWaterfallSelectedFiles(action.files));
            return;
          case "SET_SNAPSHOT_GRID":
            reduxDispatch(setWaterfallSnapshotGrid(action.preference));
            return;
          case "SET_GLOBAL_NOISE_FLOOR":
            reduxDispatch(setWaterfallGlobalNoiseFloor(action.noise));
            return;
          case "SET_STITCH_STATUS":
            reduxDispatch(setWaterfallStitchStatus(action.status));
            return;
          case "TRIGGER_STITCH":
            reduxDispatch(triggerWaterfallStitch());
            return;
          case "TOGGLE_STITCH_PAUSE":
            reduxDispatch(toggleWaterfallStitchPause());
            return;
          case "SET_STITCH_SOURCE_SETTINGS":
            reduxDispatch(setWaterfallStitchSourceSettings(action.settings));
            return;
          case "SET_STITCH_PAUSED":
            reduxDispatch(setWaterfallStitchPaused(action.paused));
            return;
          case "CLEAR_WATERFALL":
            reduxDispatch(clearWaterfall());
            return;
          case "RESET_WATERFALL_CLEARED":
            reduxDispatch(resetWaterfallCleared());
            return;
          case "SET_DRAW_SIGNAL_3D":
            reduxDispatch(setWaterfallDrawSignal3D(action.enabled));
            return;
          case "SET_SDR_SETTINGS_BUNDLE":
            reduxDispatch(setSdrSettingsBundleAction(action.settings as any));
            return;
          case "RESET_LIVE_CONTROLS":
            reduxDispatch(
              resetLiveControlsAction({
                fftSize: action.fftSize,
                fftFrameRate: action.fftFrameRate,
                sdrDefaults: signalsDefaults,
              }),
            );
            return;
          case "RESET_ZOOM_AND_DB":
            reduxDispatch(resetZoomAndDbAction());
            return;
          case "SET_VIZ_ZOOM_FLOOR":
            reduxDispatch(setVizZoomFloorAction(action.zoomFloor));
            return;
          case "SET_VIZ_ZOOM_FLOOR_PAN":
            reduxDispatch(setVizZoomFloorPanAction(action.pan));
            return;
          case "SET_AUTO_ZOOM_STABILITY":
            reduxDispatch(setAutoZoomStabilityAction(action.enabled));
            return;
          case "SET_VIZ_PAN":
            reduxDispatch(setVizPanAction(action.pan));
            return;
          case "SET_FFT_DB_LIMITS":
            reduxDispatch(
              setFftDbLimitsAction({ min: action.min, max: action.max }),
            );
            return;
          case "TRAINING_STOP":
            reduxDispatch(resetTrainingCapture());
            return;
          case "SET_DRAW_PARAMS":
            reduxDispatch(setWaterfallDrawParams(action.params));
            return;
          case "SET_CLUMP_PARAMS":
            reduxDispatch(
              setWaterfallClumpParams({
                index: action.index,
                params: action.params,
              }),
            );
            return;
          case "SET_ACTIVE_CLUMP_INDEX":
            reduxDispatch(setWaterfallActiveClumpIndex(action.index));
            return;
          case "RESET_DRAW_PARAMS":
            reduxDispatch(resetWaterfallDrawParams());
            return;
          case "SET_SHOW_SPIKE_OVERLAY":
            reduxDispatch(setShowSpikeOverlayAction(action.enabled));
            return;
          case "SET_REMOVE_DC_SPIKE":
            reduxDispatch(setRemoveDcSpikeAction(action.enabled));
            return;
          case "SET_DETECTED_FRAME_RATE":
            reduxDispatch(setDetectedFrameRate(action.detectedFrameRate));
            return;
          default:
            // Legacy actions without a Redux owner are intentionally ignored;
            // active consumers must use the explicit Redux action surface.
            return;
        }
      },
      [reduxDispatch],
    );

    const sendFrequencyRangeCommand = useCallback(
      (range: FrequencyRange) => {
        reduxDispatch(sendFrequencyRangeThunk(range));
      },
      [reduxDispatch],
    );

    const sendPauseCommand = useCallback(
      (paused: boolean, sourceId?: string) => {
        const pauseSourceId = resolvePauseTargetSourceId({
          requestedSourceId: sourceId,
          selectedSourceId,
          activeSourceId,
        });
        if (!pauseSourceId) {
          return;
        }
        const pauseTargetSource =
          effectiveWebsocketSources.find(
            (source) => source.id === pauseSourceId,
          ) ?? (selectedSourceId === pauseSourceId ? selectedSource : null);
        const duplexMode =
          pauseTargetSource?.duplex_mode?.toLowerCase?.() === "half-duplex"
            ? "half_duplex"
            : undefined;
        const activeMode = resolveDeviceActiveMode(pauseTargetSource);
        reduxDispatch({
          type: "websocket/setPaused",
          payload: {
            isPaused: paused,
            sourceId: pauseSourceId,
            duplexMode,
            activeMode,
          },
        });
      },
      [
        activeSourceId,
        effectiveWebsocketSources,
        reduxDispatch,
        selectedSource,
        selectedSourceId,
      ],
    );

    const sendSettingsCommand = useCallback(
      (settings: SDRSettings) => {
        reduxDispatch(sendSettingsThunk(settings));
      },
      [reduxDispatch],
    );

    const sendRestartDeviceCommand = useCallback(
      (sourceId?: string) => {
        reduxDispatch(sendRestartDeviceThunk(sourceId));
      },
      [reduxDispatch],
    );

    const sendCaptureCommand = useCallback(
      (req: CaptureRequest) => {
        reduxDispatch(sendCaptureCommandThunk(req));
      },
      [reduxDispatch],
    );

    const sendScanCommand = useCallback(
      (jobId: string, minFreq: number, maxFreq: number, options?: any) => {
        reduxDispatch(
          sendScanCommandThunk({ jobId, minFreq, maxFreq, options }),
        );
      },
      [reduxDispatch],
    );

    const sendDemodulateCommand = useCallback(
      (jobId: string, region: any) => {
        reduxDispatch(sendDemodulateCommandThunk({ jobId, region }));
      },
      [reduxDispatch],
    );

    const sendTrainingCommand = useCallback(
      (
        action: "start" | "stop",
        label: "target" | "noise",
        signalArea: string,
      ) => {
        reduxDispatch(sendTrainingCommandThunk({ action, label, signalArea }));
      },
      [reduxDispatch],
    );

    const sendPowerScaleCommand = useCallback(
      (scale: "dB" | "dBm") => {
        reduxDispatch(sendPowerScaleCommandThunk(scale));
      },
      [reduxDispatch],
    );

    const sendTransmitStatusCommand = useCallback(
      (
        enabled: boolean,
        device: string,
        txSettings: {
          serialNumber: string;
          centerFrequencyHz?: number | null;
          viewCenterHz?: number | null;
          bandwidthHz?: number | null;
          sampleRateHz?: number | null;
          ifftSize?: number | null;
          powerDbm?: number | null;
          lnaGainDb?: number | null;
          vgaGainDb?: number | null;
          ampEnabled?: boolean | null;
          tunerAgc?: boolean | null;
          rtlAgc?: boolean | null;
          ppm?: number | null;
          txSafetyEnabled?: boolean | null;
          txSafetyLimit?: string | null;
          txSignal?: string | null;
          txHopEnabled?: boolean | null;
          txHopType?: string | null;
          txHopStartFrequencyHz?: number | null;
          txHopEndFrequencyHz?: number | null;
          txHopChannels?: string[] | null;
          txHopRateHz?: number | null;
        },
      ) => {
        if (!isConnected) {
          return;
        }
        const { ifftSize, ...txSettingsWithoutIfftSize } = txSettings;
        reduxDispatch({
          type: "websocket/sendMessage",
          payload: {
            type: "status",
            data: {
              scope: "device",
              status: enabled ? "transmitting" : "standby",
              txDevice: device,
              txSafetyEnabled: reduxSpectrumState.txSafetyEnabled,
              txSafetyLimit: reduxSpectrumState.txSafetyLimit,
              txSignal: reduxSpectrumState.txSignal,
              txHopEnabled: reduxSpectrumState.txHopEnabled,
              txHopType: reduxSpectrumState.txHopType,
              txHopStartFrequencyHz: reduxSpectrumState.txHopStartFrequencyHz,
              txHopEndFrequencyHz: reduxSpectrumState.txHopEndFrequencyHz,
              txHopChannels: reduxSpectrumState.txHopChannels,
              txHopRateHz: reduxSpectrumState.txHopRateHz,
              ...txSettingsWithoutIfftSize,
              txIfftSize:
                typeof ifftSize === "number" ? Math.round(ifftSize) : ifftSize,
            },
          },
        });
      },
      [isConnected, reduxDispatch, reduxSpectrumState],
    );

    const wsConnection = useMemo(
      () => ({
        isConnected,
        activeSourceId: activeSourceId || null,
        deviceState: activeSourceDerived.deviceState,
        deviceLoadingReason: (activeSource?.status === "loading" ||
        activeSource?.status === "initializing"
          ? "connect"
          : null) as DeviceLoadingReason,
        isPaused,
        serverPaused,
        backend: activeSourceDerived.backend,
        deviceInfo: activeSourceDerived.deviceInfo,
        deviceName: activeSourceDerived.deviceName,
        deviceProfile: activeSourceDerived.deviceProfile,
        maxSampleRateHz: activeSourceDerived.maxSampleRateHz,
        sampleRateOptions: activeSourceDerived.sampleRateOptions,
        sampleRateHz: activeSourceDerived.sampleRateHz,
        supportsBasebandFilter: activeSourceDerived.supportsBasebandFilter,
        sdrSettings: activeSourceDerived.sdrSettings,
        sdrLimitMarkers: activeSource?.sdr.fft_display.markers ?? [],
        dataRef,
        spectrumFrames: wsSpectrumFrames,
        sources: effectiveWebsocketSources,
        captureStatus,
        error,
        cryptoCorrupted,
        sendFrequencyRange: sendFrequencyRangeCommand,
        sendPauseCommand,
        sendSettings: sendSettingsCommand,
        sendRestartDevice: sendRestartDeviceCommand,
        sendCaptureCommand,
        sendScanCommand,
        sendDemodulateCommand,
        sendTrainingCommand,
        sendPowerScaleCommand,
        sendTransmitStatus: sendTransmitStatusCommand,
      }),
      [
        isConnected,
        activeSourceId,
        activeSourceDerived.deviceState,
        activeSource,
        activeSourceDerived,
        isPaused,
        serverPaused,
        dataRef,
        effectiveWebsocketSources,
        captureStatus,
        error,
        cryptoCorrupted,
        sendFrequencyRangeCommand,
        sendPauseCommand,
        sendSettingsCommand,
        sendRestartDeviceCommand,
        sendCaptureCommand,
        sendScanCommand,
        sendDemodulateCommand,
        sendTrainingCommand,
        sendPowerScaleCommand,
        sendTransmitStatusCommand,
      ],
    );

    // Track active spectrum route globally. Restore a persisted manual pause
    // so hot reload / full reload keeps the visualizer paused when the user
    // left it paused.
    const [manualVisualizerPaused, setManualVisualizerPaused] = useState(() =>
      resolveColdStartVisualizerPauseState({
        persistedPaused: loadPersistedManualVisualizerPaused(),
      }),
    );
    useEffect(() => {
      persistManualVisualizerPaused(manualVisualizerPaused);
    }, [manualVisualizerPaused]);
    // Seed the manual-pause latch from the restored persisted state so the
    // source-activation replay below re-asserts the pause to a backend that
    // reset its own pause state on reconnect. Also apply the pause to the
    // local frame gate immediately so a restored pause freezes the stream from
    // the very first frame instead of depending on a round trip to the
    // backend (which may already report the source as paused and thus skip the
    // replay, leaving the frame gate live while the UI shows "Resume").
    const restoredPauseAppliedRef = useRef<string | null>(null);
    useEffect(() => {
      if (!manualVisualizerPaused || !selectedSourceId) return;
      manualPausedSourceIdsRef.current.add(selectedSourceId);
      autoPausedSourceIdsRef.current.delete(selectedSourceId);
      if (restoredPauseAppliedRef.current !== selectedSourceId) {
        restoredPauseAppliedRef.current = selectedSourceId;
        wsConnection.sendPauseCommand(true, selectedSourceId);
      }
    }, [manualVisualizerPaused, selectedSourceId, wsConnection]);
    const previousDeviceStateRef = useRef<DeviceState | null>(null);

    // Track if we've already synced backend connection settings
    const hasInitializedBackendSettingsRef = useRef(false);

    const wasConnectedRef = useRef(false);
    useEffect(() => {
      if (isConnected && !wasConnectedRef.current) {
        hasInitializedBackendSettingsRef.current = false;
      }
      wasConnectedRef.current = isConnected;
    }, [isConnected]);

    const [cachedFrames, setCachedFrames] = useState<SpectrumFrame[]>(() => {
      if (typeof window === "undefined") return [];
      try {
        const raw = sessionStorage.getItem("napt-spectrum-frames");
        if (!raw) return [];
        const parsed = JSON.parse(raw) as SpectrumFrame[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    });

    const cachedSdrSettingsRef = useRef<SourceSdrSettings | null>(null);
    const cachedSdrSettingsHydratedRef = useRef(false);
    if (!cachedSdrSettingsHydratedRef.current) {
      cachedSdrSettingsHydratedRef.current = true;
      cachedSdrSettingsRef.current = (() => {
        if (typeof window === "undefined") return null;
        try {
          const raw = sessionStorage.getItem("napt-sdr-settings");
          if (!raw) return null;
          return JSON.parse(raw) as SourceSdrSettings;
        } catch {
          return null;
        }
      })();
    }
    const lastLiveSourceIdRef = useRef<string | null>(null);

    const syncSelectedSourcePauseState = useCallback(
      (sourceId: string | null | undefined) => {
        // The client pause is authoritative: the user can stop the stream
        // locally without waiting for (or depending on) the backend. Mirror
        // the client's own intent — the manual/auto latches and the local
        // override — into the button state.
        const nextPaused =
          !!sourceId &&
          resolveClientPauseState({
            localPaused: localSourcePauseOverrides[sourceId],
            manuallyPaused:
              manualPausedSourceIdsRef.current.has(sourceId),
            autoPaused:
              autoPausedSourceIdsRef.current.has(sourceId),
          });
        if (manualVisualizerPaused === nextPaused) {
          return;
        }
        setManualVisualizerPaused(nextPaused);
        reduxDispatch(setVisualizerPausedAction(nextPaused));
      },
      [
        localSourcePauseOverrides,
        manualVisualizerPaused,
        storeDispatch,
      ],
    );

    useEffect(() => {
      if (!isConnected || !selectedSourceId || !selectedSource) {
        return;
      }

      const previousSelectedSourceId = previousSelectedSourceIdRef.current;
      previousSelectedSourceIdRef.current = selectedSourceId;

      if (
        previousSelectedSourceId &&
        previousSelectedSourceId !== selectedSourceId
      ) {
        const previousSource = effectiveWebsocketSources.find(
          (source) => source.id === previousSelectedSourceId,
        );
        const nextSource = effectiveWebsocketSources.find(
          (source) => source.id === selectedSourceId,
        );
        const previouslyManuallyPaused = manualPausedSourceIdsRef.current.has(
          previousSelectedSourceId,
        );
        const previouslyAutoPaused = autoPausedSourceIdsRef.current.has(
          previousSelectedSourceId,
        );
        if (
          previousSource &&
          shouldPauseSourceOnSwitch(previousSource, nextSource) &&
          !previouslyManuallyPaused &&
          !previouslyAutoPaused
        ) {
          autoPausedSourceIdsRef.current.add(previousSelectedSourceId);
          setLocalSourcePauseOverrides((current) =>
            updateLocalSourcePauseOverride(
              current,
              previousSelectedSourceId,
              true,
            ),
          );
          wsConnection.sendPauseCommand(true, previousSelectedSourceId);
        }
      }

      if (
        shouldResumePausedRxSourceOnSelection(
          selectedSource,
          manualPausedSourceIdsRef.current.has(selectedSourceId),
          txSuiteSourceId,
        )
      ) {
        autoPausedSourceIdsRef.current.delete(selectedSourceId);
        setLocalSourcePauseOverrides((current) =>
          updateLocalSourcePauseOverride(current, selectedSourceId, false),
        );
        wsConnection.sendPauseCommand(false, selectedSourceId);
        syncSelectedSourcePauseState(selectedSourceId);
        return;
      }

      if (isTxCapableSourceInfo(selectedSource)) {
        syncSelectedSourcePauseState(selectedSourceId);
        return;
      }

      if (
        autoPausedSourceIdsRef.current.has(selectedSourceId) &&
        !manualPausedSourceIdsRef.current.has(selectedSourceId)
      ) {
        autoPausedSourceIdsRef.current.delete(selectedSourceId);
        setLocalSourcePauseOverrides((current) =>
          updateLocalSourcePauseOverride(current, selectedSourceId, false),
        );
        wsConnection.sendPauseCommand(false, selectedSourceId);
      }

      syncSelectedSourcePauseState(selectedSourceId);
    }, [
      isConnected,
      selectedSource,
      selectedSourceId,
      txSuiteSourceId,
      syncSelectedSourcePauseState,
      effectiveWebsocketSources,
      wsConnection,
    ]);

    useEffect(() => {
      const shouldReplay = shouldReplayManualPauseOnSourceActivation({
        activeSourceId,
        selectedSourceId,
        manuallyPaused: manualPausedSourceIdsRef.current.has(selectedSourceId),
        backendPaused: selectedSource?.paused,
        pauseReplaySentForSourceId: pauseReplaySentForSourceIdRef.current,
      });
      if (!shouldReplay) {
        if (activeSourceId !== selectedSourceId) {
          pauseReplaySentForSourceIdRef.current = null;
        }
        return;
      }

      pauseReplaySentForSourceIdRef.current = activeSourceId;
      wsConnection.sendPauseCommand(true, activeSourceId);
    }, [
      activeSourceId,
      isConnected,
      selectedSource,
      selectedSourceId,
      wsConnection,
    ]);

    useEffect(() => {
      if (state.sourceMode !== "live") {
        lastLiveSourceIdRef.current = null;
        return;
      }

      const currentLiveSourceId = resolveClientLiveSourceId({
        selectedSourceId: selectedSourceId ?? selectedSource?.id ?? null,
        activeSourceId,
      });
      if (!currentLiveSourceId) {
        return;
      }

      if (lastLiveSourceIdRef.current === currentLiveSourceId) {
        return;
      }

      lastLiveSourceIdRef.current = currentLiveSourceId;
      liveDataRef.current = null;
      setCachedFrames([]);
      try {
        sessionStorage.removeItem("napt-spectrum-frames");
      } catch {
        /* ignore */
      }
    }, [activeSourceId, selectedSource, selectedSourceId, state.sourceMode]);

    useEffect(() => {
      const previousDeviceState = previousDeviceStateRef.current;
      previousDeviceStateRef.current = deviceState;

      if (!isConnected || !selectedSourceId || !selectedSource) {
        return;
      }

      if (!manualVisualizerPaused) {
        return;
      }

      if (
        !shouldAutoResumeVisualizerOnDeviceRecovery(
          selectedSource,
          manualPausedSourceIdsRef.current.has(selectedSourceId),
          deviceState,
          previousDeviceState,
        )
      ) {
        return;
      }

      autoPausedSourceIdsRef.current.delete(selectedSourceId);
      setLocalSourcePauseOverrides((current) =>
        updateLocalSourcePauseOverride(current, selectedSourceId, false),
      );
      wsConnection.sendPauseCommand(false, selectedSourceId);
      syncSelectedSourcePauseState(selectedSourceId);
    }, [
      deviceState,
      isConnected,
      manualVisualizerPaused,
      selectedSource,
      selectedSourceId,
      syncSelectedSourcePauseState,
      wsConnection,
    ]);

    useEffect(() => {
      const wasVisualizerRoute = previousIsVisualizerRouteRef.current;
      previousIsVisualizerRouteRef.current = isVisualizerRoute;

      if (!selectedSourceId || !selectedSource) {
        return;
      }

      if (wasVisualizerRoute && !isVisualizerRoute) {
        if (
          isTxCapableSourceInfo(selectedSource) ||
          manualPausedSourceIdsRef.current.has(selectedSourceId) ||
          autoPausedSourceIdsRef.current.has(selectedSourceId)
        ) {
          return;
        }

        autoPausedSourceIdsRef.current.add(selectedSourceId);
        setLocalSourcePauseOverrides((current) =>
          updateLocalSourcePauseOverride(current, selectedSourceId, true),
        );
        wsConnection.sendPauseCommand(true, selectedSourceId);
        syncSelectedSourcePauseState(selectedSourceId);
        return;
      }

      if (!wasVisualizerRoute && isVisualizerRoute) {
        if (!autoPausedSourceIdsRef.current.has(selectedSourceId)) {
          syncSelectedSourcePauseState(selectedSourceId);
          return;
        }

        autoPausedSourceIdsRef.current.delete(selectedSourceId);
        setLocalSourcePauseOverrides((current) =>
          updateLocalSourcePauseOverride(current, selectedSourceId, false),
        );
        wsConnection.sendPauseCommand(false, selectedSourceId);
        syncSelectedSourcePauseState(selectedSourceId);
      }
    }, [
      isVisualizerRoute,
      selectedSource,
      selectedSourceId,
      syncSelectedSourcePauseState,
      storeDispatch,
      wsConnection,
    ]);

    // Persist SDR settings when they change
    useEffect(() => {
      const settingsToPersist = {
        fftSize: state.fftSize,
        fftWindow: state.fftWindow,
        fftFrameRate: state.fftFrameRate,
        detectedFrameRate: reduxSpectrumState.detectedFrameRate,
        gain: state.gain,
        ppm: state.ppm,
        tunerAGC: state.tunerAGC,
        rtlAGC: state.rtlAGC,
        vizZoom: state.vizZoom,
        vizPanOffset: state.vizPanOffset,
        fftMinDb: state.fftMinDb,
        fftMaxDb: state.fftMaxDb,
        frequencyRange: state.frequencyRange,
        activeSignalArea: state.activeSignalArea,
        lastKnownRanges: state.lastKnownRanges,
        displayTemporalResolution: state.displayTemporalResolution,
        snapshotGridPreference: mergedState.snapshotGridPreference,
        sampleRateHz: state.sampleRateHz,
      };
      sessionStorage.setItem(
        SDR_SETTINGS_KEY,
        JSON.stringify(settingsToPersist),
      );
    }, [
      state.fftSize,
      state.fftWindow,
      state.fftFrameRate,
      reduxSpectrumState.detectedFrameRate,
      state.gain,
      state.ppm,
      state.tunerAGC,
      state.rtlAGC,
      state.vizZoom,
      state.vizPanOffset,
      state.fftMinDb,
      state.fftMaxDb,
      state.frequencyRange,
      state.activeSignalArea,
      state.lastKnownRanges,
      state.displayTemporalResolution,
      state.powerScale,
      mergedState.snapshotGridPreference,
      state.sampleRateHz,
    ]);

    const lastSentPowerScaleRef = useRef<"dB" | "dBm" | null>(null);
    useEffect(() => {
      if (!isConnected || lastSentPowerScaleRef.current === state.powerScale)
        return;
      wsConnection.sendPowerScaleCommand(state.powerScale);
      lastSentPowerScaleRef.current = state.powerScale;
    }, [isConnected, wsConnection.sendPowerScaleCommand, state.powerScale]);

    const pausedPreviewTimeoutRef = useRef<number | null>(null);
    const lastPausedPreviewSignatureRef = useRef<string | null>(null);
    const wasPausedForPreviewRef = useRef(false);
    useEffect(() => {
      const isLiveSource = state.sourceMode === "live";
      // Mock Tx standby one-shots are owned by SpectrumRoute. Requesting here
      // as well stacked a second advancing preview on top of the route request.
      const isPausedForPreview =
        manualVisualizerPaused &&
        isConnected &&
        shouldRequestPausedPreview(selectedSource, txSuiteSourceId);
      const isSwitchingSource =
        activeSourceId !== null &&
        selectedSourceId !== null &&
        activeSourceId !== selectedSourceId;

      if (!isLiveSource || !isPausedForPreview || isSwitchingSource) {
        if (pausedPreviewTimeoutRef.current !== null) {
          window.clearTimeout(pausedPreviewTimeoutRef.current);
          pausedPreviewTimeoutRef.current = null;
        }
        lastPausedPreviewSignatureRef.current = null;
        wasPausedForPreviewRef.current = false;
        return;
      }

      const nextSignature = buildPausedPreviewSignature({
        frequencyRange: state.frequencyRange,
        sampleRateHz: reduxSpectrumState.sampleRateHz,
        fftSize: reduxSpectrumState.fftSize,
        fftWindow: reduxSpectrumState.fftWindow,
        vizZoom: state.vizZoom,
        vizPanOffset: state.vizPanOffset,
        txCenterFrequencyHz: reduxSpectrumState.txCenterFrequencyHz,
        txSampleRateHz: reduxSpectrumState.txSampleRateHz,
        txPowerDbm: reduxSpectrumState.txPowerDbm,
        txSignal: reduxSpectrumState.txSignal,
        txIfftSize: reduxSpectrumState.txIfftSize,
      });

      if (!wasPausedForPreviewRef.current && isPausedForPreview) {
        wasPausedForPreviewRef.current = true;
        lastPausedPreviewSignatureRef.current = nextSignature;
        reduxDispatch(
          requestNextPausedFrameThunk({
            sourceId: resolvePausedPreviewRequestSourceId(activeSourceId, selectedSourceId),
            frequencyRange: state.frequencyRange,
            txSettings: {
              centerFrequencyHz: reduxSpectrumState.txCenterFrequencyHz,
              bandwidthHz: reduxSpectrumState.txSampleRateHz,
              powerDbm: reduxSpectrumState.txPowerDbm,
              txSignal: reduxSpectrumState.txSignal,
              txIfftSize: reduxSpectrumState.txIfftSize,
            },
          }),
        );
        return;
      }

      if (nextSignature === lastPausedPreviewSignatureRef.current) {
        return;
      }

      if (pausedPreviewTimeoutRef.current !== null) {
        window.clearTimeout(pausedPreviewTimeoutRef.current);
      }

      pausedPreviewTimeoutRef.current = window.setTimeout(() => {
        reduxDispatch(
          requestNextPausedFrameThunk({
            sourceId: resolvePausedPreviewRequestSourceId(activeSourceId, selectedSourceId),
            frequencyRange: state.frequencyRange,
            txSettings: {
              centerFrequencyHz: reduxSpectrumState.txCenterFrequencyHz,
              bandwidthHz: reduxSpectrumState.txSampleRateHz,
              powerDbm: reduxSpectrumState.txPowerDbm,
              txSignal: reduxSpectrumState.txSignal,
              txIfftSize: reduxSpectrumState.txIfftSize,
            },
          }),
        );
        lastPausedPreviewSignatureRef.current = nextSignature;
        pausedPreviewTimeoutRef.current = null;
      }, 120);

      return () => {
        if (pausedPreviewTimeoutRef.current !== null) {
          window.clearTimeout(pausedPreviewTimeoutRef.current);
          pausedPreviewTimeoutRef.current = null;
        }
      };
    }, [
      activeSourceId,
      isConnected,
      manualVisualizerPaused,
      reduxDispatch,
      reduxSpectrumState.txCenterFrequencyHz,
      reduxSpectrumState.txIfftSize,
      reduxSpectrumState.txPowerDbm,
      reduxSpectrumState.txSampleRateHz,
      reduxSpectrumState.txSignal,
      selectedSourceId,
      selectedSource,
      txSuiteSourceId,
      state.frequencyRange,
      reduxSpectrumState.sampleRateHz,
      reduxSpectrumState.fftSize,
      reduxSpectrumState.fftWindow,
      state.sourceMode,
      state.vizPanOffset,
      state.vizZoom,
    ]);

    const lastSentSignalDisplaySettingsRef =
      useRef<SignalDisplaySettings | null>(null);
    useEffect(() => {
      lastSentSignalDisplaySettingsRef.current = null;
    }, [activeSourceId, isConnected]);

    useEffect(() => {
      if (!isConnected || reduxSpectrumState.detectedFrameRate == null || !activeSourceId)
        return;
      const nextSettings: SignalDisplaySettings = {
        sampleRateHz: state.sampleRateHz ?? null,
        fftSize: state.fftSize ?? null,
        frameRate: Math.round(reduxSpectrumState.detectedFrameRate),
      };
      if (
        !shouldSendSignalDisplaySettings({
          previous: lastSentSignalDisplaySettingsRef.current,
          next: nextSettings,
        })
      ) {
        return;
      }
      reduxDispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "signal_display_settings",
          data: {
            source_id: activeSourceId,
            sample_rate: nextSettings.sampleRateHz,
            fft_size: state.fftSize,
            frame_rate: nextSettings.frameRate,
          },
        },
      });
      lastSentSignalDisplaySettingsRef.current = nextSettings;
    }, [
      isConnected,
      reduxDispatch,
      reduxSpectrumState.detectedFrameRate,
      state.sampleRateHz,
      state.fftSize,
      activeSourceId,
    ]);

    const lastSentTxSettingsRef = useRef<string | null>(null);
    const txSettingsThrottleTimeoutRef = useRef<number | null>(null);
    const txSettingsLastSentTimeRef = useRef<number>(0);
    const latestTxSettingsRef = useRef<any>(null);

    // Clean up throttle timeout on unmount
    useEffect(() => {
      return () => {
        if (txSettingsThrottleTimeoutRef.current !== null) {
          clearTimeout(txSettingsThrottleTimeoutRef.current);
        }
      };
    }, []);

    // Synchronize transmit settings changes to backend if currently transmitting
    useEffect(() => {
      const controlSourceId = txSuiteSourceId ?? activeSourceId;
      const controlSource = txSuiteSource ?? activeSource;
      if (!isConnected || !controlSourceId) return;

      const currentStatus =
        sourceStatuses?.[controlSourceId] ?? controlSource?.status;
      if (currentStatus !== "transmitting") {
        lastSentTxSettingsRef.current = null;
        if (txSettingsThrottleTimeoutRef.current !== null) {
          clearTimeout(txSettingsThrottleTimeoutRef.current);
          txSettingsThrottleTimeoutRef.current = null;
        }
        return;
      }

      const range = reduxSpectrumState.frequencyRange;
      const rangeViewSampleRateHz =
        range &&
        Number.isFinite(range.min) &&
        Number.isFinite(range.max) &&
        range.max > range.min
          ? range.max - range.min
          : undefined;
      const rangeViewCenterHz =
        range &&
        Number.isFinite(range.min) &&
        Number.isFinite(range.max) &&
        range.max > range.min
          ? (range.min + range.max) / 2
          : null;
      const transmitGeometry = resolveMockTxTransmitSettings({
        txCenterHz: reduxSpectrumState.txCenterFrequencyHz,
        viewCenterHz: rangeViewCenterHz,
        viewSampleRateHz: rangeViewSampleRateHz,
        txBandwidthHz: reduxSpectrumState.txSampleRateHz,
        alignMonitor: false,
      });
      const settings = {
        ...transmitGeometry,
        powerDbm: reduxSpectrumState.txPowerDbm,
        vgaGainDb: reduxSpectrumState.txVgaGain,
        txSafetyEnabled: reduxSpectrumState.txSafetyEnabled,
        txSafetyLimit: reduxSpectrumState.txSafetyLimit,
        txSignal: reduxSpectrumState.txSignal,
        txHopEnabled: reduxSpectrumState.txHopEnabled,
        txHopType: reduxSpectrumState.txHopType,
        txHopStartFrequencyHz: reduxSpectrumState.txHopStartFrequencyHz,
        txHopEndFrequencyHz: reduxSpectrumState.txHopEndFrequencyHz,
        txHopChannels: reduxSpectrumState.txHopChannels,
        txHopRateHz: reduxSpectrumState.txHopRateHz,
      };

      latestTxSettingsRef.current = settings;

      const runSync = () => {
        const freshSettings = latestTxSettingsRef.current;
        if (!freshSettings) return;
        const settingsStr = JSON.stringify(freshSettings);
        if (lastSentTxSettingsRef.current === settingsStr) return;

        lastSentTxSettingsRef.current = settingsStr;
        txSettingsLastSentTimeRef.current = Date.now();
        sendTransmitStatusCommand(true, controlSourceId, {
          serialNumber: controlSource?.serial_number ?? controlSourceId,
          ...freshSettings,
        });
      };

      const settingsStr = JSON.stringify(settings);
      if (lastSentTxSettingsRef.current === settingsStr) return;

      const now = Date.now();
      const timeSinceLastSend = now - txSettingsLastSentTimeRef.current;
      const throttleDelay = 50; // 50ms throttle limit for smooth interaction

      if (timeSinceLastSend >= throttleDelay) {
        if (txSettingsThrottleTimeoutRef.current !== null) {
          clearTimeout(txSettingsThrottleTimeoutRef.current);
          txSettingsThrottleTimeoutRef.current = null;
        }
        runSync();
      } else {
        // If a timeout is already scheduled, it will run with the latest settings,
        // so we don't need to reschedule or postpone it.
        if (txSettingsThrottleTimeoutRef.current === null) {
          const remaining = throttleDelay - timeSinceLastSend;
          txSettingsThrottleTimeoutRef.current = window.setTimeout(() => {
            txSettingsThrottleTimeoutRef.current = null;
            runSync();
          }, remaining);
        }
      }
    }, [
      isConnected,
      activeSource,
      activeSourceId,
      txSuiteSource,
      txSuiteSourceId,
      sourceStatuses,
      reduxSpectrumState.txCenterFrequencyHz,
      reduxSpectrumState.txSampleRateHz,
      reduxSpectrumState.txPowerDbm,
      reduxSpectrumState.txVgaGain,
      reduxSpectrumState.txSafetyEnabled,
      reduxSpectrumState.txSafetyLimit,
      reduxSpectrumState.txSignal,
      reduxSpectrumState.txHopEnabled,
      reduxSpectrumState.txHopType,
      reduxSpectrumState.txHopStartFrequencyHz,
      reduxSpectrumState.txHopEndFrequencyHz,
      reduxSpectrumState.txHopChannels,
      reduxSpectrumState.txHopRateHz,
      reduxSpectrumState.frequencyRange,
      activeSource,
      sendTransmitStatusCommand,
    ]);

    // Revert power scale to dB if not supported by the current device
    useEffect(() => {
      if (
        deviceProfile &&
        !deviceProfile.supports_approx_dbm &&
        state.powerScale === "dBm"
      ) {
        reduxDispatch(setPowerScaleAction("dB"));
      }
    }, [deviceProfile, state.powerScale, reduxDispatch]);

    useEffect(() => {
      if (!isConnected) {
        setCachedFrames([]);
        try {
          sessionStorage.removeItem("napt-spectrum-frames");
        } catch {
          /* ignore */
        }
        return;
      }
      if (wsSpectrumFrames.length === 0) return;
      setCachedFrames(wsSpectrumFrames);
      try {
        sessionStorage.setItem(
          "napt-spectrum-frames",
          JSON.stringify(wsSpectrumFrames),
        );
      } catch {
        /* ignore */
      }
    }, [isConnected, wsSpectrumFrames]);

    useEffect(() => {
      if (!isConnected) {
        cachedSdrSettingsRef.current = null;
        try {
          sessionStorage.removeItem("napt-sdr-settings");
        } catch {
          /* ignore */
        }
        return;
      }
      if (!sdrSettings) return;
      cachedSdrSettingsRef.current = resolveCachedSdrSettings(
        cachedSdrSettingsRef.current,
        sdrSettings,
      );
      try {
        sessionStorage.setItem(
          "napt-sdr-settings",
          JSON.stringify(sdrSettings),
        );
        localStorage.setItem("napt-sdr-settings", JSON.stringify(sdrSettings));
      } catch {
        /* ignore */
      }
    }, [isConnected, sdrSettings]);

    const hydratedBackendSampleRateRef = useRef(false);

    useEffect(() => {
      hydratedBackendSampleRateRef.current = false;
      pendingLocalSampleRateRef.current = null;
      hasInitializedBackendSettingsRef.current = false;
      // Force re-sending the current frequency range to the newly activated
      // device so it tunes to the user's last frequency, not the backend default.
      lastSentFrequencyRangeRef.current = null;
    }, [activeSourceId, selectedSourceViewKey]);

    // Hydrate the initial sample rate from backend state. Subsequent managed
    // stream option events update Redux directly, so a remote subscriber's
    // device-scoped change reaches this view without waiting for a heartbeat.
    useEffect(() => {
      const rate = selectLiveSampleRateForSync({
        isConnected,
        websocketSampleRateHz: sampleRateHz,
        sdrSettingsSampleRateHz: sdrSettings?.sample_rate,
        minReceiveSampleRateHz: sdrSettings?.min_receive_sample_rate,
        maxSampleRateHz,
        deviceKind: deviceProfile?.kind,
        backend,
        deviceName,
        isRtlSdr: deviceProfile?.is_rtl_sdr,
      });
      const pendingLocalSampleRateHz = pendingLocalSampleRateRef.current;
      const shouldHydrateRate = shouldHydrateLiveSampleRate({
        rate,
        localSampleRateHz: state.sampleRateHz,
        pendingLocalSampleRateHz,
        hydratedBackendSampleRate: hydratedBackendSampleRateRef.current,
      });

      if (
        shouldHydrateRate &&
        typeof rate === "number" &&
        rate !== state.sampleRateHz
      ) {
        reduxDispatch(setSampleRateAction(rate));
      }
      if (
        typeof pendingLocalSampleRateHz === "number" &&
        typeof rate === "number" &&
        Number.isFinite(rate) &&
        Math.round(rate) === Math.round(pendingLocalSampleRateHz)
      ) {
        pendingLocalSampleRateRef.current = null;
      }
      if (typeof rate === "number" && rate > 0) {
        hydratedBackendSampleRateRef.current = true;
      }
      const minReceiveRate =
        sdrSettings?.min_receive_sample_rate ??
        sdrSettings?.sample_rate ??
        rate;
      if (
        typeof minReceiveRate === "number" &&
        minReceiveRate > 0 &&
        minReceiveRate !== state.minReceiveSampleRateHz
      ) {
        reduxDispatch(setMinReceiveSampleRateAction(minReceiveRate));
      }
    }, [
      sdrSettings?.sample_rate,
      sdrSettings?.min_receive_sample_rate,
      sampleRateHz,
      maxSampleRateHz,
      isConnected,
      deviceProfile?.kind,
      deviceProfile?.is_rtl_sdr,
      backend,
      deviceName,
      state.sampleRateHz,
      state.minReceiveSampleRateHz,
      reduxDispatch,
    ]);

    const effectiveFrames: SpectrumFrame[] = !isConnected
      ? []
      : Array.isArray(wsSpectrumFrames) && wsSpectrumFrames.length > 0
        ? wsSpectrumFrames
        : Array.isArray(cachedFrames)
          ? cachedFrames
          : [];
    const effectiveSdrSettings = resolveEffectiveSdrSettingsForConnection({
      isConnected,
      liveSettings: sdrSettings,
      cachedSettings: cachedSdrSettingsRef.current,
    });

    const sampleRateHzEffective = resolveEffectiveLiveSampleRateHz({
      localSampleRateHz: mergedState.sampleRateHz,
      websocketSampleRateHz: sampleRateHz,
      sdrSettingsSampleRateHz: effectiveSdrSettings?.sample_rate,
      minReceiveSampleRateHz: effectiveSdrSettings?.min_receive_sample_rate,
      maxSampleRateHz,
      deviceKind: deviceProfile?.kind,
      backend,
      deviceName,
      isRtlSdr: deviceProfile?.is_rtl_sdr,
    });

    const signalAreaBounds = useMemo(() => {
      if (!Array.isArray(effectiveFrames) || effectiveFrames.length === 0) {
        return null;
      }
      const bounds: Record<string, { min: number; max: number }> = {};
      effectiveFrames.forEach((frame) => {
        const label = frame.label;
        if (!label) return;
        bounds[label] = { min: frame.min_hz, max: frame.max_hz };
        bounds[label.toLowerCase()] = { min: frame.min_hz, max: frame.max_hz };
      });
      return bounds;
    }, [effectiveFrames]);

    const activeSignalAreaBounds =
      signalAreaBounds?.[mergedState.activeSignalArea] ??
      signalAreaBounds?.[mergedState.activeSignalArea?.toLowerCase?.()] ??
      null;

    const clampLiveFrequencyRange = useCallback(
      (range: FrequencyRange) => {
        if (range.min < 0) {
          return normalizeFrequencyRangeToHz(
            normalizePositiveHardwareRange(range),
          );
        }
        const bounds = resolveLiveAcquisitionBounds({
          hardwareBounds: hardwareSpectrumBounds,
          channelBounds: activeSignalAreaBounds,
        });
        if (!bounds) return normalizeFrequencyRangeToHz(range);

        const rangeSpan = range.max - range.min;
        const boundsSpan = bounds.max - bounds.min;
        const rtlClampedRange = clampRtlSdrFrequencyRangeToHardwareWindow({
          range,
          channelBounds: bounds,
          hardwareSampleRateHz: sampleRateHzEffective,
          deviceKind: deviceProfile?.kind,
          backend,
          deviceName,
          isRtlSdr: deviceProfile?.is_rtl_sdr,
        });
        if (
          rtlClampedRange.min !== range.min ||
          rtlClampedRange.max !== range.max
        ) {
          return normalizeFrequencyRangeToHz(rtlClampedRange);
        }

        if (Number.isFinite(rangeSpan) && rangeSpan > boundsSpan) {
          return normalizeFrequencyRangeToHz(range);
        }

        return normalizeFrequencyRangeToHz(
          clampFrequencyRangeToBounds(range, bounds),
        );
      },
      [
        activeSignalAreaBounds,
        backend,
        deviceName,
        deviceProfile?.is_rtl_sdr,
        deviceProfile?.kind,
        hardwareSpectrumBounds,
        sampleRateHzEffective,
      ],
    );

    const lastSentFrequencyRangeRef = useRef<FrequencyRange | null>(null);
    const previousFrequencyRangeSyncSourceIdRef = useRef<string | null>(null);
    const lastHandledDeviceFrequencyRangeRevisionRef = useRef(0);

    useEffect(() => {
      if (!isConnected || deviceState !== "connected") {
        lastSentFrequencyRangeRef.current = null;
      }
    }, [deviceState, isConnected]);

    // A persisted Whole Channel range can be wider than the RTL-SDR window.
    // Normalize it as soon as the connected source reveals its real maximum;
    // otherwise the old channel span survives the handoff as a fake rate.
    useEffect(() => {
      const currentRange = mergedState.frequencyRange;
      if (
        !isConnected ||
        deviceState !== "connected" ||
        !currentRange ||
        !isRtlSdrDevice({
          deviceKind: deviceProfile?.kind,
          backend,
          deviceName,
          isRtlSdr: deviceProfile?.is_rtl_sdr,
        })
      ) {
        return;
      }

      const nextRange = clampLiveFrequencyRange(currentRange);
      if (
        nextRange.min === currentRange.min &&
        nextRange.max === currentRange.max
      ) {
        return;
      }

      reduxDispatch(setFrequencyRangeAction(nextRange));
      wsConnection.sendFrequencyRange(nextRange);
      lastSentFrequencyRangeRef.current = nextRange;
    }, [
      backend,
      clampLiveFrequencyRange,
      deviceName,
      deviceProfile?.is_rtl_sdr,
      deviceProfile?.kind,
      deviceState,
      isConnected,
      mergedState.frequencyRange,
      reduxDispatch,
      wsConnection.sendFrequencyRange,
    ]);

    // Initialize frequencyRange if either it is null or unset
    // based on the first available frame (usually area 'A')
    // and the current sample rate. This is placed after variable
    // declarations to satisfy closure requirements.
    useEffect(() => {
      if (mergedState.frequencyRange) return;
      if (!isConnected) return;
      if (
        !activeSourceId ||
        selectedSourceId !== activeSourceId ||
        isMockTxSource({ id: activeSourceId, kind: activeSource?.kind })
      ) {
        return;
      }
      const sourceChannels =
        effectiveFrames.length > 0
          ? effectiveFrames
          : Array.isArray(websocketChannels) && websocketChannels.length > 0
            ? websocketChannels
            : [];
      if (!Array.isArray(sourceChannels) || sourceChannels.length === 0) return;

      const primaryFrame =
        sourceChannels.find((frame) => frame.label?.toLowerCase?.() === "a") ??
        sourceChannels[0];
      if (!primaryFrame) return;

      const min = primaryFrame.min_hz;
      const initialSampleRateHz = sampleRateHzEffective ?? sampleRateHz;
      const max = initialSampleRateHz
        ? Math.max(
            min,
            Math.min(primaryFrame.max_hz, min + initialSampleRateHz),
          )
        : primaryFrame.max_hz;
      const nextRange = clampLiveFrequencyRange({ min, max });

      const range = nextRange;
      if (
        lastSentFrequencyRangeRef.current?.min === range.min &&
        lastSentFrequencyRangeRef.current?.max === range.max
      )
        return;

      reduxDispatch(setFrequencyRangeAction(nextRange));
      wsConnection.sendFrequencyRange(nextRange);
      lastSentFrequencyRangeRef.current = nextRange;
    }, [
      mergedState.frequencyRange,
      sampleRateHz,
      sampleRateHzEffective,
      effectiveFrames,
      websocketChannels,
      isConnected,
      activeSourceId,
      activeSource?.kind,
      selectedSourceId,
      deviceState,
      wsConnection.sendFrequencyRange,
      reduxDispatch,
      clampLiveFrequencyRange,
    ]);

    // Execute exactly once to absorb backend default configurations (like signals.yaml gain)
    useEffect(() => {
      if (
        !isConnected ||
        !sdrSettings ||
        hasInitializedBackendSettingsRef.current
      )
        return;

      // Validate we actually received meaningful backend config (e.g. valid sample rate)
      if (
        sdrSettings.sample_rate === 0 &&
        (sdrSettings.center_frequency === 0 ||
          sdrSettings.center_frequency === undefined)
      )
        return;

      // Once valid, sync it into the global store immediately.
      hasInitializedBackendSettingsRef.current = true;

      const derived = deriveStateFromConfig(
        sampleRateHzEffective ?? 0,
        sdrSettings,
      );
      const initialHackrfBasebandBandwidth = isHackrfDevice({
        deviceKind: deviceProfile?.kind,
        backend,
        deviceName,
        sourceId: activeSourceId,
      })
        ? sampleRateHzEffective ?? sdrSettings.sample_rate
        : derived.hackrfBasebandBandwidth;
      reduxDispatch(setSdrSettingsBundleAction({
          ...derived,
          hackrfBasebandBandwidth: initialHackrfBasebandBandwidth,
          fftSize:
            typeof mergedState.fftSize === "number" && mergedState.fftSize > 0
              ? mergedState.fftSize
              : derived.fftSize,
          fftFrameRate:
            typeof mergedState.fftFrameRate === "number" &&
            mergedState.fftFrameRate > 0
              ? mergedState.fftFrameRate
              : derived.fftFrameRate,
      }));
    }, [
      isConnected,
      sdrSettings,
      sampleRateHzEffective,
      reduxDispatch,
      deviceProfile?.kind,
      backend,
      deviceName,
      activeSourceId,
      mergedState.fftSize,
      mergedState.fftFrameRate,
    ]);

    useEffect(() => {
      const currentRange = mergedState.frequencyRange;
      // An opt-in progressive tune owns publication while it is active. Its
      // controller rate-limits hardware commands; this effect must not echo
      // every animation-frame preview back to the device.
      if (reduxSpectrumState.tuningPreviewActive) return;
      const range = currentRange ? clampLiveFrequencyRange(currentRange) : null;
      const deviceRangeRevision =
        reduxSpectrumState.deviceFrequencyRangeRevision;
      if (
        shouldSkipDeviceFrequencyRangeEcho({
          deviceRangeRevision,
          lastHandledDeviceRangeRevision:
            lastHandledDeviceFrequencyRangeRevisionRef.current,
        })
      ) {
        lastHandledDeviceFrequencyRangeRevisionRef.current =
          deviceRangeRevision;
        previousFrequencyRangeSyncSourceIdRef.current = activeSourceId || null;
        if (range) {
          lastSentFrequencyRangeRef.current = range;
        }
        return;
      }
      const isRestoringSourceView =
        !!activeSourceId &&
        deferredFrequencyRangeSyncSourceIdRef.current === activeSourceId;
      const syncPlan = resolveSourceFrequencyRangeSync({
        connected: isConnected,
        selectedSourceId,
        activeSourceId: activeSourceId || null,
        previousActiveSourceId: previousFrequencyRangeSyncSourceIdRef.current,
        activeSourceIsMockTx: isMockTxSource({
          id: activeSourceId,
          kind: activeSource?.kind,
        }),
        frequencyRange: range,
        lastSentFrequencyRange: lastSentFrequencyRangeRef.current,
        isRestoringSourceView,
      });
      previousFrequencyRangeSyncSourceIdRef.current =
        syncPlan.nextActiveSourceId;
      if (syncPlan.clearLastSentFrequencyRange) {
        lastSentFrequencyRangeRef.current = null;
      }
      if (isRestoringSourceView) {
        deferredFrequencyRangeSyncSourceIdRef.current = null;
        return;
      }
      if (!currentRange || !range || !syncPlan.rangeToSend) return;
      if (range.min !== currentRange.min || range.max !== currentRange.max) {
        reduxDispatch(setFrequencyRangeAction(range));
      }
      wsConnection.sendFrequencyRange(syncPlan.rangeToSend);
      lastSentFrequencyRangeRef.current = syncPlan.rangeToSend;
    }, [
      isConnected,
      activeSourceId,
      activeSource?.kind,
      selectedSourceId,
      mergedState.frequencyRange,
      clampLiveFrequencyRange,
      reduxDispatch,
      reduxSpectrumState.deviceFrequencyRangeRevision,
      reduxSpectrumState.tuningPreviewActive,
      wsConnection.sendFrequencyRange,
    ]);

    useEffect(() => {
      if (!isVisualizerRoute) return;
      if (reduxSpectrumState.detectedFrameRate != null) return;

      const persistedFrameRate = getPersistedNumber(VISUALIZER_FRAME_RATE_KEY);
      if (persistedFrameRate != null) {
        reduxDispatch(setDetectedFrameRate(persistedFrameRate));
        return;
      }

      let cancelled = false;
      void detectRefreshRate().then((frameRate) => {
        if (cancelled || frameRate == null) return;

        const rounded = Math.round(frameRate);
        reduxDispatch(setDetectedFrameRate(rounded));
        try {
          sessionStorage.setItem(VISUALIZER_FRAME_RATE_KEY, String(rounded));
        } catch {
          /* ignore */
        }
      });

      return () => {
        cancelled = true;
      };
    }, [isVisualizerRoute, reduxSpectrumState.detectedFrameRate, reduxDispatch]);

    const setVisualizerPause = useCallback(
      (requestedPaused: boolean, sourceId?: string) => {
        if (mergedState.sourceMode === "file") {
          reduxDispatch(setWaterfallStitchPaused(requestedPaused));
          return;
        }

        const pauseSourceId = resolvePauseTargetSourceId({
          requestedSourceId: sourceId,
          selectedSourceId,
          activeSourceId,
        });
        if (!pauseSourceId) return;

        const pauseTargetSource =
          effectiveWebsocketSources.find(
            (source) => source.id === pauseSourceId,
          ) ?? (selectedSourceId === pauseSourceId ? selectedSource : null);
        const pauseTargetSourceId = pauseTargetSource?.id ?? pauseSourceId;
        const nextPaused = resolveNextVisualizerPauseState({
          currentPaused:
            pauseTargetSource?.paused ??
            (pauseTargetSourceId === selectedSourceId
              ? manualVisualizerPaused
              : false),
          requestedPaused,
        });
        if (nextPaused) {
          manualPausedSourceIdsRef.current.add(pauseTargetSourceId);
          autoPausedSourceIdsRef.current.delete(pauseTargetSourceId);
        } else {
          manualPausedSourceIdsRef.current.delete(pauseTargetSourceId);
          autoPausedSourceIdsRef.current.delete(pauseTargetSourceId);
        }
        setLocalSourcePauseOverrides((current) =>
          updateLocalSourcePauseOverride(
            current,
            pauseTargetSourceId,
            nextPaused,
          ),
        );

        if (
          shouldCarryManualPauseToSelectedSource({
            requestedPaused: nextPaused,
            selectedSourceId,
            pauseTargetSourceId,
          })
        ) {
          manualPausedSourceIdsRef.current.add(selectedSourceId);
          autoPausedSourceIdsRef.current.delete(selectedSourceId);
          setLocalSourcePauseOverrides((current) =>
            updateLocalSourcePauseOverride(current, selectedSourceId, true),
          );
          setManualVisualizerPaused(true);
          reduxDispatch(setVisualizerPausedAction(true));
        }

        if (pauseTargetSourceId === selectedSourceId) {
          setManualVisualizerPaused(nextPaused);
          reduxDispatch(setVisualizerPausedAction(nextPaused));
        }

        wsConnection.sendPauseCommand(nextPaused, pauseTargetSourceId);
      },
      [
        activeSourceId,
        manualVisualizerPaused,
        mergedState.isStitchPaused,
        mergedState.sourceMode,
        selectedSource,
        selectedSourceId,
        reduxDispatch,
        effectiveWebsocketSources,
        wsConnection,
      ],
    );

    const toggleVisualizerPause = useCallback(
      (sourceId?: string) => {
        if (mergedState.sourceMode === "file") {
          setVisualizerPause(!mergedState.isStitchPaused, sourceId);
          return;
        }

        const pauseSourceId = resolvePauseTargetSourceId({
          requestedSourceId: sourceId,
          selectedSourceId,
          activeSourceId,
        });
        if (!pauseSourceId) return;
        const pauseTargetSource =
          effectiveWebsocketSources.find(
            (source) => source.id === pauseSourceId,
          ) ?? (selectedSourceId === pauseSourceId ? selectedSource : null);
        const nextPaused = resolveToggleVisualizerPauseState({
          backendPaused: pauseTargetSource?.paused,
          localPaused: localSourcePauseOverrides[pauseSourceId],
          manuallyPaused: manualPausedSourceIdsRef.current.has(pauseSourceId),
          autoPaused: autoPausedSourceIdsRef.current.has(pauseSourceId),
        });
        setVisualizerPause(nextPaused, pauseSourceId);
      },
      [
        activeSourceId,
        effectiveWebsocketSources,
        localSourcePauseOverrides,
        manualVisualizerPaused,
        mergedState.isStitchPaused,
        mergedState.sourceMode,
        selectedSource,
        selectedSourceId,
        setVisualizerPause,
      ],
    );

    const value = useMemo(
      () => ({
        state: mergedState,
        dispatch: storeDispatch,
        fftVisualizerMachine,
        manualVisualizerPaused,
        setManualVisualizerPaused,
        selectedSourceId,
        selectionIntentSourceId,
        pendingSourceSwitchId,
        setSelectedSourceId,
        selectedSource,
        selectedSourceDerived,
        effectiveFrames,
        effectiveSdrSettings,
        sampleRateHzEffective,
        signalAreaBounds,
        wsConnection,
        toggleVisualizerPause,
        setVisualizerPause,
        cryptoCorrupted,
        deviceName,
        deviceProfile,
        sources: effectiveWebsocketSources,
      }),
      [
        mergedState,
        storeDispatch,
        fftVisualizerMachine,
        manualVisualizerPaused,
        selectedSourceId,
        selectionIntentSourceId,
        pendingSourceSwitchId,
        selectedSource,
        selectedSourceDerived,
        effectiveFrames,
        effectiveSdrSettings,
        sampleRateHzEffective,
        signalAreaBounds,
        wsConnection,
        toggleVisualizerPause,
        setVisualizerPause,
        cryptoCorrupted,
        deviceName,
        deviceProfile,
        effectiveWebsocketSources,
      ],
    );

    return (
      <SpectrumStoreContext.Provider value={value}>
        {children}
      </SpectrumStoreContext.Provider>
    );
  },
);

export const SpectrumProvider: React.FC<SpectrumProviderProps> = ({
  children,
  mockValue,
}) => {
  if (mockValue) {
    return (
      <SpectrumStoreContext.Provider value={mockValue}>
        {children}
      </SpectrumStoreContext.Provider>
    );
  }
  return <SpectrumProviderReal>{children}</SpectrumProviderReal>;
};
