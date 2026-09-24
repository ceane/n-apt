# N-APT CLI and I/Q Capture Contract

Use this guide when changing `scripts/cli/index.ts`, capture settings, V6
artifacts, source retuning, or CLI/backend protocol behavior.

## Runtime Rules

- Start the development stack separately with `npm run dev`.
- The CLI does not start, stop, or own backend/frontend processes.
- Run network-backed commands only after the required service is ready.
- Keep the control WebSocket open for the full capture lifecycle.
- Do not add I/Q capture data, `.napt`, `.iq`, `.wav`, or `.c64` files to Git.
- Do not use `agent call startCapture` or `agent call stopCapture`; those agent
  surfaces are not an authoritative capture lifecycle.

## Basic Examples

```bash
npm run cli
npm run cli -- --help
npm run cli -- help capture iq
npm run cli -- capture iq --help
npm run cli -- --version
```

List sources as text or versioned JSON:

```bash
npm run cli -- devices
npm run cli -- devices --json
```

Analyze local files without starting the app:

```bash
npm run cli -- signals inspect ./capture.iq --json
npm run cli -- signals spectrum ./capture.iq --json
npm run cli -- signals validate ./capture.iq --json
npm run cli -- signals demod ./raw.iq \
  --output ./demodulated.iq \
  --algorithm fm \
  --sample-rate 2400000
```

Use agent surfaces:

```bash
npm run cli -- agent capabilities --json
npm run cli -- agent markdown --route /visualizer --json
npm run cli -- agent call getDeviceStatus --json
```

## Current Capture Behavior

The current dirty worktree adds concrete preflight options for:

- sample rate;
- FFT size;
- FFT window;
- frame rate.

`--quality-profile` resolves and validates those options before capture. The
backend applies them, reads the processor state back, and emits a job-correlated
`capture_status.started` acknowledgement. The CLI rejects a missing or mismatched
acknowledgement.

`--center-frequency` is the target center for the capture. The backend may retune
to that center and may plan later hops; it is not restricted to the source's
current tuning. A running synchronous CLI invocation does not accept additional
arguments. A user must wait for it to finish or explicitly stop the job through a
future capture-control API.

### Single-window example

For an unambiguous one-window request, use one fragment and
`--acquisition-mode whole_sample`:

```bash
npm run cli -- capture iq \
  --allow-mutations \
  --device mock-apt \
  --center-frequency 137500000 \
  --sample-rate 3200000 \
  --acquisition-mode whole_sample \
  --duration 1 \
  --file-type .iq \
  --output ./mock_apt_1s.iq
```

A full-rate fragment with the default `stepwise` mode can be split into multiple
overlapping hops because the backend plans hops from usable bandwidth. Do not
describe that request as a single continuous window.

### Planned physical retune

```bash
npm run cli -- capture iq \
  --allow-mutations \
  --device rtl-sdr-serial-123 \
  --center-frequency 1618000 \
  --sample-rate 3200000 \
  --acquisition-mode whole_sample \
  --duration 1 \
  --file-type .iq \
  --output ./channel_capture.iq
```

The acknowledgement must eventually report the actually applied first-hop
center, source identity, settings revision, and complete acquisition plan.

### Current limitations

- Rust backend and WebUSB `.iq`/`.napt` artifacts now declare V6 with
  trailer version 2.
- Backend `.iq` and `.napt` both retain frame-update patch history.
- The CLI verifies downloaded size, completed-job SHA-256, embedded integrity,
  V6 metadata, and initial byte-zero patch history before writing the artifact.
- Custom CLI gain/PPM fields are sent but are not currently applied as capture
  settings.
- The acknowledgement is an activation-time snapshot, not a guarantee that other
  clients cannot later mutate the source.
- Retunes can discard physical-device warm-up frames. Do not call a retuned
  recording lossless without persisted continuity/discard evidence.

## What V6 Means Today

V6 is currently a producer/container contract, not a complete backend capture
protocol.

- WebUSB and Rust `.iq`/`.napt` writers use metadata format version 6.
- V6 supports indexed binary data, integrity metadata, and patch/frame-update
  metadata in both producer paths.
- `sample_offset` is a byte offset in both current producers.
- Backend and WebUSB timestamps do not yet share one explicit clock contract.
- Managed-stream `optionsRevision` is a logical stream generation. It is not an
  effective-hardware acknowledgement and is not compare-and-swap concurrency
  control.

CLI downloads may be identified as V6 after completed-job checksum, embedded
integrity, metadata version, and patch-history verification. They are not yet a
source/epoch-safe or fully continuous-lossless protocol.

## Target V6-Aligned CLI Contract

Use one typed settings patch rather than independent per-field restrictions.
CLI flags are ergonomic sugar that produce this patch:

```json
{
  "sourceId": "rtl-sdr-serial-123",
  "expectedSourceEpoch": 42,
  "baseSettingsRevision": 18,
  "patch": {
    "centerFrequencyHz": 1618000,
    "sampleRateHz": 3200000,
    "fftSize": 65536,
    "fftWindow": "hanning",
    "frameRateHz": 48,
    "gainDb": 46.9,
    "ppm": 1,
    "tunerAgc": false,
    "rtlAgc": false
  },
  "formatVersion": 6
}
```

The backend should:

1. Validate the expected source epoch and base settings revision.
2. Acquire an exclusive receiver/capture lease.
3. Apply every changed field atomically.
4. Read back the complete effective state.
5. Plan and verify all retunes/segments.
6. Allocate a capture/settings revision.
7. Emit a strict effective-settings and acquisition-plan acknowledgement.
8. Activate recording only after that acknowledgement.
9. Block source switches and competing settings updates while capture is active.
10. Persist patch/boundary events at exact byte offsets.
11. Restore and acknowledge the complete pre-capture state when requested.

The CLI should require an acknowledgement such as:

```json
{
  "status": "started",
  "jobId": "cli_...",
  "captureToken": "...",
  "sourceId": "rtl-sdr-serial-123",
  "sourceEpoch": 42,
  "settingsRevision": 19,
  "settingsApplied": true,
  "requestedSettings": {},
  "effectiveSettings": {},
  "acquisitionPlan": {
    "mode": "whole_sample",
    "segments": [],
    "planDigest": "..."
  }
}
```

Missing identity, revision, plan, or effective fields are failures. Do not infer
acceptance from a generic `started` message.

## Patch and Continuity Semantics

- A patch describes settings that change at a byte boundary.
- A retune patch must include requested/effective center, segment ID, elapsed
  time, and discarded complex-sample count when known.
- A multi-channel patch must identify its channel.
- `sample_offset` must have one unit across every producer; V6 playback expects
  a byte offset.
- For a strict continuous-lossless contract, stop at an unprovable patch boundary
  and persist a discontinuity marker.
- For a planned segmented contract, continue only when the acquisition plan and
  metadata make each segment's continuity explicit.
- `PatchOptionsApplied` in classifier training exports is a boundary marker, not
  a wire-level prepare/ack protocol.

## Implementation Guidance

- Reuse option names and effective readback logic, but do not treat managed
  `optionsRevision` as hardware truth yet.
- Prefer `capture_prepare` and `capture_commit` if the CLI must approve settings
  after backend application but before recording.
- Until then, the existing `capture` message may act as atomic prepare-and-start,
  provided its acknowledgement is strict and the device is leased.
- Validate output/encryption combinations before activation; the writer must not
  be the first place an invalid `.napt`/WAV combination is discovered.
- Persist V6 frame updates in both `.napt` metadata and `.iq` frame sections;
  require an initial byte-zero update for every capture.
- Add a `capture stop` command before recommending manual-duration captures.
- Keep the WebUSB V6 golden fixtures and add a cross-language Rust/WebUSB V6
  fixture with identical patch-offset semantics.
