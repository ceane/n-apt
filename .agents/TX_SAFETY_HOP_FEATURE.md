# Mock SDR TX Safety & Frequency Hopping Feature

## Overview
We added support for output power clamping (Safety) and frequency hopping (Hop) controls to the TX Settings sidebar panel, backed by a unified WASM/Rust module `safety.rs` and simulated in the mock SDR generator.

## Key Design & Implementation

1. **WASM/Rust Unified Calculations (`src/rs/safety.rs`, `src/ts/utils/safetyWasm.ts`)**:
   - Computes propagation reach distances and determines power limits ($dBm$) for "Person" ($1$m reach), "Room" ($3$m reach) mode, and "Minimum" (device min power reach at $-70.0$ dBm).
   - Interpolates HackRF One VGA gain ($0-47$) and AMP state (on/off) to find the approximate output power.
   - Enforces limits in the WebSocket state and frontend input clamp logic.

2. **Backend Server Integration (`src/rs/server/websocket_handlers.rs`, `src/rs/server/shared_state.rs`)**:
   - Deserializes safety and hop settings from client WS messages.
   - Enforces clamping in `handle_message`: if safety is enabled, clamps the requested VGA gain and turns off AMP if required, updating the thread-safe `SharedState`.
   - If safety is enabled with limit `"min"`, forces VGA gain to `0.0`, AMP to `false`, and clamps `TX_POWER_DBM` to `-70.0`.

3. **Active Settings Sync (`src/ts/components/sidebar/SpectrumSidebar.tsx`)**:
   - Implemented a React `useEffect` hook to dynamically synchronize the client settings with the backend whenever TX parameters change during active transmission.

4. **Frequency Hopping Simulation (`src/rs/sdr/mock_apt/mod.rs`)**:
   - Detects if `TX_TRANSMITTING` is active. If `TX_HOP_ENABLED` is true, it simulates hopping at $X$ Hz by adding a band-limited noise spike across the selected channels (A: 2.204 MHz, B: 27.235 MHz, C: 13.875 MHz) or the frequency range.

5. **UI Panel Controls (`src/ts/components/sidebar/TxSettingsSection.tsx`)**:
   - Refactored `Toggle.tsx` to support custom labels ("On" and "Off").
   - Implemented sidebar fields for signal type ("Hop"), hop rate (Hz), hop start/end inputs, channel selector buttons, safety toggle, and safety limit dropdowns.
   - Replaced separate safety limit rows with a side-by-side Toggle and Select dropdown in the "Safety" row.
   - Toggling Safety to ON immediately sets power to `-70.0` dBm, VGA gain to `0` dB, and turns off AMP.

## Verification
- Checked formatting: TypeScript and Rust formatting are fully compliant.
- Ran tests: all `cargo test` and `npm test` suites pass successfully.
