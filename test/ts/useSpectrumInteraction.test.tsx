/** @jest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { useSpectrumInteraction } from "@n-apt/spectrum/hooks/useSpectrumInteraction";
import React from "react";

describe("useSpectrumInteraction Hook", () => {
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
  const mockOnVizPanReanchor = jest.fn();

  const frequencyRangeRef = { current: { min: 100, max: 110 } };
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

  const defaultOptions: any = {
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
    onDragRepaint: mockOnDragRepaint,
    vizZoomRef: { current: 1 },
    vizZoomFloorRef: { current: 1 },
    vizPanOffsetRef: { current: 0 },
    vizDbMinRef: { current: -120 },
    vizDbMaxRef: { current: 0 },
  };

  const listenerCallbacks = new Map<string, Set<Function>>();
  let listeners: Record<string, Function> = {};

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockOnPowerLineDbChange.mockClear();
    mockOnTxCenterFrequencyChange.mockClear();
    mockOnTxSampleRateChange.mockClear();
    mockOnTxOptionsRequest.mockClear();
    mockOnDragRepaint.mockClear();
    mockOnVizPanReanchor.mockClear();
    listeners = {};
    listenerCallbacks.clear();
    frequencyRangeRef.current = { min: 100, max: 110 };
    if (defaultOptions.vizZoomRef) defaultOptions.vizZoomRef.current = 1;
    if (defaultOptions.vizZoomFloorRef)
      defaultOptions.vizZoomFloorRef.current = 1;
    if (defaultOptions.vizPanOffsetRef)
      defaultOptions.vizPanOffsetRef.current = 0;
    if (defaultOptions.vizDbMinRef) defaultOptions.vizDbMinRef.current = -120;
    if (defaultOptions.vizDbMaxRef) defaultOptions.vizDbMaxRef.current = 0;
    spectrumGpuCanvasRef.current.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 600,
    });
    spectrumContainerRef.current.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 600,
    });

    // Mock window event listeners
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
        const callbacks = listenerCallbacks.get(event);
        if (callbacks) {
          callbacks.delete(cb as Function);
          if (callbacks.size === 0) {
            delete listeners[event];
            listenerCallbacks.delete(event);
          }
        }
      });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const flushHardwareRetune = () => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
  };

  const triggerPointerDown = (
    clientX: number,
    clientY: number,
    pointerId = 1,
  ) => {
    const calls =
      spectrumContainerRef.current.addEventListener.mock.calls.filter(
        (c: any) => c[0] === "pointerdown",
      );
    const handler = calls[calls.length - 1][1];
    act(() => {
      handler({ clientX, clientY, pointerId } as any);
    });
  };

  const triggerPointerMove = (
    clientX: number,
    clientY: number,
    pointerId = 1,
  ) => {
    const handler = listeners["pointermove"];
    if (handler) {
      act(() => {
        handler({ clientX, clientY, pointerId } as any);
      });
    }
  };

  const triggerPointerUp = (
    clientX: number,
    clientY: number,
    pointerId = 1,
  ) => {
    const handler = listeners["pointerup"];
    if (handler) {
      act(() => {
        handler({ clientX, clientY, pointerId } as any);
      });
    }
  };

  const triggerWheel = (
    payload: Partial<WheelEvent & { clientX: number; clientY: number }>,
  ) => {
    const calls =
      spectrumContainerRef.current.addEventListener.mock.calls.filter(
        (c: any) => c[0] === "wheel",
      );
    const handler = calls[calls.length - 1][1];
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

  const triggerDoubleClick = (clientX: number, clientY: number) => {
    const calls =
      spectrumContainerRef.current.addEventListener.mock.calls.filter(
        (c: any) => c[0] === "dblclick",
      );
    const handler = calls[calls.length - 1][1];
    act(() => {
      handler({
        clientX,
        clientY,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      } as any);
    });
  };

  it("should handle VFO dragging (panning) in the bottom 60px area", () => {
    renderHook(() => useSpectrumInteraction(defaultOptions));

    // Pointer down at y=550 (bottom area)
    triggerPointerDown(500, 550);

    // Drag right by 100px. Spectrum width 1000, range 10MHz. 100px = 1MHz.
    // Dragging right = frequency decreases.
    triggerPointerMove(600, 550);
    flushHardwareRetune();

    expect(mockOnFrequencyRangeChange).toHaveBeenCalled();
    const lastCall =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ][0];
    expect(lastCall.min).toBeCloseTo(99, 1);
    expect(lastCall.max).toBeCloseTo(109, 1);
  });

  it("keeps a zoomed positive VFO retune independent of channel bounds", () => {
    if (defaultOptions.vizZoomRef) defaultOptions.vizZoomRef.current = 2;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 40, max: 60 } },
      }),
    );

    // At zoom 2 the viewport is 5 Hz wide inside [100, 110]. A VFO drag is a
    // global device tune even while the visible window is still covered, and
    // must ignore unrelated channel bounds that would trap the center.
    triggerPointerDown(500, 550);
    triggerPointerMove(700, 550);

    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 99,
      max: 109,
    });
    expect(defaultOptions.vizPanOffsetRef.current).toBe(0);
  });

  it("does not retune a covered negative DC-crossing pan", () => {
    // Acquisition [0, 10] with pan -4 ⇒ display [-4, 6], still covered by |f|.
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizPanOffsetRef.current = -4;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 40, max: 60 } },
      }),
    );

    triggerPointerDown(500, 550);
    triggerPointerMove(600, 550);

    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
    expect(mockOnVizPanChange).toHaveBeenCalled();
  });

  it("returns from covered mirrored pan to DC before retuning positive", () => {
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizPanOffsetRef.current = 0;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 0, max: 1000 } },
        hardwareSpectrumBounds: { min: 0, max: 1000 },
      }),
    );

    // Enter the covered mirrored viewport: display [-4, 6].
    triggerWheel({ clientX: 500, clientY: 590, deltaY: -400 });
    expect(mockOnVizPanChange).toHaveBeenLastCalledWith(-4);

    mockOnFrequencyRangeChange.mockClear();
    mockOnVizPanChange.mockClear();

    // Reverse the same amount. This should consume the visual pan and return
    // to [0, 10], rather than shifting the hardware window to [4, 14].
    triggerWheel({ clientX: 500, clientY: 590, deltaY: 400 });

    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
    expect(mockOnVizPanChange).toHaveBeenLastCalledWith(0);
  });

  it("rebinds pan handlers when mirror mode hydrates after mount", () => {
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizPanOffsetRef.current = 0;

    const { rerender } = renderHook(
      ({ mirrorEnabled }: { mirrorEnabled: boolean }) =>
        useSpectrumInteraction({
          ...defaultOptions,
          allowNegativeFrequencies: mirrorEnabled,
        }),
      { initialProps: { mirrorEnabled: false } },
    );

    // Persisted settings can arrive after the first mounted interaction
    // effect. The native wheel handler must then use the hydrated mirror
    // branch instead of retaining the initial mirror-off closure.
    rerender({ mirrorEnabled: true });
    // Keep the mirrored display inside the resident acquisition window:
    // display [-4, 6] is covered by the reflection of [0, 10].
    triggerWheel({ clientX: 500, clientY: 590, deltaY: -400 });

    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
    expect(mockOnVizPanChange).toHaveBeenCalled();
    expect(
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ][0],
    ).toBeCloseTo(-4, 5);
  });

  it("uses hydrated mirror mode for VFO pointer panning", () => {
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizPanOffsetRef.current = 0;

    const { rerender } = renderHook(
      ({ mirrorEnabled }: { mirrorEnabled: boolean }) =>
        useSpectrumInteraction({
          ...defaultOptions,
          allowNegativeFrequencies: mirrorEnabled,
        }),
      { initialProps: { mirrorEnabled: false } },
    );

    rerender({ mirrorEnabled: true });
    triggerPointerDown(500, 550);
    triggerPointerMove(900, 550);

    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
    expect(mockOnVizPanChange).toHaveBeenLastCalledWith(-4);
  });

  it("keeps unzoomed positive mirror pan on the hardware retune path", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
      }),
    );

    triggerPointerDown(500, 550);
    triggerPointerMove(600, 550);
    flushHardwareRetune();

    expect(mockOnFrequencyRangeChange).toHaveBeenCalled();
    expect(mockOnVizPanChange).not.toHaveBeenCalled();
  });

  it("retunes again when continued negative drag leaves the resident window", () => {
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizPanOffsetRef.current = 0;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 0, max: 1000 } },
      }),
    );

    triggerPointerDown(500, 550);
    // 1200px right = 12 Hz toward negative. Display [-12, -2] is past |f|.
    triggerPointerMove(1700, 550);
    flushHardwareRetune();

    expect(mockOnFrequencyRangeChange).toHaveBeenCalled();
    const panAfterRetune =
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ][0];
    expect(panAfterRetune).toBeLessThan(-10);

    mockOnFrequencyRangeChange.mockClear();
    // Continue far enough to cross the resident edge (the 1 Hz coverage
    // tolerance intentionally absorbs tiny pointer ticks). It must request
    // the next positive acquisition rather than sliding or tiling the old
    // frame.
    triggerPointerMove(1810, 550);

    expect(mockOnFrequencyRangeChange).toHaveBeenCalledTimes(1);
    const continuedRange =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ][0];
    expect(continuedRange.min).toBeCloseTo(3.1, 8);
    expect(continuedRange.max).toBeCloseTo(13.1, 8);
    const panAfterContinue =
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ][0];
    expect(panAfterContinue).toBeLessThanOrEqual(panAfterRetune);
  });

  it("does not clamp mirror pan to the acquisition mirrored extent", () => {
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizPanOffsetRef.current = 0;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
      }),
    );

    triggerWheel({
      clientX: 500,
      clientY: 590,
      deltaY: -2000,
      ctrlKey: false,
    } as any);

    const lastPan =
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ]?.[0];
    // Previously clamped near -10 Hz (mirrored extent of [0, 10]); unbounded
    // mirror pan must keep scrolling past that edge.
    expect(lastPan).toBeLessThan(-10);
  });

  it("retunes when mirror-on scroll crosses DC on an uncovered acquisition", () => {
    frequencyRangeRef.current = { min: 4_294_000, max: 8_666_000 };
    defaultOptions.vizPanOffsetRef.current = -4_000_000;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 0, max: 20_000_000 } },
        hardwareSpectrumBounds: { min: 0, max: 10_000_000 },
      }),
    );

    triggerWheel({
      clientX: 500,
      clientY: 590,
      deltaY: -200,
      ctrlKey: false,
    } as any);
    flushHardwareRetune();

    expect(mockOnFrequencyRangeChange).toHaveBeenCalled();
  });

  it("retunes mirror-on positive pan when the viewport exceeds the acquisition", () => {
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizPanOffsetRef.current = 0;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 0, max: 1000 } },
      }),
    );

    triggerWheel({
      clientX: 500,
      clientY: 590,
      deltaY: 200,
      ctrlKey: false,
    } as any);
    flushHardwareRetune();

    expect(mockOnFrequencyRangeChange).toHaveBeenCalled();
    expect(mockOnVizPanChange).not.toHaveBeenCalled();
  });

  it("keeps a negative display frequency anchored during pinch zoom", () => {
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizZoomRef.current = 2;
    defaultOptions.vizPanOffsetRef.current = -7.5;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
      }),
    );

    triggerWheel({
      clientX: 250,
      clientY: 300,
      deltaY: -100,
      ctrlKey: true,
    } as any);

    const nextZoom =
      mockOnVizZoomChange.mock.calls[
        mockOnVizZoomChange.mock.calls.length - 1
      ]?.[0];
    const nextPan =
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ]?.[0];
    const anchorBefore = -5 + 0.25 * 5;
    const nextSpan = 10 / nextZoom;
    const anchorAfter = 5 + nextPan - nextSpan / 2 + 0.25 * nextSpan;

    expect(anchorAfter).toBeCloseTo(anchorBefore, 6);
    expect(nextPan).toBeLessThan(-2.5);
  });

  it("should handle box selection in the upper area", () => {
    const mockBox = document.createElement("div");
    jest.spyOn(document, "createElement").mockReturnValue(mockBox);

    renderHook(() => useSpectrumInteraction(defaultOptions));

    // Pointer down at y=100 (upper area)
    triggerPointerDown(100, 100);
    expect(mockOnSelectionChange).not.toHaveBeenCalled();

    // Move to create a box
    triggerPointerMove(200, 200);

    expect(document.createElement).toHaveBeenCalledWith("div");

    // Pointer up to trigger zoom
    triggerPointerUp(200, 200);

    // Box of 100px width on 1000px canvas = 10x zoom
    expect(mockOnVizZoomChange).toHaveBeenCalled();
    expect(mockOnVizZoomFloorChange).toHaveBeenCalled();
  });

  it("commits a box zoom from the pointerup coordinates immediately", () => {
    renderHook(() => useSpectrumInteraction(defaultOptions));

    triggerPointerDown(100, 100);
    triggerPointerUp(200, 200);

    expect(mockOnVizZoomChange).toHaveBeenCalled();
    expect(mockOnVizZoomChange).toHaveBeenLastCalledWith(
      expect.closeTo(9.1, 5),
    );
    expect(mockOnVizZoomFloorChange).toHaveBeenCalledWith(
      expect.closeTo(9.1, 5),
    );
    const clampedPan =
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ]?.[0];
    expect(clampedPan).toBeGreaterThanOrEqual(-4.5);
  });

  it("keeps a box zoom on the negative display axis when mirroring is enabled", () => {
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizZoomRef.current = 2;
    defaultOptions.vizPanOffsetRef.current = -7.5;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
        clampedVizRangeRef: { current: { min: -10, max: -5 } },
      }),
    );

    triggerPointerDown(100, 100);
    triggerPointerUp(200, 200);

    const nextPan =
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ]?.[0];
    expect(nextPan).toBeLessThan(-10);
  });

  it("creates the zoombox before pointermove so the overlay has a stable node", () => {
    renderHook(() => useSpectrumInteraction(defaultOptions));
    const mockBox = document.createElement("div");
    jest.spyOn(document, "createElement").mockReturnValue(mockBox);
    (document.createElement as jest.Mock).mockClear();

    triggerPointerDown(100, 100);

    expect(document.createElement).toHaveBeenCalledWith("div");
    expect(document.body.contains(mockBox)).toBe(true);
    expect(mockBox.style.zIndex).toBe("2147483647");
    expect(mockBox.style.transition).toBe("none");
  });

  it("updates the zoombox state during drag", () => {
    const zoomboxStateRef = { current: null };
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        zoomboxStateRef,
      }),
    );

    triggerPointerDown(100, 100);
    triggerPointerMove(900, 550);

    expect(zoomboxStateRef.current).toEqual({
      startX: 100,
      startY: 100,
      currentX: 900,
      currentY: 550,
    });

    triggerPointerUp(900, 550);
    expect(zoomboxStateRef.current).toBeNull();
  });

  it("moves the active zoombox with arrow keys", () => {
    const zoomboxStateRef = {
      current: {
        startX: 100,
        startY: 100,
        currentX: 300,
        currentY: 250,
      },
    };
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        zoomboxStateRef,
      }),
    );

    const event = new KeyboardEvent("keydown", { key: "ArrowRight" });
    listeners.keydown(event);

    expect(zoomboxStateRef.current).toEqual({
      startX: 110,
      startY: 100,
      currentX: 310,
      currentY: 250,
    });
  });

  it("should start a fresh range drag inside an existing selection unless resizing", () => {
    const selectionOptions = {
      ...defaultOptions,
      disabled: false,
      selectionMode: "range" as const,
    };
    renderHook(() => useSpectrumInteraction(selectionOptions));

    triggerPointerDown(120, 120);
    triggerPointerMove(220, 120);
    expect(mockOnSelectionChange).toHaveBeenCalled();

    const firstCall = mockOnSelectionChange.mock.calls[0][0];
    expect(firstCall.min).toBeLessThan(firstCall.max);

    mockOnSelectionChange.mockClear();

    triggerPointerDown(180, 120);
    expect(mockOnSelectionChange).not.toHaveBeenCalled();

    triggerPointerMove(260, 120);
    expect(mockOnSelectionChange).toHaveBeenCalled();
    const secondCall = mockOnSelectionChange.mock.calls[0][0];
    expect(secondCall.min).toBeLessThan(secondCall.max);
  });

  it("moves the FFT node selection when dragging inside the existing band", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
        selectionRange: { min: 104, max: 106 },
        fullPlotSelection: true,
        rangeSelectionInteraction: "edit-existing" as const,
      }),
    );

    triggerPointerDown(500, 120);
    triggerPointerMove(600, 120);

    expect(mockOnSelectionChange).toHaveBeenLastCalledWith({
      min: 105,
      max: 107,
    });
  });

  it("starts a new FFT node selection when dragging outside the existing band", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
        selectionRange: { min: 104, max: 106 },
        fullPlotSelection: true,
        rangeSelectionInteraction: "edit-existing" as const,
      }),
    );

    triggerPointerDown(200, 120);
    triggerPointerMove(300, 120);

    expect(mockOnSelectionChange).toHaveBeenLastCalledWith({
      min: 102,
      max: 103,
    });
  });

  it("keeps the FFT node selection draggable while its display edge-pans", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
        selectionRange: { min: 104, max: 106 },
        fullPlotSelection: true,
        rangeSelectionInteraction: "edit-existing" as const,
        selectionEdgePanMode: "frequency-range" as const,
      }),
    );

    triggerPointerDown(500, 120);
    triggerPointerMove(1100, 120);

    expect(mockOnSelectionChange).toHaveBeenLastCalledWith({
      min: 110,
      max: 112,
    });
    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 102,
      max: 112,
    });
    expect(mockOnVizPanChange).not.toHaveBeenCalled();
  });

  it("keeps requesting spectrum while a selection drag is held at the FFT edge", () => {
    const animationFrames: FrameRequestCallback[] = [];
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
        selectionRange: { min: 104, max: 106 },
        fullPlotSelection: true,
        rangeSelectionInteraction: "edit-existing" as const,
        selectionEdgePanMode: "frequency-range" as const,
      }),
    );

    triggerPointerDown(500, 120);
    triggerPointerMove(995, 120);

    const firstRequestedRange =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ]?.[0];
    expect(firstRequestedRange).toBeDefined();
    expect(animationFrames).toHaveLength(1);

    act(() => animationFrames.shift()?.(1_000));
    act(() => animationFrames.shift()?.(1_100));

    const heldRequestedRange =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ]?.[0];
    expect(heldRequestedRange.max).toBeGreaterThan(firstRequestedRange.max);
    expect(heldRequestedRange.max - heldRequestedRange.min).toBeCloseTo(10);

    triggerPointerUp(995, 120);
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("cancels an interrupted edge-pan loop when a wheel gesture begins", () => {
    const animationFrames: FrameRequestCallback[] = [];
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
        selectionRange: { min: 104, max: 106 },
        fullPlotSelection: true,
        rangeSelectionInteraction: "edit-existing" as const,
        selectionEdgePanMode: "frequency-range" as const,
      }),
    );

    triggerPointerDown(500, 120);
    triggerPointerMove(995, 120);
    const rangeCallsBeforeWheel = mockOnFrequencyRangeChange.mock.calls.length;

    triggerWheel({ clientX: 995, clientY: 120, deltaY: 100 });
    act(() => animationFrames.shift()?.(1_200));

    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).toHaveBeenCalledTimes(
      rangeCallsBeforeWheel,
    );
  });

  it("creates a range from right to left without anchoring at the center", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
      }),
    );

    triggerPointerDown(800, 120);
    triggerPointerMove(200, 120);

    expect(mockOnSelectionChange).toHaveBeenCalled();
    const next = mockOnSelectionChange.mock.calls[0][0];
    expect(next.min).toBeLessThan(next.max);
    expect(next.min).toBeCloseTo(101.648, 2);
    expect(next.max).toBeCloseTo(108.242, 2);
  });

  it("does not draw a second DOM rectangle while selecting a range", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
      }),
    );

    spectrumContainerRef.current.appendChild.mockClear();
    triggerPointerDown(800, 120);
    triggerPointerMove(200, 120);

    expect(mockOnSelectionChange).toHaveBeenCalled();
    expect(spectrumContainerRef.current.appendChild).not.toHaveBeenCalled();
  });

  it("selects freely on the left side of an existing centered range", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
        selectionRange: { min: 104, max: 106 },
        fullPlotSelection: true,
      }),
    );

    triggerPointerDown(200, 120);
    triggerPointerMove(100, 120);

    expect(mockOnSelectionChange).toHaveBeenCalled();
    const next = mockOnSelectionChange.mock.calls[0][0];
    expect(next.min).toBeCloseTo(101, 2);
    expect(next.max).toBeCloseTo(102, 2);
    expect(next.max).toBeLessThan(104);
  });

  it("uses full canvas bounds for React Flow FFT node range selection", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
        fullPlotSelection: true,
      }),
    );

    triggerPointerDown(0, 0);
    triggerPointerMove(1000, 0);

    expect(mockOnSelectionChange).toHaveBeenCalled();
    const next = mockOnSelectionChange.mock.calls[0][0];
    expect(next.min).toBeCloseTo(100, 2);
    expect(next.max).toBeCloseTo(110, 2);
  });

  it("keeps the whole FFT node selectable when React Flow scales it below the VFO threshold", () => {
    spectrumGpuCanvasRef.current.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 300,
      height: 150,
    });
    spectrumContainerRef.current.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 300,
      height: 150,
    });

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
        fullPlotSelection: true,
        rangeSelectionInteraction: "edit-existing" as const,
      }),
    );

    triggerPointerDown(150, 75);
    triggerPointerMove(250, 75);

    expect(mockOnSelectionChange).toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
  });

  it("edge-pans a React Flow FFT range by shifting its display range without visual overscroll", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        selectionMode: "range" as const,
        fullPlotSelection: true,
        selectionEdgePanMode: "frequency-range" as const,
      }),
    );

    triggerPointerDown(900, 120);
    triggerPointerMove(1200, 120);

    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 102,
      max: 112,
    });
    expect(frequencyRangeRef.current).toEqual({ min: 102, max: 112 });
    expect(mockOnVizPanChange).not.toHaveBeenCalled();
  });

  it("uses the latest selection range after rerendering", () => {
    const { rerender } = renderHook(
      ({ selectionRange }) =>
        useSpectrumInteraction({
          ...defaultOptions,
          selectionMode: "range" as const,
          selectionRange,
        }),
      {
        initialProps: {
          selectionRange: { min: 100, max: 110 },
        },
      },
    );

    rerender({ selectionRange: { min: 102, max: 104 } });
    mockOnSelectionChange.mockClear();

    triggerPointerDown(900, 120);
    triggerPointerMove(800, 120);

    expect(mockOnSelectionChange).toHaveBeenCalled();
    const next = mockOnSelectionChange.mock.calls[0][0];
    expect(next.min).toBeGreaterThan(107);
    expect(next.max).toBeLessThanOrEqual(109.5);
  });

  it("should clamp VFO dragging to hardware spectrum bounds if provided", () => {
    const boundsOptions = {
      ...defaultOptions,
      hardwareSpectrumBounds: { min: 100, max: 110 },
    };
    renderHook(() => useSpectrumInteraction(boundsOptions));

    // current is already at 100-110
    triggerPointerDown(500, 550);

    // Drag left by 100px (clientX decreases) -> freq increases.
    // Result should be clamped because max is 110.
    triggerPointerMove(400, 550);
    flushHardwareRetune();

    const lastCall =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ][0];
    expect(lastCall.max).toBe(110);
    expect(lastCall.min).toBe(100);
  });

  it("drags the canvas TX slider in the bottom stats row", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        txSliderEnabled: true,
        txSliderRef: {
          current: {
            visible: true,
            visibleMinHz: 100,
            visibleMaxHz: 110,
            txCenterHz: 105,
            txSampleRateHz: 2,
            onCenterFrequencyChange: mockOnTxCenterFrequencyChange,
            onSampleRateChange: mockOnTxSampleRateChange,
          },
        },
      }),
    );

    triggerPointerDown(414, 580);
    triggerPointerMove(300, 580);
    triggerPointerUp(300, 580);

    expect(mockOnTxSampleRateChange).toHaveBeenCalled();
    expect(mockOnTxCenterFrequencyChange).toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
  });

  it("publishes TX drag geometry at most once per animation frame", () => {
    const animationFrames: FrameRequestCallback[] = [];
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      });
    const onGeometryChange = jest.fn();

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        txSliderEnabled: true,
        txSliderRef: {
          current: {
            visible: true,
            visibleMinHz: 100,
            visibleMaxHz: 110,
            txCenterHz: 105,
            txSampleRateHz: 2,
            onGeometryChange,
          },
        },
      }),
    );

    triggerPointerDown(500, 580);
    triggerPointerMove(510, 580);
    triggerPointerMove(520, 580);
    triggerPointerMove(530, 580);

    expect(onGeometryChange).not.toHaveBeenCalled();
    expect(animationFrames).toHaveLength(1);

    act(() => animationFrames.shift()?.(0));
    expect(onGeometryChange).toHaveBeenCalledTimes(1);
  });

  it("preserves the TX slider body grab offset on pointer down", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        txSliderEnabled: true,
        txSliderRef: {
          current: {
            visible: true,
            visibleMinHz: 100,
            visibleMaxHz: 110,
            txCenterHz: 105,
            txSampleRateHz: 2,
            onCenterFrequencyChange: mockOnTxCenterFrequencyChange,
            onSampleRateChange: mockOnTxSampleRateChange,
          },
        },
      }),
    );

    triggerPointerDown(414, 580);

    const lastCenter =
      mockOnTxCenterFrequencyChange.mock.calls[
        mockOnTxCenterFrequencyChange.mock.calls.length - 1
      ]?.[0];
    expect(lastCenter).toBeCloseTo(105, 3);
  });

  it("drags the canvas TX slider when zoomed in", () => {
    const clampedVizRangeRef = { current: { min: 102, max: 108 } };
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        txSliderEnabled: true,
        clampedVizRangeRef,
        txSliderRef: {
          current: {
            visible: true,
            visibleMinHz: 100,
            visibleMaxHz: 110,
            txCenterHz: 105,
            txSampleRateHz: 2,
            onCenterFrequencyChange: mockOnTxCenterFrequencyChange,
            onSampleRateChange: mockOnTxSampleRateChange,
          },
        },
      }),
    );

    triggerPointerDown(500, 580);
    triggerPointerMove(300, 580);
    triggerPointerUp(300, 580);

    expect(mockOnTxSampleRateChange).toHaveBeenCalled();
    expect(mockOnTxCenterFrequencyChange).toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
  });

  it("lets canvas TX slider body dragging reach the visible track edge", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        txSliderEnabled: true,
        txSliderRef: {
          current: {
            visible: true,
            visibleMinHz: 100,
            visibleMaxHz: 110,
            txCenterHz: 105,
            txSampleRateHz: 2,
            onCenterFrequencyChange: mockOnTxCenterFrequencyChange,
            onSampleRateChange: mockOnTxSampleRateChange,
          },
        },
      }),
    );

    triggerPointerDown(500, 580);
    triggerPointerMove(1200, 580);
    triggerPointerUp(1200, 580);

    const lastCenter =
      mockOnTxCenterFrequencyChange.mock.calls[
        mockOnTxCenterFrequencyChange.mock.calls.length - 1
      ]?.[0];
    expect(lastCenter).toBe(110);
  });

  it("pans the hardware window in steps when TX body drag pushes past the visible edge", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        txSliderEnabled: true,
        hardwareSpectrumBounds: { min: 0, max: 1000 },
        txSliderRef: {
          current: {
            visible: true,
            visibleMinHz: 100,
            visibleMaxHz: 110,
            txCenterHz: 105,
            txSampleRateHz: 2,
            onCenterFrequencyChange: mockOnTxCenterFrequencyChange,
            onSampleRateChange: mockOnTxSampleRateChange,
          },
        },
      }),
    );

    triggerPointerDown(500, 580);
    triggerPointerMove(1200, 580);

    expect(mockOnFrequencyRangeChange).toHaveBeenCalled();
    const lastRange =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ]?.[0];
    expect(lastRange).toEqual({ min: 101, max: 111 });
    const lastCenter =
      mockOnTxCenterFrequencyChange.mock.calls[
        mockOnTxCenterFrequencyChange.mock.calls.length - 1
      ]?.[0];
    expect(lastCenter).toBe(110);
  });

  it("clamps TX drag at 0 Hz instead of emitting negative frequencies", () => {
    frequencyRangeRef.current = { min: 0, max: 10 };

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        frequencyRangeRef,
        txSliderEnabled: true,
        hardwareSpectrumBounds: { min: 0, max: 1000 },
        txSliderRef: {
          current: {
            visible: true,
            visibleMinHz: 0,
            visibleMaxHz: 10,
            txCenterHz: 5,
            txSampleRateHz: 2,
            onCenterFrequencyChange: mockOnTxCenterFrequencyChange,
            onSampleRateChange: mockOnTxSampleRateChange,
          },
        },
      }),
    );

    triggerPointerDown(500, 580);
    triggerPointerMove(-1200, 580);

    const lastCenter =
      mockOnTxCenterFrequencyChange.mock.calls[
        mockOnTxCenterFrequencyChange.mock.calls.length - 1
      ]?.[0];
    // Band width=2, clamped with start at 0 → center = 1
    expect(lastCenter).toBe(1);
  });

  it("routes wheel and double click to the canvas TX slider", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        txSliderEnabled: true,
        txSliderRef: {
          current: {
            visible: true,
            visibleMinHz: 100,
            visibleMaxHz: 110,
            txCenterHz: 105,
            txSampleRateHz: 2,
            onCenterFrequencyChange: mockOnTxCenterFrequencyChange,
            onSampleRateChange: mockOnTxSampleRateChange,
            onOptionsRequest: mockOnTxOptionsRequest,
          },
        },
      }),
    );

    triggerWheel({ clientX: 500, clientY: 580, deltaY: 120 } as any);
    expect(mockOnTxCenterFrequencyChange).toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();

    triggerWheel({
      clientX: 500,
      clientY: 580,
      deltaY: -120,
      ctrlKey: true,
    } as any);
    expect(mockOnTxSampleRateChange).toHaveBeenCalled();

    triggerDoubleClick(500, 580);
    expect(mockOnTxOptionsRequest).toHaveBeenCalled();
  });

  it("keeps VFO dragging global instead of clamping it to the active channel", () => {
    const channelOptions = {
      ...defaultOptions,
      signalAreaBounds: { TEST: { min: 100, max: 110 } },
      hardwareSpectrumBounds: { min: 0, max: 1000 },
    };
    renderHook(() => useSpectrumInteraction(channelOptions));

    triggerPointerDown(500, 550);
    triggerPointerMove(400, 550);
    flushHardwareRetune();

    const lastCall =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ][0];
    expect(lastCall.max).toBe(111);
    expect(lastCall.min).toBe(101);
  });

  it("allows hardware wheel scrolling past the selected channel edge immediately", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        frequencyRangeRef: { current: { min: 100, max: 110 } },
        signalAreaBounds: { TEST: { min: 100, max: 110 } },
        hardwareSpectrumBounds: { min: 0, max: 1000 },
        vizZoomRef: { current: 1 },
      }),
    );

    triggerWheel({
      clientX: 500,
      clientY: 590,
      deltaY: 200,
      ctrlKey: false,
    } as any);
    flushHardwareRetune();

    expect(mockOnFrequencyRangeChange).toHaveBeenCalledWith({
      min: 102,
      max: 112,
    });
  });

  it("publishes unzoomed hardware wheel ticks without a debounce queue", () => {
    const localRangeRef = { current: { min: 100, max: 110 } };

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        frequencyRangeRef: localRangeRef,
        signalAreaBounds: { TEST: { min: 100, max: 110 } },
        hardwareSpectrumBounds: { min: 0, max: 1000 },
        vizZoomRef: { current: 1 },
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });
    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });

    expect(localRangeRef.current).toEqual({ min: 102, max: 112 });
    expect(mockOnDragRepaint).toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).toHaveBeenCalledTimes(2);
    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 102,
      max: 112,
    });
  });

  it("retunes a paused zoomed VFO wheel so play keeps the new center", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        vizZoomRef: { current: 2 },
        vizPanOffsetRef: { current: 0 },
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });

    expect(mockOnVizPanChange).not.toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 101,
      max: 111,
    });
  });

  it("retunes a playing zoomed positive VFO instead of storing a local center", () => {
    defaultOptions.vizZoomRef.current = 2;
    defaultOptions.vizPanOffsetRef.current = 0;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: false,
        allowNegativeFrequencies: true,
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });

    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 101,
      max: 111,
    });
    expect(defaultOptions.vizPanOffsetRef.current).toBe(0);
  });

  it("absorbs an existing positive VFO pan into the global range", () => {
    defaultOptions.vizZoomRef.current = 2;
    defaultOptions.vizPanOffsetRef.current = 2;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: false,
        allowNegativeFrequencies: true,
        onVizPanReanchor: mockOnVizPanReanchor,
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });

    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 103,
      max: 113,
    });
    expect(mockOnVizPanReanchor).toHaveBeenLastCalledWith(0);
    expect(defaultOptions.vizPanOffsetRef.current).toBe(0);
  });

  it("does not mistake an ordinary positive-band negative pan for a mirror view", () => {
    // A fully positive viewport can have a negative local offset after a
    // prior gesture. That offset is still global VFO movement, not a DC
    // mirror request. Keeping it local leaves a gap until the next frame and
    // lets play restore the old center.
    defaultOptions.vizPanOffsetRef.current = -1;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        allowNegativeFrequencies: true,
        onVizPanReanchor: mockOnVizPanReanchor,
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: -100 });

    expect(mockOnVizPanChange).not.toHaveBeenCalled();
    expect(mockOnVizPanReanchor).toHaveBeenLastCalledWith(0);
    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 98,
      max: 108,
    });
    expect(defaultOptions.vizPanOffsetRef.current).toBe(0);
  });

  it("retunes an unzoomed paused VFO so the next frame owns the new center", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        vizZoomRef: { current: 1 },
        vizPanOffsetRef: { current: 0 },
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });

    expect(mockOnVizPanChange).not.toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 101,
      max: 111,
    });
  });

  it("keeps a paused mirrored VFO scroll view-only across DC", () => {
    // The paused view must keep the local pan moving. Retuning on each wheel
    // tick re-anchors at DC and locks the VFO before the wheel settles.
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizZoomRef.current = 2;
    defaultOptions.vizPanOffsetRef.current = -4;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 0, max: 1000 } },
        hardwareSpectrumBounds: { min: 0, max: 1000 },
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });

    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
    expect(mockOnVizPanChange).toHaveBeenLastCalledWith(-3.5);
  });

  it("retunes a paused mirror-off zoomed VFO", () => {
    frequencyRangeRef.current = { min: 100, max: 110 };
    defaultOptions.vizZoomRef.current = 2;
    defaultOptions.vizPanOffsetRef.current = 0;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        hardwareSpectrumBounds: { min: 0, max: 1000 },
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });

    expect(mockOnVizPanChange).not.toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 101,
      max: 111,
    });
  });

  it("publishes a paused pointer retune once as the universal range", () => {
    const mockOnHardwareRangeReanchor = jest.fn();

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        onHardwareRangeReanchor: mockOnHardwareRangeReanchor,
      }),
    );

    triggerPointerDown(500, 590);
    triggerPointerMove(600, 590);

    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 99,
      max: 109,
    });
    expect(mockOnHardwareRangeReanchor).toHaveBeenLastCalledWith({
      min: 99,
      max: 109,
    });
    expect(mockOnHardwareRangeReanchor).toHaveBeenCalledTimes(1);
  });

  it("reanchors paused VFO pan immediately when the universal range retunes", () => {
    defaultOptions.vizZoomRef.current = 2;
    defaultOptions.vizPanOffsetRef.current = 2;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        onVizPanReanchor: mockOnVizPanReanchor,
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });

    expect(mockOnVizPanReanchor).toHaveBeenLastCalledWith(0);
    expect(defaultOptions.vizPanOffsetRef.current).toBe(0);
    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 103,
      max: 113,
    });
  });

  it("does not restore the pre-pause center when continuous delivery resumes", () => {
    defaultOptions.vizZoomRef.current = 2;
    defaultOptions.vizPanOffsetRef.current = 2;

    const { rerender } = renderHook(
      ({ paused }) =>
        useSpectrumInteraction({
          ...defaultOptions,
          isPaused: paused,
          onVizPanReanchor: mockOnVizPanReanchor,
        }),
      { initialProps: { paused: true } },
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });
    const tunedRange = { ...frequencyRangeRef.current };
    const publishCount = mockOnFrequencyRangeChange.mock.calls.length;

    rerender({ paused: false });

    expect(frequencyRangeRef.current).toEqual(tunedRange);
    expect(defaultOptions.vizPanOffsetRef.current).toBe(0);
    expect(mockOnFrequencyRangeChange).toHaveBeenCalledTimes(publishCount);
  });

  it("continues a paused mirrored pan when the viewport crosses DC", () => {
    // Acquisition [0, 10], pan -3 at zoom 2 ⇒ display [-0.5, 4.5]. The next
    // tick crosses the DC edge; it must remain a local view update.
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizZoomRef.current = 2;
    defaultOptions.vizPanOffsetRef.current = -3;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 0, max: 1000 } },
        hardwareSpectrumBounds: { min: 0, max: 1000 },
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });

    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
    expect(mockOnVizPanChange).toHaveBeenLastCalledWith(-2.5);
  });

  it("retunes a paused mirror view once it outruns a DC-anchored acquisition", () => {
    // A mirrored view may remain local while |display| is covered by the
    // resident positive acquisition. Once it passes the sample-rate edge,
    // retune the shared positive window instead of exposing a floor-filled
    // tail in the paused canvas.
    frequencyRangeRef.current = { min: 0, max: 3_200_000 };
    defaultOptions.vizZoomRef.current = 1;
    defaultOptions.vizPanOffsetRef.current = -3_000_000;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 0, max: 20_000_000 } },
        hardwareSpectrumBounds: { min: 0, max: 20_000_000 },
      }),
    );

    // The next tick puts the display at [-4.28M, -1.08M], requiring source
    // coverage [1.08M, 4.28M], beyond the current [0, 3.2M] acquisition.
    triggerWheel({ clientX: 500, clientY: 590, deltaY: -400 });

    // The paused VFO must request the new universal range and re-anchor the
    // display to it, so the replacement frame can fill the entire canvas.
    const lastPan =
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ]?.[0];
    expect(lastPan).toBeLessThan(-3_000_000);
    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 1_080_000,
      max: 4_280_000,
    });
  });

  it("retunes a paused mirrored VFO once the negative view outruns sample rate", () => {
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizZoomRef.current = 1;
    // [-11, -1] requires positive source coverage [1, 11], beyond [0, 10].
    defaultOptions.vizPanOffsetRef.current = -16;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 0, max: 100 } },
        hardwareSpectrumBounds: { min: 0, max: 100 },
        onVizPanReanchor: mockOnVizPanReanchor,
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: -100 });

    expect(mockOnVizPanChange).not.toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).toHaveBeenLastCalledWith({
      min: 7,
      max: 17,
    });
    expect(mockOnVizPanReanchor).toHaveBeenLastCalledWith(-24);
    expect(defaultOptions.vizPanOffsetRef.current).toBe(-24);
  });

  it("keeps dragging below a DC-anchored acquisition while paused with the mirror on", () => {
    // Same stall via the VFO pointer-drag path: the acquisition is already
    // DC-anchored at [0, 3.2M], the user keeps dragging toward negative
    // frequencies, and the no-op retune must not swallow the drag.
    frequencyRangeRef.current = { min: 0, max: 3_200_000 };
    defaultOptions.vizZoomRef.current = 1;
    defaultOptions.vizPanOffsetRef.current = -2_000_000;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        isPaused: true,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 0, max: 20_000_000 } },
        hardwareSpectrumBounds: { min: 0, max: 20_000_000 },
      }),
    );

    // Drag right from center by 500px on a 1000px canvas ⇒ 1.6M Hz toward
    // negative frequencies.
    triggerPointerDown(500, 550);
    triggerPointerMove(1000, 550);

    const lastPan =
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ]?.[0];
    expect(lastPan).toBeLessThan(-3_000_000);
  });

  it("folds a residual negative pan into the window when a VFO drag re-crosses DC", () => {
    // Regression: with the mirror on and the VFO unzoomed, dragging the viewport
    // below 0 Hz happens on the visual-pan path (the acquisition stays put while
    // the negative displacement is held as pan). Reversing back through DC puts
    // the gesture on the hardware-retune path, which shifted the window by the
    // whole start-anchored delta and ignored the residual pan — double-counting
    // the displacement, so the VFO snapped to the wrong frequency right at DC
    // and the pan stuck at a non-zero offset even once the viewport was positive.
    frequencyRangeRef.current = { min: 0, max: 10 };
    defaultOptions.vizZoomRef.current = 1;
    defaultOptions.vizPanOffsetRef.current = 0;

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        allowNegativeFrequencies: true,
        signalAreaBounds: { TEST: { min: 0, max: 100 } },
        hardwareSpectrumBounds: { min: 0, max: 100 },
      }),
    );

    const lastPan = (): number =>
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ]?.[0] ?? 0;
    const lastRange = (): { min: number; max: number } =>
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ]?.[0] ?? frequencyRangeRef.current;

    triggerPointerDown(500, 550);
    // Drag right across DC into the mirror zone (0.2 Hz per 20px on 1000px).
    for (const x of [520, 540, 560, 580, 600, 620, 640, 660, 680, 700]) {
      triggerPointerMove(x, 550);
    }
    // The excursion must have produced a negative residual pan while the
    // acquisition stayed DC-anchored.
    expect(lastPan()).toBeCloseTo(-2, 1);
    expect(lastRange().min).toBe(0);

    // Drag back left through DC. The residual pan must be consumed so the
    // display center tracks the pointer with no snap-back (the pre-fix bug
    // stuck pan at a non-zero offset and jumped the center at the crossing).
    let lastCenter = (lastRange().min + lastRange().max) / 2 + lastPan();
    for (const x of [680, 660, 640, 620, 600, 580, 560, 540, 520, 500, 480, 460, 440, 420, 400]) {
      triggerPointerMove(x, 550);
      const pan = lastPan();
      const range = lastRange();
      const center = (range.min + range.max) / 2 + pan;
      expect(center).toBeGreaterThanOrEqual(lastCenter - 1e-6);
      lastCenter = center;
    }
    // The residual pan must be fully consumed (zero) and the window shifted
    // through DC — the VFO no longer sticks at a negative offset past DC.
    expect(lastPan()).toBe(0);
    expect(lastRange().min).toBeGreaterThan(0);
    triggerPointerUp(500, 550);
  });

  it("repaints the VFO overlay on hardware wheel ticks without waiting for a timer", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        frequencyRangeRef: { current: { min: 100, max: 110 } },
        signalAreaBounds: { TEST: { min: 100, max: 110 } },
        hardwareSpectrumBounds: { min: 0, max: 1000 },
        vizZoomRef: { current: 1 },
      }),
    );

    triggerWheel({ clientX: 500, clientY: 590, deltaY: 100 });

    expect(mockOnDragRepaint).toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("treats the whole VFO numbers row as a pan surface", () => {
    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        frequencyRangeRef: { current: { min: 100, max: 110 } },
        hardwareSpectrumBounds: { min: 0, max: 1000 },
        vizZoomRef: { current: 1 },
      }),
    );

    // The VFO begins 116px above the container bottom. This point is in the
    // frequency-number row but is above the old margin-only wheel threshold.
    triggerWheel({
      clientX: 500,
      clientY: 490,
      deltaY: 100,
      ctrlKey: false,
    } as any);
    flushHardwareRetune();

    expect(mockOnFrequencyRangeChange).toHaveBeenCalledWith({
      min: 101,
      max: 111,
    });
  });

  it("keeps the local hardware range current when a delayed wheel retune commits", () => {
    const localRangeRef = { current: { min: 100, max: 110 } };

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        frequencyRangeRef: localRangeRef,
        signalAreaBounds: { TEST: { min: 100, max: 110 } },
        hardwareSpectrumBounds: { min: 0, max: 1000 },
        vizZoomRef: { current: 1 },
      }),
    );

    triggerWheel({
      clientX: 500,
      clientY: 590,
      deltaY: 200,
      ctrlKey: false,
    } as any);
    flushHardwareRetune();

    expect(localRangeRef.current).toEqual({ min: 102, max: 112 });
  });

  it("should retune the hardware window when zoomed wheel panning crosses the edge", () => {
    const panRef = { current: 2.4 };

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        vizZoomRef: { current: 2 },
        vizPanOffsetRef: panRef,
      }),
    );

    triggerWheel({
      clientX: 500,
      clientY: 590,
      deltaY: 200,
      ctrlKey: false,
    } as any);
    flushHardwareRetune();

    expect(mockOnFrequencyRangeChange).toHaveBeenCalled();
    expect(mockOnVizPanChange).toHaveBeenCalled();
    const lastCall =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ][0];
    expect(lastCall.min).toBeGreaterThan(100);
    expect(lastCall.max).toBeGreaterThan(110);
    expect(
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ][0],
    ).toBe(0);
  });

  it("does not accumulate hidden inertial pan across zoomed wheel ticks", () => {
    const panRef = { current: 2.4 };
    const localRangeRef = { current: { min: 100, max: 110 } };

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        frequencyRangeRef: localRangeRef,
        vizZoomRef: { current: 2 },
        vizPanOffsetRef: panRef,
      }),
    );

    triggerWheel({
      clientX: 500,
      clientY: 590,
      deltaY: 200,
      ctrlKey: false,
    } as any);
    const firstMin = localRangeRef.current.min;

    triggerWheel({
      clientX: 500,
      clientY: 590,
      deltaY: 200,
      ctrlKey: false,
    } as any);

    // Each tick must advance from the visible remaining pan (inertia 1),
    // not a hidden ballistic target that grows while the display is paused.
    expect(localRangeRef.current.min - firstMin).toBeCloseTo(1, 5);
  });

  it("allows zoomed wheel panning past active channel bounds while respecting hardware bounds", () => {
    const panRef = { current: 2.4 };

    renderHook(() =>
      useSpectrumInteraction({
        ...defaultOptions,
        signalAreaBounds: { TEST: { min: 100, max: 110 } },
        hardwareSpectrumBounds: { min: 0, max: 1000 },
        vizZoomRef: { current: 2 },
        vizPanOffsetRef: panRef,
      }),
    );

    triggerWheel({
      clientX: 500,
      clientY: 590,
      deltaY: 1000,
      ctrlKey: false,
    } as any);
    flushHardwareRetune();

    expect(mockOnFrequencyRangeChange).toHaveBeenCalled();
    const lastRange =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ][0];
    const lastPan =
      mockOnVizPanChange.mock.calls[
        mockOnVizPanChange.mock.calls.length - 1
      ][0];

    expect(lastRange.min).toBeGreaterThan(100);
    expect(lastRange.max).toBeGreaterThan(110);
    expect(lastRange.max).toBeLessThanOrEqual(1000);
    expect(Number.isFinite(lastPan)).toBe(true);
  });

  it("never retunes the hardware window below 0 Hz when edge panning left", () => {
    const panRef = { current: -2.4 };
    const zeroClampOptions = {
      ...defaultOptions,
      frequencyRangeRef: { current: { min: 100, max: 110 } },
      hardwareSpectrumBounds: { min: 0, max: 1000 },
      vizZoomRef: { current: 2 },
      vizPanOffsetRef: panRef,
    };

    renderHook(() => useSpectrumInteraction(zeroClampOptions));

    triggerWheel({
      clientX: 10,
      clientY: 590,
      deltaY: -200,
      ctrlKey: false,
    } as any);
    flushHardwareRetune();

    expect(mockOnFrequencyRangeChange).toHaveBeenCalled();
    const lastCall =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ][0];
    expect(lastCall.min).toBeGreaterThanOrEqual(0);
  });

  it("should make pinch zoom feel more responsive and keep the gesture anchored", () => {
    const pinchOptions = {
      ...defaultOptions,
      vizZoomRef: { current: 2 },
      vizPanOffsetRef: { current: 10 },
    };

    renderHook(() => useSpectrumInteraction(pinchOptions));

    triggerPointerDown(400, 300, 1);
    triggerPointerDown(600, 300, 2);

    act(() => {
      listeners["pointermove"]?.({
        pointerId: 2,
        clientX: 620,
        clientY: 300,
      } as any);
    });

    expect(mockOnVizZoomChange).toHaveBeenCalled();
    const zoomCall =
      mockOnVizZoomChange.mock.calls[
        mockOnVizZoomChange.mock.calls.length - 1
      ][0];
    expect(zoomCall).toBeGreaterThan(2.2);
  });

  it("preserves small pinch zoom offsets during zoom changes", () => {
    const pinchOptions = {
      ...defaultOptions,
      vizZoomRef: { current: 2 },
      vizPanOffsetRef: { current: 1 },
    };

    renderHook(() => useSpectrumInteraction(pinchOptions));

    triggerPointerDown(400, 300, 1);
    triggerPointerDown(600, 300, 2);

    act(() => {
      listeners["pointermove"]?.({
        pointerId: 2,
        clientX: 620,
        clientY: 300,
      } as any);
    });

    expect(mockOnVizZoomChange).toHaveBeenCalled();
    expect(mockOnVizPanChange).not.toHaveBeenCalled();
  });

  it("should ease pinch-out zoom so it does not feel linear", () => {
    const pinchOptions = {
      ...defaultOptions,
      vizZoomRef: { current: 2 },
      vizPanOffsetRef: { current: 10 },
    };

    renderHook(() => useSpectrumInteraction(pinchOptions));

    triggerPointerDown(400, 300, 1);
    triggerPointerDown(600, 300, 2);

    act(() => {
      listeners["pointermove"]?.({
        pointerId: 2,
        clientX: 580,
        clientY: 300,
      } as any);
    });

    expect(mockOnVizZoomChange).toHaveBeenCalled();
    const zoomCall =
      mockOnVizZoomChange.mock.calls[
        mockOnVizZoomChange.mock.calls.length - 1
      ][0];
    expect(zoomCall).toBeGreaterThanOrEqual(1);
  });

  it("should keep pinch zoom from going below the zoom floor", () => {
    const pinchOptions = {
      ...defaultOptions,
      vizZoomRef: { current: 4 },
      vizZoomFloorRef: { current: 3 },
      vizPanOffsetRef: { current: 10 },
    };

    renderHook(() => useSpectrumInteraction(pinchOptions));

    triggerPointerDown(400, 300, 1);
    triggerPointerDown(600, 300, 2);

    act(() => {
      listeners["pointermove"]?.({
        pointerId: 2,
        clientX: 540,
        clientY: 300,
      } as any);
    });

    expect(mockOnVizZoomChange).toHaveBeenCalled();
    const zoomCall =
      mockOnVizZoomChange.mock.calls[
        mockOnVizZoomChange.mock.calls.length - 1
      ][0];
    expect(zoomCall).toBeGreaterThanOrEqual(3);
  });

  it("should handle draggable power line vertically in the left dB margin and clear it on pointerup", () => {
    renderHook(() => useSpectrumInteraction(defaultOptions));

    // Pointer down at x=20, y=300 (left scale margin area)
    triggerPointerDown(20, 300);
    expect(mockOnPowerLineDbChange).toHaveBeenCalled();
    const firstCall = mockOnPowerLineDbChange.mock.calls[0][0];
    // y=300 is 280px down from the plot top on the stable bottom-row layout.
    expect(firstCall).toBeCloseTo(-69.4, 1);

    // Pointer move to y=200
    triggerPointerMove(20, 200);
    const lastCall =
      mockOnPowerLineDbChange.mock.calls[
        mockOnPowerLineDbChange.mock.calls.length - 1
      ][0];
    // y=200 is 180px down from the plot top on the stable bottom-row layout.
    expect(lastCall).toBeCloseTo(-44.6, 1);

    // Pointer up should set power line to null to hide it
    triggerPointerUp(20, 200);
    const finalCall =
      mockOnPowerLineDbChange.mock.calls[
        mockOnPowerLineDbChange.mock.calls.length - 1
      ][0];
    expect(finalCall).toBeNull();
  });

  it("should disable scroll/wheel events in the left scale margin", () => {
    renderHook(() => useSpectrumInteraction(defaultOptions));

    const preventDefaultMock = jest.fn();
    triggerWheel({
      clientX: 20, // inside left margin x < 50
      clientY: 300,
      preventDefault: preventDefaultMock,
    });

    expect(preventDefaultMock).toHaveBeenCalled();
    expect(mockOnFrequencyRangeChange).not.toHaveBeenCalled();
    expect(mockOnVizPanChange).not.toHaveBeenCalled();
  });
});
