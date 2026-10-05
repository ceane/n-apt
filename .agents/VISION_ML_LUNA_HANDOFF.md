# Vision ML foundations — Luna handoff

Date: 2026-10-05. Stop at this milestone; do not repeat broad exploration.

## User intent and boundary

The user chose solid S/M/L/Red presets, selection of a physical monitor,
16x16 RGB reconstruction at 10 fps, separate spatial calibration patterns, and
both GPU workgroup design and implementation workstreams. They are around 80%
usage and asked to finish foundations, commit, then hand off to Luna in this chat.
No subagents were used. Do not start parallel agents without a new request.

## Implemented

All frontend entry points are in `src/ts/features/demodulation/vision/`:

- `visionModel.ts`: strict version-1 schemas for stimulus/configuration,
  acquisition/reference timelines and paired artifact references; model manifest,
  decoded frame and STFT preprocessing contracts. Output is 16x16 at 10 fps.
- `visionReference.ts`: deterministic seeded 16x16 spatial references (patches,
  horizontal/vertical bars, grids, color/intensity controls); exact solid RGB
  presets; fixed numerical linear-sRGB/LMS/opponent transform and inverse.
  `visionTargetAt` excludes transition uncertainty before producing a label.
- `visionCapture.ts`: event-driven `VisionCaptureCoordinator`. Validates source,
  epoch, options revision, tuning, rate, producer sample positions, sequence,
  timestamps, continuity, onset, duration and acquisition coverage. Configuration
  is snapshotted. Interrupted pairs remain incomplete; missing acquisition cannot
  be finalized. It owns no hardware, timers, DOM or raw-I/Q buffers.
- `visionDataset.ts`: explicit session splits, duplicate trial/capture rejection,
  calibration-seed separation across splits, training-only normalization, and
  RGB MSE comparison with an externally supplied training-derived mean image.
  No automatic model promotion.
- `visionStorage.ts`: authenticated POST/GET client; requires the current session
  token as an argument and sends it ONLY in Authorization. No localStorage,
  IndexedDB, plaintext I/Q, salt or key persistence. Validate records on retrieval.

Server: `src/rs/server/vision_references.rs`, with small route/module additions:

- `POST /api/vision/references/{trial_id}` and `GET` at the same path are inside
  existing session-authenticated routes. Maximum request body: 1 MiB.
- POST binds the reference to an existing completed capture's registered
  job/filename/checksum and requires the file's encrypted NAPT-IQ3 header.
  Client file paths are never accepted. I/Q remains in its existing capture file.
- Reference JSON uses the existing NAPTENC2/AES-256-GCM implementation and a
  fresh random salt. Salt and ciphertext are one atomic, non-expiring Redis DB1
  record at `vision:reference:v1:{trial_id}`. SET NX makes records immutable;
  identical retries succeed, changed data returns 409. Redis errors fail closed.
- GET decrypts only on the server and sets Cache-Control: no-store. No secrets
  or reference data are logged. No new crypto implementation or dependency.

## Validation at this milestone

- `npx jest test/ts/visionFoundations.test.ts --runInBand --silent`: 26 passed.
- `npm run typecheck`: passed.
- `cargo test --lib vision_reference --no-default-features --quiet`: 3 passed.
  Default Cargo features are empty; 431 unrelated tests were filtered out.
- `cargo check --quiet`: passed.
- New TS/test files formatted with oxfmt; new Rust module formatted with rustfmt.
- No browser automation, full build, live acquisition, training, HTTP/Redis
  round-trip integration test, or physical-display timing validation was run.
- Act secret/taint tools were edition-blocked. Automatic approval review rejected
  the external Act scan because it would export private code. Local inspection
  and tests were used instead; do not retry that export without authorization.

## Important integration limits

This is a foundation, not an active visual decoder. UI and device adapters are
NOT wired. STFT details are a contract, not an implemented FFT pipeline. No
trainer, ONNX model, GPU kernels, checkpoint runner or reconstructed-image UI
exists yet. Do not imply that a model has learned real RF/color relationships.

The coordinator requires backend-epoch FIRST-sample timestamps and genuine
producer sample indices. `audioSurveyFrameSources.ts` can synthesize indices and
fall back to receipt times: do not directly treat those as producer evidence.
Before wiring, trace the persisted V6 markers and acquisition queue. Keep the
capture job/source identity with the coordinator. Cross-check the actual loaded
I/Q source/timing/counts against the pair before training. The server's storage
check binds the registered artifact, but does not attest frontend timing or
recompute its file checksum. Use the existing verified I/Q reader for training.

Clock offset must be measured. Config requires backend-minus-browser epoch-ms
and uncertainty <=25 ms; zero must not be invented. Presentation callbacks are
not physical onset measurements. Transition labels have an extra 25 ms guard;
that is an experimental allowance, not a calibrated monitor latency. Calibration
frames may be fewer than 10 usable targets/sec after edge exclusion. Longer
capture padding is necessary before/after stimuli to cover uncertainty.

Reference records currently depend on full Redis persistence/backups, including
both ciphertext and salt. They are NOT in capture recovery manifests or dataset
exports. Existing capture-protection-only salt exports will not back these up.
Do not advertise offline reference recovery or export until that is integrated.

The matrix is a fixed approximate coordinate system; S/M/L presets do not isolate
cone responses. RGB targets are authoritative. No frequency-bin/pixel mapping is
assumed. Solid-color classification alone cannot establish spatial reconstruction.

## Next work, in order

1. Wire acquisition/presentation adapters and storage. Use current encrypted
   capture commands and completed artifact metadata; pass only producer evidence
   into `observe`, rendering receipts into `present`, and stop reasons into
   `interrupt`. Call `finish` only after post-roll acquisition and presentation
   end, then `saveVisionPair(pair, sessionToken)`. Keep one persisted trial per
   capture. Do not silently use incomplete references for training. Add integration
   tests for auth, Redis failures, immutable retries, and capture mismatch.
2. Add monitor/color selection and fullscreen presentation to StimulusNode and
   VisionScene. Presets are S #6633FF, M #00FF00, L #BFFF00, Red #FF0000.
   Use supported Window Management API with a manually positioned-window fallback.
   Do not silently choose a different monitor. Retain the preparation countdown
   outside the stimulus; remove centered text. Top bar: 1vh, 10% white,
   mix-blend-mode difference, shrinking with actual capture duration. Handle
   Escape, display loss, hidden/closed stimulus, failures and source changes.
3. Add spatial calibration and explicit session split controls. Randomize trial
   order/durations; persist actual timing and seeds. Record progress-bar geometry
   separately; exclude its strip from targets. Do not derive labels from filenames.
4. Switch DemodReadinessNode immediately with Stimulus selection. Vision flow:
   Channel C/source -> display/stimulus -> synchronized capture -> reference quality
   -> dataset coverage -> training -> held-out evaluation -> reconstructed frames.
   Audio/internal/speech retain AudioDemodWorkflowFlow. Never start capture, retune
   or training just because the selection changed. Keep intentional empty flows.
5. Implement the fixed preprocessing contract in a worker: contiguous 100ms input,
   1024 Hann-periodic FFT, hop 512, fftshift bins, ten 10ms slices of log power and
   circular phase differences, [10,1024,2] tensor. Define reproducible missing-bin
   behavior and reject gaps. Fit normalization only on training sessions. Test CPU
   reference against GPU; start custom kernels at 64 threads for bins and 8x8 for
   image conversion, respecting adapter limits. Let ONNX manage neural workgroups.
6. Implement compact frequency-convolution/temporal encoder with a 16x16 opponent
   output head and auxiliary four-preset classifier. Local worker training,
   deterministic seeds, pause/cancel, optimizer checkpoints, early stopping,
   ONNX export, WebGPU inference with WASM fallback. Keep reference images, seeds,
   elapsed stimulus time and preset labels out of inference inputs.
7. Compare constant-color, training-mean and linear baselines on held-out sessions
   AND held-out spatial seeds; add shuffled-label/time-shift controls, per-color
   and spatial errors, confidence calibration, and latency. Report separate color
   classification and spatial reconstruction readiness. No promotion without
   independent real-capture evidence. Integrate output only after these gates.

Preserve unrelated legal UI/GLB edits already in the shared worktree. Commit only
vision paths and necessary route hunks. The pre-commit hook checks encryption and
synchronizes article channels; those article files were clean and synchronized.
