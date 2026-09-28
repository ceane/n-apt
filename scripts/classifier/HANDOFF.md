# Luna handoff: resolution-aware browser classifier

## Task and current stopping point

**Latest priority (2026-09-24):** The trainer has an opt-in predeclared L2/seed search, group-disjoint MLP monitoring and checkpoint restore, run manifests, and uniquely named candidate artifacts. Candidates share fitting/monitor/validation sessions and selection uses validation only. Trained logistic and MLP artifact parity now passes through TypeScript CPU and WGSL/WebGPU inference; the maximum WebGPU-vs-TypeScript score error was `2.75e-8` across three probes per model, including an out-of-range feature. The default Python suite passes 25 tests with three optional PyTorch tests skipped; a temporary CPython 3.14/PyTorch 2.14 environment passes all 25 on CPU. MPS is unavailable. No real recordings were fitted, and no signal accuracy is established.

Capture context: see [LUNA_RECORDING_HANDOFF.md](./LUNA_RECORDING_HANDOFF.md) for the guarded Lossless I/Q recorder, source/staleness controls, and browser-export preparation integration. See [CAPTURE_QUALITY_HANDOFF.md](./CAPTURE_QUALITY_HANDOFF.md) for the proposed universal configurable quality contract spanning demodulation and classification. Live SDR observations and backend logs are in [LIVE_VALIDATION.md](./LIVE_VALIDATION.md). The native classifier has its own enable flag; the main spectrum route deliberately disables spike detection. The normal backend capture command applies settings and tunes the receiver, so it is not part of passive recording.

Continue the user's approved implementation plan, starting from the shared native-spectrum core below. Run classification in the browser with no new browser ML runtime. Train offline with Python/NumPy/PyTorch and MPS when available. Preserve the Swift service for later native integration. Do not modify spike detection or demodulation.

The offline CLI/trainer and a live-browser shadow-scoring panel have been implemented. A synthetic plumbing model was trained, but **no model has been trained on independently labeled recordings and no real-capture accuracy has been measured**. Feature scales and rules remain provisional. The original 17-case acceptance suite was run unchanged against the legacy browser classifier; only 3 cases passed, with morphology misses, mock-negative false positives, and interference-boundary failures. These acceptance captures are not independent evaluation data.

The shared worktree also contains unrelated demod/audio-survey edits; preserve those. This trainer step is scoped to the classifier trainer, its Python tests, and classifier handoff/plan docs. Inspect `git status -sb` before editing. The user has authorized pushes for the current V6 capture fix; that approval does not approve an ML method choice, model promotion, or changes to classifier acceptance labels. Follow `AGENTS.md` for scoped commits.

## Requirements already decided with the user

- Detect recognizable bridge/U-dip morphology while treating frequency-band coherence and truncation as visibility conditions, not morphology labels. Apparent shape edges can move with center frequency and available channel bandwidth; a result does not establish the signal's origin.
- Balance misses and false positives: select thresholds using validation balanced accuracy.
- Current captures use 3.2 MS/s RTL-SDR. Do not silently assume this when metadata is missing.
- FFT size and acquired sample count vary. Bin spacing is effective sample rate / actual FFT length. Zero-padding does not improve acquired resolution.
- Frequency cropping retains original bin spacing and FFT-shifted bin offsets. Time truncation is different from frequency cropping.
- Analyze before display resampling, smoothing, pixel reduction, mirroring, and DC removal. Resizing a canvas must not change the result.
- Missing/unresolved features need availability information and may produce insufficient evidence.
- Temporal evidence uses fresh acquisition timestamps, not repaint count. Reset on source/acquisition/interval changes.
- Compare existing rules, improved rules, and small ML. Initially run the new result in shadow mode; keep the existing displayed decision.
- Keep acceptance recordings separate from training. New session-separated positive and real negative data is required for generalization claims.

## Implemented files

- `src/ts/features/classification/native/core.ts`: metadata validation, frequency/resolution descriptors, CPU feature reference, feature summaries, timestamp-weighted history, provisional rule score, model validation and TypeScript inference.
- `src/ts/features/classification/native/iq.ts`: normalized interleaved float I/Q to FFT-shifted log-power spectrum; supported windows and incomplete-frame handling.
- `src/ts/features/classification/native/gpu.ts`: native-bin WGSL extraction and logistic/16-hidden-unit MLP GPU inference; reusable extraction buffers and explicit disposal.
- `src/ts/shaders/native_features.wgsl`, `native_model.wgsl`: feature and inference shaders.
- `scripts/classifier/browser.ts`, `runner.mjs`: shared extractor in an ephemeral loopback headless-browser harness; no running app required.
- `scripts/classifier/io.mjs`: raw u8/s16le/f32le decoding and dataset/session validation; re-exports shared FFT.
- `scripts/classifier/train.py`: NumPy logistic regression and 16-unit ReLU MLP, optional PyTorch/MPS path, hierarchical class/session/recording/window/variant weighting, weighted normalization, group-disjoint early stopping/checkpoint restore, session-balanced threshold selection, run manifests, optional candidate exports, and abstention-aware grouped evaluation.
- `scripts/classifier/README.md`, `test/ts/nativeClassifier.test.ts`, `test/ts/NativeClassifierPanel.test.tsx`, `test/classifier/io.test.mjs`, `test/classifier/test_training.py`, `test/classifier/gpu-parity.mjs`, `test/classifier/trained-model-gpu-parity.mjs`: commands, schema and parity/tests.

## Ordered implementation checklist

### 1. Shared core and browser shadow path (implemented; continue hardening only as failures/data justify)

- [x] Keep feature order and `native-morphology-v1` preprocessing contract synchronized across TS, WGSL, and exported artifacts.
- [x] Add async shader compilation/validation error propagation; invalid GPU pipelines reject.
- [ ] Test and harden busy/disposed/device-lost behavior and readback cleanup, including failures mid-flight.
- [ ] Add explicit coherence/truncation, visibility, and measurement-support metadata. The historical `partialBridge` value alone does not distinguish unavailable from absent; do not introduce a human label called “partial shape” or treat missing support as negative evidence.
- [ ] Verify temporal duplicate handling across stale/out-of-order frames, source changes, crop changes, FFT/window changes, and gaps. Test equal acquisition intervals under different repaint/frame delivery cadences. Do not silently count invalid evidence as negative persistence.
- [ ] Review provisional feature extraction for DC/spurs, random combs, sinc artifacts, partial bridges, U-dips, and coarse resolution. Current three-point envelope sampling and maximum-based scores are a starting baseline, not validated replacements for the existing geometric features.
- [ ] Bound input/model sizes and reject malformed artifacts. Keep CPU fallback or explicit unavailability distinct from a valid negative classification.

### 2. Offline prepare/extract/classify CLI (implemented; expand coverage as needed)

- [x] Add documented `node scripts/classifier/cli.mjs prepare|extract|classify` commands.
- [x] Prepare consumes an explicit dataset manifest (recording id, session id, split, label, input path, format, sample rate, center frequency). Preserve metadata rather than infer labels from filenames.
- [x] Import browser I/Q exports as independent, validated timestamped frames; preserve the explicit label and acquisition session split.
- [ ] For `.napt`, reuse `scripts/test/manual_napt_capture_harness.mjs` and its password/env handling. Never print secrets or put passwords on a command line. `decryptNaptBytes` is exported; password loading is currently private. Calling the existing CLI with structured process arguments is an alternative to changing it.
- [ ] Support standalone raw I/Q ingestion through `decodeIq`. Reject truncated I/Q pairs and nonfinite floats. Validate `.napt` metadata against explicit supplied acquisition parameters.
- [ ] Emit prepared captures and feature JSONL outside tracked source directories. Raw `.napt`, `.iq`, `.iq.*` are already ignored. Ensure derived local data is ignored as well.
- [ ] Extract multiple actual analysis-window lengths from each recording. Use shared `spectrumFromIq` and `createRunner().extract`. Keep session/split/label and preprocessing version on every row.
- [ ] Pass actual FFT length, valid sample count, window, frame timestamp, sample rates, and half-open crop interval. Explicitly report/discard tails shorter than two complex samples.
- [ ] Treat FFT-resolution/crop variants as separate temporal streams and preserve chronological order. Do not let history from one variant influence another.
- [ ] Do not change sample-rate metadata to simulate resampling; require correctly anti-aliased resampled data.
- [ ] Classify accepts arbitrary prepared captures plus a validated model and exports timestamped scores, decisions, availability, resolution, quality, and recording summaries. No training labels required for classification.
- [ ] Add CLI integration tests with generated raw I/Q in temporary directories, malformed metadata, all supported formats, crops, and incomplete frames.
- [x] Package captures with detached labels in a Data Package directory; verify V6 `.iq`/`.napt` trailer integrity, bind labels to the scoped trailer digest, preserve the original bytes, and record exact-file resource hashes. Browser JSON and WAV use filename/time identity where no V6 trailer exists.
- [x] Teach `prepare` to verify both Data Package resources and consume browser frame JSON, raw V6 `.iq`, and encrypted single-channel V6 `.napt`. Split native samples at exact option-patch and typed interruption boundaries and missing chunk ranges; preserve source offsets, update timestamps, acquisition settings, events, and labels in prepared rows.
- [ ] Support multi-channel `.napt` preparation and define channel-wise label assignment before accepting those captures into the classifier dataset. WAV remains archive-only because it is demodulated audio, not raw I/Q.
- [ ] Run a live, labeled 3.2 MS/s RTL-SDR shadow trial; report feature availability, actual FFT/bin spacing, crop visibility, and latency from recorded data. Do not fit or tune on the first acceptance capture, mock negatives, or the supplied acceptance fixtures.

### 3. Trainer and evaluator (prototypes; correctness repairs precede real-data fitting)

- [x] Implement trainer APIs/CLI and pass `test/classifier/test_training.py`.
- [ ] Complete the source-inspection repair checklist in [TRAINING_PLAN.md](./TRAINING_PLAN.md#current-trainer-findings-to-repair-first): PyTorch layer export, NumPy output-bias updates, preprocessing agreement, sampling weights, abstentions, and supported-rate claims. Existing four Python tests do not exercise fitting correctness.
- [ ] Keep NumPy/PyTorch offline dependencies in a classifier-specific requirements file and document an isolated environment. Base Python has NumPy; PyTorch/Core ML were absent when inspected.
- [ ] Exclude uncertain, acceptance, and unlabeled records from fitting/threshold selection. Reject sessions appearing in multiple splits. Normalize using training data only.
- [ ] Compare standardized logistic regression against a ReLU network with exactly 16 hidden units. Fixed seed; MPS where supported, CPU fallback; export the same portable weights used by TS/WGSL.
- [ ] Select thresholds on validation data only. Prefer logistic regression on tied balanced accuracy. Report unavailable balanced accuracy if either class is absent, rather than inventing a metric.
- [ ] Avoid long recordings dominating: use session/recording-balanced weighting and include recording-level results.
- [ ] Export id, preprocessing version, exact feature order, normalization, weights/biases, decision threshold, and actually validated sample rates. Training on a sample rate alone does not make it validated.
- [ ] Evaluate once on held-out test sessions; report precision, recall, confusion matrix, balanced accuracy, insufficient-evidence coverage, and breakdowns by session, FFT resolution, and visible fraction. Do not hide abstentions by reporting only classified rows.
- [ ] Compare the old classifier on the same FFT frames with the same crop and recorded timestamps. Reuse/extract the actual WGSL harness in `scripts/test/manual_napt_classifier_harness.mjs`; do not approximate the old classifier with new rules. Its `scoreCapture` is currently private and the CLI runs at module bottom, so make any import refactor safe and preserve existing behavior/tests.
- [ ] Calibrate the new deterministic threshold on validation data too. Keep current acceptance assertions unchanged.
- [x] Add Python vs TypeScript CPU inference parity for trained logistic and MLP artifacts using synthetic-only training rows. This proves model serialization/inference plumbing, not signal accuracy.
- [x] Add WGSL/WebGPU inference parity for trained logistic and MLP artifacts; three probes per model include an out-of-range feature. Maximum WebGPU-vs-TypeScript error: `2.75e-8` on this host.
- [x] Implement the opt-in predeclared multi-seed/L2 search runner and selection/provenance tests. It reports every candidate, selects thresholds/models from shared validation sessions only, and leaves the untouched evaluation split out of selection.

### 4. Wire browser shadow inference (implemented; live SDR proof remains)

- [ ] Integrate through a dedicated lifecycle owner/hook with at most one extraction in flight; reuse buffers, bound cadence, drop stale async results, dispose on unmount/device loss. Avoid React state updates per bin/frame.
- [ ] Native FFT insertion point: `src/ts/features/spectrum/FFTCanvas.tsx`, immediately after `rawSpectrum = resolveSpectrumWaveform(...)` in the live I/Q processing branch, before DC removal and `updateTemporalWaveform`. Snapshot the array before its reusable buffer changes.
- [ ] Derive actual FFT size from `rawSpectrum.length`, valid samples from the I/Q window actually consumed (`newestIqWindow`), and acquisition parameters/timestamp from `currentFrame`. Include source id and stream epoch in temporal ownership and sequence in frame identity. Existing backend timestamps use milliseconds.
- [ ] Existing scalar FFT computes `nextPowerOfTwo(validSamples)`, which can be smaller than the configured FFT size. Never substitute configured size for actual output size.
- [ ] Browser FFT window names are normalized through `normalizeWindowType` in `fft/complexSpectrum.ts`; map `hanning` to `hann`. Support rectangular, hamming, blackman, nuttall without mislabeling window metadata.
- [ ] Carry selected analysis interval as a native-bin crop. Keep acquisition-frequency mapping correct for negative frequencies; display mirroring must not duplicate or distort model evidence.
- [ ] Cover playback/paused reprocessing where metadata is trustworthy. If metadata is absent, report unavailable instead of guessing it from displayed bounds.
- [ ] Provide a usable local model import/load control and visible shadow diagnostics (method/model id, score, evidence status, sample-rate validation status). Invalid/missing models retain deterministic fallback. Do not automatically promote the new score to the established N-APT decision.
- [ ] Preserve existing spike shaders, callbacks/readback contracts, and displayed classifier result.
- [ ] Add lifecycle/integration tests proving resize/repaint invariance, source reset, no stale result publication, and model failure fallback.

### 5. Acceptance, measurement, and documentation (partially complete; next work)

- [ ] Existing labels/assertions are in `test/fixtures/napt-classifier/regression.json`: 8 morphology positives, 4 mock negatives, 5 interference-only cases. Do not treat the last five as morphology labels.
- [x] User samples: `/Users/ceanelamerez/Desktop/samples-for-shaders/` (17 encrypted captures) were decrypted through the existing local harness into ignored local fixtures; no secrets were printed. Existing 12 morphology captures were also run through multiresolution offline extraction as acceptance-only data.
- [x] Run unchanged legacy acceptance assertions and retain every failure without lowering thresholds. Keep fixture provenance out of fitting/threshold selection.
- [ ] Record a fair old-rules/new-rules/ML comparison on shared frames and independent labeled sessions. If independent labeled sessions are absent, report that limitation; do not claim generalization or fabricate an accuracy result. The current new-rule prototype scored balanced accuracy 0.50 on acceptance-only sampled windows (all negatives were false positives); this is a diagnostic warning, not a validation metric.
- [ ] Measure warm/cold inference and extraction latency, drops, and render impact on the connected SDR. Standalone shader timing is not live rendering proof. Do not alter hardware settings unnecessarily.
- [ ] Document commands, manifest/feature/model schemas, split discipline, sample-rate/resolution limitations, Swift deferral, and promotion criteria.
- [ ] Run focused tests and typecheck, inspect `git diff --check` and status; leave user changes intact. No commit/push unless requested.

## Continuation progress (2026-09-23)

- [x] Added standalone manifest validation and I/Q decode/prepare/extract/classify commands in `cli.mjs`.
- [x] Added shared offline FFT matching the application's scalar FFT windows, actual window sample count, and zero-padding contract.
- [x] Added NumPy logistic regression and 16-unit ReLU MLP; optional PyTorch/MPS accelerator with NumPy fallback, session-balanced weights, validation balanced-accuracy threshold selection, and test reporting by recording/session/FFT-size/visibility.
- [x] Added a local-model JSON loader and wired timestamped live frames to native GPU features/inference before DC removal/display processing. Results are explicitly marked experimental shadow diagnostics; the established rendered classifier result is untouched.
- [x] Added shader compilation-error checks and a small offline Python dependency file.
- [x] Exercised a synthetic raw-I/Q prepare → extract → train → classify flow (42 rows); the synthetic test/validation scores are plumbing checks only.
- [x] Ran the 17-case legacy browser acceptance harness: 3 cases passed, 14 failed. Failures include morphology false negatives, all four mock negatives falsely triggering morphology, and interference boundary errors; see the generated local result at `/private/tmp/napt-existing-acceptance/legacy-full.json`.
- [x] Fixed the regression manifest runner so interference-only cases may omit morphology labels and are not treated as morphology negatives.
- [ ] Improve validation of arbitrary real recordings, calibrate the feature extractor, run full legacy acceptance comparison, and measure connected SDR performance.

## Verification already performed

- `node node_modules/jest/bin/jest.js test/ts/nativeClassifier.test.ts --runInBand --silent`: **12 tests pass**. Includes metadata/cropping, acquired resolution, invalid bins, coarse-resolution availability, gain invariance, basic history, model validation, and offline FFT vs existing browser scalar FFT for five windows with full/incomplete input.
- `node --test test/classifier/io.test.mjs`: **5 tests pass**.
- `node test/classifier/gpu-parity.mjs`: **passes on actual local Chromium WebGPU** for 1,024/4,096/16,384 bins, full/cropped frames, logistic and 16-unit MLP. Maximum per-bin feature difference ~1.29e-5; inference difference ~6.62e-8. Warm extraction including readback ~2.8–3.2 ms in this small run; first call ~97 ms. This is not a broad benchmark or live SDR result.
- Chromium required sandbox escalation for macOS Mach/GPU services. The test launches an isolated temporary profile, not the user's browser.
- `python3 -m unittest discover -s test/classifier -p 'test_training.py'`: **25 tests pass, 3 optional PyTorch tests skipped** with the default Python environment. Coverage includes group-disjoint monitoring, early-stop checkpoint restore, run provenance, Python/TypeScript parity for trained artifacts, explicit unavailable-MPS failure, grid selection/tie rules, shared split use, and unique candidate exports.
- The same Python suite in a temporary CPython 3.14/PyTorch 2.14 environment: **25 tests pass** on CPU. `torch.backends.mps.is_available()` returned false. The temporary environment was removed after the run.
- `env NAPT_RUN_WEBGPU_PARITY=1 python3 -m unittest discover -s test/classifier -p 'test_training.py' -k trained_logistic_and_mlp_artifacts_match_typescript_inference`: **passes**. It trains synthetic logistic/MLP candidates, checks Python-to-TypeScript parity, then uses an isolated headless Playwright/Chromium WebGPU runner to compare both trained artifacts with TypeScript inference on three probes each. Maximum WebGPU-vs-TypeScript score error was `2.7474e-8`. This one-off required local macOS process permission; no screenshots, app navigation, capture data, or signal-accuracy claim were involved.
- The trainer round-trip used tiny generated feature rows only. No recording, acceptance fixture, SDR capture, or real-data accuracy claim was used.
- `node node_modules/typescript/bin/tsc --noEmit --ignoreDeprecations 6.0 --pretty false`: **passes** after replacing two ES target compatibility calls in the new core.
- Combined focused regression/classifier tests: **5 Jest suites / 42 tests pass**, plus **4 Python** and **4 Node I/Q pipeline tests**.

## Suggested next work

The [learning and evaluation plan](./TRAINING_PLAN.md) supplies the method discussion and concrete proposed experiment. Its defaults are starting points, not measured optimum settings. Continue in this order:

1. [x] Add `StreamInterrupted` emission at the Rust V6 writer boundary after device reclaim. The marker is attached to the first subsequently accepted frame at the same byte offset and timestamp as any co-located `PatchOptionsApplied` event. A Rust regression checks the boundary, and the V6 package acceptance test verifies interruption markers stay separate from option patches. Physical hot-reload/device-reclaim behavior still needs hardware validation.
2. Collect independently labeled positive and real RF negative sessions at 3.2 MS/s; compare rules and both candidates on shared frames. Keep each acquisition session separate, use session-balanced validation, and evaluate once on untouched sessions. Synthetic mocks remain a separate challenge set.
3. Measure browser latency/render impact across representative live sessions before considering promotion. Prefer logistic regression when the neural candidate does not justify its added complexity.

The live readiness mismatch was resolved in the Sep 27 check without changing acquisition settings. The Rust writer boundary now emits interruption markers and the mock writer regression passes; physical hot-reload/device-reclaim behavior remains unverified. Continue with independently labeled real-signal and real-negative sessions when the live capture is fresh and metadata-consistent. Do not promote a model or claim real-capture accuracy from synthetic tests. The shared worktree also contains unrelated demod/audio-survey edits; preserve those.

## Continuation progress (2026-09-27)

- [x] Normalize typed V6 `StreamInterrupted` frame updates (`code: 1`) separately from option patches during package preparation. Both events keep their original byte offset and timestamp; a co-located option change starts the following segment with its own applied acquisition settings.
- [x] Add synthetic V6 `.iq` package → prepare → headless WebGPU extract regressions. They verify that the event, timestamp, source byte offset, and co-located option patch reach the resulting feature row without joining segments, and that malformed interruption frame sequences are rejected.
- [x] Recheck feature sufficiency against `native-morphology-v1`: peak spacing is within one spectrum, and temporal summaries cover bridge/U-dip persistence only. The current vector cannot represent pulse rate, duty cycle, modulation depth, or rise/fall timing; keep those annotations out of model inputs until a versioned feature extension is designed and parity-tested.
- [x] Read-only live browser smoke check with RTL-SDR v4 shown as RX/Receiving/Simplex at 3.2 MS/s: two fresh shadow diagnostics reported 2,048 FFT bins, 1,562.5 Hz/bin and effective resolution, all 2,048 retained bins visible, rule scores 0.926 and 0.938, and sampled latency of 20.3 ms and 3.3 ms. These are point observations, not a benchmark or accuracy result.
- [ ] Training capture remained disabled with `Latest frame mismatch: metadata or window does not match.` The displayed reason does not expose which failed predicate; no capture was started or labeled, and no model was loaded. Add precise readiness diagnostics and recheck without changing source settings.
- [ ] Capture-writer interruption emission is absent from the inspected WebUSB and Rust paths; implement it before treating V6 recordings as interruption-aware. Broad live latency/render impact and RF accuracy remain unmeasured.

## Continuation progress (2026-09-27, live readiness and disconnect handling)

- [x] Resolved the title-case window mismatch that disabled capture readiness: source and frame window names now share one canonical mapping (`Rectangular` → `rectangular`, `Hanning` → `hann`). Readiness also reports source/status, stream epoch, options revision, complete I/Q byte count, freshness, and applied-versus-frame acquisition metadata individually.
- [x] While a live training capture is active, an explicit selected RTL-SDR `disconnected` status stops recording with a user-facing reconnect request. Stale frames and non-receiving sources retain separate explanations.
- [x] Read-only live browser check after the fix: RTL-SDR v4 RX/Receiving/Simplex, 3.2 MS/s, 2,048 FFT, Rectangular window, Lossless temporal resolution; 1,562.50 Hz/bin and effective resolution; bins 0–2,048 retained (100% visible); current rule score 0.773 and sampled latency 16.1 ms. Start training capture is enabled. No capture was started; labels remain Uncertain/Unspecified, and no model is loaded. This single frame is a readiness smoke check, not a benchmark or accuracy result.
- [x] Focused classifier/canvas regressions pass: 4 Jest suites, 75 tests. A broader `npm test` run exposed unrelated failures in the dirty AuthenticationRoute and component-architecture checks; the added reconnect UI test was initially red and now passes in the focused suite.
- [ ] Capture labeled, independently acquired positive and real-negative sessions, preserving each session separately. Continue to avoid acceptance-fixture tuning and accuracy claims until held-out recordings exist.
- [x] On Sep 28, added Rust V6 writer-side `StreamInterrupted` emission after device reclaim, aligned with the next accepted frame's byte offset and timestamp; focused regression passed. This supersedes the writer status reported in this Sep 27 snapshot. Physical device-reclaim/hot-reload validation remains open.

## Continuation progress (2026-09-28)

- [x] Changed the browser capture path to consume raw I/Q ingress frames directly rather than relying on canvas repaint/coalescing. The first capture frame is anchored after the latest observed acquisition boundary.
- [x] Changed V6 export from temporary auto-click downloads followed by immediate buffer deletion to two persistent, explicit download links. The captured bytes and label sidecar remain available until the user downloads them and clears that session; object URLs are revoked on clear or unmount. Export errors retain the capture for retry.
- [x] Added/updated capture UI coverage for the separate `.iq` and `.json` links, filenames, and locked-until-clear behavior. Focused classifier/capture/canvas tests pass: 3 suites, 100 tests. TypeScript typecheck and scoped `git diff --check` pass.
- [x] Live shadow results are now withheld when their timestamp is stale or the latest live frame does not match the selected source/applied acquisition metadata. A mismatch invalidates in-flight inference so a held pre-tune frame cannot publish as a current result. The panel distinguishes stale frames from metadata-mismatched frames.
- [x] Timeout interruption markers now use the last acquired frame timestamp instead of browser wall-clock time when no following frame arrived. A regression asserts frame sequence, timestamp, and byte offset alignment.
- [x] Read-only browser diagnostics confirmed an active shadow result at 3.2 MS/s, 2,048 FFT, 1,562.5 Hz/bin, retained bins 11–2048 (99.5% visible), score 0.930, and 2.2 ms sampled latency. This is a live point observation, not a performance benchmark or accuracy result.
- [ ] Capture is currently blocked safely by an intermittent acquisition metadata mismatch: applied/source center frequency is 1,618,000 Hz while the retained frame reports 1,600,000 Hz. After Rust hot-reload, the browser briefly reported READY on a matching 2,048-bin frame (1,562.5 Hz/bin, full crop, score 0.933, sampled latency 2.0 ms), then returned to WAITING with the 1,600,000 Hz frame and score withheld. A read-only `/status` response at 2026-09-28 16:53:36 UTC returned HTTP 200 and reported RTL-SDR `receiving`, unpaused, stream epoch 2, 3.2 MS/s, 2,048 FFT, Rectangular, with 2 connected clients. Do not record until matching frames remain fresh. No acquisition-setting change was made.
- [ ] The new persistent download links have not yet been exercised with a fresh live capture because readiness is blocked by that center-frequency mismatch. No capture or label was produced in this continuation.
- [x] Rechecked live health and browser readiness read-only after the hot-reload. The current page is again WAITING with the center mismatch; source health still says receiving. The app terminal summary contains cumulative earlier USB-claim/build/replacement errors and also says the new backend build is running, so those historical lines do not prove a current disconnect or current build failure. The browser console has no stream error (only an unrelated React Flow attribution warning).
- [ ] Once matching frames remain fresh, collect separately labeled sessions. Continue to keep the current real signal distinct from sinc/mock challenge data and leave accuracy claims pending independent sessions.

## Continuation progress (2026-09-28, live correction revision convergence)

- [x] Fixed live option correction readiness getting stuck until refresh: a matching backend acknowledgement now propagates its device-global options revision and effective source settings to Redux while preserving the locally changed spectrum view. Old-revision frames remain rejected until a frame carrying the acknowledged revision arrives.
- [x] Added regressions for a live correction where the backend acknowledgement revision is higher than the manager's optimistic revision, Redux replacement of that revision, and source-snapshot reconciliation without spectrum-view rehydration. Focused managed-stream, middleware, and training-capture tests pass: 3 suites, 205 tests.
- [ ] Live browser correction remains unverified. At the last read-only `/status` check, RTL-SDR reported `receiving`, center 1.600 MHz, 3.2 MS/s, 2,048 FFT, Rectangular, epoch 1. No tune, settings change, or capture was performed. The in-app browser tab exposed only the document root, so current classifier diagnostics were unavailable.
- [ ] Fresh Playwright inspection confirmed the blank page is blocked by a stale, mixed Vite dependency prebundle: `@react-three/drei` requests `react-three-fiber.esm-DGZUWiFc.js?v=0b988003`, while the current fiber entry points to `react-three-fiber.esm-qkwyA3P0.js`; the old versioned fiber entry returns HTTP 504 and the current unversioned entry returns 200. The resulting `Bounds` hook-context errors leave the React root empty. No backend or frontend restart was attempted. After the temporary browser closed, `/status` still reported RTL-SDR `receiving`, unpaused, epoch 1, 1.600 MHz, 3.2 MS/s, 2,048 FFT, Rectangular, and zero clients.
- [x] After the user restarted Vite, the in-app browser rendered the classifier again. A live diagnostic sample showed `ready`, 2,048 FFT, 1,562.50 Hz/bin and effective resolution, all 2,048 bins visible, rule score 0.926, and sampled extraction latency 2.8 ms. This is a point observation, not an accuracy or latency benchmark.
- [ ] A concurrent-instance caveat remains: read-only process/socket checks found Vite listeners on both ports 5173 and 5174, browser connections to both, and `/status` reporting six clients. At the latest status check RTL-SDR was receiving and unpaused at 1.618 MHz, 3.2 MS/s, 2,048 FFT, 24 logical FPS, Rectangular, epoch 1. No backend restart, retune, acquisition-setting change, capture, or label was performed by this continuation. A live-correction test must be isolated from competing app instances before its result can be attributed.
