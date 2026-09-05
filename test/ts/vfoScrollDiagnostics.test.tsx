/** @jest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import fc from "fast-check";
import { useSpectrumInteraction, normalizeWheelPanDelta } from "@n-apt/spectrum/hooks/useSpectrumInteraction";
import { useFrequencyTuning } from "@n-apt/app/routes/pages/spectrum/hooks/useLiveTuning";
import {
  createLiveFrequencyRangePublisher,
} from "@n-apt/app/routes/pages/SpectrumRoute";
import {
  prepareSpectrumRenderData,
  resolveLiveSpectrumPaintContract,
  shouldPresentSpectrumFrameForRange,
} from "@n-apt/spectrum/fft/frameProcessing";
import { createFFTZoomProcessor } from "@n-apt/spectrum/utils/rendering/fftZoom";
import {
  assertScrollPaintSignaled,
  assertVfoScrollInvariants,
  createFrequencyDragHarness,
  DC_ANCHORED_ACQUISITION,
  DEFAULT_HARDWARE_BOUNDS,
  displayViewport,
  mulberry32,
  simulateTrackpadBurst,
  SPECTRUM_MAX_HZ,
  VFO_WHEEL_CLIENT_Y,
} from "./helpers/vfoScrollTestKit";

/**
 * Diagnostic tests for VFO scroll performance regressions.
 *
 * These go beyond "does it move?" correctness checks. Each test asserts a
 * budget or invariant that corresponds to a shipped failure mode:
 *
 *  - step escalation ("increments too large out of the gate")
 *  - unbounded control-plane fan-out (Redux/socket per wheel tick)
 *  - paint stalls (overlay not repainted while waiting for retune frames)
 *  - hot-path blowups in frameProcessing during scroll-lag sequences
 */

const INITIAL_SPAN = DC_ANCHORED_ACQUISITION.max - DC_ANCHORED_ACQUISITION.min;
const FLOOR_DB = -120;
const WHEEL_HOT_PATH_BUDGET_MS = 250;
const FRAME_PREP_HOT_PATH_BUDGET_MS = 400;

describe("VFO scroll diagnostics", () => {
  let harness = createFrequencyDragHarness();

  beforeEach(() => {
    jest.useFakeTimers();
    harness = createFrequencyDragHarness();
    harness.resetGestureState();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("keeps the first cold-start mirror scroll ticks human-scale (no GHz jump)", () => {
    renderHook(() =>
      useSpectrumInteraction(
        harness.buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: null,
        }),
      ),
    );

    let previousCenter = displayViewport(
      harness.frequencyRangeRef,
      harness.vizPanOffsetRef,
      harness.vizZoomRef.current,
    ).center;

    for (let tick = 1; tick <= 40; tick += 1) {
      harness.wheel({ deltaY: -120, clientY: VFO_WHEEL_CLIENT_Y });
      assertVfoScrollInvariants({
        step: tick,
        frequencyRangeRef: harness.frequencyRangeRef,
        vizPanOffsetRef: harness.vizPanOffsetRef,
        vizZoomRef: harness.vizZoomRef,
        mockOnFrequencyRangeChange: harness.mocks.onFrequencyRangeChange,
        initialSpan: INITIAL_SPAN,
        hardwareBounds: { min: 0, max: SPECTRUM_MAX_HZ },
        previousDisplayCenter: previousCenter,
      });
      previousCenter = displayViewport(
        harness.frequencyRangeRef,
        harness.vizPanOffsetRef,
        harness.vizZoomRef.current,
      ).center;
    }
  });

  it("signals an immediate overlay paint on a wheel tick without leaving a timer", () => {
    renderHook(() =>
      useSpectrumInteraction(
        harness.buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
          frequencyRangeRef: { current: { min: 100, max: 110 } },
          signalAreaBounds: { TEST: { min: 100, max: 110 } },
        }),
      ),
    );

    const panCallsBefore = harness.mocks.onVizPanChange.mock.calls.length;
    const rangeCallsBefore =
      harness.mocks.onFrequencyRangeChange.mock.calls.length;
    harness.wheel({ deltaY: 100, clientY: VFO_WHEEL_CLIENT_Y });
    expect(harness.mocks.onVizPanChange.mock.calls.length).toBe(panCallsBefore);
    expect(
      harness.mocks.onFrequencyRangeChange.mock.calls.length,
    ).toBeGreaterThan(rangeCallsBefore);
    expect(harness.mocks.overlayDirty.current).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });


  it("signals an immediate paint path on mirror visual-pan wheel ticks", () => {
    harness.vizPanOffsetRef.current = -500_000;
    renderHook(() =>
      useSpectrumInteraction(
        harness.buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
        }),
      ),
    );

    const panBefore = harness.vizPanOffsetRef.current;
    harness.mocks.overlayDirty.current = false;
    harness.wheel({ deltaY: -40, clientY: VFO_WHEEL_CLIENT_Y });

    expect(harness.vizPanOffsetRef.current).not.toBe(panBefore);
    expect(harness.mocks.onVizPanChange).toHaveBeenCalled();
    expect(harness.mocks.overlayDirty.current).toBe(true);
  });

  it("bounds full-stack device publishes during a trackpad burst", () => {
    const reduxDispatch = jest.fn();
    const sendFrequencyRange = jest.fn();
    const setVizPanOffset = jest.fn((pan: number) => {
      harness.vizPanOffsetRef.current = pan;
    });

    const tuning = renderHook(() =>
      useFrequencyTuning({
        allowNegativeFrequencies: true,
        hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
        activeSignalAreaBounds: { min: 0, max: SPECTRUM_MAX_HZ },
        sampleRateHzEffective: INITIAL_SPAN,
        getAvailableSpectrumBounds: (bounds) =>
          bounds ?? { min: 0, max: SPECTRUM_MAX_HZ },
        frequencyRange: { ...DC_ANCHORED_ACQUISITION },
        vizZoom: 1,
        vizPanOffset: 0,
        reduxDispatch,
        sendFrequencyRange,
        applyTxMonitorForRange: jest.fn(),
        setVizPanOffset,
      }),
    );

    renderHook(() =>
      useSpectrumInteraction(
        harness.buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
          onFrequencyRangeChange: (range) =>
            tuning.result.current.handleFrequencyRangeChange(range, "user-pan"),
        }),
      ),
    );

    const burstEvents = 120;
    simulateTrackpadBurst(harness.wheel, mulberry32(42), burstEvents);

    expect(sendFrequencyRange.mock.calls.length).toBeLessThanOrEqual(3);
    expect(reduxDispatch.mock.calls.length).toBeLessThanOrEqual(3);

    act(() => {
      jest.advanceTimersByTime(250);
    });

    const publishBudget = Math.ceil(250 / 50) + 2;
    expect(sendFrequencyRange.mock.calls.length).toBeLessThanOrEqual(publishBudget);
    expect(reduxDispatch.mock.calls.length).toBeLessThanOrEqual(publishBudget);
  });

  it.each([1, 7, 13, 19, 23])(
    "seeded fuzz keeps step, viewport, and repaint budgets (seed %i)",
    (seed) => {
      const random = mulberry32(seed);
      renderHook(() =>
        useSpectrumInteraction(
          harness.buildOptions({
            allowNegativeFrequencies: true,
            hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
          }),
        ),
      );

      const eventCount = 250;
      let previousCenter = displayViewport(
        harness.frequencyRangeRef,
        harness.vizPanOffsetRef,
        harness.vizZoomRef.current,
      ).center;
      let stateChangingEvents = 0;

      for (let step = 0; step < eventCount; step += 1) {
        const roll = random();
        if (roll < 0.7) {
          const publishBefore = harness.mocks.onFrequencyRangeChange.mock.calls.length;
          const panBefore = harness.vizPanOffsetRef.current;
          const vizPanCallsBefore = harness.mocks.onVizPanChange.mock.calls.length;
          const dragRepaintCallsBefore =
            harness.mocks.onDragRepaint.mock.calls.length;
          harness.mocks.overlayDirty.current = false;
          const magnitude =
            random() < 0.85 ? 40 + random() * 120 : 400 + random() * 600;
          harness.wheel({
            deltaY: (random() < 0.5 ? -1 : 1) * magnitude,
          });
          const publishAfter = harness.mocks.onFrequencyRangeChange.mock.calls.length;
          assertScrollPaintSignaled(
            harness.mocks.overlayDirty,
            vizPanCallsBefore,
            dragRepaintCallsBefore,
            harness.mocks.onVizPanChange.mock.calls.length,
            harness.mocks.onDragRepaint.mock.calls.length,
            panBefore,
            harness.vizPanOffsetRef.current,
            publishBefore,
            publishAfter,
          );
          if (panBefore !== harness.vizPanOffsetRef.current || publishAfter > publishBefore) {
            stateChangingEvents += 1;
          }
          assertVfoScrollInvariants({
            step,
            seed,
            frequencyRangeRef: harness.frequencyRangeRef,
            vizPanOffsetRef: harness.vizPanOffsetRef,
            vizZoomRef: harness.vizZoomRef,
            mockOnFrequencyRangeChange: harness.mocks.onFrequencyRangeChange,
            initialSpan: INITIAL_SPAN,
            previousDisplayCenter: previousCenter,
          });
          previousCenter = displayViewport(
            harness.frequencyRangeRef,
            harness.vizPanOffsetRef,
            harness.vizZoomRef.current,
          ).center;
        } else if (roll < 0.85) {
          harness.wheel({ ctrlKey: true, deltaY: (random() < 0.5 ? -1 : 1) * 20 });
        } else {
          act(() => {
            jest.advanceTimersByTime(60);
          });
        }
      }

      expect(stateChangingEvents).toBeGreaterThan(0);
      expect(harness.mocks.onFrequencyRangeChange.mock.calls.length).toBeLessThan(
        stateChangingEvents * 3,
      );
    },
  );
});

describe("wheel normalization fuzz", () => {
  it("never emits more than 24 plot pixels per native wheel event", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }),
        fc.constantFrom(0, 1, 2),
        fc.integer({ min: 200, max: 2000 }),
        (delta, deltaMode, pageHeight) => {
          const normalized = normalizeWheelPanDelta(delta, deltaMode, pageHeight);
          expect(Math.abs(normalized)).toBeLessThanOrEqual(24);
        },
      ),
    );
  });
});

describe("DC-region scroll uniformity", () => {
  let harness = createFrequencyDragHarness();

  beforeEach(() => {
    jest.useFakeTimers();
    harness = createFrequencyDragHarness();
    harness.resetGestureState();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("keeps DC-crossing wheel ticks within a uniform step band (no stall, no jump)", () => {
    // Set the shared harness refs directly (not via buildOptions overrides,
    // which would detach the hook from the refs the trace reads).
    harness.frequencyRangeRef.current = { min: 0, max: 4_372_000 };
    harness.vizPanOffsetRef.current = -100_000;
    renderHook(() =>
      useSpectrumInteraction(
        harness.buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
        }),
      ),
    );

    let previousCenter = displayViewport(
      harness.frequencyRangeRef,
      harness.vizPanOffsetRef,
      harness.vizZoomRef.current,
    ).center;

    // Scroll downward (into the mirror) with a uniform delta. A healthy
    // gesture moves the displayed center each tick; the only legitimate
    // zero-step ticks are hardware-retune holds (the acquisition shifts but
    // the viewport is intentionally held fixed while the frame catches up).
    let stateChangingTicks = 0;
    let zeroStepTicks = 0;
    for (let tick = 1; tick <= 30; tick += 1) {
      const panBefore = harness.vizPanOffsetRef.current;
      const publishesBefore =
        harness.mocks.onFrequencyRangeChange.mock.calls.length;
      harness.wheel({ deltaY: -40, clientY: VFO_WHEEL_CLIENT_Y });
      const viewport = displayViewport(
        harness.frequencyRangeRef,
        harness.vizPanOffsetRef,
        harness.vizZoomRef.current,
      );
      const stepHz = Math.abs(viewport.center - previousCenter);
      // No tick may teleport (step budget from the invariants).
      expect(stepHz).toBeLessThanOrEqual(viewport.span * 3 + 2);
      const stateChanged =
        harness.vizPanOffsetRef.current !== panBefore ||
        harness.mocks.onFrequencyRangeChange.mock.calls.length > publishesBefore;
      if (stateChanged) {
        stateChangingTicks += 1;
        if (stepHz === 0) {
          zeroStepTicks += 1;
        }
      }
      previousCenter = viewport.center;
    }

    // The gesture must keep moving overall: most ticks advance the display,
    // and at most a couple of hardware-retune holds may show zero motion.
    expect(stateChangingTicks).toBeGreaterThan(0);
    expect(zeroStepTicks).toBeLessThanOrEqual(stateChangingTicks / 2);

    assertVfoScrollInvariants({
      step: 30,
      seed: 7,
      frequencyRangeRef: harness.frequencyRangeRef,
      vizPanOffsetRef: harness.vizPanOffsetRef,
      vizZoomRef: harness.vizZoomRef,
      mockOnFrequencyRangeChange: harness.mocks.onFrequencyRangeChange,
      initialSpan: INITIAL_SPAN,
    });
  });

  it("keeps the first scroll tick in the natural direction (no transient reversal)", () => {
    // Fresh state: acquisition at DC, pan at 0 (mirror on). The user reports
    // the first scroll moving opposite before settling into the natural
    // direction; the first tick must move the display center the same way as
    // the second tick.
    harness.frequencyRangeRef.current = { min: 0, max: 4_372_000 };
    harness.vizPanOffsetRef.current = 0;
    renderHook(() =>
      useSpectrumInteraction(
        harness.buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
        }),
      ),
    );

    const centerAt = () =>
      displayViewport(
        harness.frequencyRangeRef,
        harness.vizPanOffsetRef,
        harness.vizZoomRef.current,
      ).center;

    const start = centerAt();
    harness.wheel({ deltaY: 120, clientY: VFO_WHEEL_CLIENT_Y });
    const afterFirst = centerAt();
    harness.wheel({ deltaY: 120, clientY: VFO_WHEEL_CLIENT_Y });
    const afterSecond = centerAt();

    const firstStep = afterFirst - start;
    const secondStep = afterSecond - afterFirst;
    // Both ticks must move the display center the same direction (positive
    // deltaY scrolls toward lower frequencies: descending center).
    expect(firstStep).toBeLessThan(0);
    expect(secondStep).toBeLessThan(0);
  });

  it("does not flip the pan axis on first-event trackpad jitter", () => {
    harness.frequencyRangeRef.current = { min: 0, max: 4_372_000 };
    harness.vizPanOffsetRef.current = 0;
    renderHook(() =>
      useSpectrumInteraction(
        harness.buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
        }),
      ),
    );

    const centerAt = () =>
      displayViewport(
        harness.frequencyRangeRef,
        harness.vizPanOffsetRef,
        harness.vizZoomRef.current,
      ).center;

    const start = centerAt();
    // First event: a vertical scroll whose deltaX is slightly larger (jitter)
    // but not a clearly-horizontal gesture. It must still pan with deltaY.
    harness.wheel({ deltaX: 30, deltaY: 20, clientY: VFO_WHEEL_CLIENT_Y });
    const afterFirst = centerAt();
    // Second event: clean vertical scroll.
    harness.wheel({ deltaX: 0, deltaY: 120, clientY: VFO_WHEEL_CLIENT_Y });
    const afterSecond = centerAt();

    const firstStep = afterFirst - start;
    const secondStep = afterSecond - afterFirst;
    // The jittery first event must not reverse the direction.
    expect(firstStep).toBeLessThan(0);
    expect(secondStep).toBeLessThan(0);
  });

  it("coalesces a momentum burst crossing DC to bounded hardware retunes", () => {
    renderHook(() =>
      useSpectrumInteraction(
        harness.buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
          frequencyRangeRef: { current: { min: 0, max: 4_372_000 } },
          vizPanOffsetRef: { current: 0 },
        }),
      ),
    );

    const burstEvents = 60;
    simulateTrackpadBurst(harness.wheel, mulberry32(3), burstEvents);

    // The gesture must not publish a device retune per wheel tick. The 50 ms
    // cadence coalesces a burst to a handful of publishes.
    expect(harness.mocks.onFrequencyRangeChange.mock.calls.length).toBeLessThanOrEqual(
      Math.ceil(burstEvents / 4) + 2,
    );

    // Every state-changing tick must still have signaled a paint path.
    assertScrollPaintSignaled(
      harness.mocks.overlayDirty,
      0,
      0,
      harness.mocks.onVizPanChange.mock.calls.length,
      harness.mocks.onDragRepaint.mock.calls.length,
      0,
      harness.vizPanOffsetRef.current,
      0,
      harness.mocks.onFrequencyRangeChange.mock.calls.length,
    );
  });
});

describe("zoom reset and subscriber-independent VFO bounds", () => {
  let harness = createFrequencyDragHarness();

  beforeEach(() => {
    jest.useFakeTimers();
    harness = createFrequencyDragHarness();
    harness.resetGestureState();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("continues hardware scrolling after returning from zoom to 1x", () => {
    renderHook(() =>
      useSpectrumInteraction(
        harness.buildOptions({
          allowNegativeFrequencies: false,
          hardwareSpectrumBounds: { min: 0, max: SPECTRUM_MAX_HZ },
        }),
      ),
    );

    harness.wheel({ ctrlKey: true, deltaY: -200 });
    harness.wheel({ ctrlKey: true, deltaY: 200 });

    expect(harness.vizZoomRef.current).toBeCloseTo(1, 8);

    harness.wheel({ deltaY: 40, clientY: VFO_WHEEL_CLIENT_Y });

    expect(harness.mocks.onFrequencyRangeChange).toHaveBeenCalled();
    expect(harness.vizPanOffsetRef.current).toBe(0);
  });
});

describe("live frequency publisher burst fuzz", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("coalesces random gesture publishes far below submit count", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 200 }),
        fc.integer({ min: 1, max: 99_999_999 }),
        (submitCount, seed) => {
          const random = mulberry32(seed);
          const setFrequencyRange = jest.fn();
          const sendFrequencyRange = jest.fn();
          const publisher = createLiveFrequencyRangePublisher(
            setFrequencyRange,
            sendFrequencyRange,
          );

          for (let index = 0; index < submitCount; index += 1) {
            const center = Math.floor(random() * 1_000_000_000);
            publisher.publish({ min: center, max: center + INITIAL_SPAN });
          }

          expect(sendFrequencyRange.mock.calls.length).toBeLessThanOrEqual(3);

          jest.advanceTimersByTime(250);
          const publishBudget = Math.ceil(250 / 50) + 2;
          expect(sendFrequencyRange.mock.calls.length).toBeLessThanOrEqual(
            publishBudget,
          );
          expect(sendFrequencyRange.mock.calls.length).toBeLessThan(submitCount);
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("scroll-lag paint contract diagnostics", () => {
  const waveform = new Float32Array(4096).fill(-80);
  const getZoomedData = createFFTZoomProcessor(FLOOR_DB).process;

  it("keeps paint on the resident frame axis while the requested VFO runs ahead", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 25_000_000_000 }),
        fc.integer({ min: 1_000_000, max: 8_000_000 }),
        fc.integer({ min: -5_000_000_000, max: 5_000_000_000 }),
        (centerHz, sampleRateHz, panOffsetHz) => {
          const sourceFrequencyRange = {
            min: centerHz - sampleRateHz / 2,
            max: centerHz + sampleRateHz / 2,
          };
          const requestedViewRange = {
            min: centerHz - sampleRateHz,
            max: centerHz + sampleRateHz,
          };

          const contract = resolveLiveSpectrumPaintContract({
            requestedViewRange,
            sourceFrequencyRange,
            zoom: 1,
            panOffsetHz,
            mirrorEnabled: true,
            frameCenterHz: centerHz,
            frameSampleRateHz: sampleRateHz,
          });

          expect(contract.paintViewportRange).toEqual(sourceFrequencyRange);
          expect(
            shouldPresentSpectrumFrameForRange({
              frameCenterHz: centerHz,
              frameSampleRateHz: sampleRateHz,
              requestedRange: requestedViewRange,
              requiresExactRange: false,
            }),
          ).toBe(true);

          expect(() =>
            prepareSpectrumRenderData({
              waveform,
              frequencyRange: contract.paintViewportRange,
              sourceFrequencyRange: contract.sourceFrequencyRange,
              zoom: contract.zoom,
              panOffset: contract.panOffsetHz,
              invert: false,
              dbMin: FLOOR_DB,
              dbMax: 0,
              allowNegativeFrequencies: true,
              mirrorOnGpu: true,
              resampleOnGpu: true,
              getZoomedData,
            }),
          ).not.toThrow();
        },
      ),
      { numRuns: 40 },
    );
  });

  it("prepareSpectrumRenderData stays bounded under scroll-lag sequences", () => {
    const startedAt = performance.now();
    for (let step = 0; step < 500; step += 1) {
      const centerHz = 1_000_000 + step * 250_000;
      const sampleRateHz = 4_372_000;
      const sourceFrequencyRange = {
        min: centerHz - sampleRateHz / 2,
        max: centerHz + sampleRateHz / 2,
      };
      const requestedViewRange = {
        min: centerHz - sampleRateHz,
        max: centerHz + sampleRateHz,
      };
      const contract = resolveLiveSpectrumPaintContract({
        requestedViewRange,
        sourceFrequencyRange,
        zoom: 1,
        panOffsetHz: step % 2 === 0 ? -sampleRateHz / 4 : sampleRateHz / 4,
        mirrorEnabled: true,
        frameCenterHz: centerHz - sampleRateHz / 8,
        frameSampleRateHz: sampleRateHz,
      });

      prepareSpectrumRenderData({
        waveform,
        frequencyRange: contract.paintViewportRange,
        sourceFrequencyRange: contract.sourceFrequencyRange,
        zoom: contract.zoom,
        panOffset: contract.panOffsetHz,
        invert: false,
        dbMin: FLOOR_DB,
        dbMax: 0,
        allowNegativeFrequencies: true,
        mirrorOnGpu: true,
        resampleOnGpu: true,
        getZoomedData,
      });
    }
    expect(performance.now() - startedAt).toBeLessThan(FRAME_PREP_HOT_PATH_BUDGET_MS);
  });
});

describe("wheel handler hot path budget", () => {
  let harness = createFrequencyDragHarness();

  beforeEach(() => {
    jest.useFakeTimers();
    harness = createFrequencyDragHarness();
    harness.resetGestureState();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("processes a dense trackpad burst within a deterministic time budget", () => {
    renderHook(() =>
      useSpectrumInteraction(
        harness.buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
        }),
      ),
    );

    const startedAt = performance.now();
    simulateTrackpadBurst(harness.wheel, mulberry32(99), 400);
    expect(performance.now() - startedAt).toBeLessThan(WHEEL_HOT_PATH_BUDGET_MS);
  });
});
