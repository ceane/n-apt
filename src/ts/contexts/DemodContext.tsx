import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { useFrequencyScanner, FrequencyScannerHandle } from "@n-apt/hooks/useFrequencyScanner";
import { useAudioExtraction, AudioPlaybackHandle } from "@n-apt/hooks/useAudioExtraction";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";

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

  const { state } = useSpectrumStore();

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
    startScan,
    stopScan
  }), [
    windowSizeHz, stepSizeHz, audioThreshold, scanner, audioPlayback, 
    currentIQData, scanRange, startScan, stopScan
  ]);

  return <DemodContext.Provider value={value}>{children}</DemodContext.Provider>;
};
