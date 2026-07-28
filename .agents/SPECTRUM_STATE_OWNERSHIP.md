# Spectrum State Ownership

This document is the migration contract for removing competing sources of spectrum truth.
Pass 0 records ownership; later passes must update this document when a field changes owner.

## Ownership rules

| Concern | Current owner | Target owner | Migration invariant |
| --- | --- | --- | --- |
| Low-frequency spectrum controls (`fftSize`, window, frame rate, dB limits, zoom, pan, power scale) | Redux `spectrum` slice and mirrored `SpectrumState` context | Redux `spectrum` slice | A control has one serializable source of truth. |
| Source inventory and active transport source | Redux `websocket` slice, with derived local selection state | Redux `websocket` plus an explicit source-selection slice | Active transport identity must not be inferred from render-only context state. |
| User-selected source intent and pending source switch | Local state/refs in `SpectrumProviderReal` | Dedicated Redux source-selection state or an explicit source-selection service | Selection intent and backend active state remain distinct. |
| WebSocket lifecycle and commands | Redux middleware module globals plus context façade | Instance-scoped transport runtime behind a narrow command interface | Socket/timer state is disposed with its owner. |
| High-frequency FFT/IQ frames | Mutable refs/runtime, with some Redux metadata | Mutable frame runtime/ref | Raw frames must not enter broad React context or Redux. |
| Canvas/WebGPU resources and render history | Renderer hooks and `FFTCanvas` | Renderer engine/runtime | GPU resources are owned and disposed by the renderer runtime. |
| Persisted settings | Redux middleware and provider effects | Versioned persistence service | Persistence validates and migrates data before it reaches application state. |
| Temporary UI state | Components and provider-local state | Components or focused feature contexts | Temporary UI state must not become global application state. |

## Migration invariants

1. Redux owns low-frequency serializable application state.
2. The frame runtime owns high-frequency data and exposes subscriptions without copying frames into React state.
3. `SpectrumProviderReal` may adapt legacy consumers during migration, but new consumers must use narrow selectors or explicit runtime APIs.
4. Source selection intent, active backend source, and render source are separate concepts and must not be collapsed into one field.
5. Every migrated field needs a focused selector/derivation test before its legacy context read is removed.
6. No pass should change source-switch, pause/resume, reconnect, or persisted-settings behavior without a corresponding regression test.

## Pass status

- Pass 0: ownership contract established.
- Pass 1: narrow Redux selector APIs added; no consumers migrated yet.
- Pass 2: pure derivations and selector consumers.
- Pass 3: transport command façade and source-selection ownership.
- Pass 4: frame runtime boundary.
- Pass 5: remove mirrored reducer/context state.

### Pass 5 checkpoint

Redux is now the write owner for migrated spectrum controls, source/file
selection, stitching controls, visualization pause state, frequency/sample
rate hydration, range synchronization, diagnostics, and whole-channel capture
mutations. The provider still exposes its legacy dispatch adapter for older
consumers, but no longer uses it for those migrated writes.

Refresh-rate capability discovery (`detectedFrameRate`) is also Redux-owned;
the provider continues exposing the field through its compatibility context
shape, but no longer maintains a second write path for it.

### Phase 6 checkpoint

The first local-only composition state has been removed from the write path:
`stitchOptions` now lives in the Redux spectrum slice. `SignalComposition` reads
and updates it through Redux, while the provider's legacy dispatcher translates
old `SET_STITCH_OPTION` actions for compatibility. The remaining local reducer
is now limited to legacy fields that have not yet received a Redux owner.

The obsolete provider-only `sample_size` alias has also been removed; runtime
and persisted sample-rate state now use Redux-owned `sampleRateHz`.

`SpectrumProviderReal` no longer executes the local `useReducer`. Its
compatibility state is derived from Redux spectrum and waterfall slices, and
the compatibility dispatcher routes owned actions directly to Redux. The
the former reducer export and reducer-focused test suite have been removed;
Redux slice tests now cover the runtime state owner.
