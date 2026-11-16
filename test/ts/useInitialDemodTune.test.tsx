import { renderHook } from "@testing-library/react";
import { useInitialDemodTune } from "@n-apt/demodulation/context/useInitialDemodTune";

describe("initial demod tuning", () => {
  const channels = [{ label: "A", min_hz: 18_000, max_hz: 4_390_000 }];
  const initialRange = { min: 18_000, max: 3_218_000 };

  it("initializes Channel A once and does not retune over later VFO movement", () => {
    const onTune = jest.fn();
    const { rerender } = renderHook(
      ({ range }) => useInitialDemodTune({
        isConnected: true,
        activeSourceId: "mock-apt",
        sourceMode: "live",
        channels,
        sampleRateHz: 3_200_000,
        activeSignalArea: "A",
        frequencyRange: range,
        onTune,
      }),
      { initialProps: { range: initialRange } },
    );
    expect(onTune).not.toHaveBeenCalled();
    rerender({ range: { min: 2_000_000, max: 5_200_000 } });
    rerender({ range: { min: 2_100_000, max: 5_300_000 } });
    expect(onTune).not.toHaveBeenCalled();
  });

  it("waits for a live source and sends the startup tune only once", () => {
    const onTune = jest.fn();
    const { rerender } = renderHook(
      ({ isConnected }) => useInitialDemodTune({
        isConnected,
        activeSourceId: "mock-apt",
        sourceMode: "live",
        channels,
        sampleRateHz: 3_200_000,
        activeSignalArea: "A",
        frequencyRange: { min: 0, max: 3_200_000 },
        onTune,
      }),
      { initialProps: { isConnected: false } },
    );
    expect(onTune).not.toHaveBeenCalled();
    rerender({ isConnected: true });
    expect(onTune).toHaveBeenCalledTimes(1);
    expect(onTune).toHaveBeenCalledWith({ channelLabel: "A", range: initialRange });
    rerender({ isConnected: true });
    expect(onTune).toHaveBeenCalledTimes(1);
  });
});
