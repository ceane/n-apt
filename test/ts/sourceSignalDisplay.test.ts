import {
  resolveSourceDisplaySampleRate,
  resolveSourceDisplaySignalArea,
  resolveWholeChannelSampleRate,
} from "@n-apt/utils/sourceSignalDisplay";

const channels = [
  { label: "A", min_hz: 18_000, max_hz: 4_390_000 },
  { label: "C", min_hz: 4_750_000, max_hz: 23_000_000 },
];

describe("source signal display sample rates", () => {
  it("uses the live channel selection over stale Redux channel state", () => {
    expect(
      resolveSourceDisplaySignalArea({
        liveSignalArea: "C",
        reduxSignalArea: "A",
      }),
    ).toBe("C");
  });

  it("uses the live rate for the active bound source instead of stale settings", () => {
    expect(
      resolveSourceDisplaySampleRate({
        roleSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        liveSampleRateHz: 12_800_000,
        sourceSampleRateHz: 18_250_000,
        fallbackSampleRateHz: 3_200_000,
      }),
    ).toBe(12_800_000);
  });

  it("keeps a just-selected local rate ahead of a stale websocket rate", () => {
    expect(
      resolveSourceDisplaySampleRate({
        roleSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        localSampleRateHz: 4_000_000,
        liveSampleRateHz: 12_800_000,
        sourceSampleRateHz: 18_250_000,
        fallbackSampleRateHz: 3_200_000,
      }),
    ).toBe(4_000_000);
  });

  it("keeps an inactive role source's own rate", () => {
    expect(
      resolveSourceDisplaySampleRate({
        roleSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        liveSampleRateHz: 12_800_000,
        sourceSampleRateHz: 18_250_000,
        fallbackSampleRateHz: 3_200_000,
      }),
    ).toBe(18_250_000);
  });

  it("resolves the active Rx channel as Whole Channel", () => {
    expect(
      resolveWholeChannelSampleRate({
        source: { id: "mock-apt", kind: "mock_apt" },
        activeSignalArea: "A",
        channels,
      }),
    ).toBe(4_372_000);
  });

  it("resolves the selected channel for any source as Whole Channel", () => {
    expect(
      resolveWholeChannelSampleRate({
        source: {
          id: "arbitrary-tx-source",
          kind: "tx",
        },
        activeSignalArea: "C",
        channels,
      }),
    ).toBe(18_250_000);
  });
});
