import {
  getMockTxPreviewRequestKey,
  resolveLiveDevicePlaceholderState,
} from "@n-apt/app/routes/pages/SpectrumRoute";
import {
  resolveMockTxMonitorSampleRateForView,
  shouldClearMockTxPreviewRequestDedupe,
} from "@n-apt/app/routes/pages/spectrum/mockTxPreview";

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

describe("resolveLiveDevicePlaceholderState", () => {
  it.each(["loading", "stale"])(
    "dismisses a %s placeholder when current-source I/Q is already renderable",
    (deviceState) => {
      expect(
        resolveLiveDevicePlaceholderState({
          deviceState,
          sourceLabel: "RTL-SDR v4",
          hasRenderableCurrentFrame: true,
        } as Parameters<typeof resolveLiveDevicePlaceholderState>[0] & {
          hasRenderableCurrentFrame: boolean;
        }),
      ).toBeNull();
    },
  );

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
