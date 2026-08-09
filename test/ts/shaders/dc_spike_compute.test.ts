import { readFileSync } from "node:fs";
import { join } from "node:path";

const DC_SPIKE_COMPUTE_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/dc_spike_compute.wgsl"),
  "utf8",
);

describe("dc_spike_compute.wgsl", () => {
  it("copies the spectrum and replaces the centered DC bin", () => {
    expect(DC_SPIKE_COMPUTE_WGSL).toContain("fn remove_dc_spike");
    expect(DC_SPIKE_COMPUTE_WGSL).toContain("spectrum_in");
    expect(DC_SPIKE_COMPUTE_WGSL).toContain("spectrum_out");
    expect(DC_SPIKE_COMPUTE_WGSL).toContain("length / 2u");
    expect(DC_SPIKE_COMPUTE_WGSL).toContain("(left + right) * 0.5");
  });
});
