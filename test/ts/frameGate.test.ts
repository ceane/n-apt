import {
  acceptsMultiplexStreamFrame,
  createMultiplexStreamSequenceGate,
} from "@n-apt/spectrum/model/multiplexStream/frameGate";

describe("acceptsMultiplexStreamFrame", () => {
  it("rejects frames from a different source", () => {
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "mock-apt", streamEpoch: 11, sequence: 1 },
        { sourceId: "mock-tx", streamEpoch: 12 },
      ),
    ).toBe(false);
    // No committed source yet — nothing can be validated against it.
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "mock-apt", streamEpoch: 11, sequence: 1 },
        { sourceId: null, streamEpoch: null },
      ),
    ).toBe(false);
  });

  it("accepts epoch-tagged frames at or ahead of the committed epoch", () => {
    const lifecycle = { sourceId: "rtl-sdr-v4", streamEpoch: 3 };
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "rtl-sdr-v4", streamEpoch: 3, sequence: 1 },
        lifecycle,
      ),
    ).toBe(true);
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "rtl-sdr-v4", streamEpoch: 4, sequence: 1 },
        lifecycle,
      ),
    ).toBe(true);
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "rtl-sdr-v4", streamEpoch: 2, sequence: 1 },
        lifecycle,
      ),
    ).toBe(false);
  });

  it("rejects frames without complete source and ordering metadata", () => {
    const lifecycle = { sourceId: "rtl-sdr-v4", streamEpoch: 3 };
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "rtl-sdr-v4", streamEpoch: 3, sequence: 1 },
        lifecycle,
      ),
    ).toBe(true);
    expect(acceptsMultiplexStreamFrame({ sourceId: "rtl-sdr-v4" }, lifecycle)).toBe(false);
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "rtl-sdr-v4", streamEpoch: 3 },
        lifecycle,
      ),
    ).toBe(false);
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "hackrf-one", streamEpoch: 3, sequence: 1 },
        lifecycle,
      ),
    ).toBe(false);
  });

  it("adopts frames into an epoch-unaware lifecycle (data plane leads control)", () => {
    const lifecycle = { sourceId: "rtl-sdr-v4", streamEpoch: null };
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "rtl-sdr-v4", streamEpoch: 9, sequence: 1 },
        lifecycle,
      ),
    ).toBe(true);
  });
});

describe("createMultiplexStreamSequenceGate", () => {
  it("accepts sequential frames and counts gaps within one epoch", () => {
    const gate = createMultiplexStreamSequenceGate();
    expect(gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 1 })).toBe(
      true,
    );
    expect(gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 3 })).toBe(
      true,
    );
    expect(gate.stats()).toEqual({
      duplicatesRejected: 0,
      sequenceGaps: 1,
    });
  });

  it("rejects duplicates and reorders within one epoch", () => {
    const gate = createMultiplexStreamSequenceGate();
    gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 5 });
    expect(gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 5 })).toBe(
      false,
    );
    expect(gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 2 })).toBe(
      false,
    );
    expect(gate.stats().duplicatesRejected).toBe(2);
  });

  it("rejects frames without a usable epoch or sequence", () => {
    const gate = createMultiplexStreamSequenceGate();
    expect(gate.accept({ sourceId: "s" })).toBe(false);
    expect(gate.accept({ sourceId: "s", streamEpoch: 1 })).toBe(false);
    expect(gate.accept({ sourceId: "s", streamEpoch: -1, sequence: 1 })).toBe(false);
    expect(gate.accept({ sourceId: "s", streamEpoch: 1, sequence: 1.5 })).toBe(false);
  });

  it("starts ordering fresh after an epoch change", () => {
    const gate = createMultiplexStreamSequenceGate();
    gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 7 });
    expect(gate.accept({ sourceId: "s", streamEpoch: 4, sequence: 1 })).toBe(
      true,
    );
  });

  it("leaves the cursor unchanged when required metadata is missing", () => {
    const gate = createMultiplexStreamSequenceGate();
    const tagged = { sourceId: "s", streamEpoch: 3, sequence: 10 };
    gate.accept(tagged);
    for (const frame of [
      { sourceId: "s" },
      { sourceId: "s", sequence: 1 },
      { sourceId: "s", streamEpoch: null, sequence: 99 },
      { sourceId: "s", streamEpoch: 4 },
      { sourceId: "s", streamEpoch: 4, sequence: null },
    ]) {
      expect(gate.accept(frame)).toBe(false);
    }
    expect(gate.accept(tagged)).toBe(false);
    expect(gate.accept({ ...tagged, sequence: 12 })).toBe(true);
    expect(gate.stats()).toEqual({ duplicatesRejected: 1, sequenceGaps: 1 });
  });

  it("rejects older epochs and restarts ordering on newer epochs", () => {
    const gate = createMultiplexStreamSequenceGate();
    const old = { sourceId: "s", streamEpoch: 2, sequence: 1 };
    gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 10 });
    expect(acceptsMultiplexStreamFrame(old, { sourceId: "s", streamEpoch: 3 })).toBe(false);
    expect(gate.accept(old)).toBe(false);
    expect(gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 1 })).toBe(false);
    expect(gate.stats()).toEqual({ duplicatesRejected: 2, sequenceGaps: 0 });
  });

  it("resets only its own cursor and boundary while retaining accumulated statistics", () => {
    const first = createMultiplexStreamSequenceGate();
    const second = createMultiplexStreamSequenceGate();
    const frame = { sourceId: "s", streamEpoch: 3, sequence: 10 };
    expect(first.accept(frame)).toBe(true);
    expect(second.accept(frame)).toBe(true);
    first.accept({ ...frame, sequence: 12 });
    first.accept(frame);
    first.consumeFirstFrameBoundary(frame);
    first.reset();
    expect(first.stats()).toEqual({ duplicatesRejected: 1, sequenceGaps: 1 });
    expect(first.accept(frame)).toBe(true);
    expect(second.accept(frame)).toBe(false);
    expect(first.consumeFirstFrameBoundary(frame)).toBe("s:3");
  });

  it("fires the first-frame boundary once per source:epoch transition", () => {
    const gate = createMultiplexStreamSequenceGate();
    const frame = (epoch: number) => ({ sourceId: "mock-apt", streamEpoch: epoch, sequence: 1 });
    expect(gate.consumeFirstFrameBoundary(frame(3))).toBe("mock-apt:3");
    expect(gate.consumeFirstFrameBoundary(frame(3))).toBeNull();
    expect(gate.consumeFirstFrameBoundary(frame(4))).toBe("mock-apt:4");
  });

  it("keeps missing epoch explicit in boundary keys", () => {
    const gate = createMultiplexStreamSequenceGate();
    expect(gate.consumeFirstFrameBoundary({ sourceId: "s" })).toBe("s:missing");
    expect(gate.consumeFirstFrameBoundary({ sourceId: "s" })).toBeNull();
  });

  it("reset clears sequence, boundary, and gap state", () => {
    const gate = createMultiplexStreamSequenceGate();
    gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 7 });
    gate.consumeFirstFrameBoundary({ sourceId: "s", streamEpoch: 3, sequence: 7 });
    gate.reset();
    expect(gate.stats()).toEqual({ duplicatesRejected: 0, sequenceGaps: 0 });
    // Same sequence is accepted again after reset (new lifecycle generation).
    expect(gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 7 })).toBe(
      true,
    );
    expect(gate.consumeFirstFrameBoundary({ sourceId: "s", streamEpoch: 3, sequence: 7 })).toBe(
      "s:3",
    );
  });

  it("reproduces the retired pump's late-frame rejection semantics end-to-end", () => {
    // Source swap scenario from device-swap integration: old-source frame
    // arriving after the lifecycle moved on must be rejected by identity,
    // independent of sequencing state.
    let lifecycle = { sourceId: "mock-apt", streamEpoch: 11 };
    const gate = createMultiplexStreamSequenceGate();
    const late = { sourceId: "mock-apt", streamEpoch: 11, sequence: 2 };
    lifecycle = { sourceId: "mock-tx", streamEpoch: 12 };
    expect(acceptsMultiplexStreamFrame(late, lifecycle)).toBe(false);

    lifecycle = { sourceId: "mock-apt", streamEpoch: 11 };
    expect(acceptsMultiplexStreamFrame(late, lifecycle)).toBe(true);
    expect(gate.accept(late)).toBe(true);
  });
});
