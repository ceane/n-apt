import {
  buildLiveStateDiagnosticsSnapshot,
  shouldRenderLiveStateDiagnostics,
  type LiveStateDiagnosticsInput,
} from "@n-apt/app/routes/pages/spectrum/liveStateDiagnostics";

describe("live Redux diagnostics visibility", () => {
  it("does not render the diagnostics panel on the spectrum view", () => {
    expect(shouldRenderLiveStateDiagnostics).toBe(false);
  });
});

describe("buildLiveStateDiagnosticsSnapshot", () => {
  it("keeps Redux, renderer, and managed-stream state visible together", () => {
    const input: LiveStateDiagnosticsInput = {
      redux: {
        connectionStatus: "connected",
        isConnected: true,
        activeSourceId: "rtl-sdr-1",
        activeSourceStatus: "receiving",
        activeSourceMode: "live",
        availableSourceIds: ["rtl-sdr-1", "mock-apt"],
        isPaused: false,
        selectedSourceId: "rtl-sdr-1",
        selectedSourceStatus: "receiving",
        sourceTransportByMode: {
          rx: { sourceId: "rtl-sdr-1", phase: "ready", error: null },
          tx: { sourceId: null, phase: "idle", error: null },
        },
        sourceFrameReadinessByMode: {
          rx: { sourceId: "rtl-sdr-1", streamEpoch: 7, sequence: 12 },
          tx: null,
        },
      },
      renderer: {
        lifecyclePhase: "awaiting-frame",
        placeholderKind: "loading",
        hasRenderableCurrentFrame: false,
        hasPlayedAtLeastOnce: false,
          expectedSourceId: "rtl-sdr-1",
          expectedStreamEpoch: null,
          routeAcceptsLatestFrame: true,
          latestFrame: {
          sourceId: "rtl-sdr-1",
          streamEpoch: 7,
          sequence: 12,
          frameStatus: "receiving",
          iqLength: 2048,
        },
      },
      managedStream: {
        rx: {
          sourceId: "rtl-sdr-1",
          subscribePending: false,
          streamEpoch: 7,
          hasSubscription: true,
        },
        tx: {
          sourceId: null,
          subscribePending: false,
          streamEpoch: null,
          hasSubscription: false,
        },
      },
    };

    expect(buildLiveStateDiagnosticsSnapshot(input)).toMatchObject(input);
  });
});
