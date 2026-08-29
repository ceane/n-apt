/** @jest-environment jsdom */
import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, renderHook } from "@testing-library/react";
import spectrumReducer, {
  setTuningPreviewActive,
} from "@n-apt/redux/slices/spectrumSlice";
import { useChannelTuner } from "@n-apt/spectrum/hooks/useChannelManagement";

describe("useChannelTuner lifecycle", () => {
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
