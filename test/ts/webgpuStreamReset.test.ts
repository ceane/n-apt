import {
  getWebGpuStreamResetKey,
  shouldShowSourceHandoffOverlay,
  shouldFlushWebGpuStreamCache,
} from "@n-apt/utils/webgpuStreamReset";

describe("WebGPU stream reset", () => {
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

  test("creates a new canvas lifecycle key for a hotplug reset", () => {
    expect(
      getWebGpuStreamResetKey({ sourceId: "rtl-sdr-v4", epoch: 2 }),
    ).not.toBe(getWebGpuStreamResetKey({ sourceId: "rtl-sdr-v4", epoch: 1 }));
  });

  test("flushes cached renderer state for reconnect and confirmed source boundaries", () => {
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
    ).toBe(true);

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
    ).toBe(true);
  });
});
