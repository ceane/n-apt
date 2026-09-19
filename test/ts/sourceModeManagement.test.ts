import {
  isSourceStreamAvailable,
  isSourcePresentationConnected,
  resolveSourceModeManagement,
  resolveSourceModeTransition,
  resolveTxStopTransition,
  shouldUseSourceOwnedTxPreview,
  shouldRetainTxStandbyAfterStop,
  shouldHoldSourceSubscription,
  canToggleTransmitMode,
  pruneRemovedSourcePauseState,
} from "@n-apt/app/infrastructure/streams/sourceModeManagement";

describe("sourceModeManagement", () => {
  it("drops pause state for a source removed by disconnect fallback", () => {
    const pauseState = new Map([["rtl-sdr-serial", true]]);

    pruneRemovedSourcePauseState(
      [{ id: "rtl-sdr-serial" }],
      [{ id: "mock-apt" }],
      pauseState,
    );

    expect(pauseState.has("rtl-sdr-serial")).toBe(false);
  });

  it("keeps the managed stream subscribed while hardware is waiting for its first frame", () => {
    expect(isSourceStreamAvailable("loading")).toBe(true);
  });

  it("holds the Rx subscription through a stale device without calling it available", () => {
    // Acquisition is subscriber-driven: dropping the last subscriber on a stale
    // device idles the hardware, so the fresh frame that would clear the stale
    // state can never arrive and the UI sits on Loading forever.
    expect(shouldHoldSourceSubscription("stale")).toBe(true);
    expect(shouldHoldSourceSubscription("receiving")).toBe(true);
    expect(shouldHoldSourceSubscription("disconnected")).toBe(false);
    expect(shouldHoldSourceSubscription("error")).toBe(false);
    // The UI invariant this must not break: a stale device is not a usable
    // stream, so the loading placeholder still covers the canvas.
    expect(isSourceStreamAvailable("stale")).toBe(false);
  });

  it("blocks starting TX without a Tx-suite node binding but permits stopping", () => {
    expect(
      canToggleTransmitMode({
        nextEnabled: true,
        sourceId: "hackrf-1",
        txBindingSourceId: null,
        txPreviewSourceId: null,
      }),
    ).toBe(false);
    expect(
      canToggleTransmitMode({
        nextEnabled: false,
        sourceId: "hackrf-1",
        txBindingSourceId: null,
      }),
    ).toBe(true);
    expect(
      canToggleTransmitMode({
        nextEnabled: true,
        sourceId: "hackrf-1",
        txBindingSourceId: "hackrf-1",
      }),
    ).toBe(true);
  });
  it("treats a receiving source as connected before the control socket catches up", () => {
    expect(
      isSourcePresentationConnected({
        controlConnected: false,
        sourceStatus: "receiving",
        sourceTransportReady: false,
        hasFrame: false,
      }),
    ).toBe(true);
  });

  it.each([
    ["simplex Rx", { capability: "rx", duplex_mode: "simplex" }, "rx"],
    ["simplex Tx", { capability: "tx", duplex_mode: "simplex" }, "tx"],
    [
      "receiving half-duplex Rx",
      {
        capability: "tx_rx",
        duplex_mode: "half_duplex",
        status: "receiving",
      },
      "rx",
    ],
    [
      "paused half-duplex Rx",
      {
        capability: "tx_rx",
        duplex_mode: "half_duplex",
        status: "paused",
        paused: true,
      },
      "rx",
    ],
    [
      "stale half-duplex Rx",
      {
        capability: "tx_rx",
        duplex_mode: "half_duplex",
        status: "stale",
      },
      "rx",
    ],
    [
      "half-duplex Tx standby",
      {
        id: "hackrf-1",
        capability: "tx_rx",
        duplex_mode: "half_duplex",
        status: "standby",
      },
      "tx",
    ],
    [
      "duplex Rx view with both active",
      {
        capability: "tx_rx",
        duplex_mode: "duplex",
        active_duplex_mode: "rx_tx",
      },
      "rx",
    ],
  ])("resolves %s as %s", (...args) => {
    const [_label, source, expectedMode, txBindingSourceId] = args as unknown as [
      string,
      Record<string, unknown>,
      string,
      string | undefined,
    ];
    const state = resolveSourceModeManagement({
      source,
      txBindingSourceId,
    });

    expect(state.viewMode).toBe(expectedMode);
    expect(state.shouldShowTxControls).toBe(expectedMode === "tx");
    expect(state.shouldRequestTxPreview).toBe(
      expectedMode === "tx" && source.status !== "transmitting",
    );
  });

  it("uses receiving and paused statuses as the Rx state contract", () => {
    expect(
      resolveSourceModeManagement({
        source: {
          capability: "tx_rx",
          duplex_mode: "half_duplex",
          active_duplex_mode: "tx",
          status: "receiving",
        },
      }),
    ).toMatchObject({
      duplexMode: "half_duplex",
      viewMode: "rx",
      activeDuplexMode: "rx",
      isRxPaused: false,
    });

    expect(
      resolveSourceModeManagement({
        source: {
          capability: "tx_rx",
          duplex_mode: "half_duplex",
          status: "paused",
          paused: true,
        },
      }),
    ).toMatchObject({
      viewMode: "rx",
      activeDuplexMode: "rx",
      isRxPaused: true,
    });
  });

  it("normalizes plural active duplex modes into rx_tx", () => {
    expect(
      resolveSourceModeManagement({
        source: {
          capability: "tx_rx",
          duplex_mode: "duplex",
          active_duplex_modes: ["rx", "tx"],
          status: "receiving",
        },
      }),
    ).toMatchObject({
      duplexMode: "duplex",
      activeDuplexMode: "rx",
      viewMode: "rx",
    });
  });

  it("holds Rx paused when a half-duplex device leaves Tx", () => {
    expect(
      resolveSourceModeTransition({
        sourceId: "hackrf-1",
        duplexMode: "half_duplex",
        fromMode: "tx",
        toMode: "rx",
      }),
    ).toEqual({
      sourceId: "hackrf-1",
      fromMode: "tx",
      toMode: "rx",
      actions: [
        "clear_tx_binding",
        "pause_rx",
        "request_rx_mode",
        "request_rx_frame",
      ],
    });
  });

  it("never pauses Rx when leaving Tx on a source that kept it streaming", () => {
    for (const duplexMode of ["duplex", "simplex"] as const) {
      expect(
        resolveSourceModeTransition({
          sourceId: "device-1",
          duplexMode,
          fromMode: "tx",
          toMode: "rx",
        }),
      ).toEqual({
        sourceId: "device-1",
        fromMode: "tx",
        toMode: "rx",
        actions: ["clear_tx_binding", "request_rx_mode", "request_rx_frame"],
      });
    }
  });

  it("reports no actions when the mode does not change", () => {
    expect(
      resolveSourceModeTransition({
        sourceId: "hackrf-1",
        duplexMode: "half_duplex",
        fromMode: "rx",
        toMode: "rx",
      }),
    ).toEqual({
      sourceId: "hackrf-1",
      fromMode: "rx",
      toMode: "rx",
      actions: [],
    });
  });

  it("enters Tx standby without treating Tx as paused", () => {
    expect(
      resolveSourceModeTransition({
        sourceId: "hackrf-1",
        duplexMode: "half_duplex",
        fromMode: "rx",
        toMode: "tx",
      }),
    ).toMatchObject({
      actions: ["pause_rx", "bind_tx", "enter_tx_standby", "request_tx_preview"],
    });
  });

  it("stops Tx into standby while retaining the Tx view and last frame", () => {
    expect(
      resolveTxStopTransition({
        sourceId: "hackrf-1",
        duplexMode: "half_duplex",
      }),
    ).toEqual({
      sourceId: "hackrf-1",
      fromMode: "tx",
      toMode: "tx",
      actions: ["enter_tx_standby"],
    });
  });

  it("uses the source-owned preview transport while entering Tx standby", () => {
    expect(
      shouldUseSourceOwnedTxPreview({
        isTxPreviewStandby: true,
        isSwitchingLiveSource: false,
      }),
    ).toBe(true);
    expect(
      shouldUseSourceOwnedTxPreview({
        isTxPreviewStandby: false,
        isSwitchingLiveSource: false,
      }),
    ).toBe(false);
  });

  it("retains the Tx standby controls after stopping half-duplex transmission", () => {
    expect(
      shouldRetainTxStandbyAfterStop({
        isTransmitting: true,
        isHalfDuplex: true,
        isTxMode: true,
      }),
    ).toBe(true);
    expect(
      shouldRetainTxStandbyAfterStop({
        isTransmitting: true,
        isHalfDuplex: false,
        isTxMode: true,
      }),
    ).toBe(false);
  });
});
