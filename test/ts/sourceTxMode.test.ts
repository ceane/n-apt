import { isSourceInTxMode } from "../../src/ts/utils/sourceTxMode";

describe("isSourceInTxMode", () => {
  const halfDuplexSource = {
    id: "hackrf-1",
    capability: "tx_rx",
    status: "streaming",
  };

  it("keeps a half-duplex source in Rx mode while it is streaming", () => {
    expect(isSourceInTxMode({ source: halfDuplexSource })).toBe(false);
  });

  it("keeps a half-duplex source in Rx mode when standby means paused Rx", () => {
    expect(
      isSourceInTxMode({
        source: { ...halfDuplexSource, status: "standby" },
      }),
    ).toBe(false);
  });

  it("enters Tx mode when the source is bound to the Tx preview", () => {
    expect(
      isSourceInTxMode({
        source: halfDuplexSource,
        txBindingSourceId: "hackrf-1",
      }),
    ).toBe(true);
  });

  it("treats Tx-only sources as already being in Tx mode", () => {
    expect(
      isSourceInTxMode({
        source: { id: "mock-tx", capability: "tx", status: "connected" },
      }),
    ).toBe(true);
  });
});
