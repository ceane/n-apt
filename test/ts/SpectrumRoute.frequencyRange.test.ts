import {
  publishFrequencyRangeImmediately,
  resolveNavigationFrequencyBounds,
} from "@n-apt/app/routes/pages/SpectrumRoute";

describe("publishFrequencyRangeImmediately", () => {
  it("updates the local range and sends the tune in the same call", () => {
    const setFrequencyRange = jest.fn();
    const sendFrequencyRange = jest.fn();
    const range = { min: 100, max: 200 };

    publishFrequencyRangeImmediately(
      range,
      setFrequencyRange,
      sendFrequencyRange,
    );

    expect(setFrequencyRange).toHaveBeenCalledTimes(1);
    expect(setFrequencyRange).toHaveBeenCalledWith(range);
    expect(sendFrequencyRange).toHaveBeenCalledTimes(1);
    expect(sendFrequencyRange).toHaveBeenCalledWith(range);
    expect(setFrequencyRange.mock.invocationCallOrder[0]).toBeLessThan(
      sendFrequencyRange.mock.invocationCallOrder[0],
    );
  });
});

describe("resolveNavigationFrequencyBounds", () => {
  const channelBounds = { min: 18_000, max: 4_390_000 };
  const hardwareBounds = { min: 0, max: 30_000_000 };

  it("lets mirror-mode display navigation acquire beyond the active channel", () => {
    expect(
      resolveNavigationFrequencyBounds({
        mirrorEnabled: true,
        zoom: 1,
        channelBounds,
        hardwareBounds,
      }),
    ).toEqual(hardwareBounds);
  });

  it("retains the ordinary unzoomed channel clamp when mirroring is disabled", () => {
    expect(
      resolveNavigationFrequencyBounds({
        mirrorEnabled: false,
        zoom: 1,
        channelBounds,
        hardwareBounds,
      }),
    ).toEqual(channelBounds);
  });
});
