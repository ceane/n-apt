import { mergePersistedSdrSettings } from "@n-apt/redux/middleware/localStorageMiddleware";

describe("mergePersistedSdrSettings", () => {
  it("keeps reducer defaults when persisted settings are partial", () => {
    const defaults = { fftSize: 65_536, txHopChannels: ["a"] };

    expect(mergePersistedSdrSettings(defaults, { fftSize: 4096 })).toEqual({
      fftSize: 4096,
      txHopChannels: ["a"],
    });
  });
});
