import { SPECTRUM_SHADER } from "../../../src/ts/consts/shaders/spectrum";

describe("spectrum.wgsl", () => {
  it("stays non-empty", () => {
    expect(SPECTRUM_SHADER.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry points", () => {
    expect(SPECTRUM_SHADER).toContain("fn vs_line");
    expect(SPECTRUM_SHADER).toContain("fn vs_fill");
    expect(SPECTRUM_SHADER).toContain("fn fs_line");
    expect(SPECTRUM_SHADER).toContain("fn fs_fill");
  });
});
