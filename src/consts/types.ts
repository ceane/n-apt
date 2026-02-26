/**
 * Shared types for FFT/Waterfall rendering
 */

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
export function spectrumToAmplitude(spectrum: number[], minDb: number, maxDb: number): number[] {
  return spectrum.map((db) => {
    const normalized = (db - minDb) / (maxDb - minDb);
    return Math.max(0, Math.min(1, normalized));
  });
}
