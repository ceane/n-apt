# Spectrum performance audit — October 24, 2026

Source baseline: `685a0569`, branch `codex/local-app-work`. This is a source-backed audit, not a measured browser performance diagnosis. No runtime implementation was changed.

## Conclusion

The strongest remaining issue is that presentation still waits for processing in a path where it should reuse the resident spectrum. Full-size CPU-painted overlay uploads and unnecessary GPU analysis add substantial potential work during gestures. The transport already has several important optimizations; replacing Redux or rewriting WebSockets wholesale is not justified by this audit.

Prioritize: (1) remove the worker-pending presentation gate while preserving frame ownership, (2) separate overlay movement from texture repainting, (3) separate GPU analysis from presentation cadence, (4) measure the complete path before optimizing acquisition or transport further.

## Evidence and limitations

- Reviewed acquisition/orchestration, RTL-SDR and HackRF reads, Mock APT generation and Metal finalization, managed and legacy WebSocket delivery, decryption queues, frame publication, Redux/context, worker FFT, temporal processing, WebGPU FFT/overlays, waterfall, interaction scheduling, and existing metrics.
- Five focused Jest suites passed: **102 tests**, covering worker client, animation, spectrum renderer, interaction, and multiplexed transport. These are behavioral tests; they do not establish smooth painting or GPU timing.
- `localhost:5173` refused connections. Backend `localhost:8765/api/debug/pipeline-performance` returned HTTP 401. No authenticated live metrics or browser trace was collected. No services were started or restarted. Repository guidance prohibits browser automation for testing.
- The active browser, source, FFT size, actual frame rate, resolution scale, classifier state, and capture/demod activity were not established. Findings below state their conditions.
- Prior fixes were rechecked against current code rather than assumed from earlier reports. No real RF capture or transmit operation was performed.

## Pipeline and ownership

1. Device callbacks/mock generation produce I/Q. The active acquisition worker holds the processor lock inside `spawn_blocking`; secondary source runtimes also use blocking workers.
2. Live display acquisition ordinarily bypasses backend FFT. Active recording can still perform capture DSP. Source/epoch/revision and acquisition-frequency metadata accompany frames.
3. The active producer publishes to both the managed stream manager and the legacy spectrum broadcast. Managed delivery uses an encrypted binary NAPS envelope with JSON metadata; a JSON/base64 compatibility path also exists.
4. The browser parses metadata, serializes decryption per logical connection, then passes accepted frames to the source manager/middleware. Latest-only delivery replaces pending frames; lossless consumers have different requirements.
5. Middleware keeps I/Q in mutable frame stores, publishes source presentation state, and batches display notification on requestAnimationFrame. Demodulation has a separate queue.
6. A worker copies/transfers the selected I/Q window, computes FFT via WASM or scalar fallback, and returns a Float32Array. One job runs and one pending job is replaceable.
7. FFTCanvas performs remaining processing, temporal averaging, coordinate preparation, overlay drawing, and WebGPU submission. Waterfall uses a circular texture. Browser composition/presentation happens after JavaScript submission.

## Ranked findings

### 1. High: an unfinished FFT prevents an interaction repaint

Evidence: `src/ts/features/spectrum/FFTCanvas.tsx:3795` reads the worker result and sets `workerPending` when it is null; line 4007 returns before spectrum and overlay rendering. `src/ts/features/spectrum/fft/spectrumWorkerClient.ts:80` and `:104` include options revision, center frequency, source epoch, sample rate, and FFT configuration in the matching scope.

Consequence: when an incoming frame changes scope and the corresponding FFT is unfinished, the old pixels remain visible even when pan refs have moved and an interaction render was requested. Repeated retunes can repeatedly invalidate the matching completed result. This is a concrete presentation dependency; its contribution to the reported stalls remains unmeasured. Same-scope steady streaming already reuses completed results and should not be conflated with this case.

Change: separate ingestion readiness from paint readiness. Continue painting the last valid resident spectrum using its own acquisition range and the newest viewport while the new FFT is pending. Preserve source/epoch isolation; do not simply relax all scope checks or relabel old bins with the new acquisition center. Only data processing, analysis, and waterfall-row insertion should await fresh data.

Validation: delay worker results across several tune revisions while issuing wheel gestures; assert that viewport/overlay draws continue and the eventual replacement has the correct acquisition axis. Cover paused one-shots, source switching, mirror crossings, and resume.

### 2. High: gestures invalidate two full-resolution overlay surfaces

Evidence: `FFTCanvas.tsx:3383` marks grid and markers dirty on pan. `hooks/useSpectrumRenderer.ts:342` onward redraws the Canvas2D grid and marker overlays. `hooks/useWebGPUInit.ts:113` clears the backing canvas; `:159` copies the entire external image into the GPU texture. OffscreenCanvas is used here on the calling main thread; it does not itself move drawing into a worker.

For illustration, a 1400×700 CSS-pixel spectrum at DPR 2 has a 15.68 MB RGBA surface. Updating two such surfaces at 60 Hz touches about 1.88 GB/s of logical image content. This is an area calculation, not measured bus traffic: browser implementations may optimize copies. Text drawing, rasterization, synchronization, and composition also matter.

The overlay path uses full `window.devicePixelRatio` in useSpectrumRenderer rather than the canvas-resolution-scale calculation used elsewhere in FFTCanvas. Lowering trace resolution therefore does not necessarily lower these overlay costs.

Change: cache static labels/background separately, use transforms or GPU geometry for moving lines, and update text only when tick identities/labels change. Consider a glyph atlas or smaller overlay regions after profiling. Propagate the intended resolution scale consistently. Keep immediate viewport motion; do not hide the problem with a long input debounce.

### 3. High when enabled: skipping analysis callbacks does not skip GPU analysis

Evidence: `FFTCanvas.tsx:4658` computes `skipSpikeAnalysis`, but `:4710` still passes the spike-overlay flag. Only callbacks at `:4740` are omitted. `hooks/useDrawWebGPUFFTSignal.ts:1591-1650` runs floor reduction, primary/recovery classification, finalize/detection, and temporal-history passes whenever the overlay is enabled. The history index advances on those draws. The 250 ms readback throttle controls CPU readback, not compute cadence.

Consequence: a viewport-only redraw can repeat analysis over resident data and advance temporal history without a new acquisition. This is both avoidable work and a temporal-semantics concern. View-dependent resampling does need updating; that does not imply acquisition-level analysis should accumulate another time sample.

Change: explicitly distinguish waveform generation, viewport generation, analysis generation, and overlay visibility. Reuse results when valid; define whether analysis is acquisition-space or viewport-space. On pan, recompute any view-dependent result without appending duplicate acquisition history. Gate DC removal on actual waveform/policy changes as appropriate.

### 4. Medium–high at large FFT/averaging windows: work remains on the main thread

Evidence: `features/spectrum/fft/frameProcessing.ts:724` stores temporal frames, rebuilds the active-frame list, and calls `averageTemporalWaveforms`. FFTCanvas also performs DC correction, inversion and optional full-channel accumulation. Worker construction/failure can select synchronous processing through `hooks/useSpectrumWorker.ts` and FFTCanvas. Worker-internal WASM failure instead uses a scalar FFT inside the worker; these are different failure modes.

Change: measure each stage separately. Move temporal processing into the worker or use a mathematically equivalent rolling accumulator with explicit reset rules. Preserve the averaging domain, calibration, sample-window identity, and capture output. Expose worker/WASM/scalar/main-thread-fallback status so degraded performance is diagnosable.

### 5. Medium: broad context propagation remains despite I/Q bypassing Redux

Evidence: `hooks/useSpectrumStore.tsx:2134` subscribes to entire spectrum and waterfall slices, combines them, and provides a shared context (`:4676`). `useSpectrumTransport` consumes that same context for commands. Gesture snapshots are published at 50 ms cadence. `redux/store.ts` retains development checks and Redux DevTools.

Consequence: viewport updates can still rerender a broad subscriber tree at roughly 20 Hz during sustained changes. That is not the same as storing every I/Q frame in Redux. The cost needs a React commit trace.

Change: split stable command context from changing settings/presentation state and subscribe to selected values. Keep immediate transient viewport refs. Do not globally disable correctness middleware as the first production optimization. Persistence is already delayed until inactivity (`localStorageMiddleware.ts:193-250`); per-wheel synchronous settings writes are not the primary remaining finding.

### 6. Medium, source-dependent: acquisition can delay retunes and publication

Evidence: `streaming/acquisition_worker.rs:107` holds the processor lock during settings application/read/processing. RTL-SDR `sdr/rtlsdr/device.rs:855` drains a live queue without a fixed iteration budget, appends chunks to overflow, discards the old prefix, and collects a new output Vec. Its insufficient-data wait can last 1000 ms. HackRF has bounded freshest-block draining and reusable callback buffers; do not assume both devices share RTL's behavior.

Change: measure lock wait, read wait, queue depth, drained bytes, and allocation volume separately. Bound RTL's drain and retain only the newest display window using reusable storage, preserving the independent contiguous audio/capture path. A read stall must not stall resident frontend panning. Do not lower hardware sample rate below the project's 3.2 MHz requirement to conceal the issue.

### 7. Medium, Mock APT Metal only: CPU/GPU round trips remain synchronous

Evidence: `sdr/mock_apt/mod.rs:1133` computes CPU-side signal/noise state; `sdr/mock_apt/metal_backend.rs:141` copies four f32 arrays into buffers, commits GPU work, waits for completion (`:177`), allocates output bytes, and copies them back. This is GPU finalization, not an entirely GPU-resident generator.

Change: compare warm CPU and Metal generation on the same deterministic configuration, including p95/p99 latency and simultaneous browser GPU load. Consider pipelined buffers only if continuity, tune identity, and seeded checksum stay correct. Shared-GPU contention is a hypothesis, not an observed diagnosis. No generator change/checksum claim was made in this audit.

### 8. Medium: remaining transport copies and shared-writer blocking

Evidence: active publication clones raw I/Q for the managed manager (`server/websocket_server/mod.rs:1708`); acquisition fallback also copies display bytes. `server/websocket_handlers.rs:1531` owns a single writer for control/data and awaits each send; it drains/coalesces queued latest frames before encoding. Coalescing matches revision and stops across control boundaries. Encryption and binary-envelope construction happen synchronously in this task. A send already handed to the socket cannot be replaced by a newer frame through application queue coalescing.

Change: account for copied bytes and per-stream queue age; share immutable I/Q ownership where possible. Coalesce superseded latest-only tuning revisions only where protocol ordering permits. Measure slow-send/control latency and introduce an explicit stale-session recovery policy if needed. Do not discard lossless capture/audio samples or remove encryption. Dedicated control transport is an experiment if measured head-of-line blocking warrants it.

The browser already coalesces latest pending decrypt work (`multiplexedStreamTransport.ts:240`), but intervening control entries preserve queue boundaries. Its 32-frame lossless cap is not a universal display queue length. Binary NAPS avoids base64 for that path; the mere presence of base64 code does not prove it is active.

### 9. Medium for resize/restore: waterfall work has burst costs

Evidence: `hooks/useDrawWebGPUFIFOWaterfall.ts:440` resizes/recreates history textures, clears the full texture, and repacks rows; `:521` restores a snapshot using per-row uploads. Ordinary rows use a 4096-bin circular texture and pooled row buffers, avoiding a full-history shift each frame.

Change: time resize, restore, row conversion/upload, and presentation separately. Consolidate compatible restore uploads and avoid incidental resize churn. Verify actual CSS/backing dimensions before blaming ordinary panning. Extra canvases, resolution, and the browser compositor still require a real trace; `will-change` declarations alone are not proof of acceleration or a bottleneck.

### 10. High diagnostic priority: current metrics miss key work

Evidence: browser `renderSubmit` timing starts inside the GPU hook near command encoding, after Canvas2D overlay drawing and several buffer operations. It ends after queue submission, not GPU completion or display presentation. `pipelineMetrics.ts` explicitly warns that RAF cadence is only a pre-paint proxy. Backend EncryptSerialize/WebSocketSend spans in websocket_handlers are in the legacy send helper; the managed writer is a separate path without those same spans.

Change: identify active paths in every snapshot. Add low-overhead, opt-in histograms for event→RAF delay, entire render callback, overlay raster/upload, main-thread processing, actual draws vs worker-pending skips, worker scope mismatches, managed encode/send, queue age, and lock/read time. Count GPU submissions and bytes; use GPU timestamps when supported. A sampled completion fence measures queue delay, not presentation, and should not be awaited in the hot path. Use platform browser tracing for actual paint/compositor evidence.

## Profiling and implementation sequence

1. Add the missing stage boundaries and counters without synchronous hot-path logs or I/Q payload recording. Obtain an authenticated diagnostic snapshot through the existing login flow.
2. Reproduce the pending-worker case deterministically, then implement resident presentation independently of new FFT readiness. This is the first correctness/performance change to attempt.
3. Measure overlay redraw area/time and analysis dispatch counts; optimize those separately so the gain is attributable.
4. Profile context commits and remaining CPU processing; then optimize acquisition/copies only if their tails remain material.

Run 20–30 second repeated scenarios after warm-up: idle live; visual pan inside acquisition; VFO retune; paused pan/one-shot; mirror crossing; waterfall on/off; classifier on/off; small/large FFT; temporal averaging off/on. Repeat for Mock CPU/Metal and the user's actual RX device. Record browser/version, display refresh, DPR, canvas size, power mode, build mode, and concurrent capture/demod consumers. Keep those consumers off for an isolated baseline, then repeat with the real workload.

Report p50/p95/p99/max event→draw and render time, late RAF intervals, actual draws, queue age, fresh-frame age, rejected/superseded frames, worker latency, and GPU queue delay. Distinguish acquisition age from viewport responsiveness. Choose frame budgets from the actual display (16.7 ms at 60 Hz; 8.3 ms at 120 Hz); aim for substantial headroom, not just average time below budget. Compare matched runs and retain correctness checks for source isolation, acquisition-axis mapping, continuity, paused behavior, and final tune position.

## Verification

Command: `./node_modules/.bin/jest --runInBand test/ts/spectrumWorkerClient.test.ts test/ts/useFFTAnimation.test.tsx test/ts/useSpectrumRenderer.test.ts test/ts/useSpectrumInteraction.test.tsx test/ts/multiplexedStreamTransport.test.ts`

Result: 5 suites, 102 tests passed. No TypeScript/Rust implementation changes, build, hardware mutation, or measured speedup. Actual-browser profiling remains outstanding; this report does not claim that every potential cost is significant on the user's current setup.

## Follow-up implementation and remaining acceptance — October 24, 2026

The implementation follow-up now keeps a source-owned resident spectrum visible while replacement FFT work is pending, rejects stale worker output, and separates viewport-only redraws from new-frame classifier history. Opt-in pipeline timing covers the added browser/backend stages described by the implementation. Those changes preserve the source frame's acquisition range; they do not relabel old bins after a tune.

The reported viewport-edge flash had a concrete uniform-packing defect. The TypeScript path put `edge_coverage_hz` at byte 40, while WGSL reads it at byte 36, leaving the half-display-pixel seam guard disabled. The writer now stores the tolerance at byte 36 and clears padding at 40 and 44. Regression tests lock both the shader field order and packed values. The focused shader suite passes (12 tests); the renderer and frame-processing suites pass (68 tests).

The pan-time full-size grid and marker surfaces are still separate. Combining them into one texture would put the background grid above the trace in the current render-pass order, so that optimization was discarded rather than changing the display's layering. The planned GPU line/marker geometry and label caching remain open work.

Safari Timelines captured pointer, paint, and composite activity, but the Frames view could not be inspected because the Mac locked. Safari's Event Timing entries in this session do not expose `presentationTime`; therefore the interaction-to-present p95/p99 target is not yet verified. The current trace and the earlier docked-inspector metrics are diagnostic only, not a warmed before/after benchmark. Resume that acceptance check after the Mac is unlocked and collect matched runs at the display's actual refresh rate.

`npm run typecheck` still fails on missing/incorrect encrypted-ML module exports and the existing property-test `Array.at` target error; it reports no errors in the changed spectrum files. `cargo check --profile dev-incremental` passes. The Rust unit-test build is blocked by three existing calls to unsafe HackRF callbacks in `src/rs/sdr/hackrf/device.rs` (lines 1492, 1513, and 1539). The WGSL CLI invocation was blocked by permissions on the user's npm cache, and the repository-local CLI is not installed. Neither failed check is treated as a pass.

The browser timing summary now reports nearest-rank p99 over the retained, bounded sample window. A focused regression test feeds 1–100 ms and verifies p95=95 ms and p99=99 ms. The two-client check confirms that the in-app browser has the spectrum and waterfall UI visible at DPR 2 with four canvases, but its restricted evaluation scope does not expose the opt-in metrics accessor. The existing debug endpoints remain authenticated (401 without the app's authorized flow); no endpoint or CSP/Connection-Allowlist change was made. The current app terminal reports the Mock APT device disconnected while the frontend and backend processes remain running, so this check does not establish server queue or generation latency.

The new Safari Frames recording has not yielded a usable presentation trace: after Web Inspector was detached and minimized, native Safari accessibility requests timed out even though Safari remained marked running. The user has been asked to restore the inspector so the recording can be stopped and read. Consequently the requested interaction-to-presentation p95/p99 and two-client server-side comparison remain unmeasured; browser-stage p95/p99 summaries still stop at their named instrumented stage and are not display-presentation timings.
