/** @jest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { useFrequencyDrag } from "@n-apt/spectrum/hooks/useFrequencyDrag";
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
    });
  };

  it("scrolls into the mirrored axis with bounded steps and a bounded viewport", () => {
    renderHook(() =>
      useFrequencyDrag(
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
});
