import {
  getMockTxPreviewRequestKey,
  resolveLiveDevicePlaceholderState,
} from "../../src/ts/routes/SpectrumRoute";

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

describe("resolveLiveDevicePlaceholderState", () => {
  it.each(["loading", "loose", "stale"])(
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
