# Enhanced Spectrum Data Validation

## Overview

Added comprehensive spectrum data validation that activates during **pause** and **first render** scenarios, providing thorough data integrity checks without impacting real-time streaming performance.

## Key Features

### 🎯 **Smart Validation Triggers**
- **Real-time streaming**: Minimal validation (performance optimized)
- **Paused state**: Comprehensive validation with detailed reporting
- **First frame**: Enhanced validation with initialization checks

### 🔍 **Comprehensive Validation Features**

#### **Data Quality Checks**
- ✅ Float32Array type validation
- ✅ Infinite/NaN value detection
- ✅ Zero-value analysis (signal issues)
- ✅ Dynamic range validation
- ✅ Power-of-two FFT size verification

#### **Context Validation**
- ✅ FFT size matching expected size
- ✅ Sample rate sanity checks (0-10 MHz range)
- ✅ Center frequency validation (0-30 GHz range)
- ✅ Timestamp synchronization (±1 minute tolerance)
- ✅ Future timestamp detection (≤5 seconds)

#### **Performance Metrics**
- ⏱️ Validation timing measurement
- 📊 Data point counting
- 📋 Metadata collection

### 🚀 **Performance Optimization**

#### **Real-time Streaming (60fps)**
```typescript
// Minimal validation for performance
if (!isValidSpectrumData(waveform)) {
  console.warn('Invalid spectrum data received, skipping frame');
  return;
}
```

#### **Pause/First Frame (Comprehensive)**
```typescript
// Thorough validation when performance impact is acceptable
const validationResult = validateSpectrumDataComprehensive(waveform, {
  fftSize: 2048,
  sampleRate: 2_048_000,
  centerFrequencyHz: 100000000,
  timestamp: Date.now(),
  isPaused: true,
  isFirstFrame: false
});
```

## Validation Results

### **Successful Validation**
```typescript
{
  isValid: true,
  errors: [],
  warnings: [],
  metadata: {
    dataPoints: 2048,
    fftSize: 2048,
    sampleRate: 2_048_000,
    centerFrequencyHz: 100000000,
    validationTime: 0.234
  }
}
```

### **Validation Issues**
```typescript
{
  isValid: false,
  errors: [
    "Data length (1024) does not match expected FFT size (2048)",
    "Found 3 infinite values in spectrum data"
  ],
  warnings: [
    "Data length (1000) is not a power of 2, unusual for FFT data",
    "Very high sample rate: 20_000_000 Hz"
  ],
  metadata: { ... }
}
```

## Context-Specific Logic

### **Paused State Validation**
- ✅ Expects consistent, high-quality data
- ✅ Comprehensive error reporting
- ✅ Performance measurements for debugging

### **First Frame Validation**
- ✅ Allows for initialization issues
- ⚠️ Warns about all-zero data (device initializing)
- ✅ More lenient error thresholds

### **Real-time Streaming**
- ⚡ Minimal validation overhead
- ✅ Basic type and value checks
- 🚀 Maintains 60fps performance

## Integration Points

### **WebSocket Middleware**
```typescript
// Enhanced validation for pause and first render scenarios
const isPaused = getState().websocket.isPaused;
const isFirstFrame = !liveDataRef.current;

if (isPaused || isFirstFrame) {
  const validationResult = validateSpectrumDataComprehensive(waveform, options);
  if (!validationResult.isValid) {
    console.warn(`Validation failed:`, validationResult.errors);
    return;
  }
}
```

### **Usage Examples**
```typescript
import { validateSpectrumDataComprehensive } from '@n-apt/validation';

// Validate paused spectrum data
const result = validateSpectrumDataComprehensive(spectrumData, {
  fftSize: 2048,
  sampleRate: 2_048_000,
  centerFrequencyHz: 100000000,
  timestamp: Date.now(),
  isPaused: true,
  isFirstFrame: false
});

if (result.isValid) {
  console.log(`Validated ${result.metadata.dataPoints} spectrum points`);
} else {
  console.error('Validation errors:', result.errors);
}
```

## Benefits

1. **🎯 Targeted Validation**: Comprehensive checks when it matters most
2. **⚡ Performance Preserved**: No impact on real-time streaming
3. **🔍 Detailed Diagnostics**: Rich error reporting and metadata
4. **🧠 Context Aware**: Different validation logic for different scenarios
5. **📊 Performance Tracking**: Built-in timing and metrics

## Testing

Comprehensive test suite covering:
- ✅ Basic Float32Array validation
- ✅ FFT size mismatch detection
- ✅ Sample rate validation
- ✅ Frequency range checks
- ✅ Timestamp validation
- ✅ Data quality analysis
- ✅ Context-specific behavior
- ✅ Performance measurement

Run tests: `npm test -- --testPathPatterns=spectrum-validation`

This enhanced validation system provides the perfect balance between data integrity and performance, validating spectrum data thoroughly during natural checkpoints (pause/first render) while maintaining optimal real-time streaming performance.
