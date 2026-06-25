import React, {
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import styled from "styled-components";
import { FFTAndWaterfall, NoteCards } from "@n-apt/components";
import type { FFTCanvasHandle } from "@n-apt/components";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";
import FFTPlaybackCanvas from "@n-apt/components/FFTPlaybackCanvas";
import { EditableCenterFrequency } from "@n-apt/components/ui/EditableCenterFrequency";
import { FrequencyInput } from "@n-apt/components/ui/FrequencyInput";
import { Button } from "@n-apt/components/ui/Button";
import { Toggle } from "@n-apt/components/ui/Toggle";
import type { CanvasPlaceholderState } from "@n-apt/components/ui/CanvasPlaceholder";
import {
  useSnapshot,
  type SnapshotVideoFormat,
} from "@n-apt/hooks/useSnapshot";
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
  formatFrequency,
} from "@n-apt/utils/frequency";
import { estimateHackrfTotalGainDb } from "@n-apt/utils/hackrfCalibration";

const resolveMockTxMonitorSampleRateHz = (
  ...candidates: Array<number | null | undefined>
): number => {
  for (const candidate of candidates) {
    if (
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate > 0
    ) {
      return Math.max(candidate, 3_200_000);
    }
  }
  return 3_200_000;
};

export const getMockTxPreviewRequestKey = ({
  sourceId,
  centerFrequencyHz,
  sampleRateHz,
  signal,
  powerDbm,
}: {
  sourceId?: string | null;
  centerFrequencyHz?: number | null;
  sampleRateHz?: number | null;
  signal?: string | null;
  powerDbm?: number | null;
}) =>
  JSON.stringify({
    sourceId: sourceId ?? null,
    centerFrequencyHz:
      typeof centerFrequencyHz === "number" &&
      Number.isFinite(centerFrequencyHz)
        ? Math.round(centerFrequencyHz)
        : null,
    sampleRateHz:
      typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
        ? Math.round(sampleRateHz)
        : null,
    signal: signal ?? null,
    powerDbm:
      typeof powerDbm === "number" && Number.isFinite(powerDbm)
        ? Number(powerDbm.toFixed(3))
        : null,
  });

interface SpectrumRouteProps {
  activeTab: "visualizer" | "analysis" | "draw";
  fftCanvasRef?: React.RefObject<FFTCanvasHandle | null>;
  onLoadingStateChange?: (isLoading: boolean) => void;
}

const SpectrumContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  user-select: none;
`;

const SpectrumContent = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  position: relative;
`;

const FFTBackButton = styled(Button)`
  min-width: 0;
  height: 24px;
  padding-inline: 12px;
  border-radius: 999px;
  box-shadow: none;
  font-size: 10px;
  line-height: 1;
  margin-left: auto;
`;

const FastSnapshotPill = styled.div<{ $disabled?: boolean }>`
  display: inline-flex;
  align-items: stretch;
  height: 24px;
  min-height: 24px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.border};
  background-color: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textSecondary};
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.02em;
  box-shadow: none;
  opacity: ${(props) => (props.$disabled ? 0.55 : 1)};
`;

const FastSnapshotLabel = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  color: ${(props) => props.theme.textMuted};
  white-space: nowrap;
  user-select: none;
`;

const FastSnapshotDivider = styled.span`
  width: 1px;
  align-self: stretch;
  background-color: ${(props) => props.theme.border};
`;

const FastSnapshotModeButton = styled.button`
  border: 0;
  border-radius: 0;
  background: transparent;
  color: ${(props) => props.theme.textPrimary};
  font: inherit;
  letter-spacing: inherit;
  padding: 0 9px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;

  &:disabled {
    cursor: not-allowed;
    color: ${(props) => props.theme.textMuted};
  }

  &:not(:disabled):hover {
    background-color: ${(props) => props.theme.primary}20;
    color: ${(props) => props.theme.primary};
  }
`;

const FastSnapshotStopButton = styled(FastSnapshotModeButton)`
  padding: 0 12px;
  color: ${(props) => props.theme.primary};
  font-weight: 700;
`;

const FastSnapshotToggleWrapper = styled.div`
  display: flex;
  align-items: center;
  padding: 0 8px;

  span {
    font-size: 10px;
    font-family: inherit;
    text-transform: none;
    letter-spacing: inherit;
  }
`;

const NotesSnapshotPill = styled(FastSnapshotPill)`
  min-height: 24px;
`;

const NotesSnapshotLabel = styled(FastSnapshotLabel)`
  padding-inline: 9px;
`;

const NotesSnapshotButton = styled(FastSnapshotModeButton)`
  padding-inline: 10px;
`;

const HeaderActionSpacer = styled.span`
  flex: 1 1 auto;
  min-width: 12px;
`;

const TxOptionsShell = styled.div`
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%);
  z-index: 150;
  width: min(72vw, 460px);
  pointer-events: none;
`;

const TxOptionsCard = styled.div`
  pointer-events: auto;
  border-radius: 18px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 10px 30px
    ${({ theme }) =>
      theme.mode === "light"
        ? "rgba(31, 37, 50, 0.12)"
        : "rgba(0, 0, 0, 0.32)"};
  padding: 12px;
`;

const TxOptionsTitle = styled.div`
  margin-bottom: 10px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  font-family: ${({ theme }) => theme.typography.mono};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const TxOptionsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const TxPowerField = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;

  input {
    min-width: 0;
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 4px;
    background: ${({ theme }) => theme.colors.surface};
    color: ${({ theme }) => theme.colors.textPrimary};
    font: 11px ${({ theme }) => theme.typography.mono};
    padding: 5px 6px;
  }
`;

const FastRecordingDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: ${(props) => props.theme.primary};
  animation: fast-recording-dot-blink 1s ease-in-out infinite;

  @keyframes fast-recording-dot-blink {
    0% {
      opacity: 0.25;
      transform: scale(0.85);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0.25;
      transform: scale(0.85);
    }
  }
`;

const FastRecordingMeta = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
`;

const FAST_SPECTRUM_FALLBACK_HEIGHT = 400;
const FAST_WATERFALL_FALLBACK_HEIGHT = 300;

const FastSnapshotControl: React.FC<{
  disabled?: boolean;
  isRecording?: boolean;
  recordingSecondsRemaining?: number | null;
  onImage: () => void;
  onVideo: () => void;
  onStop: () => void;
  videoFormat: SnapshotVideoFormat | null;
  showStats: boolean;
  onShowStatsChange: (show: boolean) => void;
}> = ({
  disabled = false,
  isRecording = false,
  recordingSecondsRemaining = null,
  onImage,
  onVideo,
  onStop,
  videoFormat,
  showStats,
  onShowStatsChange,
}) => {
  if (isRecording) {
    return (
      <FastSnapshotPill>
        <FastSnapshotStopButton type="button" onClick={onStop}>
          <FastRecordingMeta>
            <FastRecordingDot />
            <span>
              Stop and Save Recording
              {typeof recordingSecondsRemaining === "number"
                ? ` (${recordingSecondsRemaining}s)`
                : ""}
            </span>
          </FastRecordingMeta>
        </FastSnapshotStopButton>
      </FastSnapshotPill>
    );
  }

  return (
    <FastSnapshotPill $disabled={disabled}>
      <FastSnapshotLabel>Fast Snapshot</FastSnapshotLabel>
      <FastSnapshotDivider />
      <FastSnapshotModeButton
        type="button"
        disabled={disabled}
        onClick={onImage}
      >
        Image
      </FastSnapshotModeButton>
      <FastSnapshotDivider />
      <FastSnapshotModeButton
        type="button"
        disabled={disabled || !videoFormat}
        onClick={onVideo}
        title={videoFormat ? `Video (.${videoFormat})` : "Video"}
      >
        Video
      </FastSnapshotModeButton>
      <FastSnapshotDivider />
      <FastSnapshotToggleWrapper>
        <Toggle
          $active={showStats}
          onClick={() => onShowStatsChange(!showStats)}
          title="Toggle including stats in snapshot/video"
          disabled={disabled}
          inactiveLabel="Stats"
          activeLabel="Stats"
          showInnerLabel={true}
          labelPosition="left"
        />
      </FastSnapshotToggleWrapper>
    </FastSnapshotPill>
  );
};

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
  const txOptionsRef = useRef<HTMLDivElement | null>(null);
  const txSignal = useAppSelector((state) => state.spectrum.txSignal || "wifi");
  const txSampleRateHz = useAppSelector(
    (state) => state.spectrum.txSampleRateHz,
  );
  const txCenterFrequencyHz = useAppSelector(
    (state) => state.spectrum.txCenterFrequencyHz,
  );
  const txPowerDbm = useAppSelector((state) => state.spectrum.txPowerDbm);
  const showTxSlider = useAppSelector(
    (state) => state.spectrum.showTxSlider ?? true,
  );
  const deviceKind = useAppSelector((state) => state.spectrum.deviceKind);
  const sourceStatuses = useAppSelector(
    (state) => state.websocket.sourceStatuses,
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
      backend,
      deviceInfo,
      deviceName,
      deviceProfile,
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
  const isSelectedMockTxSource =
    selectedSourceId === "mock-tx" ||
    selectedSourceObjectId === "mock-tx" ||
    selectedSourceKind === "mock_tx" ||
    selectedSourceKind === "mock-tx";
  const visualizerSessionKey = useMemo(
    () => getSourceViewStorageKeyForSource(selectedSource),
    [selectedSource],
  );
  const txCapableDeviceKind =
    selectedSourceDerived.deviceProfile?.kind ??
    deviceProfile?.kind ??
    deviceKind;
  const selectedSourceCapability = selectedSource?.capability?.toLowerCase?.();
  const isMockLiveSource =
    state.sourceMode === "live" &&
    !!(
      selectedSourceCapability === "mock" ||
      selectedSource?.kind?.toLowerCase?.().includes("mock") ||
      selectedSource?.name?.toLowerCase?.().includes("mock") ||
      selectedSourceDerived.deviceProfile?.kind === "mock_tx" ||
      deviceKind === "mock_tx" ||
      selectedSourceDerived.backend?.toLowerCase?.().includes("mock")
    );
  const isMockAptSource =
    state.sourceMode === "live" &&
    !!(
      selectedSource?.kind?.toLowerCase().includes("apt") ||
      selectedSource?.id === "mock-apt" ||
      selectedSourceDerived.backend?.toLowerCase().includes("apt")
    );
  const mockTxDeviceProfile = useMemo<DeviceProfile | null>(() => {
    if (!isMockLiveSource) return null;
    if (isMockAptSource) {
      return {
        kind: "mock_apt",
        is_rtl_sdr: true,
        supports_approx_dbm: false,
        supports_raw_iq_stream: false,
      };
    }
    return {
      kind: "mock_tx",
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      supports_raw_iq_stream: true,
    };
  }, [isMockLiveSource, isMockAptSource]);
  const fftDeviceProfile =
    mockTxDeviceProfile ?? selectedSourceDerived.deviceProfile ?? deviceProfile;
  const reduxDeviceKindSupportsTx =
    deviceKind === "hackrf_one" ||
    deviceKind === "mock_tx" ||
    deviceKind === "tx_rx" ||
    deviceKind === "tx";
  const isRxOnlyMockSource =
    selectedSourceCapability === "mock" ||
    selectedSourceDerived.deviceProfile?.kind === "mock_apt" ||
    selectedSourceDerived.backend?.toLowerCase?.() === "mock_apt";
  const canShowTxSlider =
    !isRxOnlyMockSource &&
    (selectedSourceCapability === "tx" ||
      selectedSourceCapability === "tx_rx" ||
      reduxDeviceKindSupportsTx ||
      txCapableDeviceKind === "hackrf_one" ||
      txCapableDeviceKind === "mock_tx" ||
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
    const monitorCenterHz = Number.isFinite(txCenterFrequencyHz)
      ? txCenterFrequencyHz
      : fallbackCenterHz;
    return buildCenteredFrequencyRange(
      monitorCenterHz,
      mockTxMonitorSampleRateHz,
    );
  }, [
    centerFrequencyHz,
    isSelectedMockTxSource,
    mockTxMonitorSampleRateHz,
    state.frequencyRange,
    txCenterFrequencyHz,
  ]);
  const fftFrequencyRange = mockTxMonitorFrequencyRange ?? state.frequencyRange;
  const fftCenterFrequencyHz = mockTxMonitorFrequencyRange
    ? calculateCenterFrequency(mockTxMonitorFrequencyRange)
    : centerFrequencyHz;
  const fftHardwareSampleRateHz =
    mockTxMonitorSampleRateHz ?? sampleRateHzEffective ?? undefined;
  const txSliderDefaults = fftFrequencyRange
    ? getTxSliderDefaults(fftFrequencyRange)
    : null;
  const selectedSourceStatus =
    state.sourceMode === "live" && selectedSourceId
      ? (sourceStatuses?.[selectedSourceId] ?? selectedSource?.status ?? null)
      : (selectedSource?.status ?? null);
  const isSelectedMockTxTransmitting =
    isSelectedMockTxSource && selectedSourceStatus === "transmitting";
  const txSettingsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastTxSettingsSyncKeyRef = useRef<string | null>(null);
  const transmittingTxSource = useMemo(
    () =>
      sources.find((source) => {
        const kind = source.kind?.toLowerCase?.() ?? "";
        const capability = source.capability?.toLowerCase?.() ?? "";
        const status = sourceStatuses?.[source.id] ?? source.status;
        return (
          status === "transmitting" &&
          (source.id === "mock-tx" ||
            kind === "mock_tx" ||
            kind === "mock-tx" ||
            capability === "tx" ||
            capability === "tx_rx")
        );
      }) ?? null,
    [sourceStatuses, sources],
  );

  useEffect(() => {
    setHasPlayedAtLeastOnce(false);
  }, [selectedSourceId]);

  useEffect(() => {
    if (isSelectedMockTxTransmitting) {
      setHasPlayedAtLeastOnce(true);
    }
  }, [isSelectedMockTxTransmitting]);

  useEffect(() => {
    if (!transmittingTxSource) {
      lastTxSettingsSyncKeyRef.current = null;
      if (txSettingsSyncTimerRef.current) {
        clearTimeout(txSettingsSyncTimerRef.current);
        txSettingsSyncTimerRef.current = null;
      }
      return;
    }

    const syncKey = JSON.stringify({
      sourceId: transmittingTxSource.id,
      txSignal,
      txCenterFrequencyHz,
      txSampleRateHz,
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
          bandwidthHz: txSampleRateHz,
          sampleRateHz: txSampleRateHz,
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
    transmittingTxSource,
    txCenterFrequencyHz,
    txPowerDbm,
    txSampleRateHz,
    txSignal,
  ]);

  const lastMockTxPreviewRequestKeyRef = useRef<string | null>(null);
  const mockTxPreviewRequestKey = useMemo(
    () =>
      getMockTxPreviewRequestKey({
        sourceId: selectedSourceId,
        centerFrequencyHz: txCenterFrequencyHz,
        sampleRateHz: txSampleRateHz,
        signal: txSignal,
        powerDbm: txPowerDbm,
      }),
    [
      selectedSourceId,
      txCenterFrequencyHz,
      txPowerDbm,
      txSampleRateHz,
      txSignal,
    ],
  );

  useEffect(() => {
    if (!isSelectedMockTxSource || isSelectedMockTxTransmitting) {
      lastMockTxPreviewRequestKeyRef.current = null;
      return;
    }
    if (lastMockTxPreviewRequestKeyRef.current === mockTxPreviewRequestKey) {
      return;
    }
    lastMockTxPreviewRequestKeyRef.current = mockTxPreviewRequestKey;
    reduxDispatch(requestNextLiveFrame());
  }, [
    isSelectedMockTxSource,
    isSelectedMockTxTransmitting,
    mockTxPreviewRequestKey,
    reduxDispatch,
  ]);

  const fftDataRef = dataRef;
  const mockTxPlaceholderState = useMemo<CanvasPlaceholderState | null>(() => {
    if (
      !isSelectedMockTxSource ||
      isSelectedMockTxTransmitting ||
      hasPlayedAtLeastOnce
    ) {
      return null;
    }
    return {
      kind: "idle",
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
                ref={fftCanvasRef}
                txSlider={
                  showTxSlider && canShowTxSlider
                    ? {
                        visible: true,
                        signalLabel: String(txSignal).toUpperCase(),
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
                        onCenterFrequencyChange: (value) =>
                          reduxDispatch(setTxCenterFrequencyHz(value)),
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
                  isSelectedMockTxSource ||
                  selectedSourceDerived.deviceState === "connected"
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
                placeholderState={mockTxPlaceholderState}
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
