import {
  loadPersistedManualVisualizerPaused,
  persistManualVisualizerPaused,
  updateLocalSourcePauseOverride,
} from "@n-apt/features/spectrum/hooks/useSpectrumStore";

describe("local source pause overrides", () => {
  it("keeps the same state object when the override is already applied", () => {
    const state = { "mock-apt": false };

    expect(updateLocalSourcePauseOverride(state, "mock-apt", false)).toBe(
      state,
    );
  });

  it("does not materialize a false override when none exists", () => {
    const state = {};

    expect(updateLocalSourcePauseOverride(state, "mock-apt", false)).toBe(
      state,
    );
  });

  it("returns a new state object when the override changes", () => {
    const state = { "mock-apt": true };

    expect(updateLocalSourcePauseOverride(state, "mock-apt", false)).toEqual({
      "mock-apt": false,
    });
  });

  it("keeps persisted pause scoped to the browser session instead of shared localStorage", () => {
    window.localStorage.setItem("napt-visualizer-manual-paused", "true");
    expect(loadPersistedManualVisualizerPaused()).toBeNull();

    persistManualVisualizerPaused(true);

    expect(window.sessionStorage.getItem("napt-visualizer-manual-paused")).toBe(
      "true",
    );
  });
});
