import { describe, expect, it } from "vitest";
import { waterfall3dFragmentShader } from "@n-apt/shaders";

describe("waterfall3d_fragment.wgsl", () => {
  it("stays non-empty", () => {
    expect(waterfall3dFragmentShader.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry point", () => {
    expect(waterfall3dFragmentShader).toContain("fn main");
  });
});
