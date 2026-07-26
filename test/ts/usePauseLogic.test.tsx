import { act, renderHook } from "@testing-library/react";
import { usePauseLogic } from "@n-apt/hooks/usePauseLogic";
import { writePauseSnapshot } from "@n-apt/hooks/pauseSnapshotStorage";

describe("usePauseLogic", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("hydrates a dedicated paused snapshot only once per pause session", () => {
    writePauseSnapshot("source-a", {
      iqData: new Uint8Array([1, 2]),
      waterfall: null,
      waterfallDimensions: null,
    });
    const dataRef = { current: null };
    const pausedSnapshotRef = { current: null };
    const getItem = jest.spyOn(Storage.prototype, "getItem");

    const { result } = renderHook(() =>
      usePauseLogic({
        isPaused: false,
        waterfallBufferRef: { current: null },
        waterfallDimsRef: { current: null },
        dataRef,
        pausedSnapshotRef,
        forceRender: jest.fn(),
        snapshotScope: "source-a",
      }),
    );

    act(() => {
      result.current.hydratePauseSnapshot();
      result.current.hydratePauseSnapshot();
    });

    expect(getItem).toHaveBeenCalledTimes(3);
    expect((pausedSnapshotRef.current as any)?.iqData).toEqual(
      new Uint8Array([1, 2]),
    );
    expect(dataRef.current).toBeNull();
  });
});
