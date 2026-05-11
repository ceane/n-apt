import { RESAMPLE_WGSL } from "../../../src/ts/consts/shaders/resample";

describe("resample.wgsl", () => {
  it("stays non-empty", () => {
    expect(RESAMPLE_WGSL.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry point", () => {
    expect(RESAMPLE_WGSL).toContain("fn main");
  });
});
