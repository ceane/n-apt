import { readFileSync } from "node:fs";
import { join } from "node:path";

const SPIKE_COMPUTE_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/spike_compute.wgsl"),
  "utf8",
);

describe("spike_compute.wgsl", () => {
  it("stays non-empty", () => {
    expect(SPIKE_COMPUTE_WGSL.trim()).not.toHaveLength(0);
  });

  it("exports the expected spike compute entry point", () => {
    expect(SPIKE_COMPUTE_WGSL).toContain("fn main");
    expect(SPIKE_COMPUTE_WGSL).toContain("SpikeMarker");
    expect(SPIKE_COMPUTE_WGSL).toContain("spike_count");
  });
});
