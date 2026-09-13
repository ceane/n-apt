import {
  shouldSkipDeviceFrequencyRangeEcho,
  resolveSourceFrequencyRangeSync,
  type FrequencyRange,
} from "@n-apt/spectrum/utils/sourceFrequencySync";

const channelARange: FrequencyRange = { min: 18_000, max: 4_390_000 };
const mockAptRange: FrequencyRange = { min: 134_914_000, max: 139_286_000 };

describe("resolveSourceFrequencyRangeSync", () => {
  it("skips re-sending a newer device-hydrated range", () => {
    expect(
      shouldSkipDeviceFrequencyRangeEcho({
        deviceRangeRevision: 4,
        lastHandledDeviceRangeRevision: 3,
      }),
    ).toBe(true);
    expect(
      shouldSkipDeviceFrequencyRangeEcho({
        deviceRangeRevision: 4,
        lastHandledDeviceRangeRevision: 4,
      }),
    ).toBe(false);
  });

  it("never forwards Mock Tx's backing display range to the receiver", () => {
    expect(
      resolveSourceFrequencyRangeSync({
        connected: true,
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
        previousActiveSourceId: "mock-apt",
        activeSourceIsMockTx: true,
        frequencyRange: channelARange,
        lastSentFrequencyRange: mockAptRange,
        isRestoringSourceView: false,
      }),
    ).toEqual({
      clearLastSentFrequencyRange: true,
      nextActiveSourceId: "mock-tx",
      rangeToSend: null,
    });
  });

  it("waits for the returning source view before retuning it", () => {
    const firstRender = resolveSourceFrequencyRangeSync({
      connected: true,
      selectedSourceId: "mock-apt",
      activeSourceId: "mock-apt",
      previousActiveSourceId: "mock-tx",
      activeSourceIsMockTx: false,
      frequencyRange: channelARange,
      lastSentFrequencyRange: channelARange,
      isRestoringSourceView: true,
    });

    expect(firstRender).toEqual({
      clearLastSentFrequencyRange: true,
      nextActiveSourceId: "mock-apt",
      rangeToSend: null,
    });

    expect(
      resolveSourceFrequencyRangeSync({
        connected: true,
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        previousActiveSourceId: firstRender.nextActiveSourceId,
        activeSourceIsMockTx: false,
        frequencyRange: mockAptRange,
        lastSentFrequencyRange: null,
        isRestoringSourceView: false,
      }),
    ).toEqual({
      clearLastSentFrequencyRange: false,
      nextActiveSourceId: "mock-apt",
      rangeToSend: mockAptRange,
    });
  });

  it("does not tune while selection and active source are still different", () => {
    expect(
      resolveSourceFrequencyRangeSync({
        connected: true,
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        previousActiveSourceId: "mock-tx",
        activeSourceIsMockTx: true,
        frequencyRange: mockAptRange,
        lastSentFrequencyRange: null,
        isRestoringSourceView: false,
      }).rangeToSend,
    ).toBeNull();
  });
});
