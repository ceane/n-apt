import spectrumReducer from "@n-apt/redux/slices/spectrumSlice";
import {
  resolveMockTxMonitorFrequencyRange,
  resolveSourceViewPanRange,
} from "@n-apt/app/routes/pages/spectrum/mockTxPreview";

describe("source-scoped monitor frequency ranges", () => {
  it("stores a Mock Tx monitor range without changing shared acquisition range", () => {
    const previousRange = { min: 136_000_000, max: 138_000_000 };
    const monitorRange = { min: 135_000_000, max: 139_000_000 };
    const state = spectrumReducer(undefined, {
      type: "spectrum/setSourceViewFrequencyRange",
      payload: { sourceId: "mock-tx", range: monitorRange },
    } as any);

    const next = spectrumReducer(
      { ...state, frequencyRange: previousRange },
      {
        type: "spectrum/setSourceViewFrequencyRange",
        payload: { sourceId: "mock-tx", range: monitorRange },
      } as any,
    );

    expect(next.frequencyRange).toEqual(previousRange);
    expect(next.sourceViewFrequencyRanges["mock-tx"]).toEqual(monitorRange);
  });

  it("keeps Tx IQ, Tx monitor, and another source centers independent", () => {
    const txIqCenterHz = 137_100_000;
    const monitorRange = { min: 138_000_000, max: 142_000_000 };
    const otherSourceRange = { min: 433_000_000, max: 435_000_000 };
    const state = spectrumReducer(undefined, {
      type: "spectrum/setSourceViewFrequencyRange",
      payload: { sourceId: "mock-tx", range: monitorRange },
    } as any);
    const next = spectrumReducer(state, {
      type: "spectrum/setSourceViewFrequencyRange",
      payload: { sourceId: "hackrf-one", range: otherSourceRange },
    } as any);

    const monitor = resolveMockTxMonitorFrequencyRange({
      sourceViewRange: next.sourceViewFrequencyRanges["mock-tx"],
      txCenterFrequencyHz: txIqCenterHz,
      fallbackCenterFrequencyHz: 100_000_000,
      sampleRateHz: 4_000_000,
    });

    expect(monitor).toEqual({ min: 138_000_000, max: 142_000_000 });
    expect((monitor!.min + monitor!.max) / 2).not.toBe(txIqCenterHz);
    expect(
      (next.sourceViewFrequencyRanges["hackrf-one"].min +
        next.sourceViewFrequencyRanges["hackrf-one"].max) /
        2,
    ).toBe(434_000_000);
  });

  it("pans the Tx monitor from its source-local range", () => {
    const txViewRange = { min: 135_000_000, max: 139_000_000 };

    expect(resolveSourceViewPanRange(txViewRange, 500_000)).toEqual({
      min: 135_500_000,
      max: 139_500_000,
    });
  });
});
