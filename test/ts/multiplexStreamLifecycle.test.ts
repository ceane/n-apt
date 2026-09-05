import {
  hasPlayedOnceForSource,
  resolveLiveSourceHandoffPending,
  resolveSelectedSourceTxPresentationFlags,
  resolveSelectedSourceTxStatusFlags,
  selectedSourceOwnsPaintableFrame,
} from "@n-apt/spectrum/model/multiplexStream";

describe("resolveLiveSourceHandoffPending", () => {
  it("does not treat a foreign active-source change as a local handoff", () => {
    expect(
      resolveLiveSourceHandoffPending({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
      }),
    ).toBe(false);
    expect(
      resolveLiveSourceHandoffPending({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        selectionIntentSourceId: "mock-apt",
      }),
    ).toBe(true);
    expect(
      resolveLiveSourceHandoffPending({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        pendingSourceSwitchId: "mock-apt",
      }),
    ).toBe(true);
  });

  it("is pending while the selected transport warms, even after commit", () => {
    expect(
      resolveLiveSourceHandoffPending({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        transportSourceId: "mock-apt",
        transportPhase: "warming",
      }),
    ).toBe(true);
  });

  it("does not keep a ready subscriber-local Tx view in handoff loading", () => {
    expect(
      resolveLiveSourceHandoffPending({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "mock-tx",
        transportSourceId: "mock-tx",
        transportPhase: "ready",
        subscriberLocalTxView: true,
      }),
    ).toBe(false);
  });

  it("treats a missing selection as not pending", () => {
    expect(
      resolveLiveSourceHandoffPending({
        selectedSourceId: null,
        activeSourceId: null,
      }),
    ).toBe(false);
  });
});

describe("resolveSelectedSourceTxPresentationFlags", () => {
  const base = {
    txSuiteBoundToSelection: true,
    selectedSourceStatus: "paused" as string | null,
    isSelectedSourceTxMode: false,
    canTransmit: true,
  };

  it("arms preview standby for a bound paused source that can transmit", () => {
    expect(resolveSelectedSourceTxPresentationFlags(base)).toEqual({
      isSelectedTxPreviewStandby: true,
    });
  });

  it("disarms when transmitting", () => {
    expect(
      resolveSelectedSourceTxPresentationFlags({
        ...base,
        selectedSourceStatus: "transmitting",
      }).isSelectedTxPreviewStandby,
    ).toBe(false);
  });

  it("requires either explicit Tx mode or paused+canTransmit", () => {
    expect(
      resolveSelectedSourceTxPresentationFlags({
        ...base,
        isSelectedSourceTxMode: false,
        canTransmit: false,
      }).isSelectedTxPreviewStandby,
    ).toBe(false);
    expect(
      resolveSelectedSourceTxPresentationFlags({
        ...base,
        selectedSourceStatus: "receiving",
        isSelectedSourceTxMode: true,
      }).isSelectedTxPreviewStandby,
    ).toBe(true);
  });

  it("disarms when the binding targets another source", () => {
    expect(
      resolveSelectedSourceTxPresentationFlags({
        ...base,
        txSuiteBoundToSelection: false,
      }).isSelectedTxPreviewStandby,
    ).toBe(false);
  });
});

describe("resolveSelectedSourceTxStatusFlags", () => {
  it("keeps both reported statuses deliberate — lag must not unmount Tx UI", () => {
    const flags = resolveSelectedSourceTxStatusFlags({
      transportReportedStatus: "receiving",
      sourceRecordedStatus: "standby",
      isSelectedTxPreviewStandby: false,
    });
    expect(flags.isSelectedSourceTxStandby).toBe(true);
    expect(flags.isSelectedSourceTxStatus).toBe(true);
  });

  it("aggregates standby, preview, and transmitting into Tx status", () => {
    expect(
      resolveSelectedSourceTxStatusFlags({
        transportReportedStatus: null,
        sourceRecordedStatus: null,
        isSelectedTxPreviewStandby: true,
      }).isSelectedSourceTxStatus,
    ).toBe(true);
    expect(
      resolveSelectedSourceTxStatusFlags({
        transportReportedStatus: "transmitting",
        sourceRecordedStatus: "receiving",
        isSelectedTxPreviewStandby: false,
      }).isSelectedSourceTxStatus,
    ).toBe(true);
    expect(
      resolveSelectedSourceTxStatusFlags({
        transportReportedStatus: "receiving",
        sourceRecordedStatus: "receiving",
        isSelectedTxPreviewStandby: false,
      }),
    ).toEqual({
      isSelectedSourceTxStandby: false,
      isSelectedSourceTxStatus: false,
    });
  });
});

describe("selectedSourceOwnsPaintableFrame", () => {
  it("accepts any single ownership signal", () => {
    for (const key of [
      "hasTargetFrozenFrame",
      "currentSourceFrameReady",
      "hasRenderableCurrentFrame",
      "hasPlayedOnceForSelectedSource",
    ] as const) {
      expect(
        selectedSourceOwnsPaintableFrame({
          hasTargetFrozenFrame: false,
          currentSourceFrameReady: false,
          hasRenderableCurrentFrame: false,
          hasPlayedOnceForSelectedSource: false,
          [key]: true,
        }),
      ).toBe(true);
    }
  });

  it("rejects when no signal holds", () => {
    expect(
      selectedSourceOwnsPaintableFrame({
        hasTargetFrozenFrame: false,
        currentSourceFrameReady: false,
        hasRenderableCurrentFrame: false,
        hasPlayedOnceForSelectedSource: false,
      }),
    ).toBe(false);
  });
});

describe("hasPlayedOnceForSource", () => {
  it("scopes the played-once marker to the streaming source", () => {
    expect(
      hasPlayedOnceForSource({
        hasPlayedAtLeastOnce: true,
        playedSourceId: "mock-apt",
        streamingSourceId: "mock-apt",
      }),
    ).toBe(true);
    // A previous source's marker never satisfies the new selection.
    expect(
      hasPlayedOnceForSource({
        hasPlayedAtLeastOnce: true,
        playedSourceId: "mock-apt",
        streamingSourceId: "mock-tx",
      }),
    ).toBe(false);
    expect(
      hasPlayedOnceForSource({
        hasPlayedAtLeastOnce: false,
        playedSourceId: "mock-apt",
        streamingSourceId: "mock-apt",
      }),
    ).toBe(false);
  });
});
