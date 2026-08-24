import React, {
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FFTAndWaterfall } from "@n-apt/spectrum";
import { NoteCards } from "@n-apt/learn";
import type { FFTCanvasHandle } from "@n-apt/spectrum";
import FFTPlaybackCanvas from "@n-apt/spectrum/FFTPlaybackCanvas";
import { EditableCenterFrequency } from "@n-apt/ui/EditableCenterFrequency";
import { FrequencyInput } from "@n-apt/ui/FrequencyInput";
import type { CanvasPlaceholderState } from "@n-apt/ui/CanvasPlaceholder";
import { useSnapshot } from "@n-apt/capture/hooks/useSnapshot";
import type {
  DeviceProfile,
  FrequencyRange,
} from "@n-apt/consts/schemas/websocket";
import type { TemporalResolution } from "@n-apt/math/temporalResolution";

import {
  InitializingContainer,
  InitializingTitle,
  InitializingText,
} from "@n-apt/app/Layout";
import { useSpectrumStore } from "@n-apt/spectrum/hooks/useSpectrumStore";
import {
  getLiveFrameRefForSource,
  subscribeFrameRuntime,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { buildSdrLimitMarkers } from "@n-apt/math/sdrLimitMarkers";
import { getSourceViewStorageKeyForSource } from "@n-apt/spectrum/public/sourcePersistence";
import { isMockTxSource } from "@n-apt/app/infrastructure/services/deviceCapabilities";
import { getSettingsDefaults } from "@n-apt/settings/public/settingsDefaults";
import {
  getVisualizerLifecycleKey,
  resolveWebGpuStreamTransition,
} from "@n-apt/app/infrastructure/visualization/webgpuStreamReset";
import { presentationController } from "@n-apt/redux/middleware/websocketMiddleware";
import { createDeviceOptionScheduler } from "@n-apt/app/infrastructure/streams/deviceOptionScheduler";
import { calculateCenterFrequency } from "@n-apt/math/centerFrequency";
import {
  useSnapshotListener,
  buildSnapshotSettingsLabel,
} from "@n-apt/capture/hooks/useSnapshotListener";
import { useDeviceConnectionState } from "@n-apt/app/hooks/useDeviceConnectionState";
import { useCaptureWholeChannelSegments } from "@n-apt/capture/hooks/useCaptureWholeChannelSegments";
import { useGeolocation } from "@n-apt/maps/public/useGeolocation";
import { reverseGeocodeSnapshotLocation } from "@n-apt/capture/snapshotLocation";

import {
  useAppSelector,
  useAppDispatch,
  createNoteCardFromSpectrum,
  selectNoteCardsCollapsed,
  setNoteCardsCollapsed,
  setTxCenterFrequencyHz,
  setTxGeometry,
  setTxSampleRateHz,
  setTxPowerDbm,
  setShowTxSlider,
  setDeviceKind,
  setFrequencyRange,
  setStitchStatus,
  resetWaterfallCleared,
  setVizZoom as setVizZoomAction,
  setVizZoomFloor as setVizZoomFloorAction,
  setVizPan as setVizPanAction,
  setVizZoomFloorPan,
  setFftDbLimits,
  setSdrSettingsBundle,
  setTxHopPreviewState,
  selectSourceTransportSnapshot,
} from "@n-apt/redux";
import { selectTxHopChannels } from "@n-apt/redux/selectors/spectrumSelectors";
import {
  clampFrequencyRangeToBounds,
  buildCenteredFrequencyRange,
  getAvailableSpectrumBounds,
  normalizeFrequencyRangeToHz,
  resolveCenteredFrequencyHz,
  resolveMockTxMonitorCenterHz,
} from "@n-apt/math/frequency";
import {
  mapDisplayFrequencyToSource,
  resolveMirroredDisplayCenter,
  resolveMirroredTuning,
} from "@n-apt/math/basebandMirror";

export const resolveNavigationFrequencyBounds = ({
  mirrorEnabled,
  zoom,
  channelBounds,
  hardwareBounds,
}: {
  mirrorEnabled: boolean;
  zoom: number;
  channelBounds: FrequencyRange | null;
  hardwareBounds: FrequencyRange | null;
}): FrequencyRange | null => {
  if (mirrorEnabled || zoom > 1) return hardwareBounds;
  return channelBounds;
};

/** Publishes a discrete tuning command with local state before the device. */
export const publishFrequencyRangeImmediately = (
  range: FrequencyRange,
  setFrequencyRange: (range: FrequencyRange) => void,
  sendFrequencyRange: (range: FrequencyRange) => void,
): void => {
  setFrequencyRange(range);
  sendFrequencyRange(range);
};

/** Coalesces live pan publication without rerendering the spectrum every frame. */
export const createLiveFrequencyRangePublisher = (
  setFrequencyRange: (range: FrequencyRange) => void,
  sendFrequencyRange: (range: FrequencyRange) => void,
) => {
  const scheduler = createDeviceOptionScheduler<FrequencyRange>({
    publish: (range) => {
      setFrequencyRange(range);
      sendFrequencyRange(range);
    },
    equals: (left, right) =>
      left.min === right.min && left.max === right.max,
    intervalMs: 50,
    idleFlushMs: 80,
  });

  return {
    publish: (range: FrequencyRange) => scheduler.submit(range, "gesture"),
    flush: scheduler.flush,
    // React can run effect cleanup during Strict Mode's mount probe and then
    // reuse the same ref-backed publisher. Cancel timers without permanently
    // disposing the scheduler so the next gesture can still publish.
    cancel: scheduler.cancel,
  };
};

/** Publishes a live pan target without a lifecycle-owned coalescing queue. */
export const publishLiveFrequencyRange = (
  range: FrequencyRange,
  setFrequencyRange: (range: FrequencyRange) => void,
  sendFrequencyRange: (range: FrequencyRange) => void,
): void => {
  publishFrequencyRangeImmediately(range, setFrequencyRange, sendFrequencyRange);
};

/**
 * Visual pan is subscriber-local. It changes the viewport, not the device's
 * acquisition window, so it must never emit a shared frequency command.
 */
export const publishSubscriberLocalVizPan = (
  pan: number,
  setVizPanOffset: (pan: number) => void,
): void => {
  setVizPanOffset(pan);
};
import { resolveCanonicalDisplaySampleRateHz } from "@n-apt/app/infrastructure/io/sdrSampleRateGuards";
import { getZoomedViewForCenterFrequency } from "@n-apt/spectrum/public/visualizationZoom";
import {
  getLatestLiveFrame,
  resolveFrameReadiness,
  resolveLiveDevicePlaceholderState,
} from "@n-apt/app/infrastructure/visualization/liveSourcePresentation";
import {
  isSourcePresentationConnected,
  resolveSourceModeManagement,
} from "@n-apt/app/infrastructure/streams/sourceModeManagement";
import {
  resolveMockTxPreviewViewCenterHz,
  resolveMockTxTransmitSettings,
  resolveTxPreviewCenterHz,
  resolveTxSliderCenterHz,
  shouldJumpTxMonitor,
} from "@n-apt/transmit/public/txSliderPlacement";
import {
  attachLiveSourceLifecyclePlaceholder,
  hasPlayedOnceForSource,
  isCurrentSourceFrameReady,
  isCommittedStandbyPresentation,
  isLiveSourceAwaitingFrame,
  isLiveSourceHandoffPending,
  isTxSuiteBoundToSelection,
  resolveLiveSourceHandoffPending,
  resolveLiveSourceLifecycleErrorReason,
  resolveSelectedSourceTxPresentationFlags,
  resolveSelectedSourceTxStatusFlags,
  selectedSourceOwnsPaintableFrame,
  shouldRequestMockTxStandbyPreview,
  shouldPresentMockTxStandby,
  selectSourceFrameReadinessForMode,
  selectSourceTransportForMode,
  useLiveSourceLifecycle,
} from "@n-apt/spectrum/hooks/liveSourceLifecycle";
import { requestNextPausedFrame } from "@n-apt/redux/thunks/websocketThunks";
import {
  getMockTxPreviewRequestKey,
  resolveMockTxMonitorSampleRateForView,
  resolveTxStandbyPreviewTransport,
  shouldClearMockTxPreviewRequestDedupe,
} from "./spectrum/mockTxPreview";
import {
  FFTBackButton,
  FastSnapshotDivider,
  HeaderActionSpacer,
  NotesSnapshotButton,
  NotesSnapshotLabel,
  NotesSnapshotPill,
  SpectrumContainer,
  SpectrumContent,
  TxOptionsCard,
  TxOptionsGrid,
  TxOptionsShell,
  TxOptionsTitle,
  TxPowerField,
} from "./spectrum/SpectrumRouteControls";
import { useFastSnapshotControls } from "./spectrum/hooks/useFastSnapshotControls";
import { useTxHopPreview } from "./spectrum/hooks/useTxHopPreview";
import { useNoteViewHistory } from "./spectrum/hooks/useNoteViewHistory";
import {
  useFrequencyTuning,
  useTxMonitor,
} from "./spectrum/hooks/useLiveTuning";

// Kept as re-exports: tests import these helpers via this module.
export { resolveLiveDevicePlaceholderState } from "@n-apt/app/infrastructure/visualization/liveSourcePresentation";
export { getMockTxPreviewRequestKey } from "./spectrum/mockTxPreview";

const resolveTxSignalDisplayLabel = (signal: string) => {
  switch (signal) {
    case "d":
      return "D";
    case "wifi":
      return "Mock WiFi";
    case "d_sharp":
      return "D#";
    case "5g":
      return "Mock 5G";
    default:
      return signal.toUpperCase();
  }
};

interface SpectrumRouteProps {
  activeTab: "visualizer" | "analysis" | "draw";
  fftCanvasRef?: React.RefObject<FFTCanvasHandle | null>;
  onLoadingStateChange?: (isLoading: boolean) => void;
}

export const SpectrumRoute: React.FC<SpectrumRouteProps> = ({
  activeTab,
  fftCanvasRef: fftCanvasRefProp,
  onLoadingStateChange,
}) => {
  const localFftCanvasRef = useRef<FFTCanvasHandle | null>(null);
  const fftCanvasRef = fftCanvasRefProp ?? localFftCanvasRef;
  const [fftSnapshotLoading, setFftSnapshotLoading] = useState(false);
  const [isCenterFrequencyEditing, setIsCenterFrequencyEditing] =
    useState(false);
  const [isTxOptionsEditing, setIsTxOptionsEditing] = useState(false);
  const [hasPlayedAtLeastOnce, setHasPlayedAtLeastOnce] = useState(false);
  const [hasRenderableCurrentFrame, setHasRenderableCurrentFrame] =
    useState(false);
  const [playedSourceId, setPlayedSourceId] = useState<string | null>(null);
  const txOptionsRef = useRef<HTMLDivElement | null>(null);
  const txSignal = useAppSelector((state) => state.spectrum.txSignal || "wifi");
  const allowNegativeFrequencies = useAppSelector(
    (state) => state.settings.mirrorIqBasebandBelowZero,
  );
  const txSampleRateHz = useAppSelector(
    (state) => state.spectrum.txSampleRateHz,
  );
  const sharedFrequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const txCenterFrequencyHz = useAppSelector(
    (state) => state.spectrum.txCenterFrequencyHz,
  );
  const txPowerDbm = useAppSelector((state) => state.spectrum.txPowerDbm);
  const txIfftSize = useAppSelector((state) => state.spectrum.txIfftSize);
  const txHopType = useAppSelector(
    (state) => state.spectrum.txHopType || "range",
  );
  const txHopEnabled = useAppSelector(
    (state) => state.spectrum.txHopEnabled || false,
  );
  const txHopChannels = useAppSelector(selectTxHopChannels);
  const websocketChannels = useAppSelector((state) => state.websocket.channels);
  const showTxSlider = useAppSelector(
    (state) => state.spectrum.showTxSlider ?? true,
  );
  const deviceKind = useAppSelector((state) => state.spectrum.deviceKind);
  const {
    sourceStatuses,
    sourceTransport: legacySourceTransport,
    sourceTransportByMode,
    sourceFrameReadiness: legacySourceFrameReadiness,
    sourceFrameReadinessByMode,
  } = useAppSelector(selectSourceTransportSnapshot);
  const connectionStatus = useAppSelector(
    (state) => state.websocket.connectionStatus,
  );
  const hasConnectedOnce = useAppSelector(
    (state) => state.websocket.hasConnectedOnce,
  );
  const getTxSliderDefaults = useCallback(
    (
      range: FrequencyRange,
      fallbackCenterHz: number,
      centerOverrideHz?: number,
    ) => {
      const visibleMinHz = Number.isFinite(range.min) ? range.min : 0;
      const visibleMaxHz =
        Number.isFinite(range.max) && range.max > visibleMinHz
          ? range.max
          : visibleMinHz + 1;
      const visibleSpanHz = visibleMaxHz - visibleMinHz;
      const sampleRateHz = Number.isFinite(txSampleRateHz)
        ? Math.max(1, txSampleRateHz)
        : Math.max(1, Math.min(120_000, visibleSpanHz));
      const centerHz = resolveTxSliderCenterHz({
        centerHz: centerOverrideHz ?? txCenterFrequencyHz,
        fallbackCenterHz,
        visibleMinHz,
        visibleMaxHz,
        sampleRateHz,
      });

      return {
        visibleMinHz,
        visibleMaxHz,
        centerHz,
        sampleRateHz,
      };
    },
    [txCenterFrequencyHz, txSampleRateHz],
  );
  const notesCollapsed = useAppSelector(selectNoteCardsCollapsed);
  const reduxDispatch = useAppDispatch();
  const {
    state,
    dispatch,
    fftVisualizerMachine,
    manualVisualizerPaused,
    effectiveSdrSettings,
    signalAreaBounds,
    selectedSourceId,
    selectedSource,
    selectedSourceDerived,
    wsConnection: {
      isConnected,
      activeSourceId,
      backend,
      deviceInfo,
      deviceName,
      deviceProfile,
      dataRef: wsDataRef,
      maxSampleRateHz,
      sendFrequencyRange,
      captureStatus,
      sdrLimitMarkers,
      sources,
      sendTransmitStatus,
    },
    sampleRateHzEffective,
    toggleVisualizerPause,
  } = useSpectrumStore();
  const streamingSource = useMemo(
    () =>
      sources.find((source) => source.id === activeSourceId) ??
      selectedSource ??
      null,
    [activeSourceId, selectedSource, sources],
  );
  const streamingSourceId = streamingSource?.id ?? selectedSourceId;
  // Selection is the presentation target. The active transport remains the
  // fallback owner for untagged binary frames until the source commit lands.
  const expectedVisualizerSourceId =
    selectedSourceId || streamingSourceId || null;
  const [acceptedFrameSampleRateHz, setAcceptedFrameSampleRateHz] = useState<
    number | null
  >(null);
  const previousLiveSourceIdRef = useRef<string | null>(
    streamingSourceId || null,
  );
  const hasInitializedLiveSourceRef = useRef(false);
  const isSelectedMockTxSource =
    isConnected &&
    (selectedSource?.capabilities?.supports_tx_monitor === true ||
      isMockTxSource({
        id: selectedSource?.id ?? selectedSourceId,
        kind: selectedSource?.kind,
      }));
  const selectedSourceStatus =
    state.sourceMode === "live" && selectedSourceId
      ? (sourceStatuses?.[selectedSourceId] ?? selectedSource?.status ?? null)
      : (selectedSource?.status ?? null);
  const txSuiteSourceId = useAppSelector(
    (state) => state.sourceRouting?.bindings?.["tx-suite:tx"] ?? null,
  );
  const selectedSourceModeManagement = resolveSourceModeManagement({
    source: selectedSource
      ? { ...selectedSource, status: selectedSourceStatus }
      : null,
    txBindingSourceId: txSuiteSourceId,
  });
  const isSelectedSourceTxMode = selectedSourceModeManagement.isTxMode;
  const selectedStreamMode = isSelectedSourceTxMode ? "tx" : "rx";
  const sourceTransport = selectSourceTransportForMode(
    selectedStreamMode,
    sourceTransportByMode,
    legacySourceTransport,
  );
  const sourceFrameReadiness = selectSourceFrameReadinessForMode(
    selectedStreamMode,
    sourceFrameReadinessByMode,
    legacySourceFrameReadiness,
  );
  const expectedLegacyStreamEpoch =
    sourceTransport?.phase === "ready"
      ? null
      : (streamingSource?.stream_epoch ?? null);
  const dataRef =
    wsDataRef ??
    getLiveFrameRefForSource(
      selectedSourceId || activeSourceId,
      isSelectedSourceTxMode ? "tx" : "rx",
    );
  // Track the painted frame's owner through state instead of reading the
  // mutable frame ref during render (a stale-read hazard). The shared
  // low-frequency clock polls the ref; setState bails out unless the owner
  // actually changed, so this costs nothing while a single source streams.
  const [presentedStreamSourceId, setPresentedStreamSourceId] = useState<
    string | null
  >(null);
  useEffect(() => {
    return subscribeFrameRuntime(() => {
      const latest = getLatestLiveFrame(dataRef.current)?.source_id ?? null;
      setPresentedStreamSourceId((previous) =>
        previous === latest ? previous : latest,
      );
    }, 50);
  }, [dataRef]);
  // supports_tx_monitor is a capability, not the current mode. The Tx
  // monitor pipeline must only be active after an explicit Tx-mode switch.
  const isMockTxMonitorActive =
    isSelectedMockTxSource &&
    (isSelectedSourceTxMode || selectedSource?.kind === "mock_tx");
  const { isSelectedTxPreviewStandby } = resolveSelectedSourceTxPresentationFlags(
    {
      txSuiteBoundToSelection: isTxSuiteBoundToSelection({
        boundTxSourceId: txSuiteSourceId,
        selectedSourceId,
      }),
      selectedSourceStatus,
      isSelectedSourceTxMode,
      canTransmit: selectedSourceModeManagement.canTransmit,
    },
  );
  const [webGpuStreamResetEpoch, setWebGpuStreamResetEpoch] = useState(0);
  const previousWebGpuStreamIdentityRef = useRef<{
    sourceId: string | null;
    status: string | null;
    selectedSourceId: string | null;
  } | null>(null);
  useLayoutEffect(() => {
    // Track both identities so source selection remains distinguishable from a
    // same-source reconnect. Selection already changes the lifecycle key.
    const nextIdentity = {
      sourceId: activeSourceId || null,
      status: selectedSourceStatus,
      selectedSourceId: selectedSourceId || null,
    };
    const prevIdentity = previousWebGpuStreamIdentityRef.current;
    const transition = resolveWebGpuStreamTransition(
      prevIdentity,
      nextIdentity,
    );

    if (transition.clearLiveFrame) {
      // The mutable frame ref bypasses Redux for performance, so clear it at
      // the same source boundary as the GPU presentation cache. A source
      // switch is an ownership boundary; retaining the previous paused frame
      // here creates a one-paint flash before the target frame arrives.
      dataRef.current = null;
      if (transition.advanceResetEpoch) {
        fftVisualizerMachine?.discardNextPersist?.(
          getSourceViewStorageKeyForSource(streamingSource),
        );
      }
    }
    if (transition.advanceResetEpoch) {
      setWebGpuStreamResetEpoch((epoch) => epoch + 1);
    }
    previousWebGpuStreamIdentityRef.current = nextIdentity;
  }, [
    dataRef,
    fftVisualizerMachine,
    selectedSourceStatus,
    activeSourceId,
    streamingSource,
    streamingSourceId,
    selectedSourceId,
  ]);
  const isSelectedMockTxTransmitting =
    isSelectedMockTxSource && selectedSourceStatus === "transmitting";
  const isSelectedMockTxPaused =
    manualVisualizerPaused || selectedSource?.paused === true;
  const shouldShowMockTxStandby =
    shouldPresentMockTxStandby({
      isSelectedMockTxSource: isMockTxMonitorActive,
      isSelectedMockTxTransmitting,
      isSelectedMockTxPaused,
      selectedSourceId,
      transportSourceId: sourceTransport?.sourceId ?? null,
      transportPhase: sourceTransport?.phase ?? "idle",
    }) || isSelectedTxPreviewStandby;
  const {
    isSelectedSourceTxStandby,
    isSelectedSourceTxStatus,
  } = resolveSelectedSourceTxStatusFlags({
    transportReportedStatus: selectedSourceStatus,
    sourceRecordedStatus: selectedSource?.status ?? null,
    isSelectedTxPreviewStandby,
  });
  const standbyPresentationSourceId =
    selectedSourceId || selectedSource?.id || streamingSourceId || null;
  // A standby request may be issued before the source switch commits. The
  // visible bar and canvas must wait for the same ownership boundary. During
  // initial discovery the selected source object can be available before the
  // Redux selection id, so use that source identity for the first commit.
  const isStandbyPresentationActive = isCommittedStandbyPresentation({
    requested: shouldShowMockTxStandby || isSelectedSourceTxStandby,
    selectedSourceId: standbyPresentationSourceId,
    activeSourceId,
    presentedSourceId: presentedStreamSourceId,
    isTransmitting: isSelectedMockTxTransmitting,
  });
  const hasTargetFrozenFrame = selectedSourceId
    ? isSelectedSourceTxMode
      ? presentationController.getFrozenFrame(selectedSourceId, "tx") !== null
      : presentationController.getFrozenFrame(selectedSourceId, "rx") !==
          null ||
        presentationController.getSlot(selectedSourceId, "rx")?.phase ===
          "paused"
    : false;
  const liveSourceHandoffPending = resolveLiveSourceHandoffPending({
    selectedSourceId,
    activeSourceId,
    transportPhase: sourceTransport?.phase ?? "idle",
  });
  const liveSourceLifecycle = useLiveSourceLifecycle({
    isLive: state.sourceMode === "live",
    isConnected,
    connectionStatus,
    hasConnectedOnce,
    sourceHandoffPending: liveSourceHandoffPending,
    selectedSourceId: selectedSourceId || null,
    activeSourceId: activeSourceId || null,
    transportSourceId: sourceTransport?.sourceId ?? null,
    transportPhase: sourceTransport?.phase ?? "idle",
    transportError: sourceTransport?.error ?? null,
    readinessSequence: sourceFrameReadiness?.sequence ?? null,
    readiness: sourceFrameReadiness,
    presentedSourceId: presentedStreamSourceId,
    // Never treat a previous source's "played once" flag as a Mock Tx frame.
    // That skipped awaiting-frame Loading and left a black FFT under STANDBY
    // on first Rx→Tx and on cold reload into Mock Tx before request_next_frame.
    hasValidFrame: selectedSourceOwnsPaintableFrame({
      hasTargetFrozenFrame,
      currentSourceFrameReady: isCurrentSourceFrameReady({
        selectedSourceId: selectedSourceId || null,
        activeSourceId: activeSourceId || null,
        expectedStreamEpoch: expectedLegacyStreamEpoch,
        readiness: sourceFrameReadiness,
      }),
      hasRenderableCurrentFrame,
      hasPlayedOnceForSelectedSource: hasPlayedOnceForSource({
        hasPlayedAtLeastOnce,
        playedSourceId,
        streamingSourceId,
      }),
    }),
    deviceStatus: selectedSourceStatus,
    isStandby: isStandbyPresentationActive,
  });
  const isSwitchingLiveSource = isLiveSourceHandoffPending(liveSourceLifecycle);
  const isSourceHandoffOverlayPending =
    !hasTargetFrozenFrame && isLiveSourceAwaitingFrame(liveSourceLifecycle);
  // Use selectedSourceId for the reset key so it changes when user selects a new source,
  // even before it becomes the active streaming source. This ensures GPU state resets
  // during the loading phase when switching from mock to hardware.
  const visualizerLifecycleKey = getVisualizerLifecycleKey({
    epoch: webGpuStreamResetEpoch,
  });
  const visualizerSessionKey = useMemo(
    () => getSourceViewStorageKeyForSource(selectedSource ?? streamingSource),
    [selectedSource, streamingSource],
  );
  const fftDeviceProfile =
    selectedSourceDerived.deviceProfile ??
    deviceProfile ??
    (selectedSource?.kind
      ? ({ kind: selectedSource.kind } as DeviceProfile)
      : null);
  // Keep the monitor controls mounted through the standby -> transmitting
  // transition. During that transition the selected-source mode can briefly
  // lag the source status, which otherwise makes the IQ/slider disappear.
  const isSelectedSourceTransmitting =
    selectedSourceStatus === "transmitting" ||
    sources.some(
      (source) =>
        (sourceStatuses?.[source.id] ?? source.status) === "transmitting",
    );
  const isFixedTxPreview =
    isMockTxMonitorActive &&
    isSelectedSourceTxStatus &&
    !isSelectedSourceTransmitting;
  const canShowTxSlider =
    isSelectedSourceTxMode ||
    isSelectedSourceTxStatus ||
    isSelectedSourceTransmitting;
  useEffect(() => {
    if (
      state.sourceMode === "live" &&
      isSelectedSourceTxStatus &&
      !showTxSlider
    ) {
      reduxDispatch(setShowTxSlider(true));
    }
  }, [isSelectedSourceTxStatus, reduxDispatch, showTxSlider, state.sourceMode]);
  const effectiveTunerGainDb = useMemo(() => {
    const gainConfig = effectiveSdrSettings?.gain;
    const gainObject =
      gainConfig && typeof gainConfig === "object" ? gainConfig : null;
    return gainObject ? (gainObject.tuner_gain ?? 0) : 0;
  }, [effectiveSdrSettings?.gain]);

  const handleVisualizerLoadingStateChange = useCallback(
    (isLoading: boolean) => {
      setFftSnapshotLoading(isLoading);
      onLoadingStateChange?.(isLoading);
    },
    [onLoadingStateChange],
  );

  const vizZoom = useAppSelector((reduxState) => reduxState.spectrum.vizZoom);
  const vizZoomFloor = useAppSelector(
    (reduxState) => reduxState.spectrum.vizZoomFloor,
  );
  const vizPanOffset = useAppSelector(
    (reduxState) => reduxState.spectrum.vizPanOffset,
  );
  const setVizZoom = useCallback(
    (zoom: number) => reduxDispatch(setVizZoomAction(zoom)),
    [reduxDispatch],
  );
  const setVizZoomFloor = useCallback(
    (zoomFloor: number) => reduxDispatch(setVizZoomFloorAction(zoomFloor)),
    [reduxDispatch],
  );
  const setVizPanOffset = useCallback(
    (pan: number) => reduxDispatch(setVizPanAction(pan)),
    [reduxDispatch],
  );
  // Stable dispatch wrappers: the canvases are memoized, so fresh inline
  // arrows here would defeat memoization on every route render.
  const handleVizZoomFloorPanChange = useCallback(
    (pan: number) => reduxDispatch(setVizZoomFloorPan(pan)),
    [reduxDispatch],
  );
  const handleFftDbLimitsChange = useCallback(
    (min: number, max: number) => reduxDispatch(setFftDbLimits({ min, max })),
    [reduxDispatch],
  );
  const handleResetWaterfallCleared = useCallback(
    () => reduxDispatch(resetWaterfallCleared()),
    [reduxDispatch],
  );
  const handleOpenCenterFrequencyEditor = useCallback(
    () => setIsCenterFrequencyEditing(true),
    [],
  );
  const handleStitchStatusChange = useCallback(
    (status: string) => reduxDispatch(setStitchStatus(status)),
    [reduxDispatch],
  );
  const handleNoopSnapshot = useCallback(() => {}, []);
  const hardwareSpectrumBounds = useAppSelector(
    (reduxState) => reduxState.demod.hardwareRange,
  );
  const activeSignalAreaBounds =
    signalAreaBounds?.[state.activeSignalArea] ??
    signalAreaBounds?.[state.activeSignalArea?.toLowerCase?.()] ??
    null;
  const limitMarkers = useMemo(
    () => buildSdrLimitMarkers(sdrLimitMarkers),
    [sdrLimitMarkers],
  );
  // themeState removed — FFTCanvas now handles theme reactivity internally

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }, [activeTab]);

  useEffect(() => {
    const nextDeviceKind = fftDeviceProfile?.kind ?? null;
    if (!nextDeviceKind) return;
    reduxDispatch(setDeviceKind(nextDeviceKind));
  }, [reduxDispatch, fftDeviceProfile?.kind]);

  // Device connection state management
  useDeviceConnectionState({
    deviceState: selectedSourceDerived.deviceState || "disconnected",
    showSpikeOverlay: state.showSpikeOverlay,
    dispatch,
  });

  const {
    handleSnapshot: takeSnapshot,
    isRecording,
    recordingCountdown,
    supportedVideoFormat,
    startFastRecording,
    stopFastRecording,
    takeFastSnapshot,
  } = useSnapshot(state.frequencyRange ?? null, isConnected);

  const getCanvases = useCallback(() => {
    if (!fftCanvasRef.current) return null;
    return {
      spectrumGpu: fftCanvasRef.current.getSpectrumCanvas(),
      spectrumOverlay: fftCanvasRef.current.getSpectrumOverlayCanvas(),
      waterfallGpu: fftCanvasRef.current.getWaterfallCanvas(),
      waterfallOverlay: fftCanvasRef.current.getWaterfallOverlayCanvas(),
    };
  }, [fftCanvasRef]);

  const { fastSpectrumSnapshotAction, fastWaterfallSnapshotAction } =
    useFastSnapshotControls({
      fftCanvasRef,
      fftSnapshotLoading,
      isRecording,
      recordingCountdown,
      supportedVideoFormat,
      takeFastSnapshot,
      startFastRecording,
      stopFastRecording,
      getCanvases,
      effectiveSdrSettings,
      deviceKind,
      deviceProfileKind: deviceProfile?.kind,
      selectedSourceDeviceProfileKind: selectedSourceDerived.deviceProfile?.kind,
      selectedSourceDeviceName: selectedSourceDerived.deviceName,
      deviceName,
      isConnected,
      activeSignalArea: state.activeSignalArea,
      activeSignalAreaBounds,
      signalAreaBounds,
      gain: state.gain,
      ppm: state.ppm,
      hackrfLnaGain: state.hackrfLnaGain,
      hackrfVgaGain: state.hackrfVgaGain,
      hackrfAmpEnabled: state.hackrfAmpEnabled,
      hackrfBasebandBandwidth: state.hackrfBasebandBandwidth,
      fftSize: state.fftSize,
    });

  const handleCreateNoteCard = useCallback(() => {
    const snapshotData = fftCanvasRef.current?.getSnapshotData() ?? null;
    const snapshot = fftCanvasRef.current?.getCompositeSnapshot() ?? null;
    reduxDispatch(setNoteCardsCollapsed(false));
    void reduxDispatch(
      createNoteCardFromSpectrum({
        snapshot,
        stats: snapshotData
          ? {
              centerFrequencyHz: snapshotData.centerFrequencyHz,
              frequencyRange: snapshotData.frequencyRange,
            }
          : undefined,
      }),
    );
  }, [fftCanvasRef, reduxDispatch]);

  const notesActionPill = useMemo<ReactNode>(
    () => (
      <NotesSnapshotPill>
        <NotesSnapshotLabel>Notes</NotesSnapshotLabel>
        <FastSnapshotDivider />
        <NotesSnapshotButton
          type="button"
          onClick={handleCreateNoteCard}
          title="Create a note from the current spectrum"
        >
          New
        </NotesSnapshotButton>
        <FastSnapshotDivider />
        <NotesSnapshotButton
          type="button"
          onClick={() => reduxDispatch(setNoteCardsCollapsed(!notesCollapsed))}
          title={notesCollapsed ? "Show saved notes" : "Hide saved notes"}
        >
          {notesCollapsed ? "Show Notes" : "Hide Notes"}
        </NotesSnapshotButton>
      </NotesSnapshotPill>
    ),
    [handleCreateNoteCard, notesCollapsed, reduxDispatch],
  );

  const captureWholeChannelSegments = useCaptureWholeChannelSegments({
    frequencyRange: state.frequencyRange,
    sourceMode: state.sourceMode,
    sampleRateHzEffective,
    activeSignalArea: state.activeSignalArea,
    signalAreaBounds,
    fftFrameRate: state.fftFrameRate,
    vizPanOffset: state.vizPanOffset,
    vizZoom: state.vizZoom,
    sendFrequencyRange,
    fftCanvasRef,
  });

  // Snapshot listener for sidebar events
  useSnapshotListener({
    takeSnapshot: (options) => takeSnapshot(options).catch(console.error),
    snapshotGridPreference: state.snapshotGridPreference,
    signalAreaBounds,
    activeSignalArea: state.activeSignalArea,
    sourceMode: state.sourceMode,
    backend: selectedSourceDerived.backend ?? backend ?? undefined,
    deviceInfo: selectedSourceDerived.deviceInfo ?? deviceInfo ?? undefined,
    effectiveSdrSettings: effectiveSdrSettings ?? undefined,
    gain: state.gain,
    ppm: state.ppm,
    hackrfLnaGain: state.hackrfLnaGain,
    hackrfVgaGain: state.hackrfVgaGain,
    hackrfAmpEnabled: state.hackrfAmpEnabled,
    hackrfBasebandBandwidth: state.hackrfBasebandBandwidth ?? undefined,
    deviceName: selectedSourceDerived.deviceName ?? deviceName ?? undefined,
    deviceProfile:
      selectedSourceDerived.deviceProfile ?? deviceProfile ?? undefined,
    fftFrameRate: state.fftFrameRate,
    captureWholeChannelSegments,
    getSnapshotData: () => fftCanvasRef.current?.getSnapshotData() ?? undefined,
    getVideoSourceCanvases: () => {
      const spectrumCanvas = fftCanvasRef.current?.getSpectrumCanvas() ?? null;
      const spectrumOverlayCanvas =
        fftCanvasRef.current?.getSpectrumOverlayCanvas() ?? null;
      const waterfallCanvas =
        fftCanvasRef.current?.getWaterfallCanvas() ?? null;
      return {
        spectrum: spectrumCanvas,
        spectrumOverlay: spectrumOverlayCanvas,
        waterfall: waterfallCanvas,
      };
    },
    refreshVideoFrame: () => {
      fftCanvasRef.current?.triggerSnapshotRender();
    },
    prepareVideoRecording: () => {
      const wasPaused = manualVisualizerPaused;
      if (!wasPaused) {
        return undefined;
      }

      toggleVisualizerPause();
      return () => {
        toggleVisualizerPause();
      };
    },
  });

  const transmittingTxSource = useMemo(
    () =>
      sources.find((source) => {
        const capability = source.capability?.toLowerCase?.() ?? "";
        const status = sourceStatuses?.[source.id] ?? source.status;
        return (
          status === "transmitting" &&
          (source.capabilities?.supports_tx_monitor === true ||
            capability === "tx" ||
            capability === "tx_rx")
        );
      }) ?? null,
    [sourceStatuses, sources],
  );

  const handleRenderableLiveFrameChange = useCallback(
    (hasCanvasFrame: boolean) => {
      if (!hasCanvasFrame) return;
      const latestFrame = getLatestLiveFrame(dataRef.current);
      const isReady = resolveFrameReadiness({
        frame: latestFrame,
        selectedSourceId: expectedVisualizerSourceId,
        activeSourceId: activeSourceId || streamingSourceId || null,
        expectedStreamEpoch: expectedLegacyStreamEpoch,
        frameCounter: latestFrame?.source_id ? 1 : 0,
        handoffStartedFrameCounter: 0,
      });
      if (!isReady) return;

      setHasRenderableCurrentFrame(true);
      setHasPlayedAtLeastOnce(true);
      setPlayedSourceId(streamingSourceId || null);
      const sampleRate = latestFrame?.sample_rate;
      if (
        typeof sampleRate === "number" &&
        Number.isFinite(sampleRate) &&
        sampleRate > 0
      ) {
        setAcceptedFrameSampleRateHz((current) =>
          current === sampleRate ? current : sampleRate,
        );
      }
    },
    [
      activeSourceId,
      dataRef,
      expectedLegacyStreamEpoch,
      expectedVisualizerSourceId,
      streamingSource?.stream_epoch,
      streamingSourceId,
    ],
  );

  const centerFrequencyHz = useMemo(() => {
    return calculateCenterFrequency(state.frequencyRange);
  }, [state.frequencyRange]);

  // Late-wired tune handler: the monitor hook runs before the tuner because
  // the tuner needs applyTxMonitorForRange; the tuner's handler reaches the
  // monitor through this ref.
  const frequencyRangeChangerRef = useRef<
    (
      range: FrequencyRange,
      source?: "user-pan" | "mode-enter" | "typed",
    ) => void
  >(() => {});
  const {
    mockMonitorCenterHz,
    setMockMonitorCenterHz,
    setTxMonitorDetached,
    isDraggingTxRef,
    txMonitorDetached,
    applyTxMonitorForRange,
    jumpMonitorToTx,
    syncMockTxSettingsFromSlider,
    handleCenterFrequencyChangeFromSlider,
  } = useTxMonitor({
    isMockTxMonitorActive,
    isConnected,
    isSwitchingLiveSource,
    isSelectedMockTxTransmitting,
    selectedSourceId,
    selectedSource,
    sendTransmitStatus,
    frequencyRange: state.frequencyRange ?? null,
    txSampleRateHz,
    txPowerDbm,
    txSignal,
    txIfftSize,
    txCenterFrequencyHz,
    centerFrequencyHz,
    transmittingTxSource,
    reduxDispatch,
    frequencyRangeChangerRef,
  });
  const { handleFrequencyRangeChange } = useFrequencyTuning({
    allowNegativeFrequencies,
    hardwareSpectrumBounds,
    activeSignalAreaBounds,
    sampleRateHzEffective,
    getAvailableSpectrumBounds,
    frequencyRange: state.frequencyRange ?? null,
    vizZoom: state.vizZoom,
    sourceMode: state.sourceMode,
    vizPanOffset: state.vizPanOffset,
    autoZoomStability: state.autoZoomStability,
    vizZoomFloor: state.vizZoomFloor,
    reduxDispatch,
    sendFrequencyRange,
    applyTxMonitorForRange,
    setVizPanOffset,
  });
  frequencyRangeChangerRef.current = handleFrequencyRangeChange;

  const handleCenterFrequencyChange = useCallback(
    (nextCenterFrequencyHz: number) => {
      if (!state.frequencyRange) return;

      if (allowNegativeFrequencies && Number.isFinite(nextCenterFrequencyHz)) {
        const sourceSpan = state.frequencyRange.max - state.frequencyRange.min;
        const visualSpan = sourceSpan / Math.max(1, state.vizZoom);
        const mirrored = resolveMirroredDisplayCenter({
          displayCenterHz: nextCenterFrequencyHz,
          displaySpanHz: visualSpan,
          sourceRange: state.frequencyRange,
        });
        if (mirrored.needsRetune) {
          handleFrequencyRangeChange(mirrored.range, "user-pan");
        }
        setVizPanOffset(mirrored.panOffsetHz);
        return;
      }

      const sourceCenterFrequencyHz = mapDisplayFrequencyToSource(
        nextCenterFrequencyHz,
      );

      if (
        Number.isFinite(sourceCenterFrequencyHz) &&
        sourceCenterFrequencyHz >= state.frequencyRange.min &&
        sourceCenterFrequencyHz <= state.frequencyRange.max &&
        (!hardwareSpectrumBounds ||
          (sourceCenterFrequencyHz >= hardwareSpectrumBounds.min &&
            sourceCenterFrequencyHz <= hardwareSpectrumBounds.max))
      ) {
        const nextView = getZoomedViewForCenterFrequency({
          hardwareRange: state.frequencyRange,
          currentZoom: state.vizZoom,
          currentPan: state.vizPanOffset,
          requestedCenterHz: sourceCenterFrequencyHz,
        });
        setVizZoom(nextView.zoom);
        setVizPanOffset(nextView.pan);
        if (isMockTxMonitorActive) {
          setMockMonitorCenterHz(nextCenterFrequencyHz);
          setTxMonitorDetached(true);
        }
        return;
      }

      const spanHz = state.frequencyRange.max - state.frequencyRange.min;
      handleFrequencyRangeChange(
        buildCenteredFrequencyRange(nextCenterFrequencyHz, spanHz, 0),
        "user-pan",
      );
    },
    [
      handleFrequencyRangeChange,
      allowNegativeFrequencies,
      hardwareSpectrumBounds,
      isMockTxMonitorActive,
      setVizPanOffset,
      setVizZoom,
      state.frequencyRange,
      state.vizPanOffset,
      state.vizZoom,
    ],
  );

  const {
    fftHistoryRef,
    fftHistoryVersion,
    handleViewNoteCard,
    handleBackFromNoteView,
    hasNoteViewHistory,
  } = useNoteViewHistory({
    state,
    reduxDispatch,
    handleFrequencyRangeChange,
  });

  const mockTxViewSampleRateHz = state.frequencyRange
    ? state.frequencyRange.max - state.frequencyRange.min
    : null;
  const mockTxMonitorSampleRateHz = isMockTxMonitorActive
    ? resolveMockTxMonitorSampleRateForView(
        mockTxViewSampleRateHz,
        state.sampleRateHz,
        sampleRateHzEffective,
        selectedSourceDerived.sdrSettings?.min_receive_sample_rate,
        effectiveSdrSettings?.min_receive_sample_rate,
        selectedSourceDerived.sampleRateHz,
        selectedSourceDerived.sdrSettings?.sample_rate,
        effectiveSdrSettings?.sample_rate,
      )
    : null;
  const mockTxMonitorFrequencyRange = useMemo(() => {
    if (
      !isMockTxMonitorActive ||
      !(sharedFrequencyRange ?? state.frequencyRange) ||
      !mockTxMonitorSampleRateHz
    ) {
      return null;
    }
    const activeFrequencyRange = sharedFrequencyRange ?? state.frequencyRange!;
    const fallbackCenterHz =
      (Number.isFinite(txCenterFrequencyHz) ? txCenterFrequencyHz : null) ??
      centerFrequencyHz ??
      (activeFrequencyRange.min + activeFrequencyRange.max) / 2;
    // Display window follows the monitor VFO, not the planned carrier. Slider
    // moves the carrier without jumping this center.
    const monitorCenterHz = resolveMockTxMonitorCenterHz(
      typeof mockMonitorCenterHz === "number" &&
        Number.isFinite(mockMonitorCenterHz)
        ? mockMonitorCenterHz
        : fallbackCenterHz,
      fallbackCenterHz,
    );
    return buildCenteredFrequencyRange(
      monitorCenterHz,
      mockTxMonitorSampleRateHz,
      0,
    );
  }, [
    centerFrequencyHz,
    isMockTxMonitorActive,
    mockTxMonitorSampleRateHz,
    mockMonitorCenterHz,
    sharedFrequencyRange,
    state.frequencyRange,
    txCenterFrequencyHz,
  ]);
  const previewVfoCenterHz = resolveTxPreviewCenterHz({
    previewCenterHz: mockMonitorCenterHz,
    txCenterHz: txCenterFrequencyHz,
    isPreview: isFixedTxPreview,
  });
  const fftFrequencyRange =
    mockTxMonitorFrequencyRange ?? sharedFrequencyRange ?? state.frequencyRange;
  const fftCenterFrequencyHz = mockTxMonitorFrequencyRange
    ? resolveMockTxMonitorCenterHz(previewVfoCenterHz, centerFrequencyHz ?? 0)
    : centerFrequencyHz;
  const fftHardwareSampleRateHz =
    mockTxMonitorSampleRateHz ??
    resolveCanonicalDisplaySampleRateHz({
      activeSampleRateHz: state.sampleRateHz,
      frameSampleRateHz: acceptedFrameSampleRateHz,
      configuredSampleRateHz:
        selectedSourceDerived.sdrSettings?.min_receive_sample_rate ??
        effectiveSdrSettings?.min_receive_sample_rate ??
        selectedSourceDerived.sdrSettings?.sample_rate ??
        effectiveSdrSettings?.sample_rate,
      maxSampleRateHz: selectedSourceDerived.maxSampleRateHz ?? maxSampleRateHz,
      derivedSampleRateHz: sampleRateHzEffective,
    }) ??
    undefined;
  const txSliderDefaults = fftFrequencyRange
    ? getTxSliderDefaults(
        fftFrequencyRange,
        previewVfoCenterHz ?? centerFrequencyHz ?? 0,
      )
    : null;

  const channelsList = useMemo(() => {
    const defaultChannels = [
      { label: "A", min: 18_000, max: 4_390_000 },
      { label: "B", min: 24_100_000, max: 30_370_000 },
      { label: "C", min: 4_750_000, max: 23_000_000 },
    ];
    if (websocketChannels && websocketChannels.length > 0) {
      return websocketChannels.map((ch) => ({
        label: ch.label,
        min: ch.min_hz,
        max: ch.max_hz,
      }));
    }
    return defaultChannels;
  }, [websocketChannels]);

  const effectiveRxSampleRate =
    sampleRateHzEffective ?? maxSampleRateHz ?? 3_200_000;
  const { activeHopTarget, hopPreviewIndex } = useTxHopPreview({
    txHopType,
    txHopEnabled,
    txHopChannels,
    websocketChannels,
    txSampleRateHz,
    txCenterFrequencyHz,
    effectiveRxSampleRate,
    isSelectedSourceTxMode,
    isSelectedMockTxTransmitting,
    reduxDispatch,
    setMockMonitorCenterHz,
  });

  const lastMockTxPreviewRequestKeyRef = useRef<string | null>(null);
  const lastMockTxPreviewRetryActiveIdRef = useRef<string | null>(null);
  const mockTxPreviewRequestKey = useMemo(() => {
    const reqCenter = activeHopTarget?.centerFrequencyHz ?? txCenterFrequencyHz;
    const reqViewCenter =
      activeHopTarget?.centerFrequencyHz ??
      resolveMockTxPreviewViewCenterHz({
        txCenterHz: txCenterFrequencyHz,
        monitorCenterHz: mockMonitorCenterHz,
        detached: txMonitorDetached,
      });
    const reqBandwidth = activeHopTarget?.bandwidthHz ?? txSampleRateHz;
    const viewSampleRateHz = activeHopTarget
      ? activeHopTarget.bandwidthHz
      : state.frequencyRange
        ? state.frequencyRange.max - state.frequencyRange.min
        : undefined;
    return (
      getMockTxPreviewRequestKey({
        sourceId: selectedSourceId,
        centerFrequencyHz: reqCenter,
        sampleRateHz: reqBandwidth,
        signal: txSignal,
        powerDbm: txPowerDbm,
        ifftSize: txIfftSize,
      }) +
      `|viewCenter:${reqViewCenter}|viewSpan:${viewSampleRateHz}|hop:${hopPreviewIndex}|active:${activeSourceId ?? ""}`
    );
  }, [
    activeSourceId,
    selectedSourceId,
    txIfftSize,
    txCenterFrequencyHz,
    txPowerDbm,
    txSampleRateHz,
    txSignal,
    mockMonitorCenterHz,
    txMonitorDetached,
    state.frequencyRange,
    activeHopTarget,
    hopPreviewIndex,
  ]);

  // Retry once per lifecycle/transport fence while the standby preview has no
  // frame. Mock Tx cold-start can publish before the Tx stream subscribes;
  // hardware half-duplex previews can lose the one-shot to the Rx→Tx stream
  // arbitration handoff. phase/active/transport advances must clear dedupe or
  // Loading sticks until a manual switch.
  useEffect(() => {
    const hardwareStandbyPreview =
      isSelectedTxPreviewStandby && !isMockTxMonitorActive;
    if (
      !shouldClearMockTxPreviewRequestDedupe({
        isMockTxMonitorActive: isMockTxMonitorActive || hardwareStandbyPreview,
        selectedSourceId,
        activeSourceId,
        hasRenderableFrame: hasRenderableCurrentFrame || hasTargetFrozenFrame,
        lifecyclePhase: liveSourceLifecycle.phase,
        transportPhase: sourceTransport?.phase ?? null,
        previousFence: lastMockTxPreviewRetryActiveIdRef.current,
      })
    ) {
      if (
        (!isMockTxMonitorActive && !hardwareStandbyPreview) ||
        hasRenderableCurrentFrame ||
        hasTargetFrozenFrame
      ) {
        lastMockTxPreviewRetryActiveIdRef.current = null;
      }
      return;
    }
    lastMockTxPreviewRetryActiveIdRef.current = `${selectedSourceId ?? ""}|${activeSourceId ?? ""}|${liveSourceLifecycle.phase}|${sourceTransport?.phase ?? ""}`;
    lastMockTxPreviewRequestKeyRef.current = null;
  }, [
    activeSourceId,
    hasRenderableCurrentFrame,
    hasTargetFrozenFrame,
    isMockTxMonitorActive,
    isSelectedTxPreviewStandby,
    liveSourceLifecycle.phase,
    selectedSourceId,
    sourceTransport?.phase,
  ]);

  useEffect(() => {
    const shouldRequestPreview =
      shouldRequestMockTxStandbyPreview({
        isSelectedMockTxSource: isMockTxMonitorActive,
        isSelectedMockTxTransmitting,
        isSelectedMockTxPaused,
        isConnected,
        phase: liveSourceLifecycle.phase,
      }) || isSelectedTxPreviewStandby;
    if (!shouldRequestPreview) {
      lastMockTxPreviewRequestKeyRef.current = null;
      return;
    }
    if (lastMockTxPreviewRequestKeyRef.current === mockTxPreviewRequestKey) {
      return;
    }
    lastMockTxPreviewRequestKeyRef.current = mockTxPreviewRequestKey;
    // Do not null dataRef here. Clearing before the one-shot preview arrives
    // leaves a black FFT under the standby top bar / Start Tx transition.
    // The canvas keeps the last painted graph until the replacement frame.

    const reqCenter = activeHopTarget?.centerFrequencyHz ?? txCenterFrequencyHz;
    const reqViewCenter =
      activeHopTarget?.centerFrequencyHz ??
      resolveMockTxPreviewViewCenterHz({
        txCenterHz: txCenterFrequencyHz,
        monitorCenterHz: mockMonitorCenterHz,
        detached: txMonitorDetached,
      });
    const reqBandwidth = activeHopTarget?.bandwidthHz ?? txSampleRateHz;
    const reqSampleRate = activeHopTarget
      ? activeHopTarget.bandwidthHz
      : state.frequencyRange
        ? state.frequencyRange.max - state.frequencyRange.min
        : undefined;

    // Every standby preview, including half-duplex hardware, must use the
    // source-owned one-shot request. The Tx-suite action establishes the
    // binding, but it does not produce a frame; leaving that action here
    // leaves the paused Rx frame on the canvas until the user starts Tx.
    if (
      resolveTxStandbyPreviewTransport({
        isSelectedTxPreviewStandby,
        isMockTxMonitorActive,
      }) === "one_shot"
    ) {
      reduxDispatch(
        requestNextPausedFrame({
          sourceId: selectedSourceId || "mock-tx",
          txSettings: {
            centerFrequencyHz: reqCenter,
            viewCenterHz: reqViewCenter,
            bandwidthHz: reqBandwidth,
            sampleRateHz: reqSampleRate,
            powerDbm: txPowerDbm,
            txSignal,
            txIfftSize,
          },
        }),
      );
    }
  }, [
    activeHopTarget,
    dataRef,
    isConnected,
    isMockTxMonitorActive,
    isSelectedSourceTransmitting,
    isSelectedSourceTxStatus,
    isSelectedMockTxPaused,
    isSelectedTxPreviewStandby,
    isSelectedMockTxTransmitting,
    isSwitchingLiveSource,
    liveSourceLifecycle.phase,
    mockMonitorCenterHz,
    mockTxPreviewRequestKey,
    reduxDispatch,
    selectedSourceId,
    state.frequencyRange,
    txCenterFrequencyHz,
    txIfftSize,
    txMonitorDetached,
    txPowerDbm,
    txSampleRateHz,
    txSignal,
  ]);

  // Keep the last painted frame available during handoff. FFTCanvas rejects
  // frames that do not match expectedSourceId, while its existing presentation
  // remains visible until the target frame arrives or loading exceeds grace.
  const fftDataRef = dataRef;
  const standbyPlaceholderState = useMemo<CanvasPlaceholderState | null>(() => {
    if (!isStandbyPresentationActive) {
      return null;
    }
    const presentedFrameSourceId = presentedStreamSourceId;
    const presentedFrameSource = presentedFrameSourceId
      ? sources.find((source) => source.id === presentedFrameSourceId)
      : null;
    return {
      kind: "top-bar",
      title: "Start Tx to transmit",
      sourceLabel:
        presentedFrameSource?.name ??
        presentedFrameSourceId ??
        selectedSource?.name ??
        selectedSourceDerived.deviceName ??
        "Mock Tx SDR",
      message: "Start Tx to view backend-generated monitor I/Q.",
    };
  }, [
    isStandbyPresentationActive,
    sources,
    selectedSource?.name,
    selectedSourceDerived.deviceName,
    presentedStreamSourceId,
  ]);
  const deviceRecoveryPlaceholderState =
    useMemo<CanvasPlaceholderState | null>(() => {
      const isHandoffInFlight =
        !!selectedSourceId &&
        selectedSourceId !== activeSourceId &&
        sourceTransport?.phase !== "failed";
      if (isHandoffInFlight) return null;

      const sourceLabel =
        selectedSourceDerived.deviceName ??
        selectedSourceDerived.backend ??
        "device";
      return resolveLiveDevicePlaceholderState({
        deviceState:
          selectedSourceDerived.deviceState ?? streamingSource?.status ?? null,
        sourceLabel,
        loadingAttempt: streamingSource?.loading_attempt,
        loadingAttemptMax: streamingSource?.loading_attempt_max,
        sourceId: streamingSource?.id,
        hasPlayedAtLeastOnce,
        hasRenderableCurrentFrame,
      });
    }, [
      selectedSourceId,
      activeSourceId,
      sourceTransport?.phase,
      streamingSource?.id,
      streamingSource?.loading_attempt,
      streamingSource?.loading_attempt_max,
      streamingSource?.status,
      selectedSourceDerived.backend,
      selectedSourceDerived.deviceName,
      selectedSourceDerived.deviceState,
      hasPlayedAtLeastOnce,
      hasRenderableCurrentFrame,
    ]);
  const sourceHandoffPlaceholderState =
    useMemo<CanvasPlaceholderState | null>(() => {
      if (!isSourceHandoffOverlayPending) return null;
      return {
        kind: "loading",
        paneLabel: "FFT",
        sourceLabel:
          selectedSource?.name ??
          selectedSourceDerived.deviceName ??
          streamingSource?.name ??
          "device",
        message: "Waiting for the first frame to arrive.",
      };
    }, [
      isSourceHandoffOverlayPending,
      selectedSource?.name,
      selectedSourceDerived.deviceName,
      streamingSource?.name,
    ]);
  const presentedLiveSourceLifecycle = useMemo(
    () =>
      attachLiveSourceLifecyclePlaceholder(liveSourceLifecycle, {
        devicePlaceholder: deviceRecoveryPlaceholderState,
        handoffPlaceholder: sourceHandoffPlaceholderState,
        standbyPlaceholder: standbyPlaceholderState,
      }),
    [
      deviceRecoveryPlaceholderState,
      liveSourceLifecycle,
      standbyPlaceholderState,
      sourceHandoffPlaceholderState,
    ],
  );
  const livePlaceholderState = presentedLiveSourceLifecycle.placeholder;
  const livePlaceholderErrorReason = resolveLiveSourceLifecycleErrorReason(
    presentedLiveSourceLifecycle,
  );
  // Presentation connectedness follows lifecycle phases. Canvas layers must
  // not invent Server Down from this flag — placeholders come from lifecycle.
  const isLivePresentationConnected =
    presentedLiveSourceLifecycle.phase !== "failed" &&
    presentedLiveSourceLifecycle.phase !== "disconnected" &&
    (isSourcePresentationConnected({
      controlConnected: isConnected,
      sourceStatus: selectedSourceStatus,
      sourceTransportReady: sourceTransport.phase === "ready",
      hasFrame: hasRenderableCurrentFrame || hasPlayedAtLeastOnce,
    }) ||
      isSwitchingLiveSource ||
      isSourceHandoffOverlayPending ||
      sourceTransport?.phase === "warming" ||
      presentedLiveSourceLifecycle.phase === "awaiting-frame" ||
      presentedLiveSourceLifecycle.phase === "warming-transport" ||
      presentedLiveSourceLifecycle.phase === "swapping-device" ||
      presentedLiveSourceLifecycle.phase === "recovering" ||
      presentedLiveSourceLifecycle.phase === "standby" ||
      isSelectedMockTxSource);
  const handleVizPanChange = useCallback(
    (nextPan: number) => {
      if (
        isSelectedMockTxTransmitting &&
        state.sourceMode === "live" &&
        state.frequencyRange
      ) {
        const currentRange = state.frequencyRange;
        const span = currentRange.max - currentRange.min;
        if (Number.isFinite(span) && span > 0 && Number.isFinite(nextPan)) {
          const currentCenter = (currentRange.min + currentRange.max) / 2;
          const nextCenter = currentCenter + nextPan;
          handleFrequencyRangeChange({
            min: nextCenter - span / 2,
            max: nextCenter + span / 2,
          });
          setVizPanOffset(0);
          return;
        }
      }

      publishSubscriberLocalVizPan(nextPan, setVizPanOffset);
    },
    [
      handleFrequencyRangeChange,
      isSelectedMockTxTransmitting,
      setVizPanOffset,
      state.frequencyRange,
      state.sourceMode,
    ],
  );

  useEffect(() => {
    if (!isTxOptionsEditing) return;
    const handlePointerDown = (event: PointerEvent) => {
      const shell = txOptionsRef.current;
      if (!shell || event.composedPath().includes(shell)) return;
      setIsTxOptionsEditing(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsTxOptionsEditing(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTxOptionsEditing]);

  // Memoized so FFTAndWaterfall sees a stable prop between route renders;
  // fftHistoryVersion forces a refresh when the note-view back stack changes.
  const headerActionContent = useMemo<ReactNode>(() => {
    void fftHistoryVersion;
    return (
      <>
        {fastSpectrumSnapshotAction}
        {notesActionPill}
        <HeaderActionSpacer />
        {hasNoteViewHistory ? (
          <FFTBackButton
            type="button"
            $variant="secondary"
            onClick={handleBackFromNoteView}
          >
            👈 Back
          </FFTBackButton>
        ) : null}
      </>
    );
  }, [
    fastSpectrumSnapshotAction,
    notesActionPill,
    handleBackFromNoteView,
    fftHistoryVersion,
  ]);

  return (
    <SpectrumContainer>
      <SpectrumContent>
        {state.sourceMode === "live" &&
          fftFrequencyRange &&
          fftCenterFrequencyHz !== null && (
            <>
              <FFTAndWaterfall
                key={visualizerLifecycleKey}
                ref={fftCanvasRef}
                txSlider={
                  showTxSlider && canShowTxSlider
                    ? {
                        visible: true,
                        isTransmitting: isSelectedSourceTransmitting,
                        signalLabel: resolveTxSignalDisplayLabel(txSignal),
                        powerDbm: txPowerDbm,
                        visibleMinHz:
                          txSliderDefaults?.visibleMinHz ??
                          fftFrequencyRange.min,
                        visibleMaxHz:
                          txSliderDefaults?.visibleMaxHz ??
                          fftFrequencyRange.max,
                        txCenterHz:
                          txSliderDefaults?.centerHz ??
                          resolveCenteredFrequencyHz(
                            txCenterFrequencyHz,
                            mockMonitorCenterHz ?? fftCenterFrequencyHz,
                          ),
                        txSampleRateHz:
                          txSliderDefaults?.sampleRateHz ??
                          Math.max(
                            1,
                            fftFrequencyRange.max - fftFrequencyRange.min,
                          ),
                        isPreviewVfo: false,
                        onCenterFrequencyChange:
                          handleCenterFrequencyChangeFromSlider,
                        onSampleRateChange: (value) => {
                          reduxDispatch(setTxSampleRateHz(value));
                        },
                        onGeometryChange: (center, sampleRate, isDragging) => {
                          isDraggingTxRef.current = !!isDragging;
                          setTxMonitorDetached(true);
                          reduxDispatch(
                            setTxGeometry({
                              centerFrequencyHz: center,
                              sampleRateHz: sampleRate,
                            }),
                          );
                          if (isSelectedSourceTransmitting) {
                            syncMockTxSettingsFromSlider(center, sampleRate);
                          }
                        },
                        onOptionsRequest: () => setIsTxOptionsEditing(true),
                      }
                    : undefined
                }
                overlayContent={
                  <>
                    {isCenterFrequencyEditing ? (
                      <EditableCenterFrequency
                        centerFrequencyHz={
                          allowNegativeFrequencies && fftFrequencyRange
                            ? (fftFrequencyRange.min + fftFrequencyRange.max) /
                                2 +
                              vizPanOffset
                            : fftCenterFrequencyHz
                        }
                        onCenterFrequencyChange={handleCenterFrequencyChange}
                        onClose={() => setIsCenterFrequencyEditing(false)}
                        allowNegativeFrequencies={allowNegativeFrequencies}
                        windowSpanHz={
                          state.frequencyRange
                            ? state.frequencyRange.max - state.frequencyRange.min
                            : null
                        }
                      />
                    ) : null}
                    {isTxOptionsEditing && txSliderDefaults ? (
                      <TxOptionsShell ref={txOptionsRef}>
                        <TxOptionsCard>
                          <TxOptionsTitle>Tx Slider Options</TxOptionsTitle>
                          <TxOptionsGrid>
                            <FrequencyInput
                              label="Center"
                              valueHz={txSliderDefaults.centerHz}
                              minHz={txSliderDefaults.visibleMinHz}
                              maxHz={txSliderDefaults.visibleMaxHz}
                              onChangeHz={(value) => {
                                reduxDispatch(setTxCenterFrequencyHz(value));
                                jumpMonitorToTx(value, "typed");
                              }}
                              commitOnBlur
                              autoFocus
                            />
                            <FrequencyInput
                              label="Bandwidth"
                              valueHz={txSliderDefaults.sampleRateHz}
                              minHz={1}
                              maxHz={
                                txSliderDefaults.visibleMaxHz -
                                txSliderDefaults.visibleMinHz
                              }
                              onChangeHz={(value) => {
                                reduxDispatch(setTxSampleRateHz(value));
                                jumpMonitorToTx(txCenterFrequencyHz, "typed");
                              }}
                              commitOnBlur
                            />
                            <TxPowerField>
                              Power dBm
                              <input
                                type="number"
                                value={
                                  Number.isFinite(txPowerDbm) ? txPowerDbm : -18
                                }
                                onChange={(event) =>
                                  reduxDispatch(
                                    setTxPowerDbm(Number(event.target.value)),
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    setIsTxOptionsEditing(false);
                                  }
                                }}
                              />
                            </TxPowerField>
                          </TxOptionsGrid>
                        </TxOptionsCard>
                      </TxOptionsShell>
                    ) : null}
                  </>
                }
                dataRef={fftDataRef}
                expectedSourceId={expectedVisualizerSourceId}
                frameSourceIdFallback={activeSourceId || streamingSourceId}
                frequencyRange={fftFrequencyRange}
                centerFrequencyHz={fftCenterFrequencyHz}
                onCenterFrequencyDoubleClick={handleOpenCenterFrequencyEditor}
                activeSignalArea={state.activeSignalArea}
                signalAreaBounds={signalAreaBounds ?? undefined}
                hardwareSampleRateHz={fftHardwareSampleRateHz}
                deviceProfile={fftDeviceProfile}
                deviceBackend={selectedSourceDerived.backend ?? backend}
                deviceName={selectedSourceDerived.deviceName ?? deviceName}
                tunerGainDb={effectiveTunerGainDb}
                isIqRecordingActive={captureStatus?.status === "started"}
                limitMarkers={limitMarkers}
                isPaused={
                  isSelectedMockTxTransmitting ? false : manualVisualizerPaused
                }
                fftSize={state.fftSize}
                fftWindow={state.fftWindow}
                powerScale={state.powerScale}
                removeDcSpike={state.removeDcSpike}
                isDeviceConnected={isLivePresentationConnected}
                onFrequencyRangeChange={handleFrequencyRangeChange}
                displayTemporalResolution={state.displayTemporalResolution}
                vizZoom={vizZoom}
                vizZoomFloor={vizZoomFloor}
                vizZoomFloorPan={state.vizZoomFloorPan}
                vizPanOffset={vizPanOffset}
                autoZoomStability={state.autoZoomStability}
                placeholderSourceLabel={
                  selectedSourceDerived.deviceName ??
                  selectedSourceDerived.backend ??
                  "device"
                }
                placeholderState={livePlaceholderState}
                placeholderErrorReason={livePlaceholderErrorReason}
                presentationPolicy={presentedLiveSourceLifecycle.presentation}
                loadingPlaceholderDelayMs={
                  isSourceHandoffOverlayPending ? 1_000 : 160
                }
                onRenderableFrameChange={handleRenderableLiveFrameChange}
                isStandby={isStandbyPresentationActive}
                onVizZoomChange={setVizZoom}
                onVizZoomFloorChange={setVizZoomFloor}
                onVizZoomFloorPanChange={handleVizZoomFloorPanChange}
                onVizPanChange={handleVizPanChange}
                fftMin={state.fftMinDb}
                fftMax={state.fftMaxDb}
                onFftDbLimitsChange={handleFftDbLimitsChange}
                onSnapshot={handleNoopSnapshot}
                snapshotGridPreference={state.snapshotGridPreference}
                showSpikeOverlay={state.showSpikeOverlay}
                fftFrameRate={state.fftFrameRate}
                isWaterfallCleared={state.isWaterfallCleared}
                onResetWaterfallCleared={handleResetWaterfallCleared}
                awaitingDeviceData={false}
                visualizerMachine={fftVisualizerMachine}
                visualizerSessionKey={visualizerSessionKey}
                webGpuStreamResetEpoch={webGpuStreamResetEpoch}
                onLoadingStateChange={handleVisualizerLoadingStateChange}
                headerActionContent={headerActionContent}
                waterfallHeaderActionContent={fastWaterfallSnapshotAction}
              />
            </>
          )}
        {state.sourceMode === "live" &&
          (!state.frequencyRange || centerFrequencyHz === null) && (
            <InitializingContainer>
              <InitializingTitle>
                Loading Signal Configuration
              </InitializingTitle>
              <InitializingText>
                Waiting for signals.yaml settings from the server…
              </InitializingText>
            </InitializingContainer>
          )}
        {state.sourceMode === "file" && (
          <FFTPlaybackCanvas
            ref={fftCanvasRef}
            selectedFiles={state.selectedFiles}
            stitchTrigger={state.stitchTrigger}
            stitchSourceSettings={state.stitchSourceSettings}
            isPaused={state.isStitchPaused}
            fftSize={state.fftSize}
            displayTemporalResolution={
              state.displayTemporalResolution === "reduced"
                ? "lossless"
                : state.displayTemporalResolution
            }
            displayMode={state.displayMode}
            powerScale={state.powerScale}
            removeDcSpike={state.removeDcSpike}
            vizZoom={vizZoom}
            vizZoomFloor={vizZoomFloor}
            vizZoomFloorPan={state.vizZoomFloorPan}
            vizPanOffset={vizPanOffset}
            autoZoomStability={state.autoZoomStability}
            fftMin={state.fftMinDb}
            fftMax={state.fftMaxDb}
            onVizZoomChange={setVizZoom}
            onVizZoomFloorChange={setVizZoomFloor}
            onVizZoomFloorPanChange={handleVizZoomFloorPanChange}
            onVizPanChange={handleVizPanChange}
            onStitchStatus={handleStitchStatusChange}
            onFrequencyRangeChange={handleFrequencyRangeChange}
            onFftDbLimitsChange={handleFftDbLimitsChange}
            snapshotGridPreference={state.snapshotGridPreference}
          />
        )}
      </SpectrumContent>
      <NoteCards
        onViewNoteCard={(card) => {
          handleViewNoteCard(card.stats);
        }}
      />
    </SpectrumContainer>
  );
};
