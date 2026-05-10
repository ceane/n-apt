import { WATERFALL_3D_FRAGMENT_SHADER } from "../../../src/ts/consts/shaders/waterfall3d";

describe("waterfall3d_fragment.wgsl", () => {
  it("stays non-empty", () => {
    expect(WATERFALL_3D_FRAGMENT_SHADER.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry point", () => {
    expect(WATERFALL_3D_FRAGMENT_SHADER).toContain("fn main");
  });
});
