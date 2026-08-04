# Tx Monitor Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag Tx geometry updates so only mode-enter / typed entry jump the Mock Tx monitor; slider stays passive; user pan detaches.

**Architecture:** Pure helpers in `txSliderPlacement.ts` classify jump vs passive and build transmit settings with optional `alignMonitor`. `SpectrumRoute` owns monitor center state and calls jump explicitly; remove the `txCenter → mockMonitor` mirror effect.

**Tech Stack:** TypeScript, Jest, React (SpectrumRoute / SpectrumSidebar)

**Spec:** `docs/superpowers/specs/2026-08-01-tx-monitor-alignment-design.md`

## Global Constraints

- Slider never auto-jumps the monitor (standby or transmitting).
- Typed Center/Bandwidth and mode-enter/Start Tx default align jump the monitor.
- User pan via scroll / EditableCenterFrequency updates monitor only.
- Standby preview IQ: carrier = planned Tx, view = current monitor.

---

### Task 1: Jump/passive helpers + transmit settings

**Files:**
- Modify: `src/ts/utils/txSliderPlacement.ts`
- Test: `test/ts/txSliderPlacement.test.ts`

**Interfaces:**
- Produces:
  - `TxMonitorUpdateSource = "slider" | "typed" | "mode-enter" | "user-pan"`
  - `shouldJumpTxMonitor({ source }): boolean`
  - `resolveMockTxTransmitSettings({ txCenterHz, viewCenterHz, viewSampleRateHz, txBandwidthHz, alignMonitor }): { centerFrequencyHz, viewCenterHz, sampleRateHz, bandwidthHz }`

- [x] **Step 1: Write failing tests** for `shouldJumpTxMonitor` (typed/mode-enter true; slider/user-pan false) and `resolveMockTxTransmitSettings` with `alignMonitor: true|false`.
- [x] **Step 2: Implement helpers** (typed/mode-enter jump; alignMonitor forces viewCenter = txCenter; otherwise keep viewCenter).
- [x] **Step 3: Run** `npx jest test/ts/txSliderPlacement.test.ts --no-coverage` — pass.

---

### Task 2: SpectrumRoute wiring

**Files:**
- Modify: `src/ts/routes/SpectrumRoute.tsx`
- Test: extend `test/ts/txSliderPlacement.test.ts` and/or add focused route helper tests if extracted; smoke via existing mockTx preview tests where applicable

**Interfaces:**
- Consumes: Task 1 helpers
- Produces: `jumpMonitorToTx(centerHz)` local callback; slider path never calls it

- [x] **Step 1: Remove** the `useEffect` that sets `mockMonitorCenterHz` from every `txCenterFrequencyHz` change.
- [x] **Step 2: Slider handlers** always `setTxCenterFrequencyHz` / `setTxGeometry` (standby + transmitting); do **not** set monitor from slider; transmit sync uses `alignMonitor: false` with current `mockMonitorCenterHz`.
- [x] **Step 3: Mode-enter / Start Tx default** call jump (`setMockMonitorCenterHz(txCenter)` + align transmit settings).
- [x] **Step 4: Tx Options typed Center/Bandwidth** jump monitor after dispatch.
- [x] **Step 5: EditableCenterFrequency / range pan** update monitor only (existing pan paths; ensure they do not rewrite Tx center).
- [x] **Step 6: Signal preset geometry** (if handled in route) jumps monitor.
- [x] **Step 7: Run** related Jest tests.

---

### Task 3: Sidebar typed geometry jumps

**Files:**
- Modify: `src/ts/components/sidebar/SpectrumSidebar.tsx` (and SpectrumRoute if sidebar only dispatches Redux — then route reacts via explicit jump on typed actions)

**Note:** If sidebar only dispatches `setTxCenterFrequencyHz` / `setTxSampleRateHz` / `setTxGeometry`, SpectrumRoute cannot distinguish slider vs typed from Redux alone. Prefer:
- passing an optional meta / dedicated action, **or**
- handling typed jumps at the call site in SpectrumRoute Tx Options + sidebar `handleTxSignalChange` / FrequencyInput by also dispatching frequency range / a small `jumpMonitor` callback via props, **or**
- using `alignMonitor` only at known typed call sites and keeping slider call sites passive.

- [x] **Step 1: Ensure typed sidebar Center/Bandwidth/preset** jump monitor (call site jump or shared callback).
- [x] **Step 2: Ensure Start Tx** uses `alignMonitor: true` once; later slider sync uses `alignMonitor: false`.
- [x] **Step 3: Run** `npx jest test/ts/txSliderPlacement.test.ts test/ts/SpectrumRoute.mockTxPreview.test.ts --no-coverage`.

---

### Task 4: Verification

- [x] **Step 1:** Confirm no `txCenterFrequencyHz` → `setMockMonitorCenterHz` blind mirror remains.
- [x] **Step 2:** Run focused Jest suite green.
- [x] **Step 3:** Manual check list in PR/summary: enter Mock Tx (aligned), pan (detach), slider (carrier moves, view stays), typed center (jump), Start Tx (visible carrier).
