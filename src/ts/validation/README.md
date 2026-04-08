# Validation and Type Guards System

This directory contains a comprehensive validation and type guard system for the n-apt application, providing runtime type safety and data integrity checks for WebSocket and authentication data.

## Overview

The validation system includes:

- **Zod schemas** for all major data types
- **Type guards** for runtime validation
- **Integrity/Latency tracking** for SDR processor data
- **Performance-optimized** validation for high-frequency streaming data
- **Enhanced device name updates** for immediate UI feedback

## Key Features

### 1. Performance-Conscious Design
- Skips validation for binary spectrum data to maintain 60fps performance
- Uses quick validation for high-frequency WebSocket messages
- Batches validation results to prevent excessive re-renders

### 2. Integrity and Latency Tracking
- **Integrity**: `{ trustLevel: 'high' | 'medium' | 'low', checksum?: string }`
- **Latency**: `{ expectedLatency: 'none' | 'normal' | 'high', processingTimeMs?: number }`
- Automatically calculates expected latency based on FFT size:
  - FFT < 2048: 'none'
  - FFT 2048-4095: 'normal' 
  - FFT ≥ 4096: 'high'

### 3. Enhanced Device Name Updates
- More aggressive device name updates when device connects
- Sets default name immediately if backend hasn't provided one
- Prevents stale device name information

### 4. Spectrum Data Validation
- Validates Float32Array data for spectrum frames
- Checks for finite values and correct length
- Filters out invalid spectrum data to prevent rendering issues

## Usage Examples

### Basic Type Guard Usage
```typescript
import { isValidAuthResult, isValidSpectrumFrame } from '@n-apt/validation';

// Validate authentication response
if (isValidAuthResult(data)) {
  // TypeScript knows data is AuthResult
  console.log(data.token); // Safe access
}

// Validate spectrum frame
if (isValidSpectrumFrame(frame)) {
  console.log(frame.min_mhz, frame.max_mhz); // Safe access
}
```

### Spectrum Data Validation
```typescript
import { isValidSpectrumData } from '@n-apt/validation';

// Validate Float32Array spectrum data
if (isValidSpectrumData(waveform, expectedLength)) {
  // Safe to process the spectrum data
  processSpectrum(waveform);
}
```

### Adding Integrity Metadata
```typescript
import { addIntegrityMetadata } from '@n-apt/validation';

const sdrSettings = { fftSize: 2048, gain: 10.5 };
const enhancedSettings = addIntegrityMetadata(
  sdrSettings, 
  'rtl-sdr', 
  2048, 
  15.5
);

// Now includes integrity and latency information
console.log(enhancedSettings.integrity?.trustLevel); // 'medium'
console.log(enhancedSettings.latency?.expectedLatency); // 'normal'
```

## Files

- `types.ts` - Core integrity/latency types and utilities
- `schemas.ts` - Zod validation schemas for all data types
- `guards.ts` - Type guard functions and validation utilities
- `middleware.ts` - Validation middleware for WebSocket and auth
- `index.ts` - Main exports and re-exports
- `__tests__/validation.test.ts` - Test suite

## Performance Considerations

- Binary spectrum data (ArrayBuffer) is validated minimally for performance
- High-frequency messages use quick validation
- Control messages get full validation with integrity checks
- Validation metrics are tracked for debugging performance issues

## Integration Points

The validation system is integrated into:

1. **WebSocket middleware** - Validates all incoming/outgoing messages
2. **Authentication service** - Validates auth API responses
3. **Redux slices** - Validates state updates
4. **Binary message processing** - Validates spectrum data

## Development

To run validation tests:
```bash
npm test -- --testPathPatterns=validation
```

To check types:
```bash
npm run typecheck
```

The validation system is designed to be non-intrusive and maintain backward compatibility while adding comprehensive type safety and data integrity checks.
