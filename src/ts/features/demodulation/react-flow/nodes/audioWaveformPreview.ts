import { FFT_MAX_DB, FFT_MIN_DB } from "@n-apt/consts";

export const AUDIO_WATERFALL_FPS = 60;
export const AUDIO_WATERFALL_HEIGHT = 180;
export const AUDIO_WATERFALL_BIN_COUNT = 512;
export const AUDIO_WATERFALL_FREQUENCY_RANGE = {
  min: 0,
  max: 24_000,
} as const;

export const AUDIO_TONE_FREQUENCY_HZ = 440;
export const AUDIO_TONE_WINDOW_SECONDS = 0.02;
export const AUDIO_TONE_WAVEFORM_SAMPLE_COUNT = 96;
export const AUDIO_TONE_ATTACK_SECONDS = 0.1;
export const AUDIO_TONE_PEAK_GAIN = 0.5;
export const AUDIO_TONE_END_GAIN = 0.01;

export type AudioWaveformMode = "traditional" | "fm-waterfall";

export interface SineWaveformSamplesOptions {
  audioTimeSeconds: number;
  frequencyHz?: number;
  sampleCount?: number;
}

/**
 * Samples the same sine phase used by the preview oscillator. The caller
 * supplies AudioContext time, so this contains no independent animation
 * clock or synthetic pulse envelope.
 */
export const createSineWaveformSamples = ({
  audioTimeSeconds,
  frequencyHz = AUDIO_TONE_FREQUENCY_HZ,
  sampleCount = AUDIO_TONE_WAVEFORM_SAMPLE_COUNT,
}: SineWaveformSamplesOptions): Float32Array => {
  const safeSampleCount = Math.max(2, Math.floor(sampleCount));
  const samples = new Float32Array(safeSampleCount);

  for (let index = 0; index < safeSampleCount; index += 1) {
    const progress = index / (safeSampleCount - 1);
    const time = audioTimeSeconds + progress * AUDIO_TONE_WINDOW_SECONDS;
    samples[index] = Math.sin(2 * Math.PI * frequencyHz * time);
  }

  return samples;
};

/** Mirrors the GainNode envelope used by the local tone preview. */
export const getAudioToneGain = (
  audioTimeSeconds: number,
  durationSeconds: number,
): number => {
  if (audioTimeSeconds <= 0) return 0;
  if (audioTimeSeconds < AUDIO_TONE_ATTACK_SECONDS) {
    return (
      (audioTimeSeconds / AUDIO_TONE_ATTACK_SECONDS) * AUDIO_TONE_PEAK_GAIN
    );
  }

  const fadeDuration = Math.max(
    0.001,
    durationSeconds - AUDIO_TONE_ATTACK_SECONDS,
  );
  const fadeProgress = clamp(
    (audioTimeSeconds - AUDIO_TONE_ATTACK_SECONDS) / fadeDuration,
    0,
    1,
  );
  return (
    AUDIO_TONE_PEAK_GAIN *
    Math.pow(AUDIO_TONE_END_GAIN / AUDIO_TONE_PEAK_GAIN, fadeProgress)
  );
};

export interface AudioWaveformFeed {
  getCurrent: () => Float32Array | null;
  subscribe: (listener: (waveform: Float32Array) => void) => () => void;
}

export interface MutableAudioWaveformFeed extends AudioWaveformFeed {
  publish: (waveform: Float32Array) => void;
}

export const createAudioWaveformFeed = (
  initialWaveform: Float32Array,
): MutableAudioWaveformFeed => {
  let currentWaveform: Float32Array | null = initialWaveform;
  const listeners = new Set<(waveform: Float32Array) => void>();

  return {
    getCurrent: () => currentWaveform,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (waveform) => {
      currentWaveform = waveform;
      listeners.forEach((listener) => listener(waveform));
    },
  };
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const gaussian = (distance: number, width: number) =>
  Math.exp(-(distance * distance) / (2 * width * width));

/**
 * Creates a deterministic FM-like spectrum row for the preview-only audio
 * waterfall. These values are dB samples because FIFOWaterfall renders
 * spectrum rows, not time-domain PCM samples.
 */
export const createFmWaterfallFrame = (
  frameIndex: number,
  binCount = AUDIO_WATERFALL_BIN_COUNT,
): Float32Array => {
  const row = new Float32Array(Math.max(1, Math.floor(binCount)));
  const phase = frameIndex * 0.13;
  const carrierPosition = 0.5 + 0.08 * Math.sin(frameIndex * 0.035);
  const sidebandDistance = 0.06 + 0.025 * (0.5 + 0.5 * Math.sin(phase));

  for (let index = 0; index < row.length; index += 1) {
    const position = row.length === 1 ? 0.5 : index / (row.length - 1);
    const carrier = gaussian(position - carrierPosition, 0.012);
    const sidebandLeft = gaussian(
      position - (carrierPosition - sidebandDistance),
      0.018,
    );
    const sidebandRight = gaussian(
      position - (carrierPosition + sidebandDistance),
      0.018,
    );
    const noise =
      0.04 + 0.025 * (0.5 + 0.5 * Math.sin(frameIndex * 0.21 + index * 0.37));
    const intensity = clamp(
      noise + 0.86 * carrier + 0.42 * (sidebandLeft + sidebandRight),
      0,
      1,
    );

    row[index] = FFT_MIN_DB + intensity * (FFT_MAX_DB - FFT_MIN_DB);
  }

  return row;
};
