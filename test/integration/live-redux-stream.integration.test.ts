import fc from "fast-check";
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
      snapshot.lifecycle.phase === "ready" &&
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
      autoSelectInitialSource: false,
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

  test("starts the active Mock APT stream without reselection", async () => {
    const snapshot = await waitForMockAptStreaming(harness);

    expect(snapshot.redux.activeSourceId).toBe(MOCK_APT_SOURCE_ID);
    expect(snapshot.lifecycle.phase).toBe("ready");
    expect(snapshot.lifecycle.placeholderReason).toBeNull();
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

  test("restarts the existing Mock Tx stream with fresh transmitting frames", async () => {
    await harness.setTransmit(false, MOCK_TX_SOURCE_ID);
    await harness.selectSource(MOCK_TX_SOURCE_ID);
    await harness.viewSource(MOCK_TX_SOURCE_ID);
    await harness.requestNextStandbyFrame();

    const standby = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.txPresentation.sourceId === MOCK_TX_SOURCE_ID &&
        value.txPresentation.hasFrame &&
        value.txPresentation.frameStatus === "standby",
      20_000,
    );
    const standbySequence = standby.txPresentation.sequence ?? 0;

    await harness.setTransmit(true, MOCK_TX_SOURCE_ID);
    const firstTransmit = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.redux.sourceStatuses[MOCK_TX_SOURCE_ID] === "transmitting" &&
        value.txPresentation.frameStatus === "transmitting" &&
        value.txPresentation.hasFrame &&
        (value.txPresentation.sequence ?? 0) > standbySequence,
      20_000,
    );
    expect(firstTransmit.txPresentation.sequence).toBeGreaterThan(
      standbySequence,
    );

    await harness.setTransmit(false, MOCK_TX_SOURCE_ID);
    const stopped = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.redux.sourceStatuses[MOCK_TX_SOURCE_ID] === "standby" &&
        value.txPresentation.frameStatus === "standby" &&
        value.txPresentation.hasFrame,
      20_000,
    );
    const stoppedSequence = stopped.txPresentation.sequence ?? 0;

    await harness.setTransmit(true, MOCK_TX_SOURCE_ID);
    const restarted = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.redux.sourceStatuses[MOCK_TX_SOURCE_ID] === "transmitting" &&
        value.txPresentation.frameStatus === "transmitting" &&
        value.txPresentation.hasFrame &&
        (value.txPresentation.sequence ?? 0) > stoppedSequence,
      20_000,
    );

    expect(restarted.txPresentation.sequence).toBeGreaterThan(
      stoppedSequence,
    );
    expect(restarted.lifecycle.placeholderReason).toBeNull();
  });

  test("keeps the client-local Mock APT view streaming after Mock Tx", async () => {
    await harness.setPaused(false, MOCK_APT_SOURCE_ID);
    await harness.selectSource(MOCK_APT_SOURCE_ID);
    await harness.viewSource(MOCK_APT_SOURCE_ID);
    await waitForMockAptStreaming(harness);

    await harness.selectSource(MOCK_TX_SOURCE_ID);
    await harness.setTransmit(true, MOCK_TX_SOURCE_ID);

    const before = harness.snapshot().rxPresentation.sequence ?? 0;
    await harness.viewSource(MOCK_APT_SOURCE_ID);

    const first = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.selectedSourceId === MOCK_APT_SOURCE_ID &&
        value.managed.rx.sourceId === MOCK_APT_SOURCE_ID &&
        value.rxPresentation.sourceId === MOCK_APT_SOURCE_ID &&
        value.rxPresentation.sequence !== null &&
        value.rxPresentation.sequence > before,
      20_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const second = harness.snapshot();

    expect(first.rxPresentation.frameStatus).toBe("receiving");
    expect(second.rxPresentation.sequence).toBeGreaterThan(
      first.rxPresentation.sequence!,
    );
    expect(second.redux.sourceStatuses[MOCK_TX_SOURCE_ID]).toBe(
      "transmitting",
    );
  });

  test("keeps Mock Tx frames advancing while away and restores them without a placeholder", async () => {
    await harness.setPaused(false, MOCK_APT_SOURCE_ID);
    await harness.setTransmit(true, MOCK_TX_SOURCE_ID);
    await harness.viewSource(MOCK_TX_SOURCE_ID);

    const transmitting = await harness.waitFor(
      () => harness.snapshot(),
      (snapshot) =>
        snapshot.redux.sourceStatuses[MOCK_TX_SOURCE_ID] === "transmitting" &&
        snapshot.txPresentation.frameStatus === "transmitting" &&
        snapshot.txPresentation.hasFrame &&
        snapshot.txPresentation.sequence !== null,
      20_000,
    );
    const sequenceBeforeLeaving = transmitting.txPresentation.sequence!;

    await harness.viewSource(MOCK_APT_SOURCE_ID);
    await waitForMockAptStreaming(harness);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const whileAway = harness.snapshot();
    expect(whileAway.redux.sourceStatuses[MOCK_TX_SOURCE_ID]).toBe(
      "transmitting",
    );
    expect(whileAway.txPresentation.sequence).toBeGreaterThan(
      sequenceBeforeLeaving,
    );

    await harness.viewSource(MOCK_TX_SOURCE_ID);
    const restored = await harness.waitFor(
      () => harness.snapshot(),
      (snapshot) =>
        snapshot.redux.sourceStatuses[MOCK_TX_SOURCE_ID] === "transmitting" &&
        snapshot.txPresentation.frameStatus === "transmitting" &&
        snapshot.txPresentation.hasFrame &&
        snapshot.txPresentation.sequence !== null &&
        snapshot.txPresentation.sequence > sequenceBeforeLeaving &&
        snapshot.lifecycle.placeholderReason === null,
      20_000,
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    const advancingAgain = harness.snapshot();
    expect(advancingAgain.txPresentation.sequence).toBeGreaterThan(
      restored.txPresentation.sequence!,
    );
    expect(advancingAgain.lifecycle.placeholderReason).toBeNull();
  });

  test("fuzzes rapid local source and pause transitions without blanking frames", async () => {
    await harness.setTransmit(false, MOCK_TX_SOURCE_ID);
    await harness.selectSource(MOCK_TX_SOURCE_ID);
    await harness.setTransmit(true, MOCK_TX_SOURCE_ID);
    await harness.waitFor(
      () => harness.snapshot(),
      (snapshot) => snapshot.txPresentation.hasFrame,
      20_000,
    );
    await harness.viewSource(MOCK_APT_SOURCE_ID);
    await harness.waitFor(
      () => harness.snapshot(),
      (snapshot) => snapshot.rxPresentation.hasFrame,
      20_000,
    );

    const actions = fc.array(
      fc.constantFrom(
        "view-apt",
        "view-tx",
        "start-tx",
        "stop-tx",
        "pause-apt",
        "resume-apt",
      ),
      { minLength: 10, maxLength: 24 },
    );

    await fc.assert(
      fc.asyncProperty(actions, async (sequence) => {
        // Each generated run starts from the same subscriber-local state;
        // otherwise a pause from a previous run would make the next run test
        // teardown residue instead of the generated action sequence.
        await harness.setPaused(false, MOCK_APT_SOURCE_ID);
        await harness.setTransmit(false, MOCK_TX_SOURCE_ID);
        await harness.viewSource(MOCK_TX_SOURCE_ID);
        await harness.setTransmit(true, MOCK_TX_SOURCE_ID);
        await harness.viewSource(MOCK_APT_SOURCE_ID);
        await harness.waitFor(
          () => harness.snapshot(),
          (snapshot) => snapshot.rxPresentation.hasFrame,
          2_000,
        );

        for (const action of sequence) {
          switch (action) {
            case "view-apt":
              await harness.viewSource(MOCK_APT_SOURCE_ID);
              break;
            case "view-tx":
              await harness.viewSource(MOCK_TX_SOURCE_ID);
              break;
            case "start-tx":
              await harness.setTransmit(true, MOCK_TX_SOURCE_ID);
              break;
            case "stop-tx":
              await harness.setTransmit(false, MOCK_TX_SOURCE_ID);
              break;
            case "pause-apt":
              await harness.setPaused(true, MOCK_APT_SOURCE_ID);
              break;
            case "resume-apt":
              await harness.setPaused(false, MOCK_APT_SOURCE_ID);
              break;
          }

          await new Promise((resolve) => setTimeout(resolve, 35));
          const target = harness.snapshot().presentationTarget.sourceId;
          if (target === MOCK_APT_SOURCE_ID) {
            await harness.waitFor(
              () => harness.snapshot(),
              (snapshot) => snapshot.rxPresentation.hasFrame,
              1_500,
            );
          } else if (target === MOCK_TX_SOURCE_ID) {
            await harness.waitFor(
              () => harness.snapshot(),
              (snapshot) => snapshot.txPresentation.hasFrame,
              1_500,
            );
          }
        }
      }),
      { numRuns: 4, interruptAfterTimeLimit: 60_000 },
    );
  });

  test("keeps a real Mock Tx one-shot preview above the loading placeholder", async () => {
    // The preceding lifecycle test intentionally leaves bound Mock Tx live
    // while viewing Mock APT. Reset the device state before testing the
    // request-only standby contract; otherwise live Tx ticks are expected.
    await harness.setTransmit(false, MOCK_TX_SOURCE_ID);
    await harness.selectSource(MOCK_TX_SOURCE_ID);
    await harness.viewSource(MOCK_TX_SOURCE_ID);
    // Entering standby automatically requests the first preview. Let that
    // request settle before this test measures its explicit one-shot, so the
    // assertion covers one request rather than two intentionally valid
    // previews crossing the same websocket boundary.
    await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.txPresentation.sourceId === MOCK_TX_SOURCE_ID &&
        value.txPresentation.sequence !== null,
      20_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const before = harness.snapshot().txPresentation.sequence ?? 0;
    await harness.requestNextStandbyFrame();
    const preview = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.txPresentation.sourceId === MOCK_TX_SOURCE_ID &&
        value.txPresentation.sequence !== null &&
        value.txPresentation.sequence > before,
      20_000,
    );

    expect(preview.txPresentation.hasFrame).toBe(true);
    expect(preview.txPresentation.frameStatus).toBe("standby");
    expect(preview.lifecycle.phase).toBe("standby");
    expect(preview.lifecycle.placeholderKind).toBe("top-bar");

    // Let the real websocket/middleware/render lifecycle settle. A race here
    // used to briefly replace the accepted preview with the full Loading UI.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const settled = harness.snapshot();
    expect(settled.txPresentation.sequence).toBe(
      preview.txPresentation.sequence,
    );
    expect(settled.lifecycle.phase).toBe("standby");
    expect(settled.lifecycle.placeholderKind).toBe("top-bar");
  });

  test("refreshes the retained Mock Tx frame while globally in standby", async () => {
    await harness.setTransmit(false, MOCK_TX_SOURCE_ID);
    await harness.selectSource(MOCK_TX_SOURCE_ID);
    await harness.viewSource(MOCK_TX_SOURCE_ID);
    await harness.requestNextStandbyFrame();
    const preview = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.txPresentation.sourceId === MOCK_TX_SOURCE_ID &&
        value.txPresentation.sequence !== null &&
        value.txPresentation.frameStatus === "standby",
      20_000,
    );

    const standby = harness.snapshot();
    expect(standby.txPresentation.sequence).toBe(preview.txPresentation.sequence);
    expect(standby.txPresentation.hasFrame).toBe(true);

    await harness.requestNextStandbyFrame({
      sourceId: MOCK_TX_SOURCE_ID,
      txSettings: {
        centerFrequencyHz: 141_100_000,
        viewCenterHz: 141_100_000,
        bandwidthHz: 2_400_000,
        sampleRateHz: 2_400_000,
        powerDbm: -12,
        txSignal: "tone",
        txIfftSize: 2048,
      },
    });
    const refreshed = await harness.waitFor(
      () => harness.snapshot(),
      (value) =>
        value.txPresentation.sourceId === MOCK_TX_SOURCE_ID &&
        value.txPresentation.sequence !== null &&
        (value.txPresentation.streamEpoch !== standby.txPresentation.streamEpoch ||
          value.txPresentation.sequence > (standby.txPresentation.sequence ?? 0)) &&
        value.txPresentation.frameStatus === "standby",
      20_000,
    );

    expect(refreshed.txPresentation.hasFrame).toBe(true);
    expect(refreshed.txPresentation.centerFrequencyHz).toBe(141_100_000);
    expect(refreshed.txPresentation.sampleRateHz).toBe(2_400_000);
    expect(refreshed.lifecycle.phase).toBe("standby");
    expect(refreshed.lifecycle.placeholderKind).toBe("top-bar");
  });

  test("replays varied Mock Tx preview geometry through the live pipeline", async () => {
    const previewCase = fc
      .tuple(
        fc.integer({ min: -800_000, max: 800_000 }),
        fc.constantFrom(3_200_000, 18_250_000),
        fc.integer({ min: 1, max: 4 }),
        fc.constantFrom(1024, 2048, 4096),
        fc.constantFrom("wifi", "tone"),
      )
      .map(([centerOffsetHz, sampleRateHz, bandwidthTenths, txIfftSize, txSignal]) => {
        const centerFrequencyHz = 13_875_000 + centerOffsetHz;
        return {
          centerFrequencyHz,
          viewCenterHz: centerFrequencyHz,
          sampleRateHz,
          bandwidthHz: Math.round((sampleRateHz * bandwidthTenths) / 10),
          txIfftSize,
          txSignal,
        };
      });

    await harness.setTransmit(false, MOCK_TX_SOURCE_ID);
    await harness.selectSource(MOCK_TX_SOURCE_ID);
    await harness.viewSource(MOCK_TX_SOURCE_ID);
    let expectedIqByteLength: number | null = null;

    await fc.assert(
      fc.asyncProperty(previewCase, async (settings) => {
        const beforeFrame = harness.snapshot().txPresentation;
        await harness.requestNextStandbyFrame({
          sourceId: MOCK_TX_SOURCE_ID,
          txSettings: settings,
        });

        const preview = await harness.waitFor(
          () => harness.snapshot(),
          (value) => {
            const frame = value.txPresentation;
            const newerEpoch =
              frame.streamEpoch !== null &&
              frame.streamEpoch !== beforeFrame.streamEpoch;
            const newerSequence =
              frame.streamEpoch === beforeFrame.streamEpoch &&
              frame.sequence !== null &&
              frame.sequence > (beforeFrame.sequence ?? 0);
            return (
              frame.sourceId === MOCK_TX_SOURCE_ID &&
              frame.sequence !== null &&
              (newerEpoch || newerSequence)
            );
          },
          20_000,
        );

        expect(preview.txPresentation.frameStatus).toBe("standby");
        expect(preview.txPresentation.isTxPreview).toBe(true);
        expect(preview.txPresentation.centerFrequencyHz).toBe(
          settings.viewCenterHz,
        );
        expect(preview.txPresentation.sampleRateHz).toBe(
          settings.sampleRateHz,
        );
        expect(preview.txPresentation.iqByteLength).toBeGreaterThan(0);
        expect(preview.txPresentation.iqByteLength! % 2).toBe(0);
        if (expectedIqByteLength === null) {
          expectedIqByteLength = preview.txPresentation.iqByteLength;
        } else {
          // Bandwidth, carrier, and viewer sample rate change the rendered
          // occupancy, not the negotiated FFT payload size.
          expect(preview.txPresentation.iqByteLength).toBe(
            expectedIqByteLength,
          );
        }

        expect(preview.lifecycle.phase).toBe("standby");
        expect(preview.lifecycle.placeholderKind).toBe("top-bar");

        await new Promise((resolve) => setTimeout(resolve, 60));
        const settled = harness.snapshot();
        expect(settled.lifecycle.phase).toBe("standby");
        expect(settled.lifecycle.placeholderKind).toBe("top-bar");
        expect(settled.txPresentation.sequence).toBe(
          preview.txPresentation.sequence,
        );
      }),
      { numRuns: 6, seed: 20260902 },
    );
  }, 120_000);

  test("pauses Mock APT without losing its frame, then resumes streaming", async () => {
    await harness.setPaused(false, MOCK_APT_SOURCE_ID);
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
