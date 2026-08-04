import {
  resolveFramePresentation,
  selectFrameForPresentation,
} from "../../src/ts/components/fft/framePresentation";

describe("frame presentation policy", () => {
  it("prefers an incoming frame over a paused snapshot", () => {
    const cached = { source_id: "cached" };
    const incoming = { source_id: "incoming" };

    expect(
      selectFrameForPresentation({
        incomingFrame: incoming,
        isPaused: true,
        isStandby: false,
        pauseSnapshotEnabled: true,
        cachedFrame: cached,
      }),
    ).toBe(incoming);
  });

  it("uses the cached frame only for paused or standby presentation", () => {
    const cached = { source_id: "cached" };

    expect(
      selectFrameForPresentation({
        incomingFrame: null,
        isPaused: true,
        isStandby: false,
        pauseSnapshotEnabled: true,
        cachedFrame: cached,
      }),
    ).toBe(cached);

    expect(
      selectFrameForPresentation({
        incomingFrame: null,
        isPaused: false,
        isStandby: false,
        pauseSnapshotEnabled: true,
        cachedFrame: cached,
      }),
    ).toBeNull();
  });

  it("rejects a frame owned by a different source", () => {
    const decision = resolveFramePresentation({
      currentFrame: {
        source_id: "source-b",
        iq_data: new Uint8Array([1, 2]),
      },
      expectedSourceId: "source-a",
      lastPresentedSourceId: "source-a",
      lastRenderableFrame: null,
      isStandby: false,
      presentationPolicy: {
        clearStalePresentation: true,
        suppressStaleFrames: true,
        preserveMatchingPresentation: false,
      },
      awaitingDeviceData: false,
      isLoadingPlaceholder: false,
      isDeviceConnected: true,
      placeholderErrorReason: null,
      explicitPlaceholderState: null,
      hasPresentedSpectrumFrame: true,
    });

    expect(decision.isCurrentSourceFrame).toBe(false);
    expect(decision.hasCurrentSourceFrame).toBe(false);
    expect(decision.hasRenderableFrame).toBe(false);
  });

  it("prioritizes an explicit standby placeholder", () => {
    const decision = resolveFramePresentation({
      currentFrame: null,
      expectedSourceId: "source-a",
      lastPresentedSourceId: "source-a",
      lastRenderableFrame: null,
      isStandby: true,
      awaitingDeviceData: false,
      isLoadingPlaceholder: false,
      isDeviceConnected: true,
      placeholderErrorReason: null,
      explicitPlaceholderState: {
        kind: "idle",
        title: "Standby",
      },
      hasPresentedSpectrumFrame: true,
    });

    expect(decision.isExplicitStandbyPlaceholder).toBe(true);
    expect(decision.blockingPlaceholderKind).toBe(1);
  });

  it("preserves an existing presentation during a connected frame gap", () => {
    const decision = resolveFramePresentation({
      currentFrame: null,
      expectedSourceId: "source-a",
      lastPresentedSourceId: "source-a",
      lastRenderableFrame: null,
      isStandby: false,
      awaitingDeviceData: false,
      isLoadingPlaceholder: false,
      isDeviceConnected: true,
      placeholderErrorReason: null,
      explicitPlaceholderState: null,
      hasPresentedSpectrumFrame: true,
    });

    expect(decision.preservePresentationDuringGap).toBe(true);
    expect(decision.showLoadingPlaceholder).toBe(false);
    expect(decision.showErrorPlaceholder).toBe(false);
  });

  it("preserves the painted graph under a standby top-bar while awaiting a frame", () => {
    const decision = resolveFramePresentation({
      currentFrame: null,
      expectedSourceId: "mock-tx",
      lastPresentedSourceId: "mock-apt",
      lastRenderableFrame: null,
      isStandby: true,
      awaitingDeviceData: false,
      isLoadingPlaceholder: false,
      isDeviceConnected: true,
      placeholderErrorReason: null,
      explicitPlaceholderState: {
        kind: "top-bar",
        title: "Start Tx to transmit",
      },
      hasPresentedSpectrumFrame: true,
    });

    expect(decision.preservePresentationDuringGap).toBe(true);
    expect(decision.shouldClearStaleStandby).toBe(false);
  });
});
