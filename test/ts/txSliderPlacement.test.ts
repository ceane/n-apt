import {
  resolveMockTxPreviewViewCenterHz,
  resolveMockTxTransmitSettings,
  resolveTxPreviewCenterHz,
  resolveTxMonitorViewportCenterHz,
  resolveTxPreviewGeometry,
  resolveTxSliderCenterHz,
  shouldJumpTxMonitor,
  shouldSyncMockMonitorCenterFromRange,
} from "@n-apt/transmit/public/txSliderPlacement";

describe("resolveTxPreviewGeometry", () => {
  it("keeps the Tx IQ bandwidth fixed while the standby VFO moves", () => {
    expect(
      resolveTxPreviewGeometry({
        centerFrequencyHz: 5_336_000,
        sampleRateHz: 1_100_000,
        fixedSampleRateHz: 2_400_000,
      }),
    ).toEqual({
      centerFrequencyHz: 5_336_000,
      sampleRateHz: 2_400_000,
    });
  });
});

describe("resolveTxPreviewCenterHz", () => {
  it("uses the moving preview VFO without changing the fixed Tx center", () => {
    expect(
      resolveTxPreviewCenterHz({
        previewCenterHz: 5_336_000,
        txCenterHz: 2_204_000,
        isPreview: true,
      }),
    ).toBe(5_336_000);
  });
});

describe("shouldSyncMockMonitorCenterFromRange", () => {
  it("allows monitor sync from spectrum edge-pan while dragging", () => {
    expect(
      shouldSyncMockMonitorCenterFromRange({
        isMockTxMonitorActive: true,
        isDragging: true,
        isFixedTxPreview: true,
      }),
    ).toBe(true);
  });

  it("does not sync from range when the user is not dragging", () => {
    expect(
      shouldSyncMockMonitorCenterFromRange({
        isMockTxMonitorActive: true,
        isDragging: false,
        isFixedTxPreview: false,
      }),
    ).toBe(false);
  });
});

describe("shouldJumpTxMonitor", () => {
  it("jumps for typed entry and mode-enter", () => {
    expect(shouldJumpTxMonitor({ source: "typed" })).toBe(true);
    expect(shouldJumpTxMonitor({ source: "mode-enter" })).toBe(true);
  });

  it("does not jump for slider or user pan", () => {
    expect(shouldJumpTxMonitor({ source: "slider" })).toBe(false);
    expect(shouldJumpTxMonitor({ source: "user-pan" })).toBe(false);
  });
});

describe("resolveMockTxPreviewViewCenterHz", () => {
  it("keeps the first attached preview on the planned Tx center", () => {
    expect(
      resolveMockTxPreviewViewCenterHz({
        txCenterHz: 13_875_000,
        monitorCenterHz: 5_336_000,
        detached: false,
      }),
    ).toBe(13_875_000);
  });

  it("uses the user-panned monitor once detached", () => {
    expect(
      resolveMockTxPreviewViewCenterHz({
        txCenterHz: 13_875_000,
        monitorCenterHz: 5_336_000,
        detached: true,
      }),
    ).toBe(5_336_000);
  });

  it("ignores a stale null monitor on cold load while attached", () => {
    expect(
      resolveMockTxPreviewViewCenterHz({
        txCenterHz: 13_875_000,
        monitorCenterHz: null,
        detached: false,
      }),
    ).toBe(13_875_000);
  });
});

describe("resolveTxSliderCenterHz", () => {
  it("keeps the saved Tx center when it is outside the VFO viewport", () => {
    expect(
      resolveTxSliderCenterHz({
        centerHz: 24_977_000,
        fallbackCenterHz: 2_186_000,
        visibleMinHz: 0,
        visibleMaxHz: 4_372_000,
        sampleRateHz: 2_400_000,
      }),
    ).toBe(24_977_000);
  });

  it("keeps an in-range Tx center when its band fits in the viewport", () => {
    expect(
      resolveTxSliderCenterHz({
        centerHz: 2_000_000,
        fallbackCenterHz: 2_186_000,
        visibleMinHz: 0,
        visibleMaxHz: 4_372_000,
        sampleRateHz: 2_400_000,
      }),
    ).toBe(2_000_000);
  });

  it("keeps the Tx center when Tx bandwidth is wider than the VFO viewport", () => {
    expect(
      resolveTxSliderCenterHz({
        centerHz: 13_875_000,
        fallbackCenterHz: 2_364_185,
        visibleMinHz: 178_170,
        visibleMaxHz: 4_550_200,
        sampleRateHz: 18_250_000,
      }),
    ).toBe(13_875_000);
  });
});

describe("resolveTxMonitorViewportCenterHz", () => {
  it("keeps the VFO scrollable without changing the Tx center", () => {
    expect(
      resolveTxMonitorViewportCenterHz({
        vfoCenterHz: 5_336_000,
        txCenterHz: 2_204_000,
      }),
    ).toBe(5_336_000);
  });

  it("falls back to the Tx center when no VFO center exists", () => {
    expect(
      resolveTxMonitorViewportCenterHz({
        vfoCenterHz: null,
        txCenterHz: 2_204_000,
      }),
    ).toBe(2_204_000);
  });
});

describe("resolveMockTxTransmitSettings", () => {
  it("aligns the monitor to the carrier when alignMonitor is true", () => {
    expect(
      resolveMockTxTransmitSettings({
        txCenterHz: 13_875_000,
        viewCenterHz: 5_336_000,
        viewSampleRateHz: 3_200_000,
        txBandwidthHz: 1_000_000,
        alignMonitor: true,
      }),
    ).toEqual({
      centerFrequencyHz: 13_875_000,
      viewCenterHz: 13_875_000,
      sampleRateHz: 3_200_000,
      bandwidthHz: 1_000_000,
    });
  });

  it("keeps the user-panned monitor when alignMonitor is false", () => {
    expect(
      resolveMockTxTransmitSettings({
        txCenterHz: 13_875_000,
        viewCenterHz: 5_336_000,
        viewSampleRateHz: 3_200_000,
        txBandwidthHz: 1_000_000,
        alignMonitor: false,
      }),
    ).toEqual({
      centerFrequencyHz: 13_875_000,
      viewCenterHz: 5_336_000,
      sampleRateHz: 3_200_000,
      bandwidthHz: 1_000_000,
    });
  });

  it("falls back to Tx bandwidth when the monitor span is unknown", () => {
    expect(
      resolveMockTxTransmitSettings({
        txCenterHz: 13_875_000,
        viewCenterHz: null,
        viewSampleRateHz: null,
        txBandwidthHz: 1_000_000,
        alignMonitor: true,
      }),
    ).toEqual({
      centerFrequencyHz: 13_875_000,
      viewCenterHz: 13_875_000,
      sampleRateHz: 1_000_000,
      bandwidthHz: 1_000_000,
    });
  });
});
