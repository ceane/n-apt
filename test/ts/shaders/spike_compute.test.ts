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

  it("uses deterministic plateau-aware peak localization", () => {
    expect(SPIKE_COMPUTE_WGSL).toContain("let is_peak =");
    expect(SPIKE_COMPUTE_WGSL).toContain("val >= left");
    expect(SPIKE_COMPUTE_WGSL).toContain("val > right");
    expect(SPIKE_COMPUTE_WGSL).not.toContain("left + 0.45");
  });

  it("retains enough candidates for dense FFT spectra", () => {
    expect(SPIKE_COMPUTE_WGSL).toContain("const MAX_SPIKES: u32 = 1024u;");
  });

  it("suppresses weaker raw-bin maxima inside one spike neighborhood", () => {
    expect(SPIKE_COMPUTE_WGSL).toContain(
      "var has_dominating_neighbor = false;",
    );
    expect(SPIKE_COMPUTE_WGSL).toContain("sample > val");
    expect(SPIKE_COMPUTE_WGSL).toContain("sample == val && j > i");
    expect(SPIKE_COMPUTE_WGSL).toContain("if (has_dominating_neighbor)");
  });

  it("detects on display-scale maxima but emits their exact raw FFT indices", () => {
    expect(SPIKE_COMPUTE_WGSL).toContain("source_peak_indices");
    expect(SPIKE_COMPUTE_WGSL).toContain(
      "let source_index = source_peak_indices[i];",
    );
    expect(SPIKE_COMPUTE_WGSL).toContain("spikes[idx].index = source_index;");
    expect(SPIKE_COMPUTE_WGSL).toContain("suppression_radius");
  });

  it("only merges overlapping display crests and retains low-contrast spikes", () => {
    expect(SPIKE_COMPUTE_WGSL).toContain(
      "min(max(1u, params.window_size), 2u)",
    );
    expect(SPIKE_COMPUTE_WGSL).toContain("avg_prominence >= 3.5");
    expect(SPIKE_COMPUTE_WGSL).toContain("global_floor_score >= 4.5");
  });

  it("recognizes visually obvious peaks by their two-sided valley prominence", () => {
    expect(SPIKE_COMPUTE_WGSL).toContain("var left_valley = val;");
    expect(SPIKE_COMPUTE_WGSL).toContain("var right_valley = val;");
    expect(SPIKE_COMPUTE_WGSL).toContain(
      "let valley_prominence = val - max(left_valley, right_valley);",
    );
    expect(SPIKE_COMPUTE_WGSL).toContain("valley_prominence >= 1.5");
  });

  it("uses a conservative recovery pass without emitting primary-pass duplicates", () => {
    expect(SPIKE_COMPUTE_WGSL).toContain("recovery_pass: u32");
    expect(SPIKE_COMPUTE_WGSL).toContain("params.recovery_pass != 0u");
    expect(SPIKE_COMPUTE_WGSL).toContain("atomicLoad(&spike_count)");
    expect(SPIKE_COMPUTE_WGSL).toContain(
      "spikes[existing_index].index == source_index",
    );
    expect(SPIKE_COMPUTE_WGSL).toContain("recovery_prominent");
  });

  it("uses one-sided prominence for peaks in the final display bins", () => {
    expect(SPIKE_COMPUTE_WGSL).toContain("const EDGE_BAND_BINS: u32 = 10u;");
    expect(SPIKE_COMPUTE_WGSL).toContain("i + EDGE_BAND_BINS >= l");
    expect(SPIKE_COMPUTE_WGSL).toContain("right_edge_prominence");
    expect(SPIKE_COMPUTE_WGSL).toContain("val - left_valley");
    expect(SPIKE_COMPUTE_WGSL).toContain("var is_edge_band_max = true;");
    expect(SPIKE_COMPUTE_WGSL).toContain("edge_band_start");
    expect(SPIKE_COMPUTE_WGSL).toContain(
      "edge_sample > val || (edge_sample == val && edge_index > i)",
    );
    expect(SPIKE_COMPUTE_WGSL).toContain(
      "let is_peak = immediate_peak || (is_right_edge_band && is_edge_band_max);",
    );
    expect(SPIKE_COMPUTE_WGSL).toContain("let edge_rise = val - left_valley;");
    expect(SPIKE_COMPUTE_WGSL).toContain(
      "let edge_corner = val - (left + (left - left2));",
    );
    expect(SPIKE_COMPUTE_WGSL).toContain("edge_rise >= 0.35");
  });
});
