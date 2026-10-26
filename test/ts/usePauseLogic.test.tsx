import { act, renderHook } from "@testing-library/react";
import { usePauseLogic } from "@n-apt/spectrum/hooks/usePauseLogic";
import type { PausedFrameSnapshot } from "@n-apt/spectrum/types/PausedFrameSnapshot";
import type { PendingWaterfallRestore } from "@n-apt/spectrum/utils/waterfallRestore";

describe("usePauseLogic", () => {
  it("keeps the full recent waterfall history in memory and clears its snapshot on resume", () => {
    const dataRef = { current: { iq_data: new Uint8Array([1, 2]) } };
    const waterfallBufferRef = {
      current: new Uint8ClampedArray([3, 4, 5, 6]),
    };
    const waterfallDimsRef = { current: { width: 2, height: 2 } };
    const waterfallTextureSnapshotRef: { current: Uint8Array | null } = {
      current: Uint8Array.from({ length: 2 * 32 * 4 }, (_, i) => i % 256),
    };
    const waterfallTextureMetaRef: {
      current: { width: number; height: number; writeRow: number } | null;
    } = {
      current: { width: 2, height: 32, writeRow: 7 },
    };
    const pendingWaterfallRestoreRef: {
      current: PendingWaterfallRestore | null;
    } = { current: null };
    const restoredWaterfallRef = { current: true };
    const pausedSnapshotRef: { current: PausedFrameSnapshot | null } = {
      current: null,
    };
    const getItem = jest.spyOn(Storage.prototype, "getItem");
    const setItem = jest.spyOn(Storage.prototype, "setItem");

    const { result, rerender } = renderHook(
      ({ isPaused }) =>
        usePauseLogic({
          isPaused,
          waterfallBufferRef,
          waterfallDimsRef,
          waterfallTextureSnapshotRef,
          waterfallTextureMetaRef,
          pendingWaterfallRestoreRef,
          restoredWaterfallRef,
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
      waterfallTextureSnapshot: Uint8Array.from(
        { length: 2 * 32 * 4 },
        (_, i) => i % 256,
      ),
      waterfallTextureMeta: { width: 2, height: 32, writeRow: 7 },
    });

    const capturedHistory = pausedSnapshotRef.current!.waterfallTextureSnapshot!;
    waterfallTextureSnapshotRef.current![0] = 255;
    expect(capturedHistory[0]).toBe(0);

    waterfallTextureSnapshotRef.current = null;
    waterfallTextureMetaRef.current = null;
    act(() => {
      result.current.hydratePauseSnapshot();
    });
    expect(waterfallTextureSnapshotRef.current).toEqual(capturedHistory);
    expect(waterfallTextureMetaRef.current).toEqual({
      width: 2,
      height: 32,
      writeRow: 7,
    });
    expect(pendingWaterfallRestoreRef.current).toEqual({
      data: capturedHistory,
      width: 2,
      height: 32,
      writeRow: 7,
    });
    expect(pendingWaterfallRestoreRef.current!.data).not.toBe(capturedHistory);
    expect(restoredWaterfallRef.current).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    rerender({ isPaused: false });
    expect(pausedSnapshotRef.current).toBeNull();
  });
});
