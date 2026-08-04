# Tx Monitor Alignment Design

Date: 2026-08-01
Status: Approved

## Goal

In Mock Tx / Tx mode, the monitor view defaults to the planned Tx carrier. Explicit typed Tx geometry jumps the monitor. The Tx slider updates the planned carrier only and never auto-jumps the monitor (avoids feedback loops). Manual pan is intentional detach.

## Decision

Use **source-tagged monitor jumps**: each geometry update is classified as `slider` | `typed` | `mode-enter` | `user-pan`. Only `typed` and `mode-enter` call `jumpMonitorToTx()`.

## Behavior matrix

| Event | Planned Tx | Monitor view |
| --- | --- | --- |
| Enter Mock Tx / Tx mode | unchanged (or preset) | Jump to planned Tx center; keep current view span |
| Start Tx (default) | unchanged | Jump to planned Tx center so carrier is on-window |
| Tx Options / sidebar typed Center or Bandwidth | Update | Jump to new planned Tx (bandwidth may adjust span) |
| Signal preset that sets geometry | Update | Jump (treat as typed) |
| Tx slider drag (standby or transmitting) | Update center/bandwidth | **No jump** — signal may slide in/out of view |
| FFT scroll / `EditableCenterFrequency` pan | Unchanged | Update monitor only (user detach) |

## Standby preview IQ

- Carrier: planned `txCenterFrequencyHz`
- View: current monitor center / span (`mockMonitorCenterHz` + view sample rate)
- Slider during standby moves planned carrier only (choice A)

## Transmit sync payload

- After user pan (detached): send real `viewCenterHz` + `txCenterHz` (may differ)
- After mode-enter / typed jump / Start Tx default align: send aligned pair
- Slider updates while transmitting: update carrier; keep current monitor view in payload

## Implementation notes

1. Remove the `useEffect` that mirrors every `txCenterFrequencyHz` change into `mockMonitorCenterHz` (feedback loop source).
2. Add a small helper, e.g. `shouldJumpTxMonitor({ source })` / `resolveMockTxTransmitSettings({ alignMonitor })`, covering jump vs passive.
3. Wire:
   - mode-enter / Start Tx default → jump
   - Tx Options Center/Bandwidth + preset geometry → jump
   - slider / `setTxGeometry` from slider → passive
   - `EditableCenterFrequency` / range pan → monitor only
4. Stop treating standby slider as preview VFO (`isFixedTxPreview` slider path that only moved `mockMonitorCenterHz`).

## Non-goals

- Changing HackRF physical TX semantics beyond Mock Tx monitor presentation
- Auto-recentering after every hop tick while user is intentionally panned (hop preview may still set centers explicitly)

## Test plan

- Unit: jump vs passive classification; transmit settings with/without align
- Unit/integration: slider updates `txCenter` without changing monitor center
- Unit: typed center/bandwidth updates both Tx and monitor
- Unit: mode-enter aligns monitor to Tx
- Regression: Start Tx with aligned monitor still shows visible carrier (not noise floor)
