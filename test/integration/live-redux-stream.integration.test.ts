import { createLiveReduxStreamHarness } from "./helpers/liveReduxStreamHarness";

describe("live Redux/source-mode stream harness", () => {
  jest.setTimeout(90_000);

  let harness: Awaited<ReturnType<typeof createLiveReduxStreamHarness>>;

  beforeAll(async () => {
    harness = await createLiveReduxStreamHarness();
    await harness.connect();
  });

  afterAll(() => {
    harness?.close();
  });

  test("connects Redux, source status, and managed RX ownership to the same source", async () => {
    await harness.selectSource("mock-apt");

    const snapshot = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.redux.activeSourceId === "mock-apt" &&
        value.redux.sourceTransport.sourceId === "mock-apt" &&
        value.redux.sourceTransport.phase === "ready" &&
        value.managed.rx.sourceId === "mock-apt" &&
        value.managed.rx.hasSubscription,
    );

    expect(snapshot.hasConnectedOnce).toBe(true);
    expect(snapshot.lifecycle.controlPlaneUnavailable).toBe(false);
    expect(snapshot.redux.isConnected).toBe(true);
    expect(snapshot.redux.sourceStatuses["mock-apt"]).toBe("receiving");
    expect(snapshot.managed.rx.streamEpoch).toEqual(expect.any(Number));
    expect(snapshot.redux.error).toBeNull();
  });

  test("delivers an RX frame into the app presentation path after status says receiving", async () => {
    await harness.selectSource("mock-apt");

    const snapshot = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.rxPresentation.hasFrame &&
        value.liveFrame.hasFrame &&
        value.redux.sourceFrameReadiness?.sourceId === "mock-apt" &&
        value.presentationPhase?.phase === "streaming",
      20_000,
    );

    expect(snapshot.rxPresentation.sourceId).toBe("mock-apt");
    expect(snapshot.rxPresentation.sequence).toEqual(expect.any(Number));
    expect(snapshot.liveFrame.sequence).toBe(snapshot.rxPresentation.sequence);
  });

  test("keeps TX and RX ownership separate while switching the live source", async () => {
    await harness.selectSource("mock-tx");
    const txStandby = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.redux.activeSourceId === "mock-tx" &&
        value.redux.sourceStatuses["mock-tx"] === "standby" &&
        value.managed.tx.hasSubscription &&
        value.presentationPhase?.phase === "warming",
    );
    expect(txStandby.managed.tx.hasSubscription).toBe(true);

    let standbySequence: number | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await harness.requestNextStandbyFrame();
      const snapshot = harness.snapshot();
      if (
        snapshot.txPresentation.hasFrame &&
        snapshot.txPresentation.sourceId === "mock-tx"
      ) {
        standbySequence = snapshot.txPresentation.sequence;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await harness.setTransmit(true, "mock-tx");
    const transmitting = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.redux.sourceStatuses["mock-tx"] === "transmitting" &&
        value.txPresentation.frameStatus === "transmitting" &&
        value.txPresentation.hasFrame &&
        (standbySequence === null ||
          value.txPresentation.sequence !== standbySequence),
      20_000,
    );
    expect(transmitting.managed.tx.sourceId).toBe("mock-tx");
    expect(transmitting.managed.tx.hasSubscription).toBe(true);
    expect(transmitting.managed.rx.sourceId).toBeNull();

    await harness.selectSource("mock-apt");
    const rx = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.redux.activeSourceId === "mock-apt" &&
        value.redux.sourceStatuses["mock-apt"] === "receiving" &&
        value.rxPresentation.hasFrame &&
        value.rxPresentation.sourceId === "mock-apt",
      20_000,
    );
    expect(rx.txPresentation.sourceId).toBe("mock-tx");
    expect(rx.rxPresentation.frameStatus).toBe("receiving");
  });

  test("pause command freezes presentation through the Space websocket/setPaused path", async () => {
    await harness.selectSource("mock-apt");
    await harness.setTransmit(false, "mock-tx");
    await harness.waitFor(
      () => harness.snapshot(),
      (value) => value.rxPresentation.hasFrame,
      20_000,
    );

    await harness.setPaused(true, "mock-apt");
    const paused = harness.snapshot();
    expect(paused.redux.isPaused).toBe(true);
    expect(paused.sourcePause["mock-apt"]).toBe(true);
    expect(paused.presentationPhase).toEqual({
      sourceId: "mock-apt",
      mode: "rx",
      phase: "paused",
    });
    expect(paused.lifecycle.controlPlaneUnavailable).toBe(false);
    expect(paused.lifecycle.phase).toBe("ready");
    expect(paused.rxPresentation.hasFrame).toBe(true);

    await harness.setPaused(false, "mock-apt");
    const resumed = harness.snapshot();
    expect(resumed.redux.isPaused).toBe(false);
    expect(resumed.sourcePause["mock-apt"]).toBe(false);
    expect(resumed.rxPresentation.hasFrame).toBe(true);
    await harness.waitFor(
      () => harness.snapshot(),
      (value) => value.redux.sourceStatuses["mock-apt"] === "receiving",
    );
  });
});
