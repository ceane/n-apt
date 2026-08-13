import {
  getInitialHandledWebGpuResetEpoch,
  resolveWebGpuStreamTransition,
  getVisualizerLifecycleKey,
  getWebGpuStreamResetKey,
  shouldClearStandbySourcePresentation,
  shouldCommitSourcePresentationReset,
  shouldPreservePresentationDuringFrameGap,
  shouldRestoreWebGpuStreamState,
  shouldAcceptWebGpuStreamFrame,
  shouldShowSourceHandoffOverlay,
  shouldFlushWebGpuStreamCache,
  shouldResetVisualPresentationForSelection,
  shouldPreserveWaterfallOnTxStandby,
  shouldClearWebGpuForPlaceholder,
} from "@n-apt/app/infrastructure/visualization/webgpuStreamReset";

describe("WebGPU stream reset", () => {
  test("resets visual presentation when selection changes", () => {
    expect(
      shouldResetVisualPresentationForSelection("mock-apt", "mock-tx"),
    ).toBe(true);
    expect(
      shouldResetVisualPresentationForSelection("mock-tx", "mock-tx"),
    ).toBe(false);
  });
  test("does not wipe WebGPU for Loading or standby chrome", () => {
    expect(shouldClearWebGpuForPlaceholder("loading")).toBe(false);
    expect(shouldClearWebGpuForPlaceholder("top-bar")).toBe(false);
    expect(shouldClearWebGpuForPlaceholder("overlay-only")).toBe(false);
    expect(shouldClearWebGpuForPlaceholder(null)).toBe(false);
    expect(shouldClearWebGpuForPlaceholder("error")).toBe(true);
    expect(shouldClearWebGpuForPlaceholder("disconnected")).toBe(true);
  });

  test("commits a pending source reset only with the replacement frame", () => {
    expect(shouldCommitSourcePresentationReset(true, true)).toBe(true);
    expect(shouldCommitSourcePresentationReset(true, false)).toBe(false);
    expect(shouldCommitSourcePresentationReset(false, true)).toBe(false);
  });

  test("does not commit a pending reset without a replacement frame by default", () => {
    expect(shouldCommitSourcePresentationReset(true, false, false)).toBe(false);
    expect(shouldCommitSourcePresentationReset(true, true, false)).toBe(true);
    expect(shouldCommitSourcePresentationReset(true, false, true)).toBe(true);
    expect(shouldCommitSourcePresentationReset(true, true, false, true)).toBe(
      false,
    );
  });

  test("clears stale standby ownership but freezes the selected source frame", () => {
    expect(
      shouldClearStandbySourcePresentation({
        isStandbyTopBar: true,
        presentedSourceId: "mock-apt",
        expectedSourceId: "mock-tx",
      }),
    ).toBe(true);
    expect(
      shouldClearStandbySourcePresentation({
        isStandbyTopBar: true,
        presentedSourceId: "mock-tx",
        expectedSourceId: "mock-tx",
      }),
    ).toBe(false);
  });

  test("preserves the selected Tx waterfall across repeated standby/transmit toggles", () => {
    expect(
      shouldPreserveWaterfallOnTxStandby({
        previousIsStandby: false,
        nextIsStandby: true,
        expectedSourceId: "hackrf-one",
        presentedSourceId: "hackrf-one",
      }),
    ).toBe(true);
    expect(
      shouldPreserveWaterfallOnTxStandby({
        previousIsStandby: true,
        nextIsStandby: false,
        expectedSourceId: "hackrf-one",
        presentedSourceId: "hackrf-one",
      }),
    ).toBe(true);
    expect(
      shouldPreserveWaterfallOnTxStandby({
        previousIsStandby: false,
        nextIsStandby: true,
        expectedSourceId: "hackrf-one",
        presentedSourceId: "hackrf-one",
      }),
    ).toBe(true);
    expect(
      shouldPreserveWaterfallOnTxStandby({
        previousIsStandby: true,
        nextIsStandby: false,
        expectedSourceId: "hackrf-one",
        presentedSourceId: "hackrf-one",
      }),
    ).toBe(true);
    expect(
      shouldPreserveWaterfallOnTxStandby({
        previousIsStandby: false,
        nextIsStandby: true,
        expectedSourceId: "hackrf-one",
        presentedSourceId: "mock-apt",
      }),
    ).toBe(false);
  });

  test("preserves the last presentation during a connected frame-processing gap", () => {
    expect(
      shouldPreservePresentationDuringFrameGap({
        hasPresentedFrame: true,
        hasCurrentFrame: false,
        isDeviceConnected: true,
        hasExplicitPlaceholder: false,
        hasPlaceholderError: false,
      }),
    ).toBe(true);
    expect(
      shouldPreservePresentationDuringFrameGap({
        hasPresentedFrame: true,
        hasCurrentFrame: false,
        isDeviceConnected: true,
        hasExplicitPlaceholder: true,
        hasPlaceholderError: false,
      }),
    ).toBe(false);
  });
  test("replays a nonzero reset epoch when a canvas remounts", () => {
    expect(getInitialHandledWebGpuResetEpoch(0)).toBe(0);
    expect(getInitialHandledWebGpuResetEpoch(4)).toBe(3);
  });

  test("does not restore a visualizer snapshot into a reset stream", () => {
    expect(shouldRestoreWebGpuStreamState(0)).toBe(true);
    expect(shouldRestoreWebGpuStreamState(1)).toBe(false);
  });

  test("rejects an old source frame while waiting for the selected stream", () => {
    expect(
      shouldAcceptWebGpuStreamFrame({
        expectedSourceId: "rtl-sdr-00000001",
        frameSourceId: "mock-apt",
      }),
    ).toBe(false);
    expect(
      shouldAcceptWebGpuStreamFrame({
        expectedSourceId: "rtl-sdr-00000001",
        frameSourceId: "rtl-sdr-00000001",
      }),
    ).toBe(true);
  });

  test("holds one handoff overlay from selection until the new source frame arrives", () => {
    expect(
      shouldShowSourceHandoffOverlay({
        sourceMode: "live",
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "hackrf-one",
        hasActiveSourceFrame: true,
      }),
    ).toBe(true);
    expect(
      shouldShowSourceHandoffOverlay({
        sourceMode: "live",
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "rtl-sdr-v4",
        hasActiveSourceFrame: false,
      }),
    ).toBe(true);
    expect(
      shouldShowSourceHandoffOverlay({
        sourceMode: "live",
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "rtl-sdr-v4",
        hasActiveSourceFrame: true,
      }),
    ).toBe(false);
  });

  test("uses the active transport owner for untagged live frames", () => {
    expect(
      shouldAcceptWebGpuStreamFrame({
        expectedSourceId: "mock-tx",
        frameSourceId: null,
        fallbackFrameSourceId: "mock-apt",
      }),
    ).toBe(false);
    expect(
      shouldAcceptWebGpuStreamFrame({
        expectedSourceId: "mock-tx",
        frameSourceId: null,
        fallbackFrameSourceId: "mock-tx",
      }),
    ).toBe(true);
  });

  test("holds the same handoff overlay while switching between mock sources", () => {
    expect(
      shouldShowSourceHandoffOverlay({
        sourceMode: "live",
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        hasActiveSourceFrame: true,
      }),
    ).toBe(true);
    expect(
      shouldShowSourceHandoffOverlay({
        sourceMode: "live",
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        hasActiveSourceFrame: true,
      }),
    ).toBe(true);
  });

  test("creates a new canvas lifecycle key for a hotplug reset", () => {
    expect(
      getWebGpuStreamResetKey({ sourceId: "rtl-sdr-v4", epoch: 2 }),
    ).not.toBe(getWebGpuStreamResetKey({ sourceId: "rtl-sdr-v4", epoch: 1 }));
  });

  test("keeps the canvas lifecycle stable across pause status changes", () => {
    expect(
      getVisualizerLifecycleKey({
        sourceId: "hackrf-one",
        epoch: 2,
        status: "connected",
      }),
    ).toBe(
      getVisualizerLifecycleKey({
        sourceId: "hackrf-one",
        epoch: 2,
        status: "paused",
      }),
    );
  });

  test("keeps the canvas lifecycle stable across source handoffs", () => {
    expect(
      getVisualizerLifecycleKey({
        sourceId: "mock-apt",
        epoch: 2,
      }),
    ).toBe(
      getVisualizerLifecycleKey({
        sourceId: "mock-tx",
        epoch: 2,
      }),
    );
  });

  test("advances the reset epoch only for same-source reconnect boundaries", () => {
    expect(
      shouldFlushWebGpuStreamCache(
        { sourceId: "hackrf_one-serial", status: "streaming" },
        { sourceId: "hackrf_one-serial", status: "loading" },
      ),
    ).toBe(true);

    expect(
      shouldFlushWebGpuStreamCache(
        { sourceId: "hackrf_one-serial", status: "streaming" },
        { sourceId: "mock-apt", status: "disconnected" },
      ),
    ).toBe(false);

    expect(
      shouldFlushWebGpuStreamCache(
        { sourceId: "rtl-sdr-serial", status: "loading" },
        { sourceId: "rtl-sdr-serial", status: "connected" },
      ),
    ).toBe(false);

    expect(
      shouldFlushWebGpuStreamCache(
        { sourceId: "rtl-sdr-serial", status: "streaming" },
        { sourceId: "hackrf_one-serial", status: "connected" },
      ),
    ).toBe(false);

    expect(
      shouldFlushWebGpuStreamCache(
        {
          sourceId: "rtl-sdr-serial",
          selectedSourceId: "rtl-sdr-serial",
          status: "streaming",
        },
        {
          sourceId: "rtl-sdr-serial",
          selectedSourceId: "hackrf_one-serial",
          status: "streaming",
        },
      ),
    ).toBe(false);
  });

  test("resets the live ref when Mock APT → Mock Tx selection changes", () => {
    const selection = resolveWebGpuStreamTransition(
      {
        sourceId: "mock-apt",
        selectedSourceId: "mock-apt",
        status: "streaming",
      },
      {
        sourceId: "mock-apt",
        selectedSourceId: "mock-tx",
        status: "streaming",
      },
    );
    expect(selection).toEqual({
      clearLiveFrame: true,
      advanceResetEpoch: true,
    });

    const commit = resolveWebGpuStreamTransition(
      {
        sourceId: "mock-apt",
        selectedSourceId: "mock-tx",
        status: "streaming",
      },
      {
        sourceId: "mock-tx",
        selectedSourceId: "mock-tx",
        status: "connected",
      },
    );
    expect(commit).toEqual({
      clearLiveFrame: false,
      advanceResetEpoch: false,
    });
  });

  test("invalidates the painted graph at every source selection boundary", () => {
    expect(
      resolveWebGpuStreamTransition(
        {
          sourceId: "mock-apt",
          selectedSourceId: "mock-apt",
          status: "paused",
        },
        {
          sourceId: "mock-apt",
          selectedSourceId: "rtl-sdr-00000001",
          status: "loading",
        },
      ),
    ).toEqual({
      clearLiveFrame: true,
      advanceResetEpoch: true,
    });
  });

  test("preserves Tx waterfall across Start Tx when the transport ref is briefly empty", () => {
    expect(
      shouldPreserveWaterfallOnTxStandby({
        previousIsStandby: true,
        nextIsStandby: false,
        expectedSourceId: "mock-tx",
        presentedSourceId: null,
      }),
    ).toBe(true);
  });

  test("keeps the last presentation under a standby top-bar frame gap", () => {
    expect(
      shouldPreservePresentationDuringFrameGap({
        hasPresentedFrame: true,
        hasCurrentFrame: false,
        isDeviceConnected: true,
        hasExplicitPlaceholder: false,
        hasPlaceholderError: false,
      }),
    ).toBe(true);
  });
});

it("preserves the last Tx frame while stopping into standby", async () => {
  const { resolveWebGpuStreamTransition } = await import(
    "@n-apt/app/infrastructure/visualization/webgpuStreamReset"
  );

  expect(
    resolveWebGpuStreamTransition(
      {
        sourceId: "mock-tx",
        selectedSourceId: "mock-tx",
        status: "transmitting",
      },
      {
        sourceId: "mock-tx",
        selectedSourceId: "mock-tx",
        status: "standby",
      },
    ),
  ).toEqual({
    clearLiveFrame: false,
    advanceResetEpoch: false,
  });
});
