// Read-only view of the finalized classifier result. The ten reserved words
// preserve the same 40-byte prefix as ClassifierResult's atomic fields; the
// scalar metrics therefore begin at byte offset 40 in both buffers.
struct Metrics {
  reserved0: u32,
  reserved1: u32,
  reserved2: u32,
  reserved3: u32,
  reserved4: u32,
  reserved5: u32,
  reserved6: u32,
  reserved7: u32,
  reserved8: u32,
  reserved9: u32,
  floor_dbm: f32,
  above_floor_fraction: f32,
  periodicity: f32,
  spike_count: u32,
  suspension_bridge_score: f32,
  clump_count: u32,
  bridge_width_score: f32,
  bridge_shoulder_score: f32,
  u_dip_score: f32,
  floor_relative_power_score: f32,
  temporal_stability: f32,
  bandwidth_prior: f32,
  envelope_fit_score: f32,
  envelope_residual_score: f32,
  envelope_support_count: u32,
  sinc_penalty_score: f32,
  low_rise_bridge_score: f32,
  u_dip_source: u32,
  unimodal_bridge_score: f32,
  partial_bridge_score: f32,
  apex_prominence_score: f32,
  shoulder_symmetry_score: f32,
  capture_quality_score: f32,
}

// Host readback layout: uint32 is_napt at byte 0 and confidence f32 at byte 4.
struct Decision {
  is_napt: u32,
  confidence: f32,
}

@group(0) @binding(0) var<storage, read> metrics: Metrics;
@group(0) @binding(1) var<storage, read_write> decision: Decision;

// A bridge remains the dominant feature, but real captures can have narrow
// FFT valleys that lower its normalized occupancy. Keep the guard permissive
// enough for tuning movement while the weighted score does the discrimination.
const MIN_SUSPENSION_BRIDGE_SCORE: f32 = 0.20;
// The legacy suspension_bridge aggregate can be high for a random comb or a
// broad hardware response. Require the newer geometric bridge evidence before
// allowing that aggregate to produce a positive classifier result.
const MIN_COHERENT_BRIDGE_SHAPE_SCORE: f32 = 0.25;
const NO_COHERENT_SHAPE_CONFIDENCE_CAP: f32 = 0.49;
const MIN_NAPT_SCORE: f32 = 0.60;
const STRONG_SHAPE_THRESHOLD: f32 = 0.70;
const STRONG_SHAPE_BONUS: f32 = 0.05;
const STRONG_BRIDGE_THRESHOLD: f32 = 0.80;
const CAPTURE_QUALITY_LIKELY_CAP: f32 = 0.74;
const SEVERE_ARTIFACT_QUALITY: f32 = 0.30;
// A sinc-shaped response is a hardware/rendering artifact, not weak N-APT
// evidence. Give it enough weight to move an otherwise convincing-looking
// one-frame artifact below the Likely band without treating every broad peak
// as a sinc (the metric itself already requires bilateral sidelobes and
// mirrored decay).
const SINC_PENALTY_WEIGHT: f32 = 0.60;

@compute @workgroup_size(1)
fn main() {
  // suspension_bridge is intentionally the dominant central structure. The
  // other terms confirm envelope shape, power, temporal policy, and capture
  // bandwidth; none can override a missing bridge by itself.
  let suspension_bridge_score = metrics.suspension_bridge_score;
  let unimodal_bridge_score = metrics.unimodal_bridge_score;
  let floor_relative_power_score = metrics.floor_relative_power_score;
  let u_dip_score = metrics.u_dip_score;
  let coherent_bridge_shape_score = max(
    metrics.unimodal_bridge_score,
    metrics.partial_bridge_score);
  let missing_coherent_bridge_shape =
    coherent_bridge_shape_score < MIN_COHERENT_BRIDGE_SHAPE_SCORE;
  let temporal_stability_score = metrics.temporal_stability;
  let bandwidth_prior = metrics.bandwidth_prior;
  let envelope_fit_score = metrics.envelope_fit_score;
  let sinc_penalty_score = metrics.sinc_penalty_score;
  let capture_quality_score = clamp(metrics.capture_quality_score, 0.0, 1.0);
  // A low-rise suspension_bridge can be real even when the capture-wide U is
  // outside the VFO. Width and bilateral shoulder support are retained as a
  // separate structural route; they cannot promote a one-clump spur or a
  // sparse/DC frame.
  let low_rise_bridge_score = metrics.low_rise_bridge_score;
  let has_low_rise_bridge = low_rise_bridge_score >= 0.40 &&
    metrics.above_floor_fraction < 0.45 &&
    metrics.spike_count >= 64u;
  let effective_bridge_score = max(
    max(suspension_bridge_score, unimodal_bridge_score),
    select(0.0, low_rise_bridge_score, has_low_rise_bridge));
  // A genuine bilateral low-rise structure gets only a partial sinc penalty;
  // otherwise an incidental broad comb can be rejected before its structure
  // is considered.
  let effective_sinc_penalty = select(
    sinc_penalty_score,
    0.0,
    has_low_rise_bridge);
  let low_rise_shape_bonus = select(0.0, 0.08, has_low_rise_bridge);
  // Penalties are additive and bounded. They reject isolated spurs, sparse
  // frames, and flat/DC cases without hard-coding a particular RF frequency.
  let rejection_penalty =
    select(0.0, 0.20, effective_bridge_score < MIN_SUSPENSION_BRIDGE_SCORE) +
    select(0.0, 0.12, metrics.clump_count < 2u) +
    select(0.0, 0.10, metrics.bridge_shoulder_score < 0.10) +
    select(0.0, 0.08, metrics.above_floor_fraction > 0.75) +
    // Flat noise with a dominant DC spur has neither the broad U envelope
    // nor the repeated clump support required by N-APT.
    select(0.0, 0.15,
      u_dip_score < 0.50 && effective_bridge_score < 0.50 && !has_low_rise_bridge) +
    // A strong local hat without any supporting U-dip is characteristic of
    // an isolated dome/spur, not the N-APT family structure. Keep this as a
    // penalty rather than a hard bridge gate so a partially visible capture
    // can still land in Likely when its U-dip is merely shallow.
    select(0.0, 0.30,
      u_dip_score < 0.35 && effective_bridge_score > 0.70 && !has_low_rise_bridge) +
    select(0.0, 0.10,
      u_dip_score < 0.50 && metrics.spike_count < 64u) +
    // Envelope fit is advisory. A VFO can show only one shoulder or a
    // partial valley, so a weak global fit must not erase strong local
    // suspension_bridge/U-dip evidence.
    select(0.0, 0.08,
      envelope_fit_score < 0.20 &&
      effective_bridge_score < 0.55 &&
      u_dip_score < 0.55 && !has_low_rise_bridge) +
    // A high legacy bridge aggregate is not enough: Mock combs can have tall
    // spikes and an apparent U while lacking a single coherent apex geometry.
    select(0.0, 0.20, missing_coherent_bridge_shape) +
    SINC_PENALTY_WEIGHT * effective_sinc_penalty;
  // A small bonus rewards agreement between the two primary shape measures.
  // It is deliberately bounded so it cannot turn noise into a positive.
  let strong_shape_bonus = select(
    0.0,
    STRONG_SHAPE_BONUS,
    effective_bridge_score >= STRONG_SHAPE_THRESHOLD &&
    u_dip_score >= STRONG_SHAPE_THRESHOLD);
  // The 0.45 bridge weight is the dominant contributor specified by the
  // classifier contract. The final threshold is provisional and should be
  // calibrated with labeled hardware captures and synthetic fixtures.
  let weighted_score = clamp(
    0.45 * effective_bridge_score +
    0.20 * u_dip_score +
    0.15 * floor_relative_power_score +
    0.10 * temporal_stability_score +
    0.10 * bandwidth_prior + 0.10 * envelope_fit_score +
    strong_shape_bonus + low_rise_shape_bonus -
    rejection_penalty,
    0.0, 1.0);
  // A strong multi-hat suspension bridge is independently characteristic.
  // Do not reserve 20% of confidence for a U-dip that may be outside the tuned
  // capture. The strict guards keep this path unavailable to sparse/DC frames.
  let bridge_dominant_confidence = select(
    0.0,
    clamp(
      0.75 * effective_bridge_score +
      0.15 * envelope_fit_score +
      0.10 * metrics.envelope_residual_score,
      0.0,
      1.0),
    effective_bridge_score >= STRONG_BRIDGE_THRESHOLD &&
    metrics.clump_count >= 2u &&
    metrics.bridge_shoulder_score >= 0.50);
  let raw_score = max(
    weighted_score,
    max(0.0, bridge_dominant_confidence -
      SINC_PENALTY_WEIGHT * effective_sinc_penalty));
  // Artifact-heavy frames can retain useful shape evidence, but must not be
  // promoted to Yes on quality alone. A sufficiently severe artifact with no
  // coherent structure is rejected outright; a structured but degraded frame
  // is preserved as Likely for manual review (including partial Channel C).
  let severe_artifact_rejection = capture_quality_score < SEVERE_ARTIFACT_QUALITY &&
    effective_bridge_score < 0.45 &&
    u_dip_score < 0.45;
  let artifact_quality_cap = select(
    raw_score,
    min(raw_score, CAPTURE_QUALITY_LIKELY_CAP),
    capture_quality_score < 0.45);
  let shape_quality_cap = select(
    artifact_quality_cap,
    min(artifact_quality_cap, NO_COHERENT_SHAPE_CONFIDENCE_CAP),
    missing_coherent_bridge_shape);
  let score = select(shape_quality_cap, 0.49, severe_artifact_rejection);
  decision.confidence = score;
  decision.is_napt = select(0u, 1u,
    score >= MIN_NAPT_SCORE &&
    effective_bridge_score >= MIN_SUSPENSION_BRIDGE_SCORE &&
    metrics.clump_count >= 2u &&
    !missing_coherent_bridge_shape);
}
