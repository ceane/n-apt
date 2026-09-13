import {
  createProgressiveTuningController,
  resolveTuningCenterFrequency,
  resolveTuneProgress,
  resolveTuningRange,
  type ProgressiveTuningController,
} from "@n-apt/spectrum/tuning/progressiveTuning";

describe("progressive tuning", () => {
  it("resolves the supported easing modes with exact endpoints", () => {
    expect(resolveTuneProgress(0, "ease-out")).toBe(0);
    expect(resolveTuneProgress(1, "ease-out")).toBe(1);
    expect(resolveTuneProgress(0.5, "linear")).toBe(0.5);
    expect(resolveTuneProgress(0.5, "ease-in")).toBeCloseTo(0.25);
    expect(resolveTuneProgress(0.5, "ease-out")).toBeCloseTo(0.75);
    expect(resolveTuneProgress(0.5, "ease-in-out")).toBeCloseTo(0.5);
    expect(
      resolveTuneProgress(0.5, {
        type: "cubic-bezier",
        points: [0.25, 0.1, 0.25, 1],
      }),
    ).toBeGreaterThan(0.5);
    expect(
      resolveTuneProgress(0.5, { type: "sine", mode: "in-out" }),
    ).toBeCloseTo(0.5);
  });

  it("supports custom easing without allowing invalid progress", () => {
    expect(resolveTuneProgress(-1, (progress) => progress * 2)).toBe(0);
    expect(resolveTuneProgress(2, (progress) => progress * 2)).toBe(1);
    expect(resolveTuneProgress(0.25, () => 0.75)).toBeCloseTo(0.75);
  });

  it("preserves the requested bandwidth and clamps the trajectory to bounds", () => {
    expect(
      resolveTuningRange(
        150,
        { min: 100, max: 200 },
        { min: 0, max: 240 },
      ),
    ).toEqual({ min: 100, max: 200 });
    expect(
      resolveTuningRange(
        230,
        { min: 100, max: 200 },
        { min: 0, max: 240 },
      ),
    ).toEqual({ min: 140, max: 240 });
    expect(
      resolveTuningRange(
        10,
        { min: 100, max: 200 },
        { min: 0, max: 240 },
      ),
    ).toEqual({ min: 0, max: 100 });
  });

  it("returns exact endpoints and a damped wiggle in between", () => {
    const startCenter = resolveTuningCenterFrequency({
      fromCenterFrequencyHz: 100,
      toCenterFrequencyHz: 200,
      progress: 0,
      wiggle: { amplitudeHz: 25 },
    });
    const midCenter = resolveTuningCenterFrequency({
      fromCenterFrequencyHz: 100,
      toCenterFrequencyHz: 200,
      progress: 0.375,
      inertia: "linear",
      wiggle: { amplitudeHz: 25, cycles: 1, damping: 0 },
    });
    const endCenter = resolveTuningCenterFrequency({
      fromCenterFrequencyHz: 100,
      toCenterFrequencyHz: 200,
      progress: 1,
      wiggle: { amplitudeHz: 25 },
    });
    expect(startCenter).toBe(100);
    expect(midCenter).not.toBeCloseTo(137.5);
    expect(endCenter).toBe(200);

    const start = resolveTuningRange(150.4, { min: 100, max: 200 });
    const end = resolveTuningRange(250.6, { min: 200, max: 300 });
    const midpoint = resolveTuningRange(200.5, { min: 150, max: 250 });
    expect(start.min).toBe(Math.round(start.min));
    expect(end.max).toBe(Math.round(end.max));
    expect(midpoint.max - midpoint.min).toBe(100);
  });

  it("publishes every preview frame, rate-limits retunes, and converges exactly", () => {
    let nextFrameId = 0;
    let scheduled: ((timestamp: number) => void) | null = null;
    const previews: Array<{ min: number; max: number }> = [];
    const retunes: Array<{ min: number; max: number }> = [];
    const completed: Array<{ min: number; max: number }> = [];
    const controller: ProgressiveTuningController =
      createProgressiveTuningController({
        now: () => 0,
        requestFrame: (callback) => {
          scheduled = callback;
          return ++nextFrameId;
        },
        cancelFrame: () => {
          scheduled = null;
        },
        onPreview: (range) => previews.push(range),
        onRetune: (range) => retunes.push(range),
        onComplete: (range) => completed.push(range),
      });

    controller.start(
      { min: 100, max: 200 },
      { min: 500, max: 600 },
      { durationMs: 100, retuneIntervalMs: 50, inertia: "linear" },
    );
    const runScheduled = (timestamp: number) => {
      const callback = scheduled;
      callback?.(timestamp);
    };
    runScheduled(0);
    runScheduled(25);
    runScheduled(50);
    runScheduled(100);

    expect(previews.length).toBe(4);
    expect(retunes.length).toBe(3);
    expect(completed).toEqual([{ min: 500, max: 600 }]);
    expect(retunes[retunes.length - 1]).toEqual({ min: 500, max: 600 });
    expect(controller.isActive()).toBe(false);
  });

  it("cancels an older trajectory when a newer tune starts", () => {
    let scheduled: ((timestamp: number) => void) | null = null;
    const completed: Array<{ min: number; max: number }> = [];
    const controller = createProgressiveTuningController({
      now: () => 0,
      requestFrame: (callback) => {
        scheduled = callback;
        return 1;
      },
      cancelFrame: () => {
        scheduled = null;
      },
      onPreview: () => undefined,
      onRetune: () => undefined,
      onComplete: (range) => completed.push(range),
    });

    controller.start(
      { min: 0, max: 100 },
      { min: 100, max: 200 },
      { durationMs: 100 },
    );
    const firstFrame = scheduled as unknown as (timestamp: number) => void;
    controller.start(
      { min: 0, max: 100 },
      { min: 300, max: 400 },
      { durationMs: 100 },
    );
    firstFrame?.(100);
    const latestFrame = scheduled as unknown as (timestamp: number) => void;
    latestFrame(100);

    expect(completed).toEqual([{ min: 300, max: 400 }]);
  });
});
