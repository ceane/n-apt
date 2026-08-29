/** @jest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { useFrequencyTuning } from "@n-apt/app/routes/pages/spectrum/hooks/useLiveTuning";
import { setTuningPreviewActive } from "@n-apt/redux";

describe("useFrequencyTuning live retunes", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("cancels an active progressive channel tune when wheel tuning begins", () => {
    const reduxDispatch = jest.fn();
    const { result } = renderHook(() =>
      useFrequencyTuning({
        allowNegativeFrequencies: true,
        hardwareSpectrumBounds: { min: 0, max: 30_000_000_000 },
        activeSignalAreaBounds: { min: 0, max: 30_000_000_000 },
        sampleRateHzEffective: 4_372_000,
        getAvailableSpectrumBounds: (bounds) =>
          bounds ?? { min: 0, max: 30_000_000_000 },
        frequencyRange: { min: 0, max: 4_372_000 },
        tuningPreviewActive: true,
        reduxDispatch,
        sendFrequencyRange: jest.fn(),
        applyTxMonitorForRange: jest.fn(),
        setVizPanOffset: jest.fn(),
      }),
    );

    act(() => {
      result.current.handleFrequencyRangeChange(
        { min: 100_000, max: 4_472_000 },
        "user-pan",
      );
    });

    expect(reduxDispatch).toHaveBeenCalledWith(setTuningPreviewActive(false));
  });

  it("bounds the route/device fan-out while retaining the latest user-pan range", () => {
    const reduxDispatch = jest.fn();
    const sendFrequencyRange = jest.fn();
    const setVizPanOffset = jest.fn();

    const { result } = renderHook(() =>
      useFrequencyTuning({
        allowNegativeFrequencies: true,
        hardwareSpectrumBounds: { min: 0, max: 30_000_000_000 },
        activeSignalAreaBounds: { min: 0, max: 30_000_000_000 },
        sampleRateHzEffective: 4_372_000,
        getAvailableSpectrumBounds: (bounds) =>
          bounds ?? { min: 0, max: 30_000_000_000 },
        frequencyRange: { min: 0, max: 4_372_000 },
        vizZoom: 1,
        vizPanOffset: 0,
        reduxDispatch,
        sendFrequencyRange,
        applyTxMonitorForRange: jest.fn(),
        setVizPanOffset,
      }),
    );

    act(() => {
      result.current.handleFrequencyRangeChange(
        { min: 1_000_000, max: 5_372_000 },
        "user-pan",
      );
      result.current.handleFrequencyRangeChange(
        { min: 2_000_000, max: 6_372_000 },
        "user-pan",
      );
    });

    expect(reduxDispatch).toHaveBeenCalledTimes(1);
    expect(sendFrequencyRange).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(reduxDispatch).toHaveBeenCalledTimes(2);
    expect(sendFrequencyRange).toHaveBeenCalledTimes(2);
    expect(sendFrequencyRange).toHaveBeenLastCalledWith({
      min: 2_000_000,
      max: 6_372_000,
    });
  });

  it("bounds mirror hardware-retune fan-out while retaining the latest range", () => {
    const reduxDispatch = jest.fn();
    const sendFrequencyRange = jest.fn();
    const setVizPanOffset = jest.fn();

    const { result } = renderHook(() =>
      useFrequencyTuning({
        allowNegativeFrequencies: true,
        hardwareSpectrumBounds: { min: 0, max: 30_000_000_000 },
        activeSignalAreaBounds: { min: 0, max: 30_000_000_000 },
        sampleRateHzEffective: 4_372_000,
        getAvailableSpectrumBounds: (bounds) =>
          bounds ?? { min: 0, max: 30_000_000_000 },
        frequencyRange: { min: 0, max: 4_372_000 },
        vizZoom: 1,
        vizPanOffset: 0,
        reduxDispatch,
        sendFrequencyRange,
        applyTxMonitorForRange: jest.fn(),
        setVizPanOffset,
      }),
    );

    act(() => {
      result.current.handleFrequencyRangeChange(
        { min: 1_000_000, max: 5_372_000 },
        "hardware-retune",
      );
      result.current.handleFrequencyRangeChange(
        { min: 2_000_000, max: 6_372_000 },
        "hardware-retune",
      );
    });

    expect(reduxDispatch).toHaveBeenCalledTimes(1);
    expect(sendFrequencyRange).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(reduxDispatch).toHaveBeenCalledTimes(2);
    expect(sendFrequencyRange).toHaveBeenCalledTimes(2);
    expect(sendFrequencyRange).toHaveBeenLastCalledWith({
      min: 2_000_000,
      max: 6_372_000,
    });
  });
});
