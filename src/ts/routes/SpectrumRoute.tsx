import React, { useEffect, useCallback, useRef, useMemo } from "react";
import { FFTCanvas } from "@n-apt/components";
import type { FFTCanvasHandle } from "@n-apt/components";
import ClassificationControls from "@n-apt/components/ClassificationControls";
import FFTStitcherCanvas from "@n-apt/components/FFTStitcherCanvas";
import { useSnapshot } from "@n-apt/hooks/useSnapshot";
import type { FrequencyRange } from "@n-apt/hooks/useWebSocket";
import {
  InitializingContainer,
  InitializingTitle,
  InitializingText,
} from "@n-apt/components/Layout";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";

interface SpectrumRouteProps {
  activeTab: "visualizer" | "analysis" | "draw";
}

export const SpectrumRoute: React.FC<SpectrumRouteProps> = ({ activeTab }) => {
  const fftCanvasRef = useRef<FFTCanvasHandle | null>(null);
  const {
    state,
    dispatch,
    manualVisualizerPaused,
    routePaused,
    effectiveSdrSettings,
    sampleRateMHz,
    signalAreaBounds,
    wsConnection: {
      isConnected,
      deviceState,
      backend,
      deviceInfo,
      sendFrequencyRange,
      sendTrainingCommand,
      dataRef,
    },
  } = useSpectrumStore();

  const [vizZoom, setVizZoom] = [
    state.vizZoom,
    (zoom: number) => dispatch({ type: "SET_VIZ_ZOOM", zoom }),
  ] as const;
  const [vizPanOffset, setVizPanOffset] = [
    state.vizPanOffset,
    (pan: number) => dispatch({ type: "SET_VIZ_PAN", pan }),
  ] as const;

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }, [activeTab]);

  const { handleSnapshot: takeSnapshot } = useSnapshot(
    state.frequencyRange ?? null,
    isConnected,
  );

  // Snapshot listener for sidebar events
  useEffect(() => {
    const listener = (e: Event) => {
      const options = (e as CustomEvent).detail;
      let sdrSettingsLabel: string | undefined;
      if (effectiveSdrSettings) {
        const agcOn =
          effectiveSdrSettings.gain?.rtl_agc ||
          effectiveSdrSettings.gain?.tuner_agc;
        const gainStr = agcOn
          ? "Auto"
          : effectiveSdrSettings.gain?.tuner_gain
            ? `${effectiveSdrSettings.gain.tuner_gain} dB`
            : "N/A";
        const ppmStr =
          effectiveSdrSettings.ppm !== undefined
            ? effectiveSdrSettings.ppm.toString()
            : "0";
        sdrSettingsLabel = `Gain: ${gainStr} | PPM: ${ppmStr}`;
      }

      takeSnapshot({
        ...options,
        showGrid: options.grid ?? state.snapshotGridPreference,
        getSnapshotData: () => fftCanvasRef.current?.getSnapshotData() ?? null,
        signalAreaBounds,
        activeSignalArea: state.activeSignalArea,
        sourceName: backend || deviceInfo || undefined,
        sdrSettingsLabel,
      });
    };
    window.addEventListener("napt-snapshot", listener);
    return () => window.removeEventListener("napt-snapshot", listener);
  }, [
    takeSnapshot,
    state.snapshotGridPreference,
    signalAreaBounds,
    state.activeSignalArea,
    backend,
    deviceInfo,
    effectiveSdrSettings,
  ]);

  const handleTrainingCaptureStart = useCallback(
    (label: "target" | "noise") => {
      dispatch({ type: "TRAINING_START", label });
      sendTrainingCommand("start", label, state.activeSignalArea);
    },
    [sendTrainingCommand, state.activeSignalArea, dispatch],
  );

  const handleTrainingCaptureStop = useCallback(() => {
    dispatch({ type: "TRAINING_STOP" });
    sendTrainingCommand(
      "stop",
      state.trainingCaptureLabel ?? "target",
      state.activeSignalArea,
    );
  }, [
    sendTrainingCommand,
    state.trainingCaptureLabel,
    state.activeSignalArea,
    dispatch,
  ]);

  const handleFrequencyRangeChange = useCallback(
    (range: FrequencyRange) => {
      dispatch({ type: "SET_FREQUENCY_RANGE", range });
      sendFrequencyRange(range);
    },
    [sendFrequencyRange, dispatch],
  );

  const centerFrequencyMHz = useMemo(() => {
    if (!state.frequencyRange) return null;
    const min = state.frequencyRange.min;
    const max = state.frequencyRange.max;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

    if (state.sourceMode === "live" && sampleRateMHz !== null) {
      return min + sampleRateMHz / 2;
    }

    return (min + max) / 2;
  }, [state.frequencyRange, sampleRateMHz, state.sourceMode]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {state.sourceMode === "live" &&
          state.frequencyRange &&
          centerFrequencyMHz !== null && (
            <>
              {deviceState === "connected" && (
                <ClassificationControls
                  isDeviceConnected={deviceState === "connected"}
                  activeSignalArea={state.activeSignalArea}
                  isCapturing={state.isTrainingCapturing}
                  captureLabel={state.trainingCaptureLabel}
                  capturedSamples={state.trainingCapturedSamples}
                  onCaptureStart={handleTrainingCaptureStart}
                  onCaptureStop={handleTrainingCaptureStop}
                />
              )}
              <FFTCanvas
                ref={fftCanvasRef}
                dataRef={dataRef}
                frequencyRange={state.frequencyRange}
                centerFrequencyMHz={centerFrequencyMHz}
                activeSignalArea={state.activeSignalArea}
                signalAreaBounds={signalAreaBounds ?? undefined}
                isPaused={routePaused || manualVisualizerPaused}
                isDeviceConnected={deviceState === "connected"}
                onFrequencyRangeChange={handleFrequencyRangeChange}
                displayTemporalResolution={state.displayTemporalResolution}
                vizZoom={vizZoom}
                vizPanOffset={vizPanOffset}
                onVizZoomChange={setVizZoom}
                onVizPanChange={setVizPanOffset}
                fftMin={state.fftMinDb}
                fftMax={state.fftMaxDb}
                onFftDbLimitsChange={(min, max) =>
                  dispatch({ type: "SET_FFT_DB_LIMITS", min, max })
                }
                onSnapshot={() => { }}
                snapshotGridPreference={state.snapshotGridPreference}
              />
            </>
          )}
        {state.sourceMode === "live" &&
          (!state.frequencyRange || centerFrequencyMHz === null) && (
            <InitializingContainer>
              <InitializingTitle>
                Loading Signal Configuration
              </InitializingTitle>
              <InitializingText>
                Waiting for signals.yaml settings from the server...
              </InitializingText>
            </InitializingContainer>
          )}
        {state.sourceMode === "file" && (
          <FFTStitcherCanvas
            selectedFiles={state.selectedFiles}
            stitchTrigger={state.stitchTrigger}
            stitchSourceSettings={state.stitchSourceSettings}
            isPaused={state.isStitchPaused}
            fftSize={state.fftSize}
            onStitchStatus={(status) =>
              dispatch({ type: "SET_STITCH_STATUS", status })
            }
            snapshotGridPreference={state.snapshotGridPreference}
            vizZoom={vizZoom}
            vizPanOffset={vizPanOffset}
            onVizZoomChange={setVizZoom}
            onVizPanChange={setVizPanOffset}
            fftMin={state.fftMinDb}
            fftMax={state.fftMaxDb}
            onFftDbLimitsChange={(min, max) =>
              dispatch({ type: "SET_FFT_DB_LIMITS", min, max })
            }
          />
        )}
      </div>
    </div>
  );
};
