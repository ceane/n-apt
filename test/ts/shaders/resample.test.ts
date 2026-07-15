import { readFileSync } from "node:fs";
import { join } from "node:path";

const RESAMPLE_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/resample.wgsl"),
  "utf8",
);

describe("resample.wgsl", () => {
  it("stays non-empty", () => {
    expect(RESAMPLE_WGSL.trim()).not.toHaveLength(0);
  });

  it("exports the expected entry point", () => {
    expect(RESAMPLE_WGSL).toContain("fn main");
  });

  it("preserves the raw FFT index of each displayed bucket maximum", () => {
    expect(RESAMPLE_WGSL).toContain("output_peak_indices");
    expect(RESAMPLE_WGSL).toContain("var max_index: u32");
    expect(RESAMPLE_WGSL).toContain("output_peak_indices[x] = max_index;");
  });
});
