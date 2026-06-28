# Tx Slider Message Flow & Logging Updates

This document outlines updates to backend transmit logging and frontend throttling behavior.

## Changes Implemented

### 1. Backend: Disabled Global Tx Logging
- Modified `src/rs/server/tx_log.rs` to comment out the body of `write_global`.
- This temporarily disables all global transmit logging (`tx_log.txt` entries) on the backend server, completely removing hot-path file I/O overhead without modifying log entry creation sites or structural code.

### 2. Frontend: Reverted Throttling
- Restored `src/ts/redux/middleware/websocketMiddleware.ts` to its original state (removed `tx_mode` message throttling).
- Restored `src/ts/hooks/useSpectrumStore.tsx` transmit settings sync throttle limit back to `50ms` (from `100ms`).
