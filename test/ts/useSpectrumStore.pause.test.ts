import {
  buildPausedPreviewSignature,
  loadPersistedManualVisualizerPaused,
  persistManualVisualizerPaused,
  updateLocalSourcePauseOverride,
} from "@n-apt/features/spectrum/hooks/useSpectrumStore";

describe("paused preview signature", () => {
  const base = {
    frequencyRange: { min: 100_000_000, max: 103_200_000 },
    sampleRateHz: 3_200_000,
    fftSize: 2048,
    fftWindow: "Rectangular",
    vizZoom: 1,
    vizPanOffset: 0,
    txCenterFrequencyHz: 0,
    txSampleRateHz: 0,
    txPowerDbm: 0,
    txSignal: "",
    txIfftSize: 0,
  };

  it("changes when fftSize changes", () => {
    const before = buildPausedPreviewSignature(base);
    const after = buildPausedPreviewSignature({ ...base, fftSize: 4096 });
    expect(after).not.toBe(before);
    expect(buildPausedPreviewSignature({ ...base, fftSize: 2048 })).toBe(
      before,
    );
  });

  it("changes when fftWindow changes", () => {
    const before = buildPausedPreviewSignature(base);
    const after = buildPausedPreviewSignature({ ...base, fftWindow: "Blackman" });
    expect(after).not.toBe(before);
    expect(buildPausedPreviewSignature({ ...base, fftWindow: "Rectangular" })).toBe(
      before,
    );
  });
});

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
