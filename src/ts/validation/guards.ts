/**
 * Type guard functions for runtime validation
 * Provides safe type checking throughout the application
 */

import type { 
  SpectrumFrame,
  CaptureRequest,
  StatusMessage,
} from "@n-apt/consts/schemas/websocket";
import type { AuthResult } from "@n-apt/services/auth";
import type { SdrProcessorMetadata } from "@n-apt/validation/types";
import { calculateExpectedLatency, calculateTrustLevel } from "@n-apt/validation/types";

// Re-export schema guards
export {
  isValidAuthInfo,
  isValidAuthResult,
  isValidSessionValidation,
  isValidWebSocketMessage,
  isValidStatusMessage,
  isValidSpectrumFrame,
  isValidCaptureRequest,
  isValidCaptureStatus,
  isValidAutoFftOptions,
} from "@n-apt/validation/schemas";

// Import base functions for enhanced validation
import {
  isValidWebSocketMessage as baseIsValidWebSocketMessage,
  isValidStatusMessage as baseIsValidStatusMessage,
  isValidSpectrumFrame as baseIsValidSpectrumFrame,
  isValidCaptureRequest as baseIsValidCaptureRequest,
} from "@n-apt/validation/schemas";

// Basic type guards
export const isString = (value: unknown): value is string => {
  return typeof value === 'string';
};

export const isNumber = (value: unknown): value is number => {
  return typeof value === 'number' && !isNaN(value);
};

export const isBoolean = (value: unknown): value is boolean => {
  return typeof value === 'boolean';
};

export const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

export const isArray = (value: unknown): value is unknown[] => {
  return Array.isArray(value);
};

// Enhanced type guards with validation
export const isValidString = (value: unknown): value is string => {
  return typeof value === 'string';
};

export const isValidStringEnhanced = (value: unknown, minLength = 0, maxLength = Infinity): value is string => {
  return isValidString(value) && value.length >= minLength && value.length <= maxLength;
};

export const isValidNumber = (value: unknown): value is number => {
  return typeof value === 'number' && !isNaN(value);
};

export const isValidNumberEnhanced = (value: unknown, min = -Infinity, max = Infinity): value is number => {
  return isValidNumber(value) && value >= min && value <= max;
};

export const isValidBoolean = (value: unknown): value is boolean => {
  return typeof value === 'boolean';
};

export const isValidObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

export const isValidArray = (value: unknown): value is unknown[] => {
  return Array.isArray(value);
};

export const isValidUint8ClampedArray = (value: unknown): value is Uint8ClampedArray => {
  return value instanceof Uint8ClampedArray;
};

export const isValidFloat32Array = (value: unknown): value is Float32Array => {
  return value instanceof Float32Array;
};

// Basic waterfall data validation
export const validateWaterfallData = (value: unknown, expectedLength?: number): value is Uint8ClampedArray => {
  if (!isValidUint8ClampedArray(value)) return false;
  
  // Check length if expected length is provided (should match width * height * 4 for RGBA)
  if (expectedLength !== undefined && value.length !== expectedLength) {
    return false;
  }
  
  // Validate that all values are in valid range (0-255 for Uint8ClampedArray)
  for (let i = 0; i < value.length; i++) {
    if (value[i] < 0 || value[i] > 255) {
      return false;
    }
  }
  
  return true;
};

// Alias for backward compatibility
export const isValidWaterfallData = validateWaterfallData;

export const validateSpectrumData = (value: unknown, expectedLength?: number): value is Float32Array => {
  if (!isValidFloat32Array(value)) return false;
  
  // Check length if expected length is provided (should match FFT size)
  if (expectedLength !== undefined && value.length !== expectedLength) {
    return false;
  }
  
  // Validate that all values are finite numbers
  for (let i = 0; i < value.length; i++) {
    if (!Number.isFinite(value[i])) {
      return false;
    }
  }
  
  return true;
};

// Alias for backward compatibility
export const isValidSpectrumData = validateSpectrumData;

// Comprehensive validation interface for waterfall data
interface WaterfallValidationOptions {
  width?: number;
  height?: number;
  fftSize?: number;
  sampleRate?: number;
  centerFrequencyHz?: number;
  timestamp?: number;
  isPaused: boolean;
  isFirstFrame: boolean;
}

interface WaterfallValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata: {
    dataPoints: number;
    width?: number;
    height?: number;
    fftSize?: number;
    sampleRate?: number;
    centerFrequencyHz?: number;
    timestamp?: number;
    validationTime: number;
    colorAnalysis: {
      hasColor: boolean;
      minColorValue: number;
      maxColorValue: number;
      averageValue: number;
      zeroPixels: number;
    };
  };
}

// Comprehensive validation for waterfall data on pause and first render
export const validateWaterfallDataComprehensive = (
  data: Uint8ClampedArray,
  options: WaterfallValidationOptions
): WaterfallValidationResult => {
  const startTime = performance.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Basic data validation
  if (!isValidUint8ClampedArray(data)) {
    errors.push('Data is not a Uint8ClampedArray');
    return {
      isValid: false,
      errors,
      warnings,
      metadata: {
        dataPoints: 0,
        validationTime: performance.now() - startTime,
        colorAnalysis: {
          hasColor: false,
          minColorValue: 0,
          maxColorValue: 0,
          averageValue: 0,
          zeroPixels: 0
        }
      }
    };
  }
  
  const dataPoints = data.length;
  
  // Dimension validation
  if (options.width && options.height) {
    const expectedLength = options.width * options.height * 4; // RGBA
    if (dataPoints !== expectedLength) {
      errors.push(`Data length (${dataPoints}) does not match expected dimensions (${options.width}x${options.height} = ${expectedLength})`);
    }
  }
  
  // FFT size validation (if provided)
  if (options.fftSize && options.width) {
    // Waterfall width should typically match or be related to FFT size
    if (options.width !== options.fftSize && options.width !== options.fftSize / 2) {
      warnings.push(`Waterfall width (${options.width}) may not match FFT size (${options.fftSize})`);
    }
  }
  
  // Sample rate validation
  if (options.sampleRate) {
    if (options.sampleRate <= 0) {
      errors.push(`Invalid sample rate: ${options.sampleRate}`);
    }
    if (options.sampleRate > 10_000_000) { // 10 MHz
      warnings.push(`Very high sample rate: ${options.sampleRate} Hz`);
    }
  }
  
  // Frequency validation
  if (options.centerFrequencyHz) {
    if (options.centerFrequencyHz <= 0) {
      errors.push(`Invalid center frequency: ${options.centerFrequencyHz} Hz`);
    }
    if (options.centerFrequencyHz > 30_000_000_000) { // 30 GHz
      warnings.push(`Very high center frequency: ${options.centerFrequencyHz} Hz`);
    }
  }
  
  // Timestamp validation
  if (options.timestamp) {
    const now = Date.now();
    const timestampMs = options.timestamp;
    
    if (Math.abs(timestampMs - now) > 60000) { // More than 1 minute off
      warnings.push(`Timestamp is significantly off: ${new Date(timestampMs).toISOString()}`);
    }
    
    if (timestampMs > now + 5000) { // More than 5 seconds in future
      errors.push(`Timestamp is in the future: ${new Date(timestampMs).toISOString()}`);
    }
  }
  
  // Color data analysis
  let hasColor = false;
  let minColorValue = 255;
  let maxColorValue = 0;
  let totalValue = 0;
  let zeroPixels = 0;
  let alphaChannelIssues = 0;
  
  // Analyze RGBA data
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    // Check alpha channel
    if (a !== 255) {
      alphaChannelIssues++;
    }
    
    // Check for color (non-black pixels)
    if (r > 0 || g > 0 || b > 0) {
      hasColor = true;
    }
    
    // Check for completely black pixels
    if (r === 0 && g === 0 && b === 0) {
      zeroPixels++;
    }
    
    // Update color statistics
    const maxValue = Math.max(r, g, b);
    const minValue = Math.min(r, g, b);
    const avgValue = (r + g + b) / 3;
    
    minColorValue = Math.min(minColorValue, minValue);
    maxColorValue = Math.max(maxColorValue, maxValue);
    totalValue += avgValue;
  }
  
  const averageValue = data.length > 0 ? totalValue / (data.length / 4) : 0;
  
  // Color validation
  if (alphaChannelIssues > 0) {
    warnings.push(`Found ${alphaChannelIssues} pixels with non-255 alpha values`);
  }
  
  if (!hasColor) {
    warnings.push('Waterfall contains no color data - completely black');
  } else if (zeroPixels > (data.length / 4) * 0.8) {
    warnings.push(`High percentage of black pixels: ${((zeroPixels / (data.length / 4)) * 100).toFixed(1)}%`);
  }
  
  // Dynamic range validation
  if (hasColor) {
    const dynamicRange = maxColorValue - minColorValue;
    if (dynamicRange === 0) {
      warnings.push('No dynamic range in waterfall colors');
    } else if (dynamicRange < 10) {
      warnings.push(`Very low color dynamic range: ${dynamicRange}`);
    }
  }
  
  // Context-specific validation
  if (options.isPaused) {
    // When paused, we expect consistent, complete data
    if (errors.length === 0 && warnings.length === 0) {
      // Perfect data when paused - this is good!
    }
    
    if (!hasColor) {
      errors.push('Waterfall is completely black when paused - possible data issue');
    }
  }
  
  if (options.isFirstFrame) {
    // First frame might have initialization issues
    if (!hasColor) {
      warnings.push('First frame contains no color - waterfall may be initializing');
    }
  }
  
  const validationTime = performance.now() - startTime;
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    metadata: {
      dataPoints,
      width: options.width,
      height: options.height,
      fftSize: options.fftSize,
      sampleRate: options.sampleRate,
      centerFrequencyHz: options.centerFrequencyHz,
      timestamp: options.timestamp,
      validationTime,
      colorAnalysis: {
        hasColor,
        minColorValue,
        maxColorValue,
        averageValue,
        zeroPixels
      }
    }
  };
};
interface SpectrumValidationOptions {
  fftSize?: number;
  sampleRate?: number;
  centerFrequencyHz?: number;
  timestamp?: number;
  isPaused: boolean;
  isFirstFrame: boolean;
}

interface SpectrumValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata: {
    dataPoints: number;
    fftSize?: number;
    sampleRate?: number;
    centerFrequencyHz?: number;
    timestamp?: number;
    validationTime: number;
  };
}

// Comprehensive validation for pause and first render scenarios
export const validateSpectrumDataComprehensive = (
  data: Float32Array,
  options: SpectrumValidationOptions
): SpectrumValidationResult => {
  const startTime = performance.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Basic data validation
  if (!isValidFloat32Array(data)) {
    errors.push('Data is not a Float32Array');
    return {
      isValid: false,
      errors,
      warnings,
      metadata: {
        dataPoints: 0,
        validationTime: performance.now() - startTime
      }
    };
  }
  
  const dataPoints = data.length;
  
  // FFT size validation
  if (options.fftSize && dataPoints !== options.fftSize) {
    errors.push(`Data length (${dataPoints}) does not match expected FFT size (${options.fftSize})`);
  }
  
  // Power of two validation (FFT sizes should be powers of 2)
  if (dataPoints > 0 && (dataPoints & (dataPoints - 1)) !== 0) {
    warnings.push(`Data length (${dataPoints}) is not a power of 2, unusual for FFT data`);
  }
  
  // Sample rate validation
  if (options.sampleRate) {
    if (options.sampleRate <= 0) {
      errors.push(`Invalid sample rate: ${options.sampleRate}`);
    }
    if (options.sampleRate > 10_000_000) { // 10 MHz
      warnings.push(`Very high sample rate: ${options.sampleRate} Hz`);
    }
  }
  
  // Frequency validation
  if (options.centerFrequencyHz) {
    if (options.centerFrequencyHz <= 0) {
      errors.push(`Invalid center frequency: ${options.centerFrequencyHz} Hz`);
    }
    if (options.centerFrequencyHz > 30_000_000_000) { // 30 GHz
      warnings.push(`Very high center frequency: ${options.centerFrequencyHz} Hz`);
    }
  }
  
  // Timestamp validation
  if (options.timestamp) {
    const now = Date.now();
    const timestampMs = options.timestamp;
    
    if (Math.abs(timestampMs - now) > 60000) { // More than 1 minute off
      warnings.push(`Timestamp is significantly off: ${new Date(timestampMs).toISOString()}`);
    }
    
    if (timestampMs > now + 5000) { // More than 5 seconds in future
      errors.push(`Timestamp is in the future: ${new Date(timestampMs).toISOString()}`);
    }
  }
  
  // Data quality validation
  let infiniteValues = 0;
  let nanValues = 0;
  let zeroValues = 0;
  let maxValue = -Infinity;
  let minValue = Infinity;
  
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    
    if (!Number.isFinite(value)) {
      if (Number.isNaN(value)) {
        nanValues++;
      } else {
        infiniteValues++;
      }
    } else {
      if (value === 0) zeroValues++;
      if (value > maxValue) maxValue = value;
      if (value < minValue) minValue = value;
    }
  }
  
  if (infiniteValues > 0) {
    errors.push(`Found ${infiniteValues} infinite values in spectrum data`);
  }
  
  if (nanValues > 0) {
    errors.push(`Found ${nanValues} NaN values in spectrum data`);
  }
  
  if (zeroValues === data.length) {
    warnings.push('All spectrum values are zero - possible signal issue');
  } else if (zeroValues > data.length * 0.5) {
    warnings.push(`High percentage of zero values: ${((zeroValues / data.length) * 100).toFixed(1)}%`);
  }
  
  // Dynamic range validation
  if (Number.isFinite(maxValue) && Number.isFinite(minValue)) {
    const dynamicRange = maxValue - minValue;
    if (dynamicRange === 0) {
      warnings.push('No dynamic range in spectrum data');
    } else if (dynamicRange < 1) {
      warnings.push(`Very low dynamic range: ${dynamicRange.toFixed(3)} dB`);
    } else if (dynamicRange > 200) {
      warnings.push(`Very high dynamic range: ${dynamicRange.toFixed(1)} dB - possible gain issue`);
    }
  }
  
  // Context-specific validation
  if (options.isPaused) {
    // When paused, we expect consistent data
    if (errors.length === 0 && warnings.length === 0) {
      // Perfect data when paused - this is good!
    }
  }
  
  if (options.isFirstFrame) {
    // First frame might have initialization issues
    if (zeroValues === data.length) {
      warnings.push('First frame contains all zeros - device may be initializing');
    }
  }
  
  const validationTime = performance.now() - startTime;
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    metadata: {
      dataPoints,
      fftSize: options.fftSize,
      sampleRate: options.sampleRate,
      centerFrequencyHz: options.centerFrequencyHz,
      timestamp: options.timestamp,
      validationTime
    }
  };
};

export const isValidFrequency = (value: unknown): value is number => {
  return isValidNumberEnhanced(value, 0, 30_000_000_000); // 0-30 GHz in Hz units
};

export const isValidTimestamp = (value: unknown): value is number => {
  return isValidNumberEnhanced(value, 0, Date.now() + 86400000); // Not too far in future
};

// Data integrity guards
export const hasValidIntegrity = (data: unknown): data is SdrProcessorMetadata => {
  if (!isObject(data)) return false;
  
  const metadata = data as SdrProcessorMetadata;
  
  // Check integrity if present
  if (metadata.integrity) {
    const { trustLevel, checksum } = metadata.integrity;
    if (!['high', 'medium', 'low'].includes(trustLevel)) return false;
    if (checksum !== undefined && !isValidString(checksum)) return false;
  }
  
  // Check latency if present
  if (metadata.latency) {
    const { expectedLatency, processingTimeMs } = metadata.latency;
    if (!['none', 'normal', 'high'].includes(expectedLatency)) return false;
    if (processingTimeMs !== undefined && !isValidNumberEnhanced(processingTimeMs, 0)) return false;
  }
  
  return true;
};

// WebSocket message guards with enhanced validation
export const isValidWebSocketMessageWithIntegrity = (data: unknown): boolean => {
  if (!baseIsValidWebSocketMessage(data)) return false;
  
  // Add integrity checks for SDR processor messages
  if (isObject(data)) {
    const messageData = data as { type: unknown };
    if (messageData.type === 'settings' || messageData.type === 'capture') {
      return hasValidIntegrity(data);
    }
  }
  
  return true;
};

// Spectrum frame validation
export const isValidSpectrumFrameEnhanced = (data: unknown): data is SpectrumFrame => {
  if (!baseIsValidSpectrumFrame(data)) return false;
  
  // Additional validation
  const frame = data as SpectrumFrame;
  return (
    isValidStringEnhanced(frame.id, 1, 100) &&
    isValidStringEnhanced(frame.label, 1, 200) &&
    isValidFrequency(frame.min_hz) &&
    isValidFrequency(frame.max_hz) &&
    frame.max_hz > frame.min_hz &&
    isValidStringEnhanced(frame.description, 0, 500)
  );
};

// Capture request validation
export const isValidCaptureRequestEnhanced = (data: unknown): data is CaptureRequest => {
  if (!baseIsValidCaptureRequest(data)) return false;
  
  // Additional validation
  const request = data as CaptureRequest;
  return (
    isValidStringEnhanced(request.jobId, 1, 100) &&
    isValidArray(request.fragments) &&
    request.fragments.length > 0 &&
    request.fragments.every((frag: unknown) => 
      isObject(frag) && 
      isValidFrequency((frag as any).minFreq) && 
      isValidFrequency((frag as any).maxFreq) &&
      (frag as any).maxFreq > (frag as any).minFreq
    ) &&
    isValidNumberEnhanced(request.durationS, 0.1, 3600) && // 0.1s to 1 hour
    isValidNumberEnhanced(request.fftSize, 64, 65536) && // Reasonable FFT sizes
    isValidStringEnhanced(request.fftWindow, 1, 50)
  );
};

// Status message validation
export const isValidStatusMessageEnhanced = (data: unknown): data is StatusMessage => {
  if (!baseIsValidStatusMessage(data)) return false;
  
  // Additional validation - be more lenient with optional fields
  const status = data as StatusMessage;
  return (
    // Only validate device_info if it exists and is not empty
    (!status.device_info || isValidStringEnhanced(status.device_info, 0, 1000)) &&
    // Only validate device_name if it exists and is not empty  
    (!status.device_name || isValidStringEnhanced(status.device_name, 0, 500)) &&
    // More lenient sample rate validation (allow up to 100MHz for modern SDRs)
    (!status.max_sample_rate || isValidNumberEnhanced(status.max_sample_rate, 1000, 100000000)) &&
    // Only validate channels if they exist
    (!status.channels || isValidArray(status.channels)) &&
    // Don't require enhanced validation for channels to avoid circular validation issues
    true
  );
};

// Authentication response validation
export const isValidAuthResponse = (response: unknown): response is AuthResult => {
  if (!isValidObject(response)) return false;
  
  const result = response as unknown as AuthResult;
  return (
    isValidStringEnhanced(result.token, 10, 1000) &&
    isValidNumberEnhanced(result.expires_in, 1, 86400) // 1 second to 24 hours
  );
};

// Session token validation
export const isValidSessionToken = (token: unknown): token is string => {
  return isValidStringEnhanced(token, 20, 500) && /^[a-zA-Z0-9+/=_-]+$/.test(token);
};

// Error validation
export const isValidError = (error: unknown): error is { message: string; code?: string } => {
  if (!isValidObject(error)) return false;
  const err = error as { message?: string; code?: unknown };
  return isValidStringEnhanced(err.message, 1, 1000) && (err.code === undefined || isValidStringEnhanced(err.code, 1, 50));
};

// Helper function to add integrity metadata
export function addIntegrityMetadata<T extends Record<string, any>>(
  data: T,
  source: string,
  fftSize?: number,
  processingTimeMs?: number
): T & SdrProcessorMetadata {
  const isValid = true; // In real implementation, this would be actual validation result
  
  return {
    ...data,
    integrity: {
      trustLevel: calculateTrustLevel(source, isValid),
      // checksum: calculateChecksum(data), // Optional: implement if needed
    },
    latency: {
      expectedLatency: calculateExpectedLatency(fftSize),
      processingTimeMs,
    },
  };
}

// Helper function to validate and extract safe data
export function validateAndExtract<T>(data: unknown, validator: (data: unknown) => data is T): T | null {
  return validator(data) ? data : null;
}

// Performance-conscious validation for high-frequency data
export function quickValidate(data: unknown, requiredFields: string[]): boolean {
  if (!isObject(data)) return false;
  
  return requiredFields.every(field => field in data);
}

// Batch validation for arrays
export function validateArray<T>(
  items: unknown[],
  validator: (item: unknown) => item is T
): { valid: T[]; invalid: unknown[] } {
  const valid: T[] = [];
  const invalid: unknown[] = [];
  
  for (const item of items) {
    if (validator(item)) {
      valid.push(item);
    } else {
      invalid.push(item);
    }
  }
  
  return { valid, invalid };
}
