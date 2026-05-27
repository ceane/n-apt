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
import { Button } from "@n-apt/components/ui/Button";
import {
  useSnapshot,
  type SnapshotVideoFormat,
} from "@n-apt/hooks/useSnapshot";
import type { FrequencyRange } from "@n-apt/hooks/useWebSocket";

import {
  InitializingContainer,
  InitializingTitle,
  InitializingText,
} from "@n-apt/components/Layout";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { buildSdrLimitMarkers } from "@n-apt/utils/sdrLimitMarkers";
import { calculateCenterFrequency } from "@n-apt/utils/centerFrequency";
import { useSnapshotListener } from "@n-apt/hooks/useSnapshotListener";
import { useDeviceConnectionState } from "@n-apt/hooks/useDeviceConnectionState";
import { useCaptureWholeChannelSegments } from "@n-apt/hooks/useCaptureWholeChannelSegments";
import type { NoteCardStatsSnapshot } from "@n-apt/redux/slices/noteCardsSlice";
import {
  useAppSelector,
  useAppDispatch,
  createNoteCardFromSpectrum,
  selectNoteCardsCollapsed,
  setNoteCardsCollapsed,
} from "@n-apt/redux";
import {
  clampFrequencyRangeToBounds,
  normalizeFrequencyRangeToHz,
  formatFrequency,
} from "@n-apt/utils/frequency";
import { estimateHackrfTotalGainDb } from "@n-apt/utils/hackrfCalibration";

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
}> = ({
  disabled = false,
  isRecording = false,
  recordingSecondsRemaining = null,
  onImage,
  onVideo,
  onStop,
  videoFormat,
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
      >
        Video {videoFormat ? `(.${videoFormat})` : ""}
      </FastSnapshotModeButton>
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
  const notesCollapsed = useAppSelector(selectNoteCardsCollapsed);
  const reduxDispatch = useAppDispatch();
  const {
    state,
    dispatch,
    fftVisualizerMachine,
    manualVisualizerPaused,
    effectiveSdrSettings,
    signalAreaBounds,
    wsConnection: {
      isConnected,
      deviceState,
      backend,
      deviceInfo,
      deviceName,
      deviceProfile,
      sendFrequencyRange,
      dataRef,
      captureStatus,
      sdrLimitMarkers,
      sendPowerScaleCommand: _sendPowerScaleCommand,
    },
    sampleRateHzEffective,
    toggleVisualizerPause,
  } = useSpectrumStore();
  const storeDispatch = dispatch as React.Dispatch<any>;

  const effectiveTunerGainDb = useMemo(() => {
    if (deviceProfile?.kind === "hackrf_one") {
      return estimateHackrfTotalGainDb({
        ampEnabled: effectiveSdrSettings?.gain?.hackrf_amp_enable,
        lnaGainDb: effectiveSdrSettings?.gain?.hackrf_lna_gain,
        vgaGainDb: effectiveSdrSettings?.gain?.hackrf_vga_gain,
      });
    }

    return effectiveSdrSettings?.gain?.tuner_gain ?? 0;
  }, [
    deviceProfile?.kind,
    effectiveSdrSettings?.gain?.hackrf_amp_enable,
    effectiveSdrSettings?.gain?.hackrf_lna_gain,
    effectiveSdrSettings?.gain?.hackrf_vga_gain,
    effectiveSdrSettings?.gain?.tuner_gain,
  ]);

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
    () => buildSdrLimitMarkers(sdrLimitMarkers),
    [sdrLimitMarkers],
  );
  // themeState removed — FFTCanvas now handles theme reactivity internally

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }, [activeTab]);

  // Device connection state management
  useDeviceConnectionState({
    deviceState: deviceState || "disconnected",
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
    return (
      <FastSnapshotControl
        disabled={
          fftSnapshotLoading ||
          (isRecording !== null && isRecording !== "spectrum")
        }
        isRecording={isRecording === "spectrum"}
        recordingSecondsRemaining={recordingSecondsRemaining}
        videoFormat={supportedVideoFormat}
        onImage={() =>
          takeFastSnapshot(
            "spectrum",
            () => fftCanvasRef.current?.getSnapshotData() ?? null,
            spectrumWidth,
            spectrumHeight,
            getCanvases,
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
  ]);

  const fastWaterfallSnapshotAction = useMemo<ReactNode>(() => {
    const waterfallCanvas = fftCanvasRef.current?.getWaterfallCanvas();
    const waterfallWidth = waterfallCanvas?.width ?? 1;
    const waterfallHeight =
      waterfallCanvas?.height ?? FAST_WATERFALL_FALLBACK_HEIGHT;
    return (
      <FastSnapshotControl
        disabled={
          fftSnapshotLoading ||
          (isRecording !== null && isRecording !== "waterfall")
        }
        isRecording={isRecording === "waterfall"}
        recordingSecondsRemaining={recordingSecondsRemaining}
        videoFormat={supportedVideoFormat}
        onImage={() =>
          takeFastSnapshot(
            "waterfall",
            () => fftCanvasRef.current?.getSnapshotData() ?? null,
            waterfallWidth,
            waterfallHeight,
            getCanvases,
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
    backend: backend ?? undefined,
    deviceInfo: deviceInfo ?? undefined,
    effectiveSdrSettings: effectiveSdrSettings ?? undefined,
    deviceName: deviceName ?? undefined,
    fftFrameRate: state.fftFrameRate,
    captureWholeChannelSegments,
    getSnapshotData: () => fftCanvasRef.current?.getSnapshotData() ?? undefined,
    getVideoSourceCanvases: () => {
      const spectrumCanvas = fftCanvasRef.current?.getSpectrumCanvas() ?? null;
      const waterfallCanvas =
        fftCanvasRef.current?.getWaterfallCanvas() ?? null;
      return {
        spectrum: spectrumCanvas,
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
      const channelClampedRange = clampFrequencyRangeToBounds(
        range,
        activeSignalAreaBounds,
      );
      const hardwareClampedRange = normalizeFrequencyRangeToHz(
        clampFrequencyRangeToBounds(
          channelClampedRange,
          hardwareSpectrumBounds,
        ),
      );
      dispatch({ type: "SET_FREQUENCY_RANGE", range: hardwareClampedRange });
      sendFrequencyRange(hardwareClampedRange);
    },
    [
      sendFrequencyRange,
      dispatch,
      hardwareSpectrumBounds,
      activeSignalAreaBounds,
    ],
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

  return (
    <SpectrumContainer>
      <SpectrumContent>
        {state.sourceMode === "live" &&
          state.frequencyRange &&
          centerFrequencyHz !== null && (
            <>
              <FFTAndWaterfall
                ref={fftCanvasRef}
                dataRef={dataRef}
                frequencyRange={state.frequencyRange}
                centerFrequencyHz={centerFrequencyHz}
                activeSignalArea={state.activeSignalArea}
                signalAreaBounds={signalAreaBounds ?? undefined}
                hardwareSampleRateHz={sampleRateHzEffective ?? undefined}
                deviceProfile={deviceProfile}
                tunerGainDb={effectiveTunerGainDb}
                isIqRecordingActive={captureStatus?.status === "started"}
                limitMarkers={limitMarkers}
                isPaused={manualVisualizerPaused}
                fftSize={state.fftSize}
                fftWindow={state.fftWindow}
                powerScale={state.powerScale}
                isDeviceConnected={deviceState === "connected"}
                onFrequencyRangeChange={handleFrequencyRangeChange}
                displayTemporalResolution={state.displayTemporalResolution}
                vizZoom={vizZoom}
                vizZoomFloor={vizZoomFloor}
                vizZoomFloorPan={state.vizZoomFloorPan}
                vizPanOffset={vizPanOffset}
                autoZoomStability={state.autoZoomStability}
                placeholderSourceLabel={deviceName ?? backend ?? "device"}
                onVizZoomChange={setVizZoom}
                onVizZoomFloorChange={setVizZoomFloor}
                onVizZoomFloorPanChange={(pan) =>
                  dispatch({ type: "SET_VIZ_ZOOM_FLOOR_PAN", pan })
                }
                onVizPanChange={setVizPanOffset}
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
                visualizerSessionKey="live"
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
              displayMode={state.displayMode}
              powerScale={state.powerScale}
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
