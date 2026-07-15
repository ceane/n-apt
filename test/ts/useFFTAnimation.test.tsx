import { act, renderHook } from "@testing-library/react";
import { useFFTAnimation } from "../../src/ts/hooks/useFFTAnimation";

describe("useFFTAnimation", () => {
  let requestAnimationFrameMock: jest.SpyInstance;
  let cancelAnimationFrameMock: jest.SpyInstance;

  beforeEach(() => {
    let nextFrameId = 1;
    requestAnimationFrameMock = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => nextFrameId++);
    cancelAnimationFrameMock = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    requestAnimationFrameMock.mockRestore();
    cancelAnimationFrameMock.mockRestore();
  });

  it("uses the latest render callback without restarting the animation loop", () => {
    const firstRender = jest.fn();
    const latestRender = jest.fn();
    const { result, rerender, unmount } = renderHook(
      ({ onRenderFrame }) =>
        useFFTAnimation({
          isPaused: false,
          onRenderFrame,
          targetFPS: 60,
        }),
      { initialProps: { onRenderFrame: firstRender } },
    );

    expect(firstRender).toHaveBeenCalledTimes(1);
    const cancellationsBeforeRerender =
      cancelAnimationFrameMock.mock.calls.length;

    rerender({ onRenderFrame: latestRender });

    expect(cancelAnimationFrameMock).toHaveBeenCalledTimes(
      cancellationsBeforeRerender,
    );
    expect(latestRender).not.toHaveBeenCalled();

    act(() => result.current.forceRender());

    expect(latestRender).toHaveBeenCalledTimes(1);
    unmount();
  });
});
