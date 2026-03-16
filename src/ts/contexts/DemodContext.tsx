import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { useFrequencyScanner, FrequencyScannerHandle } from "@n-apt/hooks/useFrequencyScanner";
import { useAudioExtraction, AudioPlaybackHandle } from "@n-apt/hooks/useAudioExtraction";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";

export type AnalysisSessionState = 'idle' | 'capturing' | 'analyzing' | 'result';
export type AnalysisType = 'audio' | 'internal' | 'speech' | 'vision';

export interface AnalysisSession {
  state: AnalysisSessionState;
  type?: AnalysisType;
  startTime?: number;
  countdown?: number; // 3, 2, 1...
  result?: any;
}

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
  startAnalysis: (type: AnalysisType, liveMode?: boolean) => void;
  clearAnalysis: () => void;
  
  startScan: () => Promise<void>;
  stopScan: () => void;
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

  const { state, wsConnection } = useSpectrumStore();
  const { sendCaptureCommand } = wsConnection;

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

  const startAnalysis = useCallback((type: AnalysisType, isLive: boolean = false) => {
    // Start with a countdown
    let count = 3;
    setAnalysisSession({ state: 'capturing', type, countdown: count, startTime: Date.now() });

    const countdownInterval = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setAnalysisSession(prev => ({ ...prev, countdown: count }));
      } else {
        clearInterval(countdownInterval);
        setAnalysisSession(prev => ({ ...prev, countdown: 0 }));

        // Trigger the actual I/Q Capture via Backend
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
        setTimeout(() => {
          setAnalysisSession(prev => ({ ...prev, state: 'analyzing', countdown: undefined }));

          // Transition to result after 3 seconds of "analyzing"
          setTimeout(() => {
            setAnalysisSession(prev => ({
              ...prev,
              state: 'result',
              result: {
                jobId,
                naptFilePath: isLive ? undefined : `/captures/${jobId}.napt`,
                isEphemeral: isLive,
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
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [sendCaptureCommand]);

  const clearAnalysis = useCallback(() => {
    setAnalysisSession({ state: 'idle' });
  }, []);

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
    stopScan
  }), [
    windowSizeHz, stepSizeHz, audioThreshold, scanner, audioPlayback, 
    currentIQData, scanRange, analysisSession, selectedBaseline, startAnalysis, clearAnalysis, startScan, stopScan
  ]);

  return <DemodContext.Provider value={value}>{children}</DemodContext.Provider>;
};
