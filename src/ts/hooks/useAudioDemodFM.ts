import { useCallback, useRef, useState, useEffect } from "react";

export interface AudioDemodFMOptions {
  targetSampleRate: number; // Output audio sample rate for playback (typically 48000)
  bufferSize: number;      // Audio buffer size
  centerFrequency?: number; // Target FM station frequency offset from SDR center in Hz
  bandwidth?: number;      // Bandwidth to select (default: 200kHz for ±100kHz)
}

export interface AudioDemodFMHandle {
  processIQData: (iqData: Uint8Array, sampleRateHz: number) => Float32Array | null;
  playChunk: (audioData: Float32Array) => void;
  playAudio: (audioData: Float32Array) => void;
  stopAudio: () => void;
  setVolume: (volume: number) => void;
  isPlaying: boolean;
  volume: number;
}

/**
 * FM demodulation and playback using Web Audio API
 * Handles FM demodulation from I/Q data and real-time audio playback
 */
export function useAudioDemodFM(options: AudioDemodFMOptions): AudioDemodFMHandle {
  const { targetSampleRate, centerFrequency = 0, bandwidth = 200000 } = options;
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.8);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Get or create audio context
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  // FM demodulation algorithm using phase discriminator
  const demodulateFM = useCallback((iqData: Uint8Array, inputSampleRate: number): Float32Array => {
    const samples = iqData.length / 2;
    const audioBuffer = new Float32Array(samples);
    
    // Convert Uint8Array to normalized I/Q values
    const i = new Float32Array(samples);
    const q = new Float32Array(samples);
    
    for (let j = 0; j < samples; j++) {
      // Convert from 0-255 range to -1 to 1 range
      i[j] = (iqData[j * 2] - 128) / 128;
      q[j] = (iqData[j * 2 + 1] - 128) / 128;
    }
    
    // Downconvert to baseband if centerFrequency is set
    if (centerFrequency !== 0) {
      const angularFreq = -2 * Math.PI * centerFrequency / inputSampleRate;
      for (let j = 0; j < samples; j++) {
        const cos = Math.cos(angularFreq * j);
        const sin = Math.sin(angularFreq * j);
        // Complex multiplication: (i + j*q) * (cos + j*sin)
        const newI = i[j] * cos - q[j] * sin;
        const newQ = i[j] * sin + q[j] * cos;
        i[j] = newI;
        q[j] = newQ;
      }
    }
    
    // Apply low-pass filter to select the desired bandwidth
    // Simple 1-pole RC filter with cutoff at bandwidth/2
    const normalizedCutoff = (bandwidth / 2) / inputSampleRate;
    const alpha = Math.exp(-2 * Math.PI * normalizedCutoff);
    let prevI = i[0], prevQ = q[0];
    for (let j = 1; j < samples; j++) {
      prevI = prevI + alpha * (i[j] - prevI);
      prevQ = prevQ + alpha * (q[j] - prevQ);
      i[j] = prevI;
      q[j] = prevQ;
    }
    
    // FM demodulation using phase discriminator with cumulative phase tracking
    // This gives instantaneous frequency directly: imag(z[n] * conj(z[n-1]))
    let cumulativePhase = 0;
    for (let j = 1; j < samples; j++) {
      // Complex conjugate multiplication: z[n] * conj(z[n-1])
      const real = i[j] * i[j - 1] + q[j] * q[j - 1];
      const imag = q[j] * i[j - 1] - i[j] * q[j - 1];
      
      // atan2 gives instantaneous phase difference
      let phaseDiff = Math.atan2(imag, real);
      
      // Phase unwrapping: track cumulative phase to avoid discontinuities
      phaseDiff += cumulativePhase;
      cumulativePhase = phaseDiff;
      
      audioBuffer[j] = phaseDiff;
    }
    
    // Set first sample
    audioBuffer[0] = audioBuffer[1];
    
    // Apply de-emphasis filter (1-pole low-pass for 75μs at 48kHz)
    // alpha = exp(-1 / (tau * sampleRate)) where tau = 75e-6
    const deemphasisAlpha = Math.exp(-1 / (75e-6 * inputSampleRate));
    audioBuffer[0] = (1 - deemphasisAlpha) * audioBuffer[0];
    for (let j = 1; j < samples; j++) {
      audioBuffer[j] = audioBuffer[j] + deemphasisAlpha * (audioBuffer[j - 1] - audioBuffer[j]);
    }
    
    // Normalize audio to prevent clipping
    let maxAmplitude = 0;
    for (let j = 0; j < samples; j++) {
      maxAmplitude = Math.max(maxAmplitude, Math.abs(audioBuffer[j]));
    }
    
    if (maxAmplitude > 0) {
      for (let j = 0; j < samples; j++) {
        audioBuffer[j] /= maxAmplitude;
      }
    }
    
    return audioBuffer;
  }, [centerFrequency, bandwidth]);

  // Process I/Q data and return demodulated audio (resampled to targetSampleRate)
  const processIQData = useCallback((iqData: Uint8Array, inputSampleRate: number): Float32Array | null => {
    if (!iqData || iqData.length === 0) return null;
    
    // Demodulate FM to audio
    const demodulatedAudio = demodulateFM(iqData, inputSampleRate);
    
    // Resample to targetSampleRate (typically 48000 for playback)
    let finalAudio = demodulatedAudio;
    if (inputSampleRate !== targetSampleRate) {
      finalAudio = resampleAudio(demodulatedAudio, inputSampleRate, targetSampleRate);
    }
    
    return finalAudio;
  }, [demodulateFM, targetSampleRate]);

  // Play a chunk of demodulated audio through Web Audio API
  const playChunk = useCallback((audioData: Float32Array) => {
    if (!audioData || audioData.length === 0) return;
    
    try {
      const audioContext = getAudioContext();
      
      // Always create buffer at targetSampleRate (e.g., 48000) for proper playback speed
      const buffer = audioContext.createBuffer(1, audioData.length, targetSampleRate);
      buffer.copyToChannel(audioData, 0);
      
      // Create source node
      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = buffer;
      
      // Create gain node for volume control
      const gainNode = audioContext.createGain();
      gainNode.gain.value = volume;
      
      // Connect nodes
      sourceNode.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Start playback
      sourceNode.start(0);
      
    } catch (error) {
      console.error('Error playing FM audio:', error);
    }
  }, [getAudioContext, volume, targetSampleRate]);

  // Simple linear resampling
  const resampleAudio = useCallback((audio: Float32Array, fromRate: number, toRate: number): Float32Array => {
    const ratio = fromRate / toRate;
    const outputLength = Math.floor(audio.length / ratio);
    const resampled = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = i * ratio;
      const index = Math.floor(sourceIndex);
      const fraction = sourceIndex - index;
      
      if (index < audio.length - 1) {
        // Linear interpolation
        resampled[i] = audio[index] * (1 - fraction) + audio[index + 1] * fraction;
      } else {
        resampled[i] = audio[index];
      }
    }
    
    return resampled;
  }, []);

  // Stop audio playback (for playChunk - stops any active source)
  const stopAudio = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {
        // Already stopped
      }
      sourceNodeRef.current = null;
    }
    
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }
    
    setIsPlaying(false);
  }, []);

  // Play audio through Web Audio API
  const playAudio = useCallback((audioData: Float32Array) => {
    if (!audioData || audioData.length === 0) return;
    
    try {
      const audioContext = getAudioContext();
      
      // Stop any existing playback
      stopAudio();
      
      // Create audio buffer at targetSampleRate (e.g., 48000)
      const buffer = audioContext.createBuffer(1, audioData.length, targetSampleRate);
      buffer.copyToChannel(audioData, 0);
      
      // Create source node
      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = buffer;
      
      // Create gain node for volume control
      const gainNode = audioContext.createGain();
      gainNode.gain.value = volume;
      
      // Connect nodes
      sourceNode.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Store references
      sourceNodeRef.current = sourceNode;
      gainNodeRef.current = gainNode;
      
      // Handle playback end
      sourceNode.onended = () => {
        setIsPlaying(false);
        sourceNodeRef.current = null;
        gainNodeRef.current = null;
      };
      
      // Start playback
      sourceNode.start(0);
      setIsPlaying(true);
      
    } catch (error) {
      console.error('Error playing FM audio:', error);
      setIsPlaying(false);
    }
  }, [getAudioContext, stopAudio, volume, targetSampleRate]);

  // Set volume
  const setVolume = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
    
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = clampedVolume;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [stopAudio]);

  return {
    processIQData,
    playChunk,
    playAudio,
    stopAudio,
    setVolume,
    isPlaying,
    volume
  };
}
