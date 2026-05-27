import { loadPersistedSdrSettings } from "@n-apt/redux/middleware/localStorageMiddleware";

describe("loadPersistedSdrSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preserves persisted dBm ranges instead of flattening them to 0 dBm", () => {
    localStorage.setItem(
      "napt-sdr-settings-v2",
      JSON.stringify({
        fftMinDb: -100,
        fftMaxDb: 30,
        powerScale: "dBm",
        sampleRateHz: 5_200_000,
      }),
    );

    const parsed = loadPersistedSdrSettings();

    expect(parsed.fftMinDb).toBe(-100);
    expect(parsed.fftMaxDb).toBe(30);
    expect(parsed.powerScale).toBeUndefined();
    expect(parsed.sampleRateHz).toBeUndefined();
  });
});
