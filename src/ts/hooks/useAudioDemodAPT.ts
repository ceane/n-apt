import { useCallback, useRef, useState, useEffect } from "react";

export interface AudioDemodAPTOptions {
  targetSampleRate: number; // Output audio sample rate (48kHz)
  bufferSize: number;      // Audio buffer size
}

export interface AudioDemodAPTHandle {
  processIQData: (iqData: Uint8Array, sampleRate: number) => void;
  playAudio: () => void;
  stopAudio: () => void;
  setVolume: (volume: number) => void;
  isPlaying: boolean;
  volume: number;
}

/**
 * APT demodulation and playback using Web Audio API
 * Specifically implementing the discrete envelope detection algorithm
 * y[i] = sqrt(x[i]^2 + x[i-1]^2 - 2x[i]x[i-1]cos(phi)) / sin(phi)
 * to recover the AM-modulated image content from the FM baseband.
 */
export function useAudioDemodAPT(options: AudioDemodAPTOptions): AudioDemodAPTHandle {
  const APT_IMAGE_CARRIER = 2400; // 2.4kHz subcarrier
  const { targetSampleRate } = options;
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.8);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processedAudioBufferRef = useRef<Float32Array | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  // Standard FM demodulation (APT is FM modulated)
  const demodulateAPTBaseband = useCallback((iqData: Uint8Array): Float32Array => {
    const samples = iqData.length / 2;
    const audioBuffer = new Float32Array(samples);
    
    const i = new Float32Array(samples);
    const q = new Float32Array(samples);
    
    for (let j = 0; j < samples; j++) {
      i[j] = (iqData[j * 2] - 128) / 128;
      q[j] = (iqData[j * 2 + 1] - 128) / 128;
    }
    
    for (let j = 1; j < samples; j++) {
      const phase1 = Math.atan2(q[j - 1], i[j - 1]);
      const phase2 = Math.atan2(q[j], i[j]);
      
      let phaseDiff = phase2 - phase1;
      if (phaseDiff > Math.PI) phaseDiff -= 2 * Math.PI;
      else if (phaseDiff < -Math.PI) phaseDiff += 2 * Math.PI;
      
      audioBuffer[j] = phaseDiff;
    }

    // Normalization
    let maxAmp = 0;
    for (let j = 0; j < samples; j++) maxAmp = Math.max(maxAmp, Math.abs(audioBuffer[j]));
    if (maxAmp > 0) {
      for (let j = 0; j < samples; j++) audioBuffer[j] /= maxAmp;
    }
    
    return audioBuffer;
  }, []);

  const resampleAudio = useCallback((audio: Float32Array, fromRate: number, toRate: number): Float32Array => {
    const ratio = fromRate / toRate;
    const outputLength = Math.floor(audio.length / ratio);
    const resampled = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
        const sourceIndex = i * ratio;
        const index = Math.floor(sourceIndex);
        const fraction = sourceIndex - index;
        if (index < audio.length - 1) {
            resampled[i] = audio[index] * (1 - fraction) + audio[index + 1] * fraction;
        } else {
            resampled[i] = audio[index];
        }
    }
    return resampled;
  }, []);

  const envelopeDetectAPT = useCallback((audio: Float32Array, sampleRate: number): Float32Array => {
    const phi = 2 * Math.PI * (APT_IMAGE_CARRIER / sampleRate);
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    
    const samples = audio.length;
    const envelope = new Float32Array(samples);
    
    // Formula from PI-SDR / apt137 for discrete envelope detection
    for (let j = 1; j < samples; j++) {
      const xi = audio[j];
      const prevXi = audio[j - 1];
      
      const term1 = xi * xi;
      const term2 = prevXi * prevXi;
      const term3 = 2 * xi * prevXi * cosPhi;
      
      // Prevent negative values due to floating point precision errors before sqrt
      const val = Math.sqrt(Math.max(0, term1 + term2 - term3));
      envelope[j] = val / sinPhi;
    }
    
    // Handle index 0
    envelope[0] = envelope[1];

    // Simple normalization and clamping for audio representation of pixels
    let maxAmp = 0;
    for (let j = 0; j < samples; j++) maxAmp = Math.max(maxAmp, envelope[j]);
    if (maxAmp > 0) {
      for (let j = 0; j < samples; j++) {
        // Map [0, max] to [0, 1] then shift to center around 0 for DC-free audio if needed?
        // Actually for audio of pixels, we just clamp to 1.0 but pixels are unipolar.
        // We'll provide it as unipolar [0, 1] which the audio context will handle as positive samples.
        envelope[j] /= maxAmp;
      }
    }
    
    return envelope;
  }, []);

  const processIQData = useCallback((iqData: Uint8Array, inputSampleRate: number) => {
    if (!iqData || iqData.length === 0) return;
    
    // 1. FM demodulation to get baseband (which contains 2.4kHz AM subcarrier)
    const baseband = demodulateAPTBaseband(iqData);
    
    // 2. Apply Envelope Detection to recover image pixels (magnitude of 2.4kHz subcarrier)
    // Note: It's theoretically better to apply this at the original inputSampleRate 
    // to preserve more phase nuance before resampling.
    const imageEnvelope = envelopeDetectAPT(baseband, inputSampleRate);
    
    // 3. Resample the resulting envelope to the target audio sample rate (e.g. 48kHz)
    let finalAudio = imageEnvelope;
    if (inputSampleRate !== targetSampleRate) {
      finalAudio = resampleAudio(imageEnvelope, inputSampleRate, targetSampleRate);
    }
    
    processedAudioBufferRef.current = finalAudio;
  }, [demodulateAPTBaseband, envelopeDetectAPT, resampleAudio, targetSampleRate]);

  const playAudio = useCallback(() => {
    if (!processedAudioBufferRef.current) return;
    try {
      const audioContext = getAudioContext();
      stopAudio();
      const buffer = audioContext.createBuffer(1, processedAudioBufferRef.current.length, targetSampleRate);
      buffer.copyToChannel(processedAudioBufferRef.current as any, 0);
      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = buffer;
      const gainNode = audioContext.createGain();
      gainNode.gain.value = volume;
      sourceNode.connect(gainNode);
      gainNode.connect(audioContext.destination);
      sourceNodeRef.current = sourceNode;
      gainNodeRef.current = gainNode;
      sourceNode.onended = () => {
        setIsPlaying(false);
        sourceNodeRef.current = null;
        gainNodeRef.current = null;
      };
      sourceNode.start(0);
      setIsPlaying(true);
    } catch (error) {
      console.error('Error playing APT audio:', error);
      setIsPlaying(false);
    }
  }, [getAudioContext, volume, targetSampleRate]);

  const stopAudio = useCallback(() => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch (_e) {}
      sourceNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const setVolume = useCallback((newVolume: number) => {
    const clamped = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clamped);
    if (gainNodeRef.current) gainNodeRef.current.gain.value = clamped;
  }, []);

  useEffect(() => {
    return () => {
      stopAudio();
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [stopAudio]);

  return { processIQData, playAudio, stopAudio, setVolume, isPlaying, volume };
}
