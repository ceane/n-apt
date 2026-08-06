import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { createDemodProcessor } from "@n-apt/utils/demodProcessors";
import {
  applyComplexLowPass,
  shiftIqToBaseband,
} from "@n-apt/utils/demodulation";

export interface APTImageDemodOptions {
  targetSampleRate: number; // Output audio sample rate (48kHz)
  bufferSize: number; // Audio buffer size
}

export interface APTImageDemodHandle {
  processIQData: (
    iqData: Uint8Array,
    sampleRate: number,
    frameCenterFrequencyHz?: number | null,
  ) => void;
  playAudio: () => void;
  stopAudio: () => void;
  setVolume: (volume: number) => void;
  isPlaying: boolean;
  volume: number;
}

/**
 * Demodulates traditional APT image content and exposes it through the shared
 * Web Audio playback boundary. The DSP output is the recovered image envelope;
 * image reconstruction/display remains a separate consumer concern.
 */
export function useAPTImageDemod(
  options: APTImageDemodOptions,
): APTImageDemodHandle {
  const APT_IMAGE_CARRIER = 2400; // 2.4kHz subcarrier
  const { targetSampleRate } = options;
  const sharedProcessor = useMemo(
    () => createDemodProcessor("aptImage", { targetSampleRate }),
    [targetSampleRate],
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.8);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processedAudioBufferRef = useRef<Float32Array | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    }
    return audioContextRef.current;
  }, []);

  // Standard FM demodulation (APT is FM modulated)
  const demodulateAPTBaseband = useCallback(
    (
      iqData: Uint8Array,
      sampleRate: number,
      _frameCenterFrequencyHz?: number | null,
    ): Float32Array => {
      const samples = iqData.length / 2;
      const audioBuffer = new Float32Array(samples);
      const shiftedIq = shiftIqToBaseband(iqData, sampleRate, 0);
      const filteredIq = applyComplexLowPass(shiftedIq, sampleRate, 200_000);
      const i = new Float32Array(samples);
      const q = new Float32Array(samples);
      for (let j = 0; j < samples; j++) {
        i[j] = filteredIq[j * 2];
        q[j] = filteredIq[j * 2 + 1];
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
      for (let j = 0; j < samples; j++)
        maxAmp = Math.max(maxAmp, Math.abs(audioBuffer[j]));
      if (maxAmp > 0) {
        for (let j = 0; j < samples; j++) audioBuffer[j] /= maxAmp;
      }

      return audioBuffer;
    },
    [],
  );

  const resampleAudio = useCallback(
    (audio: Float32Array, fromRate: number, toRate: number): Float32Array => {
      const ratio = fromRate / toRate;
      const outputLength = Math.floor(audio.length / ratio);
      const resampled = new Float32Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        const sourceIndex = i * ratio;
        const index = Math.floor(sourceIndex);
        const fraction = sourceIndex - index;
        if (index < audio.length - 1) {
          resampled[i] =
            audio[index] * (1 - fraction) + audio[index + 1] * fraction;
        } else {
          resampled[i] = audio[index];
        }
      }
      return resampled;
    },
    [],
  );

  const envelopeDetectAPT = useCallback(
    (audio: Float32Array, sampleRate: number): Float32Array => {
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
    },
    [],
  );

  const processIQData = useCallback(
    (
      iqData: Uint8Array,
      inputSampleRate: number,
      frameCenterFrequencyHz?: number | null,
    ) => {
      if (!iqData || iqData.length === 0) return;

      processedAudioBufferRef.current = sharedProcessor.process(iqData, inputSampleRate, frameCenterFrequencyHz);
    },
    [sharedProcessor],
  );

  const playAudio = useCallback(() => {
    if (!processedAudioBufferRef.current) return;
    try {
      const audioContext = getAudioContext();
      stopAudio();
      const buffer = audioContext.createBuffer(
        1,
        processedAudioBufferRef.current.length,
        targetSampleRate,
      );
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
      console.error("Error playing APT audio:", error);
      setIsPlaying(false);
    }
  }, [getAudioContext, volume, targetSampleRate]);

  const stopAudio = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {}
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
