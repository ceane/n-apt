# Multiplex Stream Pipeline: Socket → Paint

Owner vocabulary: **multiplexStream\***. This document is the contract for how an
I/Q frame travels from the wire to a painted canvas, who makes each decision,
and where each rule lives in code. If you are changing frame flow, change this
document in the same commit.

## 1. Canonical vocabulary

| Term | Meaning | Home |
|---|---|---|
| **MultiplexStreamFrameId** | `{sourceId, streamEpoch, sequence}` — the identity of a frame on the wire | `features/spectrum/model/multiplexStream/frameIdentity.ts` |
| **acceptsMultiplexStreamFrame(frame, lifecycle)** | The *ingress* "does this frame belong here" predicate (strict: no commitment ⇒ reject; newer epoch admitted) | `model/multiplexStream/frameGate.ts` |
| **matchesMultiplexStreamSelection(…)** | The *presentation* admission rule (permissive: no expectation ⇒ accept anything; tagged foreign source rejected) | `model/multiplexStream/frameGate.ts` (consumers still import it as `shouldAcceptWebGpuStreamFrame` from `webgpuStreamReset`) |
| **sameMultiplexStreamLifecycle(a, b)** | Exact lifecycle equality with null-tolerant epochs — frozen-frame slot validation | `model/multiplexStream/frameIdentity.ts` |
| **Sequence gate** | Per-stream monotonic ordering, duplicate rejection, gap counting, first-frame-per-epoch readiness boundary | `model/multiplexStream/frameGate.ts` (`createMultiplexStreamSequenceGate`) |
| **Presentation batch gate** | Accept/replace-vs-append decision for a batch of presentation frames, incl. paused one-shot and Tx-preview semantics | `model/multiplexStream/presentationGate.ts` (`resolveMultiplexStreamPresentationBatch`); middleware applies it |
| **Verdict** | One decision object consumed by canvases/route: `{phase, placeholder, framePolicy, gpuReset, standby}` | `model/multiplexStream/lifecycle/` (Phase 3 of consolidation) |
| **Transport** | One authenticated WebSocket carrying every active source/mode subscription | `app/infrastructure/streams/multiplexedStreamTransport.ts` |
| **Delivery policy** | `latest` (coalesce while decrypting; slow consumer drops stale frames) vs `lossless` (bounded 32-frame queue, lag error beyond that) | transport + `streamContract.ts` |
| **optionsRevision** | Monotonic tuning-contract counter; frames from an older device window are purged on advance | transport |

Rule: `model/` is pure and imports nothing from `app/`, `redux/`, or React.
Infrastructure owns mechanism (sockets, GPU flushes, storage). Middleware and
routes apply decisions; they never define them.

## 2. Live path (socket → paint)

```
Backend /ws/streams (one socket, all subscriptions)
  │  JSON messages: stream_frame / stream_subscribed / stream_options_applied …
  ▼
multiplexedStreamTransport            [infrastructure/streams]
  │  • routes by StreamKey {sourceId, mode}
  │  • delivery policy queues (latest coalesce | lossless bounded)
  │  • async decrypt (one in flight per connection)
  │  • optionsRevision gating: purge frames from superseded tuning windows
  ▼
sourceModeStreamManager               [infrastructure/streams]
  │  logical subscriptions, epoch/state events (stream_opened/stream_state)
  ▼
websocketMiddleware                   [redux/middleware]
  │  • publishes presentation frames into frame slots
  │    (presentationController slots / liveDataRef / liveDataBySourceRef)
  │  • dispatches sourceFrameReadinessByMode (low-frequency readiness boundary)
  │  • notifyFrameArrival() → push notification          [frameArrivalRuntime]
  │  • subscribeFrameRuntime() shared 50ms clock for pull consumers
  ▼
getLiveFrameRefForSource() proxy      [infrastructure/visualization/frameRuntime]
  │  resolves the ref a canvas reads: active slot → mode-scoped slot
  │  (frozen-frame epoch validated) → legacy source map. Being replaced by
  │  explicit resolveFrameSlot(sourceId, mode) → {ref, kind} (Phase 4).
  ▼
SpectrumRoute                          [routes/pages]
  │  useLiveSourceLifecycle() → phase/policy verdicts from Redux status +
  │  transport phase + readiness + painted-frame owner. Never subscribes to
  │  raw frames.
  ▼
FFTCanvas rAF loop                     [features/spectrum]
  ├─ resolveFramePresentation()   [fft/framePresentation.ts]
  │    applies the lifecycle Verdict + explicit placeholders → paint /
  │    placeholder / preserve-last-paint / deferred-reset decision record
  ├─ resolveLiveSpectrumPaintContract()  [fft/frameProcessing.ts]
  │    frequency-axis geometry: range match, retune-hold, baseband mirror,
  │    pan/zoom rebase, temporal averaging ring buffer
  └─ GPU submit · flushWebGpuPresentation*   [webgpuStreamReset.ts — mechanism only]
       reset epochs advance ONLY at source-selection / same-source-reconnect
       boundaries (resolveWebGpuStreamTransition).
```

## 3. File playback path

Stitch worker → precomputed frames → `buildPlaybackSeedFrame`
(`features/spectrum/fft/playbackSeedFrame.ts`) writes a synthetic first frame
into `fileFrameRuntime` during the mount render (avoids a blank-canvas race),
then the same canvas stages above consume it. File playback never touches the
transport, middleware slots, or readiness.

## 4. Frame acceptance rules (the one predicate)

`acceptsMultiplexStreamFrame(frame, lifecycle)`:

1. Source mismatch ⇒ reject. No committed source ⇒ reject everything.
2. Epoch-less frame (v1 wire format / legacy untagged) ⇒ accept on source match.
3. Epoch-tagged frame ⇒ accept when `frameEpoch >= committedEpoch`. A newer
   same-source epoch is accepted so the data plane may lead control-plane
   metadata; the consumer adopts it when observed.

On top: `createMultiplexStreamSequenceGate()` rejects duplicates/reorders within
an epoch, counts gaps, and yields the once-per-`{sourceId}:{epoch}` readiness
boundary. Historical note: these rules were first implemented in the IQ frame
pump (`iqFramePump.ts`, removed 2026-08); the pump was superseded by the
multiplexed transport but its acceptance semantics are preserved verbatim here
and covered by `test/ts/frameGate.test.ts`.

## 5. Ingress paths and the tagging seam

Two ingress paths feed the same presentation slots today:

| Path | Frames | Tagging |
|---|---|---|
| Multiplexed transport (`/ws/streams`) | live RX/TX streaming | `makeFrame` hardcodes `frame_status` to `"receiving"`/`"transmitting"` — never emits `standby`/`is_tx_preview` |
| Legacy control socket (`/ws`) batch path | paused/one-shot preview frames (`request_next_frame`) | carries the `standby`/`is_tx_preview` tags the middleware gate filters on |

**Consequence:** standby/Tx-preview frames reach the canvas exclusively through
the legacy control-socket path. This is deliberate today and pinned by tests;
removing the legacy layer requires migrating preview frames onto the
multiplexed transport with explicit tagging (backend-inclusive work).

## 6. Decision ownership map

| Question | Decided by | Applied by |
|---|---|---|
| Does this frame belong to my selection? | `frameGate.ts` | transport/middleware/canvas/slots |
| Is there a paintable frame for the selected source? | lifecycle model (readiness ∨ frozen frame ∨ rendered-once) | SpectrumRoute → canvas |
| What phase is the live view in? | `resolveLiveSourceLifecycle` (pure resolver) | route placeholders, canvas loading |
| May the last painted frame be kept across a gap/handoff? | presentation policy within the Verdict + `shouldPreservePresentationDuringFrameGap` | FFTCanvas |
| When does the GPU state reset? | epoch transitions only (`resolveWebGpuStreamTransition`) | FFTCanvas via `webGpuStreamResetEpoch` |
| Which pixels does this frame occupy? | `frameProcessing.ts` paint contract | FFTCanvas GPU submission |

## 7. Testing strategy

- Pure modules (`model/`, `framePresentation`, `frameProcessing`,
  `webgpuStreamReset` predicates) carry exhaustive unit/table tests.
- `test/ts/frameGate.test.ts` pins acceptance semantics, including the
  device-swap late-frame rejection scenario end-to-end.
- `test/integration/device-swap-frame-form.integration.test.ts` exercises
  identity gate → readiness dispatch → middleware queue → payload-form
  integrity across a handoff.
- Any refactor of a stage must be preceded by a characterization-test commit so
  regressions bisect to a single diff.

## 8. Known issue: VFO retune oscillation under lossless delivery

The `vfo-retune-latency` integration test intermittently exposes a real tuning
race. Symptom (captured via manager-level frame tracing): after two successful
retunes, the backend receives replayed **older** tune windows and oscillates
between them (observed `cf` sequence: 1.6 MHz → 5.0 → 5.0 → 5.1 → 5.1 →
**5.0 → 5.0 → 5.0** → 5.1 …), so the requested next retune window never
produces a frame and the round-trip times out.

Suspected mechanism: the managed-RX device-option hydration path —
`stream_options_applied` events (authoritative, non-local origin) dispatch SDR
settings updates while the local gesture scheduler may still hold queued older
ranges; the stale value is re-published to the device, which then alternates
with the fresh tune. The guard comment at `handleManagedStreamEvent`
("never replay an older write") covers Redux state but apparently not the
device command path.

Status: open. Fix belongs in the managed-options scheduler/hydration boundary;
the consolidation plan's Phase 3 verdict work should treat "one writer, one
current tune" as an invariant with its own gate test.
