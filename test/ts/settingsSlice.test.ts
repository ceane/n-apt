import settingsReducer, {
  setMirrorIqBasebandBelowZero,
} from "@n-apt/redux/slices/settingsSlice";
import { loadPersistedSettings } from "@n-apt/redux/middleware/localStorageMiddleware";

describe("settings slice VFO clamp preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to keeping the 0 Hz clamp enabled", () => {
    expect(settingsReducer(undefined, { type: "@@INIT" }).mirrorIqBasebandBelowZero).toBe(
      false,
    );
  });

  it("stores the explicit baseband mirroring choice", () => {
    expect(
      settingsReducer(
        undefined,
        setMirrorIqBasebandBelowZero(true),
      ).mirrorIqBasebandBelowZero,
    ).toBe(true);
  });

  it("loads the persisted choice without changing the default when absent", () => {
    expect(loadPersistedSettings()).toEqual({});
    window.localStorage.setItem(
      "napt-settings-v1",
      JSON.stringify({ mirrorIqBasebandBelowZero: true }),
    );
    expect(loadPersistedSettings()).toEqual({
      mirrorIqBasebandBelowZero: true,
    });
  });
});
