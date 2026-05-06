import {
  stitchWholeChannelWaveform,
} from "@n-apt/utils/rendering/wholeChannelStitching";

describe("stitchWholeChannelWaveform", () => {
  it("normalizes adjacent segment floors before stitching", () => {
    const stitched = stitchWholeChannelWaveform(
      [
        {
          waveform: new Float32Array([-82, -81, -80, -79]),
          visualRange: { min: 0, max: 4 },
          dbMin: -120,
        },
        {
          waveform: new Float32Array([-70, -69, -68, -67]),
          visualRange: { min: 4, max: 8 },
          dbMin: -120,
        },
      ],
      { min: 0, max: 8 },
      { minimumBins: 8, seamBins: 2, smoothingRadius: 0 },
    );

    const midpoint = stitched.length / 2;
    const leftEdge = stitched[midpoint - 1];
    const rightEdge = stitched[midpoint];

    expect(Math.abs(leftEdge - rightEdge)).toBeLessThan(2);
  });

  it("does not raise a later segment when the previous edge is signal-heavy", () => {
    const stitched = stitchWholeChannelWaveform(
      [
        {
          waveform: new Float32Array([-82, -81, -62, -50]),
          visualRange: { min: 0, max: 4 },
          dbMin: -120,
        },
        {
          waveform: new Float32Array([-84, -83, -82, -81]),
          visualRange: { min: 4, max: 8 },
          dbMin: -120,
        },
      ],
      { min: 0, max: 8 },
      { minimumBins: 8, seamBins: 2, smoothingRadius: 0 },
    );

    expect(stitched[stitched.length / 2]).toBeLessThan(-80);
  });

  it("uses linear resampling instead of nearest-bin steps", () => {
    const stitched = stitchWholeChannelWaveform(
      [
        {
          waveform: new Float32Array([0, 10]),
          visualRange: { min: 0, max: 4 },
          dbMin: -120,
        },
      ],
      { min: 0, max: 4 },
      { minimumBins: 5, seamBins: 0, smoothingRadius: 0 },
    );

    expect(Array.from(stitched)).toEqual([0, 2.5, 5, 7.5, 10]);
  });
});
