import { removeDcSpikeFromSpectrum } from "@n-apt/spectrum/utils/removeDcSpike";

describe("removeDcSpikeFromSpectrum", () => {
  it("replaces the centered DC bin with the mean of its adjacent bins", () => {
    const input = new Float32Array([-80, -70, -12, -69, -79]);

    expect(Array.from(removeDcSpikeFromSpectrum(input))).toEqual([
      -80,
      -70,
      -69.5,
      -69,
      -79,
    ]);
    expect(Array.from(input)).toEqual([-80, -70, -12, -69, -79]);
  });

  it("returns a copy unchanged when there is no centered neighbor pair", () => {
    const input = new Float32Array([-12, -9]);

    expect(Array.from(removeDcSpikeFromSpectrum(input))).toEqual([-12, -9]);
  });
});
