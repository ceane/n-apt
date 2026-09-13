import { getFrontendFftSize } from "@n-apt/spectrum/utils/frontendFftSize";

describe("frontend FFT processing size", () => {
  it("caps oversized hardware FFT payloads to the GPU processing limit", () => {
    expect(getFrontendFftSize(1_048_576)).toBe(262_144);
    expect(getFrontendFftSize(131_072)).toBe(131_072);
  });
});
