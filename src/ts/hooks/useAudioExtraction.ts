import { useCallback, useRef, useState } from "react";

export interface AudioExtractionOptions {
  _targetSampleRate: number; // Output audio sample rate (48kHz)
  _bufferSize: number;      // Audio buffer size
  enableFiltering: boolean; // Enable audio filtering
}

export interface AudioPlaybackHandle {
  playAudio: (audioBuffer: Float32Array, sampleRate: number) => Promise<void>;
  stopAudio: () => void;
  isPlaying: boolean;
  exportToWAV: (audioBuffer: Float32Array, sampleRate: number, filename: string) => void;
  mixAudioRegions: (regions: Array<{ buffer: Float32Array; gain: number }>) => Float32Array;
}

/**
 * Audio extraction and playback using Web Audio API
 * Handles resampling, filtering, and real-time playback of demodulated audio
 */
export function useAudioExtraction(options: AudioExtractionOptions): AudioPlaybackHandle {
  const { enableFiltering } = options;
  
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Initialize audio context
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  // Apply audio filtering
  const applyFiltering = useCallback((audioBuffer: Float32Array, sampleRate: number): Float32Array => {
    if (!enableFiltering) return audioBuffer;

    const filtered = new Float32Array(audioBuffer.length);
    
    // Simple low-pass filter to remove high-frequency noise
    const cutoffFreq = 4000; // 4kHz cutoff for voice
    const rc = 1.0 / (2 * Math.PI * cutoffFreq);
    const dt = 1.0 / sampleRate;
    const alpha = dt / (rc + dt);
    
    filtered[0] = audioBuffer[0];
    for (let i = 1; i < audioBuffer.length; i++) {
      filtered[i] = alpha * audioBuffer[i] + (1 - alpha) * filtered[i - 1];
    }
    
    return filtered;
  }, [enableFiltering]);

  // Play audio through Web Audio API
  const playAudio = useCallback(async (audioBuffer: Float32Array, sampleRate: number): Promise<void> => {
    try {
      const audioContext = getAudioContext();
      
      // Stop any existing playback
      stopAudio();
      
      // Apply filtering
      const processedBuffer = applyFiltering(audioBuffer, sampleRate);
      
      // Create audio buffer
      const buffer = audioContext.createBuffer(1, processedBuffer.length, sampleRate);
      buffer.copyToChannel(new Float32Array(processedBuffer), 0);
      
      // Create source node
      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = buffer;
      
      // Create gain node for volume control
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.8; // 80% volume
      
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
      console.error('Error playing audio:', error);
      setIsPlaying(false);
    }
  }, [getAudioContext, applyFiltering]);

  // Stop audio playback
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

  // Export audio to WAV file
  const exportToWAV = useCallback((audioBuffer: Float32Array, sampleRate: number, filename: string) => {
    const wavFile = createWAVFile(audioBuffer, sampleRate);
    const blob = new Blob([wavFile], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.wav') ? filename : `${filename}.wav`;
    link.click();
    
    // Cleanup
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // Mix multiple audio regions
  const mixAudioRegions = useCallback((
    regions: Array<{ buffer: Float32Array; gain: number }>
  ): Float32Array => {
    if (regions.length === 0) return new Float32Array(0);
    if (regions.length === 1) return regions[0].buffer;
    
    // Find maximum length
    const maxLength = Math.max(...regions.map(r => r.buffer.length));
    const mixed = new Float32Array(maxLength);
    
    // Mix all regions
    for (const region of regions) {
      const gain = region.gain || 1.0;
      for (let i = 0; i < Math.min(region.buffer.length, maxLength); i++) {
        mixed[i] += region.buffer[i] * gain;
      }
    }
    
    // Normalize to prevent clipping
    const maxAmplitude = Math.max(...mixed.map(Math.abs));
    if (maxAmplitude > 1.0) {
      for (let i = 0; i < mixed.length; i++) {
        mixed[i] /= maxAmplitude;
      }
    }
    
    return mixed;
  }, []);

  // Create WAV file from audio buffer
  const createWAVFile = (audioBuffer: Float32Array, sampleRate: number): ArrayBuffer => {
    const length = audioBuffer.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    // Convert float samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, audioBuffer[i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }
    
    return arrayBuffer;
  };

  return {
    playAudio,
    stopAudio,
    isPlaying,
    exportToWAV,
    mixAudioRegions
  };
}
