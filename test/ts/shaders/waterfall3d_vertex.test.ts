import { describe, expect, it } from "vitest";
import { waterfall3dVertexShader } from "@n-apt/shaders";

describe("waterfall3d_vertex.wgsl", () => {
  it("stays non-empty", () => {
    expect(waterfall3dVertexShader.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry point", () => {
    expect(waterfall3dVertexShader).toContain("fn main");
  });
});
