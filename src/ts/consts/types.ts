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
  confidence: number;
  matchRate: number;
  snrDelta: string;
  summary: string;
}

export interface AnalysisSession {
  state: 'idle' | 'capturing' | 'analyzing' | 'result';
  type?: 'audio' | 'internal' | 'speech' | 'vision' | 'apt';
  startTime?: number;
  countdown?: number; // 3, 2, 1...
  result?: CaptureResult;
  scriptContent?: string; // Content of the script for analysis
  mediaContent?: string; // Base64 encoded media content (e.g., image, video frame)
  baselineVector?: number[]; // Vector representation of the baseline media/script
  aptProgress?: number; // APT analysis progress (0.0 to 1.0)
  aptStage?: string; // Current APT processing stage
}

export type AnalysisType = 'audio' | 'internal' | 'speech' | 'vision' | 'apt';
export type AnalysisSessionState = 'idle' | 'capturing' | 'analyzing' | 'result';

export interface FrequencyRange {
  min: number;
  max: number;
}

export interface SpectrumRenderOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  waveform: number[];
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
  spectrum: number[],
  minDb: number,
  maxDb: number,
): number[] {
  return spectrum.map((db) => {
    const normalized = (db - minDb) / (maxDb - minDb);
    return Math.max(0, Math.min(1, normalized));
  });
}
