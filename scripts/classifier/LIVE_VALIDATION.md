# Live validation and Luna handoff — 2026-09-23

## Verified this pass

- Existing backend was kept running; no retuning or acquisition settings changes were requested by the agent.
- Read-only `/status` and `/api/agent/status` showed real RTL-SDR source `rtl-sdr-00000001`, receiving, not paused, 3,200,000 S/s, center 1,600,000 Hz, FFT 2,048, rectangular window. UI gain 46.9 dB, PPM 1, AGCs off. Backend reported connected with two authenticated clients.
- Last logged shutdown was SIGTERM at 2026-09-23 09:01:48 America/Los_Angeles; startup followed at 09:02:02. This establishes a signal-driven stop, not its initiator. No panic cause was established. Raw lifecycle excerpt and health snapshots: `/private/tmp/napt-live-validation-20260923/`.
- Fixed a real integration defect: main spectrum route passes `showSpikeOverlay=false`, so the classifier previously never ran there. Added independent `showNativeClassifier` and enabled it for this route without enabling spikes.
- Luna added actual frame FFT length, retained half-open bin interval, visible fraction and timestamp to the diagnostics. Live page showed `ready; 2048 FFT; 1562.50 Hz/bin; 1562.50 Hz effective resolution; retained bins 0–2048 (100.0% visible)`, changing timestamps and scores (observed rule 0.929 and 0.936). Spot extraction latencies were 3.3 and 6.7 ms. These are two observations, not a latency distribution or rendering-impact benchmark.
- Focused UI/regression tests passed: 3 suites, 63 tests. A red test proved the independent-classifier regression before the fix.
- Final health check still showed connected/unpaused at 3.2 MS/s, but center frequency had changed from 1.600 to 1.618 MHz during this pass. No explicit tuning command or capture start was sent by this agent. The initiating client is unverified; frontend hot reload or another client may have reconciled the onscreen range. Do not claim acquisition remained identical, and do not retune it back. Avoid further frontend reloads during a future stable capture window until that behavior is understood.

## User labeling and setup

User identifies channels A/B and previously labeled positive recordings in the Desktop `samples-for-shaders` folder as target morphology. Mock captures remain labeled negative; they do not provide real-RF negative diversity. Downloads recordings remain unlabeled. Current live view initially had interference; user subsequently reported much less interference and moved the antenna in front of the Mac, describing the environment as similar to the past two days. This note is provenance, not an automatic label for every acquired frame. Keep the existing acceptance fixtures out of fitting and threshold choice.

## Critical capture constraint

Do not use the existing backend Capture button during this no-retune pass: `src/rs/capture/session.rs` applies FFT settings, flushes queues, tunes the first fragment and auto-unpauses. The onscreen requested range also differs from the current acquisition bounds. No new raw I/Q recordings were collected by this pass. Do not pretend spot diagnostics or concatenated discontinuous browser frames are a continuous capture.

## Current implementation and next work

The guarded Lossless recording controls and full per-frame I/Q export are implemented and idle. See `LUNA_RECORDING_HANDOFF.md`; offline CLI ingestion and same-frame comparison remain. The 4 focused suites / 70 tests and typecheck pass. See `CAPTURE_QUALITY_HANDOFF.md` for the separate, still unimplemented shared configurable contract for demod and classifier quality profiles. No new recording or physical disconnect test was performed.

## Next bounded task after recording works

Build the same-input comparison command: adapt/import the actual legacy WGSL harness safely, score recorded frame boundaries with both old and native classifiers, preserve timestamps and crop/FFT metadata, and emit per-session diagnostics and disagreement counts. No threshold tuning or accuracy claims without independently labeled held-out sessions. Then manually collect A/B and independent real-negative sessions; changing channels requires the user to retune or explicitly lift the no-retune constraint. Multiple clips from one acquisition stay in one split.

## Unstoppable Code task prompt

Use GPT 6 Luna, one bounded read-only review first. Open the existing checkout `/Users/ceanelamerez/Documents/codescratch.nosync/n-apt` directly; a fresh worktree from HEAD will miss uncommitted classifier files. Read this file and `LUNA_RECORDING_HANDOFF.md`. Review only the recorder changes for stale/no-frame timeout, source/epoch/config mismatch, lossless temporal eligibility, full payload preservation, and same-frame assumptions. Return concrete bugs with file/line and minimal regression test suggestions. Do not edit, restart processes, access credentials, control SDR, train models, or tune thresholds. Stop after the review; no recurring loop, no model upgrade to Astra. The external review task was not submitted and no credits were spent.
