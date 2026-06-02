# Feature Completion Summary: RTL-SDR & Active Source Fixes

## 1. RTL-SDR Sample Rate Limits
- Enforced a strict 3.2MHz limit on RTL-SDR sample rates in `signals.yaml`, backend driver logic (`device.rs`), and option constraints validation (`utils.rs`).
- Added unit tests to verify options resolution for RTL-SDR returns exactly `[3_200_000]`.

## 2. Active Source State Propagation
- Introduced a new `active_source` WebSocket payload message containing the source ID and active mode.
- Sent initial active source state on client connection setup and broadcast updates on device status changes or pauses.
- Implemented frontend schema checks, Zod validation schemas (`schemas.ts`), guards (`guards.ts`), and Redux middleware integration (`websocketMiddleware.ts`) to parse the payload and update `activeSourceId` and `activeSourceMode`.
- Fixed pre-existing failing validation tests (status update structure, spectrum frame range validations, and capture request durationMode parameters).
- Formatted, linted, and verified the entire codebase with cargo check, sequential cargo tests (`--test-threads=1`), typecheck, and Jest/Vitest tests.
