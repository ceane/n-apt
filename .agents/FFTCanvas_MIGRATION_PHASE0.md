# FFTCanvas Render Migration — Phase 0 Baseline

Date: 2026-07-25

## Active composition points

`FFTCanvas` currently composes these domain hooks:

- `useCanvasState`: canvas nodes, refs, and parent-owned waterfall bindings.
- `useWebGPUInit`: WebGPU device, format, initialization, retry, and loss lifecycle.
- `useWasmSimdMath`: IQ/spectrum math with SIMD and scalar fallback paths.
- `useWaterfallBufferPool`: reusable waterfall buffer ownership.
- `useFrequencyDrag`: spectrum interaction, selection, zoom, pan, pinch, and TX slider input.
- `useOverlayRenderer`: grid, marker, selection, and related overlay drawing.
- `useSpectrumRenderer`: spectrum rendering and composition of overlay rendering.

These hooks are existing seams and should be reused by the render migration rather than
replaced with a single aggregate hook.

## Suspected duplicate or dormant extraction layers

- `useFFTHandlers` is not imported by `FFTCanvas` and appears to duplicate spectrum processing
  and rendering responsibilities.
- `useWaterfallHandlers` has no active `FFTCanvas` call site and contains remnants of the
  removed heterodyning history path.

These require caller verification before either is expanded or renamed. If they remain unused,
retire them after the coordinator extraction rather than creating another parallel pipeline.

## onRenderFrame responsibilities to separate later

The callback in `FFTCanvas` currently sequences:

1. source/frame acceptance and stale-presentation rejection;
2. loading, standby, and error placeholder policy;
3. IQ/preprocessed waveform processing and temporal averaging;
4. full-channel hop accumulation;
5. spectrum and waterfall rendering;
6. overlay and presentation side effects.

The first extraction target should be pure frame-presentation policy. Processing and rendering
should remain behind the existing math, buffer, spectrum, and overlay seams until their contracts
are explicit.

## Phase 1 change completed

`FFTCanvasWaterfallBindings` now lives in `src/ts/types/canvas.ts`. `FFTCanvas`,
`FFTAndWaterfall`, and `useCanvasState` import the shared type, removing the hook-to-component
type dependency.

## Baseline verification

- `git diff --check`: passed for the Phase 1 files.
- `npm run typecheck`: blocked by the pre-existing missing
  `src/ts/hooks/sourceSwitchCoordinator` module referenced by
  `test/ts/sourceSwitchCoordinator.test.ts`.
- Focused FFT/canvas tests: blocked by pre-existing selector fixture failures where
  `selectSourceSelectionState` receives an undefined state branch and reads
  `selectedSourceId`.

Those failures are outside the shared-type move and should be resolved or explicitly baselined
before extracting `onRenderFrame`.

## Phase 2 change completed

The active `FFTCanvas` composition now uses canonical ownership names:

- `useCanvasNodes`
- `useWebGPULifecycle`
- `useSpectrumMath`
- `useWaterfallBuffers`
- `useSpectrumInteraction`

The existing names remain deprecated compatibility aliases so other callers and tests can
migrate independently. No render behavior or hook contracts were otherwise changed.

## Phase 3 change completed

The frame-selection and placeholder decision logic previously embedded in `onRenderFrame` now
lives in `src/ts/components/fft/framePresentation.ts`. The pure policy covers:

- incoming versus paused/standby cached-frame selection;
- source ownership and stale-frame classification;
- renderable-frame detection;
- loading, error, standby, and explicit-placeholder precedence;
- frame-gap preservation decisions; and
- blocking placeholder classification.

`onRenderFrame` still owns imperative resets, processing, GPU drawing, and notifications. This
keeps the extraction behavioral and gives the next phase a stable processing boundary.

## Phase 4 change completed

Temporal waveform preparation now lives in
`src/ts/components/fft/frameProcessing.ts`. `updateTemporalWaveform` owns ring-buffer sizing,
write-index rotation, active-frame ordering, and reusable averaging output. `FFTCanvas` retains
the mutable refs and calls the helper from both live-IQ and preprocessed-frame paths, eliminating
the duplicated temporal averaging implementation without changing source handoff or rendering
side effects.

The broader spectrum-frame processor (IQ conversion, full-channel hop accumulation, and GPU
submission) remains in `FFTCanvas` for a later phase because those responsibilities still depend
on component-owned refs and renderer contracts.

## Phase 5 change completed

Full-channel hop accumulation now lives alongside the temporal preparation helper in
`src/ts/components/fft/frameProcessing.ts`. `accumulateFullChannelWaveform` owns channel-range
reset detection, hop-to-channel bin mapping, and reusable 4096-bin buffer updates. `FFTCanvas`
still decides whether accumulation applies to the active device and retains the refs, but no
longer contains the resampling arithmetic. IQ conversion and GPU submission remain in the
component for the later renderer-oriented phases.

## Phase 6 change completed

`resolveSpectrumWaveform` now owns the frame-source normalization boundary. Raw IQ frames are
passed through the component-supplied IQ-to-spectrum function, while playback frames preserve
their existing `waveform`/`data` payload. `FFTCanvas` continues to own math parameters,
reusable output buffers, and processed-frame bookkeeping; the helper only decides which payload
becomes the renderable waveform.

## Phase 7 change completed

Spectrum view preparation now has an explicit helper in
`src/ts/components/fft/frameProcessing.ts`. `prepareSpectrumRenderData` centralizes zoom/pan
processing, visual-range calculation, and the reusable vertical-inversion primitive. `FFTCanvas`
continues to apply its optional CPU averaging policy and owns the final GPU draw call, callbacks,
and canvas state. This keeps renderer submission out of the pure preparation boundary while
making the data handed to the renderer easier to trace.

## Phase 8 change completed

GPU spike-readback presentation is now isolated in
`src/ts/components/fft/spikeAnalysisPresentation.ts`. `presentSpikeAnalysis` owns invalid-readback
filtering, floor/classifier smoothing, temporal-versus-baseline decision selection, and the
confidence hysteresis thresholds. `FFTCanvas` retains the refs and Redux dispatch, but its
renderer callback now performs only orchestration. The GPU draw call and overlay painting remain
component-owned for the final phase.

## Phase 9 change completed

Animation cadence is now exposed through `src/ts/hooks/useFftRenderCoordinator.ts`. The
coordinator owns the `useFFTAnimation` lifecycle and keeps the imperative `forceRender` bridge
in one place. `FFTCanvas` still owns `onRenderFrame` because it has the component-local canvas,
source, and renderer state required by that callback; moving the entire closure into a hook would
only relocate the coupling without reducing it. This completes the safe coordinator boundary
without introducing a second render pipeline.

## Pause-recovery migration

### Phase 1 change completed: storage boundary

`src/ts/hooks/pauseSnapshotStorage.ts` now owns scoped snapshot keys and the byte
encoding/decoding contract for paused IQ and waterfall data. `usePauseLogic` delegates to that
module while preserving its existing timing and observable behavior. This phase deliberately does
not change recovery or `dataRef` ownership.

### Remaining phases

Pause-recovery extraction is complete. Future changes should remain within the
`pauseSnapshotStorage` → `usePauseLogic` → `usePausedSpectrumRecovery` ownership sequence.

### Phase 2 change completed: in-memory hydration

`usePauseLogic` now hydrates a supplied `pausedSnapshotRef` once per pause scope and reuses that
in-memory result for subsequent compatibility calls. `FFTCanvas` owns that ref and passes it into
the hook. The existing `dataRef` mutation remains temporarily as a compatibility bridge until
the dedicated waveform recovery hook consumes `pausedSnapshotRef` in the next phase.

### Phase 3 change completed: paused waveform recovery

`src/ts/hooks/usePausedSpectrumRecovery.ts` now owns the paused-waveform policy: preserve an
already-rendered frozen frame, rebuild from the last processed or hydrated IQ frame when needed,
and create a floor fallback only when neither exists. `onRenderFrame` calls this in-memory
recovery path instead of asking storage to restore data during animation ticks.

### Phase 4 change completed: live transport separation

`usePauseLogic` no longer writes persisted IQ into `dataRef`; that ref remains owned by incoming
live transport. The legacy `restoreWaveformFromStorageRef` has been removed from `FFTCanvas`.
The pause hook’s unused waveform refs were removed from its API, while waterfall snapshot
restoration remains explicitly owned by the pause snapshot layer.

## Render invalidation lifecycle extraction

`src/ts/hooks/useFftCanvasInvalidation.ts` now owns the render invalidation policy previously
spread across `FFTCanvas`: temporal-resolution and FFT-window reprocessing, loading repaint,
spike-overlay resets, selection repaint, and device-limit overlay invalidation. It also owns the
shared FFT-window/temporal-resolution cache invalidation effect. Source-session resets, canvas
resizing, and GPU resource cleanup remain in `FFTCanvas` because they change distinct runtime
ownership rather than only invalidate presentation.
