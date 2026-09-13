# Spectrum scroll and mirror rendering

The VFO scroll path is a direct view update. Native `WheelEvent` deltas may
include trackpad momentum, but N-APT does not maintain a VFO inertia,
velocity, friction, or animation state. Wheel pixel/line/page units are
normalized at the native handler, and each event is capped at 24 plot pixels
before it becomes a frequency step, with an additional 5 MHz frequency-step
cap for very wide views. A positive wheel delta moves toward higher frequencies;
a negative delta moves toward lower frequencies. Native events are accumulated
into at most one bounded pan calculation per animation frame, so an OS momentum
burst cannot create an unbounded queue of retunes. Each frame update is bounded by the configured
available-spectrum range (30 GHz by default, from `signals.yaml`). With
“Mirror spectrum below 0 Hz” enabled, the signed display may extend below DC,
but the radio remains on a non-negative acquisition range.

Live wheel/drag interaction refs are updated immediately. Canvas repaint is
coalesced to at most one request per animation frame. Redux pan and route/device
fan-out use bounded latest-value schedulers so a trackpad burst does not issue
one React render and socket command per native event; those schedulers must not
gate covered mirror painting or hold a stale FFT row.

The live FFT must obey these rendering invariants:

- A received frame is drawn immediately on its own server-owned axis:
  `center_frequency_hz ± sample_rate / 2`.
- If a VFO request outruns the newest frame, the plot remains on that resident
  frame axis until the next server frame arrives; it must not show a moving
  floor-filled gap toward the requested position.
- An uncovered resident frame is committed as one complete positive or
  reflected server-owned row. Never map it onto the pending DC-crossing axis:
  floor bins that shrink as acknowledgements arrive are a directional
  fill/wipe animation, not valid live spectrum data.
- The renderer must not translate a resident/stale FFT toward a requested VFO
  position while hardware catches up.
- A covered mirror pan may repaint the current authoritative frame immediately.
  If the pending viewport is not covered, keep the complete resident frame on
  its positive or reflected server-owned axis until a covering frame arrives;
  never stretch it into floor-filled islands on the pending axis.
- Mirror mode is presentation-only. Negative display frequencies map through
  `abs(f)` to the positive acquired baseband; they do not create a second
  hardware stream or retune the radio for each scroll tick.
- Device acknowledgements that omit signed display metadata preserve the
  current local mirror pan. Explicit channel-selection actions clear pan; a
  generic device range hydration must not silently reset it to 0 Hz.
- Channel highlighting is derived from the displayed center
  (`hardware VFO center + signed pan`). A negative displayed center must not
  highlight a positive channel, and a nonzero signed pan must not force a stale
  stored channel label.
- Free wheel/drag panning does not select a channel and does not change the
  acquisition sample rate. Only an explicit channel or sample-rate control may
  do that; crossing inferred channel bounds is presentation state, not a
  `Whole Channel` selection.
- Source-scoped SDR settings are authoritative. Caching or bridging them into a
  legacy global settings field must be structurally idempotent and keyed to a
  source-settings change. A legacy/global hydration update must not bounce an
  unchanged source snapshot back into Redux and create an update-depth loop.
- Do not add a retune smear, synthetic transition row, stale-frame offset, or
  other directional animation to this path without an explicit product
  decision and a regression test.

The implementation boundary is the native wheel handler in
`src/ts/features/spectrum/hooks/useFrequencyDrag.ts`, the coordinate contract
in `src/ts/features/spectrum/fft/frameProcessing.ts`, and the WebGPU mapping
in `src/ts/shaders/resample.wgsl`. Regression coverage belongs in
`test/ts/negativeScrollPanRegression.test.tsx`,
`test/ts/frameProcessing.test.ts`, and `test/ts/shaders/resample.test.ts`.
