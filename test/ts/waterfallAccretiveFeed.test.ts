import {
  createAccretiveWaterfallFeed,
  createWaterfallSourceFeed,
  cropAccretiveWaterfallRow,
} from "../../src/ts/features/demodulation/react-flow/nodes/waterfallSourceBuffer";
import { notifyFrameArrival } from "../../src/ts/app/infrastructure/visualization/frameArrivalRuntime";

describe("accretive waterfall history", () => {
  it("retains the frame frequency and detects a retune with unchanged samples", () => {
    const request = jest
      .spyOn(window, "requestAnimationFrame")
      .mockReturnValue(1);
    const cancel = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const frame = {
      iq_data: new Uint8Array(8192).fill(128),
      timestamp: 1,
      center_frequency_hz: 356000,
      sample_rate: 200000,
    };
    const frameRef = { current: frame };
    const feed = createWaterfallSourceFeed(
      "accretive-retune-test",
      frameRef,
      "level",
    );
    const phaseFeed = createWaterfallSourceFeed(
      "accretive-retune-test",
      frameRef,
      "phase",
    );
    const centers: Array<number | null> = [];
    const phaseCenters: Array<number | null> = [];
    const unsubscribe = feed.subscribe((_row, metadata) => {
      if (metadata) {
        centers.push(metadata.centerFrequencyHz);
        expect(metadata.sampleRateHz).toBe(200000);
      }
    });
    frame.center_frequency_hz = 357000;
    const unsubscribePhase = phaseFeed.subscribe((_row, metadata) => {
      if (metadata) phaseCenters.push(metadata.centerFrequencyHz);
    });
    feed.getCurrent();
    phaseFeed.getCurrent();
    expect(centers).toEqual([356000]);
    expect(phaseCenters).toEqual([356000]);
    notifyFrameArrival();
    unsubscribe();
    unsubscribePhase();
    request.mockRestore();
    cancel.mockRestore();
    expect(centers).toEqual([356000, 357000]);
    expect(phaseCenters).toEqual(centers);
  });

  it("retains each row with the viewport used when it arrived", () => {
    const rows: Array<{ row: Float32Array; generation: number }> = [];
    let deliver: ((row: Float32Array, frame: any) => void) | undefined;
    const source = {
      replayHistory: true as const,
      getCurrent: () => rows[rows.length - 1]?.row ?? null,
      subscribe: (listener: (row: Float32Array, frame: any) => void) => {
        deliver = listener;
        for (const entry of rows)
          listener(entry.row, { generation: entry.generation });
        return () => {
          deliver = undefined;
        };
      },
    };
    let zoom = 1;
    const feed = createAccretiveWaterfallFeed(source, (row) =>
      cropAccretiveWaterfallRow(row, zoom, 0, 8),
    );
    const add = (generation: number) => {
      const row = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
      rows.push({ row, generation });
      deliver?.(row, { generation });
    };
    const received: number[][] = [];
    const unsubscribe = feed.subscribe((row) => received.push(Array.from(row)));
    add(1);
    zoom = 2;
    add(2);
    unsubscribe();
    const replayed: number[][] = [];
    feed.subscribe((row) => replayed.push(Array.from(row)));
    expect(received).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7],
      [2, 3, 4, 5],
    ]);
    expect(replayed).toEqual(received);
  });

  it("crops around the panned center", () => {
    expect(
      Array.from(
        cropAccretiveWaterfallRow(
          Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
          2,
          2,
          8,
        ),
      ),
    ).toEqual([4, 5, 6, 7]);
  });

  it("leaves uncovered frequencies empty while a retune is in flight", () => {
    expect(
      Array.from(
        cropAccretiveWaterfallRow(
          Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
          2,
          4,
          8,
        ),
      ),
    ).toEqual([6, 7, -Infinity, -Infinity]);
  });

  it("leaves both edges empty when a frame is narrower than the view", () => {
    expect(
      Array.from(
        cropAccretiveWaterfallRow(Float32Array.from([0, 1, 2, 3]), 0.5, 0, 4),
      ),
    ).toEqual([-Infinity, 0, 2, -Infinity]);
  });
});
