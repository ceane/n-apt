import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { createDemodProcessor } from "@n-apt/utils/demodProcessors";
import {
  applyComplexLowPass,
  shiftIqToBaseband,
} from "@n-apt/utils/demodulation";
import {
  detectNaptSpikeCandidates,
  type NaptSpikeDetectionResult,
} from "@n-apt/utils/naptSpikeDetection";

export interface APTAudioDemodOptions {
  targetSampleRate: number; // Output audio sample rate (48kHz)
  bufferSize: number; // Audio buffer size
}

export interface APTAudioDemodHandle {
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
  detectionResult: NaptSpikeDetectionResult | null;
  detectSpikes: (
    iqData: Uint8Array,
    sampleRate: number,
    frameCenterFrequencyHz?: number | null,
  ) => NaptSpikeDetectionResult | null;
}

/**
 * Demodulates APT-like content for audio playback while retaining the
 * repository's NAPT-specific spike detector and result types. The algorithm
 * name is APTAudio because the demodulation attempt is APT-based; the signal
 * analysis remains explicitly NAPT-specific.
 */
export function useAPTAudioDemod(
  options: APTAudioDemodOptions,
): APTAudioDemodHandle {
  const APT_AUDIO_CARRIER = 2400;
  const { targetSampleRate } = options;
  const sharedProcessor = useMemo(
    () => createDemodProcessor("aptAudio", { targetSampleRate }),
    [targetSampleRate],
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.8);
  const [detectionResult, setDetectionResult] =
    useState<NaptSpikeDetectionResult | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processedAudioBufferRef = useRef<Float32Array | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    }
    return audioContextRef.current;
  }, []);

  const demodulateAPTAudioBaseband = useCallback(
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

      let maxAmp = 0;
      for (let j = 0; j < samples; j++) {
        maxAmp = Math.max(maxAmp, Math.abs(audioBuffer[j]));
      }
      if (maxAmp > 0) {
        for (let j = 0; j < samples; j++) {
          audioBuffer[j] /= maxAmp;
        }
      }

      return audioBuffer;
    },
    [],
  );

  const detectSpikes = useCallback(
    (
      iqData: Uint8Array,
      sampleRate: number,
      frameCenterFrequencyHz?: number | null,
    ) => {
      if (!iqData || iqData.length === 0) {
        setDetectionResult(null);
        return null;
      }

      const baseband = demodulateAPTAudioBaseband(
        iqData,
        sampleRate,
        frameCenterFrequencyHz,
      );
      const magnitude = new Float32Array(baseband.length);
      for (let i = 0; i < baseband.length; i++) {
        magnitude[i] = Math.abs(baseband[i]);
      }
      const result = detectNaptSpikeCandidates(magnitude);
      setDetectionResult(result);
      return result;
    },
    [demodulateAPTAudioBaseband],
  );

  const resampleAudio = useCallback(
    (audio: Float32Array, fromRate: number, toRate: number): Float32Array => {
      if (fromRate === toRate) {
        return audio;
      }
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

  const envelopeDetectAPTAudio = useCallback(
    (audio: Float32Array, sampleRate: number): Float32Array => {
      const phi = (2 * Math.PI * APT_AUDIO_CARRIER) / sampleRate;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      const samples = audio.length;
      const envelope = new Float32Array(samples);
      for (let j = 1; j < samples; j++) {
        const xi = audio[j];
        const prevXi = audio[j - 1];
        const val = Math.sqrt(
          Math.max(0, xi * xi + prevXi * prevXi - 2 * xi * prevXi * cosPhi),
        );
        envelope[j] = val / sinPhi;
      }
      envelope[0] = envelope[1] || 0;

      let maxAmp = 0;
      for (let j = 0; j < samples; j++) maxAmp = Math.max(maxAmp, envelope[j]);
      if (maxAmp > 0) {
        for (let j = 0; j < samples; j++) envelope[j] /= maxAmp;
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
      const baseband = demodulateAPTAudioBaseband(iqData, inputSampleRate, frameCenterFrequencyHz);
      const imageEnvelope = envelopeDetectAPTAudio(baseband, inputSampleRate);
      const detection = detectNaptSpikeCandidates(imageEnvelope);
      setDetectionResult(detection);
      const selected = detection.selectedCandidate;
      let finalAudio = sharedProcessor.process(iqData, inputSampleRate, frameCenterFrequencyHz);
      if (selected) {
        const segment = imageEnvelope.slice(
          selected.startIndex,
          selected.endIndex + 1,
        );
        const maxAmp = segment.reduce(
          (acc, value) => Math.max(acc, Math.abs(value)),
          0,
        );
        if (maxAmp > 0) {
          for (let i = 0; i < finalAudio.length; i++) {
            finalAudio[i] /= maxAmp;
          }
        }
      }
      if (finalAudio.length === 0) {
        processedAudioBufferRef.current = null;
        return;
      }
      processedAudioBufferRef.current = finalAudio;
    },
    [
      demodulateAPTAudioBaseband,
      envelopeDetectAPTAudio,
      resampleAudio,
      sharedProcessor,
    ],
  );

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
    nextStartTimeRef.current = 0;
    setIsPlaying(false);
  }, []);

  const playAudio = useCallback(() => {
    if (
      !processedAudioBufferRef.current ||
      processedAudioBufferRef.current.length === 0
    ) {
      return;
    }
    try {
      const audioContext = getAudioContext();
      if (audioContext.state === "suspended") {
        void audioContext.resume();
      }
      if (processedAudioBufferRef.current.length === 0) return;
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
      const currentTime = audioContext.currentTime;
      if (nextStartTimeRef.current < currentTime + 0.02) {
        nextStartTimeRef.current = currentTime + 0.15;
      }
      const startTime = nextStartTimeRef.current;
      sourceNode.start(startTime);
      nextStartTimeRef.current = startTime + buffer.duration;
      setIsPlaying(true);
    } catch (error) {
      console.error("Error playing APT audio:", error);
      setIsPlaying(false);
    }
  }, [getAudioContext, volume, targetSampleRate]);

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

  return {
    processIQData,
    playAudio,
    stopAudio,
    setVolume,
    isPlaying,
    volume,
    detectionResult,
    detectSpikes,
  };
}
