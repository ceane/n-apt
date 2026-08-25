/** @jest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { useFrequencyDrag } from "@n-apt/spectrum/hooks/useFrequencyDrag";
import React from "react";

/**
 * Gesture-sequence invariants for the live tuning hook.
 *
 * These tests drive long, realistic gesture sequences (trackpad scroll into
 * and back out of the mirrored axis, pointer drag, pinch zoom) and assert the
 * tuning invariants after EVERY event:
 *
 *  1. Every published hardware window stays inside the tunable spectrum
 *     (out-of-bounds publishes are what get the backend to reject a tune and
 *     freeze the frontend waiting for frames that never arrive).
 *  2. The mirrored display viewport stays inside the ±spectrum extent
 *     (unbounded pan used to run away to hundreds of GHz).
 *  3. A mirror retune converges: once the window is pinned at a spectrum
 *     edge, further scrolling must not re-anchor pan by another spectrum-
 *     reach per tick (the stale-sourceRange ratchet).
 */

const SPECTRUM_MAX_HZ = 30_000_000_000;
/** HackRF-class device range, as hardware_info would report it. */
const HARDWARE_BOUNDS = { min: 10_000, max: 6_000_000_000 };
/** Device acquisition window used by every scenario. */
const ACQUISITION = { min: 100, max: 110 };
const CANVAS_WIDTH = 1000;

describe("useLiveTuning gesture invariants", () => {
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
        width: CANVAS_WIDTH,
        height: 600,
      }),
    },
  } as any;
  const spectrumContainerRef = {
    current: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: CANVAS_WIDTH,
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
    signalAreaBounds: { TEST: { min: 0, max: 1000 } },
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

  let listeners: Record<string, Function> = {};
  const listenerCallbacks = new Map<string, Set<Function>>();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    listeners = {};
    listenerCallbacks.clear();
    frequencyRangeRef.current = { ...ACQUISITION };
    vizPanOffsetRef.current = 0;
    vizZoomRef.current = 1;
    vizZoomFloorRef.current = 1;

    jest.spyOn(window, "addEventListener").mockImplementation((event, cb) => {
      let callbacks = listenerCallbacks.get(event);
      if (!callbacks) {
        callbacks = new Set();
        listenerCallbacks.set(event, callbacks);
        listeners[event] = (...args: any[]) => {
          callbacks!.forEach((h) => h(...args));
        };
      }
      callbacks.add(cb as Function);
    });
    jest
      .spyOn(window, "removeEventListener")
      .mockImplementation((event, cb) => {
        listenerCallbacks.get(event)?.delete(cb as Function);
      });
    spectrumContainerRef.current.addEventListener.mockClear();
    spectrumContainerRef.current.removeEventListener.mockClear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const hookListeners = (): Record<string, Function> => {
    const result: Record<string, Function> = {};
    for (const [name, callbacks] of listenerCallbacks) {
      result[name] = (...args: any[]) => {
        callbacks.forEach((h) => h(...args));
      };
    }
    return result;
  };

  const containerHandler = (eventName: string) => {
    const calls =
      spectrumContainerRef.current.addEventListener.mock.calls.filter(
        (c: any) => c[0] === eventName,
      );
    return calls[calls.length - 1]?.[1];
  };

  const wheel = (payload: {
    deltaX?: number;
    deltaY?: number;
    ctrlKey?: boolean;
    clientX?: number;
    clientY?: number;
  }) => {
    const handler = containerHandler("wheel");
    act(() => {
      handler({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        clientX: 500,
        clientY: 300,
        deltaX: 0,
        deltaY: 0,
        ctrlKey: false,
        ...payload,
      } as any);
    });
  };

  const pointerDown = (clientX: number, clientY: number, pointerId = 1) => {
    const handler = containerHandler("pointerdown");
    act(() => {
      handler({ clientX, clientY, pointerId } as any);
    });
  };

  const pointerMove = (clientX: number, clientY: number, pointerId = 1) => {
    const handler = hookListeners()["pointermove"];
    act(() => {
      handler({ clientX, clientY, pointerId } as any);
    });
  };

  const pointerUp = (clientX: number, clientY: number, pointerId = 1) => {
    const handler = hookListeners()["pointerup"];
    act(() => {
      handler({ clientX, clientY, pointerId } as any);
    });
  };

  const publishedRanges = () =>
    mockOnFrequencyRangeChange.mock.calls.map((call) => call[0]);

  const expectEveryPublishedRangeInsideSpectrum = () => {
    for (const range of publishedRanges()) {
      expect(range.min).toBeGreaterThanOrEqual(HARDWARE_BOUNDS.min);
      expect(range.max).toBeLessThanOrEqual(HARDWARE_BOUNDS.max);
      expect(range.min).toBeGreaterThanOrEqual(0);
      expect(range.max).toBeLessThanOrEqual(SPECTRUM_MAX_HZ);
      expect(Number.isFinite(range.min)).toBe(true);
      expect(Number.isFinite(range.max)).toBe(true);
    }
  };

  /** The displayed viewport implied by the live refs. */
  const displayViewport = (zoom: number) => {
    const { min, max } = frequencyRangeRef.current;
    const center = (min + max) / 2;
    const visualRange = (max - min) / zoom;
    const pan = vizPanOffsetRef.current;
    return { min: center + pan - visualRange / 2, max: center + pan + visualRange / 2 };
  };

  const expectViewportInsideMirroredSpectrum = (zoom: number) => {
    const viewport = displayViewport(zoom);
    expect(viewport.min).toBeGreaterThanOrEqual(-SPECTRUM_MAX_HZ - 1);
    expect(viewport.max).toBeLessThanOrEqual(SPECTRUM_MAX_HZ + 1);
  };

  it("scrolling deep into the mirrored axis and back never publishes out-of-bounds windows or runs away", () => {
    renderHook(() => useFrequencyDrag(buildOptions({
      allowNegativeFrequencies: true,
      hardwareSpectrumBounds: HARDWARE_BOUNDS,
    })));

    // 120 trackpad ticks down: cross DC and travel deep into the mirror.
    for (let tick = 0; tick < 120; tick += 1) {
      wheel({ deltaY: 120 });
      expectEveryPublishedRangeInsideSpectrum();
      expectViewportInsideMirroredSpectrum(vizZoomRef.current);
    }

    const deepestPan = vizPanOffsetRef.current;
    expect(deepestPan).toBeLessThanOrEqual(0);

    // 240 ticks up: cross back through DC into positive territory.
    for (let tick = 0; tick < 240; tick += 1) {
      wheel({ deltaY: -120 });
      expectEveryPublishedRangeInsideSpectrum();
      expectViewportInsideMirroredSpectrum(vizZoomRef.current);
    }

    // The viewport must have come back, not pinned at an extreme.
    expect(vizPanOffsetRef.current).toBeGreaterThanOrEqual(
      -SPECTRUM_MAX_HZ - HARDWARE_BOUNDS.max,
    );
  });

  it("a mirror retune at the spectrum edge converges instead of ratcheting pan per tick", () => {
    renderHook(() => useFrequencyDrag(buildOptions({
      allowNegativeFrequencies: true,
      hardwareSpectrumBounds: HARDWARE_BOUNDS,
    })));

    // Travel into the mirror until the window pins at the spectrum edge.
    for (let tick = 0; tick < 200; tick += 1) {
      wheel({ deltaY: 120 });
    }
    const pinnedRange = { ...frequencyRangeRef.current };
    const pinnedPan = vizPanOffsetRef.current;

    // Keep scrolling the same direction: the window is pinned, so the
    // acquisition must not change and pan must not keep absorbing
    // spectrum-reach-sized re-anchors.
    for (let tick = 0; tick < 60; tick += 1) {
      wheel({ deltaY: 120 });
      expectEveryPublishedRangeInsideSpectrum();
      expectViewportInsideMirroredSpectrum(vizZoomRef.current);
    }

    expect(frequencyRangeRef.current).toEqual(pinnedRange);
    // Pan may absorb at most the remaining slack to the extent edge, never a
    // per-tick spectrum-reach ratchet.
    expect(Math.abs(vizPanOffsetRef.current - pinnedPan)).toBeLessThan(
      SPECTRUM_MAX_HZ,
    );
  });

  it("pointer dragging across DC and back respects both spectrum caps", () => {
    renderHook(() => useFrequencyDrag(buildOptions({
      allowNegativeFrequencies: true,
      hardwareSpectrumBounds: HARDWARE_BOUNDS,
    })));

    pointerDown(500, 550);
    for (let step = 1; step <= 60; step += 1) {
      pointerMove(500 + step * 20, 550);
      expectEveryPublishedRangeInsideSpectrum();
    }
    for (let step = 1; step <= 120; step += 1) {
      pointerMove(1700 - step * 20, 550);
      expectEveryPublishedRangeInsideSpectrum();
    }
    pointerUp(500, 550);

    expectEveryPublishedRangeInsideSpectrum();
  });

  it("pinch to zoom keeps the anchored frequency under the cursor and the viewport in bounds", () => {
    renderHook(() => useFrequencyDrag(buildOptions({
      allowNegativeFrequencies: true,
      hardwareSpectrumBounds: HARDWARE_BOUNDS,
    })));

    // Zoom in hard with ctrl+wheel (trackpad pinch), then pan while zoomed.
    for (let tick = 0; tick < 30; tick += 1) {
      wheel({ ctrlKey: true, deltaY: -20 });
      const zoom = vizZoomRef.current;
      expect(zoom).toBeGreaterThanOrEqual(1);
      expectViewportInsideMirroredSpectrum(zoom);
    }

    for (let tick = 0; tick < 40; tick += 1) {
      wheel({ deltaY: 100 });
      expectEveryPublishedRangeInsideSpectrum();
      expectViewportInsideMirroredSpectrum(vizZoomRef.current);
    }

    // Zoom back out to 1x.
    for (let tick = 0; tick < 40; tick += 1) {
      wheel({ ctrlKey: true, deltaY: 20 });
      const zoom = vizZoomRef.current;
      expect(zoom).toBeGreaterThanOrEqual(1);
      expectViewportInsideMirroredSpectrum(zoom);
    }

    expectEveryPublishedRangeInsideSpectrum();
  });

  it("stays in bounds even before hardware bounds hydrate (cold start)", () => {
    renderHook(() => useFrequencyDrag(buildOptions({
      allowNegativeFrequencies: true,
      hardwareSpectrumBounds: null,
    })));

    for (let tick = 0; tick < 150; tick += 1) {
      wheel({ deltaY: 120 });
      // No publish may exceed the 0..30 GHz config ceiling.
      for (const range of publishedRanges().slice(-1)) {
        expect(range.min).toBeGreaterThanOrEqual(0);
        expect(range.max).toBeLessThanOrEqual(SPECTRUM_MAX_HZ);
      }
      expectViewportInsideMirroredSpectrum(vizZoomRef.current);
    }

    for (let tick = 0; tick < 300; tick += 1) {
      wheel({ deltaY: -120 });
      for (const range of publishedRanges().slice(-1)) {
        expect(range.min).toBeGreaterThanOrEqual(0);
        expect(range.max).toBeLessThanOrEqual(SPECTRUM_MAX_HZ);
      }
      expectViewportInsideMirroredSpectrum(vizZoomRef.current);
    }
  });
});
