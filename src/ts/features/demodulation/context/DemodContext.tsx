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
import { useSpectrumStore } from "@n-apt/spectrum/public/useSpectrumStore";
import {
  useFrequencyScanner,
  FrequencyScannerHandle,
} from "@n-apt/spectrum/public/useFrequencyScanner";
import {
  useAudioExtraction,
  AudioPlaybackHandle,
} from "@n-apt/demodulation/hooks/useAudioExtraction";
import { useAudioDemodFM } from "@n-apt/demodulation/hooks/useAudioDemodFM";
import { useAPTImageDemod } from "@n-apt/demodulation/hooks/useAPTImageDemod";
import { useAPTAudioDemod } from "@n-apt/demodulation/hooks/useAPTAudioDemod";
import type { DemodAlgorithm } from "@n-apt/demodulation/utils/demodProcessors";
import {
  AUDIO_SURVEY_STORAGE_CAP_BYTES,
  AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES,
  DEFAULT_AUDIO_SURVEY_CONFIG,
  type CandidateRecord,
  type AudioSurveySourceMode,
  type SurveyChannelRange,
  type SurveyJobState,
} from "@n-apt/demodulation/survey/audioSurveyModel";
import {
  audioSurveyRepository,
  type AudioSurveyArtifact,
  type AudioSurveyStorageUsage,
} from "@n-apt/demodulation/survey/audioSurveyStorage";
import {
  AudioSurveyRunner,
} from "@n-apt/demodulation/survey/audioSurveyRunner";
import {
  createLiveAudioSurveySource,
  createReplayAudioSurveySource,
} from "@n-apt/demodulation/survey/audioSurveyFrameSources";
import {
  captureAudioSurveyStimulusPair,
} from "@n-apt/demodulation/survey/audioSurveyStimulusCapture";
import {
  AudioSurveyTrainer,
  type AudioSurveyTrainingState,
} from "@n-apt/demodulation/survey/audioSurveyTraining";
import { predictTimeDomainAudio } from "@n-apt/demodulation/survey/audioSurveyMl";
import { setSourceMode, setStitchPaused, triggerStitch } from "@n-apt/redux/slices/waterfallSlice";
import {
  demodFrameRuntime,
  liveFrameRuntime,
  subscribeFrameRuntime,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { acquireStreamDeliveryDemand } from "@n-apt/app/infrastructure/streams/streamDeliveryDemand";
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
  resolveDemodCaptureRange,
  serializeDemodFlow,
} from "@n-apt/demodulation/react-flow/flows";
import {
  AnalysisSession,
  AnalysisType,
} from "@n-apt/consts/types";
import { NaptSpikeDetectionResult } from "@n-apt/demodulation/utils/naptSpikeDetection";
import {
  DemodFlowContext,
  type DemodFlowContextValue,
} from "@n-apt/demodulation/context/DemodFlowContext";
import {
  DemodAnalysisContext,
  type DemodAnalysisContextValue,
} from "@n-apt/demodulation/context/DemodAnalysisContext";
import {
  DemodAudioContext,
  type DemodAudioContextValue,
} from "@n-apt/demodulation/context/DemodAudioContext";

// Bump the key after changing the default graph/layout contract so an old
// persisted template cannot resurrect the pre-fix flow on first entry.
const DEMOD_FLOW_SESSION_KEY = "n-apt:demod-flow:v3";
const EMPTY_SELECTED_REPLAY_FILES: Array<{ id: string; name: string }> = [];

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
  ) => string | null;
  clearAnalysis: () => void;

  audioSurveyJob: SurveyJobState | null;
  audioSurveyCandidates: CandidateRecord[];
  audioSurveyStorageUsage: AudioSurveyStorageUsage;
  audioSurveyTraining: AudioSurveyTrainingState | null;
  audioSurveyError: string | null;
  startAudioSurvey: (
    sourceMode?: AudioSurveySourceMode,
    storageCapBytes?: number,
  ) => Promise<void>;
  resumeAudioSurvey: () => Promise<void>;
  pauseAudioSurvey: () => void;
  stopAudioSurvey: () => void;
  trainAudioSurveyModel: () => Promise<void>;
  pauseAudioSurveyTraining: () => void;
  playAudioSurveyArtifact: (artifactId: string) => Promise<void>;
  playAudioSurveyCandidate: (candidateId: string) => Promise<void>;
  recordAudioSurveyStimulusReference: (input: {
    captureId: string;
    pcmData: Float32Array;
    pcmSampleRateHz: number;
    startedAtMs: number;
  }) => Promise<AudioSurveyArtifact | null>;

  startScan: () => Promise<void>;
  stopScan: () => void;

  // FM demodulation state
  selectedAlgorithm: DemodAlgorithm;
  setSelectedAlgorithm: (algorithm: DemodAlgorithm) => void;

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
  const [selectedAlgorithm, setSelectedAlgorithm] =
    useState<DemodAlgorithm>("fm");
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
  const selectedReplayFiles = useAppSelector(
    (state) => state.waterfall?.selectedFiles ?? EMPTY_SELECTED_REPLAY_FILES,
  );
  const surveyChannels = useMemo<SurveyChannelRange[]>(() => {
    const seen = new Set<string>();
    return (Array.isArray(effectiveFrames) ? effectiveFrames : [])
      .filter((frame) => ["a", "b"].includes(frame.label?.toLowerCase()))
      .map((frame) => ({
        id: frame.label.toLowerCase(),
        label: frame.label,
        minHz: frame.min_hz,
        maxHz: frame.max_hz,
      }))
      .filter((channel) => {
        if (seen.has(channel.id)) return false;
        seen.add(channel.id);
        return true;
      });
  }, [effectiveFrames]);
  const [audioSurveyJob, setAudioSurveyJob] = useState<SurveyJobState | null>(null);
  const [audioSurveyCandidates, setAudioSurveyCandidates] = useState<CandidateRecord[]>([]);
  const [audioSurveyStorageUsage, setAudioSurveyStorageUsage] =
    useState<AudioSurveyStorageUsage>({
      usedBytes: 0,
      capBytes: AUDIO_SURVEY_STORAGE_CAP_BYTES,
      artifactCount: 0,
    });
  const [audioSurveyTraining, setAudioSurveyTraining] =
    useState<AudioSurveyTrainingState | null>(null);
  const [audioSurveyError, setAudioSurveyError] = useState<string | null>(null);
  const audioSurveyRunnerRef = React.useRef<AudioSurveyRunner | null>(null);
  const audioSurveyTrainerRef = React.useRef<AudioSurveyTrainer | null>(null);
  const audioSurveyPhaseRef = React.useRef<string | null>(null);
  const audioSurveyModelPreferenceRef = React.useRef<{
    jobId: string;
    preferred: boolean;
    score?: number;
  } | null>(null);

  useEffect(() => {
    if (
      isPaused ||
      !demodState.isListening ||
      !demodState.centerFreqHz ||
      !activeSourceId
    ) {
      return;
    }
    return acquireStreamDeliveryDemand(
      { sourceId: activeSourceId, mode: "rx" },
      "lossless",
    );
  }, [
    activeSourceId,
    demodState.centerFreqHz,
    demodState.isListening,
    isPaused,
  ]);

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
  const flowPersistenceTimerRef = React.useRef<number | null>(null);
  const intentionalEmptyFlowRef = React.useRef(restoredFlow.nodes.length === 0);
  const previousSourceModeRef = React.useRef(state.sourceMode || "live");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (flowPersistenceTimerRef.current !== null) {
      window.clearTimeout(flowPersistenceTimerRef.current);
    }
    flowPersistenceTimerRef.current = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(
          DEMOD_FLOW_SESSION_KEY,
          serializeDemodFlow(state.sourceMode || "live", nodes, edges),
        );
      } catch {
        // Session storage can be unavailable in private or restricted contexts.
      }
      flowPersistenceTimerRef.current = null;
    }, 250);

    return () => {
      if (flowPersistenceTimerRef.current !== null) {
        window.clearTimeout(flowPersistenceTimerRef.current);
        flowPersistenceTimerRef.current = null;
      }
    };
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

    return subscribeFrameRuntime(() => {
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

        const sameNodes =
          nodes.length === adapted.nodes.length &&
          nodes.every((node, index) => {
            const next = adapted.nodes[index];
            return (
              node.id === next.id &&
              node.type === next.type &&
              JSON.stringify(node.data) === JSON.stringify(next.data)
            );
          });
        const sameEdges =
          edges.length === adapted.edges.length &&
          edges.every((edge, index) => {
            const next = adapted.edges[index];
            return (
              edge.id === next.id &&
              edge.source === next.source &&
              edge.target === next.target
            );
          });

        // Selecting the active template again must not replace measured/layout
        // positions with its raw coordinates. Preserve the stable graph and
        // avoid triggering another asynchronous layout/FOUC cycle.
        if (sameNodes && sameEdges) return;

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
    algorithm:
      demodState.algorithm === "am"
        ? "am"
        : demodState.algorithm === "fmDiscriminator"
          ? "fmDiscriminator"
          : "fm",
  });
  const aptImageDemod = useAPTImageDemod({
    targetSampleRate: 48000,
    bufferSize: 4096,
  });
  const aptAudioDemod = useAPTAudioDemod({
    targetSampleRate: 48000,
    bufferSize: 4096,
  });
  const {
    processIQData: processFmIQData,
    playAudio: playFmAudio,
    stopAudio: stopFmAudio,
  } = fmDemod;
  const {
    processIQData: processAptImageIQData,
    playAudio: playAptImageAudio,
    stopAudio: stopAptImageAudio,
  } = aptImageDemod;
  const {
    processIQData: processAptAudioIQData,
    playAudio: playAptAudio,
    stopAudio: stopAptAudio,
    detectSpikes: _detectNaptSpikes,
  } = aptAudioDemod;

  const refreshAudioSurveySnapshot = useCallback(
    async (jobId?: string, capBytes = AUDIO_SURVEY_STORAGE_CAP_BYTES) => {
      try {
        const [candidates, usage] = await Promise.all([
          jobId ? audioSurveyRepository.listCandidates(jobId) : Promise.resolve([]),
          audioSurveyRepository.getStorageUsage(capBytes),
        ]);
        if (jobId) setAudioSurveyCandidates(candidates);
        setAudioSurveyStorageUsage(usage);
      } catch (error) {
        setAudioSurveyError(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [],
  );

  const handleAudioSurveyJobUpdated = useCallback(
    (job: SurveyJobState) => {
      setAudioSurveyJob(job);
      void refreshAudioSurveySnapshot(job.id, job.config.storageCapBytes);
      if (job.status !== "running") return;
      if (audioSurveyPhaseRef.current === job.checkpoint.sourcePhase) return;
      audioSurveyPhaseRef.current = job.checkpoint.sourcePhase;
      if (job.checkpoint.sourcePhase === "replay") {
        if (selectedReplayFiles.length > 0) {
          reduxDispatch(setSourceMode("file"));
          reduxDispatch(setStitchPaused(false));
          reduxDispatch(triggerStitch());
        }
      } else {
        reduxDispatch(setSourceMode("live"));
      }
    },
    [
      refreshAudioSurveySnapshot,
      reduxDispatch,
      selectedReplayFiles.length,
    ],
  );

  const createAudioSurveyRunner = useCallback(() => {
    if (surveyChannels.length === 0) {
      throw new Error("Configured Channel A and Channel B ranges are not available yet");
    }
    return new AudioSurveyRunner({
      channels: surveyChannels,
      sources: {
        live: createLiveAudioSurveySource({
          getSourceId: () => activeSourceId,
          sendFrequencyRange: (range) => wsConnection.sendFrequencyRange(range),
        }),
        replay:
          selectedReplayFiles.length > 0
            ? createReplayAudioSurveySource()
            : null,
      },
      onJobUpdated: handleAudioSurveyJobUpdated,
      onCandidateUpdated: (candidate) => {
        const preference = audioSurveyModelPreferenceRef.current;
        const nextCandidate =
          preference?.jobId === candidate.jobId
            ? {
                ...candidate,
                demodulationModelPreferred: preference.preferred,
                ...(preference.score === undefined
                  ? {}
                  : { demodulationModelScore: preference.score }),
              }
            : candidate;
        if (nextCandidate !== candidate) {
          void audioSurveyRepository.saveCandidate(nextCandidate);
        }
        setAudioSurveyCandidates((current) => {
          const index = current.findIndex((item) => item.id === nextCandidate.id);
          const next = current.slice();
          if (index >= 0) next[index] = nextCandidate;
          else next.push(nextCandidate);
          return next.sort((left, right) => right.score - left.score);
        });
      },
    });
  }, [
    activeSourceId,
    handleAudioSurveyJobUpdated,
    selectedReplayFiles.length,
    surveyChannels,
    wsConnection,
  ]);

  const startAudioSurvey = useCallback(
    async (
      sourceMode: AudioSurveySourceMode = "combined",
      storageCapBytes = DEFAULT_AUDIO_SURVEY_CONFIG.storageCapBytes,
    ) => {
      try {
        setAudioSurveyError(null);
        const runner = createAudioSurveyRunner();
        audioSurveyRunnerRef.current = runner;
        audioSurveyPhaseRef.current = null;
        const job = await runner.createJob({
          ...DEFAULT_AUDIO_SURVEY_CONFIG,
          sourceMode,
          storageCapBytes: Math.max(
            32_000_000,
            Math.min(AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES, storageCapBytes),
          ),
        });
        setAudioSurveyJob(job);
        void runner.start(job.id).catch((error) => {
          setAudioSurveyError(error instanceof Error ? error.message : String(error));
        });
      } catch (error) {
        setAudioSurveyError(error instanceof Error ? error.message : String(error));
      }
    },
    [createAudioSurveyRunner],
  );

  const resumeAudioSurvey = useCallback(async () => {
    try {
      setAudioSurveyError(null);
      let job = audioSurveyJob;
      if (!job) {
        job = (await audioSurveyRepository.listJobs()).find(
          (candidate) => candidate.status === "paused" || candidate.status === "ready",
        ) ?? null;
      }
      if (!job) throw new Error("There is no paused audio survey job to resume");
      const runner = createAudioSurveyRunner();
      audioSurveyRunnerRef.current = runner;
      audioSurveyPhaseRef.current = null;
      void runner.resume(job.id).then(setAudioSurveyJob).catch((error) => {
        setAudioSurveyError(error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      setAudioSurveyError(error instanceof Error ? error.message : String(error));
    }
  }, [audioSurveyJob, createAudioSurveyRunner]);

  const pauseAudioSurvey = useCallback(() => {
    audioSurveyRunnerRef.current?.pause();
  }, []);

  const stopAudioSurvey = useCallback(() => {
    const jobId = audioSurveyJob?.id;
    const stop = async () => {
      try {
        const runner = audioSurveyRunnerRef.current;
        const job = runner
          ? await runner.stop(jobId)
          : jobId
            ? await audioSurveyRepository.getJob(jobId)
            : undefined;
        if (job) {
          const stopped = { ...job, status: "stopped" as const, updatedAt: Date.now() };
          await audioSurveyRepository.saveJob(stopped);
          setAudioSurveyJob(stopped);
        }
      } catch (error) {
        setAudioSurveyError(error instanceof Error ? error.message : String(error));
      }
    };
    void stop();
  }, [audioSurveyJob]);

  const trainAudioSurveyModel = useCallback(async () => {
    const job = audioSurveyJob;
    if (!job) {
      setAudioSurveyError("Run or resume a survey before starting local training");
      return;
    }
    setAudioSurveyError(null);
    const trainer = new AudioSurveyTrainer({
      totalEpochs: 30,
      storageCapBytes: job.config.storageCapBytes,
      onStateUpdated: setAudioSurveyTraining,
    });
    audioSurveyTrainerRef.current = trainer;
    const state = await trainer.start(job.id);
    setAudioSurveyTraining(state);
    if (state.status === "failed" && state.error) setAudioSurveyError(state.error);
    if (state.status === "completed") {
      const candidates = await audioSurveyRepository.listCandidates(job.id);
      const relativeScore =
        state.modelRmse !== undefined && state.dspRmse !== undefined && state.dspRmse > 0
          ? Math.max(0, 1 - state.modelRmse / state.dspRmse)
          : undefined;
      audioSurveyModelPreferenceRef.current = {
        jobId: job.id,
        preferred: state.modelPreferred === true,
        ...(relativeScore === undefined ? {} : { score: relativeScore }),
      };
      for (const candidate of candidates) {
        await audioSurveyRepository.saveCandidate({
          ...candidate,
          demodulationModelPreferred: state.modelPreferred === true,
          ...(relativeScore === undefined
            ? {}
            : { demodulationModelScore: relativeScore }),
        });
      }
    }
    await refreshAudioSurveySnapshot(job.id, job.config.storageCapBytes);
  }, [audioSurveyJob, refreshAudioSurveySnapshot]);

  const pauseAudioSurveyTraining = useCallback(() => {
    audioSurveyTrainerRef.current?.pause();
  }, []);

  const playAudioSurveyArtifact = useCallback(
    async (artifactId: string) => {
      try {
        const artifact = await audioSurveyRepository.getArtifact(artifactId);
        const payload = artifact?.payload as { pcmData?: unknown } | undefined;
        if (!(payload?.pcmData instanceof Float32Array)) {
          throw new Error("This survey artifact has no playable PCM clip");
        }
        playFmAudio(payload.pcmData);
      } catch (error) {
        setAudioSurveyError(error instanceof Error ? error.message : String(error));
      }
    },
    [playFmAudio],
  );

  const playAudioSurveyCandidate = useCallback(
    async (candidateId: string) => {
      try {
        const candidate = audioSurveyCandidates.find((item) => item.id === candidateId) ??
          (audioSurveyJob
            ? (await audioSurveyRepository.listCandidates(audioSurveyJob.id)).find(
                (item) => item.id === candidateId,
              )
            : undefined);
        if (!candidate) throw new Error("Audio candidate was removed or is no longer available");
        const artifacts = (await audioSurveyRepository.listArtifacts(candidate.jobId))
          .filter(
            (artifact) =>
              artifact.candidateId === candidate.id &&
              artifact.kind === "event-clip",
          )
          .sort((left, right) => right.createdAt - left.createdAt);
        const clip = artifacts.find((artifact) => {
          const payload = artifact.payload as { iqData?: unknown; pcmData?: unknown };
          return payload.iqData instanceof Uint8Array && payload.pcmData instanceof Float32Array;
        });
        if (!clip) throw new Error("No retained candidate clip is available to play");
        const payload = clip.payload as {
          iqData: Uint8Array;
          iqSampleRateHz: number;
          pcmData: Float32Array;
          pcmSampleRateHz: number;
        };
        let output = payload.pcmData;
        if (candidate.demodulationModelPreferred) {
          const trainedArtifact = await audioSurveyRepository.getArtifact(
            `${candidate.jobId}:audio-demod-training`,
          );
          const trainedPayload = trainedArtifact?.payload as {
            artifactType?: string;
            model?: Parameters<typeof predictTimeDomainAudio>[0];
          } | undefined;
          if (
            trainedPayload?.artifactType === "audio-survey-trained-model" &&
            trainedPayload.model
          ) {
            output = predictTimeDomainAudio(trainedPayload.model, {
              iqData: payload.iqData,
              sampleRateHz: payload.iqSampleRateHz,
              pcmSampleRateHz: payload.pcmSampleRateHz,
              outputSampleCount: payload.pcmData.length,
            }).samples;
          }
        }
        playFmAudio(output);
      } catch (error) {
        setAudioSurveyError(error instanceof Error ? error.message : String(error));
      }
    },
    [audioSurveyCandidates, audioSurveyJob, playFmAudio],
  );

  const recordAudioSurveyStimulusReference = useCallback(
    async (input: {
      captureId: string;
      pcmData: Float32Array;
      pcmSampleRateHz: number;
      startedAtMs: number;
    }) => {
      const resumeRunner =
        audioSurveyJob?.status === "running"
          ? audioSurveyRunnerRef.current
          : null;
      let resumeAfterCapture = false;
      try {
        setAudioSurveyError(null);
        const activeRun = audioSurveyRunnerRef.current?.pauseAtBoundary();
        if (activeRun) {
          const pausedJob = await activeRun;
          resumeAfterCapture = pausedJob.status === "paused";
        }
        if (surveyChannels.length === 0) {
          throw new Error("Channel A and B metadata is required for a paired stimulus capture");
        }
        const centerFrequencyHz =
          demodState.bandwidthCenterFreqHz ??
          demodState.centerFreqHz ??
          ((demodLiveFrequencyRange?.min ?? 0) + (demodLiveFrequencyRange?.max ?? 0)) / 2;
        const channel = surveyChannels.find(
          (candidate) =>
            centerFrequencyHz >= candidate.minHz &&
            centerFrequencyHz <= candidate.maxHz,
        );
        if (!channel) {
          throw new Error("Select a demodulation frequency in Channel A or B before capturing a stimulus pair");
        }
        const algorithm = demodState.algorithm === "am" ? "am" : "fm";
        const bandwidthHz = Math.max(
          2_000,
          (demodState.bandwidthKhz || (algorithm === "am" ? 25 : 200)) * 1_000,
        );
        let job = audioSurveyJob;
        if (!job) {
          const runner = createAudioSurveyRunner();
          audioSurveyRunnerRef.current = runner;
          job = await runner.createJob({
            ...DEFAULT_AUDIO_SURVEY_CONFIG,
            sourceMode: "live",
          });
          setAudioSurveyJob(job);
        }
        const source = createLiveAudioSurveySource({
          getSourceId: () => activeSourceId,
          sendFrequencyRange: (range) => wsConnection.sendFrequencyRange(range),
        });
        const artifact = await captureAudioSurveyStimulusPair(
          {
            ...input,
            jobId: job.id,
            centerFrequencyHz,
            bandwidthHz,
            channelId: channel.id,
            baselineAlgorithm: algorithm,
            storageCapBytes: job.config.storageCapBytes,
          },
          { source, channels: surveyChannels, repository: audioSurveyRepository },
        );
        if (!artifact) {
          throw new Error("Could not collect enough timestamp-overlapping I/Q for this stimulus");
        }
        await refreshAudioSurveySnapshot(job.id, job.config.storageCapBytes);
        return artifact;
      } catch (error) {
        setAudioSurveyError(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        if (resumeAfterCapture && resumeRunner && audioSurveyJob) {
          void resumeRunner.resume(audioSurveyJob.id).then(setAudioSurveyJob).catch((error) => {
            setAudioSurveyError(error instanceof Error ? error.message : String(error));
          });
        }
      }
    },
    [
      activeSourceId,
      audioSurveyJob,
      createAudioSurveyRunner,
      demodLiveFrequencyRange,
      demodState.algorithm,
      demodState.bandwidthCenterFreqHz,
      demodState.bandwidthKhz,
      demodState.centerFreqHz,
      refreshAudioSurveySnapshot,
      surveyChannels,
      wsConnection,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const restoreAudioSurvey = async () => {
      try {
        const jobs = await audioSurveyRepository.listJobs();
        let usage = await audioSurveyRepository.getStorageUsage(
          AUDIO_SURVEY_STORAGE_CAP_BYTES,
        );
        if (cancelled) return;
        setAudioSurveyStorageUsage(usage);
        const latest = jobs[0];
        if (!latest) return;
        const restored = latest.status === "running"
          ? { ...latest, status: "paused" as const, updatedAt: Date.now() }
          : latest;
        if (restored !== latest) await audioSurveyRepository.saveJob(restored);
        usage = await audioSurveyRepository.getStorageUsage(
          restored.config.storageCapBytes,
        );
        if (cancelled) return;
        setAudioSurveyStorageUsage(usage);
        setAudioSurveyJob(restored);
        const [candidates, trainingArtifact] = await Promise.all([
          audioSurveyRepository.listCandidates(restored.id),
          audioSurveyRepository.getArtifact(`${restored.id}:audio-demod-training`),
        ]);
        if (cancelled) return;
        setAudioSurveyCandidates(candidates);
        const trainingPayload = trainingArtifact?.payload as
          | { state?: AudioSurveyTrainingState }
          | undefined;
        if (trainingPayload?.state) {
          setAudioSurveyTraining(trainingPayload.state);
          if (trainingPayload.state.status === "completed") {
            const trainingState = trainingPayload.state;
            audioSurveyModelPreferenceRef.current = {
              jobId: restored.id,
              preferred: trainingState.modelPreferred === true,
              ...(trainingState.modelRmse !== undefined &&
              trainingState.dspRmse !== undefined &&
              trainingState.dspRmse > 0
                ? {
                    score: Math.max(
                      0,
                      1 - trainingState.modelRmse / trainingState.dspRmse,
                    ),
                  }
                : {}),
            };
          }
        }
      } catch {
        // IndexedDB is unavailable in some browsers and test environments.
      }
    };
    void restoreAudioSurvey();
    return () => {
      cancelled = true;
      audioSurveyRunnerRef.current?.pause();
      audioSurveyTrainerRef.current?.pause();
    };
  }, []);

  // Throttled IQ demod processing — polls the frame runtime instead of subscribing
  // to dataFrameCounter to avoid re-rendering the entire DemodProvider tree on every frame.
  // 30fps is more than sufficient for audio buffer processing.
  useEffect(() => {
    if (isPaused) {
      demodFrameRuntime.clear();
      stopFmAudio();
      stopAptImageAudio();
      stopAptAudio();
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

        if (
          demodState.algorithm === "fm" ||
          demodState.algorithm === "fmDiscriminator" ||
          demodState.algorithm === "am"
        ) {
          const audioData = processFmIQData(
            iqData,
            sampleRate,
            frameCenterFrequencyHz,
          );
          if (audioData) {
            playFmAudio(audioData);
          }
        } else if (demodState.algorithm === "aptImage") {
          processAptImageIQData(iqData, sampleRate, frameCenterFrequencyHz);
          playAptImageAudio();
        } else if (demodState.algorithm === "aptAudio") {
          processAptAudioIQData(iqData, sampleRate, frameCenterFrequencyHz);
          playAptAudio();
        } else {
          const _exhaustive: never = demodState.algorithm;
          void _exhaustive;
        }
      }
    }, 33);

    return () => {
      clearInterval(id);
      demodFrameRuntime.clear();
      stopFmAudio();
      stopAptImageAudio();
      stopAptAudio();
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
    processAptImageIQData,
    playAptImageAudio,
    stopAptImageAudio,
    playAptAudio,
    stopAptAudio,
    processAptAudioIQData,
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
            sampleRateHz: prev.sampleRateHz,
            centerFrequencyHz: prev.centerFrequencyHz,
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

  const progressTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  const clearAnalysis = useCallback(() => {
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
    }
    progressTimerRef.current = null;
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

      const referenceCaptureRange = resolveDemodCaptureRange({
        explicitRange: state.frequencyRange,
        liveRange: demodLiveFrequencyRange,
        fileRange: fileCapturedRange,
        sampleRateHz: state.sampleRateHz,
      });
      const referenceCaptureCenterFrequencyHz = Math.round(
        (referenceCaptureRange.min + referenceCaptureRange.max) / 2,
      );

      clearAnalysis();

      setAnalysisSession({
        state: "starting",
        type,
        durationS,
        sampleRateHz: state.sampleRateHz,
        centerFrequencyHz: referenceCaptureCenterFrequencyHz,
        startTime: Date.now(),
        scriptContent,
        mediaContent,
        baselineVector: resolvedBaselineVector,
      });

      // Capture flow: request a real encrypted reference capture from the
      // backend; completion arrives via the websocket captureStatus stream.
      const jobId = `ref_${type}_${Date.now()}`;
      const fragments = [
        {
          minFreq: referenceCaptureRange.min,
          maxFreq: referenceCaptureRange.max,
        },
      ];

      sendCaptureCommand({
        jobId,
        sourceId: activeSourceId ?? undefined,
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

      // Transition to analyzing after the requested capture duration
      progressTimerRef.current = setTimeout(
        () => {
          setAnalysisSession((prev) => ({
            ...prev,
            state: "analyzing",
          }));
        },
        durationS * 1000 + 500,
      ); // Dynamic capture duration + 0.5s margin
      return jobId;
    },
    [
      clearAnalysis,
      sendCaptureCommand,
      demodLiveFrequencyRange,
      fileCapturedRange,
      activeSourceId,
      state.frequencyRange,
      state.sampleRateHz,
    ],
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
      audioSurveyJob,
      audioSurveyCandidates,
      audioSurveyStorageUsage,
      audioSurveyTraining,
      audioSurveyError,
      startAudioSurvey,
      resumeAudioSurvey,
      pauseAudioSurvey,
      stopAudioSurvey,
      trainAudioSurveyModel,
      pauseAudioSurveyTraining,
      playAudioSurveyArtifact,
      playAudioSurveyCandidate,
      recordAudioSurveyStimulusReference,
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
      naptDetectionResult: aptAudioDemod.detectionResult,
      detectNaptSpikes: aptAudioDemod.detectSpikes,
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
      audioSurveyJob,
      audioSurveyCandidates,
      audioSurveyStorageUsage,
      audioSurveyTraining,
      audioSurveyError,
      startAudioSurvey,
      resumeAudioSurvey,
      pauseAudioSurvey,
      stopAudioSurvey,
      trainAudioSurveyModel,
      pauseAudioSurveyTraining,
      playAudioSurveyArtifact,
      playAudioSurveyCandidate,
      recordAudioSurveyStimulusReference,
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
      aptAudioDemod.detectionResult,
      aptAudioDemod.detectSpikes,
    ],
  );

  const flowValue = useMemo<DemodFlowContextValue>(
    () => ({
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      setNodes,
      setEdges,
      clearFlow,
      setFlow,
      flowVersion,
    }),
    [
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      setNodes,
      setEdges,
      clearFlow,
      setFlow,
      flowVersion,
    ],
  );

  const analysisValue = useMemo<DemodAnalysisContextValue>(
    () => ({ analysisSession }),
    [analysisSession],
  );

  const audioValue = useMemo<DemodAudioContextValue>(
    () => ({ audioPlayback }),
    [audioPlayback],
  );

  return (
    <DemodContext.Provider value={value}>
      <DemodAnalysisContext.Provider value={analysisValue}>
        <DemodAudioContext.Provider value={audioValue}>
          <DemodFlowContext.Provider value={flowValue}>
            {children}
          </DemodFlowContext.Provider>
        </DemodAudioContext.Provider>
      </DemodAnalysisContext.Provider>
    </DemodContext.Provider>
  );
};
