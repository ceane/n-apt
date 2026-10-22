# Whole Channel and fallback continuity — 2026-10-22

Whole Channel now follows each channel while remaining a global mode. Numeric manual rates remain numeric. Startup and channel clicks update rate and VFO bounds together, ignoring stale channel metadata. Restricting the fixed hardware-window clamp to RTL-SDR stops the HackRF/Mock provider and rate hook from repeatedly undoing each other. Stream option updates merge against queued options so center-only updates cannot overwrite pending rates. Receiving-source footers use RX metadata.

Automatic Mock fallback seeds the departing acquisition window and preserves current zoom/pan rather than restoring cached Mock coordinates. Intentional below-DC positioning is retained when mirroring is enabled. The paint path preserves display coordinates while mapping samples on the actual incoming acquisition axis, including transient DC-straddling frames.

## Verification

- 15 focused suites passed: 462 tests passed, one skipped. Includes real provider/slider, queued stream options, middleware fallback, mirrored paint, and property coverage.
- Browser repeated A/B/C selection produced no additional Maximum update depth errors; Whole Channel spectrum filled the VFO span on Mock. Physical unplug fallback was covered through middleware/provider/paint tests, not a controlled hardware test.
- Typecheck reports 11 errors in generated encrypted ML tmp modules; no changed-file errors after fixes.
- Earlier broader vfoMirrorScrollContinuity checks had two upload-count failures exercising an unchanged WebGPU hook; baseline status was not established.

No build, transmission, backend restart, or push performed.
