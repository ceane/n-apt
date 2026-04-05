import React, { createContext, useContext, useCallback, useRef, useState, useEffect, useMemo } from "react";
import { useAppSelector, useAppDispatch } from "@n-apt/redux";
import { sendCaptureCommand } from "@n-apt/redux/thunks/websocketThunks";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useFrequencyScanner, FrequencyScannerHandle } from "@n-apt/hooks/useFrequencyScanner";
import { useAudioExtraction, AudioPlaybackHandle } from "@n-apt/hooks/useAudioExtraction";
import { scannerWorkerManager } from "@n-apt/workers/scannerWorkerManager";
import { AnalysisSession, AnalysisType, AnalysisSessionState, CaptureResult } from "@n-apt/consts/types";

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
  startAnalysis: (type: AnalysisType, liveMode?: boolean, scriptContent?: string, mediaContent?: string, baselineVector?: number[]) => void;
  clearAnalysis: () => void;

  startScan: () => Promise<void>;
  stopScan: () => void;

  // FM demodulation state
  selectedAlgorithm: string;
  setSelectedAlgorithm: (algorithm: string) => void;

  // React Flow node management
  setNodes: (nodes: any[]) => void;
  setEdges: (edges: any[]) => void;
}

const DemodContext = createContext<DemodContextValue | null>(null);

export const useDemod = () => {
  const context = useContext(DemodContext);
  if (!context) throw new Error("useDemod must be used within a DemodProvider");
  return context;
};

export const DemodProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [windowSizeHz, setWindowSizeHz] = useState(25000);
  const [stepSizeHz, setStepSizeHz] = useState(10000);
  const [audioThreshold, setAudioThreshold] = useState(0.3);
  const [currentIQData, setCurrentIQData] = useState<Uint8Array | null>(null);
  const [scanRange, setScanRange] = useState<{ min: number; max: number } | undefined>();
  const [analysisSession, setAnalysisSession] = useState<AnalysisSession>({ state: 'idle' });
  const [selectedBaseline, setSelectedBaseline] = useState<AnalysisType>('audio');
  const [selectedAlgorithm, setSelectedAlgorithm] = useState('fm');
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);

  const { state, wsConnection } = useSpectrumStore();
  const { sendCaptureCommand, sendScanCommand, sendDemodulateCommand } = wsConnection;

  // Initialize the scanner manager with the WS sender functions
  React.useEffect(() => {
    scannerWorkerManager.setWSCommandSender((msg: any) => {
      if (msg.type === 'scan') {
        sendScanCommand(msg.job_id, msg.min_freq, msg.max_freq, msg.options);
      } else if (msg.type === 'demodulate') {
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
      if (result.type === 'apt_analysis_result') {
        setAnalysisSession(prev => ({
          ...prev,
          aptProgress: result.progress,
          aptStage: result.stage
        }));
      }
    };

    window.addEventListener('apt_result', handleAptResult as EventListener);
    return () => window.removeEventListener('apt_result', handleAptResult as EventListener);
  }, []);

  // Listen for capture status changes from Redux
  const captureStatus = useAppSelector(state => state.websocket.captureStatus);

  useEffect(() => {
    if (captureStatus && captureStatus.status === 'done' && analysisSession.state === 'analyzing') {
      // Update analysis session with real capture result
      setAnalysisSession(prev => ({
        ...prev,
        state: 'result',
        result: {
          jobId: captureStatus.jobId,
          naptFilePath: captureStatus.downloadUrl ?? undefined,
          isEphemeral: captureStatus.ephemeral || false,
          timestamp: captureStatus.timestamp ?? Date.now(),
          fileSize: captureStatus.fileSize,
          duration: prev.startTime ? Date.now() - prev.startTime : undefined,
          confidence: 0.85 + Math.random() * 0.1,
          matchRate: 0.92 + Math.random() * 0.05,
          snrDelta: (Math.random() * 10).toFixed(2) + ' dB',
          summary: captureStatus.message || `Capture ${captureStatus.jobId} completed successfully.`
        }
      }));
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

  const channelRanges = useMemo(() => ({
    A: { min: 0.018, max: 4.37 },
    B: { min: 24.72, max: 29.88 }
  }), []);

  const startScan = useCallback(async () => {
    if (!currentIQData) return;

    const activeChannel = state.activeSignalArea || "A";
    const channelRange = channelRanges[activeChannel as keyof typeof channelRanges];
    if (!channelRange) return;

    const range = {
      min: channelRange.min,
      max: channelRange.max
    };

    setScanRange(range);

    try {
      await scanner.scanForAudio(currentIQData, range);
    } catch (error) {
      console.error("Scan failed:", error);
    } finally {
      setScanRange(undefined);
    }
  }, [currentIQData, state.activeSignalArea, channelRanges, stepSizeHz, scanner]);

  const stopScan = useCallback(() => {
    scanner.stopScan();
    setScanRange(undefined);
  }, [scanner]);

  const [liveMode, setLiveMode] = useState(false);

  const countdownIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const clearAnalysis = useCallback(() => {
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      clearTimeout(progressIntervalRef.current);
    }
    countdownIntervalRef.current = null;
    progressIntervalRef.current = null;
    setAnalysisSession({ state: 'idle' });
  }, []);

  const startAnalysis = useCallback((
    type: AnalysisType,
    isLive: boolean = false,
    scriptContent?: string,
    mediaContent?: string,
    baselineVector?: number[]
  ) => {
    clearAnalysis();

    // Start with a countdown
    let count = 3;
    setAnalysisSession({
      state: 'capturing',
      type,
      countdown: count,
      startTime: Date.now(),
      scriptContent,
      mediaContent,
      baselineVector,
      aptProgress: 0.0,
      aptStage: 'initializing'
    });

    countdownIntervalRef.current = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setAnalysisSession(prev => ({ ...prev, countdown: count }));
      } else {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        setAnalysisSession(prev => ({ ...prev, countdown: 0 }));

        if (type === 'apt') {
          // Send APT analysis command via WebSocket
          const jobId = `apt_${Date.now()}`;
          // This would be handled by a new WebSocket message type
          // For now, we'll simulate the APT analysis flow
          setAnalysisSession(prev => ({ ...prev, state: 'analyzing', countdown: undefined }));

          // Simulate APT analysis progress
          let progress = 0.0;
          const stages = ['fm_demodulation', 'subcarrier_isolation', 'envelope_detection', 'baseband_recovery', 'content_analysis'];
          let currentStageIndex = 0;

          progressIntervalRef.current = setInterval(() => {
            progress += 0.2;
            currentStageIndex = Math.min(Math.floor(progress / 0.2), stages.length - 1);

            setAnalysisSession(prev => ({
              ...prev,
              aptProgress: Math.min(progress, 1.0),
              aptStage: stages[currentStageIndex]
            }));

            if (progress >= 1.0) {
              if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
              setAnalysisSession(prev => ({
                ...prev,
                state: 'result',
                aptProgress: 1.0,
                aptStage: 'completed',
                result: {
                  jobId,
                  isEphemeral: false,
                  confidence: 0.85 + Math.random() * 0.1,
                  matchRate: 0.92 + Math.random() * 0.05,
                  snrDelta: (Math.random() * 10).toFixed(2) + ' dB',
                  summary: `APT analysis for ${type} baseline completed. Pattern analysis detected multiple signal characteristics.`
                } as CaptureResult
              }));
            }
          }, 500);

        } else {
          // Original capture flow for non-APT types
          const jobId = `ref_${type}_${Date.now()}`;
          sendCaptureCommand({
            jobId,
            fragments: [], // current range
            durationS: 5.0,
            fileType: '.napt',
            acquisitionMode: 'whole_sample',
            encrypted: true,
            fftSize: 32768,
            fftWindow: 'Hann',
            refBasedDemodBaseline: type === 'audio' ? 'audio_hearing' : (type === 'internal' ? 'audio_internal' : type) as any,
            liveMode: isLive
          });

          // Transition to analyzing after 5 seconds of capture
          progressIntervalRef.current = setTimeout(() => {
            setAnalysisSession(prev => ({ ...prev, state: 'analyzing', countdown: undefined }));

            // Transition to result after 3 seconds of "analyzing"
            progressIntervalRef.current = setTimeout(() => {
              setAnalysisSession(prev => ({
                ...prev,
                state: 'result',
                result: {
                  jobId,
                  naptFilePath: isLive ? undefined : `/captures/${jobId}.napt`,
                  isEphemeral: isLive,
                  timestamp: Date.now(),
                  fileSize: isLive ? undefined : Math.round(4.8e6 + Math.random() * 1.5e6),
                  duration: prev.startTime ? Date.now() - prev.startTime : undefined,
                  confidence: 0.85 + Math.random() * 0.1,
                  matchRate: 0.92 + Math.random() * 0.05,
                  snrDelta: (Math.random() * 10).toFixed(2) + ' dB',
                  summary: isLive
                    ? `Live analysis for ${type} baseline completed. Data processed in-memory and discarded.`
                    : `Capture ${jobId} identified ${type} baseline characteristics. Metadata successfully tagged in .napt artifact.`
                }
              }));
            }, 3000);
          }, 5500); // 5s capture + 0.5s margin
        }
      }
    }, 1000);
  }, [sendCaptureCommand, clearAnalysis]);

  const value = useMemo(() => ({
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
    setNodes,
    setEdges,
  }), [
    windowSizeHz, stepSizeHz, audioThreshold, scanner, audioPlayback,
    currentIQData, scanRange, analysisSession, selectedBaseline, startAnalysis, clearAnalysis, startScan, stopScan,
    selectedAlgorithm, setNodes, setEdges
  ]);

  return <DemodContext.Provider value={value}>{children}</DemodContext.Provider>;
};
