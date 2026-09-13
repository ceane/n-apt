import {
  getMockTxPreviewRequestKey,
  resolveLiveDevicePlaceholderState,
  resolveSpectrumLimitMarkers,
  resolvePausedFrameFrequencyRange,
  shouldPublishFrequencyRangeForSource,
} from "@n-apt/app/routes/pages/SpectrumRoute";
import {
  resolvePausedPreviewRequestSourceId,
  resolveMockTxMonitorSampleRateForView,
  resolveMockTxMonitorViewSampleRateHz,
  resolveTxStandbyPreviewTransport,
  shouldRequestTxLifecycleFrame,
  shouldClearMockTxPreviewRequestDedupe,
} from "@n-apt/app/routes/pages/spectrum/mockTxPreview";

describe("resolvePausedPreviewRequestSourceId", () => {
  it("targets selected Mock Tx instead of the active Rx source", () => {
    expect(
      resolvePausedPreviewRequestSourceId("mock-apt", "mock-tx"),
    ).toBe("mock-tx");
  });
});

describe("resolveSpectrumLimitMarkers", () => {
  it("uses the selected source markers instead of active RTL markers", () => {
    const rtlMarkers = [
      { kind: "rtl_limit", freq_hz: 24_000_000, label: "RTL" },
    ];
    const hackrfMarkers = [
      { kind: "hackrf_limit", freq_hz: 6_000_000_000, label: "HackRF" },
    ];

    expect(
      resolveSpectrumLimitMarkers({
        activeSourceMarkers: rtlMarkers,
        selectedSourceMarkers: hackrfMarkers,
      }),
    ).toBe(hackrfMarkers);
  });
});

describe("resolvePausedFrameFrequencyRange", () => {
  it("uses the selected paused RX frame axis instead of another device's shared range", () => {
    expect(
      resolvePausedFrameFrequencyRange({
        isPaused: true,
        isTxMode: false,
        frame: { min_hz: 24_000_000, max_hz: 27_200_000 },
        fallbackRange: { min: 1_000_000, max: 21_000_000 },
      }),
    ).toEqual({ min: 24_000_000, max: 27_200_000 });
  });

  it("uses the paused source's saved view when the frame has no axis metadata", () => {
    expect(
      resolvePausedFrameFrequencyRange({
        isPaused: true,
        isTxMode: false,
        frame: {},
        sourceViewRange: { min: 24_000_000, max: 27_200_000 },
        fallbackRange: { min: 1_000_000, max: 21_000_000 },
      }),
    ).toEqual({ min: 24_000_000, max: 27_200_000 });
  });

  it("does not replace the active TX axis with a cached RX frame", () => {
    expect(
      resolvePausedFrameFrequencyRange({
        isPaused: true,
        isTxMode: true,
        frame: { min_hz: 24_000_000, max_hz: 27_200_000 },
        fallbackRange: { min: 2_000_000, max: 3_000_000 },
      }),
    ).toBeNull();
  });
});

describe("shouldPublishFrequencyRangeForSource", () => {
  it("keeps Mock Tx monitor tuning local to its source", () => {
    expect(
      shouldPublishFrequencyRangeForSource({
        sourceMode: "live",
        isMockTxMonitorActive: true,
      }),
    ).toBe(false);
  });

  it("publishes receive-source tuning to the backend", () => {
    expect(
      shouldPublishFrequencyRangeForSource({
        sourceMode: "live",
        isMockTxMonitorActive: false,
      }),
    ).toBe(true);
  });
});

describe("getMockTxPreviewRequestKey", () => {
  it("changes when TX preview bandwidth changes", () => {
    const base = getMockTxPreviewRequestKey({
      sourceId: "mock-tx",
      centerFrequencyHz: 137_100_000,
      sampleRateHz: 2_400_000,
      signal: "apt",
      powerDbm: -18,
    });

    expect(
      getMockTxPreviewRequestKey({
        sourceId: "mock-tx",
        centerFrequencyHz: 137_100_000,
        sampleRateHz: 218_000,
        signal: "apt",
        powerDbm: -18,
      }),
    ).not.toBe(base);
  });
});

describe("shouldClearMockTxPreviewRequestDedupe", () => {
  it("retries when the cold-start handoff fence advances without a frame", () => {
    expect(
      shouldClearMockTxPreviewRequestDedupe({
        isMockTxMonitorActive: true,
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        hasRenderableFrame: false,
        lifecyclePhase: "warming-transport",
        transportPhase: "warming",
        previousFence: "mock-tx|mock-apt|awaiting-frame|idle",
      }),
    ).toBe(true);
  });

  it("keeps dedupe once a Mock Tx frame is renderable", () => {
    expect(
      shouldClearMockTxPreviewRequestDedupe({
        isMockTxMonitorActive: true,
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
        hasRenderableFrame: true,
        lifecyclePhase: "standby",
        transportPhase: "ready",
        previousFence: "mock-tx|mock-tx|awaiting-frame|warming",
      }),
    ).toBe(false);
  });

  it("does not clear for the same fence twice", () => {
    expect(
      shouldClearMockTxPreviewRequestDedupe({
        isMockTxMonitorActive: true,
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
        hasRenderableFrame: false,
        lifecyclePhase: "awaiting-frame",
        transportPhase: "ready",
        previousFence: "mock-tx|mock-tx|awaiting-frame|ready",
      }),
    ).toBe(false);
  });
});

describe("resolveTxStandbyPreviewTransport", () => {
  it("uses a one-shot request for a half-duplex hardware standby", () => {
    expect(
      resolveTxStandbyPreviewTransport({
        isSelectedTxPreviewStandby: true,
        isMockTxMonitorActive: false,
      }),
    ).toBe("one_shot");
  });
});

describe("shouldRequestTxLifecycleFrame", () => {
  it.each([
    ["standby", "transmitting"],
    ["paused", "transmitting"],
    ["transmitting", "standby"],
    ["transmitting", "paused"],
  ])("requests one frame when Tx changes from %s to %s", (previousStatus, nextStatus) => {
    expect(
      shouldRequestTxLifecycleFrame({ previousStatus, nextStatus }),
    ).toBe(true);
  });

  it.each([
    ["standby", "standby"],
    ["paused", "paused"],
    ["standby", "paused"],
    ["receiving", "transmitting"],
    ["transmitting", "receiving"],
  ])("does not request for non-Tx lifecycle changes %s to %s", (previousStatus, nextStatus) => {
    expect(
      shouldRequestTxLifecycleFrame({ previousStatus, nextStatus }),
    ).toBe(false);
  });
});

describe("resolveMockTxMonitorSampleRateForView", () => {
  it("keeps the Whole Channel view rate ahead of stale source metadata", () => {
    expect(
      resolveMockTxMonitorSampleRateForView(
        4_372_000,
        3_200_000,
        3_200_000,
        3_200_000,
      ),
    ).toBe(4_372_000);
  });
});

describe("resolveMockTxMonitorViewSampleRateHz", () => {
  it("keeps the selected Whole Channel viewer span over a stale viewport span", () => {
    expect(
      resolveMockTxMonitorViewSampleRateHz({
        viewerSampleRateHz: 4_372_000,
        fallbackSampleRateHz: 2_976_000,
      }),
    ).toBe(4_372_000);
  });
});

describe("resolveLiveDevicePlaceholderState", () => {
  it("dismisses a stale placeholder when current-source I/Q is already renderable", () => {
    // `stale` with a genuinely valid current-source frame is a live stream:
    // the placeholder is dismissed.
    expect(
      resolveLiveDevicePlaceholderState({
        deviceState: "stale",
        sourceLabel: "RTL-SDR v4",
        hasRenderableCurrentFrame: true,
      } as Parameters<typeof resolveLiveDevicePlaceholderState>[0] & {
        hasRenderableCurrentFrame: boolean;
      }),
    ).toBeNull();
  });

  it("keeps a loading placeholder even when a renderable frame exists", () => {
    // A device still opening has no veritable stream; a stale renderable
    // frame must not suppress the loading placeholder or the canvas can show
    // a blank/black area on a loading HackRF after Resume.
    expect(
      resolveLiveDevicePlaceholderState({
        deviceState: "loading",
        sourceLabel: "RTL-SDR v4",
        hasRenderableCurrentFrame: true,
      } as Parameters<typeof resolveLiveDevicePlaceholderState>[0] & {
        hasRenderableCurrentFrame: boolean;
      }),
    ).toMatchObject({ kind: "loading" });
  });

  it("keeps an explicit disconnect blocking even when a frame is buffered", () => {
    expect(
      resolveLiveDevicePlaceholderState({
        deviceState: "disconnected",
        sourceLabel: "RTL-SDR v4",
        hasRenderableCurrentFrame: true,
      } as Parameters<typeof resolveLiveDevicePlaceholderState>[0] & {
        hasRenderableCurrentFrame: boolean;
      }),
    ).toMatchObject({ kind: "disconnected" });
  });

  it("keeps an explicit device error blocking even when a frame is buffered", () => {
    expect(
      resolveLiveDevicePlaceholderState({
        deviceState: "error",
        sourceLabel: "RTL-SDR v4",
        hasRenderableCurrentFrame: true,
      }),
    ).toMatchObject({ kind: "error" });
  });

  it("promotes restart attempts into a loading placeholder message", () => {
    expect(
      resolveLiveDevicePlaceholderState({
        deviceState: "loading",
        sourceLabel: "RTL-SDR v4",
        loadingAttempt: 1,
        loadingAttemptMax: 2,
      }),
    ).toMatchObject({
      kind: "loading",
      sourceLabel: "RTL-SDR v4",
      paneLabel: "device",
      message: "Attempting to restart the device... (1/2)",
    });
  });

  it("uses a disconnected placeholder for a live device disconnect", () => {
    expect(
      resolveLiveDevicePlaceholderState({
        deviceState: "disconnected",
        sourceLabel: "RTL-SDR v4",
      }),
    ).toMatchObject({
      kind: "disconnected",
      sourceLabel: "RTL-SDR v4",
      message:
        "The device disconnected. The backend is retrying the connection.",
    });
  });
});
