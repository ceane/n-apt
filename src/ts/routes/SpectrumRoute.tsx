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
import type { FrequencyRange } from "@n-apt/hooks/useWebSocket";
import type { DeviceProfile } from "@n-apt/consts/schemas/websocket";

import {
  InitializingContainer,
  InitializingTitle,
  InitializingText,
} from "@n-apt/components/Layout";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { buildSdrLimitMarkers } from "@n-apt/utils/sdrLimitMarkers";
import { getSourceViewStorageKeyForSource } from "@n-apt/utils/sourcePersistence";
import {
  isMockLiveSource as checkIsMockLiveSource,
  getMockDeviceProfile,
  isMockTxSource,
  isMockAptDevice,
} from "@n-apt/utils/deviceCapabilities";
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
  setTxSampleRateHz,
  setTxPowerDbm,
  setDeviceKind,
} from "@n-apt/redux";
import { requestNextLiveFrame } from "@n-apt/redux/thunks/websocketThunks";
import {
  clampFrequencyRangeToBounds,
  buildCenteredFrequencyRange,
  normalizeFrequencyRangeToHz,
} from "@n-apt/utils/frequency";
import { estimateHackrfTotalGainDb } from "@n-apt/utils/hackrfCalibration";
import { resolveDisplaySampleRateHz } from "@n-apt/utils/sdrSampleRateGuards";
import {
  getLatestLiveFrame,
  resolveFrameReadiness,
  resolveLiveDevicePlaceholderState,
} from "./spectrum/liveSourcePresentation";
import {
  attachLiveSourceLifecyclePlaceholder,
  isCurrentSourceFrameReady,
  isLiveSourceAwaitingFrame,
  isLiveSourceHandoffPending,
  useLiveSourceLifecycle,
} from "./spectrum/liveSourceLifecycle";
import {
  getMockTxPreviewRequestKey,
  resolveMockTxMonitorSampleRateHz,
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

export { resolveLiveDevicePlaceholderState } from "./spectrum/liveSourcePresentation";
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
  displayTemporalResolution: "low" | "medium" | "high";
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
  const txCenterFrequencyHz = useAppSelector(
    (state) => state.spectrum.txCenterFrequencyHz,
  );
  const txPowerDbm = useAppSelector((state) => state.spectrum.txPowerDbm);
  const txIfftSize = useAppSelector((state) => state.spectrum.txIfftSize);
  const showTxSlider = useAppSelector(
    (state) => state.spectrum.showTxSlider ?? true,
  );
  const deviceKind = useAppSelector((state) => state.spectrum.deviceKind);
  const sourceStatuses = useAppSelector(
    (state) => state.websocket.sourceStatuses,
  );
  const sourceTransport = useAppSelector(
    (state) => state.websocket.sourceTransport,
  );
  const sourceFrameReadiness = useAppSelector(
    (state) => state.websocket.sourceFrameReadiness,
  );
  const getTxSliderDefaults = useCallback(
    (range: FrequencyRange) => {
      const visibleMinHz = Number.isFinite(range.min) ? range.min : 0;
      const visibleMaxHz =
        Number.isFinite(range.max) && range.max > visibleMinHz
          ? range.max
          : visibleMinHz + 1;
      const visibleSpanHz = visibleMaxHz - visibleMinHz;
      const centerHz = Number.isFinite(txCenterFrequencyHz)
        ? txCenterFrequencyHz
        : visibleMinHz + visibleSpanHz / 2;
      const sampleRateHz = Number.isFinite(txSampleRateHz)
        ? Math.max(1, txSampleRateHz)
        : Math.max(1, Math.min(120_000, visibleSpanHz));

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
      maxSampleRateHz,
      sendFrequencyRange,
      dataRef,
      captureStatus,
      sdrLimitMarkers,
      sources,
      sendTransmitMode,
      sendPowerScaleCommand: _sendPowerScaleCommand,
    },
    sampleRateHzEffective,
    toggleVisualizerPause,
  } = useSpectrumStore();
  const storeDispatch = dispatch as React.Dispatch<any>;
  const selectedSourceKind = selectedSource?.kind?.toLowerCase?.() ?? "";
  const selectedSourceObjectId = selectedSource?.id ?? "";
  const streamingSource = useMemo(
    () =>
      sources.find((source) => source.id === activeSourceId) ??
      selectedSource ??
      null,
    [activeSourceId, selectedSource, sources],
  );
  const streamingSourceId = streamingSource?.id ?? selectedSourceId;
  const expectedVisualizerSourceId =
    // Once the control channel has selected a source, its active stream ID is
    // authoritative. A persisted selectedSourceId can refer to the previous
    // USB instance after unplug/replug and would otherwise make the canvas
    // discard valid frames from the newly active RTL-SDR.
    streamingSourceId || selectedSourceId || null;
  const [acceptedFrameSampleRateHz, setAcceptedFrameSampleRateHz] = useState<
    number | null
  >(null);
  const previousLiveSourceIdRef = useRef<string | null>(
    streamingSourceId || null,
  );
  const hasInitializedLiveSourceRef = useRef(false);
  const emptyLiveDataRef = useRef<any>(null);
  emptyLiveDataRef.current = null;
  const isSelectedMockTxSource =
    isConnected &&
    !!selectedSource &&
    isMockTxSource({
      id: selectedSourceId || selectedSourceObjectId,
      kind: selectedSourceKind,
    });
  const hasActiveSourceFrame =
    hasPlayedAtLeastOnce && playedSourceId === (streamingSourceId || null);
  const selectedSourceStatus =
    state.sourceMode === "live" && streamingSourceId
      ? (sourceStatuses?.[streamingSourceId] ?? streamingSource?.status ?? null)
      : (streamingSource?.status ?? null);
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
      sourceId: streamingSourceId || null,
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
      fftVisualizerMachine?.discardNextPersist?.(
        getSourceViewStorageKeyForSource(streamingSource),
      );
    }
    if (transition.advanceResetEpoch) {
      setWebGpuStreamResetEpoch((epoch) => epoch + 1);
    }
    previousWebGpuStreamIdentityRef.current = nextIdentity;
  }, [
    dataRef,
    fftVisualizerMachine,
    selectedSourceStatus,
    streamingSource,
    streamingSourceId,
    selectedSourceId,
  ]);
  const isSelectedMockTxTransmitting =
    isSelectedMockTxSource && selectedSourceStatus === "transmitting";
  const liveSourceLifecycle = useLiveSourceLifecycle({
    isLive: state.sourceMode === "live",
    selectedSourceId: selectedSourceId || null,
    activeSourceId: activeSourceId || null,
    transportSourceId: sourceTransport?.sourceId ?? null,
    transportPhase: sourceTransport?.phase ?? "idle",
    transportError: sourceTransport?.error ?? null,
    readinessSequence: sourceFrameReadiness?.sequence ?? null,
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
      isSelectedMockTxSource &&
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
  const txCapableDeviceKind =
    selectedSourceDerived.deviceProfile?.kind ??
    deviceProfile?.kind ??
    deviceKind;
  const selectedSourceCapability = selectedSource?.capability?.toLowerCase?.();
  const isMockLiveSource = checkIsMockLiveSource({
    selectedSource,
    backend: selectedSourceDerived.backend || deviceKind,
    deviceName: selectedSource?.name,
    sourceMode: state.sourceMode,
  });
  const mockTxDeviceProfile = useMemo<DeviceProfile | null>(() => {
    return getMockDeviceProfile({
      selectedSource,
      selectedSourceId,
      backend: selectedSourceDerived.backend || deviceKind,
      deviceName: selectedSource?.name,
      sourceMode: state.sourceMode,
    });
  }, [
    selectedSource,
    selectedSourceId,
    selectedSourceDerived.backend,
    deviceKind,
    selectedSource?.name,
    state.sourceMode,
  ]);
  const fftDeviceProfile =
    mockTxDeviceProfile ?? selectedSourceDerived.deviceProfile ?? deviceProfile;
  const reduxDeviceKindSupportsTx =
    deviceKind === "hackrf_one" ||
    isMockTxSource({ id: deviceKind, kind: deviceKind }) ||
    deviceKind === "tx_rx" ||
    deviceKind === "tx";
  const isRxOnlyMockSource =
    selectedSourceCapability === "mock" ||
    isMockAptDevice({
      id:
        selectedSourceDerived.deviceProfile?.kind ??
        selectedSourceDerived.backend,
      kind:
        selectedSourceDerived.deviceProfile?.kind ??
        selectedSourceDerived.backend,
    });
  const canShowTxSlider =
    !isRxOnlyMockSource &&
    (selectedSourceCapability === "tx" ||
      selectedSourceCapability === "tx_rx" ||
      reduxDeviceKindSupportsTx ||
      txCapableDeviceKind === "hackrf_one" ||
      isMockTxSource({ id: txCapableDeviceKind, kind: txCapableDeviceKind }) ||
      txCapableDeviceKind === "tx_rx" ||
      txCapableDeviceKind === "tx");

  const effectiveTunerGainDb = useMemo(() => {
    const gainConfig = effectiveSdrSettings?.gain;
    const gainObject =
      gainConfig && typeof gainConfig === "object" ? gainConfig : null;
    if (
      selectedSourceDerived.deviceProfile?.kind === "hackrf_one" &&
      gainObject
    ) {
      return estimateHackrfTotalGainDb({
        ampEnabled: gainObject.hackrf_amp_enable,
        lnaGainDb: gainObject.hackrf_lna_gain,
        vgaGainDb: gainObject.hackrf_vga_gain,
      });
    }

    return gainObject ? (gainObject.tuner_gain ?? 0) : 0;
  }, [effectiveSdrSettings?.gain, selectedSourceDerived.deviceProfile?.kind]);

  const handleVisualizerLoadingStateChange = useCallback(
    (isLoading: boolean) => {
      setFftSnapshotLoading(isLoading);
      onLoadingStateChange?.(isLoading);
    },
    [onLoadingStateChange],
  );

  const [vizZoom, setVizZoom] = [
    state.vizZoom,
    (zoom: number) => dispatch({ type: "SET_VIZ_ZOOM", zoom }),
  ] as const;
  const [vizZoomFloor, setVizZoomFloor] = [
    state.vizZoomFloor,
    (zoomFloor: number) => dispatch({ type: "SET_VIZ_ZOOM_FLOOR", zoomFloor }),
  ] as const;
  const [vizPanOffset, setVizPanOffset] = [
    state.vizPanOffset,
    (pan: number) => dispatch({ type: "SET_VIZ_PAN", pan }),
  ] as const;
  const hardwareSpectrumBounds = useAppSelector(
    (reduxState) => reduxState.demod.hardwareRange,
  );
  const activeSignalAreaBounds =
    signalAreaBounds?.[state.activeSignalArea] ??
    signalAreaBounds?.[state.activeSignalArea?.toLowerCase?.()] ??
    null;
  const limitMarkers = useMemo(
    () => (isMockLiveSource ? [] : buildSdrLimitMarkers(sdrLimitMarkers)),
    [isMockLiveSource, sdrLimitMarkers],
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
    deviceKind:
      selectedSourceDerived.deviceProfile?.kind ?? deviceProfile?.kind,
    backend: selectedSourceDerived.backend ?? backend,
    deviceName: selectedSourceDerived.deviceName ?? deviceName,
    isRtlSdr:
      selectedSourceDerived.deviceProfile?.is_rtl_sdr ??
      deviceProfile?.is_rtl_sdr,
    activeSignalArea: state.activeSignalArea,
    signalAreaBounds,
    fftFrameRate: state.fftFrameRate,
    vizPanOffset: state.vizPanOffset,
    vizZoom: state.vizZoom,
    dispatch,
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
      dispatch({ type: "SET_FREQUENCY_RANGE", range: clampedRange });
      sendFrequencyRange(clampedRange);
    },
    [
      sendFrequencyRange,
      dispatch,
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
      return Number.isFinite(txCenterFrequencyHz) ? txCenterFrequencyHz : null;
    },
  );
  const isDraggingTxRef = useRef(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncMockTxSettingsFromSlider = useCallback(
    (centerFrequencyHz: number) => {
      if (
        !Number.isFinite(centerFrequencyHz) ||
        !isSelectedMockTxSource ||
        !isConnected ||
        isSwitchingLiveSource
      ) {
        return;
      }

      const viewSampleRateHz = state.frequencyRange
        ? state.frequencyRange.max - state.frequencyRange.min
        : undefined;
      const txSettings = {
        centerFrequencyHz,
        viewCenterHz: mockMonitorCenterHz,
        bandwidthHz: txSampleRateHz,
        sampleRateHz: viewSampleRateHz,
        powerDbm: txPowerDbm,
        txSignal,
        txIfftSize,
      };

      if (isSelectedMockTxTransmitting) {
        const fallbackId =
          selectedSourceId ||
          (selectedSource &&
          isMockTxSource({ id: selectedSource.id, kind: selectedSource.kind })
            ? selectedSource.id
            : "mock-tx");
        sendTransmitMode?.(true, selectedSource?.name ?? fallbackId, {
          serialNumber: selectedSource?.serial_number?.trim() || fallbackId,
          ...txSettings,
        });
        return;
      }

      dataRef.current = null;
      reduxDispatch(
        requestNextLiveFrame({
          txSettings: {
            ...txSettings,
            viewCenterHz: mockMonitorCenterHz,
          },
        }),
      );
    },
    [
      dataRef,
      isConnected,
      isSelectedMockTxSource,
      isSelectedMockTxTransmitting,
      isSwitchingLiveSource,
      mockMonitorCenterHz,
      reduxDispatch,
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
        // We rely on explicit isDragging = false from TxSliderOverlay on pointerup
        isDraggingTxRef.current = true;
      } else {
        isDraggingTxRef.current = false;
      }

      reduxDispatch(setTxCenterFrequencyHz(value));
      syncMockTxSettingsFromSlider(value);
      if (!isDragging) {
        setMockMonitorCenterHz(value);
      }
    },
    [reduxDispatch, syncMockTxSettingsFromSlider],
  );

  // Sync mockMonitorCenterHz with txCenterFrequencyHz on non-drag changes (preset/sidebar)
  useEffect(() => {
    if (Number.isFinite(txCenterFrequencyHz) && !isDraggingTxRef.current) {
      setMockMonitorCenterHz(txCenterFrequencyHz);
    }
  }, [txCenterFrequencyHz]);

  // Sync mockMonitorCenterHz with state.frequencyRange on edge panning
  useEffect(() => {
    if (
      state.frequencyRange &&
      isSelectedMockTxSource &&
      isDraggingTxRef.current
    ) {
      const center = (state.frequencyRange.min + state.frequencyRange.max) / 2;
      setMockMonitorCenterHz(center);
    }
  }, [state.frequencyRange, isSelectedMockTxSource]);

  const centerFrequencyHz = useMemo(() => {
    return calculateCenterFrequency(state.frequencyRange);
  }, [state.frequencyRange]);

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
      dispatch({
        type: "SET_SDR_SETTINGS_BUNDLE",
        settings: {
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
        },
      });

      if (snapshot.frequencyRange) {
        handleFrequencyRangeChange(snapshot.frequencyRange);
      }
    },
    [dispatch, handleFrequencyRangeChange, state],
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
              dispatch({ type: "SET_VIZ_ZOOM_FLOOR_PAN", pan: newPan });
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

  const mockTxMonitorSampleRateHz = isSelectedMockTxSource
    ? resolveMockTxMonitorSampleRateHz(
        selectedSourceDerived.sdrSettings?.min_receive_sample_rate,
        effectiveSdrSettings?.min_receive_sample_rate,
        sampleRateHzEffective,
        selectedSourceDerived.sampleRateHz,
        selectedSourceDerived.sdrSettings?.sample_rate,
        effectiveSdrSettings?.sample_rate,
      )
    : null;
  const mockTxMonitorFrequencyRange = useMemo(() => {
    if (
      !isSelectedMockTxSource ||
      !state.frequencyRange ||
      !mockTxMonitorSampleRateHz
    ) {
      return null;
    }
    const fallbackCenterHz =
      centerFrequencyHz ??
      (state.frequencyRange.min + state.frequencyRange.max) / 2;
    const monitorCenterHz =
      mockMonitorCenterHz !== null ? mockMonitorCenterHz : fallbackCenterHz;
    return buildCenteredFrequencyRange(
      monitorCenterHz,
      mockTxMonitorSampleRateHz,
    );
  }, [
    centerFrequencyHz,
    isSelectedMockTxSource,
    mockTxMonitorSampleRateHz,
    state.frequencyRange,
    mockMonitorCenterHz,
  ]);
  const fftFrequencyRange = mockTxMonitorFrequencyRange ?? state.frequencyRange;
  const fftCenterFrequencyHz = mockTxMonitorFrequencyRange
    ? calculateCenterFrequency(mockTxMonitorFrequencyRange)
    : centerFrequencyHz;
  const fftHardwareSampleRateHz =
    mockTxMonitorSampleRateHz ??
    resolveDisplaySampleRateHz({
      frameSampleRateHz: acceptedFrameSampleRateHz,
      configuredSampleRateHz:
        selectedSourceDerived.sdrSettings?.min_receive_sample_rate ??
        effectiveSdrSettings?.min_receive_sample_rate ??
        selectedSourceDerived.sdrSettings?.sample_rate ??
        effectiveSdrSettings?.sample_rate,
      maxSampleRateHz: selectedSourceDerived.maxSampleRateHz ?? maxSampleRateHz,
      derivedSampleRateHz: sampleRateHzEffective,
      deviceKind:
        selectedSourceDerived.deviceProfile?.kind ?? deviceProfile?.kind,
      backend: selectedSourceDerived.backend ?? backend,
      deviceName: selectedSourceDerived.deviceName ?? deviceName,
      isRtlSdr:
        selectedSourceDerived.deviceProfile?.is_rtl_sdr ??
        deviceProfile?.is_rtl_sdr,
    }) ??
    undefined;
  const txSliderDefaults = fftFrequencyRange
    ? getTxSliderDefaults(fftFrequencyRange)
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
          (isMockTxSource({ id: source.id, kind: source.kind }) ||
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
      if (!hasCanvasFrame || streamingSourceId === "mock-tx") return;
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
    const syncKey = JSON.stringify({
      sourceId: transmittingTxSource.id,
      txSignal,
      txCenterFrequencyHz,
      mockMonitorCenterHz,
      txSampleRateHz,
      viewSampleRateHz,
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
          viewCenterHz: mockMonitorCenterHz,
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
    mockMonitorCenterHz,
    txCenterFrequencyHz,
    txPowerDbm,
    txSampleRateHz,
    txSignal,
  ]);

  const lastMockTxPreviewRequestKeyRef = useRef<string | null>(null);
  const mockTxPreviewRequestKey = useMemo(() => {
    const viewSampleRateHz = state.frequencyRange
      ? state.frequencyRange.max - state.frequencyRange.min
      : undefined;
    return (
      getMockTxPreviewRequestKey({
        sourceId: selectedSourceId,
        centerFrequencyHz: txCenterFrequencyHz,
        sampleRateHz: txSampleRateHz,
        signal: txSignal,
        powerDbm: txPowerDbm,
        ifftSize: txIfftSize,
      }) + `|viewCenter:${mockMonitorCenterHz}|viewSpan:${viewSampleRateHz}`
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
  ]);

  useEffect(() => {
    if (
      !isSelectedMockTxSource ||
      isSelectedMockTxTransmitting ||
      !isConnected ||
      isSwitchingLiveSource
    ) {
      lastMockTxPreviewRequestKeyRef.current = null;
      return;
    }
    if (lastMockTxPreviewRequestKeyRef.current === mockTxPreviewRequestKey) {
      return;
    }
    lastMockTxPreviewRequestKeyRef.current = mockTxPreviewRequestKey;
    dataRef.current = null;
    reduxDispatch(
      requestNextLiveFrame({
        txSettings: {
          centerFrequencyHz: txCenterFrequencyHz,
          viewCenterHz: mockMonitorCenterHz,
          bandwidthHz: txSampleRateHz,
          sampleRateHz: state.frequencyRange
            ? state.frequencyRange.max - state.frequencyRange.min
            : undefined,
          powerDbm: txPowerDbm,
          txSignal,
          txIfftSize,
        },
      }),
    );
  }, [
    dataRef,
    isConnected,
    isSelectedMockTxSource,
    isSelectedMockTxTransmitting,
    isSwitchingLiveSource,
    mockTxPreviewRequestKey,
    reduxDispatch,
    txCenterFrequencyHz,
    mockMonitorCenterHz,
    txIfftSize,
    txPowerDbm,
    txSampleRateHz,
    txSignal,
  ]);

  const shouldSuppressLiveData = isSwitchingLiveSource;
  const fftDataRef = shouldSuppressLiveData ? emptyLiveDataRef : dataRef;
  const mockTxPlaceholderState = useMemo<CanvasPlaceholderState | null>(() => {
    if (
      !isSelectedMockTxSource ||
      isSelectedMockTxTransmitting ||
      hasPlayedAtLeastOnce
    ) {
      return null;
    }
    return {
      kind: "top-bar",
      title: "Start Tx to transmit",
      sourceLabel:
        selectedSource?.name ??
        selectedSourceDerived.deviceName ??
        "Mock Tx SDR",
      message: "Start Tx to view backend-generated monitor I/Q.",
    };
  }, [
    isSelectedMockTxSource,
    isSelectedMockTxTransmitting,
    hasPlayedAtLeastOnce,
    selectedSource?.name,
    selectedSourceDerived.deviceName,
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
                          (fftFrequencyRange.min + fftFrequencyRange.max) / 2,
                        txSampleRateHz:
                          txSliderDefaults?.sampleRateHz ??
                          Math.max(
                            1,
                            fftFrequencyRange.max - fftFrequencyRange.min,
                          ),
                        onCenterFrequencyChange:
                          handleCenterFrequencyChangeFromSlider,
                        onSampleRateChange: (value) =>
                          reduxDispatch(setTxSampleRateHz(value)),
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
                onRenderableFrameChange={handleRenderableLiveFrameChange}
                isStandby={
                  isSelectedMockTxSource && !isSelectedMockTxTransmitting
                }
                onVizZoomChange={setVizZoom}
                onVizZoomFloorChange={setVizZoomFloor}
                onVizZoomFloorPanChange={(pan) =>
                  dispatch({ type: "SET_VIZ_ZOOM_FLOOR_PAN", pan })
                }
                onVizPanChange={handleVizPanChange}
                fftMin={state.fftMinDb}
                fftMax={state.fftMaxDb}
                onFftDbLimitsChange={(min, max) =>
                  dispatch({ type: "SET_FFT_DB_LIMITS", min, max })
                }
                onSnapshot={() => {}}
                snapshotGridPreference={state.snapshotGridPreference}
                showSpikeOverlay={state.showSpikeOverlay}
                heterodyningVerifyRequestId={state.heterodyningVerifyRequestId}
                heterodyningHighlightedBins={state.heterodyningHighlightedBins}
                onHeterodyningAnalyzed={(result) =>
                  dispatch({
                    type: "SET_HETERODYNING_RESULT",
                    detected: result.detected,
                    confidence: result.confidence,
                    statusText: result.statusText,
                    highlightedBins: result.highlightedBins,
                  })
                }
                fftFrameRate={state.fftFrameRate}
                isWaterfallCleared={state.isWaterfallCleared}
                onResetWaterfallCleared={() =>
                  dispatch({ type: "RESET_WATERFALL_CLEARED" })
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
                state.displayTemporalResolution === "medium"
                  ? "high"
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
                dispatch({ type: "SET_VIZ_ZOOM_FLOOR_PAN", pan })
              }
              onVizPanChange={handleVizPanChange}
              onStitchStatus={(status) =>
                storeDispatch({ type: "SET_STITCH_STATUS", status })
              }
              onStitchProgress={(progress) =>
                storeDispatch({ type: "SET_STITCH_PROGRESS", progress })
              }
              onFrequencyRangeChange={handleFrequencyRangeChange}
              onFftDbLimitsChange={(min, max) =>
                dispatch({ type: "SET_FFT_DB_LIMITS", min, max })
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
