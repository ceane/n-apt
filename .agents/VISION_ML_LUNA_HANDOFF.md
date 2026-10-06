# Vision ML foundations — Luna handoff

Foundation milestone: 2026-10-05; locally refined: 2026-10-06. Continue from the
committed foundation milestone; avoid broad exploration.

## User intent and boundary

The user chose solid S/M/L/Red presets, selection of a physical monitor,
16x16 RGB reconstruction at 10 fps, separate spatial calibration patterns, and
both GPU workgroup design and implementation workstreams. They are around 80%
usage and asked to finish the foundations, commit, then continue the remaining
UI/training work after switching this chat to Luna. The foundation milestone is
committed as `f037a36f`. No subagents were used. Do not start parallel agents
without a new request. Preserve unrelated shared-worktree changes and do not
stage them.

## Implemented

All frontend entry points are in `src/ts/features/demodulation/vision/`:

- `visionModel.ts`: strict version-1 schemas for stimulus/configuration,
  acquisition/reference timelines and paired artifact references; model manifest,
  decoded frame and STFT preprocessing contracts. The model head is explicitly
  opponent-space; decoded output is range-checked normalized sRGB. Output is
  16x16 at 10 fps.
- `visionReference.ts`: deterministic seeded 16x16 spatial references (patches,
  horizontal/vertical bars, grids, color/intensity controls); exact solid RGB
  presets; fixed numerical linear-sRGB/LMS/opponent transform and inverse.
  `visionTargetAt` excludes transition uncertainty before producing a label.
- `visionCapture.ts`: event-driven `VisionCaptureCoordinator`. Validates source,
  epoch, options revision, tuning, rate, producer sample positions, sequence,
  timestamps, continuity, onset, duration and acquisition coverage. Configuration
  is snapshotted. Interrupted pairs remain incomplete; missing acquisition cannot
  be finalized. It owns no hardware, timers, DOM or raw-I/Q buffers.
- `visionDataset.ts`: feature-to-timeline RGB labels with transition exclusion,
  explicit session splits, duplicate trial/capture rejection, calibration-seed
  separation across splits, normalization fitted only from training sessions,
  and held-out RGB MSE against training-mean-image and constant-color baselines.
  Evaluation checks explicit disjoint session assignments. No automatic model
  promotion.
- `visionStorage.ts`: authenticated POST/GET client; requires the current session
  token as an argument and sends it ONLY in Authorization. No localStorage,
  IndexedDB, plaintext I/Q, salt or key persistence. Validate records on retrieval.
- `visionScreens.ts`: enumerate displays through the Window Management API,
  provide a manually-positioned-window fallback, and request fullscreen on the
  selected display directly from the Start click.
- `StimulusNode.tsx`, `VisionScene.tsx`, `DemodContext.tsx`, and `DemodRoute.tsx`:
  selectable S/M/L/Red solid presets, selected-display request, capture-label RGB
  and preset metadata, and a full-screen color scene with a 1vh contrasting
  progress bar driven by the requested capture duration. The scene contains no
  centered text and is shown while capture starts/captures.
- `VisionDemodWorkflowFlow.tsx` and `DemodReadinessNode.tsx`: readiness switches
  to a separate vision flow when the Stimulus baseline is Vision; the flow
  uses the audio flow's connected graph layout, qualifies a live RTL-SDR or
  HackRF One against Channel C, and displays the selected frequency range. Its
  separate paths show the proposed Channel C N-APT spike/valley baseline and
  the learned RGB decoder. The graph reports when references are unaligned or
  a trained decoder is unavailable. Audio modes retain their existing audio
  flow.

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
- Continuation UI checks:
  `npx jest test/ts/visionFoundations.test.ts test/ts/visionScreens.test.ts test/ts/VisionScene.test.tsx test/ts/StimulusNode.test.tsx test/ts/DemodReadinessNode.test.tsx --runInBand --silent` — 5 suites, 53 tests passed.
  `npm run typecheck` — passed after replacing an ES2022-only test helper with
  project-compatible indexed access.
- ML contract refinement:
  `npx jest test/ts/visionFoundations.test.ts --runInBand --silent` — 27 passed;
  `npm run typecheck`, focused `npx oxfmt --check`, and `git diff --check` on the
  three refined files — passed. Normalization and evaluation now resolve rows
  against explicit session assignments, and the mean-image baseline is computed
  only from training reference frames.
- Local vision training and inference refinement:
  `visionPreprocessing.ts` implements the version-1 contiguous-I/Q feature path;
  `buildVisionTrainingDataset` joins those features to reference-timeline RGB
  labels. `visionMl.ts` trains the compact opponent-frame and S/M/L/Red heads;
  `visionTraining.ts` adds train/validation/test session checks, pause/resume,
  early stopping, label-content fingerprinting, held-out spatial and color
  metrics, and ONNX checkpoint export. `visionTrainingStorage.ts` persists only
  model checkpoints and run metadata in IndexedDB. `visionOnnxRuntime.ts` loads
  ONNX through WebGPU/WASM and converts opponent output to validated RGB frames.
  Focused verification command on 2026-10-06: `npx jest
  test/ts/visionFoundations.test.ts test/ts/visionScreens.test.ts
  test/ts/VisionScene.test.tsx test/ts/StimulusNode.test.tsx
  test/ts/DemodReadinessNode.test.tsx test/ts/visionPipeline.test.ts
  test/ts/visionMl.test.ts test/ts/visionOnnxRuntime.test.ts
  test/ts/visionTraining.test.ts --runInBand --silent` — 9 suites / 79 tests
  passed, including ONNX Runtime WASM parity and the Channel C workflow. The
  same verification pass ran `npm run typecheck` and `git diff --check`; both
  passed. Focused formatter checks passed on the touched files in the earlier
  refinement pass.
- Focused `npx oxfmt --check` passed on the 11 touched TS/test files other than
  `DemodContext.tsx`. Including that file reports its existing whole-file style
  drift; formatting it would create a broad unrelated diff, so it was left alone.
- New TS/test files formatted with oxfmt; new Rust module formatted with rustfmt.
- No browser automation, full build, live acquisition, real-capture training,
  IndexedDB persistence round-trip, HTTP/Redis round-trip integration test, or
  physical-display timing validation was run. The deterministic trainer was
  exercised only with synthetic in-memory examples.
- Act secret/taint tools were edition-blocked. Automatic approval review rejected
  the external Act scan because it would export private code. Local inspection
  and tests were used instead; do not retry that export without authorization.

## Important integration limits

This is a foundation and presentation prototype, not an active visual decoder.
The monitor/preset/fullscreen UI and readiness switch exist, but capture and
presentation are not synchronized by a `VisionCaptureCoordinator`; the UI does
not persist a `VisionPairedReference` timeline. Preset/RGB values are capture
labels only, not proof of display onset or acquisition alignment.
`visionPreprocessing.ts` implements the FFT/features in a reusable synchronous
path, but no verified SDR adapter supplies continuous producer-indexed windows
to it. A local compact trainer,
checkpoint repository, ONNX export/inference API, and RGB frame conversion now
exist, but no verified SDR feature-ingest path, training controls, calibration/
dataset UI, reconstruction canvas, or model-driven readiness state is wired to
them. Do not imply that a model has learned real RF/color relationships.

The coordinator requires backend-epoch FIRST-sample timestamps and genuine
producer sample indices. `audioSurveyFrameSources.ts` can synthesize indices and
fall back to receipt times: do not directly treat those as producer evidence.
The current V6 `FrameUpdate.sample_offset` is a byte offset into interleaved raw
I/Q, and `timestamp_us` is explicitly elapsed capture-processing time, not a
hardware sample clock. The survey adapter also substitutes its receipt-time
fallback when `frame.timestamp` is absent. Neither path satisfies the vision
coordinator contract by itself. The vision progress bar uses a browser receipt
time on capture-start because `captureStatus.timestamp` is a server epoch with
no measured browser offset; that UI clock is not synchronized-reference evidence.
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
cone responses. S is the violet/blue preset, M green, L yellow-green extending
toward red, and Red the existing red preset. RGB targets are authoritative.
The Channel C baseline is a proposed N-APT interpretation, not traditional NOAA
APT: ~34 kHz is only a peak/valley spacing prior, not an established pixel clock
or line cadence. The displayed spike/valley and per-bin RGB-raster nodes are a
workflow plan, not implemented DSP. No frequency-bin/pixel mapping is assumed;
reference captures must establish any bin timing and ordering. Solid-color
classification alone cannot establish spatial reconstruction.

## Remaining work for Luna, in order

1. Wire synchronized acquisition, presentation receipts, interruption handling,
   and encrypted reference persistence. Use current encrypted capture commands
   and completed artifact metadata; pass only producer evidence into `observe`,
   rendering receipts into `present`, and stop reasons into `interrupt`. Call
   `finish` only after post-roll acquisition and presentation end, then
   `saveVisionPair(pair, sessionToken)`. Keep one persisted trial per capture.
   Acceptance: reject missing/ambiguous clocks, gaps, capture mismatch, and
   incomplete pairs; add focused auth, Redis failure, immutable retry and mismatch
   tests. Never silently train on incomplete references.
2. Add spatial calibration and explicit session-split/dataset controls. Randomize
   trial order and duration; persist actual timing and seeds. Record progress-bar
   geometry separately and exclude its strip from targets. Acceptance: generated
   labels match each timeline bin, calibration seeds never cross dataset splits,
   and interrupted trials cannot enter training. Do not derive labels from names.
3. Wire the implemented preprocessing contract into a worker fed only by
   verified contiguous 100ms producer windows: 1024 Hann-periodic FFT, hop 512,
   fftshift bins, ten 10ms slices of log power and circular phase differences,
   `[10,1024,2]` tensor. The path rejects short/gapped contexts. Fit
   normalization only on training sessions. Test CPU reference against GPU;
   start custom kernels at 64 threads for bins and 8x8 for image conversion,
   respecting adapter limits. Let ONNX manage neural workgroups. Acceptance:
   CPU/GPU fixture parity and deterministic preprocessing on held-out sessions.
4. Wire the compact trainer into a worker/control surface and calibration/data
   controls. Keep reference images, seeds, elapsed stimulus time and preset
   labels out of inference inputs. Acceptance: users can start, pause, resume,
   inspect checkpoints, and load a version-compatible model without storing raw
   I/Q or training examples in the model checkpoint repository.
5. Integrate reconstructed-frame output and held-out evaluation UI. Compare
   constant-color and training-mean baselines on held-out sessions AND held-out
   spatial seeds; add shuffled-label/time-shift controls, per-color and spatial
   errors, confidence calibration, and latency. Report color classification and
   spatial reconstruction readiness separately. Acceptance: promotion gates
   require independent real-capture evidence and improvement over baselines;
   otherwise retain experimental status.

## First files and commands to inspect

Start with `visionCapture.ts`, `visionModel.ts`, `visionReference.ts`,
`visionPreprocessing.ts`, `visionDataset.ts`, `visionMl.ts`, `visionTraining.ts`,
`visionTrainingStorage.ts`, `visionOnnx.ts`, `visionOnnxRuntime.ts`,
`visionStorage.ts`, `visionScreens.ts`, then
`StimulusNode.tsx`, `VisionScene.tsx`, `VisionDemodWorkflowFlow.tsx` and
`DemodReadinessNode.tsx`. Run the focused `npx jest` command and
`npm run typecheck` listed above after relevant changes; run the focused Rust
reference tests only when Rust/server code changes. Avoid the full build and broad
repository exploration until the contracts have been exercised by real capture
adapters.

Preserve unrelated legal UI/GLB edits already in the shared worktree. Commit only
vision paths and necessary route hunks. The pre-commit hook checks encryption and
synchronizes article channels; those article files were clean and synchronized.
