# Mock TX Loopback and Status Improvements

We resolved the issues preventing the Mock TX Device from correctly transitioning to the transmitting state, updated status formatting, and improved loopback simulation.

## Accomplishments

1. **Modulated Tone for Loopback Leakage**:
   - Updated the loopback simulation in [mod.rs](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/rs/sdr/mock_apt/mod.rs) to generate a modulated APT carrier tone at a 25 kHz offset instead of flat white noise.
   - This ensures the background mock signals continue playing and remain visible on the visualizer while the loopback transmit signal appears clearly as a peak over that spectrum.

2. **Status Formatting**:
   - Modified `formatStatusLabel` in [SourceInput.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/components/sidebar/SourceInput.tsx) to accept an `isMock` flag.
   - Updated it to return `"Transmitting (Mock Tx)"` for mock transmitter devices, correcting the display in the sidebar source pills.

3. **TS Typecheck & Test Compliance**:
   - Fixed a TypeScript type check issue in `test/ts/SpectrumRoute.file-mode.test.tsx` by adding the missing `notificationsSlice` and matching the reducer keys and order of `store.ts` exactly.
   - Fixed a timer type mismatch in `SourceInput.tsx` under the Node/Browser environments.
   - Verified that `npm run typecheck` and `npm test` pass successfully.
