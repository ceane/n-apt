import { act, renderHook } from "@testing-library/react";
import { useVfoTuner } from "@n-apt/demodulation/react-flow/nodes/useVfoTuner";

jest.mock("@n-apt/redux", () => ({ useAppDispatch: () => jest.fn() }));

describe("VFO drag tuning cadence", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("coalesces continuous retunes and flushes the last position on release", () => {
    const tuneHardware = jest.fn();
    const { result } = renderHook(() => useVfoTuner({
      frequencyRange: { min: 1_000_000, max: 2_000_000 },
      allowNegativeFrequencies: false,
      zoomPanEnabled: true,
      retuneWhenUnzoomed: true,
      sessionKey: "source",
      vfoTestId: "vfo",
      tuneHardware,
    }));
    const currentTarget = {
      getBoundingClientRect: () => ({ width: 100 }),
      setPointerCapture: jest.fn(),
    };
    const event = (clientX: number) => ({ clientX, currentTarget, pointerId: 1, stopPropagation: jest.fn() }) as any;
    act(() => result.current.vfoHandlers.onPointerDown(event(50)));
    act(() => result.current.vfoHandlers.onPointerMove(event(49)));
    act(() => { jest.advanceTimersByTime(50); result.current.vfoHandlers.onPointerMove(event(48)); });
    act(() => { jest.advanceTimersByTime(50); result.current.vfoHandlers.onPointerMove(event(47)); });
    expect(tuneHardware).toHaveBeenCalledTimes(1);
    act(() => result.current.vfoHandlers.onPointerUp(event(47)));
    expect(tuneHardware).toHaveBeenCalledTimes(2);
    expect(tuneHardware).toHaveBeenLastCalledWith({ min: 1_030_000, max: 2_030_000 });
  });
});
