import { createSourceSwitchCoordinator } from "../../src/ts/hooks/sourceSwitchCoordinator";

describe("source switch coordinator", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("deduplicates pending requests and clears on confirmation", () => {
    jest.useFakeTimers();
    const requests: string[] = [];
    const timeouts: string[] = [];
    const coordinator = createSourceSwitchCoordinator({
      onRequest: (sourceId) => requests.push(sourceId),
      onTimeout: (sourceId) => timeouts.push(sourceId),
    });

    expect(coordinator.request("hackrf-1")).toBe(true);
    expect(coordinator.request("hackrf-1")).toBe(false);
    expect(requests).toEqual(["hackrf-1"]);

    expect(coordinator.confirm("hackrf-1")).toBe(true);
    jest.advanceTimersByTime(3_000);
    expect(timeouts).toEqual([]);
    coordinator.dispose();
  });

  test("reports a request timeout when confirmation does not arrive", () => {
    jest.useFakeTimers();
    const timeouts: string[] = [];
    const coordinator = createSourceSwitchCoordinator({
      onRequest: () => {},
      onTimeout: (sourceId) => timeouts.push(sourceId),
    });

    coordinator.request("rtl-0");
    jest.advanceTimersByTime(3_000);

    expect(timeouts).toEqual(["rtl-0"]);
    coordinator.dispose();
  });
});
