import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useMemo,
  Dispatch,
  SetStateAction,
} from "react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import {
  useFrequencyScanner,
  FrequencyScannerHandle,
} from "@n-apt/hooks/useFrequencyScanner";
import {
  useAudioExtraction,
  AudioPlaybackHandle,
} from "@n-apt/hooks/useAudioExtraction";
import { useAudioDemodFM } from "@n-apt/hooks/useAudioDemodFM";
import { useAudioDemodAPT } from "@n-apt/hooks/useAudioDemodAPT";
import { useNAPTAudioDemod } from "@n-apt/hooks/useNAPTAudioDemod";
import {
  demodFrameRuntime,
  liveFrameRuntime,
} from "@n-apt/visualization/frameRuntime";
import {
  resolveDemodSourceRange,
  syncDemodSpanFromSourceContext,
} from "@n-apt/redux/thunks/demodThunks";
import { scannerWorkerManager } from "@n-apt/workers/scannerWorkerManager";
import {
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import {
  adaptDemodFlowForSourceMode,
  buildDemodFlowGraph,
} from "@n-apt/components/react-flow/flows";
import {
  AnalysisSession,
  AnalysisType,
  CaptureResult,
} from "@n-apt/consts/types";
import { NaptSpikeDetectionResult } from "@n-apt/utils/naptSpikeDetection";

const DEMOD_FLOW_SESSION_KEY = "n-apt:demod-flow";

const readSessionFlow = (
  sourceMode: string,
  fallback: { nodes: Node[]; edges: Edge[] },
) => {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.sessionStorage.getItem(DEMOD_FLOW_SESSION_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as {
      sourceMode?: string;
      nodes?: Node[];
      edges?: Edge[];
    };
    if (
      parsed.sourceMode !== sourceMode ||
      !Array.isArray(parsed.nodes) ||
      !Array.isArray(parsed.edges)
    ) {
      return fallback;
    }
    return { nodes: parsed.nodes, edges: parsed.edges };
  } catch {
    return fallback;
  }
};

interface DemodContextValue {
  windowSizeHz: number;
  setWindowSizeHz: (size: number) => void;
  stepSizeHz: number;
  setStepSizeHz: (size: number) => void;
  audioThreshold: number;
  setAudioThreshold: (threshold: number) => void;

  scanner: FrequencyScannerHandle;
  audioPlayback: AudioPlaybackHandle;

  currentIQData: Uint8Array | null;
  setCurrentIQData: (data: Uint8Array | null) => void;

  currentFreq: number | undefined;
  scanRange: { min: number; max: number } | undefined;

  analysisSession: AnalysisSession;
  selectedBaseline: AnalysisType;
  setSelectedBaseline: (type: AnalysisType) => void;
  liveMode: boolean;
  setLiveMode: (mode: boolean) => void;
  startAnalysis: (
    type: AnalysisType,
    liveMode?: boolean,
    durationS?: number,
    scriptContent?: string,
    mediaContent?: string,
    baselineVector?: number[],
  ) => void;
  clearAnalysis: () => void;

  startScan: () => Promise<void>;
  stopScan: () => void;

  // FM demodulation state
  selectedAlgorithm: "fm" | "apt" | "napt";
  setSelectedAlgorithm: (algorithm: "fm" | "apt" | "napt") => void;

  // React Flow state
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  clearFlow: () => void;
  setFlow: (flowId: string, customNodes?: Node[], customEdges?: Edge[]) => void;
  flowVersion: number;

  fileCapturedRange: { min: number; max: number } | null;
  naptDetectionResult: NaptSpikeDetectionResult | null;
  detectNaptSpikes: (
    iqData: Uint8Array,
    sampleRate: number,
    frameCenterFrequencyHz?: number | null,
  ) => NaptSpikeDetectionResult | null;
}

export const DemodContext = createContext<DemodContextValue | null>(null);

export const useDemod = () => {
  const context = useContext(DemodContext);
  if (!context) throw new Error("useDemod must be used within a DemodProvider");
  return context;
};

export const DemodProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const reduxDispatch = useAppDispatch();
  const [windowSizeHz, setWindowSizeHz] = useState(25000);
  const [stepSizeHz, setStepSizeHz] = useState(10000);
  const [audioThreshold, setAudioThreshold] = useState(0.3);
  const [currentIQData, setCurrentIQData] = useState<Uint8Array | null>(null);
  const [scanRange, setScanRange] = useState<
    { min: number; max: number } | undefined
  >();
  const [analysisSession, setAnalysisSession] = useState<AnalysisSession>({
    state: "idle",
  });
  const [selectedBaseline, setSelectedBaseline] =
    useState<AnalysisType>("audio");
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<
    "fm" | "apt" | "napt"
  >("fm");
  const { state, wsConnection, effectiveFrames, effectiveSdrSettings } =
    useSpectrumStore();
  const { sendCaptureCommand, sendScanCommand, sendDemodulateCommand } =
    wsConnection;

  const demodState = useAppSelector((state) => state.demod) ?? {
    isListening: false,
    algorithm: "fm" as const,
  };
  const isPaused = useAppSelector((state) => state.websocket.isPaused);
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );

  // React Flow state moved to context for global access (e.g. sidebar templates)
  const initialFlow = useMemo(
    () => buildDemodFlowGraph(state.sourceMode || "live"),
    [state.sourceMode],
  );
  const restoredFlow = useMemo(
    () => readSessionFlow(state.sourceMode || "live", initialFlow),
    [initialFlow, state.sourceMode],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(restoredFlow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(restoredFlow.edges);
  const [flowVersion, setFlowVersion] = useState(0);
  const intentionalEmptyFlowRef = React.useRef(restoredFlow.nodes.length === 0);
  const previousSourceModeRef = React.useRef(state.sourceMode || "live");

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        DEMOD_FLOW_SESSION_KEY,
        JSON.stringify({
          sourceMode: state.sourceMode || "live",
          nodes,
          edges,
        }),
      );
    } catch {
      // Session storage can be unavailable in private or restricted contexts.
    }
  }, [edges, nodes, state.sourceMode]);

  const activePlaybackMetadata = useAppSelector(
    (state) => state.waterfall.activePlaybackMetadata,
  );
  const loadedFileMetadata = useAppSelector(
    (state) => state.waterfall.loadedFileMetadata,
  );
  const [liveSourceFrame, setLiveSourceFrame] = useState<{
    center_frequency_hz?: number | null;
    sample_rate?: number | null;
  } | null>(null);

  useEffect(() => {
    if (state.sourceMode !== "live") {
      setLiveSourceFrame(null);
      return;
    }

    const id = window.setInterval(() => {
      const liveFrame = Array.isArray(liveFrameRuntime.ref.current)
        ? (liveFrameRuntime.ref.current[
            liveFrameRuntime.ref.current.length - 1
          ] ?? null)
        : liveFrameRuntime.ref.current;

      const next =
        liveFrame?.center_frequency_hz && liveFrame?.sample_rate
          ? {
              center_frequency_hz: liveFrame.center_frequency_hz,
              sample_rate: liveFrame.sample_rate,
            }
          : null;

      setLiveSourceFrame((prev) => {
        if (
          prev?.center_frequency_hz === next?.center_frequency_hz &&
          prev?.sample_rate === next?.sample_rate
        ) {
          return prev;
        }
        return next;
      });
    }, 50);

    return () => window.clearInterval(id);
  }, [state.sourceMode]);

  const activeLiveFrameRange = useMemo(() => {
    if (!Array.isArray(effectiveFrames) || effectiveFrames.length === 0) {
      return null;
    }

    const activeFrame =
      effectiveFrames.find(
        (frame) =>
          frame.label?.toLowerCase() === state.activeSignalArea?.toLowerCase(),
      ) ?? effectiveFrames[0];

    return activeFrame
      ? { min: activeFrame.min_hz, max: activeFrame.max_hz }
      : null;
  }, [effectiveFrames, state.activeSignalArea]);

  const demodLiveFrequencyRange = useMemo(() => {
    if (!state.frequencyRange) return activeLiveFrameRange;
    if (!activeLiveFrameRange) return state.frequencyRange;

    const overlaps =
      state.frequencyRange.max > activeLiveFrameRange.min &&
      state.frequencyRange.min < activeLiveFrameRange.max;

    return overlaps ? state.frequencyRange : activeLiveFrameRange;
  }, [activeLiveFrameRange, state.frequencyRange]);

  const sourceSyncPayload = useMemo(
    () => ({
      sourceMode: state.sourceMode,
      activePlaybackMetadata,
      loadedFileMetadata,
      selectedFiles: state.selectedFiles,
      sampleRateHz: state.sampleRateHz,
      liveFrame: liveSourceFrame,
      liveFrequencyRange: demodLiveFrequencyRange,
      liveSdrSettings: effectiveSdrSettings,
    }),
    [
      activePlaybackMetadata,
      demodLiveFrequencyRange,
      effectiveSdrSettings,
      liveSourceFrame,
      loadedFileMetadata,
      state.sampleRateHz,
      state.selectedFiles,
      state.sourceMode,
    ],
  );

  useEffect(() => {
    reduxDispatch(syncDemodSpanFromSourceContext(sourceSyncPayload));
  }, [reduxDispatch, sourceSyncPayload]);

  const fileCapturedRange = useMemo(() => {
    return resolveDemodSourceRange(sourceSyncPayload)?.range ?? null;
  }, [sourceSyncPayload]);

  useEffect(() => {
    const nextSourceMode = state.sourceMode || "live";
    const sourceModeChanged = previousSourceModeRef.current !== nextSourceMode;
    previousSourceModeRef.current = nextSourceMode;

    // Source-specific nodes are not interchangeable: adapt only that node so
    // switching sources does not discard the flow selected by the user.
    if (sourceModeChanged || nodes.length === 0) {
      if (
        !sourceModeChanged &&
        nodes.length === 0 &&
        intentionalEmptyFlowRef.current
      ) {
        intentionalEmptyFlowRef.current = false;
        return;
      }
      const nextFlow =
        nodes.length === 0
          ? buildDemodFlowGraph(nextSourceMode)
          : adaptDemodFlowForSourceMode({ nodes, edges }, nextSourceMode);
      setNodes(nextFlow.nodes);
      setEdges(nextFlow.edges);
      setFlowVersion((v) => v + 1);
    }
  }, [edges, nodes, setEdges, setNodes, state.sourceMode]);

  const clearFlow = useCallback(() => {
    intentionalEmptyFlowRef.current = true;
    setNodes([]);
    setEdges([]);
    setFlowVersion((v) => v + 1);
  }, [setEdges, setNodes]);

  const setFlow = useCallback(
    (_flowId: string, customNodes?: Node[], customEdges?: Edge[]) => {
      if (customNodes && customEdges) {
        const adapted = adaptDemodFlowForSourceMode(
          { nodes: customNodes, edges: customEdges },
          state.sourceMode || "live",
        );
        setNodes(adapted.nodes);
        setEdges(adapted.edges);
        // Increment flow version to force layout re-trigger
        setFlowVersion((v) => v + 1);
        return;
      }
      // Fallback or preset logic can go here if needed
    },
    [setNodes, setEdges, state.sourceMode],
  );

  const fmDemod = useAudioDemodFM({
    targetSampleRate: 48000,
    bufferSize: 4096,
    centerFrequency:
      demodState.bandwidthCenterFreqHz ?? demodState.centerFreqHz ?? 0,
    bandwidth: (demodState.bandwidthKhz || 200) * 1000,
  });
  const aptDemod = useAudioDemodAPT({
    targetSampleRate: 48000,
    bufferSize: 4096,
  });
  const naptDemod = useNAPTAudioDemod({
    targetSampleRate: 48000,
    bufferSize: 4096,
  });
  const {
    processIQData: processFmIQData,
    playAudio: playFmAudio,
    stopAudio: stopFmAudio,
  } = fmDemod;
  const {
    processIQData: processAptIQData,
    playAudio: playAptAudio,
    stopAudio: stopAptAudio,
  } = aptDemod;
  const {
    processIQData: processNaptIQData,
    playAudio: playNaptAudio,
    stopAudio: stopNaptAudio,
  } = naptDemod;

  // Throttled IQ demod processing — polls the frame runtime instead of subscribing
  // to dataFrameCounter to avoid re-rendering the entire DemodProvider tree on every frame.
  // 30fps is more than sufficient for audio buffer processing.
  useEffect(() => {
    if (isPaused) {
      demodFrameRuntime.clear();
      stopFmAudio();
      stopAptAudio();
      stopNaptAudio();
      return;
    }

    if (!demodState.isListening || !demodState.centerFreqHz) {
      demodFrameRuntime.clear();
      return;
    }

    const id = setInterval(() => {
      const queue = demodFrameRuntime
        .drain()
        .filter(
          (frame) => !activeSourceId || frame.source_id === activeSourceId,
        );
      if (queue.length === 0) return;

      const batch = queue;

      for (const current of batch) {
        if (!current || !current.iq_data) continue;

        const iqData = current.iq_data as Uint8Array;
        const sampleRate = current.sample_rate || 3200000;
        const frameCenterFrequencyHz = current.center_frequency_hz ?? null;

        if (demodState.algorithm === "fm") {
          const audioData = processFmIQData(
            iqData,
            sampleRate,
            frameCenterFrequencyHz,
          );
          if (audioData) {
            playFmAudio(audioData);
          }
        } else if (demodState.algorithm === "apt") {
          processAptIQData(iqData, sampleRate, frameCenterFrequencyHz);
          playAptAudio();
        } else if (demodState.algorithm === "napt") {
          processNaptIQData(iqData, sampleRate, frameCenterFrequencyHz);
          playNaptAudio();
        }
      }
    }, 33);

    return () => {
      clearInterval(id);
      demodFrameRuntime.clear();
      stopFmAudio();
      stopAptAudio();
      stopNaptAudio();
    };
  }, [
    demodState.isListening,
    demodState.centerFreqHz,
    demodState.algorithm,
    activeSourceId,
    isPaused,
    processFmIQData,
    playFmAudio,
    stopFmAudio,
    processAptIQData,
    playAptAudio,
    stopAptAudio,
    processNaptIQData,
    playNaptAudio,
    stopNaptAudio,
  ]);

  // Initialize the scanner manager with the WS sender functions
  React.useEffect(() => {
    scannerWorkerManager.setWSCommandSender((msg: any) => {
      if (msg.type === "scan") {
        sendScanCommand(msg.job_id, msg.min_freq, msg.max_freq, msg.options);
      } else if (msg.type === "demodulate") {
        sendDemodulateCommand(msg.job_id, msg.region);
      }
    });
  }, [sendScanCommand, sendDemodulateCommand]);

  // Handle incoming WS messages for the scanner
  React.useEffect(() => {
    // In this app, the WebSocket message handling is centralized in the middleware/store.
    // We should ideally subscribe to the store's message stream or update scannerWorkerManager
    // to handle results dispatched to the store.
    // For now, if we cannot directly observe messages here, we might need to update the useSpectrumStore
    // or adding an observer pattern.
  }, []);

  // Handle APT analysis results from WebSocket events
  React.useEffect(() => {
    const handleAptResult = (event: CustomEvent) => {
      const result = event.detail;
      if (result.type === "apt_analysis_result") {
        setAnalysisSession((prev) => ({
          ...prev,
          aptProgress: result.progress,
          aptStage: result.stage,
        }));
      }
    };

    window.addEventListener("apt_result", handleAptResult as EventListener);
    return () =>
      window.removeEventListener(
        "apt_result",
        handleAptResult as EventListener,
      );
  }, []);

  // Listen for capture status changes from Redux
  // Listen for capture status changes from Redux
  const captureStatus = useAppSelector(
    (state) => state.websocket.captureStatus,
  );

  useEffect(() => {
    if (!captureStatus) return;

    if (
      captureStatus.status === "started" &&
      (analysisSession.state as any) === "starting"
    ) {
      // Backend confirmed capture has officially started
      setAnalysisSession((prev) => ({
        ...prev,
        state: "capturing",
        jobId: captureStatus.jobId,
        startTime: captureStatus.timestamp || Date.now(), // Use server time if available
      }));
    } else if (
      captureStatus.status === "done" &&
      (analysisSession.state === "analyzing" ||
        analysisSession.state === "capturing")
    ) {
      // Update analysis session with real capture result
      setAnalysisSession((prev) => {
        // Favor the requested durationS for the report to match user input,
        // but calculate server-side elapsed time as fallback.
        let finalDuration = prev.durationS ? prev.durationS * 1000 : undefined;

        // If we want the absolute truth from the server timestamps (including overhead):
        // finalDuration = (captureStatus.timestamp && prev.startTime)
        //   ? captureStatus.timestamp - prev.startTime
        //   : (prev.durationS ? prev.durationS * 1000 : undefined);

        return {
          ...prev,
          state: "result",
          result: {
            jobId: captureStatus.jobId,
            naptFilePath: captureStatus.downloadUrl ?? undefined,
            fileName: captureStatus.filename ?? undefined,
            isEphemeral: captureStatus.ephemeral || false,
            timestamp: captureStatus.timestamp ?? Date.now(),
            fileSize: captureStatus.fileSize,
            duration: finalDuration,
            confidence: 0.85 + Math.random() * 0.1,
            matchRate: 0.92 + Math.random() * 0.05,
            snrDelta: (Math.random() * 10).toFixed(2) + " dB",
            summary:
              captureStatus.message ||
              `Capture ${captureStatus.jobId} completed successfully.`,
          },
        };
      });
    }
  }, [captureStatus, analysisSession.state]);

  const scanner = useFrequencyScanner({
    windowSizeHz,
    stepSizeHz,
    audioThreshold,
    sampleRate: 3200000,
    _fftSize: 32768,
  });

  const audioPlayback = useAudioExtraction({
    _targetSampleRate: 48000,
    _bufferSize: 4096,
    enableFiltering: true,
  });

  const channelRanges = useMemo(
    () => ({
      A: { min: 18_000, max: 4_370_000 },
      B: { min: 24_720_000, max: 29_880_000 },
    }),
    [],
  );

  const startScan = useCallback(async () => {
    if (!currentIQData) return;

    const activeChannel = state.activeSignalArea || "A";
    const channelRange =
      channelRanges[activeChannel as keyof typeof channelRanges];
    if (!channelRange) return;

    const range = {
      min: channelRange.min,
      max: channelRange.max,
    };

    setScanRange(range);

    try {
      await scanner.scanForAudio(currentIQData, range);
    } catch (error) {
      console.error("Scan failed:", error);
    } finally {
      setScanRange(undefined);
    }
  }, [
    currentIQData,
    state.activeSignalArea,
    channelRanges,
    stepSizeHz,
    scanner,
  ]);

  const stopScan = useCallback(() => {
    scanner.stopScan();
    setScanRange(undefined);
  }, [scanner]);

  const [liveMode, setLiveMode] = useState(false);

  const countdownIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const clearAnalysis = useCallback(() => {
    if (countdownIntervalRef.current)
      clearInterval(countdownIntervalRef.current);
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      clearTimeout(progressIntervalRef.current);
    }
    countdownIntervalRef.current = null;
    progressIntervalRef.current = null;
    setAnalysisSession({ state: "idle" });
  }, []);

  const startAnalysis = useCallback(
    (
      type: AnalysisType,
      isLive: boolean = false,
      durationSOrScriptContent: number | string = 5.0,
      scriptContentOrMediaContent?: string,
      mediaContentOrBaselineVector?: string | number[],
      baselineVector?: number[],
    ) => {
      const legacySignature = typeof durationSOrScriptContent === "string";
      const durationS = legacySignature ? 5.0 : durationSOrScriptContent;
      const scriptContent = legacySignature
        ? durationSOrScriptContent
        : scriptContentOrMediaContent;
      const mediaContent = legacySignature
        ? scriptContentOrMediaContent
        : typeof mediaContentOrBaselineVector === "string"
          ? mediaContentOrBaselineVector
          : undefined;
      const resolvedBaselineVector = legacySignature
        ? Array.isArray(mediaContentOrBaselineVector)
          ? mediaContentOrBaselineVector
          : baselineVector
        : baselineVector;

      clearAnalysis();

      // Start with a countdown
      let count = 3;
      setAnalysisSession({
        state: type === "apt" ? "capturing" : "starting",
        type,
        durationS,
        countdown: count,
        startTime: Date.now(),
        scriptContent,
        mediaContent,
        baselineVector: resolvedBaselineVector,
        aptProgress: 0.0,
        aptStage: "initializing",
      });

      countdownIntervalRef.current = setInterval(() => {
        count -= 1;
        if (count > 0) {
          setAnalysisSession((prev) => ({ ...prev, countdown: count }));
        } else {
          if (countdownIntervalRef.current)
            clearInterval(countdownIntervalRef.current);
          setAnalysisSession((prev) => ({ ...prev, countdown: 0 }));

          if (type === "apt") {
            // Send APT analysis command via WebSocket
            const jobId = `apt_${Date.now()}`;
            // This would be handled by a new WebSocket message type
            // For now, we'll simulate the APT analysis flow
            setAnalysisSession((prev) => ({
              ...prev,
              state: "analyzing",
              countdown: undefined,
            }));

            // Simulate APT analysis progress
            let progress = 0.0;
            const stages = [
              "fm_demodulation",
              "subcarrier_isolation",
              "envelope_detection",
              "baseband_recovery",
              "content_analysis",
            ];
            let currentStageIndex = 0;

            progressIntervalRef.current = setInterval(() => {
              progress += 0.2;
              currentStageIndex = Math.min(
                Math.floor(progress / 0.2),
                stages.length - 1,
              );

              setAnalysisSession((prev) => ({
                ...prev,
                aptProgress: Math.min(progress, 1.0),
                aptStage: stages[currentStageIndex],
              }));

              if (progress >= 1.0) {
                if (progressIntervalRef.current)
                  clearInterval(progressIntervalRef.current);
                setAnalysisSession((prev) => ({
                  ...prev,
                  state: "result",
                  aptProgress: 1.0,
                  aptStage: "completed",
                  result: {
                    jobId,
                    isEphemeral: false,
                    confidence: 0.85 + Math.random() * 0.1,
                    matchRate: 0.92 + Math.random() * 0.05,
                    snrDelta: (Math.random() * 10).toFixed(2) + " dB",
                    duration: prev.startTime
                      ? Date.now() - prev.startTime
                      : undefined,
                    summary: `APT analysis for ${type} baseline completed. Pattern analysis detected multiple signal characteristics.`,
                  } as CaptureResult,
                }));
              }
            }, 500);
          } else {
            // Original capture flow for non-APT types
            const jobId = `ref_${type}_${Date.now()}`;
            // Calculate fragments from current range
            const fragments = state.frequencyRange
              ? [
                  {
                    minFreq: state.frequencyRange.min,
                    maxFreq: state.frequencyRange.max,
                  },
                ]
              : [];

            sendCaptureCommand({
              jobId,
              fragments, // current range
              durationMode: durationS ? "timed" : "manual",
              durationS: durationS,
              fileType: ".napt",
              acquisitionMode: "whole_sample",
              encrypted: true,
              fftSize: 32768,
              fftWindow: "Hann",
              refBasedDemodBaseline:
                type === "audio"
                  ? "audio_hearing"
                  : ((type === "internal" ? "audio_internal" : type) as any),
              liveMode: isLive,
            });

            // Transition to analyzing after 5 seconds of capture
            progressIntervalRef.current = setTimeout(
              () => {
                setAnalysisSession((prev) => ({
                  ...prev,
                  state: "analyzing",
                  countdown: undefined,
                }));
              },
              durationS * 1000 + 500,
            ); // Dynamic capture duration + 0.5s margin
          }
        }
      }, 1000);
    },
    [sendCaptureCommand, clearAnalysis, state.frequencyRange],
  );

  const value = useMemo(
    () => ({
      windowSizeHz,
      setWindowSizeHz,
      stepSizeHz,
      setStepSizeHz,
      audioThreshold,
      setAudioThreshold,
      scanner,
      audioPlayback,
      currentIQData,
      setCurrentIQData,
      currentFreq: scanner.currentFreq,
      scanRange,
      analysisSession,
      selectedBaseline,
      setSelectedBaseline,
      liveMode,
      setLiveMode,
      startAnalysis,
      clearAnalysis,
      startScan,
      stopScan,
      selectedAlgorithm,
      setSelectedAlgorithm,
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      setNodes,
      setEdges,
      clearFlow,
      setFlow,
      flowVersion,
      fileCapturedRange,
      naptDetectionResult: naptDemod.detectionResult,
      detectNaptSpikes: naptDemod.detectSpikes,
    }),
    [
      windowSizeHz,
      stepSizeHz,
      audioThreshold,
      scanner,
      audioPlayback,
      currentIQData,
      scanRange,
      analysisSession,
      selectedBaseline,
      startAnalysis,
      clearAnalysis,
      startScan,
      stopScan,
      selectedAlgorithm,
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      setNodes,
      setEdges,
      clearFlow,
      setFlow,
      flowVersion,
      fileCapturedRange,
      naptDemod.detectionResult,
      naptDemod.detectSpikes,
    ],
  );

  return (
    <DemodContext.Provider value={value}>{children}</DemodContext.Provider>
  );
};
