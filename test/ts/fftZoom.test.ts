import { createFFTZoomProcessor } from "@n-apt/spectrum/utils/rendering/fftZoom";

describe("createFFTZoomProcessor", () => {
  const range = { min: 0, max: 8 };

  it("returns a zero-copy view for an in-bounds zoom", () => {
    const source = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const zoom = createFFTZoomProcessor(-200);

    const result = zoom.process(source, range, 2, 0);

    expect(result.slicedWaveform.buffer).toBe(source.buffer);
    expect(Array.from(result.slicedWaveform)).toEqual([2, 3, 4, 5]);
  });

  it("reuses padded storage and clears stale values", () => {
    const zoom = createFFTZoomProcessor(-200);
    const first = zoom.process(new Float32Array([1, 2, 3, 4]), range, 0.5, 0);
    const firstStorage = first.slicedWaveform;

    const second = zoom.process(new Float32Array([9, 8, 7, 6]), range, 0.5, -4);

    expect(second.slicedWaveform).toBe(firstStorage);
    expect(Array.from(second.slicedWaveform)).toEqual([
      -200, -200, -200, -200, 9, 8, 7, 6,
    ]);
  });
});
