# Streaming performance fixes — October 22, 2026

## Implemented

- [x] Coalesce latest-only frames at the final socket writer queue. Preserve
  lossless frames and control-event boundaries, and bound queue draining so
  control replies cannot starve.
- [x] Reset the browser transport's revision floor and pending decode work on
  reconnect. Fence old decryptions with a connection generation, including
  subscription disposal.
- [x] Compile FFT GPU pipelines asynchronously and concurrently. Concurrent
  draws share initialization, superseded draws do not submit stale data, and
  cleanup/device replacement retires pending initialization safely.
- [x] Run spectrum FFT processing in a module worker. Keep one job in flight
  and one replaceable pending frame. Transfer a copy of the newest FFT window;
  preserve the original I/Q for other consumers. Keep WASM initialization and
  scalar fallback in the worker, with a synchronous fallback if workers fail
  or are unavailable.
- [x] Acquire I/Q without calculating the discarded backend display spectrum.
  Active capture still computes spectrum data and frame metadata. Held I/Q
  retains the original tune axis during acquisition gaps.
- [x] Pace secondary source runtimes from the processor's applied frame rate.
  Idle acquisition when every subscriber is paused, while permitting explicitly
  requested one-shot frames.
- [x] Send live multiplexed I/Q in an encrypted binary NAPS envelope rather than
  base64 JSON. Control messages remain JSON. Header bytes are authenticated as
  AES-GCM additional data. Update raw integration/manual-test consumers.
- [x] Release resized GPU buffers when submitted work finishes instead of
  retaining them until the renderer is destroyed.

## NAPS wire envelope

`NAPS` (4 bytes), little-endian u32 metadata length, UTF-8 JSON metadata,
then AES-GCM nonce/ciphertext/tag. Metadata contains source/mode, stream epoch,
options revision, sequence, timestamp, center frequency, sample rate and TX
preview status. The complete prefix through the metadata is authenticated as
additional data. No base64 I/Q string is sent on the live wire.

The browser sets `binaryType = "arraybuffer"`, bounds metadata length, and
queues ciphertext before asynchronous authenticated decryption. The stream
manager continues owning source/epoch/revision/sequence acceptance.

## Verification and limits

19 focused Rust tests and 91 focused frontend tests pass.
`cargo check --tests` passes. The seeded Mock APT identity regression passes
with the established waveform checksum `68178474`. Coverage includes
blocked socket writers, lossless/control boundaries, reconnects with a stale
decryption pending, binary header authentication, worker coalescing and
configuration isolation, asynchronous GPU compilation, buffer lifetime,
I/Q-only acquisition, capture spectrum retention, secondary runtime cadence,
and paused one-shot requests. Worker modules pass standalone syntax checks.

No browser automation, physical RF validation, or Safari performance trace was
performed. No service was started or restarted manually. Full TypeScript
checking reports missing exports/modules and a type error in the existing
generated encrypted ML sources under `src/encrypted-modules/tmp/ml`.
Those generated sources are outside this change. Two classifier-sidebar tests
fail in the full FFTCanvas suite and pass in isolation. The same failures were
reproduced by substituting the original FFTCanvas source from `main` through a
temporary Jest transformer, without changing the working tree.

## Safari stutter follow-up — October 22, 2026

- [x] Submit FFT work on frame arrival while retaining one in-flight job and
  one replaceable latest pending job. Request a repaint as soon as the newest
  result is ready; reject results whose source, stream revision, frame, or FFT
  configuration no longer matches.
- [x] Initialize the FIFO waterfall pipeline with
  `createRenderPipelineAsync`. Reuse one pending pipeline promise per device
  and format, keep the existing canvas contents while compilation is pending,
  and discard late initialization after cleanup or device/format replacement.
- [x] Copy classifier, decision, temporal, spike, and count results into one
  staging buffer and map it once per sampled readback interval.
- [x] Add bounded DevTools timing samples behind
  `localStorage.setItem("napt.pipelineProfile", "1")`. Reload the page, then
  inspect `window.naptPipelineMetrics.snapshot()`. Timing stages include frame
  receipt-to-decryption, decryption, worker queue/compute/round trip, CPU render
  and queue submit, and render-loop intervals. Render-loop intervals are a
  pre-paint proxy; they do not measure browser paint or display presentation.
- [x] Add focused regression tests for immediate worker repaint, stale worker
  results, async waterfall setup/cleanup, and one-map classifier readback.

The focused frontend run passed 61 tests across 9 suites. The seeded Mock APT
identity regression passed with checksum `68178474`. `npm run typecheck` was
run; its 10 remaining errors are confined to generated sources under
`src/encrypted-modules/tmp/ml`. Safari before/after profiling still requires a
manual comparison with the same source, stream settings, and viewport, plus a
Web Inspector timeline review.
