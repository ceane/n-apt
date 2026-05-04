/**
 * Core validation types for integrity and latency tracking
 * These wrappers are applied to SDR processor types only
 */

export type TrustLevel = 'high' | 'medium' | 'low';

export type ExpectedLatency = 'none' | 'normal' | 'high';

/**
 * Data integrity metadata for SDR processor types
 */
export interface DataIntegrity {
  trustLevel: TrustLevel;
  checksum?: string;
}

/**
 * Latency tracking for async operations
 */
export interface DataLatency {
  expectedLatency: ExpectedLatency;
  processingTimeMs?: number;
}

/**
 * Wrapper interface for SDR processor data with integrity and latency
 */
export interface SdrProcessorMetadata {
  integrity?: DataIntegrity;
  latency?: DataLatency;
}

/**
 * Enhanced SDR processor types with metadata
 */
export interface EnhancedSdrSettings extends SdrProcessorMetadata {
  fftSize?: number;
  fftWindow?: string;
  frameRate?: number;
  gain?: number;
  ppm?: number;
  tunerAGC?: boolean;
  rtlAGC?: boolean;
}

export interface EnhancedSpectrumFrame extends SdrProcessorMetadata {
  id: string;
  label: string;
  min_hz: number;
  max_hz: number;
  description: string;
}

export interface EnhancedCaptureRequest extends SdrProcessorMetadata {
  jobId: string;
  fragments: { minFreq: number; maxFreq: number }[];
  durationS: number;
  fileType: ".napt" | ".wav";
  acquisitionMode: "stepwise" | "interleaved" | "whole_sample";
  encrypted: boolean;
  fftSize: number;
  fftWindow: string;
  geolocation?: any;
  refBasedDemodBaseline?: "audio_hearing" | "audio_internal" | "speech" | "vision";
  liveMode?: boolean;
}

/**
 * Calculate expected latency based on FFT size
 */
export function calculateExpectedLatency(fftSize?: number): ExpectedLatency {
  if (!fftSize) return 'none';
  if (fftSize >= 4096) return 'high';
  if (fftSize >= 2048) return 'normal';
  return 'none';
}

/**
 * Calculate trust level based on data source and validation
 */
export function calculateTrustLevel(source: string, isValidated: boolean): TrustLevel {
  if (source === 'mock_apt' && isValidated) return 'high';
  if (source === 'rtl-sdr' && isValidated) return 'medium';
  return 'low';
}
