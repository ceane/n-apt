# Bug Fix: Tx Power & VGA Gain Input Lockout in Sidebar

We resolved the issue where users were locked at `-18dBm` and could not change the value in the transmit settings.

## Root Cause
In `TxSettingsSection.tsx`, the local state variables `localPower` and `localVgaGain` were being reset/overwritten by the incoming parent props (`powerDbm`, `vgaGainDb`) via `useEffect` whenever the manual focus ref `isPowerFocusedRef.current` / `isVgaGainFocusedRef.current` was `false`. Due to React component updates triggered by real-time WebSocket spectrum frames or parent state changes, the manual event-listener-based ref update cycle would desynchronize or reset during rendering, causing the input field to overwrite the user's keystrokes back to `-18`.

## Solution
1. **Direct DOM Focus Comparison**:
   - Replaced manual event-driven focus refs (`isPowerFocusedRef`, `isVgaGainFocusedRef`) with actual input element refs (`powerInputRef`, `vgaGainInputRef`).
   - Replaced focus checks in `useEffect` hooks with synchronous DOM checks: `document.activeElement !== powerInputRef.current` and `document.activeElement !== vgaGainInputRef.current`.
   - This ensures focus status is retrieved directly and synchronously from the browser, completely immune to React render cycle timing or event ordering.

2. **Clean Up Event Handlers**:
   - Removed `onFocus` event handlers from `<NumericInput>` elements.
   - Simplified `onBlur` event handlers to only handle parsing, boundary validation, and committing the values to the Redux store.

## Verification Status
- **Typecheck**: `npm run typecheck` passes with `0` errors.
- **Jest Tests**: `npm test` passes all tests.
- **Linting**: `npm run lint` completes with `0` errors.
