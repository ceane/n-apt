# N-APT classifier training checklist

Use this checklist for each collection and training run. Keep every original capture, its detached annotations, and all derived windows/crops traceable to one acquisition session. For the model choices and why they work, see [TRAINING_PLAN.md](TRAINING_PLAN.md); command details are in [README.md](README.md).

## Collect and label

- [ ] Select the live RTL-SDR source and confirm it reports Receiving with fresh frames. For the initial trial, retain 3.2 MS/s, Lossless temporal resolution, and a Rectangular window.
- [ ] Confirm the classifier reports the frame's FFT size, `sampleRate / fftSize` bin spacing, retained-bin interval and visible fraction, current score, and extraction latency. Verify the frame belongs to the selected source and current applied options.
- [ ] Before recording, label only what the user can confirm: matching, nonmatching, or uncertain; Channel A/B when known; morphology toggles; and separate condition tags such as interference. Keep uncertain intervals out of supervised labels.
- [ ] Record a stable interval. If the source disconnects or frames become stale, stop and preserve the interruption; reconnect before recording again. A tune, FFT, rate, window, or source change ends the current classifier capture. Wait for fresh matching frames and start a separate capture after each change.
- [ ] Preserve one package per capture position. Give positions from one deliberate sweep a shared acquisition-session ID when preparing them, and keep that whole sweep in one data split.
- [ ] Collect independently labeled positive and real RF nonmatching sessions. Keep app mocks and sinc probes in their challenge splits; keep supplied acceptance captures acceptance-only. Never turn an uncertain or merely interfered view into a negative label.

## Package and prepare

- [ ] Download the single browser Data Package ZIP. Archive it into the local classification checkout with `archive-package.mjs`; check the split before saving. This is local staging and does not push to Hugging Face.
- [ ] Verify the Data Package resource hashes and capture identity. Keep labels detached from the I/Q bytes and bound to the V6 trailer checksum when available.
- [ ] Run `prepare --package` into a new local-only output directory. Check frame-marker count, timestamps, sequence, sample count, applied-option patches, and interruption boundaries. Reject malformed or incomplete lossless frame metadata.
- [ ] For multiple positions from one sweep, pass the same `--session <sweep-id>` to each `prepare` invocation. Preserve each source package separately; do not treat hop captures as independent sessions.

## Extract and fit

- [ ] Extract with the shared WGSL feature path. Use actual analysis windows supported by the captured sample count; `binHz = sampleRate / fftSize`. Use real shorter windows to test lower resolution. Zero-padding and display resizing do not recover missing detail.
- [ ] Test full-band and selected frequency crops while preserving each crop's original bin origin and visibility. Keep every derivative in its parent recording's split; unavailable evidence stays unavailable, not confidently absent.
- [ ] Evaluate mock and sinc captures explicitly with `train.py evaluate --split challenge-mock` or `--split challenge-sinc`. Keep those rows out of fitting, validation threshold selection, and real-RF performance claims.
- [ ] Before fitting, verify that train, validation, and untouched test each contain whole, independent acquisition sessions for both classes. If they do not, report the data shortfall and limit the run to plumbing or grouped exploratory analysis.
- [ ] Compare the existing classifier and improved deterministic rules with logistic regression and the 16-unit MLP on the same eligible recordings. Fix the candidate grid before the run; use validation session-balanced balanced accuracy for candidate and threshold selection.
- [ ] Do not inspect the untouched test split until the candidate and threshold are frozen. Evaluate it once, without tuning on its results.

## Validate and report

- [ ] Report results by acquisition session, FFT resolution, crop visibility, label, and evidence quality. Include insufficient-evidence coverage and reasons alongside balanced accuracy; disclose how many sessions each class contributes.
- [ ] Report capture-to-feature and live inference latency separately. Check that canvas resizing does not affect classification and that source/history resets occur at the right boundaries.
- [ ] Verify Python, TypeScript, and WGSL numerical agreement for the exported model and preprocessing metadata.
- [ ] Load the candidate in browser shadow mode while retaining the existing classifier. Promote only after independent evaluation supports the change across resolutions and visibility groups without hiding failures.

## Current data gate

As of 2026-10-01, the local classification archive contains four user-labeled Channel A positive sessions, all assigned to `train`; two are tagged `interference visible`, one explicitly says `no interference`, and one has no condition tag (treat the missing tag as unknown, not as confirmed clean). Two newer sessions have complete timestamped V6 `Frame` updates and are eligible for temporal analysis. Two older packages lack those per-frame markers and remain ineligible for temporal training/evaluation as-is. The current archive has no independent real RF negatives, validation sessions, untouched test sessions, or actual `challenge-mock`/`challenge-sinc` recordings. Do not count encrypted storage copies or derived FFT/crop rows as additional sessions. The labeled positives do not justify binary model fitting, threshold selection, or accuracy claims.
