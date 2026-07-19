import { readFileSync } from "node:fs";
import { join } from "node:path";

const NAPT_CLASSIFY_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/napt_classify.wgsl"),
  "utf8",
);
const NAPT_DETECT_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/napt_detect.wgsl"),
  "utf8",
);
const NAPT_TEMPORAL_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/napt_temporal.wgsl"),
  "utf8",
);
const FFT_HOOK_SOURCE = readFileSync(
  join(process.cwd(), "src/ts/hooks/useDrawWebGPUFFTSignal.ts"),
  "utf8",
);
const FFT_CANVAS_SOURCE = readFileSync(
  join(process.cwd(), "src/ts/components/FFTCanvas.tsx"),
  "utf8",
);

describe("N-APT classifier", () => {
  it("defines a compute stage for floor-relative N-APT metrics", () => {
    expect(NAPT_CLASSIFY_WGSL).toContain("@compute");
    expect(NAPT_CLASSIFY_WGSL).toContain("above_floor_fraction");
    expect(NAPT_CLASSIFY_WGSL).toContain("periodicity");
    expect(NAPT_DETECT_WGSL).toContain("is_napt");
    expect(NAPT_DETECT_WGSL).toContain("confidence");
    expect(NAPT_DETECT_WGSL).toContain("@group(0) @binding(0)");
  });

  it("computes explicit suspension_bridge/clump and U-dip metrics", () => {
    expect(NAPT_CLASSIFY_WGSL).toContain("suspension_bridge_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("clump_count");
    expect(NAPT_CLASSIFY_WGSL).toContain("bridge_width_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("bridge_shoulder_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("u_dip_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("envelope_fit_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("envelope_residual_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("envelope_support_count");
    expect(NAPT_CLASSIFY_WGSL).toContain("hat_clump_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("hat_clump_count");
    expect(NAPT_CLASSIFY_WGSL).toContain("local_hat_correlation");
    expect(NAPT_CLASSIFY_WGSL).toContain("left_hat_correlation");
    expect(NAPT_CLASSIFY_WGSL).toContain("right_hat_correlation");
    expect(NAPT_CLASSIFY_WGSL).toContain("edge_hat_support");
    expect(NAPT_CLASSIFY_WGSL).toContain("balanced_hat_support");
    expect(NAPT_CLASSIFY_WGSL).toContain("broad_u_coverage_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("sustained_center_valley");
    expect(NAPT_CLASSIFY_WGSL).toContain("wide_u_dip_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("bilateral_shoulder_coverage");
    expect(NAPT_CLASSIFY_WGSL).toContain("wide_u_trend_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("normalized_wide_depth");
    expect(NAPT_CLASSIFY_WGSL).toContain("quadratic_wide_u_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("MIN_WIDE_U_CORRELATION");
    expect(NAPT_CLASSIFY_WGSL).toContain("independent_bridge_shoulders");
    expect(NAPT_CLASSIFY_WGSL).toContain("MIN_VALIDATED_HAT_PAIR_SCORE");
    expect(NAPT_CLASSIFY_WGSL).toContain("ordered_bridge_score");
    expect(NAPT_CLASSIFY_WGSL).toContain(
      "const BRIDGE_ORDER_LIFT_EXPONENT: f32 = 0.75;",
    );
    expect(NAPT_CLASSIFY_WGSL).toContain(
      "let pair_quality_score = select(\n        0.0,\n        1.0,",
    );
    expect(NAPT_CLASSIFY_WGSL).toContain("normalized_position");
    expect(NAPT_CLASSIFY_WGSL).toContain("global_u_dip");
    expect(NAPT_CLASSIFY_WGSL).toContain("MIN_LOW_RISE_BRIDGE_WIDTH");
    expect(NAPT_CLASSIFY_WGSL).toContain("low_rise_bridge_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("irregular_sinc_structure_penalty");
    expect(NAPT_CLASSIFY_WGSL).toContain(
      "IRREGULAR_SINC_MIN_BRIDGE_SCORE",
    );
    expect(NAPT_CLASSIFY_WGSL).toContain(
      "IRREGULAR_SINC_MIN_U_DIP_SCORE",
    );
    expect(NAPT_CLASSIFY_WGSL).toContain("u_dip_source");
    expect(NAPT_DETECT_WGSL).toContain("low_rise_bridge_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("envelope_min");
    expect(NAPT_CLASSIFY_WGSL).toContain("robust_envelope_at");
  });

  it("exposes tolerant unimodal bridge diagnostics", () => {
    expect(NAPT_CLASSIFY_WGSL).toContain("unimodal_bridge_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("partial_bridge_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("apex_prominence_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("shoulder_symmetry_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("unimodal_violation_score");
    expect(NAPT_CLASSIFY_WGSL).toContain("UNIMODAL_ORDER_TOLERANCE_DB");
    expect(NAPT_CLASSIFY_WGSL).toContain("PARTIAL_BRANCH_FULL_SCORE");
  });

  it("keeps the classifier readback contract large enough for shape diagnostics", () => {
    expect(NAPT_CLASSIFY_WGSL).toContain("shoulder_symmetry_score: f32");
    expect(NAPT_CLASSIFY_WGSL).toContain("capture_quality_score: f32");
    expect(NAPT_DETECT_WGSL).toContain("shoulder_symmetry_score: f32");
    expect(NAPT_DETECT_WGSL).toContain("capture_quality_score: f32");
    expect(NAPT_TEMPORAL_WGSL).toContain("unimodal_bridge_score: f32");
  });

  it("copies the complete classifier result before reading extended diagnostics", () => {
    expect(FFT_HOOK_SOURCE).toContain(
      "state.naptClassifyReadbackBuffer,\n            0,\n            132,",
    );
    expect(FFT_CANVAS_SOURCE).toMatch(
      /captureQualityScore:\s*Math\.max\(\s*0,\s*Math\.min\(\s*1,\s*1\s*-\s*sincPenaltyScore\s*\)\s*,?\s*\)/,
    );
  });

  it("uses suspension_bridge as the dominant detection weight and rejects weak structure", () => {
    expect(NAPT_DETECT_WGSL).toContain("0.45");
    expect(NAPT_DETECT_WGSL).toContain("suspension_bridge_score");
    expect(NAPT_DETECT_WGSL).toContain("rejection_penalty");
    expect(NAPT_DETECT_WGSL).toContain("envelope_fit_score");
    expect(NAPT_DETECT_WGSL).toContain("MIN_SUSPENSION_BRIDGE_SCORE");
    expect(NAPT_DETECT_WGSL).toContain("bridge_dominant_confidence");
    expect(NAPT_DETECT_WGSL).toContain("STRONG_BRIDGE_THRESHOLD");
    expect(NAPT_DETECT_WGSL).toContain("has_low_rise_bridge");
    expect(NAPT_DETECT_WGSL).toContain("low_rise_shape_bonus");
    expect(NAPT_DETECT_WGSL).toContain("CAPTURE_QUALITY_LIKELY_CAP");
    expect(NAPT_DETECT_WGSL).toContain("severe_artifact_rejection");
    expect(NAPT_DETECT_WGSL).toContain("0.60");
  });

  it("does not promote a bridge when unimodal and partial geometry are absent", () => {
    expect(NAPT_DETECT_WGSL).toContain("coherent_bridge_shape_score");
    expect(NAPT_DETECT_WGSL).toContain("MIN_COHERENT_BRIDGE_SHAPE_SCORE");
    expect(NAPT_DETECT_WGSL).toContain("NO_COHERENT_SHAPE_CONFIDENCE_CAP");
    expect(NAPT_DETECT_WGSL).toContain("!missing_coherent_bridge_shape");
    expect(NAPT_TEMPORAL_WGSL).toContain("validated_bridge_shape_support");
    expect(NAPT_TEMPORAL_WGSL).toContain("frame.bridge_shape_support >=");
    expect(NAPT_TEMPORAL_WGSL).toContain("temporal_shape_supported");
    expect(NAPT_TEMPORAL_WGSL).toContain("min(temporal_confidence, 0.49)");
  });

  it("keeps tuning movement normalized and exposes temporal stability", () => {
    expect(NAPT_CLASSIFY_WGSL).toContain("temporal_stability");
    expect(NAPT_CLASSIFY_WGSL).toContain("normalized_position");
    expect(NAPT_DETECT_WGSL).toContain("bandwidth_prior");
  });

  it("defines a separate higher-order temporal pass without replacing the baseline", () => {
    expect(NAPT_TEMPORAL_WGSL).toContain("baseline_is_napt");
    expect(NAPT_TEMPORAL_WGSL).toContain("temporal_is_napt");
    expect(NAPT_TEMPORAL_WGSL).toContain("persistence");
    expect(NAPT_TEMPORAL_WGSL).toContain("HISTORY_LENGTH");
    expect(NAPT_TEMPORAL_WGSL).toContain("history");
    expect(NAPT_TEMPORAL_WGSL).toContain("frame_count >= 4u");
  });
});
