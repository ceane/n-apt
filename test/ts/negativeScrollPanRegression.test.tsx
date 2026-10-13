/** @jest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { useSpectrumInteraction } from "@n-apt/spectrum/hooks/useSpectrumInteraction";
import React from "react";

/**
 * Regression: sustained negative-direction scroll panning.
 *
 * User report: with "Mirror spectrum below 0Hz" on, scrolling into the
 * mirrored axis behaves normally (kHz-scale steps) until a threshold around
 * −200 MHz, where the viewport then JUMPS to about −29 GHz in one step and
 * the spectrum freezes.
 *
 * The wheel events must target the pan surface (bottom VFO/margin rows) —
 * wheel events over the plot center are ignored by the hook.
 */

const SPECTRUM_MAX_HZ = 30_000_000_000;
const HARDWARE_BOUNDS = { min: 10_000, max: 6_000_000_000 };
/** One HackRF sample-rate window, DC-anchored. */
const ACQUISITION = { min: 0, max: 4_372_000 };

describe("negative-direction scroll panning regression", () => {
  const mockOnFrequencyRangeChange = jest.fn();
  const mockOnVizPanChange = jest.fn();
  const mockOnVizZoomChange = jest.fn();
  const mockOnVizZoomFloorChange = jest.fn();
  const mockOnFftDbLimitsChange = jest.fn();
  const mockOnSelectionChange = jest.fn();
  const mockOnPowerLineDbChange = jest.fn();
  const mockOnTxCenterFrequencyChange = jest.fn();
  const mockOnTxSampleRateChange = jest.fn();
  const mockOnTxOptionsRequest = jest.fn();
  const mockOnDragRepaint = jest.fn();

  const frequencyRangeRef = { current: { ...ACQUISITION } };
  const vizPanOffsetRef = { current: 0 };
  const vizZoomRef = { current: 1 };
  const vizZoomFloorRef = { current: 1 };
  const vizDbMinRef = { current: -120 };
  const vizDbMaxRef = { current: 0 };

  const spectrumGpuCanvasRef = {
    current: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 1000,
        height: 600,
      }),
    },
  } as any;
  const spectrumContainerRef = {
    current: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 1000,
        height: 600,
      }),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      classList: {
        contains: jest.fn().mockReturnValue(false),
        add: jest.fn(),
        remove: jest.fn(),
      },
      style: { cursor: "" },
      setPointerCapture: jest.fn(),
      releasePointerCapture: jest.fn(),
      appendChild: jest.fn(),
      focus: jest.fn(),
    },
  } as any;

  const buildOptions = (overrides: Record<string, unknown> = {}): any => ({
    spectrumGpuCanvasRef,
    spectrumGpuCanvasNode: spectrumGpuCanvasRef.current,
    spectrumContainerRef,
    frequencyRangeRef,
    spectrumWebgpuEnabled: true,
    activeSignalArea: "TEST",
    signalAreaBounds: { TEST: { min: 0, max: SPECTRUM_MAX_HZ } },
    onFrequencyRangeChange: mockOnFrequencyRangeChange,
    onVizPanChange: mockOnVizPanChange,
    onVizZoomChange: mockOnVizZoomChange,
    onVizZoomFloorChange: mockOnVizZoomFloorChange,
    onFftDbLimitsChange: mockOnFftDbLimitsChange,
    onSelectionChange: mockOnSelectionChange,
    onPowerLineDbChange: mockOnPowerLineDbChange,
    onTxCenterFrequencyChange: mockOnTxCenterFrequencyChange,
    onTxSampleRateChange: mockOnTxSampleRateChange,
    onTxOptionsRequest: mockOnTxOptionsRequest,
    onDragRepaint: mockOnDragRepaint,
    vizZoomRef,
    vizZoomFloorRef,
    vizPanOffsetRef,
    vizDbMinRef,
    vizDbMaxRef,
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    frequencyRangeRef.current = { ...ACQUISITION };
    vizPanOffsetRef.current = 0;
    vizZoomRef.current = 1;
    vizZoomFloorRef.current = 1;
    jest.spyOn(window, "addEventListener").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const containerHandler = (eventName: string) => {
    const calls =
      spectrumContainerRef.current.addEventListener.mock.calls.filter(
        (c: any) => c[0] === eventName,
      );
    return calls[calls.length - 1]?.[1];
  };

  const wheelTick = (deltaY: number) => {
    const handler = containerHandler("wheel");
    act(() => {
      handler({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        clientX: 500,
        clientY: 590,
        deltaX: 0,
        deltaY,
        ctrlKey: false,
      } as any);
      // Wheel pan is intentionally coalesced to one bounded calculation per
      // animation frame. Execute that frame so this regression exercises the
      // real frequency transition instead of asserting against a no-op.
      jest.advanceTimersByTime(17);
    });
  };

  it("scrolls into the mirrored axis with bounded steps and a bounded viewport", () => {
    renderHook(() =>
      useSpectrumInteraction(
        buildOptions({ allowNegativeFrequencies: true, hardwareSpectrumBounds: HARDWARE_BOUNDS }),
      ),
    );

    const initialSpan = ACQUISITION.max - ACQUISITION.min;

    for (let tick = 1; tick <= 400; tick += 1) {
      const centerBefore =
        (frequencyRangeRef.current.min + frequencyRangeRef.current.max) / 2;
      const panBefore = vizPanOffsetRef.current;

      wheelTick(120);

      // Every published window stays inside the tunable spectrum.
      for (const range of mockOnFrequencyRangeChange.mock.calls.map(
        (call) => call[0],
      )) {
        expect(range.min).toBeGreaterThanOrEqual(0);
        expect(range.max).toBeLessThanOrEqual(SPECTRUM_MAX_HZ);
        // The acquisition never widens: the device holds one SR window.
        expect(range.max - range.min).toBeLessThanOrEqual(initialSpan * 1.01 + 1);
      }

      // No single tick may move the displayed center by more than a small
      // multiple of the viewport — this is the "step up to −29 GHz" detector.
      const { min, max } = frequencyRangeRef.current;
      const center = (min + max) / 2;
      const visualRange = (max - min) / vizZoomRef.current;
      const displayCenterBefore = centerBefore + panBefore;
      const displayCenterAfter = center + vizPanOffsetRef.current;
      const step = Math.abs(displayCenterAfter - displayCenterBefore);
      expect(
        `tick=${tick} displayCenter=${displayCenterAfter.toExponential(3)}`,
      ).toBe(
        `tick=${tick} displayCenter=${displayCenterAfter.toExponential(3)}`,
      );
      expect(step).toBeLessThanOrEqual(visualRange * 3 + 2);

      // Viewport stays inside the mirrored spectrum extent.
      expect(displayCenterAfter - visualRange / 2).toBeGreaterThanOrEqual(
        -SPECTRUM_MAX_HZ - 1,
      );
      expect(displayCenterAfter + visualRange / 2).toBeLessThanOrEqual(
        SPECTRUM_MAX_HZ + 1,
      );
    }
  });

  it("clamps a continued negative momentum gesture to the signed 30 GHz limit", () => {
    renderHook(() =>
      useSpectrumInteraction(
        buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: { min: 0, max: SPECTRUM_MAX_HZ },
        }),
      ),
    );

    // A trackpad can deliver a large inertial delta in one event. Once the
    // positive acquisition is pinned at the hardware ceiling, a second event
    // must clamp the signed display viewport instead of letting its pan run
    // into the THz range.
    wheelTick(10_000_000);
    wheelTick(10_000_000);

    const { min, max } = frequencyRangeRef.current;
    const center = (min + max) / 2;
    const viewportSpan = max - min;
    const displayCenter = center + vizPanOffsetRef.current;
    expect(displayCenter - viewportSpan / 2).toBeGreaterThanOrEqual(
      -SPECTRUM_MAX_HZ - 1,
    );
    expect(displayCenter + viewportSpan / 2).toBeLessThanOrEqual(
      SPECTRUM_MAX_HZ + 1,
    );
  });

  it("reanchors once at the negative spectrum edge without repeating the same request", () => {
    renderHook(() =>
      useSpectrumInteraction(
        buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: { min: 0, max: SPECTRUM_MAX_HZ },
        }),
      ),
    );
    vizPanOffsetRef.current = -40_000_000_000;

    // Positive wheel deltas move the signed viewport toward lower Hz. The
    // first event must move the hardware acquisition to the mirrored edge;
    // the next event must continue from that new axis, not publish the same
    // retune forever.
    wheelTick(120);
    const callsAfterFirstRetune = mockOnFrequencyRangeChange.mock.calls.length;
    const firstRange =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ]?.[0] ?? null;
    const firstLocalRange = { ...frequencyRangeRef.current };
    wheelTick(120);
    const secondRange =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ]?.[0] ?? null;

    expect(firstRange).not.toBeNull();
    expect(secondRange).not.toBeNull();
    expect(firstLocalRange).toEqual(firstRange);
    expect(mockOnFrequencyRangeChange).toHaveBeenCalledTimes(
      callsAfterFirstRetune,
    );
    expect(secondRange).toEqual(firstRange);
  });

  it("publishes the mirrored pan re-anchor before the matching hardware range", () => {
    const publishOrder: string[] = [];
    const onVizPanReanchor = jest.fn((pan: number) => {
      publishOrder.push(`pan:${Math.round(pan)}`);
      vizPanOffsetRef.current = pan;
    });
    const onFrequencyRangeChange = jest.fn(() => {
      publishOrder.push("range");
    });

    renderHook(() =>
      useSpectrumInteraction(
        buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: { min: 0, max: SPECTRUM_MAX_HZ },
          onVizPanReanchor,
          onFrequencyRangeChange,
        }),
      ),
    );
    vizPanOffsetRef.current = -40_000_000_000;

    wheelTick(120);

    expect(onVizPanReanchor).toHaveBeenCalledTimes(1);
    expect(onFrequencyRangeChange).toHaveBeenCalled();
    expect(publishOrder[0]).toMatch(/^pan:/);
    expect(publishOrder[1]).toBe("range");
  });

  it("uses the global spectrum fallback instead of channel bounds before hardware bounds hydrate", () => {
    renderHook(() =>
      useSpectrumInteraction(
        buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: null,
          signalAreaBounds: { TEST: { min: 24_100_000, max: 30_370_000 } },
        }),
      ),
    );
    vizPanOffsetRef.current = -40_000_000_000;

    wheelTick(120);

    const firstRange =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ]?.[0];
    expect(firstRange.max).toBe(SPECTRUM_MAX_HZ);
  });

  it("keeps a zoomed VFO scroll as a visual pan instead of snapping to hardware center", () => {    // User report: zoomed into a 3.2 MHz window (hardware center 1.6 MHz),
    // panned left toward 0 Hz, then any scroll over the VFO snapped the
    // display back to 1.6 MHz. With the mirror off, every VFO gesture took
    // the hardware-retune path, which re-anchored the window and zeroed the
    // pan — even when the clamp left the window unmoved.
    frequencyRangeRef.current = { min: 0, max: 3_200_000 };
    vizZoomRef.current = 4;
    vizPanOffsetRef.current = -500_000;
    renderHook(() =>
      useSpectrumInteraction(
        buildOptions({
          allowNegativeFrequencies: false,
          hardwareSpectrumBounds: { min: 0, max: SPECTRUM_MAX_HZ },
        }),
      ),
    );

    wheelTick(120);

    // No hardware retune: the acquisition window stays put.
    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
    // The pan advances left instead of being zeroed to hardware center.
    expect(mockOnVizPanChange).toHaveBeenCalled();
    const lastPan =
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ]?.[0];
    expect(lastPan).toBeLessThan(-500_000);
    expect(lastPan).toBeGreaterThan(-1_200_000);
    expect(vizPanOffsetRef.current).toBe(lastPan);
    // Display center moves toward 0 Hz, not back to 1.6 MHz.
    const displayCenter =
      (frequencyRangeRef.current.min +
        frequencyRangeRef.current.max) /
        2 +
      lastPan;
    expect(displayCenter).toBeLessThan(1_600_000);
  });

  it("does not republish a pinned window on every tick at the acquisition edge", () => {
    // Mirror off, zoomed 4x into [0, 3.2 MHz] (pan bounds +/-1.2 MHz),
    // panning left into the pinned 0 Hz edge. The tuning bounds leave the
    // window unmoved, so each tick must be a pure visual-pan clamp — queuing
    // an identical hardware range per tick feeds the echo cycle with zero
    // motion and the viewport flickers between stale windows.
    frequencyRangeRef.current = { min: 0, max: 3_200_000 };
    vizZoomRef.current = 4;
    vizPanOffsetRef.current = -1_100_000;
    renderHook(() =>
      useSpectrumInteraction(
        buildOptions({
          allowNegativeFrequencies: false,
          hardwareSpectrumBounds: { min: 0, max: SPECTRUM_MAX_HZ },
        }),
      ),
    );

    for (let tick = 0; tick < 6; tick += 1) {
      wheelTick(120);
    }

    // No hardware range publish: the window never moved.
    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
    expect(frequencyRangeRef.current).toEqual({ min: 0, max: 3_200_000 });

    // The pan advances contiguously past the acquisition edge (device-scale
    // navigation bounds, same as plot-body scrolling) — strictly decreasing,
    // never snapping back, never resetting to hardware center.
    const pans = mockOnVizPanChange.mock.calls.map((call) => call[0]);
    expect(pans.length).toBeGreaterThan(0);
    for (const pan of pans) {
      expect(pan).toBeLessThan(-1_100_000);
    }
    for (let i = 1; i < pans.length; i += 1) {
      expect(pans[i]).toBeLessThan(pans[i - 1]);
    }
    expect(vizPanOffsetRef.current).toBe(pans[pans.length - 1]);
  });
});
