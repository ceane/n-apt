import {
  filterMultiplexStreamPresentationFrames,
  filterMultiplexStreamTxPreviewFrames,
  hasMultiplexStreamTxPreviewFrame,
  isMultiplexStreamTxPresentationFrame,
  resolveMultiplexStreamPresentationBatch,
  shouldSuppressRxOptionsCandidate,
} from "@n-apt/spectrum/model/multiplexStream";

const rxFrame = { source_id: "mock-apt", frame_status: "receiving" };
const standbyPreview = { source_id: "mock-tx", frame_status: "standby" };
const taggedPreview = { source_id: "s", is_tx_preview: true };
const legacyAliasPreview = { source_id: "s", is_mock_tx_preview: true };
const transmittingFrame = { source_id: "s", frame_status: "transmitting" };

describe("isMultiplexStreamTxPresentationFrame", () => {
  it("classifies standby, transmitting, and preview-tagged frames as Tx presentation", () => {
    expect(isMultiplexStreamTxPresentationFrame(standbyPreview)).toBe(true);
    expect(isMultiplexStreamTxPresentationFrame(transmittingFrame)).toBe(true);
    expect(isMultiplexStreamTxPresentationFrame(taggedPreview)).toBe(true);
    expect(isMultiplexStreamTxPresentationFrame(legacyAliasPreview)).toBe(
      true,
    );
    expect(isMultiplexStreamTxPresentationFrame(rxFrame)).toBe(false);
  });
});

describe("filterMultiplexStreamPresentationFrames", () => {
  it("does not let an old RX frame enter the TX renderer queue", () => {
    const rx = {
      source_id: "hackrf-1",
      frame_status: "receiving",
      sequence: 40,
    };
    const tx = {
      source_id: "hackrf-1",
      frame_status: "transmitting",
      sequence: 41,
    };

    expect(filterMultiplexStreamPresentationFrames([rx, tx], true)).toEqual([
      tx,
    ]);
    expect(filterMultiplexStreamPresentationFrames([rx, tx], false)).toEqual([
      rx,
    ]);
  });
});

describe("has/filter tx preview frames", () => {
  it("retains the broader legacy has predicate but excludes untagged transmitting frames from previews", () => {
    expect(hasMultiplexStreamTxPreviewFrame([transmittingFrame])).toBe(true);
    expect(filterMultiplexStreamTxPreviewFrames([transmittingFrame])).toEqual([]);
    const taggedTransmit = { ...transmittingFrame, is_tx_preview: true };
    expect(filterMultiplexStreamTxPreviewFrames([
      transmittingFrame, taggedTransmit, standbyPreview, legacyAliasPreview,
    ])).toEqual([taggedTransmit, standbyPreview, legacyAliasPreview]);
    expect(filterMultiplexStreamTxPreviewFrames([
      { is_tx_preview: 1 }, { is_mock_tx_preview: "true" },
    ])).toEqual([]);
  });

  it("detects preview frames inside a mixed batch", () => {
    const frames = [rxFrame, standbyPreview];
    expect(hasMultiplexStreamTxPreviewFrame(frames)).toBe(true);
    expect(filterMultiplexStreamTxPreviewFrames(frames)).toEqual([
      standbyPreview,
    ]);
    expect(hasMultiplexStreamTxPreviewFrame([rxFrame])).toBe(false);
    expect(filterMultiplexStreamTxPreviewFrames([rxFrame])).toEqual([]);
  });
});

describe("resolveMultiplexStreamPresentationBatch", () => {
  const liveInput = {
    frameCount: 1,
    isFileSource: false,
    isPaused: false,
    pausedRequestInFlight: false,
    isActiveTxMonitorStandby: false,
    isActiveBoundTxPreviewStandby: false,
    isSelectedTxPresentationStandby: false,
    isActiveTxMonitorTransmitting: false,
    isSelectedTxPresentationTransmitting: false,
    hasTxPreviewFrame: false,
  };

  it("matches the inline middleware predicates for every boolean combination", () => {
    const flags = [
      "isFileSource", "isPaused", "pausedRequestInFlight",
      "isActiveTxMonitorStandby", "isActiveBoundTxPreviewStandby",
      "isSelectedTxPresentationStandby", "isActiveTxMonitorTransmitting",
      "isSelectedTxPresentationTransmitting", "hasTxPreviewFrame",
    ] as const;
    for (const frameCount of [0, 1, 3]) {
      for (let mask = 0; mask < 2 ** flags.length; mask += 1) {
        const input = { ...liveInput, frameCount };
        flags.forEach((flag, index) => {
          input[flag] = (mask & (1 << index)) !== 0;
        });
        const shouldAcceptPausedFrame = input.hasTxPreviewFrame ||
          (input.isPaused && input.pausedRequestInFlight);
        const accept = frameCount > 0 &&
          ((!input.isPaused && !input.isActiveTxMonitorStandby &&
            !input.isActiveBoundTxPreviewStandby && !input.isSelectedTxPresentationStandby) ||
            shouldAcceptPausedFrame || input.isActiveTxMonitorTransmitting) &&
          !input.isFileSource;
        const replacePausedPresentation = accept &&
          (input.isPaused || input.isActiveTxMonitorStandby ||
            input.isActiveBoundTxPreviewStandby || input.isSelectedTxPresentationStandby) &&
          (shouldAcceptPausedFrame || input.hasTxPreviewFrame) &&
          !input.isActiveTxMonitorTransmitting && !input.isSelectedTxPresentationTransmitting;
        expect(resolveMultiplexStreamPresentationBatch(input)).toEqual({
          accept, replacePausedPresentation,
        });
      }
    }
  });

  it("accepts ordinary live streaming batches in append mode", () => {
    expect(resolveMultiplexStreamPresentationBatch(liveInput)).toEqual({
      accept: true,
      replacePausedPresentation: false,
    });
  });

  it("rejects empty batches and file sources outright", () => {
    expect(
      resolveMultiplexStreamPresentationBatch({ ...liveInput, frameCount: 0 })
        .accept,
    ).toBe(false);
    expect(
      resolveMultiplexStreamPresentationBatch({ ...liveInput, isFileSource: true })
        .accept,
    ).toBe(false);
  });

  it("rejects live batches while any Tx-standby presentation flag holds", () => {
    for (const flag of [
      "isActiveTxMonitorStandby",
      "isActiveBoundTxPreviewStandby",
      "isSelectedTxPresentationStandby",
    ] as const) {
      expect(
        resolveMultiplexStreamPresentationBatch({
          ...liveInput,
          [flag]: true,
        }).accept,
      ).toBe(false);
    }
  });

  it("accepts a paused one-shot response in replace mode (untagged frame)", () => {
    expect(
      resolveMultiplexStreamPresentationBatch({
        ...liveInput,
        isPaused: true,
        pausedRequestInFlight: true,
      }),
    ).toEqual({ accept: true, replacePausedPresentation: true });
  });

  it("rejects a paused state with no armed request and no preview tag", () => {
    expect(
      resolveMultiplexStreamPresentationBatch({
        ...liveInput,
        isPaused: true,
      }).accept,
    ).toBe(false);
  });

  it("lets a Tx preview frame satisfy acceptance while paused/standby", () => {
    expect(
      resolveMultiplexStreamPresentationBatch({
        ...liveInput,
        isPaused: true,
        hasTxPreviewFrame: true,
      }),
    ).toEqual({ accept: true, replacePausedPresentation: true });
    expect(
      resolveMultiplexStreamPresentationBatch({
        ...liveInput,
        isActiveBoundTxPreviewStandby: true,
        hasTxPreviewFrame: true,
      }),
    ).toEqual({ accept: true, replacePausedPresentation: true });
  });

  it("keeps an actively transmitting monitor streaming in append mode", () => {
    expect(
      resolveMultiplexStreamPresentationBatch({
        ...liveInput,
        isActiveTxMonitorTransmitting: true,
      }),
    ).toEqual({ accept: true, replacePausedPresentation: false });
    // Transmitting overrides the standby replacement branch.
    expect(
      resolveMultiplexStreamPresentationBatch({
        ...liveInput,
        isPaused: true,
        pausedRequestInFlight: true,
        isActiveTxMonitorTransmitting: true,
      }),
    ).toEqual({ accept: true, replacePausedPresentation: false });
  });

  it("blocks replace-mode when the selected Tx presentation is transmitting", () => {
    expect(
      resolveMultiplexStreamPresentationBatch({
        ...liveInput,
        isSelectedSourceTransmitting: undefined,
        isPaused: true,
        pausedRequestInFlight: true,
        isSelectedTxPresentationStandby: true,
        isSelectedTxPresentationTransmitting: true,
        hasTxPreviewFrame: true,
      } as never).replacePausedPresentation,
    ).toBe(false);
  });
});

describe("shouldSuppressRxOptionsCandidate", () => {
  const base = {
    hydrationSuppressionActive: true,
    latestGestureCenterHz: 5_200_000,
    candidateCenterHz: 5_100_000,
  };

  it("suppresses hydration echoes that differ from gesture intent", () => {
    expect(shouldSuppressRxOptionsCandidate(base)).toBe(true);
  });

  it("allows the gesture-intent tune itself", () => {
    expect(
      shouldSuppressRxOptionsCandidate({
        ...base,
        candidateCenterHz: 5_200_000,
      }),
    ).toBe(false);
  });

  it("allows everything outside the suppression window", () => {
    expect(
      shouldSuppressRxOptionsCandidate({
        ...base,
        hydrationSuppressionActive: false,
      }),
    ).toBe(false);
  });

  it("allows candidates when no gesture intent is known yet", () => {
    expect(
      shouldSuppressRxOptionsCandidate({
        ...base,
        latestGestureCenterHz: null,
      }),
    ).toBe(false);
  });
});
