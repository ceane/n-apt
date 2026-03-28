import { useCallback, useRef, useState, useEffect } from "react";
import { scannerWorkerManager } from "@n-apt/workers/scannerWorkerManager";

export interface FrequencyRegion {
  startFreq: number;
  endFreq: number;
  centerFreq: number;
  audioScore: number;
  signalStrength: number;
  snr: number;
}

export interface AudioDetectionResult {
  region: FrequencyRegion;
  audioBuffer: Float32Array;
  sampleRate: number;
}

export interface FrequencyScannerOptions {
  windowSizeHz: number; // Size of each frequency window to scan
  stepSizeHz: number;   // Step between windows
  audioThreshold: number; // Minimum score to consider as audio
  sampleRate: number;   // I/Q sample rate (3.2MHz)
  _fftSize: number;      // FFT size for processing (unused for now)
}

export interface FrequencyScannerHandle {
  scanForAudio: (iqSamples: Uint8Array, frequencyRange: { min: number; max: number }) => Promise<FrequencyRegion[]>;
  demodulateRegion: (iqSamples: Uint8Array, region: FrequencyRegion) => Promise<AudioDetectionResult | null>;
  isScanning: boolean;
  scanProgress: number;
  currentFreq: number | undefined;
  detectedRegions: FrequencyRegion[];
  stopScan: () => void;
}

/**
 * Frequency scanner that identifies audio-bearing regions in N-APT signals
 * by scanning frequency windows and testing for audio content using FM demodulation
 * Performs heavy work in a Web Worker to keep the UI responsive
 */
export function useFrequencyScanner(options: FrequencyScannerOptions): FrequencyScannerHandle {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [currentFreq, setCurrentFreq] = useState<number | undefined>();
  const [detectedRegions, setDetectedRegions] = useState<FrequencyRegion[]>([]);
  
  // Ref to track scanning state for abort logic
  const isScanningRef = useRef(false);

  // Auto-terminate worker on unmount if needed
  useEffect(() => {
    return () => {
      // We don't necessarily want to terminate the singleton worker, 
      // but we should stop any active scan
      isScanningRef.current = false;
    };
  }, []);

  const stopScan = useCallback(() => {
    isScanningRef.current = false;
    setIsScanning(false);
    setCurrentFreq(undefined);
    // Note: The worker loop itself checks for messages, 
    // but our manager doesn't currently support 'abort' within a single request.
    // For now, we'll terminate the worker to force stop and re-initialize it.
    scannerWorkerManager.terminate();
  }, []);

  // Scan frequency range for audio content
  const scanForAudio = useCallback(async (
    iqSamples: Uint8Array, 
    frequencyRange: { min: number; max: number }
  ): Promise<FrequencyRegion[]> => {
    if (isScanning) return [];

    setIsScanning(true);
    isScanningRef.current = true;
    setScanProgress(0);
    setCurrentFreq(undefined);
    setDetectedRegions([]);

    try {
      const regions = await scannerWorkerManager.scan(
        iqSamples, 
        frequencyRange, 
        options,
        (p: { progress: number; currentFreq: number; regionsLength: number }) => {
          if (!isScanningRef.current) return;
          setScanProgress(p.progress * 100);
          setCurrentFreq(p.currentFreq);
        }
      );

      if (isScanningRef.current) {
        setDetectedRegions(regions);
        return regions;
      }
      return [];
    } catch (error) {
      console.error("Scan error:", error);
      return [];
    } finally {
      setIsScanning(false);
      isScanningRef.current = false;
    }
  }, [isScanning, options]);

  // Demodulate a specific region for audio playback
  const demodulateRegion = useCallback(async (
    iqSamples: Uint8Array, 
    region: FrequencyRegion
  ): Promise<AudioDetectionResult | null> => {
    try {
      return await scannerWorkerManager.demodulate(iqSamples, region, options.sampleRate);
    } catch (error) {
      console.error('Error demodulating region:', error);
      return null;
    }
  }, [options.sampleRate]);

  return {
    scanForAudio,
    demodulateRegion,
    isScanning,
    scanProgress,
    currentFreq,
    detectedRegions,
    stopScan
  };
}
