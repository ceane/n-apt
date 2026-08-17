import { createLiveReduxStreamHarness } from "./helpers/liveReduxStreamHarness";

const MOCK_APT_SOURCE_ID = "mock-apt";
const MOCK_TX_SOURCE_ID = "mock-tx";

const waitForMockAptStreaming = async (
  harness: Awaited<ReturnType<typeof createLiveReduxStreamHarness>>,
) =>
  harness.waitFor(
    () => harness.snapshot(),
    (snapshot) =>
      snapshot.redux.activeSourceId === MOCK_APT_SOURCE_ID &&
      snapshot.redux.sourceStatuses[MOCK_APT_SOURCE_ID] === "receiving" &&
      snapshot.redux.sourceTransport.sourceId === MOCK_APT_SOURCE_ID &&
      snapshot.redux.sourceTransport.phase === "ready" &&
      snapshot.managed.rx.sourceId === MOCK_APT_SOURCE_ID &&
      snapshot.managed.rx.hasSubscription &&
      snapshot.rxPresentation.hasFrame &&
      snapshot.rxPresentation.sourceId === MOCK_APT_SOURCE_ID &&
      snapshot.presentationPhase?.phase === "streaming",
    20_000,
  );

describe("live Redux/source-mode stream harness", () => {
  jest.setTimeout(90_000);

  let harness: Awaited<ReturnType<typeof createLiveReduxStreamHarness>>;

  beforeAll(async () => {
    // Keep this suite deterministic on developer machines that have a
    // physical SDR attached. The source-inventory contract intentionally
    // hides idle mocks while hardware owns the stream, so enter the existing
    // simulated hardware path and disconnect it before exercising Mock APT.
    harness = await createLiveReduxStreamHarness({
      hardwareSimulation: "rtl-sdr",
    });
    await harness.connect();
    await harness.simulateHardwarePresence(false);
  });

  afterAll(() => {
    harness?.close();
  });

  test("loads both built-in mock sources on control-plane connect", async () => {
    const snapshot = harness.snapshot();
    expect(snapshot.hasConnectedOnce).toBe(true);
    expect(snapshot.redux.isConnected).toBe(true);
    expect(snapshot.redux.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining([MOCK_APT_SOURCE_ID, MOCK_TX_SOURCE_ID]),
    );
    expect(snapshot.redux.error).toBeNull();
  });

  test("selects Mock APT, opens RX transport, and reaches first-frame streaming", async () => {
    await harness.selectSource(MOCK_APT_SOURCE_ID);
    const snapshot = await waitForMockAptStreaming(harness);

    expect(snapshot.lifecycle.controlPlaneUnavailable).toBe(false);
    expect(snapshot.lifecycle.phase).toBe("ready");
    expect(snapshot.lifecycle.placeholderReason).toBeNull();
    expect(snapshot.managed.rx.streamEpoch).toEqual(expect.any(Number));
    expect(snapshot.rxPresentation.sequence).toEqual(expect.any(Number));
    expect(snapshot.liveFrame.sequence).toBe(snapshot.rxPresentation.sequence);
  });

  test("switches Mock APT RX to Mock Tx and back without crossing stream ownership", async () => {
    await harness.selectSource(MOCK_TX_SOURCE_ID);
    const txStandby = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.redux.activeSourceId === MOCK_TX_SOURCE_ID &&
        value.redux.sourceStatuses[MOCK_TX_SOURCE_ID] === "standby" &&
        value.managed.tx.hasSubscription &&
        (value.presentationPhase?.phase === "warming" ||
          value.presentationPhase?.phase === "standby"),
    );
    expect(txStandby.managed.tx.hasSubscription).toBe(true);

    let standbySequence: number | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await harness.requestNextStandbyFrame();
      const snapshot = harness.snapshot();
      if (
        snapshot.txPresentation.hasFrame &&
        snapshot.txPresentation.sourceId === MOCK_TX_SOURCE_ID
      ) {
        standbySequence = snapshot.txPresentation.sequence;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await harness.setTransmit(true, MOCK_TX_SOURCE_ID);
    const transmitting = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.redux.sourceStatuses[MOCK_TX_SOURCE_ID] === "transmitting" &&
        value.txPresentation.frameStatus === "transmitting" &&
        value.txPresentation.hasFrame &&
        (standbySequence === null ||
          value.txPresentation.sequence !== standbySequence),
      20_000,
    );
    expect(transmitting.managed.tx.sourceId).toBe(MOCK_TX_SOURCE_ID);
    expect(transmitting.managed.tx.hasSubscription).toBe(true);
    expect(transmitting.managed.rx.sourceId).toBeNull();

    await harness.selectSource(MOCK_APT_SOURCE_ID);
    const rx = await waitForMockAptStreaming(harness);
    expect(rx.txPresentation.sourceId).toBe(MOCK_TX_SOURCE_ID);
    expect(rx.rxPresentation.frameStatus).toBe("receiving");
  });

  test("pauses Mock APT without losing its frame, then resumes streaming", async () => {
    await harness.selectSource(MOCK_APT_SOURCE_ID);
    await harness.setTransmit(false, MOCK_TX_SOURCE_ID);
    const streaming = await waitForMockAptStreaming(harness);

    await harness.setPaused(true, MOCK_APT_SOURCE_ID);
    const paused = harness.snapshot();
    expect(paused.redux.isPaused).toBe(true);
    expect(paused.sourcePause[MOCK_APT_SOURCE_ID]).toBe(true);
    expect(paused.presentationPhase).toEqual({
      sourceId: "mock-apt",
      mode: "rx",
      phase: "paused",
    });
    expect(paused.lifecycle.controlPlaneUnavailable).toBe(false);
    expect(paused.lifecycle.phase).toBe("ready");
    expect(paused.rxPresentation.sequence).toBe(
      streaming.rxPresentation.sequence,
    );

    await harness.setPaused(false, MOCK_APT_SOURCE_ID);
    const resumed = await waitForMockAptStreaming(harness);
    expect(resumed.redux.isPaused).toBe(false);
    expect(resumed.sourcePause[MOCK_APT_SOURCE_ID]).toBe(false);
    expect(resumed.lifecycle.placeholderReason).toBeNull();
  });
});
