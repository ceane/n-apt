import { shouldSyncSdrSettingsCache } from "@n-apt/spectrum/hooks/useSpectrumStore";

describe("shouldSyncSdrSettingsCache", () => {
  it("does not request a Redux write when settings are unchanged", () => {
    expect(
      shouldSyncSdrSettingsCache(
        { sample_rate: 3_200_000, center_frequency: 137_100_000 },
        { sample_rate: 3_200_000, center_frequency: 137_100_000 },
      ),
    ).toBe(false);
  });
});
