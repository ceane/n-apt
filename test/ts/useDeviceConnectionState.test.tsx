import { renderHook } from "@testing-library/react";
import { useDeviceConnectionState } from "@n-apt/hooks/useDeviceConnectionState";

describe("useDeviceConnectionState", () => {
  it("only dispatches unavailable state once while disconnected", () => {
    const dispatch = jest.fn();

    const { rerender } = renderHook(
      ({
        deviceState,
        showSpikeOverlay,
      }: {
        deviceState: string;
        showSpikeOverlay: boolean;
      }) =>
        useDeviceConnectionState({
          deviceState,
          showSpikeOverlay,
          dispatch,
        }),
      {
        initialProps: {
          deviceState: "disconnected",
          showSpikeOverlay: false,
        },
      },
    );

    expect(dispatch).toHaveBeenCalledTimes(2);

    rerender({
      deviceState: "disconnected",
      showSpikeOverlay: false,
    });

    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
