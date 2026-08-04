import * as middleware from "@n-apt/redux/middleware/websocketMiddleware";

type Pump = {
  enqueue(buffer: ArrayBuffer, fallbackSourceId: string): void;
  stats(): {
    accepted: number;
    rejected: number;
    dropped: number;
    sequenceGaps: number;
    decryptionFailures: number;
  };
};

const createIqFramePump = (
  middleware as typeof middleware & {
    createIqFramePump?: (options: Record<string, unknown>) => Pump;
  }
).createIqFramePump;

const v2Envelope = (
  sequence: number,
  epoch = 3,
  sourceId = "rtl-sdr-v4",
  frameStatus = 0,
) => {
  const sourceBytes = new TextEncoder().encode(sourceId);
  const headerLength = 56 + sourceBytes.length;
  const bytes = new Uint8Array(headerLength + 1);
  bytes.set(new TextEncoder().encode("NAPT"));
  const view = new DataView(bytes.buffer);
  view.setUint8(4, 2);
  view.setUint16(6, headerLength, true);
  view.setUint16(8, sourceBytes.length, true);
  view.setUint8(10, frameStatus);
  view.setBigUint64(16, BigInt(epoch), true);
  view.setBigUint64(24, BigInt(sequence), true);
  view.setBigUint64(32, BigInt(sequence), true);
  view.setBigUint64(40, 137_100_000n, true);
  view.setUint32(48, 1, true);
  view.setUint32(52, 2_400_000, true);
  bytes.set(sourceBytes, 56);
  bytes[headerLength] = sequence;
  return bytes.buffer;
};

describe("ordered I/Q frame pump", () => {
  it("preserves the v2 standby payload status as Tx preview metadata", async () => {
    const published: Array<{
      frame_status?: string;
      is_tx_preview?: boolean;
    }> = [];
    const pump = createIqFramePump?.({
      decrypt: async (payload: Uint8Array) => payload,
      publish: (frame: { frame_status?: string; is_tx_preview?: boolean }) =>
        published.push(frame),
      getLifecycle: () => ({ sourceId: "hackrf-one", streamEpoch: 3 }),
    });

    pump?.enqueue(v2Envelope(1, 3, "hackrf-one", 1), "hackrf-one");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(published).toHaveLength(1);
    expect(published[0]).toEqual(
      expect.objectContaining({
        frame_status: "standby",
        is_tx_preview: true,
      }),
    );
  });

  it("publishes sequential frames in order and records sequence gaps", async () => {
    const published: number[] = [];
    const pump = createIqFramePump?.({
      decrypt: async (payload: Uint8Array) => payload,
      publish: (frame: { sequence?: number }) =>
        published.push(frame.sequence ?? -1),
      getLifecycle: () => ({ sourceId: "rtl-sdr-v4", streamEpoch: 3 }),
    });

    pump?.enqueue(v2Envelope(1), "rtl-sdr-v4");
    pump?.enqueue(v2Envelope(3), "rtl-sdr-v4");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(published).toEqual([1, 3]);
    expect(pump?.stats()).toMatchObject({ accepted: 2, sequenceGaps: 1 });
  });

  it("rejects frames from an obsolete source or epoch after decryption", async () => {
    let lifecycle = { sourceId: "rtl-sdr-v4", streamEpoch: 3 };
    const releaseDecrypt: { current: (() => void) | null } = { current: null };
    const published: number[] = [];
    const pump = createIqFramePump?.({
      decrypt: async (payload: Uint8Array) => {
        await new Promise<void>((resolve) => {
          releaseDecrypt.current = resolve;
        });
        return payload;
      },
      publish: (frame: { sequence?: number }) =>
        published.push(frame.sequence ?? -1),
      getLifecycle: () => lifecycle,
    });

    pump?.enqueue(v2Envelope(1), "rtl-sdr-v4");
    await Promise.resolve();
    lifecycle = { sourceId: "hackrf-one", streamEpoch: 4 };
    releaseDecrypt.current?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(published).toEqual([]);
    expect(pump?.stats()).toMatchObject({ rejected: 1 });
  });

  it("keeps only the latest frame while decryption is in flight", async () => {
    const published: number[] = [];
    const releaseFirst: { current: (() => void) | null } = { current: null };
    let decryptCount = 0;
    const pump = createIqFramePump?.({
      decrypt: async (payload: Uint8Array) => {
        decryptCount += 1;
        if (decryptCount === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst.current = resolve;
          });
        }
        return payload;
      },
      publish: (frame: { sequence?: number }) =>
        published.push(frame.sequence ?? -1),
      getLifecycle: () => ({ sourceId: "rtl-sdr-v4", streamEpoch: 3 }),
    });

    for (let sequence = 1; sequence <= 11; sequence += 1) {
      pump?.enqueue(v2Envelope(sequence), "rtl-sdr-v4");
    }
    await Promise.resolve();
    releaseFirst.current?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(published).toEqual([1, 11]);
    expect(pump?.stats()).toMatchObject({ accepted: 2, dropped: 9 });
  });

  it("adopts a newer same-source epoch when control metadata lags", async () => {
    let lifecycle = { sourceId: "rtl-sdr-v4", streamEpoch: 3 };
    const published: number[] = [];
    const pump = createIqFramePump?.({
      decrypt: async (payload: Uint8Array) => payload,
      publish: (frame: { sequence?: number }) =>
        published.push(frame.sequence ?? -1),
      getLifecycle: () => lifecycle,
      onLifecycleChange: (sourceId: string, streamEpoch: number) => {
        lifecycle = { sourceId, streamEpoch };
      },
    });

    pump?.enqueue(v2Envelope(1, 4), "rtl-sdr-v4");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lifecycle.streamEpoch).toBe(4);
    expect(published).toEqual([1]);
  });

  it("publishes one readiness boundary per accepted source epoch", async () => {
    const ready: Array<{ sourceId?: string; epoch?: number }> = [];
    let lifecycle = { sourceId: "mock-apt", streamEpoch: 3 };
    const pump = createIqFramePump?.({
      decrypt: async (payload: Uint8Array) => payload,
      publish: () => undefined,
      getLifecycle: () => lifecycle,
      onLifecycleChange: (sourceId: string, streamEpoch: number) => {
        lifecycle = { sourceId, streamEpoch };
      },
      onFirstFrameAccepted: (frame: {
        source_id?: string;
        stream_epoch?: number;
      }) =>
        ready.push({
          sourceId: frame.source_id,
          epoch: frame.stream_epoch,
        }),
    });

    pump?.enqueue(v2Envelope(1, 3, "mock-apt"), "mock-apt");
    pump?.enqueue(v2Envelope(2, 3, "mock-apt"), "mock-apt");
    pump?.enqueue(v2Envelope(1, 4, "mock-apt"), "mock-apt");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ready).toEqual([
      { sourceId: "mock-apt", epoch: 3 },
      { sourceId: "mock-apt", epoch: 4 },
    ]);
  });
});
