import {
  copyValidWaterfallRow,
  forEachRepackedWaterfallRow,
  repackWaterfallBytes,
  peakResampleWaterfallRow,
  resolveWaterfallDisplayRow,
  synthesizeWaterfallTransitionRow,
} from "@n-apt/spectrum/utils/waterfallRows";

describe("circular waterfall resize", () => {
  it.each([
    [4, 6, 0, [[3, 5], [3, 4], [2, 3], [1, 2], [1, 1], [0, 0]]],
    [4, 6, 2, [[1, 1], [1, 0], [0, 5], [3, 4], [3, 3], [2, 2]]],
    [6, 3, 5, [[4, 1], [2, 0], [0, 2]]],
    [6, 3, 0, [[5, 2], [3, 1], [1, 0]]],
    [4, 4, 2, [[1, 1], [0, 0], [3, 3], [2, 2]]],
    [1, 3, 0, [[0, 2], [0, 1], [0, 0]]],
    [3, 1, 2, [[1, 0]]],
    [0, 2, 0, [[0, 1], [0, 0]]],
    [4, 0, 2, []],
  ])("maps %i rows to %i with write row %i in display-age order", (prevH, needH, writeRow, expected) => {
    const copies: number[][] = [];
    forEachRepackedWaterfallRow(prevH, needH, writeRow, (srcY, dstY) => {
      copies.push([srcY, dstY]);
    });
    expect(copies).toEqual(expected);
  });

  it("copies raw row bytes into the supplied target without mutating the source", () => {
    const source = new Uint8Array([10, 11, 20, 21, 30, 31, 40, 41]);
    const target = new Uint8Array(12).fill(255);
    const buffer = target.buffer;
    repackWaterfallBytes(source, target, 2, 4, 6, 2);
    expect(target.buffer).toBe(buffer);
    expect(Array.from(target)).toEqual([20, 21, 20, 21, 30, 31, 40, 41, 40, 41, 10, 11]);
    expect(Array.from(source)).toEqual([10, 11, 20, 21, 30, 31, 40, 41]);
  });

  it("retains set/subarray behavior for a short or empty source", () => {
    const target = new Uint8Array(4).fill(99);
    repackWaterfallBytes(new Uint8Array([7]), target, 2, 0, 2, 0);
    expect(Array.from(target)).toEqual([7, 99, 7, 99]);
    repackWaterfallBytes(new Uint8Array(), target, 2, 0, 2, 0);
    expect(Array.from(target)).toEqual([7, 99, 7, 99]);
  });
});

describe("waterfallRows", () => {
  it("peak resamples synchronously so every paint gets a complete row", () => {
    const source = new Float32Array([-90, -20, -80, -60, -70, -10, -95, -40]);
    const target = new Float32Array(4);

    peakResampleWaterfallRow(source, target);

    expect(Array.from(target)).toEqual([-20, -60, -10, -40]);
  });

  it("fills an empty source with the waterfall floor", () => {
    const target = new Float32Array(3);

    peakResampleWaterfallRow([], target, -180);

    expect(Array.from(target)).toEqual([-180, -180, -180]);
  });

  it("reuses the last good row when a row has no valid samples", () => {
    const target = new Float32Array(3);
    const fallback = new Float32Array([-70, -60, -50]);

    copyValidWaterfallRow(
      new Float32Array([Number.NaN, Number.NaN, Number.NaN]),
      target,
      fallback,
    );

    expect(Array.from(target)).toEqual([-70, -60, -50]);
  });

  it("sanitizes partial invalid rows instead of preserving holes", () => {
    const target = new Float32Array(3);

    copyValidWaterfallRow(
      new Float32Array([-70, Number.NaN, -50]),
      target,
      null,
      -200,
    );

    expect(Array.from(target)).toEqual([-70, -200, -50]);
  });

  it("synthesizes a shifted transition row between retuned waterfall rows", () => {
    const target = new Float32Array(4);

    synthesizeWaterfallTransitionRow({
      previous: new Float32Array([-80, -40, -60, -90]),
      current: new Float32Array([-20, -20, -20, -20]),
      target,
      driftBins: 2,
      progress: 0.5,
      floorDb: -100,
    });

    expect(Array.from(target)).toEqual([-30, -40, -55, -20]);
  });

  it("uses the current row at shifted edges instead of drawing floor bars", () => {
    const target = new Float32Array(3);

    synthesizeWaterfallTransitionRow({
      previous: new Float32Array([-90, -80, -70]),
      current: new Float32Array([-30, -40, -50]),
      target,
      driftBins: -10,
      progress: 0.5,
      floorDb: -200,
    });

    expect(Array.from(target)).toEqual([-30, -40, -50]);
  });

  it("maps a new waterfall row onto the displayed axis including below 0 Hz", () => {
    const target = new Float32Array(5);
    resolveWaterfallDisplayRow({
      sourceWaveform: new Float32Array([0, 1, 2, 3, 4]),
      sourceRange: { min: 0, max: 4 },
      displayRange: { min: -2, max: 2 },
      target,
      floorDb: -200,
    });
    expect(Array.from(target)).toEqual([2, 1, 0, 1, 2]);
  });

  it("maps a positive panned waterfall row from the acquisition, not the raw bins", () => {
    const target = new Float32Array(5);
    resolveWaterfallDisplayRow({
      sourceWaveform: new Float32Array([0, 1, 2, 3, 4]),
      sourceRange: { min: 0, max: 4 },
      displayRange: { min: 2, max: 6 },
      target,
      floorDb: -200,
    });
    expect(Array.from(target)).toEqual([2, 3, 4, -200, -200]);
  });
});
