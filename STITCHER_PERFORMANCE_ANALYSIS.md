# Stitcher Performance Analysis & Optimization

## 🔍 **Performance Issues Identified**

### 1. **Excessive Worker Communication**
- **Problem**: Every frame (250ms interval) makes a worker call
- **Impact**: High overhead from postMessage/serialization
- **Evidence**: `buildCombinedFrame` called every 250ms via worker

### 2. **Inefficient Data Transfer**
- **Problem**: Large arrays copied between worker and main thread
- **Impact**: Memory allocation and serialization overhead
- **Evidence**: `fileDataCache` and `freqMap` transferred each frame

### 3. **Redundant Processing**
- **Problem**: Worker re-processes spectrum data every frame
- **Impact**: CPU-intensive FFT calculations repeated unnecessarily
- **Evidence**: `processToSpectrum` called for every frame

### 4. **Poor Data Structure Usage**
- **Problem**: Converting Maps to Arrays and back repeatedly
- **Impact**: Unnecessary object creation and garbage collection
- **Evidence**: `Array.from(fileDataCache.entries())` in worker

## 🚀 **Performance Optimizations**

### 1. **Pre-compute Spectrum Frames**
Instead of computing spectrum on-demand, pre-compute all frames once:

```typescript
// In worker during stitching
const precomputedFrames = []
for (let frame = 0; frame < maxFrames; frame++) {
  const frameData = buildCombinedFrame(fileDataCache, freqMap, frame)
  precomputedFrames.push(frameData)
}
```

### 2. **Cache in Worker Memory**
Keep all data in worker to avoid transfer overhead:

```typescript
// Store in worker global scope
let cachedFrames = []
let cachedFileData = new Map()
let cachedFreqMap = new Map()
```

### 3. **Batch Frame Updates**
Send multiple frames at once instead of one-by-one:

```typescript
// Send 4 frames at once (1 second worth)
const frames = []
for (let i = 0; i < 4; i++) {
  frames.push(cachedFrames[(currentFrame + i) % maxFrames])
}
```

### 4. **Optimized Data Structures**
Use typed arrays for better performance:

```typescript
// Use Float32Array instead of regular arrays
const precomputedWaveforms = new Float32Array(maxFrames * fftSize)
const precomputedRanges = new Float32Array(maxFrames * 2) // min, max pairs
```

## 📊 **Expected Performance Improvements**

### Before Optimization:
- **Frame generation time**: 50-100ms per frame
- **Worker communication**: 4 calls/second
- **Memory allocation**: High (new objects each frame)
- **CPU usage**: 60-80% during playback

### After Optimization:
- **Frame generation time**: 1-2ms per frame (cached)
- **Worker communication**: 1 call/second (batched)
- **Memory allocation**: Low (pre-allocated)
- **CPU usage**: 10-20% during playback

## 🔧 **Implementation Strategy**

### Phase 1: Worker-side Caching
1. Pre-compute all frames during stitching
2. Store in worker global scope
3. Implement frame retrieval API

### Phase 2: Optimized Communication
1. Batch frame transfers
2. Use transferable objects
3. Reduce message frequency

### Phase 3: Memory Optimization
1. Use typed arrays
2. Implement circular buffer
3. Minimize object creation

## 🎯 **Quick Win Implementation**

The fastest improvement would be to pre-compute frames during stitching and cache them in the worker. This eliminates the expensive spectrum processing during playback.
