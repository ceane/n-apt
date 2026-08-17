import {
  createSourcePresentationController,
  type SourcePresentationController,
  type SourceModeSlot,
} from "@n-apt/app/infrastructure/streams/sourcePresentationController";
import type { IqRawFrame, IqRawFrameV2 } from "@n-apt/consts/schemas/websocket";

// --- Test helpers ---

const makeRxFrame = (
  sourceId: string,
  opts: {
    epoch?: number;
    sequence?: number;
    iqData?: Uint8Array;
    status?: "receiving" | "paused" | "standby";
    center_frequency_hz?: number;
  } = {},
): IqRawFrameV2 => ({
  type: "spectrum",
  data_type: "iq_raw",
  protocol_version: 2,
  source_id: sourceId,
  stream_epoch: opts.epoch ?? 1,
  sequence: opts.sequence ?? 1,
  iq_data: opts.iqData ?? new Uint8Array([1, 2, 3, 4]),
  center_frequency_hz: opts.center_frequency_hz ?? 100_000_000,
  sample_rate: 2_400_000,
  frame_status: opts.status ?? "receiving",
});

const makeTxFrame = (
  sourceId: string,
  opts: {
    epoch?: number;
    sequence?: number;
    status?: "standby" | "transmitting";
  } = {},
): IqRawFrameV2 => ({
  type: "spectrum",
  data_type: "iq_raw",
  protocol_version: 2,
  source_id: sourceId,
  stream_epoch: opts.epoch ?? 1,
  sequence: opts.sequence ?? 1,
  iq_data: new Uint8Array([5, 6, 7, 8]),
  center_frequency_hz: 100_000_000,
  sample_rate: 2_400_000,
  frame_status: opts.status ?? "standby",
  is_tx_preview: opts.status !== "transmitting",
});

const makeLegacyFrame = (sourceId: string): IqRawFrame => ({
  type: "spectrum",
  data_type: "iq_raw",
  source_id: sourceId,
  iq_data: new Uint8Array([9, 10, 11, 12]),
});

// Disable session storage in tests
const createController = (): SourcePresentationController =>
  createSourcePresentationController({ persistSnapshots: false });

// --- Tests ---

describe("SourcePresentationController", () => {
  describe("initial state", () => {
    it("starts with empty active presentation", () => {
      const ctrl = createController();
      const active = ctrl.getActivePresentation();
      expect(active.sourceId).toBe("");
      expect(active.mode).toBe("rx");
      expect(active.pendingSourceId).toBeNull();
    });

    it("returns null slot for unknown source", () => {
      const ctrl = createController();
      expect(ctrl.getSlot("unknown", "rx")).toBeNull();
    });

    it("returns null presentation ref when no active source", () => {
      const ctrl = createController();
      expect(ctrl.getPresentationRef().current).toBeNull();
    });
  });

  describe("frame acceptance", () => {
    it("accepts a frame for a new source and auto-transitions to streaming", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const frame = makeRxFrame("hackrf-1");
      expect(ctrl.acceptFrame(frame)).toBe(true);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("streaming");
      expect(slot?.metrics.accepted).toBe(1);
      expect(slot?.liveFrameRef.current).toBe(frame);
    });

    it("resumes a previously paused RX slot when switching back to that source", () => {
      const ctrl = createController();
      ctrl.selectSource("mock-apt", "rx", true);
      ctrl.commitActiveSource("mock-apt");
      ctrl.acceptFrame(makeRxFrame("mock-apt", { sequence: 1 }));

      ctrl.selectSource("rtl-sdr-v4", "rx", true);
      ctrl.commitActiveSource("rtl-sdr-v4");
      ctrl.acceptFrame(makeRxFrame("rtl-sdr-v4", { sequence: 1 }));

      ctrl.selectSource("mock-apt", "rx", true);
      ctrl.commitActiveSource("mock-apt");

      expect(ctrl.acceptFrame(makeRxFrame("mock-apt", { sequence: 2 }))).toBe(
        true,
      );
      expect(ctrl.getSlot("mock-apt", "rx")?.phase).toBe("streaming");
    });

    it("rejects frames from a stale epoch", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      ctrl.acceptFrame(makeRxFrame("hackrf-1", { epoch: 3, sequence: 1 }));
      expect(
        ctrl.acceptFrame(makeRxFrame("hackrf-1", { epoch: 2, sequence: 5 })),
      ).toBe(false);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.metrics.stale).toBe(1);
    });

    it("rejects duplicate sequence within same epoch", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      ctrl.acceptFrame(makeRxFrame("hackrf-1", { epoch: 1, sequence: 5 }));
      expect(
        ctrl.acceptFrame(makeRxFrame("hackrf-1", { epoch: 1, sequence: 5 })),
      ).toBe(false);
      expect(
        ctrl.acceptFrame(makeRxFrame("hackrf-1", { epoch: 1, sequence: 3 })),
      ).toBe(false);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.metrics.stale).toBe(2);
    });

    it("accepts frames from a newer epoch and resets sequence", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      ctrl.acceptFrame(makeRxFrame("hackrf-1", { epoch: 1, sequence: 10 }));
      expect(
        ctrl.acceptFrame(makeRxFrame("hackrf-1", { epoch: 2, sequence: 1 })),
      ).toBe(true);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.streamEpoch).toBe(2);
      expect(slot?.lastSequence).toBe(1);
    });

    it("rejects frames during disconnected phase", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.setSourceStatus("hackrf-1", "disconnected");

      expect(ctrl.acceptFrame(makeRxFrame("hackrf-1"))).toBe(false);
    });

    it("rejects frames during failed phase", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.setSourceStatus("hackrf-1", "error");

      expect(ctrl.acceptFrame(makeRxFrame("hackrf-1"))).toBe(false);
    });

    it("accepts legacy v1 frames without epoch/sequence", () => {
      const ctrl = createController();
      ctrl.selectSource("mock-apt");
      ctrl.commitActiveSource("mock-apt");

      const frame = makeLegacyFrame("mock-apt");
      expect(ctrl.acceptFrame(frame)).toBe(true);

      const slot = ctrl.getSlot("mock-apt", "rx");
      expect(slot?.metrics.accepted).toBe(1);
    });
  });

  describe("per-mode tracking", () => {
    it("tracks rx and tx frames independently for the same source", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const rxFrame = makeRxFrame("hackrf-1", { sequence: 1 });
      const txFrame = makeTxFrame("hackrf-1", { sequence: 1 });

      expect(ctrl.acceptFrame(rxFrame)).toBe(true);
      expect(ctrl.acceptFrame(txFrame)).toBe(true);

      const rxSlot = ctrl.getSlot("hackrf-1", "rx");
      const txSlot = ctrl.getSlot("hackrf-1", "tx");

      expect(rxSlot?.liveFrameRef.current).toBe(rxFrame);
      expect(txSlot?.liveFrameRef.current).toBe(txFrame);
      expect(rxSlot?.metrics.accepted).toBe(1);
      expect(txSlot?.metrics.accepted).toBe(1);
    });

    it("pausing rx does not affect tx slot", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));
      ctrl.acceptFrame(makeTxFrame("hackrf-1", { sequence: 1 }));

      ctrl.setPaused("hackrf-1", "rx", true);

      const rxSlot = ctrl.getSlot("hackrf-1", "rx");
      const txSlot = ctrl.getSlot("hackrf-1", "tx");

      expect(rxSlot?.phase).toBe("paused");
      expect(txSlot?.phase).not.toBe("paused");
    });
  });

  describe("pause/resume", () => {
    it("freezes the current frame on pause", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const frame = makeRxFrame("hackrf-1", { sequence: 1 });
      ctrl.acceptFrame(frame);
      ctrl.setPaused("hackrf-1", "rx", true);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("paused");
      expect(slot?.frozenFrame?.frame).toBe(frame);
    });

    it("keeps the frozen frame as a fallback on resume until a live frame arrives", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const frame = makeRxFrame("hackrf-1", { sequence: 1 });
      ctrl.acceptFrame(frame);
      ctrl.setPaused("hackrf-1", "rx", true);
      ctrl.setPaused("hackrf-1", "rx", false);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("streaming");
      // The frozen frame is retained so the canvas shows the last Rx frame
      // during the reopen instead of a Loading placeholder (switch-back churn).
      expect(slot?.frozenFrame?.frame).toBe(frame);
      // Once a fresh live frame arrives it replaces the frozen fallback.
      const nextFrame = makeRxFrame("hackrf-1", { sequence: 2 });
      ctrl.acceptFrame(nextFrame);
      expect(ctrl.getPresentationRef("rx").current).toBe(nextFrame);
    });

    it("rejects live frames while paused so the frozen frame stays frozen", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const pausedFrame = makeRxFrame("hackrf-1", { sequence: 1 });
      ctrl.acceptFrame(pausedFrame);
      ctrl.setPaused("hackrf-1", "rx", true);

      const liveFrame = makeRxFrame("hackrf-1", { sequence: 2 });
      expect(ctrl.acceptFrame(liveFrame)).toBe(false);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.frozenFrame?.frame).toBe(pausedFrame);
      expect(ctrl.getPresentationRef("rx").current).toBe(pausedFrame);
    });

    it("accepts a paused request_next_frame one-shot and replaces the frozen Rx frame", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const originalFrame = makeRxFrame("hackrf-1", { sequence: 1 });
      ctrl.acceptFrame(originalFrame);
      ctrl.setPaused("hackrf-1", "rx", true);

      // A paused source retuned via request_next_frame; the response carries
      // no Tx-preview tag but must still refresh the frozen presentation.
      const oneShot = makeRxFrame("hackrf-1", {
        sequence: 2,
        center_frequency_hz: 101_000_000,
      });
      expect(ctrl.acceptFrame(oneShot, undefined, true)).toBe(true);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("paused");
      expect(slot?.frozenFrame?.frame).toBe(oneShot);
      expect(ctrl.getPresentationRef("rx").current).toBe(oneShot);
    });

    it("keeps rejecting paused frames once the one-shot request is consumed", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const originalFrame = makeRxFrame("hackrf-1", { sequence: 1 });
      ctrl.acceptFrame(originalFrame);
      ctrl.setPaused("hackrf-1", "rx", true);

      // A single one-shot response is accepted and freezes the new frame.
      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 2 }), undefined, true);

      // The next live frame without the one-shot flag is rejected again.
      const liveFrame = makeRxFrame("hackrf-1", { sequence: 3 });
      expect(ctrl.acceptFrame(liveFrame)).toBe(false);
      expect(ctrl.getPresentationRef("rx").current).not.toBe(liveFrame);
    });

    it("keeps the last Rx frame while paused instead of applying a preview", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const lastRxFrame = makeRxFrame("hackrf-1", { sequence: 1 });
      ctrl.acceptFrame(lastRxFrame);
      ctrl.setPaused("hackrf-1", "rx", true);

      expect(
        ctrl.acceptFrame(
          makeRxFrame("hackrf-1", { sequence: 2, status: "paused" }),
        ),
      ).toBe(false);
      expect(
        ctrl.acceptFrame(
          makeTxFrame("hackrf-1", { sequence: 1, status: "standby" }),
        ),
      ).toBe(true);

      const rxSlot = ctrl.getSlot("hackrf-1", "rx");
      expect(rxSlot?.frozenFrame?.frame).toBe(lastRxFrame);
      expect(ctrl.getPresentationRef("rx").current).toBe(lastRxFrame);
    });

    it("presentation ref returns frozen frame when paused", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const frame = makeRxFrame("hackrf-1", { sequence: 1 });
      ctrl.acceptFrame(frame);
      ctrl.setPaused("hackrf-1", "rx", true);

      const ref = ctrl.getPresentationRef("rx");
      expect(ref.current).toBe(frame);
    });

    it("does not unfreeze a paused slot when a stale streaming status arrives", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const frame = makeRxFrame("hackrf-1", { sequence: 1 });
      ctrl.acceptFrame(frame);
      ctrl.setPaused("hackrf-1", "rx", true);

      // Cold-start race: the backend re-broadcasts receiving/streaming before
      // the pause command settles. This must NOT revert the paused phase.
      ctrl.setSourceStatus("hackrf-1", "receiving");
      ctrl.setSourceStatus("hackrf-1", "streaming");
      ctrl.setSourceStatus("hackrf-1", "connected");

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("paused");
      expect(slot?.frozenFrame?.frame).toBe(frame);
      expect(ctrl.getPresentationRef("rx").current).toBe(frame);

      // Live frames remain rejected so the frozen frame is preserved.
      expect(
        ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 2 })),
      ).toBe(false);
    });

    it("keeps a paused slot frozen until an explicit resume", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const frame = makeRxFrame("hackrf-1", { sequence: 1 });
      ctrl.acceptFrame(frame);
      ctrl.setPaused("hackrf-1", "rx", true);

      ctrl.setSourceStatus("hackrf-1", "receiving");
      expect(ctrl.getSlot("hackrf-1", "rx")?.phase).toBe("paused");

      // Explicit resume returns to streaming while keeping the frozen frame
      // as a fallback until the first fresh live frame arrives.
      ctrl.setPaused("hackrf-1", "rx", false);
      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("streaming");
      expect(slot?.frozenFrame?.frame).toBe(frame);
    });

    it("still honors a backend paused status after a manual pause", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));
      ctrl.setPaused("hackrf-1", "rx", true);
      ctrl.setSourceStatus("hackrf-1", "paused");

      expect(ctrl.getSlot("hackrf-1", "rx")?.phase).toBe("paused");
    });
  });

  describe("source switching", () => {
    it("selectSource marks pending source", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");

      const active = ctrl.getActivePresentation();
      expect(active.sourceId).toBe("hackrf-1");
      expect(active.pendingSourceId).toBe("hackrf-1");
    });

    it("commitActiveSource clears pending", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const active = ctrl.getActivePresentation();
      expect(active.sourceId).toBe("hackrf-1");
      expect(active.pendingSourceId).toBeNull();
    });

    it("switching sources freezes the previous source frame", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));

      ctrl.selectSource("mock-apt");

      const prevSlot = ctrl.getSlot("hackrf-1", "rx");
      expect(prevSlot?.phase).toBe("paused");
      expect(prevSlot?.frozenFrame).not.toBeNull();
    });

    it("does not serve the previous source's frame after a switch", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));
      ctrl.setPaused("hackrf-1", "rx", true);

      ctrl.selectSource("mock-apt");
      ctrl.commitActiveSource("mock-apt");

      // The active presentation ref must not return the old device's frozen
      // frame while the new source is still warming up.
      expect(ctrl.getPresentationRef("rx").current).toBeNull();
    });

    it("canvas key changes on source switch", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      const key1 = ctrl.getCanvasKey();

      ctrl.selectSource("mock-apt");
      ctrl.commitActiveSource("mock-apt");
      const key2 = ctrl.getCanvasKey();

      expect(key1).not.toBe(key2);
    });

    it("accepts a Mock Tx standby preview while the slot is still switching", () => {
      const ctrl = createController();
      ctrl.selectSource("mock-tx", "tx");

      const frame = makeTxFrame("mock-tx", {
        sequence: 1,
        status: "standby",
      });
      expect(ctrl.acceptFrame(frame)).toBe(true);

      const slot = ctrl.getSlot("mock-tx", "tx");
      expect(slot?.phase).toBe("standby");
      expect(slot?.frozenFrame).not.toBeNull();
    });
  });

  describe("standby / tx preview", () => {
    it("setSourceStatus to standby freezes the frame", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const frame = makeTxFrame("hackrf-1", {
        sequence: 1,
        status: "transmitting",
      });
      ctrl.acceptFrame(frame);
      ctrl.setSourceStatus("hackrf-1", "standby");

      const txSlot = ctrl.getSlot("hackrf-1", "tx");
      expect(txSlot?.phase).toBe("standby");
      expect(txSlot?.frozenFrame?.frame).toBe(frame);
    });

    it("accepting a standby preview frame freezes standby instead of transmitting", () => {
      const ctrl = createController();
      ctrl.selectSource("mock-tx", "tx");
      ctrl.commitActiveSource("mock-tx");

      const frame = makeTxFrame("mock-tx", {
        sequence: 1,
        status: "standby",
      });
      expect(ctrl.acceptFrame(frame)).toBe(true);

      const txSlot = ctrl.getSlot("mock-tx", "tx");
      expect(txSlot?.phase).toBe("standby");
      expect(txSlot?.frozenFrame?.frame).toBe(frame);
      expect(ctrl.getPresentationRef("tx").current).toBe(frame);
    });

    it("replaces the frozen Tx frame with a request_next_frame standby preview", () => {
      const ctrl = createController();
      ctrl.selectSource("mock-tx", "tx");
      ctrl.commitActiveSource("mock-tx");

      ctrl.acceptFrame(
        makeTxFrame("mock-tx", { sequence: 1, status: "standby" }),
      );
      const nextPreview = makeTxFrame("mock-tx", {
        sequence: 2,
        status: "standby",
      });
      expect(ctrl.acceptFrame(nextPreview)).toBe(true);

      const txSlot = ctrl.getSlot("mock-tx", "tx");
      expect(txSlot?.phase).toBe("standby");
      expect(txSlot?.frozenFrame?.frame).toBe(nextPreview);
      expect(ctrl.getPresentationRef("tx").current).toBe(nextPreview);
    });

    it("unfreezes standby when source status becomes transmitting", () => {
      const ctrl = createController();
      ctrl.selectSource("mock-tx", "tx");
      ctrl.commitActiveSource("mock-tx");
      ctrl.acceptFrame(
        makeTxFrame("mock-tx", { sequence: 1, status: "standby" }),
      );

      ctrl.setSourceStatus("mock-tx", "transmitting");

      const txSlot = ctrl.getSlot("mock-tx", "tx");
      expect(txSlot?.phase).toBe("transmitting");
      expect(txSlot?.frozenFrame).toBeNull();
    });

    it("unfreezes standby and follows live frames once transmitting starts", () => {
      const ctrl = createController();
      ctrl.selectSource("mock-tx", "tx");
      ctrl.commitActiveSource("mock-tx");

      const standbyFrame = makeTxFrame("mock-tx", {
        sequence: 1,
        status: "standby",
      });
      ctrl.acceptFrame(standbyFrame);

      const liveTxFrame = makeTxFrame("mock-tx", {
        sequence: 2,
        status: "transmitting",
      });
      expect(ctrl.acceptFrame(liveTxFrame)).toBe(true);

      const txSlot = ctrl.getSlot("mock-tx", "tx");
      expect(txSlot?.phase).toBe("transmitting");
      expect(txSlot?.frozenFrame).toBeNull();
      expect(ctrl.getPresentationRef("tx").current).toBe(liveTxFrame);
    });

    it("serves the frozen Mock Tx frame when switching back before a new preview arrives", () => {
      const ctrl = createController();
      ctrl.selectSource("mock-tx", "tx");
      ctrl.commitActiveSource("mock-tx");
      const frame = makeTxFrame("mock-tx", {
        sequence: 1,
        status: "standby",
      });
      expect(ctrl.acceptFrame(frame)).toBe(true);

      ctrl.selectSource("mock-apt", "rx");
      ctrl.commitActiveSource("mock-apt");
      ctrl.acceptFrame(makeRxFrame("mock-apt", { sequence: 1 }));

      ctrl.selectSource("mock-tx", "tx");
      expect(ctrl.getPresentationRef("tx").current).toBe(frame);
    });

    it("transmitting status transitions to transmitting phase", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      // Create the tx slot first by accepting a tx frame
      ctrl.acceptFrame(
        makeTxFrame("hackrf-1", { sequence: 1, status: "standby" }),
      );
      ctrl.setSourceStatus("hackrf-1", "transmitting");

      const txSlot = ctrl.getSlot("hackrf-1", "tx");
      expect(txSlot?.phase).toBe("transmitting");
    });
  });

  describe("stale phase", () => {
    it("stale status transitions to stale phase", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));
      ctrl.setSourceStatus("hackrf-1", "stale");

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("stale");
    });
  });

  describe("disconnection and recovery", () => {
    it("disconnection clears live frame and advances reset epoch", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));

      const epochBefore = ctrl.getSlot("hackrf-1", "rx")?.resetEpoch ?? 0;
      ctrl.setSourceStatus("hackrf-1", "disconnected");

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("disconnected");
      expect(slot?.liveFrameRef.current).toBeNull();
      expect(slot?.resetEpoch).toBeGreaterThan(epochBefore);
    });

    it("recovery from loading transitions to recovering", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.setSourceStatus("hackrf-1", "loading");

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("recovering");
    });

    it("streaming resumes after recovery", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.setSourceStatus("hackrf-1", "loading");

      const frame = makeRxFrame("hackrf-1", { epoch: 2, sequence: 1 });
      ctrl.acceptFrame(frame);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("streaming");
      expect(slot?.liveFrameRef.current).toBe(frame);
    });
  });

  describe("multi-source tracking", () => {
    it("tracks multiple sources independently", () => {
      const ctrl = createController();

      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));
      ctrl.acceptFrame(makeRxFrame("mock-apt", { sequence: 1 }));
      ctrl.acceptFrame(makeTxFrame("mock-tx", { sequence: 1 }));

      expect(ctrl.getSlot("hackrf-1", "rx")?.metrics.accepted).toBe(1);
      expect(ctrl.getSlot("mock-apt", "rx")?.metrics.accepted).toBe(1);
      expect(ctrl.getSlot("mock-tx", "tx")?.metrics.accepted).toBe(1);
    });

    it("getAllSlots returns all tracked slots", () => {
      const ctrl = createController();

      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));
      ctrl.acceptFrame(makeTxFrame("hackrf-1", { sequence: 1 }));
      ctrl.acceptFrame(makeRxFrame("mock-apt", { sequence: 1 }));

      const allSlots = ctrl.getAllSlots();
      expect(allSlots.size).toBe(3);
    });
  });

  describe("subscription", () => {
    it("notifies listeners on phase transitions", () => {
      const ctrl = createController();
      const snapshots: unknown[] = [];
      ctrl.subscribe((snapshot) => snapshots.push(snapshot));

      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));
      ctrl.setPaused("hackrf-1", "rx", true);

      expect(snapshots.length).toBeGreaterThan(0);
    });

    it("unsubscribe stops notifications", () => {
      const ctrl = createController();
      const snapshots: unknown[] = [];
      const unsub = ctrl.subscribe((snapshot) => snapshots.push(snapshot));

      ctrl.selectSource("hackrf-1");
      const countBefore = snapshots.length;

      unsub();
      ctrl.selectSource("mock-apt");

      expect(snapshots.length).toBe(countBefore);
    });
  });

  describe("reset", () => {
    it("reset clears all slots", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));

      ctrl.reset();

      expect(ctrl.getAllSlots().size).toBe(0);
      expect(ctrl.getActivePresentation().sourceId).toBe("");
    });

    it("resetSlot clears a single slot", () => {
      const ctrl = createController();
      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));
      ctrl.acceptFrame(makeTxFrame("hackrf-1", { sequence: 1 }));

      ctrl.resetSlot("hackrf-1", "rx");

      const rxSlot = ctrl.getSlot("hackrf-1", "rx");
      const txSlot = ctrl.getSlot("hackrf-1", "tx");

      expect(rxSlot?.phase).toBe("idle");
      expect(rxSlot?.liveFrameRef.current).toBeNull();
      expect(txSlot?.metrics.accepted).toBe(1);
    });
  });

  describe("canvas key", () => {
    it("canvas key includes source, mode, and epoch", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      const key = ctrl.getCanvasKey("rx");
      expect(key).toContain("hackrf-1");
      expect(key).toContain("rx");
    });

    it("canvas key changes on reset epoch advance", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");
      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));

      const key1 = ctrl.getCanvasKey("rx");
      ctrl.setSourceStatus("hackrf-1", "disconnected");
      const key2 = ctrl.getCanvasKey("rx");

      expect(key1).not.toBe(key2);
    });
  });
});
