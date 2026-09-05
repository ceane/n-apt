import { calculateVisibleFrequencyRange } from "@n-apt/demodulation/DemodRouteSection";

describe("demod route frequency presentation", () => {
  it("does not invent a default center before the spectrum store has a range", () => {
    expect(
      calculateVisibleFrequencyRange({
        activeSignalArea: "A",
        frequencyRange: null,
        lastKnownRanges: {},
        sampleRateHz: 1_600_000,
        vizZoom: 1,
        vizPanOffset: 0,
      }),
    ).toBeNull();
  });
});
