import {
  buildManagedTxOptions,
  managedTxFrameMatchesOptions,
  resolveManagedTxSubscriberPause,
  shouldReconcileAfterStaleManagedSubscription,
  shouldRejectManagedTxFrameForPreview,
  shouldPublishManagedTxTransportReady,
} from
  "@n-apt/redux/middleware/websocketMiddleware";

describe("managed Tx subscription pause state", () => {
  const txFrame = (centerFrequencyHz: number, sampleRate: number) => ({
    type: "spectrum" as const,
    data_type: "iq_raw" as const,
    source_id: "mock-tx",
    protocol_version: 2 as const,
    stream_epoch: 1,
    sequence: 1,
    center_frequency_hz: centerFrequencyHz,
    sample_rate: sampleRate,
    iq_data: new Uint8Array([128, 129]),
  });

  it("keeps the Tx carrier separate from the monitor viewport", () => {
    const options = buildManagedTxOptions({
      spectrum: {
        txCenterFrequencyHz: 137_100_000,
        txSampleRateHz: 1_200_000,
        txViewerSampleRateHz: 4_372_000,
        frequencyRange: { min: 136_100_000, max: 138_100_000 },
        txSignal: "wifi",
        txPowerDbm: -18,
        txIfftSize: 2048,
      },
    });

    expect(options).toMatchObject({
      centerFrequencyHz: 137_100_000,
      sampleRateHz: 1_200_000,
      bandwidthHz: 1_200_000,
      viewCenterHz: 137_100_000,
      viewSampleRateHz: 4_372_000,
    });
    expect(
      managedTxFrameMatchesOptions(
        txFrame(137_100_000, 4_372_000),
        options,
      ),
    ).toBe(true);
  });

  it("does not retune the Tx monitor when the independent Rx viewport changes", () => {
    const baseState = {
      spectrum: {
        txCenterFrequencyHz: 137_100_000,
        txSampleRateHz: 1_200_000,
        txViewerSampleRateHz: 2_400_000,
        txSignal: "wifi",
        txPowerDbm: -18,
        txIfftSize: 2048,
      },
    };

    const first = buildManagedTxOptions({
      ...baseState,
      spectrum: {
        ...baseState.spectrum,
        frequencyRange: { min: 136_100_000, max: 138_100_000 },
      },
    });
    const afterRxRetune = buildManagedTxOptions({
      ...baseState,
      spectrum: {
        ...baseState.spectrum,
        frequencyRange: { min: 135_500_000, max: 138_700_000 },
      },
    });

    expect(afterRxRetune.viewCenterHz).toBe(first.viewCenterHz);
    expect(afterRxRetune.viewSampleRateHz).toBe(first.viewSampleRateHz);
  });

  it("serializes Tx spectrum geometry as whole-Hz values accepted by the stream protocol", () => {
    const options = buildManagedTxOptions({
      spectrum: {
        txCenterFrequencyHz: 136_964_700.4,
        txSampleRateHz: 896_491.6396632316,
        frequencyRange: {
          min: 135_764_700.2,
          max: 138_164_700.2,
        },
        txSignal: "wifi",
        txPowerDbm: -18,
        txIfftSize: 2048,
      },
    });

    expect(options).toMatchObject({
      centerFrequencyHz: 136_964_700,
      sampleRateHz: 896_492,
      bandwidthHz: 896_492,
      viewCenterHz: 136_964_700,
      viewSampleRateHz: 896_492,
    });
  });

  it("rejects an in-flight startup preview with stale geometry", () => {
    const options = {
      mode: "tx" as const,
      centerFrequencyHz: 13_453_022,
      sampleRateHz: 18_250_000,
      bandwidthHz: 7_300_000,
      signal: "tone",
      powerDbm: -18,
      ifftSize: 2048,
    };

    expect(
      managedTxFrameMatchesOptions(
        txFrame(1_600_000, 4_372_000),
        options,
      ),
    ).toBe(false);
    expect(
      managedTxFrameMatchesOptions(
        txFrame(options.centerFrequencyHz, options.sampleRateHz),
        options,
      ),
    ).toBe(true);
  });

  it("does not reject a live Tx frame when the monitor view differs from the carrier", () => {
    const options = {
      mode: "tx" as const,
      centerFrequencyHz: 13_453_022,
      sampleRateHz: 18_250_000,
      bandwidthHz: 7_300_000,
      signal: "tone",
      powerDbm: -18,
      ifftSize: 2048,
    };
    const mismatchedLiveFrame = {
      ...txFrame(1_600_000, 4_372_000),
      frame_status: "transmitting" as const,
    };
    const mismatchedPreviewFrame = txFrame(1_600_000, 4_372_000);

    expect(
      shouldRejectManagedTxFrameForPreview({
        frame: mismatchedPreviewFrame,
        sourceStatus: "standby",
        previewOptions: options,
      }),
    ).toBe(true);
    expect(
      shouldRejectManagedTxFrameForPreview({
        frame: mismatchedLiveFrame,
        sourceStatus: "standby",
        previewOptions: options,
      }),
    ).toBe(false);
  });

  it("reconciles when a subscription opens for a source that is no longer wanted", () => {
    expect(
      shouldReconcileAfterStaleManagedSubscription({
        openedSourceId: "mock-apt",
        desiredSourceId: "mock-tx",
      }),
    ).toBe(true);
    expect(
      shouldReconcileAfterStaleManagedSubscription({
        openedSourceId: "mock-tx",
        desiredSourceId: "mock-tx",
      }),
    ).toBe(false);
  });

  it("always delivers frames while the Tx source is transmitting", () => {
    expect(resolveManagedTxSubscriberPause("transmitting", true)).toBe(false);
    expect(resolveManagedTxSubscriberPause("transmitting", undefined)).toBe(
      false,
    );
  });

  it("never applies a client-local pause to global Tx delivery", () => {
    expect(resolveManagedTxSubscriberPause("standby", true)).toBe(false);
    expect(resolveManagedTxSubscriberPause("standby", undefined)).toBe(false);
  });

  it("marks a bound Mock Tx stream ready even while Mock APT owns RX", () => {
    expect(
      shouldPublishManagedTxTransportReady({
        isCurrentTxTarget: true,
        streamEpoch: 4,
      }),
    ).toBe(true);
    expect(
      shouldPublishManagedTxTransportReady({
        isCurrentTxTarget: true,
        streamEpoch: 0,
      }),
    ).toBe(false);
  });
});
