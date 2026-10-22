import { act, renderHook } from "@testing-library/react";
import { usePauseLogic } from "@n-apt/spectrum/hooks/usePauseLogic";

describe("usePauseLogic", () => {
  it("keeps a paused frame in memory and clears its snapshot on resume", () => {
    const dataRef = { current: { iq_data: new Uint8Array([1, 2]) } };
    const waterfallBufferRef = {
      current: new Uint8ClampedArray([3, 4, 5, 6]),
    };
    const waterfallDimsRef = { current: { width: 2, height: 2 } };
    const pausedSnapshotRef = { current: null };
    const getItem = jest.spyOn(Storage.prototype, "getItem");
    const setItem = jest.spyOn(Storage.prototype, "setItem");

    const { result, rerender } = renderHook(
      ({ isPaused }) =>
        usePauseLogic({
          isPaused,
          waterfallBufferRef,
          waterfallDimsRef,
          dataRef,
          pausedSnapshotRef,
          forceRender: jest.fn(),
          snapshotScope: "source-a",
        }),
      { initialProps: { isPaused: true } },
    );

    act(() => {
      result.current.hydratePauseSnapshot();
    });

    expect(pausedSnapshotRef.current).toEqual({
      iqData: new Uint8Array([1, 2]),
      waterfall: new Uint8ClampedArray([3, 4, 5, 6]),
      waterfallDimensions: { width: 2, height: 2 },
    });
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    rerender({ isPaused: false });
    expect(pausedSnapshotRef.current).toBeNull();
  });
});
