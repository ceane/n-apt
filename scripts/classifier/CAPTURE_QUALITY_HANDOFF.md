# Capture quality contract handoff

## Goal

Add one shared acquisition and frame-quality evaluator under `src/ts/features/capture/`. It should let each consumer declare its own requirements while reporting what the selected source can provide and what frames actually deliver. The initial implementation below is complete for the pure contract, demod status, classifier Start eligibility, concrete `capture iq` preflight options, backend application, and job-correlated effective-settings acknowledgement. Recorder metadata attachment and offline CLI ingestion/comparison remain follow-up work.

## Contract checklist

- [x] Define consumer profiles for **demodulation**, **classifier/training**, and **I/Q capture CLI**. The profiles specify temporal mode, demod FFT/rate floors, classifier effective resolution/visible-bin needs, cadence/gap expectations, and raw-I/Q continuity.
- [x] Model **requested**, **effective/configured**, and **observed** values separately. Missing observed frame data stays unknown; evaluator and intent resolution report `settingsDispatches: 0`.
- [x] Evaluate capability fit before capture: indicate whether the selected source is real/RX/receiving and whether reported sample-rate, FFT, and frame-rate limits support the profile.
- [x] Evaluate actual frame metadata including source/epoch/sequence/timestamp, receive status, sample rate, center, FFT length, window, acquired complex sample count, visible-bin range, and raw-I/Q byte count. Bin spacing uses actual FFT; effective resolution uses window ENBW and acquired samples, not zero-padding.
- [x] Compute cadence/gaps from provided frames separately from requested rate and display mode. Staleness, reorder, gaps, epoch changes, and slow observed cadence are reported. The FFTCanvas Start gate evaluates the freshest frame and retains recorder continuity checks during append.
- [ ] Treat “lossless I/Q” as preserving every sample in the received raw payload with ordering and continuity evidence. The WebSocket `iq_data` contract is the full raw I/Q payload (`src/ts/consts/schemas/websocket.ts`, `IqRawFramePayload`); do not call an FFT-sized sliding window a lossless recording.
- [x] Keep live evaluation observational. Demod retains its existing Lossless display-mode barrier and now reports unmet profile requirements; no hardware settings are changed by the evaluator. `capture iq` resolves concrete options, and the backend applies and acknowledges them before activating the job.

## Integration order

1. [x] Implement the pure shared profile types and evaluator under `src/ts/features/capture/`.
2. [x] Adapt demodulation to supply the profile and render live status for FFT/rate/capability/source/temporal requirements.
3. [x] Adapt native classifier training Start eligibility to use the classifier profile alongside existing fresh-frame/source/workflow guards.
4. [ ] Attach the shared assessment to every recorder session/frame export. Current recorder continuity checks remain authoritative; assessment serialization is outstanding.
5. [x] Add CLI preflight to `scripts/cli/index.ts` `capture iq` before source selection, with `--quality-profile iq-capture-cli|demodulation|classifier-training`; resolve concrete sample-rate, FFT-size, FFT-window, and frame-rate options, then require the backend's effective-settings acknowledgement.
6. [ ] Add offline CLI ingestion/comparison of captured examples and actual-vs-requested quality.

## Regression checks

- [ ] Demod profile accepts a capable source with actual FFT/resolution and lossless temporal handling, and reports insufficient resolution or temporal degradation when either requirement is missed.
- [ ] Classifier profile can accept different FFT sizes when native-bin support is adequate, but marks coarse, cropped, or otherwise unresolved features unavailable instead of absent.
- [ ] Configured FFT size and rate differing from actual frame metadata are reported as a mismatch; resolution is calculated from actual analysis rate and length, with window and acquired sample count preserved.
- [ ] Receiving-status loss, stale timestamps, sequence gaps/reordering, or stream-epoch changes invalidate or explicitly degrade the capture; non-RX, mock, paused, and disconnected sources fail live-capture eligibility.
- [ ] A lossless I/Q fixture round-trips the entire raw WebSocket payload byte-for-byte and proves gaps cannot be presented as continuous data. Display lossless alone must not pass this check.
- [x] Evaluating or rejecting a profile makes no settings, tuning, or source-routing dispatches.

## Current boundary and validation

`src/ts/features/capture/quality.ts` remains a pure evaluator and option resolver. The demod node displays evaluator reasons, filters FFT choices below 32,768, rejects frame-rate edits below 30 FPS, and preserves the existing Lossless temporal selection behavior. Existing already-configured low values remain unchanged and visible as unmet status; this does not auto-retune a running SDR. Actual live raw frames are not exposed to this node, so observed-frame fields remain unknown. It is a visible refusal/readiness status, not a graph-execution gate because this node owns no demod start action; a downstream demod execution boundary still needs to consume `fit`. The classifier Start button accepts evaluator `ready` or `awaiting-observation` when independent fresh-frame/source/config gates pass; bounded history reports cadence without blocking an explicit start on a second frame. Recorder append-time continuity/stale stops and settings-change stop checks remain authoritative. CLI emits concrete preflight options, sends them with `StartCapture`, and requires a matching backend `started.settingsApplied` acknowledgement. Actual live capture was not exercised by this handoff.

Focused tests passed: `captureQuality.test.ts`, `SignalConfigNode.test.tsx`, `nativeTrainingCapture.test.ts`, and `FFTCanvas.test.tsx` (72 tests). Typecheck passed (`npm run typecheck`, exit 0).

## Relevant ownership

- `src/ts/features/capture/policy.ts`: existing shared capture policy area and suggested neighbor for the pure evaluator.
- `src/ts/consts/schemas/websocket.ts`: actual raw I/Q and v2 lifecycle fields (`IqRawFramePayload`, `IqRawFrameV2`).
- `src/ts/features/demodulation/utils/demodQuality.ts`, `src/ts/features/demodulation/react-flow/nodes/SignalConfigNode.tsx`: current demod requirements and live-route gap.
- `src/ts/shared/math/signals.ts`: theoretical logical frame-rate ceiling; it is not an observed cadence measurement.
- `src/ts/features/classification/native/core.ts`: classifier feature-resolution contract and missing/visibility representation.
