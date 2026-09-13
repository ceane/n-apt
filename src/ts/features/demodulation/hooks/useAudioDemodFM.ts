import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { createDemodProcessor } from "@n-apt/demodulation/utils/demodProcessors";

export interface AudioDemodFMOptions {
  targetSampleRate: number; // Output audio sample rate for playback (typically 48000)
  bufferSize: number; // Audio buffer size
  centerFrequency?: number; // Target FM station frequency offset from SDR center in Hz
  bandwidth?: number; // Bandwidth to select (default: 200kHz for ±100kHz)
  /** Defaults to broadcast FM; pass `fmDiscriminator` for the N-APT valley probe. */
  algorithm?: "fm" | "fmDiscriminator";
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
  resumeAudioContext: () => void;
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
  const {
    targetSampleRate,
    centerFrequency = 0,
    bandwidth = 200000,
    algorithm = "fm",
  } = options;
  const sharedProcessor = useMemo(
    () =>
      createDemodProcessor(algorithm, {
        targetSampleRate,
        centerFrequency,
        bandwidth,
      }),
    [algorithm, targetSampleRate, centerFrequency, bandwidth],
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.8);

  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const nextStartTimeRef = useRef<number>(0);

  // Get or create audio context
  const getAudioContext = useCallback(() => {
    if (
      !audioContextRef.current ||
      audioContextRef.current.state === "closed"
    ) {
      const ctx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
      audioContextRef.current = ctx;

      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      gainNodeRef.current = gain;
    }
    return audioContextRef.current;
  }, [volume]);

  // Process I/Q data and return demodulated audio (resampled to targetSampleRate)
  const processIQData = useCallback(
    (
      iqData: Uint8Array,
      inputSampleRate: number,
      frameCenterFrequencyHz?: number | null,
    ): Float32Array | null => {
      if (!iqData || iqData.length === 0) return null;

      return sharedProcessor.process(
        iqData,
        inputSampleRate,
        frameCenterFrequencyHz,
      );
    },
    [sharedProcessor],
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
        buffer.copyToChannel(Float32Array.from(audioData), 0);

        const sourceNode = audioContext.createBufferSource();
        sourceNode.buffer = buffer;

        sourceNode.connect(gainNodeRef.current!);

        // Precise scheduling with a safety buffer to prevent gaps/crackles
        const currentTime = audioContext.currentTime;
        const targetLatency = 0.15; // 150ms buffer to absorb jitter

        // If we fall behind the current time or are just starting, reset to target latency
        if (nextStartTimeRef.current < currentTime + 0.02) {
          nextStartTimeRef.current = currentTime + targetLatency;
        }

        const startTime = nextStartTimeRef.current;
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
    sharedProcessor.reset();
  }, [sharedProcessor]);

  // For compatibility with DemodContext, playAudio now just calls playChunk
  const resumeAudioContext = useCallback(() => {
    const audioContext = getAudioContext();
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume();
    }
  }, [getAudioContext]);

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
    resumeAudioContext,
    isPlaying,
    volume,
  };
}
