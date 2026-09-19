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
import { useSnapshot } from "@n-apt/capture/hooks/useSnapshot";
import type {
  DeviceProfile,
  FrequencyRange,
  SourceInfo,
} from "@n-apt/consts/schemas/websocket";
import type { TemporalResolution } from "@n-apt/math/temporalResolution";

import {
  InitializingContainer,
  InitializingTitle,
  InitializingText,
} from "@n-apt/app/Layout";
import { useSpectrumStore } from "@n-apt/spectrum/hooks/useSpectrumStore";
import { getLiveFrameRefForSource } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { buildSdrLimitMarkers } from "@n-apt/math/sdrLimitMarkers";
import { getSourceViewStorageKeyForSource } from "@n-apt/spectrum/public/sourcePersistence";
import { isMockTxSource } from "@n-apt/app/infrastructure/services/deviceCapabilities";
import { getSettingsDefaults } from "@n-apt/settings/public/settingsDefaults";
import { getVisualizerDefaultDbLimits } from "@n-apt/consts/visualizerControls";
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
import type { NoteCardStatsSnapshot } from "@n-apt/redux/slices/noteCardsSlice";
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
  setDeviceKind,
  setFrequencyRange,
  setSourceViewFrequencyRange,
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
} from "@n-apt/math/frequency";
import {
  mapDisplayFrequencyToSource,
  resolveMirroredDisplayCenter,
  resolveMirroredTuning,
} from "@n-apt/math/basebandMirror";

export const resolveNavigationFrequencyBounds = ({
  hardwareBounds,
}: {
  hardwareBounds: FrequencyRange | null;
}): FrequencyRange => {
  // The live VFO is a device acquisition control, not a subscriber-local
  // channel selector. The active channel must never bound navigation: falling
  // back to channelBounds trapped scrolling inside the selected channel
  // whenever the hardware range had not hydrated. Use the device bounds when
  // known, otherwise the global spectrum bounds the backend advertises.
  return hardwareBounds ?? getAvailableSpectrumBounds(null);
};

export const isWholeChannelPan = ({
  currentRange,
  channelBounds,
}: {
  currentRange: FrequencyRange | null | undefined;
  channelBounds: FrequencyRange | null | undefined;
}): boolean =>
  !!currentRange &&
  !!channelBounds &&
  currentRange.min <= channelBounds.min &&
  currentRange.max >= channelBounds.max;

/** Build an explicit source tune while preserving the current acquisition span. */
export const resolveExplicitCenterFrequencyRange = (
  currentRange: FrequencyRange | null | undefined,
  centerFrequencyHz: number,
): FrequencyRange | null => {
  if (
    !currentRange ||
    !Number.isFinite(centerFrequencyHz) ||
    !Number.isFinite(currentRange.min) ||
    !Number.isFinite(currentRange.max) ||
    currentRange.max <= currentRange.min
  ) {
    return null;
  }
  return buildCenteredFrequencyRange(
    centerFrequencyHz,
    currentRange.max - currentRange.min,
    0,
  );
};

// A paused source that lost its frozen frame is re-seated with a bounded number
// of one-shot `request_next_frame` attempts. The cap keeps a backend that cannot
// serve the frame from turning recovery into a request loop.
const PAUSED_FRAME_RECOVERY_MAX_ATTEMPTS = 3;
const PAUSED_FRAME_RECOVERY_RETRY_MS = 700;

/** Keep a paused source's cached acquisition axis with its cached frame. */
export const resolvePausedFrameFrequencyRange = ({
  isPaused,
  isTxMode,
  frame,
  sourceViewRange,
  fallbackRange,
}: {
  isPaused: boolean;
  isTxMode: boolean;
  frame?: any;
  sourceViewRange?: FrequencyRange | null;
  fallbackRange: FrequencyRange | null | undefined;
}): FrequencyRange | null => {
  if (!isPaused || isTxMode) return null;
  const minHz = frame?.min_hz;
  const maxHz = frame?.max_hz;
  if (
    Number.isFinite(minHz) &&
    Number.isFinite(maxHz) &&
    maxHz > minHz
  ) {
    return { min: minHz, max: maxHz };
  }
  if (
    sourceViewRange &&
    Number.isFinite(sourceViewRange.min) &&
    Number.isFinite(sourceViewRange.max) &&
    sourceViewRange.max > sourceViewRange.min
  ) {
    return sourceViewRange;
  }
  return null;
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

type LiveFrequencyRangePublisher = Pick<
  ReturnType<typeof createLiveFrequencyRangePublisher>,
  "publish" | "flush"
>;

/**
 * Pan updates may be throttled, but typed/mode changes are discrete commands.
 * Flush the last pending pan before publishing a typed center so an older
 * gesture cannot arrive after the user's explicit frequency.
 */
export const publishFrequencyRangeBySource = (
  range: FrequencyRange,
  source: "user-pan" | "mode-enter" | "typed",
  publisher: LiveFrequencyRangePublisher,
  setFrequencyRange: (range: FrequencyRange) => void,
  sendFrequencyRange: (range: FrequencyRange) => void,
): void => {
  if (source === "user-pan") {
    publisher.publish(range);
    return;
  }

  publisher.flush();
  publishFrequencyRangeImmediately(
    range,
    setFrequencyRange,
    sendFrequencyRange,
  );
};

/** Mock Tx owns a subscriber-local monitor range, not shared RX tuning. */
export const shouldPublishFrequencyRangeForSource = ({
  sourceMode,
  isMockTxMonitorActive,
}: {
  sourceMode: "live" | "file";
  isMockTxMonitorActive: boolean;
}): boolean => sourceMode === "live" && !isMockTxMonitorActive;

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
    // One display frame. The frame rate governs scroll responsiveness; a coarser
    // cadence made scrolling feel bogged down, and the backend already coalesces
    // retunes to the latest value.
    intervalMs: 16,
    idleFlushMs: 16,
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
import {
  getLatestLiveFrame,
} from "@n-apt/spectrum/public/liveSourceLifecycle";
import {
  isSourcePresentationConnected,
  resolveSourceModeManagement,
} from "@n-apt/app/infrastructure/streams/sourceModeManagement";
import {
  resolveMockTxPreviewViewCenterHz,
  resolveMockTxTransmitSettings,
  resolveMockTxTransmitViewCenterHz,
  resolveTxPreviewCenterHz,
  resolveTxSliderCenterHz,
  canShowTxSliderForSource,
  shouldJumpTxMonitor,
} from "@n-apt/transmit/public/txSliderPlacement";
import {
  isCurrentSourceFrameReady,
  isSelectedSourceFrameReady,
  resolveSelectedSourceFrameReadiness,
  isCommittedStandbyPresentation,
  isLiveSourceAwaitingFrame,
  isLiveSourceHandoffPending,
  resolveLiveSourceHandoffPending,
  resolveLiveSourceLifecycleErrorReason,
  shouldRequestMockTxStandbyPreview,
  shouldPresentMockTxStandby,
  selectSourceFrameReadinessForMode,
  selectSourceTransportForMode,
  shouldInvalidateLiveFrameStateForTransport,
  shouldPreserveRenderableFrameDuringTransportGap,
  shouldRecoverPausedFrame,
  useLiveSourceLifecycle,
} from "@n-apt/spectrum/public/liveSourceLifecycle";
import { requestNextPausedFrame } from "@n-apt/redux/thunks/websocketThunks";
import {
  LiveStateDiagnostics,
  shouldRenderLiveStateDiagnostics,
} from "./spectrum/liveStateDiagnostics";
import type { LiveStateDiagnosticsInput } from "./spectrum/liveStateDiagnostics";
import { getManagedStreamDebugSnapshot } from "@n-apt/redux/middleware/websocketMiddleware";
import {
  getMockTxPreviewRequestKey,
  resolveMockTxMonitorFrequencyRange,
  resolveMockTxMonitorSampleRateForView,
  resolveMockTxMonitorViewSampleRateHz,
  resolveSourceViewPanRange,
  resolveTxStandbyPreviewTransport,
  shouldClearMockTxPreviewRequestDedupe,
  shouldRequestTxLifecycleFrame,
} from "./spectrum/mockTxPreview";
import {
  FAST_SPECTRUM_FALLBACK_HEIGHT,
  FAST_WATERFALL_FALLBACK_HEIGHT,
  FFTBackButton,
  FastSnapshotControl,
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

// Kept as re-exports: tests import these helpers via this module.
export { resolveLiveDevicePlaceholderState } from "@n-apt/spectrum/public/liveSourceLifecycle";

export const resolveSpectrumLimitMarkers = ({
  activeSourceMarkers,
  selectedSourceMarkers,
}: {
  activeSourceMarkers?: SourceInfo["sdr"]["fft_display"]["markers"] | null;
  selectedSourceMarkers?:
    | SourceInfo["sdr"]["fft_display"]["markers"]
    | null;
}) => selectedSourceMarkers ?? activeSourceMarkers ?? [];
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

type SpectrumViewSnapshot = Partial<{
  activeSignalArea: string;
  frequencyRange: FrequencyRange;
  displayTemporalResolution: TemporalResolution;
  powerScale: "dB" | "dBm";
  vizZoom: number;
  vizZoomFloor: number;
  vizZoomFloorPan: number;
  vizPanOffset: number;
  fftMinDb: number;
  fftMaxDb: number;
  fftSize: number;
  fftWindow: string;
  gain: number;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
}>;

export const SpectrumRoute: React.FC<SpectrumRouteProps> = ({
  activeTab,
  fftCanvasRef: fftCanvasRefProp,
  onLoadingStateChange,
}) => {
  const localFftCanvasRef = useRef<FFTCanvasHandle | null>(null);
  const fftCanvasRef = fftCanvasRefProp ?? localFftCanvasRef;
  const fftHistoryRef = useRef<SpectrumViewSnapshot[]>([]);
  const [fftHistoryVersion, setFftHistoryVersion] = useState(0);
  const [fftSnapshotLoading, setFftSnapshotLoading] = useState(false);
  const [fastSnapshotMode, setFastSnapshotMode] = useState<0 | 1 | 2>(() =>
    getSettingsDefaults().snapshot.fastSnapshotShowStats ? 1 : 0,
  );
  const { getLocation: getFastSnapshotLocation } = useGeolocation();
  const [fastSnapshotGeolocation, setFastSnapshotGeolocation] = useState<{
    lat: string;
    lon: string;
  } | null>(null);
  const [fastSnapshotLocationLabel, setFastSnapshotLocationLabel] = useState<
    string | null
  >(null);
  const [fastSnapshotGeoUnavailable, setFastSnapshotGeoUnavailable] =
    useState(false);
  const fastSnapshotGeoUnavailableRef = useRef(false);
  const fastSnapshotGeolocationRequestRef = useRef(0);
  const fastSnapshotShowStats = fastSnapshotMode > 0;
  const fastSnapshotShowGeolocation = fastSnapshotMode === 2;
  const handleShowStatsChange = useCallback(
    (show: boolean) => setFastSnapshotMode(show ? 1 : 0),
    [],
  );

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.permissions ||
      typeof navigator.permissions.query !== "function"
    ) {
      return;
    }

    let active = true;
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (!active || permission.state !== "denied") return;
        fastSnapshotGeoUnavailableRef.current = true;
        setFastSnapshotGeoUnavailable(true);
      })
      .catch(() => {
        // The geolocation request remains the fallback for browsers that do
        // not support querying this permission on load.
      });

    return () => {
      active = false;
    };
  }, []);

  const cycleFastSnapshotMode = useCallback(
    (selectedMode?: 0 | 1 | 2) => {
      if (selectedMode === 2) {
        if (fastSnapshotGeoUnavailableRef.current) {
          fastSnapshotGeoUnavailableRef.current = false;
          setFastSnapshotGeoUnavailable(false);
          setFastSnapshotGeolocation(null);
          setFastSnapshotLocationLabel(null);
          setFastSnapshotMode(0);
          return;
        }
        const requestId = ++fastSnapshotGeolocationRequestRef.current;
        void getFastSnapshotLocation()
          .then((location) => {
            if (requestId !== fastSnapshotGeolocationRequestRef.current) return;
            if (!location) {
              fastSnapshotGeoUnavailableRef.current = true;
              setFastSnapshotGeolocation(null);
              setFastSnapshotLocationLabel(null);
              setFastSnapshotMode(1);
              return;
            }

            const geolocation = {
              lat: location.latitude.toFixed(6),
              lon: location.longitude.toFixed(6),
            };
            fastSnapshotGeoUnavailableRef.current = false;
            setFastSnapshotGeoUnavailable(false);
            setFastSnapshotGeolocation(geolocation);
            setFastSnapshotMode(2);
            void reverseGeocodeSnapshotLocation(
              geolocation.lat,
              geolocation.lon,
            )
              .then((label) => {
                if (requestId === fastSnapshotGeolocationRequestRef.current) {
                  setFastSnapshotLocationLabel(label);
                }
              })
              .catch(() => {
                if (requestId === fastSnapshotGeolocationRequestRef.current) {
                  setFastSnapshotLocationLabel(null);
                }
              });
          })
          .catch(() => {
            if (requestId !== fastSnapshotGeolocationRequestRef.current) return;
            fastSnapshotGeoUnavailableRef.current = true;
            setFastSnapshotGeolocation(null);
            setFastSnapshotLocationLabel(null);
            setFastSnapshotMode(1);
          });
        return;
      }

      fastSnapshotGeolocationRequestRef.current += 1;
      setFastSnapshotGeolocation(null);
      setFastSnapshotLocationLabel(null);
      setFastSnapshotMode((current) =>
        selectedMode === undefined
          ? (((current + 1) % 3) as 0 | 1 | 2)
          : selectedMode,
      );
    },
    [getFastSnapshotLocation],
  );
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
  const sourceViewFrequencyRanges = useAppSelector(
    (state) => state.spectrum.sourceViewFrequencyRanges,
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
  const txViewerSampleRateHz = useAppSelector(
    (state) => state.spectrum.txViewerSampleRateHz,
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
    selectionIntentSourceId,
    pendingSourceSwitchId,
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
      cryptoCorrupted,
    },
    sampleRateHzEffective,
    toggleVisualizerPause,
  } = useSpectrumStore();
  const setLiveFrequencyRangeRef = useRef<(range: FrequencyRange) => void>(
    () => {},
  );
  const sendLiveFrequencyRangeRef = useRef<(range: FrequencyRange) => void>(
    () => {},
  );
  const liveFrequencyRangePublisherRef = useRef<
    ReturnType<typeof createLiveFrequencyRangePublisher> | null
  >(null);
  if (!liveFrequencyRangePublisherRef.current) {
    liveFrequencyRangePublisherRef.current = createLiveFrequencyRangePublisher(
      (range) => setLiveFrequencyRangeRef.current(range),
      (range) => sendLiveFrequencyRangeRef.current(range),
    );
  }
  useLayoutEffect(() => {
    setLiveFrequencyRangeRef.current = (nextRange) => {
      reduxDispatch(setFrequencyRange(nextRange));
    };
    sendLiveFrequencyRangeRef.current = sendFrequencyRange;
  }, [reduxDispatch, sendFrequencyRange]);
  useEffect(
    () => () => {
      liveFrequencyRangePublisherRef.current?.cancel();
    },
    [],
  );
  const publishFrequencyRange = useCallback(
    (
      range: FrequencyRange,
      source: "user-pan" | "mode-enter" | "typed" = "user-pan",
    ) => {
      // The canvas keeps the live view in refs while a gesture is in flight.
      // Coalesce Redux and device updates to one latest-value publish per
      // display frame. The interaction hook already updates the live refs and
      // asks the canvas to repaint synchronously, so this does not slow the drag.
      const publisher = liveFrequencyRangePublisherRef.current;
      if (source === "user-pan") {
        if (publisher) {
          publishFrequencyRangeBySource(
            range,
            source,
            publisher,
            setLiveFrequencyRangeRef.current,
            sendLiveFrequencyRangeRef.current,
          );
        }
        return;
      }

      // Typed/mode changes are discrete commands. Flush a pending pan first,
      // then preserve their immediate ordering with the device request.
      if (publisher) {
        publishFrequencyRangeBySource(
          range,
          source,
          publisher,
          setLiveFrequencyRangeRef.current,
          sendLiveFrequencyRangeRef.current,
        );
      }
    },
    [],
  );
  const streamingSource = useMemo(
    () =>
      selectedSource ??
      sources.find((source) => source.id === activeSourceId) ??
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
  const hasActiveSourceFrame =
    hasPlayedAtLeastOnce && playedSourceId === (streamingSourceId || null);
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
  // RX monitor frames are also subscriber-local: a tab may view Mock APT
  // while another source (for example Mock Tx) owns the global control-plane
  // slot. Only allow this exception for sources that can actually receive;
  // Mock Tx must not pass its Tx preview through the RX readiness path.
  const isSelectedSubscriberLocalRxView =
    !isSelectedSourceTxMode && selectedSourceModeManagement.canReceive;
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
  // supports_tx_monitor is a capability, not the current mode. The Tx
  // monitor pipeline must only be active after an explicit Tx-mode switch.
  const isMockTxMonitorActive =
    isSelectedMockTxSource &&
    (isSelectedSourceTxMode || selectedSource?.kind === "mock_tx");
  const isSelectedTxPreviewStandby =
    txSuiteSourceId === selectedSourceId &&
    selectedSourceStatus !== "transmitting" &&
    (isSelectedSourceTxMode ||
      (selectedSourceStatus === "paused" &&
        selectedSourceModeManagement.canTransmit));
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
  const txViewerPowerScale = useAppSelector(
    (rootState) => rootState.spectrum.txViewerPowerScale,
  );
  const visualizerPowerScale = isSelectedMockTxSource
    ? txViewerPowerScale
    : state.powerScale;
  const visualizerDbLimits = getVisualizerDefaultDbLimits(visualizerPowerScale);
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
  // A `standby` report is only Tx chrome while the source is actually bound to
  // the Tx suite. A lingering standby snapshot after an Rx handoff is an Rx
  // presentation, and painting the Tx bar there would mask the paused banner.
  const isSelectedSourceTxStandby =
    (selectedSourceStatus === "standby" || selectedSource?.status === "standby") &&
    (isSelectedMockTxSource || txSuiteSourceId === selectedSourceId);
  const isSelectedSourceTxStatus =
    isSelectedSourceTxStandby ||
    isSelectedTxPreviewStandby ||
    selectedSourceStatus === "transmitting" ||
    selectedSource?.status === "transmitting";
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
    presentedSourceId: getLatestLiveFrame(dataRef.current)?.source_id ?? null,
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
    selectionIntentSourceId,
    pendingSourceSwitchId,
    transportSourceId: sourceTransport?.sourceId ?? null,
    transportPhase: sourceTransport?.phase ?? "idle",
    subscriberLocalTxView: isSelectedSourceTxMode,
  });
  const liveSourceLabel =
    selectedSource?.name ??
    selectedSourceDerived.deviceName ??
    streamingSource?.name ??
    "device";
  const presentedSourceId = getLatestLiveFrame(dataRef.current)?.source_id ?? null;
  const presentedSource = presentedSourceId
    ? sources.find((source) => source.id === presentedSourceId)
    : null;
  const hasSelectedSourceFrameReady = isSelectedSourceFrameReady({
    selectedSourceId: selectedSourceId || null,
    activeSourceId: activeSourceId || null,
    mode: selectedStreamMode,
    subscriberLocalRxView: isSelectedSubscriberLocalRxView,
    expectedStreamEpoch: expectedLegacyStreamEpoch,
    readiness: sourceFrameReadiness,
  });
  const standbySourceLabel =
    presentedSource?.name ?? presentedSourceId ?? liveSourceLabel;
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
    presentedSourceId,
    // Never treat a previous source's "played once" flag as a Mock Tx frame.
    // That skipped awaiting-frame Loading and left a black FFT under STANDBY
    // on first Rx→Tx and on cold reload into Mock Tx before request_next_frame.
    hasValidFrame:
      hasTargetFrozenFrame ||
      isCurrentSourceFrameReady({
        selectedSourceId: selectedSourceId || null,
        activeSourceId: activeSourceId || null,
        expectedStreamEpoch: expectedLegacyStreamEpoch,
        readiness: sourceFrameReadiness,
      }) ||
      hasSelectedSourceFrameReady ||
      hasRenderableCurrentFrame ||
      hasActiveSourceFrame,
    deviceStatus: selectedSourceStatus,
    sourceLabel: liveSourceLabel,
    loadingAttempt: streamingSource?.loading_attempt,
    loadingAttemptMax: streamingSource?.loading_attempt_max,
    hasPlayedAtLeastOnce,
    hasRenderableCurrentFrame,
    standbySourceLabel,
    cryptoCorrupted,
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
  const canShowTxSlider = canShowTxSliderForSource({
    canTransmit:
      selectedSource?.capability === "tx" ||
      selectedSource?.capability === "tx_rx" ||
      selectedSource?.kind === "mock_tx" ||
      selectedSource?.id === "mock-tx",
    status: selectedSourceStatus,
  });
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
    () =>
      buildSdrLimitMarkers(
        resolveSpectrumLimitMarkers({
          activeSourceMarkers: sdrLimitMarkers,
          selectedSourceMarkers: selectedSource?.sdr?.fft_display?.markers,
        }),
      ),
    [sdrLimitMarkers, selectedSource],
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

  const buildFastSnapshotControl = useCallback(
    (target: "spectrum" | "waterfall") => {
      const isSpectrum = target === "spectrum";
      const fallbackHeight = isSpectrum
        ? FAST_SPECTRUM_FALLBACK_HEIGHT
        : FAST_WATERFALL_FALLBACK_HEIGHT;
      const getTargetCanvas = () =>
        isSpectrum
          ? fftCanvasRef.current?.getSpectrumCanvas()
          : fftCanvasRef.current?.getWaterfallCanvas();

      const sdrSettingsLabel = buildSnapshotSettingsLabel({
        effectiveSdrSettings,
        gain: state.gain,
        ppm: state.ppm,
        hackrfLnaGain: state.hackrfLnaGain,
        hackrfVgaGain: state.hackrfVgaGain,
        hackrfAmpEnabled: state.hackrfAmpEnabled,
        hackrfBasebandBandwidth: state.hackrfBasebandBandwidth ?? undefined,
        deviceKind:
          selectedSourceDerived.deviceProfile?.kind ??
          deviceProfile?.kind ??
          deviceKind ??
          undefined,
      });
      const sourceName =
        selectedSourceDerived.deviceName ??
        deviceName ??
        (isConnected ? "SDR" : "Offline");

      const snapshotOptions = {
        showStats: fastSnapshotShowStats,
        showGeolocation: fastSnapshotShowGeolocation,
        geolocation: fastSnapshotGeolocation,
        locationLabel: fastSnapshotLocationLabel,
        activeSignalArea: state.activeSignalArea,
        activeSignalAreaBounds,
        sourceName,
        sdrSettingsLabel,
        gain: state.gain ?? undefined,
        ppm: state.ppm ?? undefined,
        fftSize: state.fftSize ?? undefined,
      };

      return (
        <FastSnapshotControl
          disabled={
            fftSnapshotLoading ||
            (isRecording !== null && isRecording !== target)
          }
          isRecording={isRecording === target}
          recordingCountdown={recordingCountdown}
          videoFormat={supportedVideoFormat}
          showStats={fastSnapshotShowStats}
          onShowStatsChange={handleShowStatsChange}
          fastSnapshotMode={
            fastSnapshotGeoUnavailable ? undefined : fastSnapshotMode
          }
          onFastSnapshotModeChange={
            fastSnapshotGeoUnavailable ? undefined : cycleFastSnapshotMode
          }
          onImage={() => {
            // Read dimensions at click time — canvas size changes with layout
            // and must not be baked into the memoized element.
            const canvas = getTargetCanvas();
            void takeFastSnapshot(
              target,
              (dataOptions) =>
                fftCanvasRef.current?.getSnapshotData(dataOptions) ?? null,
              canvas?.width ?? 1,
              canvas?.height ?? fallbackHeight,
              getCanvases,
              snapshotOptions,
            );
          }}
          onVideo={() =>
            startFastRecording(
              target,
              (dataOptions) =>
                fftCanvasRef.current?.getSnapshotData(dataOptions) ?? null,
              () => {
                const canvas = getTargetCanvas();
                return {
                  width: canvas?.width ?? 1,
                  height: canvas?.height ?? fallbackHeight,
                };
              },
              isSpectrum ? "fast-fft-recording" : "fast-waterfall-recording",
              getCanvases,
              {
                ...snapshotOptions,
                getActiveSignalArea: () => state.activeSignalArea,
                getActiveSignalAreaBounds: () =>
                  signalAreaBounds?.[state.activeSignalArea] ??
                  signalAreaBounds?.[state.activeSignalArea?.toLowerCase?.()] ??
                  null,
                getSdrSettingsLabel: () =>
                  buildSnapshotSettingsLabel({
                    effectiveSdrSettings,
                    gain: state.gain,
                    ppm: state.ppm,
                    hackrfLnaGain: state.hackrfLnaGain,
                    hackrfVgaGain: state.hackrfVgaGain,
                    hackrfAmpEnabled: state.hackrfAmpEnabled,
                    hackrfBasebandBandwidth:
                      state.hackrfBasebandBandwidth ?? undefined,
                    deviceKind:
                      selectedSourceDerived.deviceProfile?.kind ??
                      deviceProfile?.kind ??
                      deviceKind ??
                      undefined,
                  }),
                getSourceName: () =>
                  selectedSourceDerived.deviceName ??
                  deviceName ??
                  (isConnected ? "SDR" : "Offline"),
              },
            )
          }
          onStop={stopFastRecording}
        />
      );
    },
    [
      fftCanvasRef,
      fftSnapshotLoading,
      isRecording,
      recordingCountdown,
      supportedVideoFormat,
      takeFastSnapshot,
      startFastRecording,
      stopFastRecording,
      getCanvases,
      fastSnapshotShowStats,
      fastSnapshotShowGeolocation,
      fastSnapshotGeolocation,
      fastSnapshotLocationLabel,
      fastSnapshotMode,
      fastSnapshotGeoUnavailable,
      handleShowStatsChange,
      cycleFastSnapshotMode,
      state.activeSignalArea,
      state.gain,
      state.ppm,
      state.hackrfLnaGain,
      state.hackrfVgaGain,
      state.hackrfAmpEnabled,
      state.hackrfBasebandBandwidth,
      state.fftSize,
      activeSignalAreaBounds,
      signalAreaBounds,
      effectiveSdrSettings,
      selectedSourceDerived.deviceProfile?.kind,
      selectedSourceDerived.deviceName,
      deviceProfile?.kind,
      deviceKind,
      deviceName,
      isConnected,
    ],
  );

  const fastSpectrumSnapshotAction = useMemo<ReactNode>(
    () => buildFastSnapshotControl("spectrum"),
    [buildFastSnapshotControl],
  );

  const fastWaterfallSnapshotAction = useMemo<ReactNode>(
    () => buildFastSnapshotControl("waterfall"),
    [buildFastSnapshotControl],
  );

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

  const [mockMonitorCenterHz, setMockMonitorCenterHz] = useState<number | null>(
    () => {
      if (Number.isFinite(txCenterFrequencyHz)) {
        return txCenterFrequencyHz;
      }
      const range = state.frequencyRange;
      if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
        return Math.round((range.min + range.max) / 2);
      }
      return null;
    },
  );
  const isDraggingTxRef = useRef(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Attached (false): monitor stays on planned Tx — required for cold load so a
   * stale frequencyRange cannot synthesize an off-window noise-floor preview.
   * Detached (true): user pan or slider moved the carrier without jumping view.
   */
  const [txMonitorDetached, setTxMonitorDetached] = useState(false);
  const wasMockTxMonitorActiveRef = useRef(false);

  const applyTxMonitorForRange = useCallback(
    (range: FrequencyRange, source: "user-pan" | "mode-enter" | "typed") => {
      if (
        !isMockTxMonitorActive ||
        !Number.isFinite(range.min) ||
        !Number.isFinite(range.max)
      ) {
        return;
      }
      const nextCenter = (range.min + range.max) / 2;
      if (source === "user-pan") {
        setTxMonitorDetached(true);
        setMockMonitorCenterHz(nextCenter);
      } else if (shouldJumpTxMonitor({ source })) {
        setTxMonitorDetached(false);
        setMockMonitorCenterHz(nextCenter);
      }
    },
    [isMockTxMonitorActive],
  );

  const handleFrequencyRangeChange = useCallback(
    (
      range: FrequencyRange,
      source: "user-pan" | "mode-enter" | "typed" = "user-pan",
    ) => {
      // Tx monitor geometry is subscriber-local. It must never be clamped to
      // or published as the selected RX channel's device range.
      if (isMockTxMonitorActive) {
        const monitorRange = normalizeFrequencyRangeToHz(range);
        reduxDispatch(
          setSourceViewFrequencyRange({
            sourceId: selectedSourceId ?? "mock-tx",
            range: monitorRange,
          }),
        );
        applyTxMonitorForRange(monitorRange, source);
        return;
      }

      // The mirror is presentational: an explicit tune still asks the radio for
      // a positive window, and a below-zero request is restored with pan rather
      // than by letting the shifted window become the view. Already-positive
      // requests (including auto-retunes) must not touch pan — the caller owns
      // re-anchoring, otherwise a retune briefly snaps the viewport to DC.
      if (allowNegativeFrequencies && range.min < 0) {
        // Cap every mirrored tune at the live sample-rate window. Whole-channel
        // thumbs (positive or DC-crossing) must not widen Redux past what the
        // radio actually acquires — that is the channel-island flatline.
        const acquisitionSpanHz =
          state.frequencyRange &&
          Number.isFinite(state.frequencyRange.max) &&
          Number.isFinite(state.frequencyRange.min) &&
          state.frequencyRange.max > state.frequencyRange.min
            ? state.frequencyRange.max - state.frequencyRange.min
            : sampleRateHzEffective;
        const { hardwareRange, panOffsetHz } = resolveMirroredTuning(
          range,
          null,
          { maxAcquisitionSpanHz: acquisitionSpanHz },
        );
        const nextRange = normalizeFrequencyRangeToHz(hardwareRange);
        // Only re-anchor pan for below-zero / clamped-crossing requests.
        // Auto-retunes that are already positive own their own pan.
        if (range.min < 0) {
          setVizPanOffset(panOffsetHz);
        }
        if (isMockTxMonitorActive) {
          reduxDispatch(
            setSourceViewFrequencyRange({
              sourceId: selectedSourceId ?? "mock-tx",
              range: nextRange,
            }),
          );
        } else if (
          shouldPublishFrequencyRangeForSource({
            sourceMode: state.sourceMode,
            isMockTxMonitorActive,
          })
        ) {
          publishFrequencyRange(nextRange, source);
        } else {
          reduxDispatch(setFrequencyRange(nextRange));
        }
        applyTxMonitorForRange(nextRange, source);
        return;
      }

      const primaryBounds = resolveNavigationFrequencyBounds({
        hardwareBounds: hardwareSpectrumBounds,
      });
      const isWholeChannel = isWholeChannelPan({
        currentRange: state.frequencyRange,
        channelBounds: activeSignalAreaBounds,
      });
      const clampedRange = normalizeFrequencyRangeToHz(
        !isWholeChannel
          ? clampFrequencyRangeToBounds(range, primaryBounds)
          : range,
      );
      if (isMockTxMonitorActive) {
        reduxDispatch(
          setSourceViewFrequencyRange({
            sourceId: selectedSourceId ?? "mock-tx",
            range: clampedRange,
          }),
        );
      } else if (
        shouldPublishFrequencyRangeForSource({
          sourceMode: state.sourceMode,
          isMockTxMonitorActive,
        })
      ) {
        publishFrequencyRange(clampedRange, source);
      } else {
        reduxDispatch(setFrequencyRange(clampedRange));
      }
      applyTxMonitorForRange(clampedRange, source);
    },
    [
      allowNegativeFrequencies,
      applyTxMonitorForRange,
      hardwareSpectrumBounds,
      activeSignalAreaBounds,
      publishFrequencyRange,
      reduxDispatch,
      selectedSourceId,
      sampleRateHzEffective,
      setVizPanOffset,
      state.frequencyRange,
      state.vizZoom,
    ],
  );

  const jumpMonitorToTx = useCallback(
    (centerHz: number, source: "mode-enter" | "typed" = "typed") => {
      if (!Number.isFinite(centerHz) || !shouldJumpTxMonitor({ source })) {
        return;
      }
      setTxMonitorDetached(false);
      setMockMonitorCenterHz(centerHz);
      const spanHz = resolveMockTxMonitorViewSampleRateHz({
        viewerSampleRateHz: txViewerSampleRateHz,
        fallbackSampleRateHz: state.frequencyRange
          ? state.frequencyRange.max - state.frequencyRange.min
          : txSampleRateHz,
      });
      if (spanHz === null || !Number.isFinite(spanHz) || spanHz <= 0) {
        return;
      }
      if (Number.isFinite(spanHz) && spanHz > 0) {
        handleFrequencyRangeChange(
          buildCenteredFrequencyRange(centerHz, spanHz, 0),
          source,
        );
      }
    },
    [
      allowNegativeFrequencies,
      handleFrequencyRangeChange,
      state.frequencyRange,
      txSampleRateHz,
      txViewerSampleRateHz,
    ],
  );

  const handleCenterFrequencyChange = useCallback(
    (nextCenterFrequencyHz: number) => {
      if (isMockTxMonitorActive) {
        const spanHz = resolveMockTxMonitorViewSampleRateHz({
          viewerSampleRateHz: txViewerSampleRateHz,
          fallbackSampleRateHz: state.frequencyRange
            ? state.frequencyRange.max - state.frequencyRange.min
            : txSampleRateHz,
        });
        if (!Number.isFinite(nextCenterFrequencyHz) || spanHz <= 0) return;
        setMockMonitorCenterHz(nextCenterFrequencyHz);
        setTxMonitorDetached(true);
        handleFrequencyRangeChange(
          buildCenteredFrequencyRange(nextCenterFrequencyHz, spanHz, 0),
          "typed",
        );
        return;
      }

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
      const nextRange = resolveExplicitCenterFrequencyRange(
        state.frequencyRange,
        sourceCenterFrequencyHz,
      );
      if (!nextRange) return;

      // Explicit center entry is a source tune, not a zoom gesture. Keep the
      // current acquisition width, move the source window to the requested
      // center, and leave subscriber-local zoom/pan untouched.
      setVizPanOffset(0);
      handleFrequencyRangeChange(nextRange, "typed");
    },
    [
      handleFrequencyRangeChange,
      allowNegativeFrequencies,
      isMockTxMonitorActive,
      setVizPanOffset,
      state.frequencyRange,
      state.vizPanOffset,
      state.vizZoom,
      txSampleRateHz,
      txViewerSampleRateHz,
    ],
  );

  const centerFrequencyHz = useMemo(() => {
    return calculateCenterFrequency(state.frequencyRange);
  }, [state.frequencyRange]);

  const syncMockTxSettingsFromSlider = useCallback(
    (centerFrequencyHz: number, sampleRateHzOverride?: number) => {
      if (
        !Number.isFinite(centerFrequencyHz) ||
        !isMockTxMonitorActive ||
        !isConnected ||
        isSwitchingLiveSource ||
        !isSelectedMockTxTransmitting
      ) {
        return;
      }

      const effectiveTxSampleRateHz =
        typeof sampleRateHzOverride === "number" &&
        Number.isFinite(sampleRateHzOverride)
          ? sampleRateHzOverride
          : txSampleRateHz;
      const rangeViewSampleRateHz = resolveMockTxMonitorViewSampleRateHz({
        viewerSampleRateHz: txViewerSampleRateHz,
        fallbackSampleRateHz: state.frequencyRange
          ? state.frequencyRange.max - state.frequencyRange.min
          : null,
      });
      const rangeViewCenterHz =
        state.frequencyRange &&
        Number.isFinite(state.frequencyRange.min) &&
        Number.isFinite(state.frequencyRange.max)
          ? (state.frequencyRange.min + state.frequencyRange.max) / 2
          : null;
      // Slider is passive: never force the monitor onto the carrier.
      const txSettings = {
        ...resolveMockTxTransmitSettings({
          txCenterHz: centerFrequencyHz,
          viewCenterHz: mockMonitorCenterHz ?? rangeViewCenterHz,
          viewSampleRateHz: rangeViewSampleRateHz,
          txBandwidthHz: effectiveTxSampleRateHz,
          alignMonitor: false,
        }),
        powerDbm: txPowerDbm,
        txSignal,
        txIfftSize,
      };

      const fallbackId = selectedSourceId || selectedSource?.id;
      if (!fallbackId) return;
      sendTransmitStatus?.(true, selectedSource?.name ?? fallbackId, {
        serialNumber: selectedSource?.serial_number?.trim() || fallbackId,
        ...txSettings,
      });
    },
    [
      isConnected,
      isMockTxMonitorActive,
      isSelectedMockTxTransmitting,
      isSwitchingLiveSource,
      mockMonitorCenterHz,
      selectedSource,
      selectedSourceId,
      sendTransmitStatus,
      state.frequencyRange,
      txIfftSize,
      txPowerDbm,
      txSampleRateHz,
      txViewerSampleRateHz,
      txSignal,
    ],
  );

  const handleCenterFrequencyChangeFromSlider = useCallback(
    (value: number, isDragging?: boolean) => {
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }
      isDraggingTxRef.current = !!isDragging;
      if (!isDragging) {
        dragTimeoutRef.current = setTimeout(() => {
          isDraggingTxRef.current = false;
        }, 0);
      }

      // Standby and transmitting: slider updates planned Tx only and detaches
      // so a later attached-sync cannot yank the monitor onto the new carrier.
      setTxMonitorDetached(true);
      reduxDispatch(setTxCenterFrequencyHz(value));
      syncMockTxSettingsFromSlider(value);
    },
    [reduxDispatch, syncMockTxSettingsFromSlider],
  );

  // Entering Mock Tx / Tx mode aligns the monitor to the planned carrier once.
  useEffect(() => {
    const enteredMockTx =
      isMockTxMonitorActive && !wasMockTxMonitorActiveRef.current;
    wasMockTxMonitorActiveRef.current = isMockTxMonitorActive;
    if (!enteredMockTx || !Number.isFinite(txCenterFrequencyHz)) {
      return;
    }
    jumpMonitorToTx(txCenterFrequencyHz, "mode-enter");
  }, [isMockTxMonitorActive, jumpMonitorToTx, txCenterFrequencyHz]);

  // While attached, ignore stale frequencyRange centers (cold-load race).
  // While detached, follow range updates from user pan / typed sidebar jumps
  // that already recentered onto Tx (range center ≈ tx center → re-attach).
  useEffect(() => {
    const sourceViewRange = selectedSourceId
      ? sourceViewFrequencyRanges?.[selectedSourceId]
      : null;
    if (!isMockTxMonitorActive || !sourceViewRange) {
      return;
    }
    if (isDraggingTxRef.current) {
      return;
    }
    const rangeCenter = (sourceViewRange.min + sourceViewRange.max) / 2;
    if (!Number.isFinite(rangeCenter)) {
      return;
    }
    const alignedWithTx =
      Number.isFinite(txCenterFrequencyHz) &&
      Math.abs(rangeCenter - txCenterFrequencyHz) <= 1;
    if (alignedWithTx) {
      setTxMonitorDetached(false);
      setMockMonitorCenterHz(txCenterFrequencyHz);
      return;
    }
    if (txMonitorDetached) {
      setMockMonitorCenterHz((previous) =>
        previous != null && Math.abs(previous - rangeCenter) <= 1
          ? previous
          : rangeCenter,
      );
    }
  }, [
    isMockTxMonitorActive,
    selectedSourceId,
    sourceViewFrequencyRanges,
    txCenterFrequencyHz,
    txMonitorDetached,
  ]);

  const captureSpectrumViewSnapshot = useCallback((): SpectrumViewSnapshot => {
    const range = state.frequencyRange;
    return {
      activeSignalArea: state.activeSignalArea,
      frequencyRange: range ? { ...range } : undefined,
      displayTemporalResolution: state.displayTemporalResolution,
      powerScale: state.powerScale,
      vizZoom: state.vizZoom,
      vizZoomFloor: state.vizZoomFloor,
      vizZoomFloorPan: state.vizZoomFloorPan,
      vizPanOffset: state.vizPanOffset,
      fftMinDb: state.fftMinDb,
      fftMaxDb: state.fftMaxDb,
      fftSize: state.fftSize,
      fftWindow: state.fftWindow,
      gain: state.gain,
      ppm: state.ppm,
      tunerAGC: state.tunerAGC,
      rtlAGC: state.rtlAGC,
    };
  }, [
    state.activeSignalArea,
    state.frequencyRange,
    state.displayTemporalResolution,
    state.powerScale,
    state.vizZoom,
    state.vizZoomFloor,
    state.vizZoomFloorPan,
    state.vizPanOffset,
    state.fftMinDb,
    state.fftMaxDb,
    state.fftSize,
    state.fftWindow,
    state.gain,
    state.ppm,
    state.tunerAGC,
    state.rtlAGC,
  ]);

  const applySpectrumViewSnapshot = useCallback(
    (snapshot: SpectrumViewSnapshot) => {
      reduxDispatch(
        setSdrSettingsBundle({
          activeSignalArea: snapshot.activeSignalArea ?? state.activeSignalArea,
          displayTemporalResolution:
            snapshot.displayTemporalResolution ??
            state.displayTemporalResolution,
          powerScale: snapshot.powerScale ?? state.powerScale,
          vizZoom: snapshot.vizZoom ?? state.vizZoom,
          vizZoomFloor: snapshot.vizZoomFloor ?? state.vizZoomFloor,
          vizZoomFloorPan: snapshot.vizZoomFloorPan ?? state.vizZoomFloorPan,
          vizPanOffset: snapshot.vizPanOffset ?? state.vizPanOffset,
          fftMinDb: snapshot.fftMinDb ?? state.fftMinDb,
          fftMaxDb: snapshot.fftMaxDb ?? state.fftMaxDb,
          fftSize: snapshot.fftSize ?? state.fftSize,
          fftWindow: snapshot.fftWindow ?? state.fftWindow,
          gain: snapshot.gain ?? state.gain,
          ppm: snapshot.ppm ?? state.ppm,
          tunerAGC: snapshot.tunerAGC ?? state.tunerAGC,
          rtlAGC: snapshot.rtlAGC ?? state.rtlAGC,
          frequencyRange: snapshot.frequencyRange ?? state.frequencyRange,
        }),
      );

      if (snapshot.frequencyRange) {
        handleFrequencyRangeChange(snapshot.frequencyRange);
      }
    },
    [
      reduxDispatch,
      handleFrequencyRangeChange,
      state.activeSignalArea,
      state.frequencyRange,
      state.displayTemporalResolution,
      state.powerScale,
      state.vizZoom,
      state.vizZoomFloor,
      state.vizZoomFloorPan,
      state.vizPanOffset,
      state.fftMinDb,
      state.fftMaxDb,
      state.fftSize,
      state.fftWindow,
      state.gain,
      state.ppm,
      state.tunerAGC,
      state.rtlAGC,
    ],
  );

  const handleViewNoteCard = useCallback(
    (card: NoteCardStatsSnapshot) => {
      if (state.frequencyRange) {
        fftHistoryRef.current.push(captureSpectrumViewSnapshot());
        setFftHistoryVersion((version) => version + 1);
      }

      applySpectrumViewSnapshot({
        activeSignalArea: state.activeSignalArea,
        frequencyRange:
          card.frequencyRange ?? state.frequencyRange ?? undefined,
        displayTemporalResolution: card.temporalResolution,
        powerScale: card.powerScale,
        vizZoom: card.vizZoom,
        vizZoomFloor: state.vizZoomFloor,
        vizZoomFloorPan: state.vizZoomFloorPan,
        vizPanOffset: card.vizPanOffset,
        fftMinDb: card.fftDbMin,
        fftMaxDb: card.fftDbMax,
        fftSize: card.fftSize,
        fftWindow: card.fftWindow,
        gain: card.gain,
        ppm: card.ppm,
        tunerAGC: card.tunerAGC,
        rtlAGC: card.rtlAGC,
      });
    },
    [
      applySpectrumViewSnapshot,
      captureSpectrumViewSnapshot,
      state.activeSignalArea,
      state.frequencyRange,
      state.vizZoomFloor,
      state.vizZoomFloorPan,
    ],
  );

  const handleBackFromNoteView = useCallback(() => {
    const previous = fftHistoryRef.current.pop();
    if (!previous) return;
    setFftHistoryVersion((version) => version + 1);
    applySpectrumViewSnapshot(previous);
  }, [applySpectrumViewSnapshot]);

  // Global keyboard event listener for spacebar to pause/resume and arrows for frequency shift
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle events when not in an input field
      const isInputFocused =
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName || "",
        ) || (document.activeElement as HTMLElement)?.isContentEditable;

      if (isInputFocused) return;

      // Handle ArrowLeft/ArrowRight to move frequency by 33kHz
      if (
        (event.code === "ArrowLeft" || event.code === "ArrowRight") &&
        state.frequencyRange
      ) {
        event.preventDefault();
        event.stopPropagation();

        const shiftHz = event.code === "ArrowRight" ? 33000 : -33000;

        if (state.sourceMode === "live") {
          if (state.vizZoom > 1) {
            // Zoomed-in live mode: pan the visual display instead of changing hardware VFO
            const currentPan = state.vizPanOffset;
            const zoom = state.vizZoom;
            const fullRange =
              state.frequencyRange.max - state.frequencyRange.min;
            const visualRange = fullRange / zoom;
            const maxPan = fullRange / 2 - visualRange / 2;

            let newPan = currentPan + shiftHz;
            newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
            setVizPanOffset(newPan);

            // Auto zoom stability: track floor pan so Refocus can restore this position
            if (state.autoZoomStability && state.vizZoomFloor > 1) {
              reduxDispatch(setVizZoomFloorPan(newPan));
            }
          } else {
            // Unzoomed live mode: change hardware VFO
            const currentRange = state.frequencyRange;
            const fullRange = currentRange.max - currentRange.min;
            const newMin = currentRange.min + shiftHz;
            const newMax = newMin + fullRange;

            handleFrequencyRangeChange({ min: newMin, max: newMax });
          }
        } else if (state.sourceMode === "file") {
          // In file mode, move the visual pan offset
          const currentPan = state.vizPanOffset;
          const zoom = state.vizZoom;
          const fullRange = state.frequencyRange.max - state.frequencyRange.min;
          const visualRange = fullRange / zoom;
          const maxPan = fullRange / 2 - visualRange / 2;

          let newPan = currentPan + shiftHz;
          newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
          setVizPanOffset(newPan);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    state.sourceMode,
    state.frequencyRange,
    state.vizPanOffset,
    state.vizZoom,
    state.autoZoomStability,
    state.vizZoomFloor,
    handleFrequencyRangeChange,
    setVizPanOffset,
  ]);

  const mockTxViewSampleRateHz = resolveMockTxMonitorViewSampleRateHz({
    viewerSampleRateHz: txViewerSampleRateHz,
    fallbackSampleRateHz: state.frequencyRange
      ? state.frequencyRange.max - state.frequencyRange.min
      : null,
  });
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
    if (!isMockTxMonitorActive || !mockTxMonitorSampleRateHz) {
      return null;
    }
    const sourceViewRange = selectedSourceId
      ? sourceViewFrequencyRanges?.[selectedSourceId]
      : null;
    const fallbackCenterHz =
      (typeof mockMonitorCenterHz === "number" &&
      Number.isFinite(mockMonitorCenterHz)
        ? mockMonitorCenterHz
        : null) ??
      (Number.isFinite(txCenterFrequencyHz) ? txCenterFrequencyHz : null) ??
      centerFrequencyHz ??
      (sharedFrequencyRange ?? state.frequencyRange
        ? ((sharedFrequencyRange ?? state.frequencyRange)!.min +
            (sharedFrequencyRange ?? state.frequencyRange)!.max) /
          2
        : null);
    return resolveMockTxMonitorFrequencyRange({
      sourceViewRange,
      txCenterFrequencyHz,
      fallbackCenterFrequencyHz: fallbackCenterHz,
      sampleRateHz: mockTxMonitorSampleRateHz,
    });
  }, [
    centerFrequencyHz,
    isMockTxMonitorActive,
    mockTxMonitorSampleRateHz,
    mockMonitorCenterHz,
    sharedFrequencyRange,
    selectedSourceId,
    sourceViewFrequencyRanges,
    state.frequencyRange,
    txCenterFrequencyHz,
  ]);
  const previewVfoCenterHz = resolveTxPreviewCenterHz({
    previewCenterHz: mockTxMonitorFrequencyRange
      ? (mockTxMonitorFrequencyRange.min + mockTxMonitorFrequencyRange.max) / 2
      : mockMonitorCenterHz,
    txCenterHz: txCenterFrequencyHz,
    isPreview: isFixedTxPreview,
  });
  const latestSelectedFrame = getLatestLiveFrame(dataRef.current);
  const pausedRxFrameFrequencyRange = resolvePausedFrameFrequencyRange({
    isPaused: manualVisualizerPaused || selectedSource?.paused === true,
    isTxMode: isSelectedSourceTxMode,
    frame:
      latestSelectedFrame?.source_id === selectedSourceId
        ? latestSelectedFrame
        : null,
    sourceViewRange: selectedSourceId
      ? sourceViewFrequencyRanges?.[selectedSourceId]
      : null,
    fallbackRange: sharedFrequencyRange ?? state.frequencyRange,
  });
  const fftFrequencyRange =
    mockTxMonitorFrequencyRange ??
    pausedRxFrameFrequencyRange ??
    sharedFrequencyRange ??
    state.frequencyRange ?? { min: 0, max: 1 };
  const fftCenterFrequencyHz =
    mockTxMonitorFrequencyRange || pausedRxFrameFrequencyRange
      ? (fftFrequencyRange.min + fftFrequencyRange.max) / 2
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
  const txSettingsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastTxSettingsSyncKeyRef = useRef<string | null>(null);
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

  useLayoutEffect(() => {
    const residentFrame = getLatestLiveFrame(dataRef.current);
    if (
      !shouldInvalidateLiveFrameStateForTransport({
        expectedSourceId: expectedVisualizerSourceId,
        transportSourceId: sourceTransport?.sourceId ?? null,
        transportPhase: sourceTransport?.phase ?? null,
      }) &&
      streamingSource?.stream_epoch === undefined
    ) {
      return;
    }
    if (
      shouldPreserveRenderableFrameDuringTransportGap({
        frame: residentFrame,
        expectedSourceId: expectedVisualizerSourceId,
      })
    ) {
      return;
    }
    setHasPlayedAtLeastOnce(false);
    setHasRenderableCurrentFrame(false);
    setAcceptedFrameSampleRateHz(null);
    setPlayedSourceId(null);
  }, [
    expectedVisualizerSourceId,
    sourceTransport?.phase,
    sourceTransport?.sourceId,
    streamingSource?.stream_epoch,
    streamingSourceId,
  ]);

  const handleRenderableLiveFrameChange = useCallback(
    (hasCanvasFrame: boolean) => {
      if (!hasCanvasFrame) return;
      // FFTCanvas has already admitted this frame against expectedSourceId and
      // the presentation policy. Re-reading the mutable ref here races the
      // paint loop: the ref can advance (or be swapped) between the canvas
      // admission and this callback, causing the route to reject a frame the
      // renderer has actually accepted and leaving Loading permanently up.
      const latestFrame = getLatestLiveFrame(dataRef.current);

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
      isSelectedSourceTxMode,
      isSelectedSubscriberLocalRxView,
      streamingSource?.stream_epoch,
      streamingSourceId,
    ],
  );

  useLayoutEffect(() => {
    if (state.sourceMode !== "live") {
      previousLiveSourceIdRef.current = streamingSourceId || null;
      return;
    }
    const nextSourceId = streamingSourceId || null;
    if (!hasInitializedLiveSourceRef.current) {
      hasInitializedLiveSourceRef.current = true;
      previousLiveSourceIdRef.current = nextSourceId;
      return;
    }
    previousLiveSourceIdRef.current = nextSourceId;
  }, [state.sourceMode, streamingSourceId]);

  useEffect(() => {
    if (isSelectedMockTxTransmitting) {
      setHasPlayedAtLeastOnce(true);
      setPlayedSourceId(streamingSourceId || null);
    }
  }, [isSelectedMockTxTransmitting, streamingSourceId]);

  useEffect(() => {
    if (!transmittingTxSource) {
      lastTxSettingsSyncKeyRef.current = null;
      if (txSettingsSyncTimerRef.current) {
        clearTimeout(txSettingsSyncTimerRef.current);
        txSettingsSyncTimerRef.current = null;
      }
      return;
    }

    const rangeViewSampleRateHz = resolveMockTxMonitorViewSampleRateHz({
      viewerSampleRateHz: txViewerSampleRateHz,
      fallbackSampleRateHz: state.frequencyRange
        ? state.frequencyRange.max - state.frequencyRange.min
        : null,
    });
    const rangeViewCenterHz = resolveMockTxTransmitViewCenterHz({
      isMockTx: isMockTxSource({
        id: transmittingTxSource.id,
        kind: transmittingTxSource.kind,
      }),
      isSelectedSource: selectedSourceId === transmittingTxSource.id,
      monitorCenterHz: mockMonitorCenterHz,
      txCenterHz: txCenterFrequencyHz,
      fallbackCenterHz:
        state.frequencyRange &&
        Number.isFinite(state.frequencyRange.min) &&
        Number.isFinite(state.frequencyRange.max)
          ? (state.frequencyRange.min + state.frequencyRange.max) / 2
          : null,
    });
    // First Start Tx aligns when still attached; later slider/pan syncs stay
    // on the current monitor view.
    const alignMonitor =
      lastTxSettingsSyncKeyRef.current === null && !txMonitorDetached;
    if (alignMonitor) {
      setMockMonitorCenterHz(txCenterFrequencyHz);
      setTxMonitorDetached(false);
    }
    const transmitSettings = resolveMockTxTransmitSettings({
      txCenterHz: txCenterFrequencyHz,
      viewCenterHz: alignMonitor
        ? txCenterFrequencyHz
        : (mockMonitorCenterHz ?? rangeViewCenterHz),
      viewSampleRateHz: rangeViewSampleRateHz,
      txBandwidthHz: txSampleRateHz,
      alignMonitor,
    });
    const syncKey = JSON.stringify({
      sourceId: transmittingTxSource.id,
      txSignal,
      ...transmitSettings,
      txPowerDbm,
    });
    if (lastTxSettingsSyncKeyRef.current === syncKey) {
      return;
    }

    const sendTxSettings = () => {
      lastTxSettingsSyncKeyRef.current = syncKey;
      sendTransmitStatus?.(
        true,
        transmittingTxSource.name ?? transmittingTxSource.id,
        {
          serialNumber:
            transmittingTxSource.serial_number?.trim() ||
            transmittingTxSource.id,
          ...transmitSettings,
          powerDbm: txPowerDbm,
          txSignal,
        },
      );
    };

    if (lastTxSettingsSyncKeyRef.current === null) {
      sendTxSettings();
      return;
    }

    if (txSettingsSyncTimerRef.current) {
      clearTimeout(txSettingsSyncTimerRef.current);
    }
    txSettingsSyncTimerRef.current = setTimeout(() => {
      txSettingsSyncTimerRef.current = null;
      sendTxSettings();
    }, 16);

    return () => {
      if (txSettingsSyncTimerRef.current) {
        clearTimeout(txSettingsSyncTimerRef.current);
        txSettingsSyncTimerRef.current = null;
      }
    };
  }, [
    sendTransmitStatus,
    state.frequencyRange,
    transmittingTxSource,
    centerFrequencyHz,
    mockMonitorCenterHz,
    selectedSourceId,
    txCenterFrequencyHz,
    txMonitorDetached,
    txPowerDbm,
    txSampleRateHz,
    txViewerSampleRateHz,
    txSignal,
  ]);

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
  const autoHopRequired = useMemo(() => {
    return txHopType === "channels" && txHopChannels.length > 1;
  }, [txHopType, txHopChannels.length]);

  const isHopActive =
    (txHopEnabled || autoHopRequired) &&
    (isSelectedSourceTxMode || isSelectedMockTxTransmitting);

  const hopTargets = useMemo(() => {
    if (!isHopActive) return [];
    if (txHopType === "channels") {
      const selected = (txHopChannels || []).map((l) => l.toUpperCase());
      const targets: Array<{
        centerFrequencyHz: number;
        bandwidthHz: number;
        min: number;
        max: number;
        label: string;
      }> = [];
      for (const label of selected) {
        const ch = channelsList.find((c) => c.label.toUpperCase() === label);
        if (ch) {
          const bw = Math.max(1, ch.max - ch.min);
          const center = Math.round((ch.min + ch.max) / 2);
          targets.push({
            centerFrequencyHz: center,
            bandwidthHz: bw,
            min: ch.min,
            max: ch.max,
            label: ch.label,
          });
        }
      }
      return targets;
    } else {
      const hwRate = Math.max(1_000_000, effectiveRxSampleRate || 3_200_000);
      if (txSampleRateHz <= hwRate) {
        return [
          {
            centerFrequencyHz: txCenterFrequencyHz,
            bandwidthHz: txSampleRateHz,
            min: txCenterFrequencyHz - txSampleRateHz / 2,
            max: txCenterFrequencyHz + txSampleRateHz / 2,
            label: "range",
          },
        ];
      }
      const numSegments = Math.ceil(txSampleRateHz / hwRate);
      const startHz = txCenterFrequencyHz - txSampleRateHz / 2;
      const targets: Array<{
        centerFrequencyHz: number;
        bandwidthHz: number;
        min: number;
        max: number;
        label: string;
      }> = [];
      for (let i = 0; i < numSegments; i++) {
        const segMin = Math.round(startHz + hwRate * i);
        const segMax = Math.round(startHz + hwRate * (i + 1));
        const segCenter = Math.round((segMin + segMax) / 2);
        targets.push({
          centerFrequencyHz: segCenter,
          bandwidthHz: hwRate,
          min: segMin,
          max: segMax,
          label: `segment_${i + 1}`,
        });
      }
      return targets;
    }
  }, [
    isHopActive,
    txHopType,
    txHopChannels,
    channelsList,
    effectiveRxSampleRate,
    txSampleRateHz,
    txCenterFrequencyHz,
  ]);

  const [hopPreviewIndex, setHopPreviewIndex] = useState(0);

  useEffect(() => {
    if (
      !isHopActive ||
      hopTargets.length <= 1 ||
      isSelectedMockTxTransmitting
    ) {
      setHopPreviewIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setHopPreviewIndex((prev) => (prev + 1) % hopTargets.length);
    }, 1000);
    return () => clearInterval(timer);
  }, [isHopActive, hopTargets.length, isSelectedMockTxTransmitting]);

  const activeHopTarget = useMemo(() => {
    if (isHopActive && hopTargets.length > 1) {
      return hopTargets[hopPreviewIndex % hopTargets.length];
    }
    return null;
  }, [isHopActive, hopTargets, hopPreviewIndex]);

  const lastMockTxPreviewRequestKeyRef = useRef<string | null>(null);
  const lastMockTxPreviewRetryActiveIdRef = useRef<string | null>(null);
  const previousTxLifecycleRef = useRef<{
    sourceId: string | null;
    status: string | null;
  } | null>(null);
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
      : mockTxMonitorSampleRateHz;
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
    mockTxMonitorSampleRateHz,
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
    const nextLifecycle = {
      sourceId: selectedSourceId ?? null,
      status: selectedSourceStatus,
    };
    const previousLifecycle = previousTxLifecycleRef.current;
    previousTxLifecycleRef.current = nextLifecycle;

    if (
      !previousLifecycle ||
      previousLifecycle.sourceId !== nextLifecycle.sourceId ||
      !shouldRequestTxLifecycleFrame({
        previousStatus: previousLifecycle.status,
        nextStatus: nextLifecycle.status,
      }) ||
      !isConnected ||
      (!isMockTxMonitorActive && !selectedSourceModeManagement.canTransmit)
    ) {
      return;
    }

    if (nextLifecycle.status !== "transmitting") {
      // Let the normal standby effect issue the single preview request, but
      // clear its dedupe fence because this is a new global Tx stop event.
      lastMockTxPreviewRequestKeyRef.current = null;
      return;
    }

    // A different client may have started the global Tx stream while this
    // client was paused on the Tx view. Refresh that client once immediately;
    // the managed stream remains responsible for all subsequent live frames.
    lastMockTxPreviewRequestKeyRef.current = mockTxPreviewRequestKey;
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
      : mockTxMonitorSampleRateHz;
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
  }, [
    activeHopTarget,
    isConnected,
    isMockTxMonitorActive,
    mockMonitorCenterHz,
    mockTxMonitorSampleRateHz,
    mockTxPreviewRequestKey,
    reduxDispatch,
    selectedSourceId,
    selectedSourceModeManagement.canTransmit,
    selectedSourceStatus,
    txCenterFrequencyHz,
    txIfftSize,
    txMonitorDetached,
    txPowerDbm,
    txSampleRateHz,
    txSignal,
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

    // Every standby preview, including half-duplex hardware, must use the
    // source-owned one-shot request. The Tx-suite action establishes the
    // binding, but it does not produce a frame; leaving that action here
    // leaves the paused Rx frame on the canvas until the user starts Tx.
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
      : mockTxMonitorSampleRateHz;

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
    isConnected,
    isMockTxMonitorActive,
    isSelectedSourceTransmitting,
    isSelectedSourceTxStatus,
    isSelectedMockTxPaused,
    isSelectedTxPreviewStandby,
    isSelectedMockTxTransmitting,
    isSwitchingLiveSource,
    liveSourceLifecycle.phase,
    mockTxPreviewRequestKey,
    dataRef,
    mockMonitorCenterHz,
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

  // A paused live RX source whose frozen frame is gone (a reconnect resets the
  // presentation controller and drops the stream, and the backend publishes
  // nothing while paused) must re-seat it with a real one-shot frame. Without
  // this the canvas has nothing to paint and would show a stale or synthetic
  // spectrum. The request is bounded so a source that cannot serve a frame
  // cannot drive a request loop.
  const pausedRxSlot = selectedSourceId
    ? presentationController.getSlot(selectedSourceId, "rx")
    : null;
  const hasSalvageablePausedFrame = !!(
    pausedRxSlot &&
    (pausedRxSlot.frozenFrame !== null || pausedRxSlot.liveFrameRef.current)
  );
  const shouldRecoverLostPausedFrame = shouldRecoverPausedFrame({
    sourceMode: state.sourceMode,
    isPaused: manualVisualizerPaused,
    isConnected,
    isTxMode: isSelectedSourceTxMode,
    isMockTxSource: isMockTxMonitorActive,
    hasSalvageableFrame: hasSalvageablePausedFrame,
    hasIqFormat: selectedSource?.iq_format != null,
    transportPhase: sourceTransport.phase,
    selectedSourceId,
    activeSourceId,
  });
  useEffect(() => {
    if (!shouldRecoverLostPausedFrame) return;

    let attempts = 0;
    let timeoutId: number | null = null;

    const scheduleNext = () => {
      timeoutId = window.setTimeout(() => {
        attempts += 1;
        reduxDispatch(
          requestNextPausedFrame({
            sourceId: selectedSourceId ?? undefined,
            frequencyRange: fftFrequencyRange,
          }),
        );
        if (attempts < PAUSED_FRAME_RECOVERY_MAX_ATTEMPTS) {
          scheduleNext();
        }
      }, PAUSED_FRAME_RECOVERY_RETRY_MS);
    };

    scheduleNext();
    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [
    fftFrequencyRange.max,
    fftFrequencyRange.min,
    reduxDispatch,
    selectedSourceId,
    shouldRecoverLostPausedFrame,
    state.fftSize,
    webGpuStreamResetEpoch,
  ]);

  useEffect(() => {
    if (!isHopActive || !activeHopTarget) return;
    // Single atomic dispatch: view range, planned Tx, and sample rate move
    // together as one hop-preview step.
    reduxDispatch(
      setTxHopPreviewState({
        frequencyRange: { min: activeHopTarget.min, max: activeHopTarget.max },
        txCenterFrequencyHz: activeHopTarget.centerFrequencyHz,
        txSampleRateHz: activeHopTarget.bandwidthHz,
        sampleRateHz: activeHopTarget.bandwidthHz,
        activeSignalArea:
          activeHopTarget.label && activeHopTarget.label !== "range"
            ? activeHopTarget.label
            : undefined,
      }),
    );
    setMockMonitorCenterHz(activeHopTarget.centerFrequencyHz);
  }, [isHopActive, activeHopTarget, reduxDispatch]);

  // Keep the last painted frame available during handoff. FFTCanvas rejects
  // frames that do not match expectedSourceId, while its existing presentation
  // remains visible until the target frame arrives or loading exceeds grace.
  const fftDataRef = dataRef;
  const presentedLiveSourceLifecycle = liveSourceLifecycle;
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
      const sourceViewRange = selectedSourceId
        ? sourceViewFrequencyRanges?.[selectedSourceId]
        : null;
      if (
        isSelectedMockTxTransmitting &&
        state.sourceMode === "live" &&
        sourceViewRange
      ) {
        const nextRange = resolveSourceViewPanRange(sourceViewRange, nextPan);
        if (nextRange) {
          handleFrequencyRangeChange(nextRange);
          setVizPanOffset(0);
          return;
        }
      }

      publishSubscriberLocalVizPan(nextPan, setVizPanOffset);
    },
    [
      handleFrequencyRangeChange,
      isSelectedMockTxTransmitting,
      selectedSourceId,
      setVizPanOffset,
      sourceViewFrequencyRanges,
      state.sourceMode,
    ],
  );
  const handleVizZoomPanChange = useCallback(
    (nextPan: number) => {
      publishSubscriberLocalVizPan(nextPan, setVizPanOffset);
    },
    [setVizPanOffset],
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
        {fftHistoryRef.current.length > 0 ? (
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

  const readLiveStateDiagnosticsRuntime = useCallback(() => {
    const latestFrame = getLatestLiveFrame(dataRef.current);
    return {
      renderer: {
        routeAcceptsLatestFrame: latestFrame
          ? resolveSelectedSourceFrameReadiness({
              frame: latestFrame,
              selectedSourceId: expectedVisualizerSourceId,
              activeSourceId: activeSourceId || streamingSourceId || null,
              mode: isSelectedSourceTxMode ? "tx" : "rx",
              subscriberLocalRxView: isSelectedSubscriberLocalRxView,
              expectedStreamEpoch: expectedLegacyStreamEpoch,
              frameCounter: latestFrame.source_id ? 1 : 0,
              handoffStartedFrameCounter: 0,
            })
          : false,
        latestFrame: latestFrame
          ? {
              sourceId: latestFrame.source_id ?? null,
              streamEpoch: latestFrame.stream_epoch ?? null,
              sequence: latestFrame.sequence ?? null,
              frameStatus: latestFrame.frame_status ?? null,
              iqLength: latestFrame.iq_data?.length ?? null,
            }
          : null,
      },
      managedStream: getManagedStreamDebugSnapshot(),
    };
  }, [
    activeSourceId,
    dataRef,
    expectedLegacyStreamEpoch,
    expectedVisualizerSourceId,
    isSelectedSourceTxMode,
    isSelectedSubscriberLocalRxView,
    streamingSourceId,
  ]);

  const liveStateDiagnosticsInput = useMemo<LiveStateDiagnosticsInput>(
    () => ({
      redux: {
        connectionStatus,
        isConnected,
        activeSourceId: activeSourceId ?? null,
        activeSourceStatus: activeSourceId
          ? (sourceStatuses?.[activeSourceId] ??
            sources.find((source) => source.id === activeSourceId)?.status ??
            null)
          : null,
        activeSourceMode: state.sourceMode ?? null,
        availableSourceIds: sources.map((source) => source.id),
        isPaused: manualVisualizerPaused,
        selectedSourceId: selectedSourceId ?? null,
        selectedSourceStatus: selectedSourceStatus ?? null,
        sourceTransportByMode,
        sourceFrameReadinessByMode,
      },
      renderer: {
        lifecyclePhase: liveSourceLifecycle.phase,
        placeholderKind: livePlaceholderState?.kind ?? null,
        hasRenderableCurrentFrame,
        hasPlayedAtLeastOnce,
        expectedSourceId: expectedVisualizerSourceId,
        expectedStreamEpoch: expectedLegacyStreamEpoch,
        routeAcceptsLatestFrame: null,
        latestFrame: null,
      },
      managedStream: getManagedStreamDebugSnapshot(),
    }),
    [
      activeSourceId,
      sources,
      sourceStatuses,
      connectionStatus,
      expectedLegacyStreamEpoch,
      expectedVisualizerSourceId,
      hasPlayedAtLeastOnce,
      hasRenderableCurrentFrame,
      isConnected,
      isSelectedSourceTxMode,
      isSelectedSubscriberLocalRxView,
      livePlaceholderState?.kind,
      liveSourceLifecycle.phase,
      manualVisualizerPaused,
      selectedSourceId,
      selectedSourceStatus,
      sourceFrameReadinessByMode,
      sourceTransportByMode,
      streamingSourceId,
      state.sourceMode,
    ],
  );

  return (
    <SpectrumContainer>
      <SpectrumContent>
        {state.sourceMode === "live" &&
          fftFrequencyRange &&
          fftCenterFrequencyHz !== null && (
            <>
              {shouldRenderLiveStateDiagnostics ? (
                <LiveStateDiagnostics
                  input={liveStateDiagnosticsInput}
                  readRuntimeState={readLiveStateDiagnosticsRuntime}
                />
              ) : null}
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
                powerScale={visualizerPowerScale}
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
                onVizZoomPanChange={handleVizZoomPanChange}
                onVizZoomFloorChange={setVizZoomFloor}
                onVizZoomFloorPanChange={handleVizZoomFloorPanChange}
                onVizPanChange={handleVizPanChange}
                fftMin={
                  isSelectedMockTxSource
                    ? visualizerDbLimits.min
                    : state.fftMinDb
                }
                fftMax={
                  isSelectedMockTxSource
                    ? visualizerDbLimits.max
                    : state.fftMaxDb
                }
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
