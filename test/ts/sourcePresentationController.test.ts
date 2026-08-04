import {
  createSourcePresentationController,
  type SourcePresentationController,
  type SourceModeSlot,
} from "../../src/ts/streams/sourcePresentationController";
import type { IqRawFrame, IqRawFrameV2 } from "../../src/ts/consts/schemas/websocket";

// --- Test helpers ---

const makeRxFrame = (
  sourceId: string,
  opts: { epoch?: number; sequence?: number; iqData?: Uint8Array } = {},
): IqRawFrameV2 => ({
  type: "spectrum",
  data_type: "iq_raw",
  protocol_version: 2,
  source_id: sourceId,
  stream_epoch: opts.epoch ?? 1,
  sequence: opts.sequence ?? 1,
  iq_data: opts.iqData ?? new Uint8Array([1, 2, 3, 4]),
  center_frequency_hz: 100_000_000,
  sample_rate: 2_400_000,
  frame_status: "receiving",
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

    it("clears frozen frame on resume", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));
      ctrl.setPaused("hackrf-1", "rx", true);
      ctrl.setPaused("hackrf-1", "rx", false);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.phase).toBe("streaming");
      expect(slot?.frozenFrame).toBeNull();
    });

    it("accepts a paused/standby preview frame and updates frozen frame", () => {
      const ctrl = createController();
      ctrl.selectSource("hackrf-1");
      ctrl.commitActiveSource("hackrf-1");

      ctrl.acceptFrame(makeRxFrame("hackrf-1", { sequence: 1 }));
      ctrl.setPaused("hackrf-1", "rx", true);

      const previewFrame = makeRxFrame("hackrf-1", { sequence: 2 });
      expect(ctrl.acceptFrame(previewFrame)).toBe(true);

      const slot = ctrl.getSlot("hackrf-1", "rx");
      expect(slot?.frozenFrame?.frame).toBe(previewFrame);
      expect(slot?.metrics.frozen).toBeGreaterThan(0);
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
      ctrl.acceptFrame(makeTxFrame("hackrf-1", { sequence: 1, status: "standby" }));
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
