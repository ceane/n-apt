import {
  createLiveFrequencyRangePublisher,
  publishSubscriberLocalVizPan,
  publishLiveFrequencyRange,
  publishFrequencyRangeImmediately,
  resolveNavigationFrequencyBounds,
} from "@n-apt/app/routes/pages/SpectrumRoute";

describe("subscriber-local visual pan", () => {
  it("updates only the local visualizer state", () => {
    const setVizPanOffset = jest.fn();

    publishSubscriberLocalVizPan(-4, setVizPanOffset);

    expect(setVizPanOffset).toHaveBeenCalledTimes(1);
    expect(setVizPanOffset).toHaveBeenCalledWith(-4);
  });
});

describe("createLiveFrequencyRangePublisher", () => {
  it("publishes a leading pan and throttles the latest value to 20Hz", () => {
    jest.useFakeTimers();
    const setFrequencyRange = jest.fn();
    const sendFrequencyRange = jest.fn();
    try {
      const publisher = createLiveFrequencyRangePublisher(
        setFrequencyRange,
        sendFrequencyRange,
      );
      const firstRange = { min: 100, max: 200 };
      const latestRange = { min: 300, max: 400 };

      publisher.publish(firstRange);
      publisher.publish(latestRange);

      expect(setFrequencyRange).toHaveBeenCalledTimes(1);
      expect(setFrequencyRange).toHaveBeenCalledWith(firstRange);
      expect(sendFrequencyRange).toHaveBeenCalledTimes(1);
      expect(sendFrequencyRange).toHaveBeenCalledWith(firstRange);

      jest.advanceTimersByTime(50);

      expect(setFrequencyRange).toHaveBeenCalledTimes(2);
      expect(setFrequencyRange).toHaveBeenLastCalledWith(latestRange);
      expect(sendFrequencyRange).toHaveBeenCalledTimes(2);
      expect(sendFrequencyRange).toHaveBeenLastCalledWith(latestRange);
    } finally {
      jest.useRealTimers();
    }
  });

  it("remains usable after lifecycle cleanup cancels pending work", () => {
    jest.useFakeTimers();
    const setFrequencyRange = jest.fn();
    const sendFrequencyRange = jest.fn();
    try {
      const publisher = createLiveFrequencyRangePublisher(
        setFrequencyRange,
        sendFrequencyRange,
      );
      const firstRange = { min: 100, max: 200 };
      const rangeAfterCleanup = { min: 300, max: 400 };

      publisher.publish(firstRange);
      publisher.cancel();
      publisher.publish(rangeAfterCleanup);
      jest.advanceTimersByTime(50);

      expect(setFrequencyRange).toHaveBeenLastCalledWith(rangeAfterCleanup);
      expect(sendFrequencyRange).toHaveBeenLastCalledWith(rangeAfterCleanup);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("publishLiveFrequencyRange", () => {
  it("publishes a pan range even when the previous scheduler lifecycle ended", () => {
    const setFrequencyRange = jest.fn();
    const sendFrequencyRange = jest.fn();
    const range = { min: 8_185_000, max: 12_557_000 };

    publishLiveFrequencyRange(range, setFrequencyRange, sendFrequencyRange);

    expect(setFrequencyRange).toHaveBeenCalledWith(range);
    expect(sendFrequencyRange).toHaveBeenCalledWith(range);
    expect(setFrequencyRange.mock.invocationCallOrder[0]).toBeLessThan(
      sendFrequencyRange.mock.invocationCallOrder[0],
    );
  });
});

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
