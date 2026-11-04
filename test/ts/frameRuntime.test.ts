import {
  createFrameRuntime,
  getLiveFrameRefForSource,
  notifyFrameArrival,
  subscribeFrameArrivals,
  subscribeFrameRuntime,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { presentationController } from "@n-apt/app/infrastructure/streams/sourcePresentationController";
import type { IqRawFrameV2 } from "@n-apt/consts/schemas/websocket";

const makeFrame = (
  sourceId: string,
  sequence: number,
  frameStatus: "receiving" | "standby" | "transmitting" = "receiving",
): IqRawFrameV2 =>
  ({
    type: "spectrum",
    data_type: "iq_raw",
    source_id: sourceId,
    protocol_version: 2,
    stream_epoch: 3,
    sequence,
    frame_status: frameStatus,
    is_tx_preview: frameStatus === "standby",
    iq_data: new Uint8Array([128, 129]),
  }) as IqRawFrameV2;

const activate = (sourceId: string, mode: "rx" | "tx" = "rx") => {
  presentationController.selectSource(sourceId, mode, true);
  presentationController.commitActiveSource(sourceId);
};

describe("frame runtime", () => {
  afterEach(() => {
    jest.useRealTimers();
    presentationController.reset();
  });

  test("shares one clock while preserving subscriber cadence", () => {
    jest.useFakeTimers();
    const fast = jest.fn();
    const slow = jest.fn();
    const unsubscribeFast = subscribeFrameRuntime(fast, 50);
    const unsubscribeSlow = subscribeFrameRuntime(slow, 250);

    jest.advanceTimersByTime(200);
    expect(fast).toHaveBeenCalledTimes(4);
    expect(slow).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(slow).toHaveBeenCalledTimes(1);

    unsubscribeFast();
    unsubscribeSlow();
  });

  test("notifies frame arrivals without starting a polling clock", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFrameArrivals(listener);

    notifyFrameArrival();
    notifyFrameArrival();

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  test("reads and clears a generic imperative slot", () => {
    const ref = { current: { sequence: 1 } as { sequence: number } | null };
    const runtime = createFrameRuntime(ref);

    expect(runtime.read()).toEqual({ sequence: 1 });
    runtime.clear();
    expect(runtime.read()).toBeNull();
    expect(ref.current).toBeNull();
  });

  test("keeps RX and TX frame slots isolated for one source", () => {
    const rxFrame = makeFrame("shared-source", 1);
    activate("shared-source", "rx");
    presentationController.acceptFrame(rxFrame, "rx");

    activate("shared-source", "tx");
    const txFrame = makeFrame("shared-source", 2, "standby");
    presentationController.acceptFrame(txFrame, "tx");

    expect(getLiveFrameRefForSource("shared-source", "rx").current).toBe(
      rxFrame,
    );
    expect(getLiveFrameRefForSource("shared-source", "tx").current).toBe(
      txFrame,
    );
  });

  test("does not read a source or mode without its presentation slot", () => {
    activate("source-a", "rx");
    presentationController.acceptFrame(makeFrame("source-a", 1), "rx");

    expect(getLiveFrameRefForSource("source-b", "rx").current).toBeNull();
    expect(getLiveFrameRefForSource("source-a", "tx").current).toBeNull();
    expect(getLiveFrameRefForSource(null, "rx").current).toBeNull();
  });

  test("retains a paused RX frame and accepts one explicit replacement", () => {
    activate("paused-source", "rx");
    const initialFrame = makeFrame("paused-source", 1);
    presentationController.acceptFrame(initialFrame, "rx");
    presentationController.setPaused("paused-source", "rx", true);

    expect(
      presentationController.acceptFrame(makeFrame("paused-source", 2), "rx"),
    ).toBe(false);
    expect(getLiveFrameRefForSource("paused-source", "rx").current).toBe(
      initialFrame,
    );

    const oneShotFrame = makeFrame("paused-source", 3);
    expect(presentationController.acceptFrame(oneShotFrame, "rx", true)).toBe(
      true,
    );
    expect(getLiveFrameRefForSource("paused-source", "rx").current).toBe(
      oneShotFrame,
    );
  });

  test("returns stable source proxies and bounds their cache", () => {
    activate("held-source", "rx");
    const held = getLiveFrameRefForSource("held-source", "rx");
    const frame = makeFrame("held-source", 1);
    presentationController.acceptFrame(frame, "rx");

    expect(getLiveFrameRefForSource("held-source", "rx")).toBe(held);
    for (let index = 0; index < 80; index += 1) {
      getLiveFrameRefForSource(`churn-${index}`, "rx");
    }
    expect(held.current).toBe(frame);
  });
});
