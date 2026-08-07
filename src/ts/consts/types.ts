/**
 * Shared types for FFT/Waterfall rendering
 */

/**
 * Types for capture results and analysis sessions
 */

export interface CaptureResult {
  jobId: string;
  naptFilePath?: string;
  isEphemeral: boolean;
  timestamp?: number;
  fileSize?: number;
  duration?: number; // milliseconds
  sampleRateHz?: number;
  centerFrequencyHz?: number;
  confidence: number;
  matchRate: number;
  snrDelta: string;
  summary: string;
}

export interface AnalysisSession {
  state: "idle" | "starting" | "capturing" | "analyzing" | "result";
  type?: "audio" | "internal" | "speech" | "vision" | "apt";
  startTime?: number;
  durationS?: number; // The requested duration in seconds
  sampleRateHz?: number;
  centerFrequencyHz?: number;
  countdown?: number; // 3, 2, 1...
  result?: CaptureResult;
  scriptContent?: string; // Content of the script for analysis
  mediaContent?: string; // Base64 encoded media content (e.g., image, video frame)
  baselineVector?: number[]; // Vector representation of the baseline media/script
  aptProgress?: number; // APT analysis progress (0.0 to 1.0)
  aptStage?: string; // Current APT processing stage
}

export type AnalysisType = "audio" | "internal" | "speech" | "vision" | "apt";
export type AnalysisSessionState =
  | "idle"
  | "starting"
  | "capturing"
  | "analyzing"
  | "result";

export type Alignment = "centered" | "start" | "end";
export interface NaptMetadata {
  sample_rate?: number;
  sample_rate_hz?: number;
  capture_sample_rate_hz?: number;
  hardware_sample_rate_hz?: number;
  channels?: Array<{
    center_freq_hz?: number;
    sample_rate_hz?: number;
    requested_min_freq_hz?: number;
    requested_max_freq_hz?: number;
    frequency_range?: [number, number];
  }>;
  center_frequency?: number;
  center_frequency_hz?: number;
  frequency_range?: [number, number];
  fft?: { size?: number; window?: string };
  format?: string;
  data_format?: string;
  timestamp_utc?: string;
  hardware?: string;
  gain?: number;
  acquisition_mode?: string;
  source_device?: string;
  fft_window?: string;
  tuner_agc?: boolean;
  rtl_agc?: boolean;
  geolocation?: any; // Import GeolocationData if needed, but any for now
}

export interface FrequencyRange {
  min: number;
  max: number;
}

export interface SpectrumRenderOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  waveform: ArrayLike<number>;
  frequencyRange: FrequencyRange;
  fftMin?: number;
  fftMax?: number;
}

export interface SpectrumGridOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  frequencyRange: FrequencyRange;
  fftMin?: number;
  fftMax?: number;
  clearBackground?: boolean;
}

export interface WaterfallRenderOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  waterfallBuffer: Uint8ClampedArray;
}

/**
 * Convert spectrum dB values to normalized amplitude (0-1)
 * @param spectrum - Spectrum data in dB
 * @param minDb - Minimum dB level for normalization
 * @param maxDb - Maximum dB level for normalization
 * @returns Normalized amplitude array
 */
export function spectrumToAmplitude(
  spectrum: ArrayLike<number>,
  minDb: number,
  maxDb: number,
): number[] {
  return Array.from(spectrum, (db) => {
    const normalized = (db - minDb) / (maxDb - minDb);
    return Math.max(0, Math.min(1, normalized));
  });
}
