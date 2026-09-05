import {
  resolveEffectiveSdrSettingsForConnection,
  resolveCachedSdrSettings,
  shouldSyncSdrSettingsCache,
} from "@n-apt/spectrum/hooks/useSpectrumStore";

describe("shouldSyncSdrSettingsCache", () => {
  it("uses a non-reactive cached snapshot only while connected live settings are absent", () => {
    const cached = { sample_rate: 3_200_000 };
    const live = { sample_rate: 4_372_000 };

    expect(
      resolveEffectiveSdrSettingsForConnection({
        isConnected: true,
        liveSettings: live,
        cachedSettings: cached,
      }),
    ).toBe(live);
    expect(
      resolveEffectiveSdrSettingsForConnection({
        isConnected: true,
        liveSettings: null,
        cachedSettings: cached,
      }),
    ).toBe(cached);
    expect(
      resolveEffectiveSdrSettingsForConnection({
        isConnected: false,
        liveSettings: live,
        cachedSettings: cached,
      }),
    ).toBeNull();
  });

  it("does not request a Redux write when settings are unchanged", () => {
    expect(
      shouldSyncSdrSettingsCache(
        { sample_rate: 3_200_000, center_frequency: 137_100_000 },
        { sample_rate: 3_200_000, center_frequency: 137_100_000 },
      ),
    ).toBe(false);
  });

  it("keeps the cached settings reference when an equivalent backend object is recreated", () => {
    const cached = {
      sample_rate: 3_200_000,
      center_frequency: 137_100_000,
    };
    const recreated = { ...cached };

    expect(resolveCachedSdrSettings(cached, recreated)).toBe(cached);
  });

  it("treats recreated nested device settings as unchanged", () => {
    const cached = {
      sample_rate: 18_250_000,
      center_frequency: 27_235_000,
      sample_rate_options: [3_200_000, 18_250_000],
      gain: { lna: 16, vga: 20 },
    };
    const recreated = {
      ...cached,
      sample_rate_options: [...cached.sample_rate_options],
      gain: { ...cached.gain },
    };

    expect(shouldSyncSdrSettingsCache(cached, recreated)).toBe(false);
    expect(resolveCachedSdrSettings(cached as any, recreated as any)).toBe(
      cached,
    );
  });

});
