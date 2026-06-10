# Tx Slider Loading Render Fix

## Problem
On load, when the spectrum display is awaiting signal data (e.g., initial connection, initializing placeholder state), the Tx slider would not render despite being enabled.

There were two concurrent issues causing this:
1. **Early Return in `onRenderFrame`**: The main rendering loop in `FFTCanvas` checks whether the visualizer has a renderable frame or cached waveform, and if not, returns early. The early return cleared the overlay canvas but did not call `drawTxSliderOnContext`, leaving the Tx slider completely invisible until the first live frame arrived.
2. **Missing Resize useEffect Dependencies**: When the overlay canvases first mount, they transition from `null` to DOM canvas nodes. However, the resize `useEffect` (which is responsible for computing the logical dimensions, setting the DPR scaling factor, and setting context scale/transforms on the overlay canvas) did not have `spectrumOverlayCanvasNode` or other canvas nodes in its dependency array. As a result, when the overlay canvas mounted, its `width` and `height` properties were never initialized (remaining at the default 300x150), preventing any shapes from drawing correctly in the correct bounds.

## Solution
1. **Support Drawing in Early Returns**: Modified the early-return block in `FFTCanvas.tsx`'s `onRenderFrame` to retrieve the 2D rendering context from the spectrum overlay canvas and draw the Tx slider even when the visualizer is loading or in an error state.
2. **Synchronize Canvas Dimensions**: Updated the dependency array of the resize `useEffect` in `FFTCanvas.tsx` to include `spectrumOverlayCanvasNode`, `waterfallGpuCanvasNode`, and `waterfallOverlayCanvasNode`. This ensures that when the overlay canvases mount, the resize handler executes immediately to set their logical width, height, CSS styles, and DPR context transform.

This ensures the Tx slider is immediately dimensioned, rendered, and interactive upon application load, even before any signal data is received from the backend.

## Verification
- Verified code correctness via typescript compiling with `npm run typecheck` which completed successfully.
- Ran the unit tests suite for `FFTCanvas` with `npx jest test/ts/FFTCanvas.test.tsx`, all 11 tests passed successfully.
