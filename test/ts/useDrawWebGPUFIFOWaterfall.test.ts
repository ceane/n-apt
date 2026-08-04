import { copySpectrumIntoWaterfallRow } from "../../src/ts/hooks/useDrawWebGPUFIFOWaterfall";

describe("copySpectrumIntoWaterfallRow", () => {
  it("copies a native-width spectrum without resampling", () => {
    const spectrum = new Float32Array([-80, -40, -20, -60]);
    const target = new Float32Array(4);

    copySpectrumIntoWaterfallRow(target, spectrum);

    expect(Array.from(target)).toEqual([-80, -40, -20, -60]);
  });

  it("resamples spectra that do not match the renderer width", () => {
    const spectrum = new Float32Array([-80, -20]);
    const target = new Float32Array(4);

    copySpectrumIntoWaterfallRow(target, spectrum);

    expect(Array.from(target)).toEqual([-80, -80, -20, -20]);
  });
});
