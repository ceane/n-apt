import { act, renderHook } from "@testing-library/react";
import { useFFTAnimation } from "@n-apt/spectrum/hooks/useFFTAnimation";

/**
 * rAF mock that actually fires callbacks via setTimeout so the loop can be
 * driven tick-by-tick (the default spy in these tests just records ids).
 * Each fired frame advances the clock by `frameMs` so the hook's frame-rate
 * limiter is satisfied on the re-arm.
 */
const installDrivableRaf = (frameMs = 1000 / 60) => {
  let frameId = 1;
  let frameTime = performance.now();
  const pendingFrames = new Map<number, FrameRequestCallback>();
  // The hook reads performance.now() inside animate(), not the rAF timestamp,
  // so the mock must advance the real clock for the frame limiter to fire.
  const nowSpy = jest
    .spyOn(performance, "now")
    .mockImplementation(() => frameTime);
  const raf = jest
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb) => {
      const id = frameId++;
      pendingFrames.set(id, cb);
      return id;
    });
  const caf = jest
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((id) => {
      pendingFrames.delete(id);
    });
  const fireNext = () => {
    const next = pendingFrames.entries().next().value;
    if (!next) return;
    pendingFrames.delete(next[0]);
    frameTime += frameMs;
    next[1](frameTime);
  };
  const fireAll = () => {
    // Fire every frame scheduled so far, but never more than a bounded number
    // per call: a re-arming loop (like the one under test) schedules a fresh
    // frame inside each callback, so an unbounded drain would spin forever.
    let guard = 0;
    while (pendingFrames.size > 0 && guard < 64) {
      fireNext();
      guard += 1;
    }
  };
  return {
    raf,
    caf,
    nowSpy,
    pendingFrames,
    fireNext,
    fireAll,
  };
};

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
    jest.restoreAllMocks();
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

  it("re-arms the rAF loop when a render callback throws, logging once per burst", () => {
    const { raf, caf, pendingFrames, fireNext } = installDrivableRaf();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    const render = jest.fn(() => {
      throw error;
    });

    const { unmount } = renderHook(() =>
      useFFTAnimation({
        isPaused: false,
        onRenderFrame: render,
        targetFPS: 60,
      }),
    );

    // First frame: the callback throws, but the loop must keep running.
    act(() => {
      fireNext();
    });
    expect(render).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("FFT render frame failed:", error);
    // The loop re-armed instead of being cancelled and abandoned.
    expect(pendingFrames.size).toBeGreaterThan(0);

    // A second frame that throws again logs only once (burst dedupe).
    act(() => {
      fireNext();
    });
    expect(render).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // The loop is still alive and scheduling frames.
    expect(pendingFrames.size).toBeGreaterThan(0);
    expect(caf).not.toHaveBeenCalled();

    unmount();
  });

  it("keeps the rAF loop alive when every frame throws", () => {
    const { pendingFrames, fireAll } = installDrivableRaf();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const render = jest.fn(() => {
      throw new Error("per-frame failure");
    });

    const { unmount } = renderHook(() =>
      useFFTAnimation({
        isPaused: false,
        onRenderFrame: render,
        targetFPS: 60,
      }),
    );

    for (let tick = 0; tick < 10; tick += 1) {
      act(() => {
        fireAll();
      });
    }

    // 10 ticks each invoked the render callback (initial + re-arms), and the
    // loop never stopped scheduling frames.
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(11);
    expect(pendingFrames.size).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    unmount();
  });
});
