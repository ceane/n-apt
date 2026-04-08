import { useCallback, useRef, useState, useEffect } from "react";

export interface AudioDemodFMOptions {
  targetSampleRate: number; // Output audio sample rate (48kHz)
  bufferSize: number;      // Audio buffer size
}

export interface AudioDemodFMHandle {
  processIQData: (iqData: Uint8Array, sampleRate: number) => void;
  playAudio: () => void;
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
  const { targetSampleRate } = options;
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.8);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processedAudioBufferRef = useRef<Float32Array | null>(null);

  // Initialize audio context
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  // FM demodulation algorithm using phase discriminator
  const demodulateFM = useCallback((iqData: Uint8Array, _inputSampleRate: number): Float32Array => {
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
    
    // FM demodulation using phase discriminator
    // The FM signal is encoded in the phase of the I/Q signal
    // We calculate the phase difference between consecutive samples
    for (let j = 1; j < samples; j++) {
      // Calculate phase difference using arctan2
      const phase1 = Math.atan2(q[j - 1], i[j - 1]);
      const phase2 = Math.atan2(q[j], i[j]);
      
      let phaseDiff = phase2 - phase1;
      
      // Wrap phase difference to [-π, π]
      if (phaseDiff > Math.PI) {
        phaseDiff -= 2 * Math.PI;
      } else if (phaseDiff < -Math.PI) {
        phaseDiff += 2 * Math.PI;
      }
      
      // The phase difference is proportional to the frequency deviation
      // which contains the audio signal
      audioBuffer[j] = phaseDiff;
    }
    
    // Apply de-emphasis filter (simple high-pass to remove DC component)
    const deemphasis = 0.95;
    for (let j = 1; j < samples; j++) {
      audioBuffer[j] = deemphasis * audioBuffer[j - 1] + (1 - deemphasis) * audioBuffer[j];
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
  }, []);

  // Process I/Q data and convert to audio
  const processIQData = useCallback((iqData: Uint8Array, inputSampleRate: number) => {
    if (!iqData || iqData.length === 0) return;
    
    // Demodulate FM to audio
    const demodulatedAudio = demodulateFM(iqData, inputSampleRate);
    
    // Resample if necessary
    let finalAudio = demodulatedAudio;
    if (inputSampleRate !== targetSampleRate) {
      finalAudio = resampleAudio(demodulatedAudio, inputSampleRate, targetSampleRate);
    }
    
    // Store processed audio for playback
    processedAudioBufferRef.current = finalAudio;
  }, [demodulateFM, targetSampleRate]);

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

  // Play audio through Web Audio API
  const playAudio = useCallback(() => {
    if (!processedAudioBufferRef.current) {
      console.warn('No processed audio data available');
      return;
    }

    try {
      const audioContext = getAudioContext();
      
      // Stop any existing playback
      stopAudio();
      
      // Create audio buffer
      const buffer = audioContext.createBuffer(1, processedAudioBufferRef.current.length, targetSampleRate);
      buffer.copyToChannel(processedAudioBufferRef.current as any, 0);
      
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
  }, [getAudioContext, volume, targetSampleRate]);

  // Stop audio playback
  const stopAudio = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (_error) {
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
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopAudio]);

  return {
    processIQData,
    playAudio,
    stopAudio,
    setVolume,
    isPlaying,
    volume
  };
}
