import { createDeviceOptionScheduler } from "@n-apt/app/infrastructure/streams/deviceOptionScheduler";

describe("device option scheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes the leading gesture value and coalesces intermediate values", () => {
    const publish = jest.fn();
    const scheduler = createDeviceOptionScheduler({ publish });

    scheduler.submit(1, "gesture");
    scheduler.submit(2, "gesture");
    scheduler.submit(3, "gesture");

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith(1);

    jest.advanceTimersByTime(49);
    expect(publish).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(3);
  });

  it("flushes the latest gesture value after wheel inactivity", () => {
    const publish = jest.fn();
    const scheduler = createDeviceOptionScheduler({
      publish,
      intervalMs: 200,
      idleFlushMs: 80,
    });

    scheduler.submit("start", "gesture");
    jest.advanceTimersByTime(10);
    scheduler.submit("latest", "gesture");

    jest.advanceTimersByTime(79);
    expect(publish).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith("latest");
  });

  it("flushes and cancels stale gesture state for an immediate update", () => {
    const publish = jest.fn();
    const scheduler = createDeviceOptionScheduler({ publish });

    scheduler.submit("gesture", "gesture");
    scheduler.submit("discrete", "immediate");
    jest.advanceTimersByTime(200);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(1, "gesture");
    expect(publish).toHaveBeenNthCalledWith(2, "discrete");
  });

  it("waits for cadence when leading publish is disabled", () => {
    const publish = jest.fn();
    const scheduler = createDeviceOptionScheduler({
      publish,
      leadingPublish: false,
    });

    scheduler.submit(1, "gesture");
    scheduler.submit(2, "gesture");

    expect(publish).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith(2);
  });

  it("does not republish an unchanged value", () => {
    const publish = jest.fn();
    const scheduler = createDeviceOptionScheduler({
      publish,
      equals: (left, right) => left.min === right.min && left.max === right.max,
    });

    scheduler.submit({ min: 0, max: 10 }, "gesture");
    scheduler.submit({ min: 0, max: 10 }, "gesture");
    jest.advanceTimersByTime(100);

    expect(publish).toHaveBeenCalledTimes(1);
  });
});
