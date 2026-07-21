# Tx Standby & Pause Optimization

## Problem
In Mock APT transmitter mode, when the transmitter went into standby (paused) after a transmission, the visualizer did not preserve the last rendered spectrum/waterfall frames. Instead, it reset to a narrow, blocky artificial preview spike.

Additionally, reducing the Tx bandwidth in the settings did not confine the generated Mock transmit I/Q leakage signal (skirts/noise/shoulders) to the selected bandwidth, causing it to occupy the preset wider bandwidth (e.g. 2.4 MHz).

## Solution
1. Modified [FFTCanvas.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/components/FFTCanvas.tsx) to only generate and display the standby/preview waveform before any real spectrum frame has been rendered (`!hasRenderedSpectrumFrame`).
2. Once a transmission has started and rendered at least one real frame, subsequent standby/pause states do not overwrite the waveform with the preview waveform.
3. The visualizer now correctly preserves and freezes the last rendered spectrum frame and waterfall state when transitioning to standby, acting exactly like a pause.
4. Updated [mod.rs](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/rs/sdr/mock_apt/mod.rs) to read the dynamic transmit sample rate (`TX_SAMPLE_RATE_HZ`) from the safety state.
5. Implemented precise carrier phase calculation (direct `sin_cos`) and band-limited noise/phase-modulation for the simulated transmitter signals (such as `APT`, `noise`, `custom`, and `tone`). This ensures that the transmit leakage signal and its noise shoulders perfectly scale and constrain themselves to the dynamically selected Tx bandwidth.

