# WebSocket Validation & Deprecation Warning Fixes

## Problem Description
1. **WebSocket Message Validation Errors**:
   - The Rust backend logged the following warning/errors repeatedly:
     ```
     [2026-06-03T12:06:37Z WARN  n_apt_backend::server::websocket_handlers] Invalid WebSocket message received: source_id: Validation error: regex [{"value": String("")}]
     ```
   - This occurred because on connection / hook mount, the client sent a `signal_display_settings` WebSocket message where `activeSourceId` was initialized to `""` (empty string).
   - In `types.rs`, `source_id: Option<String>` is validated via the `RE_SAFE_ID` regex (`^[a-zA-Z0-9_-]+$`), which requires at least one character. The empty string failed validation, causing validation warnings on the backend.

2. **Node Deprecation Warning**:
   - The Vite dev server running under Node.js logged:
     ```
     (node:47933) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
     ```
   - This warning was captured by the build orchestrator's stderr listener and logged to the console/dashboard dashboard interface under warnings.

---

## Solutions Implemented

### 1. Fixed WebSocket Validation Issues
- Modified [useSpectrumStore.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/ts/hooks/useSpectrumStore.tsx#L1647) to check if `activeSourceId` is truthy before dispatching the `signal_display_settings` message.
- This prevents the client from transmitting `source_id: ""` on startup when the active source is still null/unresolved, eliminating the validation failure logs on the Rust backend.

### 2. Suppressed Node Deprecation Warning
- Modified [build-orchestrator.tsx](file:///Users/ceanelamerez/Documents/codescratch.nosync/n-apt/scripts/build/build-orchestrator.tsx#L2) to prepend `--no-deprecation` to `process.env.NODE_OPTIONS`.
- Since child processes inherit the environment, this automatically disables Node deprecation warnings in Vite and other spawned Node.js tools, keeping the dashboard clean.

---

## Verification
- Ran TypeScript type checking: `npm run typecheck` passed successfully.
- Ran frontend tests: `npm test` successfully completed all 133 suites (942 tests) and shader Vitest tests (31 tests).
- Ran Rust checks: `cargo check` compiled successfully.
