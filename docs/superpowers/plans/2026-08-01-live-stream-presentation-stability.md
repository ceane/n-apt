# Live Stream Presentation Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live source presentation, pause/resume, device switching, Server Down, and VFO retune behave as one coherent high-performance control plane — no placeholder flashes, no pause desync, no post-pause frame bleed, and sub-frame VFO round-trips.

**Architecture:** Keep `resolveLiveSourceLifecycle` / `isControlPlaneUnavailable` as the placeholder authority, `SourcePresentationController` as the frame freeze authority, and `useSpectrumStore` pause refs as the per-source pause intent authority. Server Down must require a sustained post-session control loss and must never fire during source handoff. Pause must freeze presentation immediately and reject live frames until an explicit one-shot preview. VFO retunes stay latest-wins on the atomic backend path and must not thrash Redux/presentation.

**Tech Stack:** React 19, TypeScript, Redux Toolkit middleware, Axum/Tokio WebSocket server, Vitest/Jest unit tests, existing `test/integration/vfo-retune-latency.integration.test.ts` harness.

## Global Constraints

- Do not start/restart the user's `npm run dev` process; Vite + Rust hot reload are already running.
- Do not run `npm run build`; use focused Jest/Cargo checks only.
- Do not use browser automation; manual verification uses `http://localhost:5173`.
- Prefer inspecting code and focused tests over broad verification.
- Add regression tests for each bug; run `npm run typecheck` after TypeScript changes and `cargo check` after Rust changes.
- Do not preserve backwards compatibility.
- Keep changes scoped; no scratch files; no unrequested design work.
- Preserve Mock APT waveform checksum unless intentionally changing the generator.

## File Map

| File | Responsibility |
|------|----------------|
| `src/ts/hooks/liveSourceLifecycle.ts` | Control-plane availability + lifecycle placeholder decisions |
| `src/ts/components/FFTAndWaterfall.tsx` | Server Down placeholderErrorReason wiring |
| `src/ts/streams/sourcePresentationController.ts` | Pause/standby freeze; reject live frames while frozen |
| `src/ts/hooks/useSpectrumStore.tsx` | Per-source pause intent, switch pause/resume, pause command send |
| `src/ts/redux/middleware/websocketMiddleware.ts` | Optimistic pause, frequency-range coalescing, disconnect behavior |
| `src/ts/redux/slices/websocketSlice.ts` | `hasConnectedOnce`, soft vs hard disconnect fields |
| `src/ts/routes/SpectrumRoute.tsx` | Pass lifecycle connection/handoff inputs |
| `src/rs/server/shared_state.rs` | Latest-wins pending center frequency atomics |
| `src/rs/server/websocket_server/mod.rs` | Apply newest retune only; pause gating |
| `test/ts/liveSourceLifecycle.test.ts` | Server Down / handoff / first-boot contracts |
| `test/ts/FFTAndWaterfall.test.tsx` | PlaceholderErrorReason contracts |
| `test/ts/sourcePresentationController.test.ts` | Frozen-phase frame rejection |
| `test/ts/useSpectrumStore.sourceSwitchPause.test.ts` | Switch pause retention / resume rules |
| `test/integration/helpers/liveReduxStreamHarness.ts` | Headless Redux↔WebSocket↔presentation harness (extend for pause/lifecycle) |
| `test/integration/live-redux-stream.integration.test.ts` | Connect / source switch / Tx ownership integration |
| `test/integration/vfo-retune-latency.integration.test.ts` | Sub-frame retune latency |

## Integration Harness Contract

Prefer proving stream/pause/placeholder behavior through
`test/integration/helpers/liveReduxStreamHarness.ts` rather than browser automation.

**Already strong:**
- Real auth + control WebSocket + managed stream debug snapshot
- `selectSource`, `setTransmit`, `retuneCenterFrequency` against live backend
- Presentation reads from `presentationController` slots + `liveDataRef`

**Must extend before relying on it for this plan:**
- Add `setPaused(paused, sourceId?)` that dispatches the same `websocket/setPaused` path Space uses
- Snapshot must include `hasConnectedOnce`, per-source `paused`, presentation slot `phase`, and a derived lifecycle/placeholder decision (`resolveLiveSourceLifecycle` / `isControlPlaneUnavailable`)
- Fix stale expectation in `live-redux-stream.integration.test.ts` that standby Mock Tx requires `managed.tx.hasSubscription` — standby is request-only; continuous managed Tx is transmitting-only
- VFO test should prefer the harness-started backend (or document `:18766` as optional external); keep the one-frame budget

---

### Task 0: Extend live Redux stream harness for pause/lifecycle

**Files:**
- Modify: `test/integration/helpers/liveReduxStreamHarness.ts`
- Modify: `test/integration/live-redux-stream.integration.test.ts`
- Modify: `test/integration/vfo-retune-latency.integration.test.ts`
- Optional test: `test/ts/` unit coverage only if harness helpers need pure-function extraction

**Goal:** Make the headless Redux↔WebSocket↔presentation harness the authority for pause/lifecycle integration proofs used by later tasks.

**Required API / snapshot fields:**
- Add `setPaused(paused: boolean, sourceId?: string)` that dispatches the same `websocket/setPaused` path Space uses (`useSpectrumStore` / middleware), not a private test-only backdoor
- Snapshot must include:
  - `hasConnectedOnce`
  - per-source `paused` (for selected/active sources at minimum)
  - presentation slot `phase` for the active/selected source
  - derived lifecycle/placeholder decision via `resolveLiveSourceLifecycle` and/or `isControlPlaneUnavailable` (enough to assert Server Down vs warming vs ready)
- Fix stale expectation in `live-redux-stream.integration.test.ts` that standby Mock Tx requires `managed.tx.hasSubscription` — standby is request-only; continuous managed Tx is transmitting-only
- VFO test should prefer the harness-started backend (or document `:18766` as optional external); keep the one-frame budget

- [ ] **Step 1: Inspect current harness + Space pause dispatch path**
- [ ] **Step 2: Add `setPaused` + snapshot fields (TDD: add a failing harness assertion first if feasible)**
- [ ] **Step 3: Fix standby Mock Tx subscription expectation**
- [ ] **Step 4: Align VFO test with harness-started backend**
- [ ] **Step 5: Run focused integration tests and commit**

**Commit:** `test: extend live Redux harness for pause and lifecycle snapshots`

---

### Task 1: Handoff-safe Server Down gate

**Files:**
- Modify: `src/ts/hooks/liveSourceLifecycle.ts`
- Modify: `src/ts/components/FFTAndWaterfall.tsx`
- Modify: `src/ts/routes/SpectrumRoute.tsx`
- Test: `test/ts/liveSourceLifecycle.test.ts`
- Test: `test/ts/FFTAndWaterfall.test.tsx`

**Interfaces:**
- Consumes: existing `isControlPlaneUnavailable({ isConnected, connectionStatus, hasConnectedOnce })`
- Produces: `isControlPlaneUnavailable({ ..., sourceHandoffPending?: boolean, transportPhase?: string | null })` that returns `false` during handoff/warming; `shouldShowLiveServerDownPlaceholder` must pass those through (stop ignoring them)

- [ ] **Step 1: Write the failing tests**

Add to `test/ts/liveSourceLifecycle.test.ts`:

```ts
import { isControlPlaneUnavailable } from "../../src/ts/hooks/liveSourceLifecycle";

test("never reports Server Down during a healthy source handoff", () => {
  expect(
    isControlPlaneUnavailable({
      isConnected: false,
      connectionStatus: "disconnected",
      hasConnectedOnce: true,
      sourceHandoffPending: true,
      transportPhase: "warming",
    }),
  ).toBe(false);

  expect(
    resolveLiveSourceLifecycle({
      selectedSourceId: "mock-tx",
      activeSourceId: "mock-apt",
      transportSourceId: "mock-tx",
      transportPhase: "warming",
      hasValidFrame: false,
      deviceStatus: "connected",
      isConnected: false,
      connectionStatus: "disconnected",
      hasConnectedOnce: true,
      handoffPlaceholder,
    }).phase,
  ).toBe("warming-transport");
});

test("still reports Server Down after a live session is lost with no handoff", () => {
  expect(
    isControlPlaneUnavailable({
      isConnected: false,
      connectionStatus: "disconnected",
      hasConnectedOnce: true,
      sourceHandoffPending: false,
      transportPhase: "idle",
    }),
  ).toBe(true);
});
```

Update `test/ts/FFTAndWaterfall.test.tsx` helper expectations:

```ts
expect(
  shouldShowLiveServerDownPlaceholder({
    isConnected: false,
    connectionStatus: "disconnected",
    hasConnectedOnce: true,
    sourceHandoffPending: true,
    sourceTransportPhase: "warming",
    sourceStreamReady: false,
  }),
).toBe(false);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/ts/liveSourceLifecycle.test.ts test/ts/FFTAndWaterfall.test.tsx -t 'Server Down|handoff|control plane|first connect' --no-coverage`

Expected: FAIL because `sourceHandoffPending` / `transportPhase` are currently ignored.

- [ ] **Step 3: Implement the minimal gate**

In `src/ts/hooks/liveSourceLifecycle.ts`, extend:

```ts
export const isControlPlaneUnavailable = ({
  isConnected,
  connectionStatus = null,
  hasConnectedOnce = false,
  sourceHandoffPending = false,
  transportPhase = null,
}: {
  isConnected: boolean;
  connectionStatus?: string | null;
  hasConnectedOnce?: boolean;
  sourceHandoffPending?: boolean;
  transportPhase?: string | null;
}): boolean => {
  if (isConnected || connectionStatus === "connected") return false;
  if (
    connectionStatus === "connecting" ||
    connectionStatus === "reconnecting"
  ) {
    return false;
  }
  // Device switches and transport warm-up are not backend death.
  if (sourceHandoffPending || transportPhase === "warming") return false;
  if (connectionStatus === "error") return true;
  return hasConnectedOnce === true;
};
```

Wire the same fields through `resolveLiveSourceLifecycle` and `shouldShowLiveServerDownPlaceholder` (stop `_`-prefixing them).

In `SpectrumRoute.tsx`, pass:

```ts
sourceHandoffPending: isSwitchingLiveSource,
transportPhase: sourceTransport?.phase ?? "idle",
```

into both lifecycle and ensure FFTAndWaterfall already receives `presentationPolicy.suppressStaleFrames` as handoff pending.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/ts/liveSourceLifecycle.test.ts test/ts/FFTAndWaterfall.test.tsx --no-coverage`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ts/hooks/liveSourceLifecycle.ts src/ts/components/FFTAndWaterfall.tsx src/ts/routes/SpectrumRoute.tsx test/ts/liveSourceLifecycle.test.ts test/ts/FFTAndWaterfall.test.tsx
git commit -m "$(cat <<'EOF'
fix: keep Server Down off the source-handoff path

Device switches and transport warm-up were able to flash Server Down after a
prior live session. Gate unavailable presentation on true post-session control
loss only.
EOF
)"
```

---

### Task 2: Soft disconnect inventory retention

**Files:**
- Modify: `src/ts/redux/slices/websocketSlice.ts`
- Modify: `src/ts/redux/middleware/websocketMiddleware.ts`
- Test: `test/ts/reduxWebsocketMigration.test.ts`

**Interfaces:**
- Consumes: `setDisconnected` current hard-clear behavior
- Produces: `softDisconnect` (socket down, keep inventory) vs hard `setDisconnected` / `reset`; reconnect uses soft disconnect so source switch / brief close does not empty `sources` and force Loading/Server Down thrash

- [ ] **Step 1: Write the failing test**

In `test/ts/reduxWebsocketMigration.test.ts`:

```ts
it("soft disconnect keeps source inventory while marking the control plane down", () => {
  const store = configureStore({
    reducer: { websocket: websocketSlice },
    middleware: (gDM) => gDM({ serializableCheck: false }).concat(websocketMiddleware),
  });

  store.dispatch(
    updateDeviceState({
      isConnected: true,
      connectionStatus: "connected",
      hasConnectedOnce: true,
      activeSourceId: "mock-apt",
      sources: [
        {
          id: "mock-apt",
          name: "Mock APT SDR",
          capability: "mock",
          status: "receiving",
        } as any,
      ],
      sourceStatuses: { "mock-apt": "receiving" },
    }),
  );

  store.dispatch({ type: "websocket/softDisconnect" });

  const state = store.getState().websocket;
  expect(state.isConnected).toBe(false);
  expect(state.connectionStatus).toBe("disconnected");
  expect(state.hasConnectedOnce).toBe(true);
  expect(state.activeSourceId).toBe("mock-apt");
  expect(state.sources).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/ts/reduxWebsocketMigration.test.ts -t 'soft disconnect' --no-coverage`

Expected: FAIL (`websocket/softDisconnect` unknown / inventory cleared)

- [ ] **Step 3: Implement soft disconnect**

In `websocketSlice.ts`:

```ts
softDisconnect: (state) => {
  state.isConnected = false;
  state.connectionStatus = "disconnected";
  // Keep hasConnectedOnce, sources, activeSourceId, transport metadata.
  // Hard reset remains available via setDisconnected/reset.
},
```

In middleware `ws.onclose`, dispatch `softDisconnect` before scheduling reconnect. Keep hard `setDisconnected` for intentional disable / dispose paths only.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/ts/reduxWebsocketMigration.test.ts -t 'soft disconnect|disconnect' --no-coverage`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ts/redux/slices/websocketSlice.ts src/ts/redux/middleware/websocketMiddleware.ts test/ts/reduxWebsocketMigration.test.ts
git commit -m "$(cat <<'EOF'
fix: soft-disconnect control plane without wiping source inventory

Brief socket closes during reconnect were clearing sources and active ids,
which thrashed placeholders and forced source reselection.
EOF
)"
```

---

### Task 3: True pause freeze (no post-pause frame bleed)

**Files:**
- Modify: `src/ts/streams/sourcePresentationController.ts`
- Test: `test/ts/sourcePresentationController.test.ts`

**Interfaces:**
- Consumes: `acceptFrame`, `setPaused`, `FROZEN_PHASES`
- Produces: while phase is `paused`, live frames are rejected for presentation unless explicitly marked as a one-shot preview (`is_tx_preview` / `is_mock_tx_preview` / paused-preview request). Standby one-shot previews may still replace the frozen frame once.

Root cause today: comment says frozen phases reject frames, but `acceptFrame` updates `frozenFrame` on every arrival — that is the “advances a frame or two after pause” bug.

- [ ] **Step 1: Write the failing test**

In `test/ts/sourcePresentationController.test.ts`:

```ts
it("rejects live frames after pause so the canvas does not keep advancing", () => {
  const ctrl = createController();
  ctrl.selectSource("mock-apt");
  ctrl.commitActiveSource("mock-apt");

  const first = makeRxFrame("mock-apt", { sequence: 1 });
  ctrl.acceptFrame(first);
  ctrl.setPaused("mock-apt", "rx", true);

  const second = makeRxFrame("mock-apt", { sequence: 2 });
  expect(ctrl.acceptFrame(second)).toBe(false);

  const slot = ctrl.getSlot("mock-apt", "rx");
  expect(slot?.phase).toBe("paused");
  expect(slot?.frozenFrame?.frame).toBe(first);
  expect(ctrl.getPresentationRef("rx").current).toBe(first);
});

it("allows one-shot standby preview frames to replace a frozen standby slot", () => {
  const ctrl = createController();
  ctrl.selectSource("mock-tx", "tx");
  ctrl.commitActiveSource("mock-tx");
  const first = makeTxFrame("mock-tx", { sequence: 1, status: "standby" });
  ctrl.acceptFrame(first);

  const preview = makeTxFrame("mock-tx", { sequence: 2, status: "standby" });
  expect(ctrl.acceptFrame(preview)).toBe(true);
  expect(ctrl.getSlot("mock-tx", "tx")?.frozenFrame?.frame).toBe(preview);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/ts/sourcePresentationController.test.ts -t 'rejects live frames after pause|one-shot standby preview' --no-coverage`

Expected: FAIL (current code updates frozen frame for every paused arrival)

- [ ] **Step 3: Implement freeze rejection**

In `acceptFrame`, replace the frozen-phase update block with:

```ts
if (FROZEN_PHASES.has(slot.phase)) {
  const isExplicitPreview =
    frame.is_tx_preview === true ||
    frame.is_mock_tx_preview === true ||
    frame.frame_status === "standby";

  if (slot.phase === "paused" && !isExplicitPreview) {
    slot.metrics.rejected += 1;
    return false;
  }

  // Standby / explicit preview: replace the frozen snapshot once.
  slot.frozenFrame = freezeFrame(frame, slot);
  slot.metrics.frozen += 1;
  // ... existing snapshot persistence ...
  return true;
}
```

Do **not** write paused live frames into `liveFrameRef` before rejecting; move the live-ref assignment below the freeze gate, or assign only when accepted for presentation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/ts/sourcePresentationController.test.ts --no-coverage`

Expected: PASS (update any previous tests that assumed paused frames mutate the freeze)

- [ ] **Step 5: Commit**

```bash
git add src/ts/streams/sourcePresentationController.ts test/ts/sourcePresentationController.test.ts
git commit -m "$(cat <<'EOF'
fix: reject live frames while a source slot is paused

Paused presentation was still replacing its frozen frame on every arrival,
so the canvas advanced after Pause. Freeze the first paused frame and ignore
subsequent live traffic unless it is an explicit preview.
EOF
)"
```

---

### Task 4: Pause intent is authoritative over stale backend paused flags

**Files:**
- Modify: `src/ts/hooks/useSpectrumStore.tsx`
- Test: `test/ts/useSpectrumStore.sourceSwitchPause.test.ts`

**Interfaces:**
- Consumes: `manualPausedSourceIdsRef`, `autoPausedSourceIdsRef`, `resolveEffectiveSourcePaused`, `shouldResumePausedRxSourceOnSelection`
- Produces: UI Pause/Resume and `sendPauseCommand` both keyed off local intent first; backend `source.paused` cannot invert a just-requested pause; switch-back does not auto-play over a manual pause while showing Resume

Root causes:
1. `toggleVisualizerPause` trusts `pauseTargetSource?.paused ?? manualVisualizerPaused`, so a stale backend `paused:false` after UI pause makes the next Space un-pause (or look like a no-op).
2. Selecting a source clears `autoPausedSourceIdsRef` and always `sendPauseCommand(false)`, which can resume while the card still paints Resume from another state branch.

- [ ] **Step 1: Write the failing tests**

In `test/ts/useSpectrumStore.sourceSwitchPause.test.ts`:

```ts
it("treats local manual pause as authoritative when backend paused flag is stale", () => {
  expect(
    resolveEffectiveSourcePaused({
      backendPaused: false,
      localPaused: true,
      manuallyPaused: true,
      autoPaused: false,
    }),
  ).toBe(true);
});

it("does not auto-resume a source that the user manually paused before switching away", () => {
  expect(
    shouldResumePausedRxSourceOnSelection(
      {
        id: "mock-apt",
        name: "Mock APT SDR",
        capability: "mock",
        status: "connected",
        paused: true,
      } as any,
      true, // manuallyPaused
    ),
  ).toBe(false);
});
```

Add a pure helper test for toggle current-state resolution:

```ts
export const resolveVisualizerPauseToggleCurrent = ({
  manuallyPaused,
  autoPaused,
  localPaused,
  backendPaused,
}: {
  manuallyPaused: boolean;
  autoPaused: boolean;
  localPaused?: boolean;
  backendPaused?: boolean | null;
}): boolean => {
  if (manuallyPaused || autoPaused) return true;
  if (typeof localPaused === "boolean") return localPaused;
  return backendPaused === true;
};
```

Test that stale `backendPaused: false` with `manuallyPaused: true` returns `true`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/ts/useSpectrumStore.sourceSwitchPause.test.ts -t 'manual pause|authoritative|auto-resume' --no-coverage`

Expected: FAIL or missing helper

- [ ] **Step 3: Implement pause-intent authority**

1. Export / use `resolveVisualizerPauseToggleCurrent` in `toggleVisualizerPause` and `setVisualizerPause` instead of `pauseTargetSource?.paused ?? manualVisualizerPaused`.
2. In the selected-source effect, **never** auto-`sendPauseCommand(false)` when `manualPausedSourceIdsRef` has the source.
3. When auto-resuming only auto-paused sources, also set local override + `manualVisualizerPaused` consistently via `syncSelectedSourcePauseState` after the command, or skip UI sync until backend confirms — prefer: local intent already false before send.
4. On `setVisualizerPause(true)`, call presentation freeze path immediately through existing `websocket/setPaused` / `presentationController.setPaused` (already in middleware) and ensure optimistic source `paused:true` is applied in Redux source list if not already.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/ts/useSpectrumStore.sourceSwitchPause.test.ts --no-coverage`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ts/hooks/useSpectrumStore.tsx test/ts/useSpectrumStore.sourceSwitchPause.test.ts
git commit -m "$(cat <<'EOF'
fix: keep pause UI and transport on local pause intent

Stale backend paused flags and auto-resume-on-select were desyncing Resume
labels from a still-playing stream. Local manual/auto pause intent now wins
for toggles and switch-back.
EOF
)"
```

---

### Task 5: Optimistic pause drops in-flight live frames immediately

**Files:**
- Modify: `src/ts/redux/middleware/websocketMiddleware.ts`
- Test: `test/ts/reduxWebsocketMigration.test.ts` (or a focused pause middleware test)

**Interfaces:**
- Consumes: `websocket/setPaused`, `pendingDataUpdate`, `presentationController.setPaused`
- Produces: on pause, clear pending batched live frames for that source immediately; on resume, allow streaming again. Prevents 1–2 frames already queued in `pendingDataUpdate` from painting after Pause.

- [ ] **Step 1: Write the failing test**

```ts
it("drops queued live frames when pause is requested", () => {
  // Arrange connected store + queue a live frame into the middleware batch
  // Act dispatch websocket/setPaused { paused: true, source_id }
  // Assert pending batch / liveDataRef does not present a newer sequence
});
```

Use existing `__testQueueLiveDataForMiddleware` helpers if present.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/ts/reduxWebsocketMigration.test.ts -t 'drops queued live frames when pause' --no-coverage`

Expected: FAIL

- [ ] **Step 3: Implement**

In `websocket/setPaused` when `isPaused === true`:

```ts
pendingDataUpdate = null;
// Also clear any source-scoped live ref updates that have not painted yet
// for the paused sourceId (keep frozen presentation).
```

Ensure this happens **before** returning, and that Task 3 rejection covers frames that still arrive from the socket until the backend pause ack.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/ts/reduxWebsocketMigration.test.ts -t 'pause|paused' --no-coverage`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ts/redux/middleware/websocketMiddleware.ts test/ts/reduxWebsocketMigration.test.ts
git commit -m "$(cat <<'EOF'
fix: flush in-flight live frames on pause

Queued middleware batches could paint one or two frames after Pause. Clear
the pending live batch when pause is requested so freeze is immediate.
EOF
)"
```

---

### Task 6: High-performance VFO / center-frequency retune path

**Files:**
- Modify: `src/ts/redux/middleware/websocketMiddleware.ts` (duplicate suppression / latest-wins send)
- Modify: `src/ts/routes/SpectrumRoute.tsx` (already uses animation-frame coalescer — verify it is the only drag path)
- Modify: `src/rs/server/websocket_server/mod.rs` / `shared_state.rs` only if a retune still applies stale centers
- Test: `test/ts/reduxWebsocketMigration.test.ts`
- Test: `test/integration/vfo-retune-latency.integration.test.ts`

**Interfaces:**
- Consumes: `pending_center_freq` atomics, `shouldSuppressDuplicateFrequencyRangeSend`, SpectrumRoute `createAnimationFrameCoalescer`
- Produces: drag retunes are latest-wins, never enqueue a backlog; UI frequency label updates locally without waiting on source_info; round-trip stays under one frame interval for Mock APT at 60 FPS

- [ ] **Step 1: Write / tighten failing unit expectations**

In `test/ts/reduxWebsocketMigration.test.ts`:

```ts
it("keeps only the newest frequency_range send under rapid VFO drag", () => {
  // Fire many frequency_range messages in one turn with distinct centers
  // Assert websocket send count is coalesced / last center wins
  // Assert older centers are not all flushed
});
```

Confirm integration budget remains:

```ts
expect(worstCaseMs).toBeLessThan(frameBudgetMs); // 1000/60
```

- [ ] **Step 2: Run tests to see current behavior**

Run: `npx jest test/ts/reduxWebsocketMigration.test.ts -t 'frequency_range|VFO|retune' --no-coverage`

If integration harness is available:

Run: `npx jest test/integration/vfo-retune-latency.integration.test.ts --no-coverage`

Expected: unit test may FAIL if sends are not latest-wins; integration documents current latency.

- [ ] **Step 3: Implement hot-path rules**

Frontend:
1. Ensure drag path only publishes through the animation-frame coalescer in `SpectrumRoute` (no direct per-pointer-event `sendFrequencyRange` from FFTCanvas drag).
2. In middleware, for `frequency_range`, keep latest-wins: if a send is already scheduled/in-flight for the same source, replace the pending payload instead of queueing multiples.
3. Do not let frequency_range updates open/reconfigure managed Tx streams (`shouldSyncManagedStreamOptions` already excludes it — keep that).
4. Do not transition lifecycle to Server Down / recovering on retune; retune must not touch `hasConnectedOnce` or connection status.

Backend (only if unit/integration proves stale apply):
1. Keep `pending_center_freq_dirty` latest-wins.
2. Ensure the read loop applies pending frequency before producing the next frame and never processes a queue of historical centers.

- [ ] **Step 4: Verify**

Run:
- `npx jest test/ts/reduxWebsocketMigration.test.ts -t 'frequency_range|VFO|retune' --no-coverage`
- `npx jest test/integration/vfo-retune-latency.integration.test.ts --no-coverage` (when backend on `:18766` or harness port is up)
- `cargo check`

Expected: unit PASS; integration worst-case `< frameBudgetMs`.

- [ ] **Step 5: Commit**

```bash
git add src/ts/redux/middleware/websocketMiddleware.ts src/ts/routes/SpectrumRoute.tsx src/rs/server/websocket_server/mod.rs src/rs/server/shared_state.rs test/ts/reduxWebsocketMigration.test.ts test/integration/vfo-retune-latency.integration.test.ts
git commit -m "$(cat <<'EOF'
perf: keep VFO retunes latest-wins within one frame

Rapid center-frequency drags must replace pending retunes instead of
queueing stale centers, and must not disturb live presentation lifecycle.
EOF
)"
```

---

### Task 7: End-to-end verification checklist (no new features)

**Files:**
- None (verification only)

- [ ] **Step 1: Focused automated suite**

Run:

```bash
npx jest \
  test/ts/liveSourceLifecycle.test.ts \
  test/ts/FFTAndWaterfall.test.tsx \
  test/ts/sourcePresentationController.test.ts \
  test/ts/useSpectrumStore.sourceSwitchPause.test.ts \
  test/ts/reduxWebsocketMigration.test.ts \
  test/ts/requestNextPausedFrame.test.ts \
  --no-coverage

npm run typecheck
cargo check
```

Expected: all PASS (ignore pre-existing unrelated typecheck failures if already known).

- [ ] **Step 2: Manual checklist on `http://localhost:5173`**

1. Cold load Mock APT → Loading FFT → spectrum. **No Server Down flash.**
2. Switch Mock APT ↔ Mock Tx repeatedly → Loading/handoff or standby only. **No Server Down.**
3. Pause Mock APT → canvas freezes on the same frame immediately; button shows Resume.
4. Switch away and back while manually paused → still paused, still Resume, not auto-playing.
5. Mash Space pause/play → UI and stream always agree; no “Resume while playing”.
6. Drag VFO quickly across band → center label tracks pointer; spectrum follows within ~1 frame; no placeholder thrash.
7. Kill backend → Server Down. Restart backend → reconnect/loading then spectrum.

- [ ] **Step 3: Commit only if verification fixed stragglers**

If Step 2 finds a straggler, open a focused follow-up fix with its own failing test; do not bundle unrelated cleanups.

---

## Self-Review

**Spec coverage:**
- Server Down flash on switch / first load → Tasks 1–2
- Resume while playing / auto-play on switch-back → Task 4
- Pause advances a frame or two → Tasks 3 + 5
- Pause UI-only no-op → Tasks 4 + 5
- VFO/center-frequency high performance → Task 6
- Manual solidification checklist → Task 7

**Placeholder scan:** no TBD/TODO steps; each task has concrete code, commands, and commit messages.

**Type consistency:** `isControlPlaneUnavailable` gains `sourceHandoffPending` + `transportPhase`; `shouldShowLiveServerDownPlaceholder` passes them through; soft disconnect action name is `websocket/softDisconnect` / `softDisconnect` reducer.
