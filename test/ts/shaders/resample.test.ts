import { describe, expect, it } from "vitest";
import { resampleShader } from "@n-apt/shaders";

describe("resample.wgsl", () => {
  it("stays non-empty", () => {
    expect(resampleShader.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry point", () => {
    expect(resampleShader).toContain("fn main");
  });
});
