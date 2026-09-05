/** @jest-environment jsdom */
import React from "react";
import fc from "fast-check";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, renderHook } from "@testing-library/react";
import spectrumReducer, {
  setTuningPreviewActive,
} from "@n-apt/redux/slices/spectrumSlice";
import { useChannelTuner } from "@n-apt/spectrum/hooks/useChannelManagement";

describe("useChannelTuner lifecycle", () => {
  it("fuzzes Whole Channel handoffs so range edges and sample rate stay aligned", () => {
    const onSampleRateChange = jest.fn();
    const store = configureStore({
      reducer: { spectrum: spectrumReducer },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(() => useChannelTuner(onSampleRateChange), {
      wrapper,
    });

    act(() => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1_000_000, max: 200_000_000 }),
          fc.integer({ min: 100_000, max: 30_000_000 }),
          (min, span) => {
            const range = { min, max: min + span };
            result.current.tuneChannels(
              [{ label: "C", min: range.min, max: range.max }],
              undefined,
              range,
              span,
            );

            const [sampleRateHz, mode, focusRange] =
              onSampleRateChange.mock.calls[
                onSampleRateChange.mock.calls.length - 1
              ] ?? [];
            expect(mode).toBe("whole");
            expect(focusRange).toEqual(range);
            expect(focusRange.max - focusRange.min).toBe(sampleRateHz);
            expect(focusRange.min).toBe(min);
            expect(focusRange.max).toBe(min + span);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  it("passes the committed channel-focus range with a Whole Channel rate change", () => {
    const onSampleRateChange = jest.fn();
    const store = configureStore({
      reducer: { spectrum: spectrumReducer },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(() => useChannelTuner(onSampleRateChange), {
      wrapper,
    });
    const focusedRange = { min: 4_750_000, max: 23_000_000 };

    act(() => {
      result.current.tuneChannels(
        [{ label: "C", min: focusedRange.min, max: focusedRange.max }],
        undefined,
        focusedRange,
        18_250_000,
      );
    });

    expect(onSampleRateChange).toHaveBeenCalledWith(
      18_250_000,
      "whole",
      focusedRange,
    );
  });

  it("does not cancel an active progressive tune on an ordinary rerender", () => {
    const store = configureStore({
      reducer: { spectrum: spectrumReducer },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result, rerender } = renderHook(() => useChannelTuner(), {
      wrapper,
    });

    act(() => {
      result.current.tuneChannels(
        [{ label: "A", min: 18_000, max: 4_390_000 }],
        undefined,
        { min: 18_000, max: 4_390_000 },
        undefined,
        { durationMs: 500, inertia: "ease-out" },
      );
    });
    expect(store.getState().spectrum.tuningPreviewActive).toBe(true);

    rerender();

    expect(store.getState().spectrum.tuningPreviewActive).toBe(true);
  });

  it("cancels the progressive trajectory when direct tuning clears preview ownership", () => {
    const requestFrame = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 17);
    const cancelFrame = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const store = configureStore({
      reducer: { spectrum: spectrumReducer },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(() => useChannelTuner(), { wrapper });

    act(() => {
      result.current.tuneChannels(
        [{ label: "A", min: 18_000, max: 4_390_000 }],
        undefined,
        { min: 18_000, max: 4_390_000 },
        undefined,
        { durationMs: 500, inertia: "ease-out" },
      );
    });
    expect(requestFrame).toHaveBeenCalled();

    act(() => {
      store.dispatch(setTuningPreviewActive(false));
    });

    expect(cancelFrame).toHaveBeenCalledWith(17);
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });
});
