# Luna handoff: resolution-aware browser classifier

## Task and current stopping point

**Latest priority (2026-09-24):** The trainer now has a WIP reproducibility slice with an opt-in predeclared L2/seed search. It reserves whole training sessions for MLP monitoring when both classes can stay on both sides, stops on monitor patience and restores the best checkpoint, exposes training controls, emits uniquely named candidate artifacts, records a feature-dataset/split/runtime/code manifest, and checks trained logistic/MLP artifact parity through TypeScript CPU inference. Search and tie-breaking rules are recorded in the report and plan; all candidates use shared fitting/monitor/validation sessions and validation only. The default Python suite passes 25 tests with three optional PyTorch tests skipped. A temporary CPython 3.14/PyTorch 2.14 environment passes all 25 tests on CPU; this host reports MPS unavailable. No real recordings were fitted. Trained-artifact WGSL/WebGPU parity remains pending.

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
- `scripts/classifier/README.md`, `test/ts/nativeClassifier.test.ts`, `test/ts/NativeClassifierPanel.test.tsx`, `test/classifier/io.test.mjs`, `test/classifier/test_training.py`, `test/classifier/gpu-parity.mjs`: commands, schema and parity/tests.

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
- [ ] Add WGSL/WebGPU inference parity for both trained artifact kinds; test bias and out-of-range inputs.
- [ ] Implement the predeclared multi-seed/L2 search runner and its selection/provenance tests. Keep the untouched evaluation split out of candidate selection.

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
- `python3 -m unittest discover -s test/classifier -p 'test_training.py'`: **25 tests pass, 3 optional PyTorch tests skipped** with the default Python environment. Coverage includes group-disjoint monitoring, early-stop checkpoint restore, run provenance, TypeScript parity for trained artifacts, explicit unavailable-MPS failure, grid selection/tie rules, shared split use, and unique candidate exports. TypeScript parity uses local Node/tsx CPU inference; it does not execute WebGPU.
- The same Python suite in a temporary CPython 3.14/PyTorch 2.14 environment: **25 tests pass** on CPU. `torch.backends.mps.is_available()` returned false. The temporary environment was removed after the run.
- The trainer round-trip used tiny generated feature rows only. No recording, acceptance fixture, SDR capture, or real-data accuracy claim was used.
- `node node_modules/typescript/bin/tsc --noEmit --ignoreDeprecations 6.0 --pretty false`: **passes** after replacing two ES target compatibility calls in the new core.
- Combined focused regression/classifier tests: **5 Jest suites / 42 tests pass**, plus **4 Python** and **4 Node I/Q pipeline tests**.

## Suggested next work

The [learning and evaluation plan](./TRAINING_PLAN.md) supplies the method discussion and concrete proposed experiment. Its defaults are starting points, not measured optimum settings. Continue in this order:

1. The predeclared multi-seed/L2 search is implemented behind `--search-grid`; next verify trained-artifact WGSL/WebGPU parity. Do not run browser/WebGPU automation under the current repository guidance.
2. Verify V6 capture option/interruption boundaries and external label provenance through offline extraction.
3. Audit feature sufficiency, especially pulsing and availability. Learning combinations of existing features cannot recover information the extractor discarded.
4. Collect independently labeled positive and real RF negative sessions at 3.2 MS/s; compare rules and both candidates on shared frames. Use validation session-balanced balanced accuracy, preserve all session splits, and evaluate the selected model once on untouched sessions. Synthetic mocks remain a separate challenge set.
5. Measure browser latency/render impact in shadow mode before considering promotion. Prefer logistic regression when the neural candidate does not justify its added complexity.

The next bounded implementation task is **the reproducible experiment runner and trained-artifact parity**, not model promotion or real-capture training. This trainer step is a focused classifier commit; unrelated demod/audio-survey work remains outside it.
