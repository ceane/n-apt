import {
  getSourceStorageIdentity,
  getSourceViewStorageKeyForSource,
  loadSelectedSourceId,
  saveSelectedSourceId,
  shouldSkipSelectedSourcePersistence,
  SOURCE_SELECTION_STORAGE_KEY,
} from "@n-apt/spectrum/utils/sourcePersistence";

describe("sourcePersistence", () => {
  it("uses backend stream_key before serial number for source-scoped visualizer state", () => {
    const source = {
      id: "rtl-sdr-0",
      serial_number: "DUPLICATE",
      stream_key: "rtl-sdr-0",
    };

    expect(getSourceStorageIdentity(source)).toBe("rtl-sdr-0");
    expect(getSourceViewStorageKeyForSource(source)).toBe(
      "napt-spectrum-view-v1:rtl-sdr-0",
    );
  });

  it("persists the selected device in tab-scoped session storage", () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    expect(loadSelectedSourceId()).toBeNull();

    saveSelectedSourceId("mock-tx");

    expect(window.sessionStorage.getItem(SOURCE_SELECTION_STORAGE_KEY)).toBe(
      "mock-tx",
    );
    expect(window.localStorage.getItem(SOURCE_SELECTION_STORAGE_KEY)).toBeNull();
    expect(loadSelectedSourceId()).toBe("mock-tx");
  });

  it("does not import another client's local selection", () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(SOURCE_SELECTION_STORAGE_KEY, "mock-tx");

    expect(loadSelectedSourceId()).toBeNull();
  });

  it("does not overwrite a stored selection with the first hydrated source", () => {
    expect(
      shouldSkipSelectedSourcePersistence({
        pendingHydrationSourceId: "mock-tx",
        currentSelectedSourceId: "mock-apt",
      }),
    ).toBe(true);
    expect(
      shouldSkipSelectedSourcePersistence({
        pendingHydrationSourceId: "mock-tx",
        currentSelectedSourceId: "mock-tx",
      }),
    ).toBe(false);
  });
});
