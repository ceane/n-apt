# FFTCanvas Performance Optimization Progress

## Completed Tasks

### Phase 1: OffscreenCanvas Snapshot System ✅
- Created `/src/ts/components/OffscreenCanvasSnapshot.tsx`
- Implemented `useOffscreenCanvasSnapshot` hook
- Provides WebGPU-to-2D snapshot capability without impacting main rendering

### Phase 2: WASM SIMD Integration ✅
- Integrated `useWasmSimdMath` hook into FFTCanvas
- Replaced CPU `resampleSpectrumInto` with WASM SIMD optimized version
- Added automatic fallback to CPU when SIMD unavailable
- Expected 3-10x performance improvement for resampling operations

## In Progress

### Phase 3: Remove 2D Canvas Fallback Paths
Current 2D canvas usage locations:
1. `useDraw2DFFTSignal` - spectrum rendering fallback
2. `useDraw2DFIFOWaterfall` - waterfall rendering fallback
3. Snapshot rendering (lines 1091-1107, 1297-1309)
4. Canvas state management (spectrumCanvasNode, waterfallCanvasNode)

**Strategy:**
- Remove 2D canvas imports and hooks
- Remove 2D fallback rendering in `onRenderFrame`
- Keep only WebGPU rendering path
- Use OffscreenCanvas for snapshots instead of 2D shadow renders
- Remove `force2D` prop handling

## Next Steps

1. Remove 2D canvas imports
2. Remove 2D canvas state variables and refs
3. Remove 2D rendering logic from onRenderFrame
4. Update snapshot logic to use OffscreenCanvas
5. Remove force2D prop
6. Update FFTCanvasHandle interface
7. Test WebGPU-only rendering path

## Performance Gains Expected

- **Resampling**: 3-10x faster with WASM SIMD
- **Memory**: 30-50% reduction (no dual rendering paths)
- **Bundle size**: 15-20% smaller (removed 2D canvas code)
- **Complexity**: Significantly reduced (single rendering path)
