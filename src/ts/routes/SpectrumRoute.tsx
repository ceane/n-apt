import React, {
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FFTAndWaterfall, NoteCards } from "@n-apt/components";
import type { FFTCanvasHandle } from "@n-apt/components";
import FFTPlaybackCanvas from "@n-apt/components/FFTPlaybackCanvas";
import { EditableCenterFrequency } from "@n-apt/components/ui/EditableCenterFrequency";
import { FrequencyInput } from "@n-apt/components/ui/FrequencyInput";
import type { CanvasPlaceholderState } from "@n-apt/components/ui/CanvasPlaceholder";
import { useSnapshot } from "@n-apt/hooks/useSnapshot";
import type {
  DeviceProfile,
  FrequencyRange,
} from "@n-apt/consts/schemas/websocket";
import type { TemporalResolution } from "@n-apt/utils/temporalResolution";

import {
  InitializingContainer,
  InitializingTitle,
  InitializingText,
} from "@n-apt/components/Layout";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { getLiveFrameRefForSource } from "@n-apt/visualization/frameRuntime";
import { buildSdrLimitMarkers } from "@n-apt/utils/sdrLimitMarkers";
import { getSourceViewStorageKeyForSource } from "@n-apt/utils/sourcePersistence";
import { isMockTxSource } from "@n-apt/utils/deviceCapabilities";
import {
  getVisualizerLifecycleKey,
  resolveWebGpuStreamTransition,
} from "@n-apt/utils/webgpuStreamReset";
import { calculateCenterFrequency } from "@n-apt/utils/centerFrequency";
import {
  useSnapshotListener,
  buildSnapshotSettingsLabel,
} from "@n-apt/hooks/useSnapshotListener";
import { useDeviceConnectionState } from "@n-apt/hooks/useDeviceConnectionState";
import { useCaptureWholeChannelSegments } from "@n-apt/hooks/useCaptureWholeChannelSegments";
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
  setActiveSignalArea,
  setStitchStatus,
  resetWaterfallCleared,
  setVizZoom as setVizZoomAction,
  setVizZoomFloor as setVizZoomFloorAction,
  setVizPan as setVizPanAction,
  setVizZoomFloorPan,
  setFftDbLimits,
  setSdrSettingsBundle,
  setSampleRate as setSampleRateAction,
  selectSourceTransportSnapshot,
} from "@n-apt/redux";
import { selectTxHopChannels } from "@n-apt/redux/selectors/spectrumSelectors";
import {
  clampFrequencyRangeToBounds,
  buildCenteredFrequencyRange,
  normalizeFrequencyRangeToHz,
  resolveCenteredFrequencyHz,
  resolveMockTxMonitorCenterHz,
} from "@n-apt/utils/frequency";
import { resolveCanonicalDisplaySampleRateHz } from "@n-apt/utils/sdrSampleRateGuards";
import {
  getLatestLiveFrame,
  resolveFrameReadiness,
  resolveLiveDevicePlaceholderState,
} from "@n-apt/utils/liveSourcePresentation";
import { resolveSourceModeManagement } from "@n-apt/utils/sourceModeManagement";
import { resolveTxSliderCenterHz } from "@n-apt/utils/txSliderPlacement";
import {
  attachLiveSourceLifecyclePlaceholder,
  isCurrentSourceFrameReady,
  isLiveSourceAwaitingFrame,
  isLiveSourceHandoffPending,
  shouldRequestMockTxStandbyPreview,
  shouldPresentMockTxStandby,
  useLiveSourceLifecycle,
} from "@n-apt/hooks/liveSourceLifecycle";
import { requestNextLiveFrame } from "@n-apt/redux/thunks/websocketThunks";
import {
  getMockTxPreviewRequestKey,
  resolveMockTxMonitorSampleRateForView,
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

export { resolveLiveDevicePlaceholderState } from "@n-apt/utils/liveSourcePresentation";
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
  const [, setFftHistoryVersion] = useState(0);
  const [fftSnapshotLoading, setFftSnapshotLoading] = useState(false);
  const [showStatsSpectrum, setShowStatsSpectrum] = useState(false);
  const [showStatsWaterfall, setShowStatsWaterfall] = useState(false);
  const [isCenterFrequencyEditing, setIsCenterFrequencyEditing] =
    useState(false);
  const [isTxOptionsEditing, setIsTxOptionsEditing] = useState(false);
  const [hasPlayedAtLeastOnce, setHasPlayedAtLeastOnce] = useState(false);
  const [hasRenderableCurrentFrame, setHasRenderableCurrentFrame] =
    useState(false);
  const [playedSourceId, setPlayedSourceId] = useState<string | null>(null);
  const txOptionsRef = useRef<HTMLDivElement | null>(null);
  const txSignal = useAppSelector((state) => state.spectrum.txSignal || "wifi");
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
  const { sourceStatuses, sourceTransport, sourceFrameReadiness } =
    useAppSelector(selectSourceTransportSnapshot);
  const getTxSliderDefaults = useCallback(
    (range: FrequencyRange, fallbackCenterHz: number) => {
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
        centerHz: txCenterFrequencyHz,
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
      sendTransmitMode,
      sendPowerScaleCommand: _sendPowerScaleCommand,
    },
    sampleRateHzEffective,
    toggleVisualizerPause,
  } = useSpectrumStore();
  const dataRef =
    wsDataRef ??
    getLiveFrameRefForSource(selectedSourceId || activeSourceId);
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
  // supports_tx_monitor is a capability, not the current mode. The Tx
  // monitor pipeline must only be active after an explicit Tx-mode switch.
  const isMockTxMonitorActive =
    isSelectedMockTxSource &&
    (isSelectedSourceTxMode || selectedSource?.kind === "mock_tx");
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
      // the same source boundary as the GPU presentation cache.
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
  const shouldShowMockTxStandby = shouldPresentMockTxStandby({
    isSelectedMockTxSource: isMockTxMonitorActive,
    isSelectedMockTxTransmitting,
    isSelectedMockTxPaused,
    selectedSourceId,
    transportSourceId: sourceTransport?.sourceId ?? null,
    transportPhase: sourceTransport?.phase ?? "idle",
  });
  const liveSourceLifecycle = useLiveSourceLifecycle({
    isLive: state.sourceMode === "live",
    selectedSourceId: selectedSourceId || null,
    activeSourceId: activeSourceId || null,
    transportSourceId: sourceTransport?.sourceId ?? null,
    transportPhase: sourceTransport?.phase ?? "idle",
    transportError: sourceTransport?.error ?? null,
    readinessSequence: sourceFrameReadiness?.sequence ?? null,
    readiness: sourceFrameReadiness,
    presentedSourceId: getLatestLiveFrame(dataRef.current)?.source_id ?? null,
    hasValidFrame:
      isCurrentSourceFrameReady({
        selectedSourceId: selectedSourceId || null,
        activeSourceId: activeSourceId || null,
        expectedStreamEpoch: streamingSource?.stream_epoch ?? null,
        readiness: sourceFrameReadiness,
      }) ||
      hasRenderableCurrentFrame ||
      (isSelectedMockTxSource
        ? selectedSourceId === activeSourceId && hasPlayedAtLeastOnce
        : hasActiveSourceFrame),
    deviceStatus: selectedSourceStatus,
    isStandby:
      shouldShowMockTxStandby &&
      selectedSourceId === activeSourceId &&
      !isSelectedMockTxTransmitting,
  });
  const isSwitchingLiveSource = isLiveSourceHandoffPending(liveSourceLifecycle);
  const isSourceHandoffOverlayPending =
    isLiveSourceAwaitingFrame(liveSourceLifecycle);
  // Use selectedSourceId for the reset key so it changes when user selects a new source,
  // even before it becomes the active streaming source. This ensures GPU state resets
  // during the loading phase when switching from mock to hardware.
  const visualizerLifecycleKey = getVisualizerLifecycleKey({
    sourceId: selectedSourceId || streamingSourceId || null,
    epoch: webGpuStreamResetEpoch,
    status: selectedSourceStatus,
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
  const canShowTxSlider =
    isSelectedSourceTxMode || isSelectedSourceTransmitting;

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
    recordingSecondsRemaining,
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

  const fastSpectrumSnapshotAction = useMemo<ReactNode>(() => {
    const spectrumCanvas = fftCanvasRef.current?.getSpectrumCanvas();
    const spectrumWidth = spectrumCanvas?.width ?? 1;
    const spectrumHeight =
      spectrumCanvas?.height ?? FAST_SPECTRUM_FALLBACK_HEIGHT;

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

    return (
      <FastSnapshotControl
        disabled={
          fftSnapshotLoading ||
          (isRecording !== null && isRecording !== "spectrum")
        }
        isRecording={isRecording === "spectrum"}
        recordingSecondsRemaining={recordingSecondsRemaining}
        videoFormat={supportedVideoFormat}
        showStats={showStatsSpectrum}
        onShowStatsChange={setShowStatsSpectrum}
        onImage={() =>
          takeFastSnapshot(
            "spectrum",
            () => fftCanvasRef.current?.getSnapshotData() ?? null,
            spectrumWidth,
            spectrumHeight,
            getCanvases,
            {
              showStats: showStatsSpectrum,
              activeSignalArea: state.activeSignalArea,
              activeSignalAreaBounds,
              sourceName,
              sdrSettingsLabel,
              gain: state.gain ?? undefined,
              ppm: state.ppm ?? undefined,
              fftSize: state.fftSize ?? undefined,
            },
          )
        }
        onVideo={() =>
          startFastRecording(
            "spectrum",
            () => fftCanvasRef.current?.getSnapshotData() ?? null,
            () => ({
              width: fftCanvasRef.current?.getSpectrumCanvas()?.width ?? 1,
              height:
                fftCanvasRef.current?.getSpectrumCanvas()?.height ??
                FAST_SPECTRUM_FALLBACK_HEIGHT,
            }),
            "fast-fft-recording",
            getCanvases,
            {
              showStats: showStatsSpectrum,
              activeSignalArea: state.activeSignalArea,
              activeSignalAreaBounds,
              getActiveSignalArea: () => state.activeSignalArea,
              getActiveSignalAreaBounds: () =>
                signalAreaBounds?.[state.activeSignalArea] ??
                signalAreaBounds?.[state.activeSignalArea?.toLowerCase?.()] ??
                null,
              sourceName,
              sdrSettingsLabel,
              gain: state.gain ?? undefined,
              ppm: state.ppm ?? undefined,
              fftSize: state.fftSize ?? undefined,
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
  }, [
    isRecording,
    fftCanvasRef,
    fftSnapshotLoading,
    recordingSecondsRemaining,
    supportedVideoFormat,
    takeFastSnapshot,
    startFastRecording,
    stopFastRecording,
    getCanvases,
    showStatsSpectrum,
    state.activeSignalArea,
    activeSignalAreaBounds,
    signalAreaBounds,
    effectiveSdrSettings,
    state.gain,
    state.ppm,
    state.hackrfLnaGain,
    state.hackrfVgaGain,
    state.hackrfAmpEnabled,
    state.hackrfBasebandBandwidth,
    selectedSourceDerived.deviceProfile?.kind,
    selectedSourceDerived.deviceName,
    deviceProfile?.kind,
    deviceKind,
    deviceName,
    isConnected,
  ]);

  const fastWaterfallSnapshotAction = useMemo<ReactNode>(() => {
    const waterfallCanvas = fftCanvasRef.current?.getWaterfallCanvas();
    const waterfallWidth = waterfallCanvas?.width ?? 1;
    const waterfallHeight =
      waterfallCanvas?.height ?? FAST_WATERFALL_FALLBACK_HEIGHT;

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

    return (
      <FastSnapshotControl
        disabled={
          fftSnapshotLoading ||
          (isRecording !== null && isRecording !== "waterfall")
        }
        isRecording={isRecording === "waterfall"}
        recordingSecondsRemaining={recordingSecondsRemaining}
        videoFormat={supportedVideoFormat}
        showStats={showStatsWaterfall}
        onShowStatsChange={setShowStatsWaterfall}
        onImage={() =>
          takeFastSnapshot(
            "waterfall",
            () => fftCanvasRef.current?.getSnapshotData() ?? null,
            waterfallWidth,
            waterfallHeight,
            getCanvases,
            {
              showStats: showStatsWaterfall,
              activeSignalArea: state.activeSignalArea,
              activeSignalAreaBounds,
              sourceName,
              sdrSettingsLabel,
              gain: state.gain ?? undefined,
              ppm: state.ppm ?? undefined,
              fftSize: state.fftSize ?? undefined,
            },
          )
        }
        onVideo={() =>
          startFastRecording(
            "waterfall",
            () => fftCanvasRef.current?.getSnapshotData() ?? null,
            () => ({
              width: fftCanvasRef.current?.getWaterfallCanvas()?.width ?? 1,
              height:
                fftCanvasRef.current?.getWaterfallCanvas()?.height ??
                FAST_WATERFALL_FALLBACK_HEIGHT,
            }),
            "fast-waterfall-recording",
            getCanvases,
            {
              showStats: showStatsWaterfall,
              activeSignalArea: state.activeSignalArea,
              activeSignalAreaBounds,
              getActiveSignalArea: () => state.activeSignalArea,
              getActiveSignalAreaBounds: () =>
                signalAreaBounds?.[state.activeSignalArea] ??
                signalAreaBounds?.[state.activeSignalArea?.toLowerCase?.()] ??
                null,
              sourceName,
              sdrSettingsLabel,
              gain: state.gain ?? undefined,
              ppm: state.ppm ?? undefined,
              fftSize: state.fftSize ?? undefined,
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
  }, [
    isRecording,
    fftCanvasRef,
    fftSnapshotLoading,
    recordingSecondsRemaining,
    supportedVideoFormat,
    takeFastSnapshot,
    startFastRecording,
    stopFastRecording,
    getCanvases,
    showStatsWaterfall,
    state.activeSignalArea,
    activeSignalAreaBounds,
    signalAreaBounds,
    effectiveSdrSettings,
    state.gain,
    state.ppm,
    state.hackrfLnaGain,
    state.hackrfVgaGain,
    state.hackrfAmpEnabled,
    state.hackrfBasebandBandwidth,
    selectedSourceDerived.deviceProfile?.kind,
    selectedSourceDerived.deviceName,
    deviceProfile?.kind,
    deviceKind,
    deviceName,
    isConnected,
  ]);

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

  const notesActionPill = (
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

  const handleFrequencyRangeChange = useCallback(
    (range: FrequencyRange) => {
      const zoomed = state.vizZoom > 1;
      const primaryBounds = zoomed
        ? hardwareSpectrumBounds
        : activeSignalAreaBounds;
      const clampedRange = normalizeFrequencyRangeToHz(
        primaryBounds
          ? clampFrequencyRangeToBounds(range, primaryBounds)
          : range,
      );
      reduxDispatch(setFrequencyRange(clampedRange));
      sendFrequencyRange(clampedRange);
    },
    [
      sendFrequencyRange,
      dispatch,
      reduxDispatch,
      hardwareSpectrumBounds,
      activeSignalAreaBounds,
      state.vizZoom,
    ],
  );

  const handleCenterFrequencyChange = useCallback(
    (nextCenterFrequencyHz: number) => {
      if (!state.frequencyRange) return;

      const spanHz = state.frequencyRange.max - state.frequencyRange.min;
      handleFrequencyRangeChange(
        buildCenteredFrequencyRange(nextCenterFrequencyHz, spanHz),
      );
    },
    [handleFrequencyRangeChange, state.frequencyRange],
  );

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

  const centerFrequencyHz = useMemo(() => {
    return calculateCenterFrequency(state.frequencyRange);
  }, [state.frequencyRange]);

  const syncMockTxSettingsFromSlider = useCallback(
    (centerFrequencyHz: number, sampleRateHzOverride?: number) => {
      if (
        !Number.isFinite(centerFrequencyHz) ||
        !isMockTxMonitorActive ||
        !isConnected ||
        isSwitchingLiveSource
      ) {
        return;
      }

      const viewSampleRateHz = state.frequencyRange
        ? state.frequencyRange.max - state.frequencyRange.min
        : undefined;
      const effectiveTxSampleRateHz =
        typeof sampleRateHzOverride === "number" &&
        Number.isFinite(sampleRateHzOverride)
          ? sampleRateHzOverride
          : txSampleRateHz;
      const viewCenterHz =
        state.frequencyRange &&
        Number.isFinite(state.frequencyRange.min) &&
        Number.isFinite(state.frequencyRange.max)
          ? (state.frequencyRange.min + state.frequencyRange.max) / 2
          : centerFrequencyHz;
      const txSettings = {
        centerFrequencyHz,
        viewCenterHz,
        bandwidthHz: effectiveTxSampleRateHz,
        sampleRateHz: viewSampleRateHz,
        powerDbm: txPowerDbm,
        txSignal,
        txIfftSize,
      };

      if (!isSelectedMockTxTransmitting) return;
      const fallbackId = selectedSourceId || selectedSource?.id;
      if (!fallbackId) return;
      sendTransmitMode?.(true, selectedSource?.name ?? fallbackId, {
        serialNumber: selectedSource?.serial_number?.trim() || fallbackId,
        ...txSettings,
      });
    },
    [
      centerFrequencyHz,
      isConnected,
      isMockTxMonitorActive,
      isSelectedMockTxTransmitting,
      isSwitchingLiveSource,
      selectedSource,
      selectedSourceId,
      sendTransmitMode,
      state.frequencyRange,
      txIfftSize,
      txPowerDbm,
      txSampleRateHz,
      txSignal,
    ],
  );

  const handleCenterFrequencyChangeFromSlider = useCallback(
    (value: number, isDragging?: boolean) => {
      isDraggingTxRef.current = !!isDragging;
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }
      if (isDragging) {
        isDraggingTxRef.current = true;
      } else {
        isDraggingTxRef.current = false;
      }

      reduxDispatch(setTxCenterFrequencyHz(value));
      syncMockTxSettingsFromSlider(value);
    },
    [reduxDispatch, syncMockTxSettingsFromSlider],
  );

  // Keep the Mock Tx monitor view centered on the view center frequency.
  useEffect(() => {
    if (Number.isFinite(txCenterFrequencyHz) && !isDraggingTxRef.current) {
      setMockMonitorCenterHz(txCenterFrequencyHz);
    }
  }, [txCenterFrequencyHz]);

  // Sync mockMonitorCenterHz with state.frequencyRange on edge panning
  useEffect(() => {
    if (
      state.frequencyRange &&
      isMockTxMonitorActive &&
      isDraggingTxRef.current
    ) {
      const center = (state.frequencyRange.min + state.frequencyRange.max) / 2;
      setMockMonitorCenterHz(center);
    }
  }, [state.frequencyRange, isMockTxMonitorActive]);

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
  }, [state]);

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
    [handleFrequencyRangeChange, reduxDispatch, state],
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
    state.activeSignalArea,
    state.vizPanOffset,
    state.vizZoom,
    state.autoZoomStability,
    state.vizZoomFloor,
    signalAreaBounds,
    toggleVisualizerPause,
    handleFrequencyRangeChange,
    setVizPanOffset,
    dispatch,
  ]);

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
    const monitorCenterHz = resolveMockTxMonitorCenterHz(
      txCenterFrequencyHz,
      fallbackCenterHz,
    );
    return buildCenteredFrequencyRange(
      monitorCenterHz,
      mockTxMonitorSampleRateHz,
    );
  }, [
    centerFrequencyHz,
    isMockTxMonitorActive,
    mockTxMonitorSampleRateHz,
    sharedFrequencyRange,
    state.frequencyRange,
    txCenterFrequencyHz,
  ]);
  const fftFrequencyRange =
    mockTxMonitorFrequencyRange ?? sharedFrequencyRange ?? state.frequencyRange;
  const fftCenterFrequencyHz = mockTxMonitorFrequencyRange
    ? resolveMockTxMonitorCenterHz(txCenterFrequencyHz, centerFrequencyHz ?? 0)
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
        Number.isFinite(txCenterFrequencyHz)
          ? txCenterFrequencyHz
          : (centerFrequencyHz ?? 0),
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
    setHasPlayedAtLeastOnce(false);
    setHasRenderableCurrentFrame(false);
    setAcceptedFrameSampleRateHz(null);
    setPlayedSourceId(null);
  }, [streamingSource?.stream_epoch, streamingSourceId]);

  const handleRenderableLiveFrameChange = useCallback(
    (hasCanvasFrame: boolean) => {
      if (!hasCanvasFrame) return;
      const latestFrame = getLatestLiveFrame(dataRef.current);
      const isReady = resolveFrameReadiness({
        frame: latestFrame,
        selectedSourceId: expectedVisualizerSourceId,
        activeSourceId: activeSourceId || streamingSourceId || null,
        expectedStreamEpoch: streamingSource?.stream_epoch ?? null,
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
      expectedVisualizerSourceId,
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

    const viewSampleRateHz = state.frequencyRange
      ? state.frequencyRange.max - state.frequencyRange.min
      : undefined;
    const viewCenterHz =
      state.frequencyRange &&
      Number.isFinite(state.frequencyRange.min) &&
      Number.isFinite(state.frequencyRange.max)
        ? (state.frequencyRange.min + state.frequencyRange.max) / 2
        : centerFrequencyHz;
    const syncKey = JSON.stringify({
      sourceId: transmittingTxSource.id,
      txSignal,
      txCenterFrequencyHz,
      viewCenterHz,
      txSampleRateHz,
      viewSampleRateHz: viewSampleRateHz,
      txPowerDbm,
    });
    if (lastTxSettingsSyncKeyRef.current === syncKey) {
      return;
    }

    const sendTxSettings = () => {
      lastTxSettingsSyncKeyRef.current = syncKey;
      sendTransmitMode?.(
        true,
        transmittingTxSource.name ?? transmittingTxSource.id,
        {
          serialNumber:
            transmittingTxSource.serial_number?.trim() ||
            transmittingTxSource.id,
          centerFrequencyHz: txCenterFrequencyHz,
          viewCenterHz,
          bandwidthHz: txSampleRateHz,
          sampleRateHz: viewSampleRateHz,
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
    sendTransmitMode,
    state.frequencyRange,
    transmittingTxSource,
    centerFrequencyHz,
    txCenterFrequencyHz,
    txPowerDbm,
    txSampleRateHz,
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

  const isHopActive = txHopEnabled || autoHopRequired;

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
  const mockTxPreviewRequestKey = useMemo(() => {
    const reqCenter = activeHopTarget?.centerFrequencyHz ?? txCenterFrequencyHz;
    const reqViewCenter =
      activeHopTarget?.centerFrequencyHz ??
      (Number.isFinite(txCenterFrequencyHz)
        ? txCenterFrequencyHz
        : mockMonitorCenterHz);
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
      `|viewCenter:${reqViewCenter}|viewSpan:${viewSampleRateHz}|hop:${hopPreviewIndex}`
    );
  }, [
    selectedSourceId,
    txIfftSize,
    txCenterFrequencyHz,
    txPowerDbm,
    txSampleRateHz,
    txSignal,
    mockMonitorCenterHz,
    state.frequencyRange,
    activeHopTarget,
    hopPreviewIndex,
  ]);

  useEffect(() => {
    const shouldRequestPreview = shouldRequestMockTxStandbyPreview({
      isSelectedMockTxSource: isMockTxMonitorActive,
      isSelectedMockTxTransmitting,
      isSelectedMockTxPaused,
      isConnected,
      phase: liveSourceLifecycle.phase,
    });
    if (!shouldRequestPreview) {
      lastMockTxPreviewRequestKeyRef.current = null;
      return;
    }
    if (lastMockTxPreviewRequestKeyRef.current === mockTxPreviewRequestKey) {
      return;
    }
    lastMockTxPreviewRequestKeyRef.current = mockTxPreviewRequestKey;
    dataRef.current = null;

    const reqCenter = activeHopTarget?.centerFrequencyHz ?? txCenterFrequencyHz;
    const reqViewCenter =
      activeHopTarget?.centerFrequencyHz ??
      (Number.isFinite(txCenterFrequencyHz)
        ? txCenterFrequencyHz
        : mockMonitorCenterHz);
    const reqBandwidth = activeHopTarget?.bandwidthHz ?? txSampleRateHz;
    const reqSampleRate = activeHopTarget
      ? activeHopTarget.bandwidthHz
      : state.frequencyRange
        ? state.frequencyRange.max - state.frequencyRange.min
        : undefined;

    // Handoff requests are source-owned; once the target is active, the
    // normal frame request carries the exact Tx preview settings.
    if (isSwitchingLiveSource) {
      reduxDispatch({ type: "txSuite/requestPreview" });
      lastMockTxPreviewRequestKeyRef.current = null;
    } else {
      reduxDispatch(
        requestNextLiveFrame({
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
    isSelectedMockTxPaused,
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
    txPowerDbm,
    txSampleRateHz,
    txSignal,
  ]);

  useEffect(() => {
    if (isHopActive && activeHopTarget) {
      const range = { min: activeHopTarget.min, max: activeHopTarget.max };
      reduxDispatch(setFrequencyRange(range));
      reduxDispatch(setTxCenterFrequencyHz(activeHopTarget.centerFrequencyHz));
      reduxDispatch(setTxSampleRateHz(activeHopTarget.bandwidthHz));
      reduxDispatch(setSampleRateAction(activeHopTarget.bandwidthHz));
      setMockMonitorCenterHz(activeHopTarget.centerFrequencyHz);
      if (activeHopTarget.label && activeHopTarget.label !== "range") {
        reduxDispatch(setActiveSignalArea(activeHopTarget.label));
      }
    }
  }, [isHopActive, activeHopTarget, reduxDispatch, dispatch]);

  // Keep the last painted frame available during handoff. FFTCanvas rejects
  // frames that do not match expectedSourceId, while its existing presentation
  // remains visible until the target frame arrives or loading exceeds grace.
  const fftDataRef = dataRef;
  const mockTxPlaceholderState = useMemo<CanvasPlaceholderState | null>(() => {
    if (!shouldShowMockTxStandby) {
      return null;
    }
    const presentedFrameSourceId =
      getLatestLiveFrame(dataRef.current)?.source_id ?? null;
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
    shouldShowMockTxStandby,
    sources,
    selectedSource?.name,
    selectedSourceDerived.deviceName,
    dataRef,
  ]);
  const deviceRecoveryPlaceholderState =
    useMemo<CanvasPlaceholderState | null>(() => {
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
        standbyPlaceholder: mockTxPlaceholderState,
      }),
    [
      deviceRecoveryPlaceholderState,
      liveSourceLifecycle,
      mockTxPlaceholderState,
      sourceHandoffPlaceholderState,
    ],
  );
  const livePlaceholderState = presentedLiveSourceLifecycle.placeholder;
  const isDeviceRecovering =
    presentedLiveSourceLifecycle.phase === "recovering";
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

      setVizPanOffset(nextPan);
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
                        onCenterFrequencyChange:
                          handleCenterFrequencyChangeFromSlider,
                        onSampleRateChange: (value) => {
                          reduxDispatch(setTxSampleRateHz(value));
                        },
                        onGeometryChange: (center, sampleRate) => {
                          reduxDispatch(
                            setTxGeometry({
                              centerFrequencyHz: center,
                              sampleRateHz: sampleRate,
                            }),
                          );
                        },
                        onOptionsRequest: () => setIsTxOptionsEditing(true),
                      }
                    : undefined
                }
                overlayContent={
                  <>
                    {isCenterFrequencyEditing ? (
                      <EditableCenterFrequency
                        centerFrequencyHz={fftCenterFrequencyHz}
                        onCenterFrequencyChange={handleCenterFrequencyChange}
                        onClose={() => setIsCenterFrequencyEditing(false)}
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
                              onChangeHz={(value) =>
                                reduxDispatch(setTxCenterFrequencyHz(value))
                              }
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
                              onChangeHz={(value) =>
                                reduxDispatch(setTxSampleRateHz(value))
                              }
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
                onCenterFrequencyDoubleClick={() =>
                  setIsCenterFrequencyEditing(true)
                }
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
                isDeviceConnected={
                  isConnected &&
                  (isSelectedMockTxSource ||
                    hasRenderableCurrentFrame ||
                    hasPlayedAtLeastOnce ||
                    selectedSourceDerived.deviceState === "connected" ||
                    selectedSourceDerived.deviceState === "streaming" ||
                    isDeviceRecovering)
                }
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
                presentationPolicy={presentedLiveSourceLifecycle.presentation}
                loadingPlaceholderDelayMs={
                  isSourceHandoffOverlayPending ? 1_000 : 160
                }
                onRenderableFrameChange={handleRenderableLiveFrameChange}
                isStandby={shouldShowMockTxStandby}
                onVizZoomChange={setVizZoom}
                onVizZoomFloorChange={setVizZoomFloor}
                onVizZoomFloorPanChange={(pan) =>
                  reduxDispatch(setVizZoomFloorPan(pan))
                }
                onVizPanChange={handleVizPanChange}
                fftMin={state.fftMinDb}
                fftMax={state.fftMaxDb}
                onFftDbLimitsChange={(min, max) =>
                  reduxDispatch(setFftDbLimits({ min, max }))
                }
                onSnapshot={() => {}}
                snapshotGridPreference={state.snapshotGridPreference}
                showSpikeOverlay={state.showSpikeOverlay}
                fftFrameRate={state.fftFrameRate}
                isWaterfallCleared={state.isWaterfallCleared}
                onResetWaterfallCleared={() =>
                  reduxDispatch(resetWaterfallCleared())
                }
                awaitingDeviceData={false}
                visualizerMachine={fftVisualizerMachine}
                visualizerSessionKey={visualizerSessionKey}
                webGpuStreamResetEpoch={webGpuStreamResetEpoch}
                onLoadingStateChange={handleVisualizerLoadingStateChange}
                headerActionContent={
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
                }
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
          <>
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
              vizZoom={vizZoom}
              vizZoomFloor={vizZoomFloor}
              vizZoomFloorPan={state.vizZoomFloorPan}
              vizPanOffset={vizPanOffset}
              autoZoomStability={state.autoZoomStability}
              fftMin={state.fftMinDb}
              fftMax={state.fftMaxDb}
              onVizZoomChange={setVizZoom}
              onVizZoomFloorChange={setVizZoomFloor}
              onVizZoomFloorPanChange={(pan) =>
                reduxDispatch(setVizZoomFloorPan(pan))
              }
              onVizPanChange={handleVizPanChange}
              onStitchStatus={(status) =>
                reduxDispatch(setStitchStatus(status))
              }
              onFrequencyRangeChange={handleFrequencyRangeChange}
              onFftDbLimitsChange={(min, max) =>
                reduxDispatch(setFftDbLimits({ min, max }))
              }
              snapshotGridPreference={state.snapshotGridPreference}
            />
          </>
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
