import { useCallback, useRef, useState, useEffect } from "react";
import {
  applyComplexLowPass,
  computeFrequencyOffsetHz,
  shiftIqToBaseband,
  LowPassState,
  ShiftState,
} from "@n-apt/utils/demodulation";

export interface AudioDemodFMOptions {
  targetSampleRate: number; // Output audio sample rate for playback (typically 48000)
  bufferSize: number; // Audio buffer size
  centerFrequency?: number; // Target FM station frequency offset from SDR center in Hz
  bandwidth?: number; // Bandwidth to select (default: 200kHz for ±100kHz)
}

export interface AudioDemodFMHandle {
  processIQData: (
    iqData: Uint8Array,
    sampleRateHz: number,
    frameCenterFrequencyHz?: number | null,
  ) => Float32Array | null;
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
export function useAudioDemodFM(
  options: AudioDemodFMOptions,
): AudioDemodFMHandle {
  const { targetSampleRate, centerFrequency = 0, bandwidth = 200000 } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.8);

  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Demodulator state refs to prevent discontinuities between chunks
  const shiftStateRef = useRef<ShiftState>({ phase: 0 });
  const lowPassStateRef = useRef<LowPassState>({ prevI: 0, prevQ: 0 });
  const lastDiscrimIRef = useRef<number>(0);
  const lastDiscrimQRef = useRef<number>(0);
  const lastDeemphasisRef = useRef<number>(0);
  const nextStartTimeRef = useRef<number>(0);

  // Get or create audio context
  const getAudioContext = useCallback(() => {
    if (
      !audioContextRef.current ||
      audioContextRef.current.state === "closed"
    ) {
      audioContextRef.current = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    }
    return audioContextRef.current;
  }, []);

  // FM demodulation algorithm using phase discriminator
  const demodulateFM = useCallback(
    (
      iqData: Uint8Array,
      inputSampleRate: number,
      frameCenterFrequencyHz?: number | null,
    ): Float32Array => {
      const samples = iqData.length / 2;
      const audioBuffer = new Float32Array(samples);
      const frequencyOffsetHz = computeFrequencyOffsetHz(
        centerFrequency,
        frameCenterFrequencyHz,
      );

      // 1. Shift to baseband (stateful)
      const shiftedIq = shiftIqToBaseband(
        iqData,
        inputSampleRate,
        frequencyOffsetHz,
        shiftStateRef.current,
      );

      // 2. Low pass filter (stateful)
      const filteredIq = applyComplexLowPass(
        shiftedIq,
        inputSampleRate,
        bandwidth,
        lowPassStateRef.current,
      );

      // 3. Phase discriminator (stateful)
      let prevI = lastDiscrimIRef.current;
      let prevQ = lastDiscrimQRef.current;

      for (let j = 0; j < samples; j++) {
        const curI = filteredIq[j * 2];
        const curQ = filteredIq[j * 2 + 1];

        // Complex conjugate multiplication: z[n] * conj(z[n-1])
        // Yields a vector whose angle is the phase difference
        const real = curI * prevI + curQ * prevQ;
        const imag = curQ * prevI - curI * prevQ;

        // atan2 gives instantaneous frequency (phase delta)
        audioBuffer[j] = Math.atan2(imag, real);

        prevI = curI;
        prevQ = curQ;
      }
      lastDiscrimIRef.current = prevI;
      lastDiscrimQRef.current = prevQ;

      // 4. DC Removal (High-pass filter)
      // Use a simple leaky integrator to track and remove bias
      let bias = 0;
      for (let j = 0; j < samples; j++) bias += audioBuffer[j];
      bias /= samples;
      for (let j = 0; j < samples; j++) audioBuffer[j] -= bias;

      // 5. De-emphasis filter (stateful)
      // alpha = exp(-1 / (tau * sampleRate)) where tau = 75μs
      const deemphasisAlpha = Math.exp(-1 / (75e-6 * inputSampleRate));
      let prevOut = lastDeemphasisRef.current;

      for (let j = 0; j < samples; j++) {
        const out =
          (1 - deemphasisAlpha) * audioBuffer[j] + deemphasisAlpha * prevOut;
        audioBuffer[j] = out;
        prevOut = out;
      }
      lastDeemphasisRef.current = prevOut;

      // 6. Gain and hard-clipping
      const outputGain = 5.0;
      for (let j = 0; j < samples; j++) {
        const scaled = audioBuffer[j] * outputGain;
        audioBuffer[j] = Math.max(-1, Math.min(1, scaled));
      }

      return audioBuffer;
    },
    [centerFrequency, bandwidth],
  );

  // Simple linear resampling
  const resampleAudio = useCallback(
    (audio: Float32Array, fromRate: number, toRate: number): Float32Array => {
      if (fromRate === toRate) return audio;
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

  // Process I/Q data and return demodulated audio (resampled to targetSampleRate)
  const processIQData = useCallback(
    (
      iqData: Uint8Array,
      inputSampleRate: number,
      frameCenterFrequencyHz?: number | null,
    ): Float32Array | null => {
      if (!iqData || iqData.length === 0) return null;

      const demodulatedAudio = demodulateFM(
        iqData,
        inputSampleRate,
        frameCenterFrequencyHz,
      );

      return resampleAudio(demodulatedAudio, inputSampleRate, targetSampleRate);
    },
    [demodulateFM, targetSampleRate, resampleAudio],
  );

  // Play a chunk of demodulated audio through Web Audio API
  const playChunk = useCallback(
    (audioData: Float32Array) => {
      if (!audioData || audioData.length === 0) return;

      try {
        const audioContext = getAudioContext();
        if (audioContext.state === "suspended") {
          audioContext.resume();
        }

        const buffer = audioContext.createBuffer(
          1,
          audioData.length,
          targetSampleRate,
        );
        buffer.copyToChannel(audioData, 0);

        const sourceNode = audioContext.createBufferSource();
        sourceNode.buffer = buffer;

        const gainNode = audioContext.createGain();
        gainNode.gain.value = volume;

        sourceNode.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Precise scheduling to prevent gaps/crackles
        const currentTime = audioContext.currentTime;
        // If we fall too far behind (e.g. tab was inactive), reset the clock
        if (nextStartTimeRef.current < currentTime - 0.1) {
          nextStartTimeRef.current = currentTime + 0.05;
        }

        const startTime = Math.max(currentTime, nextStartTimeRef.current);
        sourceNode.start(startTime);

        // Update the next expected start time
        nextStartTimeRef.current = startTime + buffer.duration;

        setIsPlaying(true);
      } catch (error) {
        console.error("Error playing FM audio chunk:", error);
      }
    },
    [getAudioContext, volume, targetSampleRate],
  );

  // Stop audio playback and reset state
  const stopAudio = useCallback(() => {
    setIsPlaying(false);
    nextStartTimeRef.current = 0;
    // Reset DSP state to prevent pops when restarting
    shiftStateRef.current = { phase: 0 };
    lowPassStateRef.current = { prevI: 0, prevQ: 0 };
    lastDiscrimIRef.current = 0;
    lastDiscrimQRef.current = 0;
    lastDeemphasisRef.current = 0;
  }, []);

  // For compatibility with DemodContext, playAudio now just calls playChunk
  const playAudio = useCallback(
    (audioData: Float32Array) => {
      playChunk(audioData);
    },
    [playChunk],
  );

  // Set volume
  const setVolume = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = clampedVolume;
    }
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      stopAudio();
      if (audioContextRef.current?.state !== "closed") {
        audioContextRef.current?.close();
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
    volume,
  };
}
