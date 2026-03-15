import { useCallback, useRef, useState } from "react";

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
  detectedRegions: FrequencyRegion[];
}

/**
 * Frequency scanner that identifies audio-bearing regions in N-APT signals
 * by scanning frequency windows and testing for audio content using FM demodulation
 */
export function useFrequencyScanner(options: FrequencyScannerOptions): FrequencyScannerHandle {
  const { windowSizeHz, stepSizeHz, audioThreshold, sampleRate } = options;
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [detectedRegions, setDetectedRegions] = useState<FrequencyRegion[]>([]);
  
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize audio context
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  // Extract I/Q samples for a specific frequency window
  const extractFrequencyWindow = useCallback((
    iqSamples: Uint8Array, 
    centerFreq: number, 
    bandwidth: number
  ): Float32Array => {
    const samplesPerByte = 2; // I and Q
    const totalSamples = iqSamples.length / samplesPerByte;
    const freqToSampleRatio = totalSamples / sampleRate;
    
    const windowSamples = Math.floor(bandwidth * freqToSampleRatio);
    const centerSample = Math.floor(centerFreq * freqToSampleRatio);
    const startSample = Math.max(0, centerSample - windowSamples / 2);
    const endSample = Math.min(totalSamples, centerSample + windowSamples / 2);
    
    const windowData = new Float32Array(endSample - startSample);
    
    for (let i = startSample; i < endSample; i++) {
      const byteIndex = i * 2;
      if (byteIndex + 1 < iqSamples.length) {
        // Convert uint8 to float (-1 to 1 range)
        const i = (iqSamples[byteIndex] - 128) / 128;
        const q = (iqSamples[byteIndex + 1] - 128) / 128;
        
        // Complex magnitude for power
        windowData[i - startSample] = Math.sqrt(i * i + q * q);
      }
    }
    
    return windowData;
  }, [sampleRate]);

  // FM demodulation using phase difference method
  const fmDemodulate = useCallback((iqWindow: Uint8Array): Float32Array => {
    const samples = iqWindow.length / 2;
    const demodulated = new Float32Array(samples - 1);
    
    for (let n = 1; n < samples; n++) {
      const i1 = (iqWindow[n * 2] - 128) / 128;
      const q1 = (iqWindow[n * 2 + 1] - 128) / 128;
      const i0 = (iqWindow[(n - 1) * 2] - 128) / 128;
      const q0 = (iqWindow[(n - 1) * 2 + 1] - 128) / 128;
      
      // Phase difference method
      const phaseDiff = Math.atan2(i1 * q0 - i0 * q1, i1 * i0 + q1 * q0);
      demodulated[n - 1] = phaseDiff * sampleRate / (2 * Math.PI);
    }
    
    return demodulated;
  }, [sampleRate]);

  // Analyze demodulated signal for audio characteristics
  const analyzeForAudio = useCallback((demodulated: Float32Array): number => {
    if (demodulated.length === 0) return 0;
    
    // Calculate basic statistics
    const mean = demodulated.reduce((sum, val) => sum + val, 0) / demodulated.length;
    const variance = demodulated.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / demodulated.length;
    const stdDev = Math.sqrt(variance);
    
    // Check for audio-like characteristics
    // 1. Reasonable signal level (not just noise)
    const signalLevel = stdDev;
    if (signalLevel < 0.01) return 0; // Too quiet, likely noise
    
    // 2. Check for frequency content in audio range (300Hz - 4kHz)
    // Simple zero-crossing analysis for frequency estimation
    let zeroCrossings = 0;
    for (let i = 1; i < demodulated.length; i++) {
      if ((demodulated[i] >= 0) !== (demodulated[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    
    const estimatedFreq = (zeroCrossings / 2) * (sampleRate / demodulated.length);
    
    // Score based on audio frequency range
    let freqScore = 0;
    if (estimatedFreq >= 300 && estimatedFreq <= 4000) {
      freqScore = 1.0;
    } else if (estimatedFreq >= 100 && estimatedFreq <= 8000) {
      freqScore = 0.5;
    } else {
      freqScore = 0.1;
    }
    
    // 3. Check for modulation characteristics
    // Look for variations in amplitude that suggest voice/data
    let amplitudeVariations = 0;
    const windowSize = Math.floor(demodulated.length / 100);
    for (let i = 0; i < demodulated.length - windowSize; i += windowSize) {
      const windowMean = demodulated.slice(i, i + windowSize).reduce((sum, val) => sum + Math.abs(val), 0) / windowSize;
      amplitudeVariations += Math.abs(windowMean - signalLevel);
    }
    
    const modulationScore = Math.min(1.0, amplitudeVariations / (signalLevel * 10));
    
    // Combine scores
    const audioScore = (signalLevel * 0.3) + (freqScore * 0.4) + (modulationScore * 0.3);
    
    return audioScore;
  }, [sampleRate]);

  // Scan frequency range for audio content
  const scanForAudio = useCallback(async (
    iqSamples: Uint8Array, 
    frequencyRange: { min: number; max: number }
  ): Promise<FrequencyRegion[]> => {
    setIsScanning(true);
    setScanProgress(0);
    const regions: FrequencyRegion[] = [];
    
    const startFreq = frequencyRange.min * 1_000_000; // Convert MHz to Hz
    const endFreq = frequencyRange.max * 1_000_000;
    const totalSteps = Math.ceil((endFreq - startFreq) / stepSizeHz);
    
    for (let step = 0; step < totalSteps; step++) {
      const centerFreq = startFreq + (step * stepSizeHz) + (windowSizeHz / 2);
      
      // Skip if beyond range
      if (centerFreq + windowSizeHz / 2 > endFreq) break;
      
      // Extract frequency window
      const windowStart = Math.max(startFreq, centerFreq - windowSizeHz / 2);
      const windowEnd = Math.min(endFreq, centerFreq + windowSizeHz / 2);
      const _windowData = extractFrequencyWindow(iqSamples, centerFreq, windowSizeHz);
      
      // FM demodulate
      const demodulated = fmDemodulate(iqSamples);
      
      // Analyze for audio
      const audioScore = analyzeForAudio(demodulated);
      
      // Calculate signal metrics
      const signalStrength = windowData.reduce((sum, val) => sum + val, 0) / windowData.length;
      const noiseFloor = Math.min(...windowData);
      const snr = signalStrength > noiseFloor ? 20 * Math.log10(signalStrength / noiseFloor) : 0;
      
      // Add region if above threshold
      if (audioScore >= audioThreshold) {
        regions.push({
          startFreq: windowStart,
          endFreq: windowEnd,
          centerFreq,
          audioScore,
          signalStrength,
          snr
        });
      }
      
      // Update progress
      setScanProgress((step + 1) / totalSteps);
      
      // Allow UI to update
      if (step % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    setDetectedRegions(regions);
    setIsScanning(false);
    setScanProgress(1);
    
    return regions;
  }, [windowSizeHz, stepSizeHz, audioThreshold, extractFrequencyWindow, fmDemodulate, analyzeForAudio]);

  // Demodulate a specific region for audio playback
  const demodulateRegion = useCallback(async (
    iqSamples: Uint8Array, 
    region: FrequencyRegion
  ): Promise<AudioDetectionResult | null> => {
    try {
      // Extract the specific frequency region
      const windowData = extractFrequencyWindow(iqSamples, region.centerFreq, region.endFreq - region.startFreq);
      
      // FM demodulate
      const demodulated = fmDemodulate(iqSamples);
      
      // AM demodulation (envelope detection)
      const envelope = new Float32Array(demodulated.length);
      const smoothingFactor = 0.95;
      
      let prevEnvelope = 0;
      for (let i = 0; i < demodulated.length; i++) {
        const absValue = Math.abs(demodulated[i]);
        prevEnvelope = smoothingFactor * prevEnvelope + (1 - smoothingFactor) * absValue;
        envelope[i] = prevEnvelope;
      }
      
      // Resample to audio rate (48kHz)
      const audioContext = getAudioContext();
      const targetSampleRate = 48000;
      const resamplingRatio = targetSampleRate / sampleRate;
      const audioLength = Math.floor(envelope.length * resamplingRatio);
      const audioBuffer = new Float32Array(audioLength);
      
      // Simple linear resampling
      for (let i = 0; i < audioLength; i++) {
        const sourceIndex = i / resamplingRatio;
        const index0 = Math.floor(sourceIndex);
        const index1 = Math.min(index0 + 1, envelope.length - 1);
        const fraction = sourceIndex - index0;
        
        audioBuffer[i] = envelope[index0] * (1 - fraction) + envelope[index1] * fraction;
      }
      
      // Normalize audio
      const maxAmplitude = Math.max(...audioBuffer.map(Math.abs));
      if (maxAmplitude > 0) {
        for (let i = 0; i < audioBuffer.length; i++) {
          audioBuffer[i] /= maxAmplitude * 0.8; // Leave some headroom
        }
      }
      
      return {
        region,
        audioBuffer,
        sampleRate: targetSampleRate
      };
    } catch (error) {
      console.error('Error demodulating region:', error);
      return null;
    }
  }, [extractFrequencyWindow, fmDemodulate, getAudioContext, sampleRate]);

  return {
    scanForAudio,
    demodulateRegion,
    isScanning,
    scanProgress,
    detectedRegions
  };
}
