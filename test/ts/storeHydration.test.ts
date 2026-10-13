import { resolveStorePreloadedState } from "@n-apt/redux/storeHydration";

describe("Redux store hot-reload hydration", () => {
  it("keeps the current Redux snapshot over stale cold-start storage during HMR", () => {
    const coldStart = {
      spectrum: { frequencyRange: { min: 18_000, max: 3_218_000 } },
    };
    const hotReload = {
      spectrum: { frequencyRange: { min: 9_000_000, max: 12_200_000 } },
    };

    expect(resolveStorePreloadedState(coldStart, hotReload)).toBe(hotReload);
  });

  it("uses the cold-start state when no HMR snapshot exists", () => {
    const coldStart = { spectrum: { frequencyRange: null } };

    expect(resolveStorePreloadedState(coldStart, undefined)).toBe(coldStart);
  });
});
