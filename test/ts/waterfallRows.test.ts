import {
  copyValidWaterfallRow,
  peakResampleWaterfallRow,
  resolveWaterfallDisplayRow,
  synthesizeWaterfallTransitionRow,
} from "@n-apt/spectrum/utils/waterfallRows";

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
