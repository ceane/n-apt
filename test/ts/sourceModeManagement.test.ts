import {
  resolveSourceModeManagement,
  resolveSourceModeTransition,
  resolveTxStopTransition,
} from "../../src/ts/utils/sourceModeManagement";

describe("sourceModeManagement", () => {
  it.each([
    ["simplex Rx", { capability: "rx", duplex_mode: "simplex" }, "rx"],
    ["simplex Tx", { capability: "tx", duplex_mode: "simplex" }, "tx"],
    [
      "paused half-duplex Rx",
      { capability: "tx_rx", duplex_mode: "half_duplex", status: "standby" },
      "rx",
    ],
    [
      "half-duplex Tx binding",
      { id: "hackrf-1", capability: "tx_rx", duplex_mode: "half_duplex" },
      "tx",
      "hackrf-1",
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
    const [_label, source, expectedMode, txBindingSourceId] = args as [
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
    expect(state.shouldRequestTxPreview).toBe(expectedMode === "tx");
  });

  it("uses the explicit active duplex mode when the backend provides it", () => {
    expect(
      resolveSourceModeManagement({
        source: {
          capability: "tx_rx",
          duplex_mode: "half_duplex",
          active_duplex_mode: "tx",
          status: "standby",
        },
      }),
    ).toMatchObject({
      duplexMode: "half_duplex",
      activeDuplexMode: "tx",
      viewMode: "tx",
      shouldShowTxControls: true,
    });
  });

  it("normalizes plural active duplex modes into rx_tx", () => {
    expect(
      resolveSourceModeManagement({
        source: {
          capability: "tx_rx",
          duplex_mode: "duplex",
          active_duplex_modes: ["rx", "tx"],
        },
      }),
    ).toMatchObject({
      duplexMode: "duplex",
      activeDuplexMode: "rx_tx",
      viewMode: "rx",
    });
  });

  it("returns a deterministic Rx handoff that clears Tx and requests an Rx frame", () => {
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
      actions: ["clear_tx_binding", "resume_rx", "request_rx_frame"],
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
});
