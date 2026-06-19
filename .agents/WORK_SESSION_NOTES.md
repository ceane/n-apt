# Work Session Notes - Ring Buffer GC Fix

## Problem
The waterfall history was not persisting when returning to a device or switching devices. This occurred due to a bug in `useSharedBufferManager.ts` where active ring buffers were incorrectly garbage collected. 

## Root Cause
The garbage collection routine checked:
```typescript
if (
  now - ringBuffer.writeIndex > maxAge &&
  now - ringBuffer.readIndex > maxAge
) {
  ringBuffersToDelete.push(id);
}
```
However, `writeIndex` and `readIndex` represent buffer positions (integers like `0` to `capacity`), not timestamps. Subtracting them from the current timestamp `performance.now()` meant that after 60 seconds of page load time, the condition would always evaluate to true, destroying active ring buffers.

## Fix
1. Added `lastAccessed: number` to the `RingBuffer` interface.
2. Initialized `lastAccessed` with `performance.now()` in `createRingBuffer`.
3. Updated `lastAccessed` during writes (`writeToRingBuffer`) and reads (`readFromRingBuffer`).
4. Updated `performGarbageCollection` to check `now - ringBuffer.lastAccessed > maxAge`.

## Validation
- Successfully ran typecheck.
- Verified that `test/ts/waterfallRestore.test.ts` passes.
