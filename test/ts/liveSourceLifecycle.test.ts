import {
  isControlPlaneUnavailable,
  isCurrentSourceFrameReady,
  isSelectedSourceFrameReady,
  resolveSelectedSourceFrameReadiness,
  resolveLiveSourceLifecycleErrorReason,
  resolveLiveSourcePresentationPolicy,
  resolveLiveSourceLifecycle,
  resolvePausedFramePresentation,
  shouldClearPausedStandbyPresentation,
  shouldRequestMockTxStandbyPreview,
  isCommittedStandbyPresentation,
  shouldPresentMockTxStandby,
  selectSourceFrameReadinessForMode,
  selectSourceTransportForMode,
} from "@n-apt/spectrum/public/liveSourceLifecycle";
import type { SourceTransportLifecycle } from "@n-apt/spectrum/public/liveSourceLifecycle";
import {
  resolveFrameReadiness,
  resolveLiveDevicePlaceholderState,
} from "@n-apt/spectrum/public/liveSourceLifecycle";

const handoffPlaceholder = {
  kind: "loading" as const,
  paneLabel: "FFT",
  sourceLabel: "Mock Tx SDR",
  message: "Waiting for the first frame to arrive.",
};

describe("resolveLiveSourceLifecycle", () => {
  test("selects transport and painted readiness for the presented mode", () => {
    const rxTransport: SourceTransportLifecycle = {
      sourceId: "mock-apt",
      phase: "ready",
      error: null,
    };
    const txTransport: SourceTransportLifecycle = {
      sourceId: "mock-tx",
      phase: "warming",
      error: null,
    };
    const rxReadiness = {
      sourceId: "mock-apt",
      streamEpoch: 4,
      sequence: 11,
    };
    const txReadiness = {
      sourceId: "mock-tx",
      streamEpoch: 2,
      sequence: 3,
    };

    expect(
      selectSourceTransportForMode(
        "rx",
        { rx: rxTransport, tx: txTransport },
        txTransport,
      ),
    ).toBe(rxTransport);
    expect(
      selectSourceTransportForMode(
        "tx",
        { rx: rxTransport, tx: txTransport },
        rxTransport,
      ),
    ).toBe(txTransport);
    expect(
      selectSourceFrameReadinessForMode(
        "tx",
        { rx: rxReadiness, tx: txReadiness },
        rxReadiness,
      ),
    ).toBe(txReadiness);
    expect(
      selectSourceFrameReadinessForMode(
        "tx",
        { rx: rxReadiness, tx: null },
        rxReadiness,
      ),
    ).toBeNull();
  });

  test("does not synthesize an I/O error over authoritative receiving", () => {
    expect(
      resolveLiveDevicePlaceholderState({
        deviceState: "receiving",
        sourceLabel: "RTL-SDR",
      }),
    ).toBeNull();
  });

  test("preserves an explicit backend error over the awaiting-frame loader", () => {
    const lifecycle = resolveLiveSourceLifecycle({
      selectedSourceId: "rtl-sdr",
      activeSourceId: "rtl-sdr",
      transportSourceId: "rtl-sdr",
      transportPhase: "ready",
      hasValidFrame: false,
      deviceStatus: "receiving",
      devicePlaceholder: {
        kind: "error",
        title: "I/O Device Error",
        sourceLabel: "RTL-SDR",
        reason: "No frames received",
        message: "No I/Q frames are arriving.",
      },
    });

    expect(lifecycle.placeholder).toMatchObject({
      kind: "error",
      title: "I/O Device Error",
    });
  });

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

  test("commits standby only when the selected source owns the active stream", () => {
    const rapidToggleStates = [
      { requested: true, activeSourceId: "mock-apt" },
      { requested: false, activeSourceId: "mock-tx" },
      { requested: true, activeSourceId: "mock-tx" },
      { requested: false, activeSourceId: "mock-tx" },
    ];

    expect(
      rapidToggleStates.map(({ requested, activeSourceId }) =>
        isCommittedStandbyPresentation({
          requested,
          selectedSourceId: "mock-tx",
          activeSourceId,
          isTransmitting: false,
        }),
      ),
    ).toEqual([false, false, true, false]);

    expect(
      isCommittedStandbyPresentation({
        requested: true,
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        presentedSourceId: "mock-tx",
        isTransmitting: false,
      }),
    ).toBe(true);
    expect(
      isCommittedStandbyPresentation({
        requested: true,
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        presentedSourceId: "mock-apt",
        isTransmitting: false,
      }),
    ).toBe(false);
  });

  test("commits initial standby while the active source id is still warming", () => {
    expect(
      isCommittedStandbyPresentation({
        requested: true,
        selectedSourceId: "mock-tx",
        activeSourceId: null,
        isTransmitting: false,
      }),
    ).toBe(true);
    expect(
      isCommittedStandbyPresentation({
        requested: true,
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        isTransmitting: false,
      }),
    ).toBe(false);
  });

  test("requests a Mock Tx standby preview immediately during handoff and cold start", () => {
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
        phase: "standby",
      }),
    ).toBe(true);
    expect(
      shouldRequestMockTxStandbyPreview({
        isSelectedMockTxSource: true,
        isSelectedMockTxTransmitting: false,
        isConnected: true,
        phase: "awaiting-frame",
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

  test("accepts manager-owned readiness when no legacy source epoch is supplied", () => {
    expect(
      isCurrentSourceFrameReady({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        expectedStreamEpoch: null,
        readiness: { sourceId: "mock-apt", streamEpoch: 29, sequence: 8132 },
      }),
    ).toBe(true);
    expect(
      resolveFrameReadiness({
        frame: {
          source_id: "mock-apt",
          protocol_version: 2,
          stream_epoch: 29,
          iq_data: new Uint8Array([128, 129]),
        },
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        expectedStreamEpoch: null,
        frameCounter: 1,
        handoffStartedFrameCounter: 0,
      }),
    ).toBe(true);
  });

  test("accepts subscriber-local Tx readiness while RX remains globally active", () => {
    expect(
      isSelectedSourceFrameReady({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        mode: "tx",
        expectedStreamEpoch: 7,
        readiness: { sourceId: "mock-tx", streamEpoch: 7, sequence: 12 },
      }),
    ).toBe(true);
    expect(
      isSelectedSourceFrameReady({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        mode: "rx",
        expectedStreamEpoch: 7,
        readiness: { sourceId: "mock-tx", streamEpoch: 7, sequence: 12 },
      }),
    ).toBe(false);
    expect(
      resolveSelectedSourceFrameReadiness({
        frame: {
          source_id: "mock-tx",
          protocol_version: 2,
          stream_epoch: 7,
          iq_data: new Uint8Array([128, 129]),
        },
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        mode: "tx",
        expectedStreamEpoch: 7,
        frameCounter: 1,
        handoffStartedFrameCounter: 0,
      }),
    ).toBe(true);
  });

  test("accepts subscriber-local RX readiness while another source owns TX", () => {
    expect(
      isSelectedSourceFrameReady({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        mode: "rx",
        subscriberLocalRxView: true,
        expectedStreamEpoch: 8,
        readiness: { sourceId: "mock-apt", streamEpoch: 8, sequence: 14 },
      }),
    ).toBe(true);
    expect(
      resolveSelectedSourceFrameReadiness({
        frame: {
          source_id: "mock-apt",
          protocol_version: 2,
          stream_epoch: 8,
          iq_data: new Uint8Array([128, 129]),
        },
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        mode: "rx",
        subscriberLocalRxView: true,
        expectedStreamEpoch: 8,
        frameCounter: 1,
        handoffStartedFrameCounter: 0,
      }),
    ).toBe(true);
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

  test("does not keep the handoff placeholder after the selected source frame arrives", () => {
    const lifecycle = resolveLiveSourceLifecycle({
      selectedSourceId: "mock-tx",
      activeSourceId: "mock-apt",
      transportSourceId: "mock-tx",
      transportPhase: "ready",
      sourceHandoffPending: true,
      hasValidFrame: true,
      readiness: {
        sourceId: "mock-tx",
        streamEpoch: 8,
        sequence: 14,
      },
      deviceStatus: "receiving",
      isConnected: true,
      connectionStatus: "connected",
      hasConnectedOnce: true,
      handoffPlaceholder,
    });

    expect(lifecycle).toMatchObject({
      phase: "ready",
      placeholder: null,
    });
  });

  test("does not enter handoff placeholder for a foreign active-source change", () => {
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        transportSourceId: "mock-apt",
        transportPhase: "ready",
        sourceHandoffPending: false,
        hasValidFrame: true,
        deviceStatus: "receiving",
        isConnected: true,
        connectionStatus: "connected",
        hasConnectedOnce: true,
        handoffPlaceholder,
      }),
    ).toMatchObject({
      phase: "ready",
      placeholder: null,
    });
  });

  test("keeps Loading FFT during the first connect instead of flashing Server Down", () => {
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        transportSourceId: "mock-apt",
        transportPhase: "warming",
        hasValidFrame: false,
        deviceStatus: "loading",
        isConnected: false,
        connectionStatus: "connecting",
        hasConnectedOnce: false,
        handoffPlaceholder,
      }),
    ).toMatchObject({
      phase: "recovering",
    });

    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-apt",
        activeSourceId: null,
        transportSourceId: null,
        transportPhase: "idle",
        hasValidFrame: false,
        deviceStatus: null,
        isConnected: false,
        connectionStatus: "disconnected",
        hasConnectedOnce: false,
        handoffPlaceholder,
      }).phase,
    ).toBe("warming-transport");
  });

  test("attaches a Loading placeholder for Mock Tx → Mock APT awaiting-frame", () => {
    const lifecycle = resolveLiveSourceLifecycle({
      selectedSourceId: "mock-apt",
      activeSourceId: "mock-apt",
      transportSourceId: "mock-apt",
      transportPhase: "warming",
      hasValidFrame: false,
      deviceStatus: "connected",
      isConnected: true,
      connectionStatus: "connected",
      hasConnectedOnce: true,
    });
    expect(lifecycle.phase).toBe("awaiting-frame");

    expect(lifecycle.placeholder).toMatchObject({
      kind: "loading",
      message: "Waiting for the first frame to arrive.",
    });
    expect(resolveLiveSourceLifecycleErrorReason(lifecycle)).toBeNull();
  });

  test("never reports Server Down during a healthy connected source handoff", () => {
    expect(
      isControlPlaneUnavailable({
        isConnected: true,
        connectionStatus: "connected",
        hasConnectedOnce: true,
        sourceHandoffPending: true,
        transportPhase: "warming",
      }),
    ).toBe(false);

    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        transportSourceId: "mock-tx",
        transportPhase: "warming",
        hasValidFrame: false,
        deviceStatus: "connected",
        isConnected: true,
        connectionStatus: "connected",
        hasConnectedOnce: true,
        handoffPlaceholder,
      }).phase,
    ).toBe("warming-transport");
  });

  test("does not treat sticky stream/source errors as Server Down while the control socket is open", () => {
    // File → Mock Tx can poison connectionStatus via stream subscribe / stream_error
    // without closing the control plane. Mock APT must not inherit Server Down.
    expect(
      isControlPlaneUnavailable({
        isConnected: true,
        connectionStatus: "error",
        hasConnectedOnce: true,
        sourceHandoffPending: true,
        transportPhase: "warming",
      }),
    ).toBe(false);

    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        transportSourceId: "mock-apt",
        transportPhase: "warming",
        hasValidFrame: false,
        deviceStatus: "connected",
        isConnected: true,
        connectionStatus: "error",
        hasConnectedOnce: true,
        handoffPlaceholder,
      }).phase,
    ).toBe("warming-transport");
  });

  test("still reports Server Down for a hard control-plane error after disconnect", () => {
    expect(
      isControlPlaneUnavailable({
        isConnected: false,
        connectionStatus: "error",
        hasConnectedOnce: true,
      }),
    ).toBe(true);
  });

  test("keeps Server Down when disconnected even if stale warming metadata remains", () => {
    expect(
      isControlPlaneUnavailable({
        isConnected: false,
        connectionStatus: "disconnected",
        hasConnectedOnce: true,
        sourceHandoffPending: true,
        transportPhase: "warming",
      }),
    ).toBe(true);
  });

  test("still reports Server Down after a live session is lost with no handoff", () => {
    expect(
      isControlPlaneUnavailable({
        isConnected: false,
        connectionStatus: "disconnected",
        hasConnectedOnce: true,
        sourceHandoffPending: false,
        transportPhase: "idle",
      }),
    ).toBe(true);
  });

  test("keeps Server Down during reconnect polling after a live session", () => {
    // Middleware softDisconnect → Server Down, then backoff setReconnecting /
    // setConnecting. Those attempts must not flash Loading while the backend
    // is still dead.
    expect(
      isControlPlaneUnavailable({
        isConnected: false,
        connectionStatus: "reconnecting",
        hasConnectedOnce: true,
        sourceHandoffPending: false,
        transportPhase: "idle",
      }),
    ).toBe(true);

    expect(
      isControlPlaneUnavailable({
        isConnected: false,
        connectionStatus: "connecting",
        hasConnectedOnce: true,
        sourceHandoffPending: false,
        transportPhase: "idle",
      }),
    ).toBe(true);

    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        transportSourceId: "mock-apt",
        transportPhase: "idle",
        hasValidFrame: false,
        deviceStatus: "receiving",
        isConnected: false,
        connectionStatus: "reconnecting",
        hasConnectedOnce: true,
        handoffPlaceholder,
      }).phase,
    ).toBe("failed");
  });

  test("shows Server Down only after a live control session is lost", () => {
    const lifecycle = resolveLiveSourceLifecycle({
      selectedSourceId: "mock-apt",
      activeSourceId: "mock-apt",
      transportSourceId: "mock-apt",
      transportPhase: "idle",
      hasValidFrame: false,
      deviceStatus: "receiving",
      isConnected: false,
      connectionStatus: "disconnected",
      hasConnectedOnce: true,
      handoffPlaceholder,
    });

    expect(lifecycle.phase).toBe("failed");
    expect(lifecycle.placeholder).toMatchObject({
      kind: "error",
      reason: "Server down",
    });
    expect(lifecycle.placeholder).toMatchObject({
      kind: "error",
      reason: "Server down",
    });
  });

  test("keeps a ready source stream alive during a control-plane reconnect", () => {
    const lifecycle = resolveLiveSourceLifecycle({
      selectedSourceId: "whole-channel",
      activeSourceId: "whole-channel",
      transportSourceId: "whole-channel",
      transportPhase: "ready",
      hasValidFrame: true,
      deviceStatus: "receiving",
      isConnected: false,
      connectionStatus: "reconnecting",
      hasConnectedOnce: true,
    });

    expect(lifecycle.phase).toBe("ready");
    expect(lifecycle.placeholder).toBeNull();
  });

  test("uses Loading during Mock Tx handoff instead of a black canvas under standby", () => {
    const lifecycle = resolveLiveSourceLifecycle({
      selectedSourceId: "mock-tx",
      activeSourceId: "mock-apt",
      transportSourceId: "mock-tx",
      transportPhase: "warming",
      hasValidFrame: false,
      deviceStatus: "connected",
      isStandby: true,
      handoffPlaceholder,
    });
    const _standbyPlaceholder = {
      kind: "top-bar" as const,
      title: "Start Tx to transmit",
    };

    // Handoff owns Loading. Standby top-bar alone must not win (black FFT).
    expect(lifecycle.phase).toBe("warming-transport");
    expect(lifecycle).toMatchObject({
      phase: "warming-transport",
      placeholder: handoffPlaceholder,
    });
  });

  test("keeps Loading for committed Mock Tx standby until a preview frame exists", () => {
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
        transportSourceId: "mock-tx",
        transportPhase: "ready",
        hasValidFrame: false,
        deviceStatus: "standby",
        isStandby: true,
        isConnected: true,
        connectionStatus: "connected",
        hasConnectedOnce: true,
      }),
    ).toMatchObject({
      phase: "awaiting-frame",
      placeholder: {
        kind: "loading",
        message: "Waiting for the first frame to arrive.",
      },
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

  test("loading wins over a stale renderable frame so a loading HackRF never shows a blank canvas", () => {
    // A stale frame (previous source / earlier epoch) must not flip the
    // lifecycle to `ready` while the selected source is still `loading` —
    // that suppresses the loading placeholder and leaves a blank/black FFT
    // after Resume. Loading keeps the placeholder until a fresh frame lands.
    const devicePlaceholder = resolveLiveDevicePlaceholderState({
      deviceState: "loading",
      sourceLabel: "HackRF One",
      hasRenderableCurrentFrame: true,
    });
    expect(devicePlaceholder?.kind).toBe("loading");
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "hackrf-1",
        activeSourceId: "hackrf-1",
        transportSourceId: "hackrf-1",
        transportPhase: "ready",
        hasValidFrame: true,
        deviceStatus: "loading",
        devicePlaceholder,
        handoffPlaceholder,
      }),
    ).toMatchObject({ phase: "recovering", placeholder: { kind: "loading" } });
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

  test("does not re-enter Loading after a standby preview is accepted", () => {
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
        transportSourceId: "mock-tx",
        transportPhase: "ready",
        // The middleware's accepted-frame readiness can arrive before the
        // canvas callback updates route-local painted-frame state.
        hasValidFrame: false,
        hasRenderableCurrentFrame: false,
        readiness: {
          sourceId: "mock-tx",
          streamEpoch: 4,
          sequence: 1,
        },
        deviceStatus: "standby",
        isStandby: true,
        isConnected: true,
        connectionStatus: "connected",
        hasConnectedOnce: true,
      }),
    ).toMatchObject({
      phase: "standby",
      placeholder: { kind: "top-bar", title: "Start Tx to transmit" },
    });
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

  test("does not suppress a selected source when another client changes active source", () => {
    expect(
      resolveLiveSourcePresentationPolicy({
        phase: "ready",
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        sourceHandoffPending: false,
        readiness: { sourceId: "mock-apt", streamEpoch: 4, sequence: 10 },
        presentedSourceId: "mock-apt",
        isStandby: false,
      }),
    ).toMatchObject({
      suppressStaleFrames: false,
      clearStalePresentation: false,
      preserveMatchingPresentation: false,
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
        deviceStatus: "stale",
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
});
