import React, { useEffect, useCallback, useRef, useMemo } from "react";
import styled from "styled-components";
import { FFTAndWaterfall } from "@n-apt/components";
import type { FFTCanvasHandle } from "@n-apt/components";
import FFTPlaybackCanvas from "@n-apt/components/FFTPlaybackCanvas";
import { useSnapshot } from "@n-apt/hooks/useSnapshot";
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

interface SpectrumRouteProps {
  activeTab: "visualizer" | "analysis" | "draw";
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

export const SpectrumRoute: React.FC<SpectrumRouteProps> = ({ activeTab }) => {
  const fftCanvasRef = useRef<FFTCanvasHandle | null>(null);
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

  const [vizZoom, setVizZoom] = [
    state.vizZoom,
    (zoom: number) => dispatch({ type: "SET_VIZ_ZOOM", zoom }),
  ] as const;
  const [vizZoomFloor, setVizZoomFloor] = [
    state.vizZoomFloor,
    (zoomFloor: number) =>
      dispatch({ type: "SET_VIZ_ZOOM_FLOOR", zoomFloor }),
  ] as const;
  const [vizPanOffset, setVizPanOffset] = [
    state.vizPanOffset,
    (pan: number) => dispatch({ type: "SET_VIZ_PAN", pan }),
  ] as const;
  const limitMarkers = useMemo(
    () =>
      buildSdrLimitMarkers(
        effectiveSdrSettings ?? null,
        sdrLimitMarkers,
      ),
    [effectiveSdrSettings, sdrLimitMarkers],
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

  const { handleSnapshot: takeSnapshot } = useSnapshot(
    state.frequencyRange ?? null,
    isConnected,
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
      dispatch({ type: "SET_FREQUENCY_RANGE", range });
      sendFrequencyRange(range);
    },
    [sendFrequencyRange, dispatch],
  );

  const centerFrequencyHz = useMemo(() => {
    return calculateCenterFrequency(state.frequencyRange);
  }, [state.frequencyRange]);

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
          const currentRange = state.frequencyRange;
          const fullRange = currentRange.max - currentRange.min;
          const newMin = currentRange.min + shiftHz;
          const newMax = newMin + fullRange;

          // Clamping logic
          const bounds =
            signalAreaBounds?.[state.activeSignalArea] ||
            signalAreaBounds?.[state.activeSignalArea.toLowerCase()];

          let finalMin = newMin;
          let finalMax = newMax;

          if (bounds) {
            if (finalMin < bounds.min) {
              finalMin = bounds.min;
              finalMax = finalMin + fullRange;
            } else if (finalMax > bounds.max) {
              finalMax = bounds.max;
              finalMin = finalMax - fullRange;
            }
          }

          handleFrequencyRangeChange({ min: finalMin, max: finalMax });
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
    signalAreaBounds,
    toggleVisualizerPause,
    handleFrequencyRangeChange,
    setVizPanOffset,
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
                tunerGainDb={effectiveSdrSettings?.gain?.tuner_gain}
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
                vizPanOffset={vizPanOffset}
                onVizZoomChange={setVizZoom}
                onVizZoomFloorChange={setVizZoomFloor}
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
                awaitingDeviceData={
                  isConnected &&
                  deviceState !== "connected" &&
                  deviceState !== "loading" &&
                  deviceState !== "stale"
                }
                visualizerMachine={fftVisualizerMachine}
                visualizerSessionKey="live"
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
            displayMode={state.displayMode}
            powerScale={state.powerScale}
            onStitchStatus={(status) =>
              dispatch({ type: "SET_STITCH_STATUS", status })
            }
            snapshotGridPreference={state.snapshotGridPreference}
            vizZoom={vizZoom}
            vizZoomFloor={vizZoomFloor}
            vizPanOffset={vizPanOffset}
            onVizZoomChange={setVizZoom}
            onVizZoomFloorChange={setVizZoomFloor}
            onVizPanChange={setVizPanOffset}
            fftMin={state.fftMinDb}
            fftMax={state.fftMaxDb}
            onFftDbLimitsChange={(min, max) =>
              dispatch({ type: "SET_FFT_DB_LIMITS", min, max })
            }
            visualizerMachine={fftVisualizerMachine}
          />
        )}
      </SpectrumContent>
    </SpectrumContainer>
  );
};
