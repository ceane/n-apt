import {
  resolvePendingWaterfallRestore,
  type PendingWaterfallRestore,
} from "@n-apt/spectrum/utils/waterfallRestore";

describe("resolvePendingWaterfallRestore", () => {
  const pendingRestore: PendingWaterfallRestore = {
    data: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
    writeRow: 0,
  };

  it("returns the pending restore when no new waterfall row has arrived yet", () => {
    expect(
      resolvePendingWaterfallRestore({
        pendingRestore,
        shouldUpdateWaterfallRow: false,
        hasRenderedRestore: false,
      }),
    ).toEqual(pendingRestore);
  });

  it("restores before writing the first new row after remount", () => {
    expect(
      resolvePendingWaterfallRestore({
        pendingRestore,
        shouldUpdateWaterfallRow: true,
        hasRenderedRestore: false,
      }),
    ).toEqual(pendingRestore);
  });

  it("does not re-apply the same restore after the first repaint", () => {
    expect(
      resolvePendingWaterfallRestore({
        pendingRestore,
        shouldUpdateWaterfallRow: false,
        hasRenderedRestore: true,
      }),
    ).toBeUndefined();
  });
});
