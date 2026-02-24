import React, { useEffect, useCallback, useRef, useMemo, useReducer } from "react";
import styled from "styled-components";
import SidebarNew from "@n-apt/components/sidebar/SidebarNew";
import AuthenticationPrompt from "@n-apt/components/AuthenticationPrompt";
import { FFTCanvas } from "@n-apt/components";
import ClassificationControls from "@n-apt/components/ClassificationControls";
import Decode from "@n-apt/components/Decode";
import DrawMockNAPTChart from "@n-apt/components/DrawMockNAPTChart";
import FFTStitcherCanvas from "@n-apt/components/FFTStitcherCanvas";
import { useWebSocket, FrequencyRange, SpectrumFrame } from "@n-apt/hooks/useWebSocket";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { useSnapshot } from "@n-apt/hooks/useSnapshot";
import { buildWsUrl } from "@n-apt/services/auth";

// Types
type SourceMode = "live" | "file";
type SelectedFile = { name: string; file: File };

const VISUALIZER_PAUSED_KEY = "napt-visualizer-paused";

// Styled Components
const AppContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100vh;
  background-color: #0a0a0a;
`;

const AppWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
`;

const MainContent = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

const InitializingContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #0a0a0a;
  padding: 40px;
  gap: 32px;
`;

const InitializingTitle = styled.h2`
  font-family: "JetBrains Mono", monospace;
  font-size: 18px;
  font-weight: 600;
  color: #e0e0e0;
  margin: 0;
  letter-spacing: 0.5px;
  animation: pulse 1.5s ease-in-out infinite;

  @keyframes pulse {
    0% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0.4;
    }
  }
`;

const InitializingText = styled.p`
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  color: #666;
  margin: 0;
  text-align: center;
  max-width: 400px;
  line-height: 1.6;
`;

type DrawParams = {
  spikeCount: number;
  spikeWidth: number;
  centerSpikeBoost: number;
  floorAmplitude: number;
  decayRate: number;
  envelopeWidth: number;
};

type SpectrumState = {
  activeSignalArea: string;
  frequencyRange: FrequencyRange;
  displayTemporalResolution: "low" | "medium" | "high";
  selectedFiles: SelectedFile[];
  snapshotGridPreference: boolean;
  drawParams: DrawParams;
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
};

type SpectrumAction =
  | { type: "SET_SIGNAL_AREA"; area: string }
  | { type: "SET_FREQUENCY_RANGE"; range: FrequencyRange }
  | {
      type: "SET_SIGNAL_AREA_AND_RANGE";
      area: string;
      range: FrequencyRange;
    }
  | {
      type: "SET_TEMPORAL_RESOLUTION";
      resolution: "low" | "medium" | "high";
    }
  | { type: "SET_SELECTED_FILES"; files: SelectedFile[] }
  | { type: "SET_SNAPSHOT_GRID"; preference: boolean }
  | { type: "SET_DRAW_PARAMS"; params: DrawParams }
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
  | { type: "SET_FFT_FRAME_RATE"; fftFrameRate: number };

const INITIAL_SPECTRUM_STATE: SpectrumState = {
  activeSignalArea: "A",
  frequencyRange: { min: 88, max: 108 },
  displayTemporalResolution: "medium",
  selectedFiles: [],
  snapshotGridPreference: true,
  drawParams: {
    spikeCount: 40,
    spikeWidth: 0.4,
    centerSpikeBoost: 4.9,
    floorAmplitude: 0.5,
    decayRate: 0.2,
    envelopeWidth: 10,
  },
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
};

function spectrumReducer(state: SpectrumState, action: SpectrumAction): SpectrumState {
  switch (action.type) {
    case "SET_SIGNAL_AREA":
      return { ...state, activeSignalArea: action.area };
    case "SET_FREQUENCY_RANGE":
      if (
        state.frequencyRange.min === action.range.min &&
        state.frequencyRange.max === action.range.max
      ) {
        return state;
      }
      return { ...state, frequencyRange: action.range };
    case "SET_SIGNAL_AREA_AND_RANGE":
      return {
        ...state,
        activeSignalArea: action.area,
        frequencyRange: action.range,
      };
    case "SET_TEMPORAL_RESOLUTION":
      return {
        ...state,
        displayTemporalResolution: action.resolution,
      };
    case "SET_SELECTED_FILES":
      return { ...state, selectedFiles: action.files };
    case "SET_SNAPSHOT_GRID":
      return { ...state, snapshotGridPreference: action.preference };
    case "SET_DRAW_PARAMS":
      return { ...state, drawParams: action.params };
    case "SET_SOURCE_MODE":
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
    case "LEAVE_VISUALIZER":
      return {
        ...state,
        visualizerPaused: true,
        isStitchPaused: true,
      };
    default:
      return state;
  }
}

interface SpectrumRouteProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isSidebarOpen: boolean;
  onAuthChange?: (isAuthenticated: boolean) => void;
  sidebarWrapper?: (sidebar: React.ReactNode) => React.ReactNode;
}

export const SpectrumRoute: React.FC<SpectrumRouteProps> = ({
  activeTab,
  onTabChange,
  isSidebarOpen,
  onAuthChange,
  sidebarWrapper,
}) => {
  const fftCanvasRef = useRef<{
    getSpectrumCanvas: () => HTMLCanvasElement | null;
    getWaterfallCanvas: () => HTMLCanvasElement | null;
    triggerSnapshotRender: () => void;
  } | null>(null);
  const [state, dispatch] = useReducer(spectrumReducer, INITIAL_SPECTRUM_STATE, (base) => ({
    ...base,
    visualizerPaused: sessionStorage.getItem(VISUALIZER_PAUSED_KEY) === "true",
  }));

  useEffect(() => {
    sessionStorage.setItem(VISUALIZER_PAUSED_KEY, String(state.visualizerPaused));
  }, [state.visualizerPaused]);

  useEffect(() => {
    if (activeTab === "visualizer") {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    }
  }, [activeTab]);

  const isVisualizer = activeTab === "visualizer";
  const isDraw = activeTab === "draw";
  const isAnalysis = activeTab === "analysis";

  const {
    authState,
    isAuthenticated,
    authError,
    sessionToken,
    aesKey,
    hasPasskeys,
    isInitialAuthCheck,
    handlePasswordAuth,
    handlePasskeyAuth,
    handleRegisterPasskey,
  } = useAuthentication();

  useEffect(() => {
    onAuthChange?.(isAuthenticated);
  }, [isAuthenticated, onAuthChange]);

  useEffect(() => {
    if (isAuthenticated) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    }
  }, [isAuthenticated]);

  const waveformRef = useRef<Float32Array | number[] | null>(null);
  const getCurrentWaveform = useCallback(() => waveformRef.current ?? null, []);

  const wsUrl = sessionToken ? buildWsUrl(sessionToken) : "";

  const {
    isConnected,
    deviceState,
    deviceLoadingReason,
    backend,
    deviceInfo,
    maxSampleRateHz,
    serverPaused,
    dataRef,
    captureStatus,
    spectrumFrames: wsSpectrumFrames,
    autoFftOptions,
    sendFrequencyRange,
    sendPauseCommand,
    sendSettings,
    sendRestartDevice,
    sendTrainingCommand,
    sendCaptureCommand,
    sendGetAutoFftOptions,
  } = useWebSocket(wsUrl, aesKey, isAuthenticated);

  const { handleSnapshot: takeSnapshot } = useSnapshot(state.frequencyRange ?? null, isConnected);

  // Still support waveformRef for older components, mapping it to the new dataRef
  waveformRef.current = dataRef.current?.waveform ?? null;

  const syncedInitialPauseRef = useRef(false);
  useEffect(() => {
    if (isConnected && !syncedInitialPauseRef.current) {
      // Initialize local pause state to match server's pause state when we first connect.
      // This prevents auto-playing if the user comes back from 4th/5th tabs and the server was paused.
      dispatch({ type: "SET_VISUALIZER_PAUSED", paused: serverPaused });
      syncedInitialPauseRef.current = true;
    }
  }, [isConnected, serverPaused]);

  const setDrawParams = useCallback(
    (params: DrawParams) => dispatch({ type: "SET_DRAW_PARAMS", params }),
    [],
  );
  const setSourceMode = useCallback(
    (mode: SourceMode) => dispatch({ type: "SET_SOURCE_MODE", mode }),
    [],
  );
  const setSelectedFiles = useCallback(
    (files: SelectedFile[]) => dispatch({ type: "SET_SELECTED_FILES", files }),
    [],
  );
  const setDisplayTemporalResolution = useCallback(
    (resolution: "low" | "medium" | "high") =>
      dispatch({ type: "SET_TEMPORAL_RESOLUTION", resolution }),
    [],
  );
  const setStitchSourceSettings = useCallback(
    (settings: { gain: number; ppm: number }) =>
      dispatch({
        type: "SET_STITCH_SOURCE_SETTINGS",
        settings,
      }),
    [],
  );
  const setSnapshotGridPreference = useCallback(
    (preference: boolean) => dispatch({ type: "SET_SNAPSHOT_GRID", preference }),
    [],
  );
  const setStitchStatus = useCallback(
    (status: string) => dispatch({ type: "SET_STITCH_STATUS", status }),
    [],
  );

  const handleTrainingCaptureStart = useCallback(
    (label: "target" | "noise") => {
      dispatch({ type: "TRAINING_START", label });
      sendTrainingCommand("start", label, state.activeSignalArea);
    },
    [sendTrainingCommand, state.activeSignalArea],
  );

  const handleTrainingCaptureStop = useCallback(() => {
    dispatch({ type: "TRAINING_STOP" });
    sendTrainingCommand("stop", state.trainingCaptureLabel ?? "target", state.activeSignalArea);
  }, [sendTrainingCommand, state.trainingCaptureLabel, state.activeSignalArea]);

  const handleStitch = useCallback(() => {
    dispatch({ type: "TRIGGER_STITCH" });
  }, []);

  const handleStitchPauseToggle = useCallback(() => {
    dispatch({ type: "TOGGLE_STITCH_PAUSE" });
  }, []);

  const handleClear = useCallback(() => {
    dispatch({ type: "SET_SELECTED_FILES", files: [] });
  }, []);

  const handleSnapshot = useCallback(
    (options: {
      whole: boolean;
      showWaterfall: boolean;
      showStats: boolean;
      format: "svg" | "png";
      grid: boolean;
    }) => {
      takeSnapshot({
        ...options,
        getSpectrumCanvas: () => fftCanvasRef.current?.getSpectrumCanvas() ?? null,
        getWaterfallCanvas: () => fftCanvasRef.current?.getWaterfallCanvas() ?? null,
        getSnapshotGridPreference: () => options.grid ?? state.snapshotGridPreference,
      });
    },
    [takeSnapshot, state.snapshotGridPreference],
  );

  const prevIsVisualizerRef = useRef(isVisualizer);
  useEffect(() => {
    const prevIsVisualizer = prevIsVisualizerRef.current;
    prevIsVisualizerRef.current = isVisualizer;

    if (prevIsVisualizer !== isVisualizer) {
      if (!isVisualizer) {
        sendPauseCommand(true);
        dispatch({ type: "SET_VISUALIZER_PAUSED", paused: true });
      }
      dispatch({
        type: "SET_STITCH_PAUSED",
        paused: !isVisualizer,
      });
    }
  }, [isVisualizer, isConnected, sendPauseCommand]);

  const skipFirstCleanupRef = useRef(true);
  useEffect(() => {
    return () => {
      // In React 18 strict mode effects run twice; skip the first simulated cleanup
      if (skipFirstCleanupRef.current) {
        skipFirstCleanupRef.current = false;
        return;
      }
      // Pause and snapshot when unmounting the route
      dispatch({ type: "LEAVE_VISUALIZER" });
      sendPauseCommand(true);
    };
  }, [dispatch, sendPauseCommand]);

  const handleVisualizerPauseToggle = useCallback(() => {
    const newPausedState = !state.visualizerPaused;
    dispatch({
      type: "SET_VISUALIZER_PAUSED",
      paused: newPausedState,
    });
    if (isConnected) {
      sendPauseCommand(newPausedState);
    }
  }, [state.visualizerPaused, isConnected, sendPauseCommand]);

  const handleSignalAreaChange = useCallback(
    (area: string) => {
      if (area !== state.activeSignalArea) {
        const frame = wsSpectrumFrames.find(
          (f: SpectrumFrame) => f.label.toLowerCase() === area.toLowerCase(),
        );
        if (frame) {
          const nextRange = {
            min: frame.min_mhz,
            max: Math.min(frame.max_mhz, frame.min_mhz + 3.2),
          };
          dispatch({
            type: "SET_SIGNAL_AREA_AND_RANGE",
            area,
            range: nextRange,
          });
          sendFrequencyRange(nextRange);
        } else {
          dispatch({ type: "SET_SIGNAL_AREA", area });
        }
      }
    },
    [state.activeSignalArea, wsSpectrumFrames, sendFrequencyRange],
  );

  const handleFrequencyRangeChange = useCallback(
    (range: FrequencyRange) => {
      dispatch({ type: "SET_FREQUENCY_RANGE", range });
      sendFrequencyRange(range);
    },
    [sendFrequencyRange],
  );

  const centerFrequencyMHz = useMemo(() => {
    const min = state.frequencyRange?.min;
    const max = state.frequencyRange?.max;
    if (
      typeof min !== "number" ||
      typeof max !== "number" ||
      !Number.isFinite(min) ||
      !Number.isFinite(max)
    ) {
      return 1.6;
    }
    return (min + max) / 2;
  }, [state.frequencyRange]);

  return (
    <AppContainer>
      <AppWrapper>
        <ContentArea>
          {(() => {
            if (!isAuthenticated || !isSidebarOpen) return null;
            const sidebarNode = (
              <SidebarNew
                isConnected={isConnected}
                deviceState={deviceState}
                deviceLoadingReason={deviceLoadingReason}
                isPaused={state.visualizerPaused}
                _serverPaused={serverPaused}
                backend={backend}
                deviceInfo={deviceInfo}
                maxSampleRateHz={maxSampleRateHz}
                captureStatus={captureStatus}
                autoFftOptions={autoFftOptions}
                onCaptureCommand={sendCaptureCommand}
                spectrumFrames={wsSpectrumFrames}
                activeTab={activeTab}
                onTabChange={onTabChange}
                drawParams={state.drawParams}
                onDrawParamsChange={setDrawParams}
                sourceMode={state.sourceMode}
                onSourceModeChange={setSourceMode}
                stitchStatus={state.stitchStatus}
                activeSignalArea={state.activeSignalArea}
                onSignalAreaChange={handleSignalAreaChange}
                onFrequencyRangeChange={handleFrequencyRangeChange}
                frequencyRange={state.frequencyRange}
                onPauseToggle={handleVisualizerPauseToggle}
                onSettingsChange={(settings) => {
                  if (settings.frameRate !== undefined) {
                    dispatch({ type: "SET_FFT_FRAME_RATE", fftFrameRate: settings.frameRate });
                  }
                  sendSettings(settings);
                }}
                displayTemporalResolution={state.displayTemporalResolution}
                onDisplayTemporalResolutionChange={setDisplayTemporalResolution}
                selectedFiles={state.selectedFiles}
                onSelectedFilesChange={setSelectedFiles}
                stitchSourceSettings={state.stitchSourceSettings}
                onStitchSourceSettingsChange={setStitchSourceSettings}
                isStitchPaused={state.isStitchPaused}
                onStitchPauseToggle={handleStitchPauseToggle}
                onStitch={handleStitch}
                onClear={handleClear}
                onRestartDevice={sendRestartDevice}
                snapshotGridPreference={state.snapshotGridPreference}
                onSnapshotGridPreferenceChange={setSnapshotGridPreference}
                fftWaveform={dataRef.current?.waveform ?? null}
                getCurrentWaveform={getCurrentWaveform}
                centerFrequencyMHz={centerFrequencyMHz}
                onSnapshot={handleSnapshot}
              />
            );
            return sidebarWrapper ? sidebarWrapper(sidebarNode) : sidebarNode;
          })()}
          <MainContent>
            {isVisualizer && isInitialAuthCheck && (
              <InitializingContainer>
                <InitializingTitle>Initializing N-APT</InitializingTitle>
                <InitializingText>
                  Establishing secure connection and verifying session...
                </InitializingText>
              </InitializingContainer>
            )}
            {isVisualizer && !isAuthenticated && !isInitialAuthCheck && (
              <AuthenticationPrompt
                authState={authState}
                error={authError}
                hasPasskeys={hasPasskeys}
                onPasswordSubmit={handlePasswordAuth}
                onPasskeyAuth={handlePasskeyAuth}
                onRegisterPasskey={handleRegisterPasskey}
              />
            )}
            {isVisualizer && isAuthenticated && state.sourceMode === "live" && (
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
                  isPaused={state.visualizerPaused}
                  isDeviceConnected={deviceState === "connected"}
                  onFrequencyRangeChange={handleFrequencyRangeChange}
                  displayTemporalResolution={state.displayTemporalResolution}
                  snapshotGridPreference={state.snapshotGridPreference}
                  sendGetAutoFftOptions={sendGetAutoFftOptions}
                />
              </>
            )}
            {isVisualizer && isAuthenticated && state.sourceMode === "file" && (
              <FFTStitcherCanvas
                selectedFiles={state.selectedFiles}
                stitchTrigger={state.stitchTrigger}
                stitchSourceSettings={state.stitchSourceSettings}
                isPaused={state.isStitchPaused}
                onStitchStatus={setStitchStatus}
              />
            )}
            {isAnalysis && isAuthenticated && <Decode />}
            {isDraw && <DrawMockNAPTChart {...state.drawParams} />}
          </MainContent>
        </ContentArea>
      </AppWrapper>
    </AppContainer>
  );
};
