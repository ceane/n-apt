import {
  DEFAULT_SETTINGS_DEFAULTS,
  getSettingsDefaults,
  setCaptureDefaults,
  setSettingsDefaults,
  setSnapshotDefaults,
} from "@n-apt/settings/public/settingsDefaults";

const STORAGE_KEY = "n-apt-settings-defaults-v1";

describe("settingsDefaults", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the default settings when nothing is persisted", () => {
    expect(getSettingsDefaults()).toEqual(DEFAULT_SETTINGS_DEFAULTS);
  });

  it("round-trips capture defaults", () => {
    setCaptureDefaults({
      captureDurationMode: "manual",
      captureDurationS: 5,
      captureFileType: ".wav",
    });

    const stored = getSettingsDefaults();
    expect(stored.capture.captureDurationMode).toBe("manual");
    expect(stored.capture.captureDurationS).toBe(5);
    expect(stored.capture.captureFileType).toBe(".wav");

    // Unchanged fields fall back to defaults
    expect(stored.capture.acquisitionMode).toBe("stepwise");
    expect(stored.capture.captureEncrypted).toBe(true);
  });

  it("round-trips snapshot defaults", () => {
    setSnapshotDefaults({
      fastSnapshotShowStats: true,
      snapshotFormat: "svg",
    });

    const stored = getSettingsDefaults();
    expect(stored.snapshot.fastSnapshotShowStats).toBe(true);
    expect(stored.snapshot.snapshotFormat).toBe("svg");

    expect(stored.snapshot.snapshotShowStats).toBe(true);
    expect(stored.snapshot.snapshotAspectRatio).toBe("default");
  });

  it("persists to localStorage under the settings key", () => {
    setSettingsDefaults({
      capture: { captureDurationS: 9 },
      snapshot: { snapshotWhole: true },
    });
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.capture.captureDurationS).toBe(9);
    expect(parsed.snapshot.snapshotWhole).toBe(true);
  });

  it("merges nested partials without clobbering the other group", () => {
    setCaptureDefaults({ captureDurationS: 3 });
    setSnapshotDefaults({ snapshotFormat: "animated-svg" });

    const stored = getSettingsDefaults();
    expect(stored.capture.captureDurationS).toBe(3);
    expect(stored.snapshot.snapshotFormat).toBe("animated-svg");
  });

  it("falls back to defaults when localStorage contains invalid JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(getSettingsDefaults()).toEqual(DEFAULT_SETTINGS_DEFAULTS);
  });
});
