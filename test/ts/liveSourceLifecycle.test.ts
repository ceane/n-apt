import {
  attachLiveSourceLifecyclePlaceholder,
  buildLiveSourceLifecycleTrace,
  isCurrentSourceFrameReady,
  resolveLiveSourcePresentationPolicy,
  resolveLiveSourceLifecycle,
  resolvePausedFramePresentation,
  shouldClearPausedStandbyPresentation,
  shouldRequestMockTxStandbyPreview,
  shouldPresentMockTxStandby,
} from "../../src/ts/hooks/liveSourceLifecycle";

const handoffPlaceholder = {
  kind: "loading" as const,
  paneLabel: "FFT",
  sourceLabel: "Mock Tx SDR",
  message: "Waiting for the first frame to arrive.",
};

describe("resolveLiveSourceLifecycle", () => {
  test("clears paused standby when the painted frame belongs to the old source", () => {
    expect(
      shouldClearPausedStandbyPresentation({
        isStandby: true,
        selectedSourceId: "mock-tx",
        presentedSourceId: "mock-apt",
        readiness: null,
      }),
    ).toBe(true);
    expect(
      shouldClearPausedStandbyPresentation({
        isStandby: true,
        selectedSourceId: "mock-tx",
        presentedSourceId: "mock-tx",
        readiness: { sourceId: "mock-tx", streamEpoch: 12, sequence: 1 },
      }),
    ).toBe(false);
  });
  test("isolates a paused frame to its source label", () => {
    expect(
      resolvePausedFramePresentation({
        isPaused: true,
        isStandby: false,
        frameSourceId: "mock-apt",
        frameSourceName: "Mock APT SDR",
      }),
    ).toEqual({ sourceId: "mock-apt", label: "Mock APT SDR" });
    expect(
      resolvePausedFramePresentation({
        isPaused: true,
        isStandby: false,
        frameSourceId: "mock-apt",
        frameSourceName: null,
      }),
    ).toEqual({ sourceId: "mock-apt", label: "mock-apt" });
    expect(
      resolvePausedFramePresentation({
        isPaused: false,
        isStandby: false,
        frameSourceId: "mock-apt",
        frameSourceName: "Mock APT SDR",
      }),
    ).toBeNull();
    expect(
      resolvePausedFramePresentation({
        isPaused: false,
        isStandby: true,
        frameSourceId: "mock-tx",
        frameSourceName: "Mock Tx SDR",
      }),
    ).toEqual({ sourceId: "mock-tx", label: "Mock Tx SDR" });
  });
  test("does not flash Mock Tx standby while transport departs for Mock APT", () => {
    expect(
      shouldPresentMockTxStandby({
        isSelectedMockTxSource: true,
        isSelectedMockTxTransmitting: false,
        selectedSourceId: "mock-tx",
        transportSourceId: "mock-apt",
        transportPhase: "warming",
      }),
    ).toBe(false);
    expect(
      shouldPresentMockTxStandby({
        isSelectedMockTxSource: true,
        isSelectedMockTxTransmitting: false,
        selectedSourceId: "mock-tx",
        transportSourceId: "mock-apt",
        transportPhase: "idle",
      }),
    ).toBe(false);
    expect(
      shouldPresentMockTxStandby({
        isSelectedMockTxSource: true,
        isSelectedMockTxTransmitting: false,
        selectedSourceId: "mock-tx",
        transportSourceId: "mock-tx",
        transportPhase: "ready",
      }),
    ).toBe(true);
  });

  test("does not present or request Tx standby when Mock Tx is paused in Rx mode", () => {
    expect(
      shouldPresentMockTxStandby({
        isSelectedMockTxSource: true,
        isSelectedMockTxTransmitting: false,
        isSelectedMockTxPaused: true,
        selectedSourceId: "mock-tx",
        transportSourceId: "mock-tx",
        transportPhase: "ready",
      }),
    ).toBe(false);
    expect(
      shouldRequestMockTxStandbyPreview({
        isSelectedMockTxSource: true,
        isSelectedMockTxTransmitting: false,
        isSelectedMockTxPaused: true,
        isConnected: true,
        phase: "standby",
      }),
    ).toBe(false);
  });

  test("requests a source-owned Mock Tx preview while the device swap is warming", () => {
    expect(
      shouldRequestMockTxStandbyPreview({
        isSelectedMockTxSource: true,
        isSelectedMockTxTransmitting: false,
        isConnected: true,
        phase: "warming-transport",
      }),
    ).toBe(true);
    expect(
      shouldRequestMockTxStandbyPreview({
        isSelectedMockTxSource: true,
        isSelectedMockTxTransmitting: false,
        isConnected: true,
        phase: "disconnected",
      }),
    ).toBe(false);
    expect(
      shouldRequestMockTxStandbyPreview({
        isSelectedMockTxSource: true,
        isSelectedMockTxTransmitting: true,
        isConnected: true,
        phase: "standby",
      }),
    ).toBe(false);
  });

  test("accepts the frame-pump readiness boundary for the current source epoch", () => {
    expect(
      isCurrentSourceFrameReady({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        expectedStreamEpoch: 4,
        readiness: { sourceId: "mock-apt", streamEpoch: 4, sequence: 1 },
      }),
    ).toBe(true);
    expect(
      isCurrentSourceFrameReady({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        expectedStreamEpoch: 4,
        readiness: { sourceId: "mock-apt", streamEpoch: 3, sequence: 99 },
      }),
    ).toBe(false);
  });

  test("models transport warm-up, device commit, and first-frame readiness explicitly", () => {
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        transportSourceId: "mock-tx",
        transportPhase: "warming",
        hasValidFrame: false,
        deviceStatus: "connected",
        handoffPlaceholder,
      }).phase,
    ).toBe("warming-transport");

    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        transportSourceId: "mock-tx",
        transportPhase: "ready",
        hasValidFrame: false,
        deviceStatus: "connected",
        handoffPlaceholder,
      }).phase,
    ).toBe("swapping-device");

    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
        transportSourceId: "mock-tx",
        transportPhase: "ready",
        hasValidFrame: false,
        deviceStatus: "connected",
        handoffPlaceholder,
      }).phase,
    ).toBe("awaiting-frame");
  });

  test("presents Mock Tx standby during its mock-to-mock handoff", () => {
    const lifecycle = resolveLiveSourceLifecycle({
      selectedSourceId: "mock-tx",
      activeSourceId: "mock-apt",
      transportSourceId: "mock-tx",
      transportPhase: "warming",
      hasValidFrame: false,
      deviceStatus: "connected",
      handoffPlaceholder,
    });
    const standbyPlaceholder = {
      kind: "top-bar" as const,
      title: "Start Tx to transmit",
    };

    expect(
      attachLiveSourceLifecyclePlaceholder(lifecycle, {
        handoffPlaceholder,
        standbyPlaceholder,
      }),
    ).toMatchObject({
      phase: "warming-transport",
      placeholder: standbyPlaceholder,
    });
  });

  test("lets a valid current-source frame override lagging recovery status", () => {
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "rtl-sdr-v4",
        transportSourceId: "rtl-sdr-v4",
        transportPhase: "ready",
        hasValidFrame: true,
        deviceStatus: "stale",
        handoffPlaceholder,
      }),
    ).toMatchObject({ phase: "ready", placeholder: null });
  });

  test("keeps an active Mock Tx standby overlay after its preview frame renders", () => {
    const standbyPlaceholder = {
      kind: "top-bar" as const,
      title: "Start Tx to transmit",
    };
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
        transportSourceId: "mock-tx",
        transportPhase: "ready",
        hasValidFrame: true,
        deviceStatus: "connected",
        isStandby: true,
        standbyPlaceholder,
      }),
    ).toMatchObject({ phase: "standby", placeholder: standbyPlaceholder });
  });

  test("owns standby source retention and stale-frame clearing in the lifecycle", () => {
    expect(
      resolveLiveSourcePresentationPolicy({
        phase: "standby",
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
        readiness: null,
        presentedSourceId: "mock-apt",
        isStandby: true,
      }),
    ).toMatchObject({
      suppressStaleFrames: false,
      clearStalePresentation: true,
      preserveMatchingPresentation: false,
    });
    expect(
      resolveLiveSourcePresentationPolicy({
        phase: "standby",
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
        readiness: { sourceId: "mock-tx", streamEpoch: 4, sequence: 9 },
        presentedSourceId: null,
        isStandby: true,
      }),
    ).toMatchObject({
      suppressStaleFrames: false,
      clearStalePresentation: true,
      preserveMatchingPresentation: false,
    });
    expect(
      resolveLiveSourcePresentationPolicy({
        phase: "standby",
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
        readiness: { sourceId: "mock-tx", streamEpoch: 4, sequence: 10 },
        presentedSourceId: "mock-tx",
        isStandby: true,
      }),
    ).toMatchObject({
      clearStalePresentation: false,
      preserveMatchingPresentation: true,
    });
  });

  test("clears the painted device immediately when a hardware handoff starts", () => {
    expect(
      resolveLiveSourcePresentationPolicy({
        phase: "swapping-device",
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "hackrf-one",
        readiness: null,
        presentedSourceId: "hackrf-one",
        isStandby: false,
      }),
    ).toMatchObject({
      suppressStaleFrames: true,
      clearStalePresentation: true,
      preserveMatchingPresentation: false,
    });
  });

  test("keeps recovery and terminal switch failure distinct", () => {
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "rtl-sdr-v4",
        transportSourceId: "rtl-sdr-v4",
        transportPhase: "ready",
        hasValidFrame: false,
        deviceStatus: "loose",
        devicePlaceholder: {
          kind: "loading",
          paneLabel: "device",
          sourceLabel: "RTL-SDR V4",
        },
        handoffPlaceholder,
      }).phase,
    ).toBe("recovering");

    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        transportSourceId: "mock-tx",
        transportPhase: "failed",
        transportError: "Mock Tx failed to start",
        hasValidFrame: false,
        deviceStatus: "connected",
        handoffPlaceholder,
      }),
    ).toMatchObject({
      phase: "failed",
      placeholder: { kind: "error", reason: "Mock Tx failed to start" },
    });
  });

  test("assigns transition traces to one frontend owner and suppresses duplicates", () => {
    const lifecycle = resolveLiveSourceLifecycle({
      selectedSourceId: "mock-tx",
      activeSourceId: "mock-apt",
      transportSourceId: "mock-tx",
      transportPhase: "warming",
      hasValidFrame: false,
      deviceStatus: "connected",
      handoffPlaceholder,
    });

    expect(
      buildLiveSourceLifecycleTrace(null, lifecycle, 7, "warming"),
    ).toMatchObject({
      owner: "SpectrumRoute/live-source-lifecycle",
      render: 7,
      from: null,
      to: "warming-transport",
    });
    expect(
      buildLiveSourceLifecycleTrace(lifecycle, lifecycle, 8, "warming"),
    ).toBeNull();
  });
});
