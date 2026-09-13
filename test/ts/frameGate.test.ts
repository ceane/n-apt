import {
  acceptsMultiplexStreamFrame,
  createMultiplexStreamSequenceGate,
} from "@n-apt/spectrum/model/multiplexStream/frameGate";

describe("acceptsMultiplexStreamFrame", () => {
  it("rejects frames from a different source", () => {
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "mock-apt", streamEpoch: 11 },
        { sourceId: "mock-tx", streamEpoch: 12 },
      ),
    ).toBe(false);
    // No committed source yet — nothing can be validated against it.
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "mock-apt", streamEpoch: 11 },
        { sourceId: null, streamEpoch: null },
      ),
    ).toBe(false);
  });

  it("accepts epoch-tagged frames at or ahead of the committed epoch", () => {
    const lifecycle = { sourceId: "rtl-sdr-v4", streamEpoch: 3 };
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "rtl-sdr-v4", streamEpoch: 3 },
        lifecycle,
      ),
    ).toBe(true);
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "rtl-sdr-v4", streamEpoch: 4 },
        lifecycle,
      ),
    ).toBe(true);
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "rtl-sdr-v4", streamEpoch: 2 },
        lifecycle,
      ),
    ).toBe(false);
  });

  it("treats epoch-less frames as legacy and accepts them on source match", () => {
    const lifecycle = { sourceId: "rtl-sdr-v4", streamEpoch: 3 };
    expect(acceptsMultiplexStreamFrame({ sourceId: "rtl-sdr-v4" }, lifecycle)).toBe(
      true,
    );
    expect(
      acceptsMultiplexStreamFrame({ sourceId: "hackrf-one" }, lifecycle),
    ).toBe(false);
  });

  it("adopts frames into an epoch-unaware lifecycle (data plane leads control)", () => {
    const lifecycle = { sourceId: "rtl-sdr-v4", streamEpoch: null };
    expect(
      acceptsMultiplexStreamFrame(
        { sourceId: "rtl-sdr-v4", streamEpoch: 9 },
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

  it("starts ordering fresh after an epoch change", () => {
    const gate = createMultiplexStreamSequenceGate();
    gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 7 });
    expect(gate.accept({ sourceId: "s", streamEpoch: 4, sequence: 1 })).toBe(
      true,
    );
  });

  it("passes epoch-less v1 frames through unordered", () => {
    const gate = createMultiplexStreamSequenceGate();
    expect(gate.accept({ sourceId: "s" })).toBe(true);
    expect(gate.accept({ sourceId: "s" })).toBe(true);
  });

  it("fires the first-frame boundary once per source:epoch transition", () => {
    const gate = createMultiplexStreamSequenceGate();
    const frame = (epoch: number) => ({ sourceId: "mock-apt", streamEpoch: epoch });
    expect(gate.consumeFirstFrameBoundary(frame(3))).toBe("mock-apt:3");
    expect(gate.consumeFirstFrameBoundary(frame(3))).toBeNull();
    expect(gate.consumeFirstFrameBoundary(frame(4))).toBe("mock-apt:4");
  });

  it("uses the v1 sentinel key for epoch-less frames", () => {
    const gate = createMultiplexStreamSequenceGate();
    expect(gate.consumeFirstFrameBoundary({ sourceId: "s" })).toBe("s:v1");
    expect(gate.consumeFirstFrameBoundary({ sourceId: "s" })).toBeNull();
  });

  it("reset clears sequence, boundary, and gap state", () => {
    const gate = createMultiplexStreamSequenceGate();
    gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 7 });
    gate.consumeFirstFrameBoundary({ sourceId: "s", streamEpoch: 3 });
    gate.reset();
    expect(gate.stats()).toEqual({ duplicatesRejected: 0, sequenceGaps: 0 });
    // Same sequence is accepted again after reset (new lifecycle generation).
    expect(gate.accept({ sourceId: "s", streamEpoch: 3, sequence: 7 })).toBe(
      true,
    );
    expect(gate.consumeFirstFrameBoundary({ sourceId: "s", streamEpoch: 3 })).toBe(
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
