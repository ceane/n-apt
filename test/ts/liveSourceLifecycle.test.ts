import {
  buildLiveSourceLifecycleTrace,
  isCurrentSourceFrameReady,
  resolveLiveSourceLifecycle,
} from "../../src/ts/routes/spectrum/liveSourceLifecycle";

const handoffPlaceholder = {
  kind: "loading" as const,
  paneLabel: "FFT",
  sourceLabel: "Mock Tx SDR",
  message: "Waiting for the first frame to arrive.",
};

describe("resolveLiveSourceLifecycle", () => {
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
