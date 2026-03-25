import React, { useEffect, useCallback, useRef, useMemo } from "react";
import { FFTCanvas } from "@n-apt/components";
import type { FFTCanvasHandle } from "@n-apt/components";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";
import ClassificationControls from "@n-apt/components/ClassificationControls";
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

interface SpectrumRouteProps {
  activeTab: "visualizer" | "analysis" | "draw";
}

export const SpectrumRoute: React.FC<SpectrumRouteProps> = ({ activeTab }) => {
  const fftCanvasRef = useRef<FFTCanvasHandle | null>(null);
  const {
    state,
    dispatch,
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
      sendTrainingCommand,
      sendGetAutoFftOptions,
      dataRef,
      captureStatus,
      sendPowerScaleCommand: _sendPowerScaleCommand,
    },
    sampleRateHzEffective,
  } = useSpectrumStore();

  const [vizZoom, setVizZoom] = [
    state.vizZoom,
    (zoom: number) => dispatch({ type: "SET_VIZ_ZOOM", zoom }),
  ] as const;
  const [vizPanOffset, setVizPanOffset] = [
    state.vizPanOffset,
    (pan: number) => dispatch({ type: "SET_VIZ_PAN", pan }),
  ] as const;
  const limitMarkers = useMemo(
    () => buildSdrLimitMarkers(effectiveSdrSettings ?? null),
    [effectiveSdrSettings],
  );
  // themeState removed — FFTCanvas now handles theme reactivity internally

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }, [activeTab]);


  useEffect(() => {
    if (deviceState !== "connected" && state.showSpikeOverlay) {
      dispatch({ type: "SET_SHOW_SPIKE_OVERLAY", enabled: false });
    }
    if (deviceState !== "connected") {
      dispatch({ type: "SET_HETERODYNING_VERIFY_DISABLED", disabled: true });
      dispatch({
        type: "SET_HETERODYNING_RESULT",
        detected: false,
        confidence: null,
        statusText: "Unavailable",
        highlightedBins: [],
      });
    } else {
      dispatch({ type: "SET_HETERODYNING_VERIFY_DISABLED", disabled: false });
    }
  }, [deviceState, state.showSpikeOverlay, dispatch]);

  const { handleSnapshot: takeSnapshot } = useSnapshot(
    state.frequencyRange ?? null,
    isConnected,
  );

  const captureWholeChannelSegments = useCallback(async () => {
    const fullRange = state.frequencyRange;
    const hardwareSpanMHz = sampleRateHzEffective
      ? sampleRateHzEffective / 1_000_000
      : null;

    if (
      !fullRange ||
      state.sourceMode !== "live" ||
      !hardwareSpanMHz ||
      !(hardwareSpanMHz > 0)
    ) {
      return [];
    }

    const area = state.activeSignalArea?.toLowerCase();
    const channelRange = area ? signalAreaBounds?.[area] ?? fullRange : fullRange;
    const totalSpan = channelRange.max - channelRange.min;
    if (!(totalSpan > hardwareSpanMHz + 0.0001)) {
      return [];
    }

    const settleMs = 1000;
    const raf = () =>
      new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const originalRange = fullRange;
    const originalPan = state.vizPanOffset;
    const originalZoom = state.vizZoom;
    const segments: Array<{
      data: SnapshotData;
      visualRange: { min: number; max: number };
    }> = [];

    try {
      for (
        let segmentMin = channelRange.min;
        segmentMin < channelRange.max - 0.0001;
        segmentMin += hardwareSpanMHz
      ) {
        // Ensure the segment always has the full hardwareSpanMHz
        // If we reach the end, "slide" back so the segment covers the end boundaries
        let actualMin = segmentMin;
        let actualMax = segmentMin + hardwareSpanMHz;

        if (actualMax > channelRange.max) {
          actualMax = channelRange.max;
          actualMin = Math.max(channelRange.min, actualMax - hardwareSpanMHz);
        }

        const nextRange = {
          min: actualMin,
          max: actualMax,
        };

        dispatch({ type: "SET_FREQUENCY_RANGE", range: nextRange });
        sendFrequencyRange(nextRange);
        dispatch({ type: "SET_VIZ_ZOOM", zoom: 1 });
        dispatch({ type: "SET_VIZ_PAN", pan: 0 });
        dispatch({ type: "CLEAR_WATERFALL" });

        await raf();
        await sleep(settleMs);
        await raf();
        await raf();

        const data = fftCanvasRef.current?.getSnapshotData();
        if (data?.waveform?.length) {
          segments.push({
            data,
            visualRange: nextRange,
          });
        }

        // Break if we've reached the end to avoid redundant slides
        if (actualMax >= channelRange.max - 0.0001) break;
      }
    } finally {
      dispatch({ type: "SET_FREQUENCY_RANGE", range: originalRange });
      sendFrequencyRange(originalRange);
      dispatch({ type: "SET_VIZ_ZOOM", zoom: originalZoom });
      dispatch({ type: "SET_VIZ_PAN", pan: originalPan });
      await raf();
    }

    return segments;
  }, [
    dispatch,
    sampleRateHzEffective,
    sendFrequencyRange,
    signalAreaBounds,
    state.activeSignalArea,
    state.fftFrameRate,
    state.frequencyRange,
    state.sourceMode,
    state.vizPanOffset,
    state.vizZoom,
  ]);

  // Snapshot listener for sidebar events
  useEffect(() => {
    const listener = async (e: Event) => {
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

      const modeLabel = options.whole ? "Whole Channel" : "Onscreen";
      const wholeChannelSegments =
        options.whole && state.sourceMode === "live"
          ? await captureWholeChannelSegments()
          : [];

      takeSnapshot({
        ...options,
        modeLabel,
        wholeChannelSegments,
        showGrid: options.grid ?? state.snapshotGridPreference,
        getSnapshotData: () => fftCanvasRef.current?.getSnapshotData() ?? null,
        signalAreaBounds,
        activeSignalArea: state.activeSignalArea,
        sourceName: deviceName || backend || deviceInfo || undefined,
        sdrSettingsLabel,
        showGeolocation: options.showGeolocation,
        geolocation: options.geolocation,
      });
    };
    window.addEventListener("napt-snapshot", listener);
    return () => window.removeEventListener("napt-snapshot", listener);
  }, [
    takeSnapshot,
    state.snapshotGridPreference,
    signalAreaBounds,
    state.activeSignalArea,
    state.sourceMode,
    backend,
    deviceInfo,
    effectiveSdrSettings,
    captureWholeChannelSegments,
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
    return (min + max) / 2;
  }, [state.frequencyRange]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        backgroundColor: "var(--color-background)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
          position: "relative",
          backgroundColor: "var(--color-background)",
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
                sendGetAutoFftOptions={sendGetAutoFftOptions}
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
