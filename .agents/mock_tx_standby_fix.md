# Mock Tx Standby Canvas Fix

## Issue
When transitioning from an active source (e.g., Mock APT) to the Mock Tx source, the spectrum visualizer would freeze and continue displaying the last frame of the previous source instead of clearing the canvas.

## Cause
During the switch, the visualizer enters a "standby" state with a non-blocking `top-bar` placeholder. The `FFTCanvas` renderer relies on the `isStandby` prop to explicitly replace the spectrum waveform with a flat line (`FFT_MIN_DB`). 

However, the clearing condition was written as:
```javascript
if (isStandby) {
  if (
    !renderWaveformRef.current ||
    renderWaveformRef.current.length === 0
  ) {
    // Fill with FFT_MIN_DB
  }
}
```
Because the Mock APT source was previously active, `renderWaveformRef.current` was already initialized and full of the previous waveform's data. As a result, the clearing logic was bypassed entirely, and the rAF loop continued re-rendering the old, stale pixels.

## Fix
Introduced a `hasPresentedStandbySpectrumRef` to explicitly track when the standby frame has been painted. The condition now forcibly clears the waveform the first time it enters standby, regardless of the previous render buffer state:
```javascript
if (
  !renderWaveformRef.current ||
  renderWaveformRef.current.length !== effectiveFftSize ||
  !hasPresentedStandbySpectrumRef.current
) {
   // Fill with FFT_MIN_DB
   hasPresentedStandbySpectrumRef.current = true;
}
```
The reference is properly reset to `false` when leaving the standby state or during canvas destruction.
