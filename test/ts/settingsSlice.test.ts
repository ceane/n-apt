import settingsReducer, {
  setMirrorIqBasebandBelowZero,
} from "@n-apt/redux/slices/settingsSlice";
import waterfallReducer from "@n-apt/redux/slices/waterfallSlice";
import { setSnapshotGrid } from "@n-apt/redux";
import { loadPersistedSettings } from "@n-apt/redux/middleware/localStorageMiddleware";

describe("settings slice snapshot-grid ownership", () => {
  it("keeps the snapshot grid preference solely in the waterfall slice", () => {
    expect(setSnapshotGrid(false).type).toBe("waterfall/setSnapshotGrid");
    expect(
      waterfallReducer(undefined, setSnapshotGrid(false)).snapshotGridPreference,
    ).toBe(false);
    const state = settingsReducer(undefined, { type: "@@INIT" });
    expect("snapshotGridPreference" in state).toBe(false);
  });
});

describe("settings slice diagnostic-state ownership", () => {
  it("keeps diagnostic state solely in the spectrum slice", () => {
    const state = settingsReducer(undefined, { type: "@@INIT" });
    expect(Object.keys(state).sort()).toEqual([
      "deviceName",
      "deviceProfile",
      "mirrorIqBasebandBelowZero",
    ]);
    for (const type of [
      "spectrum/setDiagnosticStatus",
      "spectrum/setDiagnosticRunning",
      "spectrum/triggerDiagnostic",
    ]) {
      expect(settingsReducer(state, { type } as any)).toBe(state);
    }
  });
});

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
