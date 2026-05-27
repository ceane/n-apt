import {
  resolveEffectiveLiveSampleRateHz,
  selectLiveSampleRateForSync,
} from "@n-apt/hooks/useSpectrumStore";

describe("selectLiveSampleRateForSync", () => {
  it("prefers the live websocket sample rate while connected", () => {
    expect(
      selectLiveSampleRateForSync({
        isConnected: true,
        websocketSampleRateHz: 20_000_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(20_000_000);
  });

  it("falls back to sdr settings when disconnected", () => {
    expect(
      selectLiveSampleRateForSync({
        isConnected: false,
        websocketSampleRateHz: 20_000_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(3_200_000);
  });

  it("uses the local user-selected sample rate over stale websocket and backend rates", () => {
    expect(
      resolveEffectiveLiveSampleRateHz({
        localSampleRateHz: 5_000_000,
        websocketSampleRateHz: 20_000_000,
        sdrSettingsSampleRateHz: 20_000_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(5_000_000);
  });

  it("falls back to websocket/backend rates when no local rate has been selected", () => {
    expect(
      resolveEffectiveLiveSampleRateHz({
        localSampleRateHz: null,
        websocketSampleRateHz: 20_000_000,
        sdrSettingsSampleRateHz: 3_200_000,
        maxSampleRateHz: 20_000_000,
      }),
    ).toBe(20_000_000);
  });
});
