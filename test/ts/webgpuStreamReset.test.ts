import {
  getInitialHandledWebGpuResetEpoch,
  resolveWebGpuStreamTransition,
  getVisualizerLifecycleKey,
  getWebGpuStreamResetKey,
  shouldPreservePresentationDuringFrameGap,
  shouldRestoreWebGpuStreamState,
  shouldAcceptWebGpuStreamFrame,
  shouldShowSourceHandoffOverlay,
  shouldFlushWebGpuStreamCache,
} from "@n-apt/utils/webgpuStreamReset";

describe("WebGPU stream reset", () => {
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

  test("clears once on selection without remounting again at active-source commit", () => {
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
      advanceResetEpoch: false,
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
});
