import {
  resolveTxMonitorViewportCenterHz,
  resolveTxSliderCenterHz,
} from "../../src/ts/utils/txSliderPlacement";

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
