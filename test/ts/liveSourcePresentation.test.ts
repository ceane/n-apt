import * as presentation from "../../src/ts/utils/liveSourcePresentation";

const resolveFrameReadiness = (
  presentation as typeof presentation & {
    resolveFrameReadiness?: (input: Record<string, unknown>) => boolean;
  }
).resolveFrameReadiness;
const resolveLivePresentationState = (
  presentation as typeof presentation & {
    resolveLivePresentationState?: (input: Record<string, unknown>) => {
      phase: string;
      placeholder: unknown;
    };
  }
).resolveLivePresentationState;

describe("resolveFrameReadiness", () => {
  const currentFrame = {
    type: "spectrum",
    data_type: "iq_raw",
    source_id: "rtl-sdr-v4",
    protocol_version: 2,
    stream_epoch: 7,
    sequence: 11,
    iq_data: new Uint8Array([128, 129]),
  };

  it("accepts a renderable frame for the selected source and epoch", () => {
    expect(
      resolveFrameReadiness?.({
        frame: currentFrame,
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "rtl-sdr-v4",
        expectedStreamEpoch: 7,
        frameCounter: 12,
        handoffStartedFrameCounter: 10,
      }),
    ).toBe(true);
  });

  it.each([
    ["wrong source", { source_id: "hackrf-one" }],
    ["old epoch", { stream_epoch: 6 }],
    ["empty payload", { iq_data: new Uint8Array() }],
  ])("rejects a %s frame", (_name, override) => {
    expect(
      resolveFrameReadiness?.({
        frame: { ...currentFrame, ...override },
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "rtl-sdr-v4",
        expectedStreamEpoch: 7,
        frameCounter: 12,
        handoffStartedFrameCounter: 10,
      }),
    ).toBe(false);
  });

  it("accepts an untagged v1 frame only after an agreed-source handoff", () => {
    const frame = {
      type: "spectrum",
      data_type: "iq_raw",
      iq_data: new Uint8Array([128, 129]),
    };
    expect(
      resolveFrameReadiness?.({
        frame,
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "rtl-sdr-v4",
        frameCounter: 12,
        handoffStartedFrameCounter: 10,
      }),
    ).toBe(true);
    expect(
      resolveFrameReadiness?.({
        frame,
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "hackrf-one",
        frameCounter: 12,
        handoffStartedFrameCounter: 10,
      }),
    ).toBe(false);
    expect(
      resolveFrameReadiness?.({
        frame,
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "rtl-sdr-v4",
        frameCounter: 10,
        handoffStartedFrameCounter: 10,
      }),
    ).toBe(false);
  });

  it("accepts a source-tagged v1 frame without a per-frame Redux counter", () => {
    expect(
      resolveFrameReadiness?.({
        frame: {
          type: "spectrum",
          data_type: "iq_raw",
          protocol_version: 1,
          source_id: "rtl-sdr-v4",
          iq_data: new Uint8Array([128, 129]),
        },
        selectedSourceId: "rtl-sdr-v4",
        activeSourceId: "rtl-sdr-v4",
        frameCounter: 0,
        handoffStartedFrameCounter: 0,
      }),
    ).toBe(true);
  });

  it("does not collapse numbered source identities during rapid switching", () => {
    expect(
      resolveFrameReadiness?.({
        frame: { ...currentFrame, source_id: "rtl-sdr-1" },
        selectedSourceId: "rtl-sdr-2",
        activeSourceId: "rtl-sdr-2",
        expectedStreamEpoch: 7,
        frameCounter: 12,
        handoffStartedFrameCounter: 10,
      }),
    ).toBe(false);
  });
});

describe("resolveLivePresentationState", () => {
  it("gives a validated frame precedence over recovery and handoff states", () => {
    expect(
      resolveLivePresentationState?.({
        hasValidFrame: true,
        isSourceHandoff: true,
        devicePlaceholder: { kind: "loading", paneLabel: "device" },
      }),
    ).toEqual({ phase: "ready", placeholder: null });
  });

  it("keeps explicit failures blocking", () => {
    const error = { kind: "error", reason: "USB failure" };
    expect(
      resolveLivePresentationState?.({
        hasValidFrame: true,
        devicePlaceholder: error,
      }),
    ).toEqual({ phase: "disconnected", placeholder: error });
  });
});
