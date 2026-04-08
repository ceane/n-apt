/** @jest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { useFrequencyDrag } from "@n-apt/hooks/useFrequencyDrag";
import React from "react";

describe("useFrequencyDrag Hook", () => {
  const mockOnFrequencyRangeChange = jest.fn();
  const mockOnVizPanChange = jest.fn();
  const mockOnVizZoomChange = jest.fn();
  const mockOnFftDbLimitsChange = jest.fn();

  const frequencyRangeRef = { current: { min: 100, max: 110 } };
  const spectrumGpuCanvasRef = { current: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }) } } as any;
  const spectrumContainerRef = {
    current: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      style: { cursor: "" },
      setPointerCapture: jest.fn(),
      releasePointerCapture: jest.fn(),
      appendChild: jest.fn(),
    }
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
    onFftDbLimitsChange: mockOnFftDbLimitsChange,
    vizZoomRef: { current: 1 },
    vizPanOffsetRef: { current: 0 },
    vizDbMinRef: { current: -120 },
    vizDbMaxRef: { current: 0 },
  };

  let listeners: Record<string, Function> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    listeners = {};

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

  const triggerPointerDown = (clientX: number, clientY: number) => {
    const handler = spectrumContainerRef.current.addEventListener.mock.calls.find((c: any) => c[0] === "pointerdown")[1];
    act(() => {
      handler({ clientX, clientY, pointerId: 1 } as any);
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
    const lastCall = mockOnFrequencyRangeChange.mock.calls[mockOnFrequencyRangeChange.mock.calls.length - 1][0];
    expect(lastCall.min).toBeCloseTo(99, 1);
    expect(lastCall.max).toBeCloseTo(109, 1);
  });

  it("should handle box selection in the upper area", () => {
    const mockBox = document.createElement("div");
    jest.spyOn(document, "createElement").mockReturnValue(mockBox);

    renderHook(() => useFrequencyDrag(defaultOptions));

    // Pointer down at y=100 (upper area)
    triggerPointerDown(100, 100);

    // Move to create a box
    triggerPointerMove(200, 200);

    expect(document.createElement).toHaveBeenCalledWith("div");

    // Pointer up to trigger zoom
    triggerPointerUp(200, 200);

    // Box of 100px width on 1000px canvas = 10x zoom
    expect(mockOnVizZoomChange).toHaveBeenCalled();
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

    const lastCall = mockOnFrequencyRangeChange.mock.calls[mockOnFrequencyRangeChange.mock.calls.length - 1][0];
    expect(lastCall.max).toBe(110);
    expect(lastCall.min).toBe(100);
  });
});
