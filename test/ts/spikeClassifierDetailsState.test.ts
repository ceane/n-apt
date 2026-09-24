import {
  SPIKE_CLASSIFIER_DETAILS_SESSION_KEY,
  readStoredClassifierOpen,
  writeStoredClassifierOpen,
} from "@n-apt/demodulation/react-flow/nodes/spikeClassifierDetailsState";

describe("spike classifier details state", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("starts collapsed when nothing was stored", () => {
    expect(readStoredClassifierOpen()).toBe(false);
  });

  it("restores the open panel a reload left behind", () => {
    writeStoredClassifierOpen(true);

    expect(readStoredClassifierOpen()).toBe(true);
    expect(
      window.sessionStorage.getItem(SPIKE_CLASSIFIER_DETAILS_SESSION_KEY),
    ).toBe("open");
  });

  it("records a collapse again", () => {
    writeStoredClassifierOpen(true);
    writeStoredClassifierOpen(false);

    expect(readStoredClassifierOpen()).toBe(false);
    expect(
      window.sessionStorage.getItem(SPIKE_CLASSIFIER_DETAILS_SESSION_KEY),
    ).toBe("closed");
  });

  it("falls back to collapsed when storage is unavailable", () => {
    const getItem = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage is blocked");
      });
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage is blocked");
      });

    try {
      expect(readStoredClassifierOpen()).toBe(false);
      expect(() => writeStoredClassifierOpen(true)).not.toThrow();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
