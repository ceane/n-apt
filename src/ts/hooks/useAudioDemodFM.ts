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
  const { targetSampleRate, centerFrequency = 0, bandwidth = 200000 } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.8);

  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Demodulator state refs to prevent discontinuities between chunks
  const shiftStateRef = useRef<ShiftState>({ phase: 0 });
  const filterStateRef = useRef<LowPassState>({
    prevI: 0,
    prevQ: 0,
  });
  const lastDiscrimIRef = useRef<number>(0);
  const lastDiscrimQRef = useRef<number>(0);
  const lastDcBiasRef = useRef<number>(0);
  const audioLPStateRef = useRef<[number, number]>([0, 0]);
  const lastDeemphasisRef = useRef<number>(0);
  const nextStartTimeRef = useRef<number>(0);
  const resampleOffsetRef = useRef<number>(0);

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

  // FM demodulation algorithm using phase discriminator
  const demodulateFM = useCallback(
    (
      iqData: Uint8Array,
      inputSampleRate: number,
      frameCenterFrequencyHz?: number | null,
    ): Float32Array => {
      const samples = iqData.length / 2;
      const audioBuffer = new Float32Array(samples);
      if (iqData.every((sample) => sample === 0)) {
        return audioBuffer;
      }
      const shiftHz = computeFrequencyOffsetHz(
        centerFrequency,
        frameCenterFrequencyHz,
      );

      // 1. Shift to baseband (stateful)
      const shifted = shiftIqToBaseband(
        iqData,
        shiftHz,
        inputSampleRate,
        shiftStateRef.current,
      );

      // 2. Complex Low-Pass Filter (stateful)
      const filtered = applyComplexLowPass(
        shifted,
        bandwidth / 2,
        inputSampleRate,
        filterStateRef.current,
      );

      // 3. Phase discriminator (stateful)
      let prevI = lastDiscrimIRef.current;
      let prevQ = lastDiscrimQRef.current;

      for (let j = 0; j < samples; j++) {
        const curI = filtered[j * 2];
        const curQ = filtered[j * 2 + 1];

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

      // 4. DC Removal (Stateful High-pass filter)
      // alpha = 0.999 is a very slow leaky integrator to track and remove DC bias
      const dcAlpha = 0.999;
      let bias = lastDcBiasRef.current;
      for (let j = 0; j < samples; j++) {
        bias = dcAlpha * bias + (1 - dcAlpha) * audioBuffer[j];
        audioBuffer[j] -= bias;
      }
      lastDcBiasRef.current = bias;

      // 5. Audio Low-Pass Filter (15-16kHz) - 2nd Order
      // This is CRITICAL for FM broadcast to remove the 19kHz pilot and stereo subcarriers.
      // We use two stages of IIR filtering for a steeper roll-off.
      const audioCutoffHz = 15500;
      const audioDt = 1 / inputSampleRate;
      const audioRc = 1 / (2 * Math.PI * audioCutoffHz);
      const audioAlpha = audioDt / (audioRc + audioDt);
      let [lp1, lp2] = audioLPStateRef.current;

      for (let j = 0; j < samples; j++) {
        lp1 = lp1 + audioAlpha * (audioBuffer[j] - lp1);
        lp2 = lp2 + audioAlpha * (lp1 - lp2);
        audioBuffer[j] = lp2;
      }
      audioLPStateRef.current = [lp1, lp2];

      // 6. De-emphasis filter (stateful)
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

      // 7. Gain and hard-clipping
      // atan2 output is [-PI, PI]. Typical FM deviation is ~1.8 rad at 256k rate.
      // Normalize by PI to get ~[-0.6, 0.6], then apply a comfortable gain.
      const outputGain = 2.5;
      for (let j = 0; j < samples; j++) {
        const normalized = audioBuffer[j] / Math.PI;
        const scaled = normalized * outputGain;
        audioBuffer[j] = Math.max(-1.1, Math.min(1.1, scaled));
      }

      return audioBuffer;
    },
    [centerFrequency, bandwidth],
  );


  // Stateful linear resampling to prevent phase slips at chunk boundaries
  const resampleAudio = useCallback(
    (audio: Float32Array, fromRate: number, toRate: number): Float32Array => {
      if (fromRate === toRate) {
        resampleOffsetRef.current = 0;
        return audio;
      }
      const ratio = fromRate / toRate;
      const startOffset = resampleOffsetRef.current;
      const resampledSamples: number[] = [];
      let sourceIndex = startOffset;

      while (sourceIndex < audio.length) {
        const index = Math.floor(sourceIndex);
        const fraction = sourceIndex - index;

        if (index < audio.length - 1) {
          resampledSamples.push(
            audio[index] * (1 - fraction) + audio[index + 1] * fraction,
          );
        } else {
          resampledSamples.push(audio[index]);
        }
        sourceIndex += ratio;
      }

      // Store the remaining offset for the next chunk
      resampleOffsetRef.current = sourceIndex - audio.length;

      return new Float32Array(resampledSamples);
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
    // Reset DSP state to prevent pops when restarting
    shiftStateRef.current = { phase: 0 };
    lastDiscrimIRef.current = 0;
    lastDiscrimQRef.current = 0;
    lastDcBiasRef.current = 0;
    audioLPStateRef.current = [0, 0];
    lastDeemphasisRef.current = 0;
    resampleOffsetRef.current = 0;
    shiftStateRef.current.phase = 0;
    filterStateRef.current.prevI = 0;
    filterStateRef.current.prevQ = 0;
    nextStartTimeRef.current = 0;
  }, []);

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
