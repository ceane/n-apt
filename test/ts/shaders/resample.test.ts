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
    expect(RESAMPLE_WGSL).toContain("output_peak_indices[x] = u32(peak.y);");
  });

  it("folds negative display frequencies onto the positive acquisition on the GPU", () => {
    expect(RESAMPLE_WGSL).toContain("mirror_enabled");
    expect(RESAMPLE_WGSL).toContain("source_frequency");
    expect(RESAMPLE_WGSL).toContain("display_min");
    expect(RESAMPLE_WGSL).toContain("source_min");
  });

  it("uses frequency-space GPU resampling when mirroring is disabled", () => {
    expect(RESAMPLE_WGSL).toContain("return display_hz;");
    expect(RESAMPLE_WGSL).not.toContain("if (params.mirror_enabled == 0u)");
  });

  it("reflects negative display frequencies across DC on the GPU", () => {
    expect(RESAMPLE_WGSL).toContain("mirror_enabled");
    expect(RESAMPLE_WGSL).toContain("mirrored_source_frequency");
    expect(RESAMPLE_WGSL).toContain("-display_hz");
    expect(RESAMPLE_WGSL).not.toContain("negative_band_source_frequency");
  });

  it("keeps the mirror-off full-frame path on the proportional bin fast path", () => {
    expect(RESAMPLE_WGSL).toContain("fast_path_start");
    expect(RESAMPLE_WGSL).toContain("params.mirror_enabled == 0u");
    expect(RESAMPLE_WGSL).toContain("f32(params.src_len) / f32(params.out_len)");
  });

  it("slides stale acquisitions during an in-flight same-span retune", () => {
    expect(RESAMPLE_WGSL).toContain("presentation_offset_hz");
    expect(RESAMPLE_WGSL).toContain(
      "display_span - params.presentation_offset_hz",
    );
  });
});
