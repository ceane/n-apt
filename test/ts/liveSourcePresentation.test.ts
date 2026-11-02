import {
  isTxStandbyPreviewSource,
  resolveLiveSourceLifecycle,
} from "@n-apt/spectrum/public/liveSourceLifecycle";
import type { CanvasPlaceholderState } from "@n-apt/ui/CanvasPlaceholder";

describe("Tx standby preview ownership", () => {
  it("pauses a default-flow Tx-only source for a one-shot preview", () => {
    expect(
      isTxStandbyPreviewSource({
        sourceRole: undefined,
        capability: "tx",
        status: "connected",
      }),
    ).toBe(true);
  });

  it("does not pause a default-flow receive source", () => {
    expect(
      isTxStandbyPreviewSource({
        sourceRole: undefined,
        capability: "rx",
        status: "connected",
      }),
    ).toBe(false);
  });

  it("keeps a role-bound Tx preview paused until transmission starts", () => {
    expect(
      isTxStandbyPreviewSource({
        sourceRole: "tx",
        capability: "tx_rx",
        status: "connected",
      }),
    ).toBe(true);
    expect(
      isTxStandbyPreviewSource({
        sourceRole: "tx",
        capability: "tx_rx",
        status: "transmitting",
      }),
    ).toBe(false);
  });
});

describe("resolveLiveSourceLifecycle", () => {
  it("gives a validated frame precedence over recovery and handoff states", () => {
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "hackrf-one",
        hasValidFrame: true,
        deviceStatus: "connected",
        devicePlaceholder: { kind: "loading", paneLabel: "device" },
      }),
    ).toMatchObject({ phase: "warming-transport" });
  });

  it("keeps explicit failures blocking", () => {
    const error: CanvasPlaceholderState = { kind: "error", reason: "USB failure" };
    expect(
      resolveLiveSourceLifecycle({
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "rtl-sdr-v4",
        hasValidFrame: true,
        deviceStatus: "connected",
        devicePlaceholder: error,
      }),
    ).toMatchObject({ phase: "failed", placeholder: error });
  });
});
