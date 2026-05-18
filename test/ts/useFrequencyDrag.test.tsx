/** @jest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { useFrequencyDrag } from "@n-apt/hooks/useFrequencyDrag";
import React from "react";

describe("useFrequencyDrag Hook", () => {
  const mockOnFrequencyRangeChange = jest.fn();
  const mockOnVizPanChange = jest.fn();
  const mockOnVizZoomChange = jest.fn();
  const mockOnVizZoomFloorChange = jest.fn();
  const mockOnFftDbLimitsChange = jest.fn();
  const mockOnSelectionChange = jest.fn();

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
    vizZoomRef: { current: 1 },
    vizZoomFloorRef: { current: 1 },
    vizPanOffsetRef: { current: 0 },
    vizDbMinRef: { current: -120 },
    vizDbMaxRef: { current: 0 },
  };

  let listeners: Record<string, Function> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    listeners = {};
    frequencyRangeRef.current = { min: 100, max: 110 };

    // Mock window event listeners
    jest.spyOn(window, "addEventListener").mockImplementation((event, cb) => {
      listeners[event] = cb as Function;
    });
    jest.spyOn(window, "removeEventListener").mockImplementation((event) => {
      delete listeners[event];
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const triggerPointerDown = (clientX: number, clientY: number, pointerId = 1) => {
    const calls = spectrumContainerRef.current.addEventListener.mock.calls.filter(
      (c: any) => c[0] === "pointerdown",
    );
    const handler = calls[calls.length - 1][1];
    act(() => {
      handler({ clientX, clientY, pointerId } as any);
    });
  };

  const triggerPointerMove = (clientX: number, clientY: number) => {
    const handler = listeners["pointermove"];
    if (handler) {
      act(() => {
        handler({ clientX, clientY } as any);
      });
    }
  };

  const triggerPointerUp = (clientX: number, clientY: number) => {
    const handler = listeners["pointerup"];
    if (handler) {
      act(() => {
        handler({ clientX, clientY, pointerId: 1 } as any);
      });
    }
  };

  it("should handle VFO dragging (panning) in the bottom 60px area", () => {
    renderHook(() => useFrequencyDrag(defaultOptions));

    // Pointer down at y=550 (bottom area)
    triggerPointerDown(500, 550);

    // Drag right by 100px. Spectrum width 1000, range 10MHz. 100px = 1MHz.
    // Dragging right = frequency decreases.
    triggerPointerMove(600, 550);

    expect(mockOnFrequencyRangeChange).toHaveBeenCalled();
    const lastCall =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ][0];
    expect(lastCall.min).toBeCloseTo(99, 1);
    expect(lastCall.max).toBeCloseTo(109, 1);
  });

  it("should handle box selection in the upper area", () => {
    const mockBox = document.createElement("div");
    jest.spyOn(document, "createElement").mockReturnValue(mockBox);

    renderHook(() => useFrequencyDrag(defaultOptions));

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

  it("should start a fresh range drag inside an existing selection unless resizing", () => {
    const selectionOptions = {
      ...defaultOptions,
      disabled: false,
      selectionMode: "range" as const,
    };
    renderHook(() => useFrequencyDrag(selectionOptions));

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

  it("creates a range from right to left without anchoring at the center", () => {
    renderHook(() =>
      useFrequencyDrag({
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
      useFrequencyDrag({
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
      useFrequencyDrag({
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
      useFrequencyDrag({
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

  it("uses the latest selection range after rerendering", () => {
    const { rerender } = renderHook(
      ({ selectionRange }) =>
        useFrequencyDrag({
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

  it("should clamp VFO dragging to signal area bounds if provided", () => {
    const boundsOptions = {
      ...defaultOptions,
      signalAreaBounds: { TEST: { min: 100, max: 110 } },
    };
    renderHook(() => useFrequencyDrag(boundsOptions));

    // current is already at 100-110
    triggerPointerDown(500, 550);

    // Drag left by 100px (clientX decreases) -> freq increases.
    // Result should be clamped because max is 110.
    triggerPointerMove(400, 550);

    const lastCall =
      mockOnFrequencyRangeChange.mock.calls[
        mockOnFrequencyRangeChange.mock.calls.length - 1
      ][0];
    expect(lastCall.max).toBe(110);
    expect(lastCall.min).toBe(100);
  });

  it("should make pinch zoom feel more responsive and keep the gesture anchored", () => {
    const pinchOptions = {
      ...defaultOptions,
      vizZoomRef: { current: 2 },
      vizPanOffsetRef: { current: 10 },
    };

    renderHook(() => useFrequencyDrag(pinchOptions));

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
      mockOnVizZoomChange.mock.calls[mockOnVizZoomChange.mock.calls.length - 1][0];
    expect(zoomCall).toBeGreaterThan(2.2);
  });

  it("should ease pinch-out zoom so it does not feel linear", () => {
    const pinchOptions = {
      ...defaultOptions,
      vizZoomRef: { current: 2 },
      vizPanOffsetRef: { current: 10 },
    };

    renderHook(() => useFrequencyDrag(pinchOptions));

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
      mockOnVizZoomChange.mock.calls[mockOnVizZoomChange.mock.calls.length - 1][0];
    expect(zoomCall).toBeGreaterThanOrEqual(1);
  });

  it("should keep pinch zoom from going below the zoom floor", () => {
    const pinchOptions = {
      ...defaultOptions,
      vizZoomRef: { current: 4 },
      vizZoomFloorRef: { current: 3 },
      vizPanOffsetRef: { current: 10 },
    };

    renderHook(() => useFrequencyDrag(pinchOptions));

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
      mockOnVizZoomChange.mock.calls[mockOnVizZoomChange.mock.calls.length - 1][0];
    expect(zoomCall).toBeGreaterThanOrEqual(3);
  });
});
