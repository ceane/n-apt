# Frame Rate Relocation and Settings Sync Fixes

## Problem
1. **Frame Rate Capping**: With higher sample rates (e.g. in "Whole Channel" mode), the frontend capped the max frame rate to `12` fps (when FFT size is `262144`) or similar low values, because it calculated the max frame rate using the hardcoded hardware maximum sample rate (`3.2MHz` for mock) instead of the *current active* sample rate (`18.25MHz`).
2. **LocalStorage Loop**: The frontend loaded cached SDR settings from localStorage/sessionStorage on startup, which prematurely triggered the initialization effect in `useSpectrumStore.tsx` and blocked the real backend defaults from being absorbed once connected. The Redux cache was also never updated during the active WebSocket session because the status messages didn't dispatch the status updates to Redux.

## Solutions

### 1. Frame Rate Relocation & Active Calculation
- Relocated frame rate cap logic (`MAX_SCREEN_REFRESH_RATE = 60`, `computeMaxFrameRate`, `getLogicalSizeToFrameRate`, and `getLogicalMaxFrameRate`) to [signals.ts](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/utils/signals.ts).
- Updated [useSdrSettings.ts](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/hooks/useSdrSettings.ts) to calculate the max frame rate and perform coupled adjustments using the current active sample rate (`state.sampleRateHz` / `stateRef.current.sampleRateHz`).
- Enhanced `getLogicalMaxFrameRate` to dynamically fallback to `computeMaxFrameRate(sampleRate, fftSize)` if the backend settings' sample rate is not in sync with the active frontend sample rate yet, resolving lag on change.

### 2. Synchronization Loop Fix
- Reset the initialization flag (`hasInitializedBackendSettingsRef.current = false`) in [useSpectrumStore.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/hooks/useSpectrumStore.tsx) when `isConnected` transitions to `true`.
- Conditioned the default settings absorption effect on `isConnected` being `true` so it only runs when connected to the real WebSocket backend.
- Updated the WebSocket settings caching effect in `useSpectrumStore.tsx` to write to `localStorage` under `"napt-sdr-settings"` and dispatch `updateDeviceState` to the Redux store whenever a status update is received, keeping the caches and store in sync.
- Handled TS type checks by casting `sdrSettings` to `any` during the dispatch.

## Verification
- TypeScript type checking: `npm run typecheck` (Passed).
- Jest test suite: `npm test` (Passed).
