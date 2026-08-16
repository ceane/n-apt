import { createLiveReduxStreamHarness } from "./helpers/liveReduxStreamHarness";

const RTL_SOURCE_ID = "rtl-sdr-00000001";
const MOCK_APT_SOURCE_ID = "mock-apt";

describe("simulated backend hardware lifecycle", () => {
  jest.setTimeout(90_000);

  let harness: Awaited<ReturnType<typeof createLiveReduxStreamHarness>>;

  beforeAll(async () => {
    harness = await createLiveReduxStreamHarness({
      hardwareSimulation: "rtl-sdr",
    });
    await harness.connect();
  });

  afterAll(() => {
    harness?.close();
  });

  test("connects the simulated RTL-SDR and reaches first-frame streaming", async () => {
    const connected = await harness.waitFor(
      () => harness.snapshot(),
      (snapshot) =>
        snapshot.redux.activeSourceId === RTL_SOURCE_ID &&
        snapshot.selectedSourceId === RTL_SOURCE_ID &&
        snapshot.redux.sources.some((source) => source.id === RTL_SOURCE_ID) &&
        snapshot.rxPresentation.sourceId === RTL_SOURCE_ID &&
        snapshot.rxPresentation.hasFrame &&
        snapshot.lifecycle.phase === "ready",
      30_000,
    );

    expect(connected.redux.sources.map((source) => source.id)).not.toContain(
      MOCK_APT_SOURCE_ID,
    );
    expect(connected.lifecycle.placeholderReason).toBeNull();
  });

  test("disconnects RTL-SDR, selects Mock APT, and resumes streaming automatically", async () => {
    await harness.simulateHardwarePresence(false);

    const fallback = await harness.waitFor(
      () => harness.snapshot(),
      (snapshot) =>
        snapshot.redux.activeSourceId === MOCK_APT_SOURCE_ID &&
        snapshot.selectedSourceId === MOCK_APT_SOURCE_ID &&
        snapshot.redux.sources.some((source) => source.id === MOCK_APT_SOURCE_ID) &&
        snapshot.rxPresentation.sourceId === MOCK_APT_SOURCE_ID &&
        snapshot.rxPresentation.hasFrame &&
        snapshot.lifecycle.phase === "ready",
      30_000,
    );

    expect(fallback.redux.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining(["mock-apt", "mock-tx"]),
    );
    expect(fallback.lifecycle.placeholderReason).toBeNull();
  });

  test("reconnects RTL-SDR and auto-selects it without a manual source click", async () => {
    await harness.simulateHardwarePresence(true);

    const reconnected = await harness.waitFor(
      () => harness.snapshot(),
      (snapshot) =>
        snapshot.redux.activeSourceId === RTL_SOURCE_ID &&
        snapshot.selectedSourceId === RTL_SOURCE_ID &&
        snapshot.rxPresentation.sourceId === RTL_SOURCE_ID &&
        snapshot.rxPresentation.hasFrame &&
        snapshot.lifecycle.phase === "ready",
      30_000,
    );

    expect(reconnected.redux.sources.map((source) => source.id)).not.toContain(
      MOCK_APT_SOURCE_ID,
    );
    expect(reconnected.lifecycle.placeholderReason).toBeNull();
  });
});
