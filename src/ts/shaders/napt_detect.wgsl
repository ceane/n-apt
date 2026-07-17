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
const MIN_NAPT_SCORE: f32 = 0.60;
const STRONG_SHAPE_THRESHOLD: f32 = 0.70;
const STRONG_SHAPE_BONUS: f32 = 0.05;
const STRONG_BRIDGE_THRESHOLD: f32 = 0.80;
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
  let floor_relative_power_score = metrics.floor_relative_power_score;
  let u_dip_score = metrics.u_dip_score;
  let temporal_stability_score = metrics.temporal_stability;
  let bandwidth_prior = metrics.bandwidth_prior;
  let envelope_fit_score = metrics.envelope_fit_score;
  let sinc_penalty_score = metrics.sinc_penalty_score;
  // Penalties are additive and bounded. They reject isolated spurs, sparse
  // frames, and flat/DC cases without hard-coding a particular RF frequency.
  let rejection_penalty =
    select(0.0, 0.20, suspension_bridge_score < MIN_SUSPENSION_BRIDGE_SCORE) +
    select(0.0, 0.12, metrics.clump_count < 2u) +
    select(0.0, 0.10, metrics.bridge_shoulder_score < 0.10) +
    select(0.0, 0.08, metrics.above_floor_fraction > 0.75) +
    // Flat noise with a dominant DC spur has neither the broad U envelope
    // nor the repeated clump support required by N-APT.
    select(0.0, 0.15,
      u_dip_score < 0.50 && suspension_bridge_score < 0.50) +
    // A strong local hat without any supporting U-dip is characteristic of
    // an isolated dome/spur, not the N-APT family structure. Keep this as a
    // penalty rather than a hard bridge gate so a partially visible capture
    // can still land in Likely when its U-dip is merely shallow.
    select(0.0, 0.30,
      u_dip_score < 0.35 && suspension_bridge_score > 0.70) +
    select(0.0, 0.10,
      u_dip_score < 0.50 && metrics.spike_count < 64u) +
    // Envelope fit is advisory. A VFO can show only one shoulder or a
    // partial valley, so a weak global fit must not erase strong local
    // suspension_bridge/U-dip evidence.
    select(0.0, 0.08,
      envelope_fit_score < 0.20 &&
      suspension_bridge_score < 0.55 &&
      u_dip_score < 0.55) +
    SINC_PENALTY_WEIGHT * sinc_penalty_score;
  // A small bonus rewards agreement between the two primary shape measures.
  // It is deliberately bounded so it cannot turn noise into a positive.
  let strong_shape_bonus = select(
    0.0,
    STRONG_SHAPE_BONUS,
    suspension_bridge_score >= STRONG_SHAPE_THRESHOLD &&
    u_dip_score >= STRONG_SHAPE_THRESHOLD);
  // The 0.45 bridge weight is the dominant contributor specified by the
  // classifier contract. The final threshold is provisional and should be
  // calibrated with labeled hardware captures and synthetic fixtures.
  let weighted_score = clamp(
    0.45 * suspension_bridge_score +
    0.20 * u_dip_score +
    0.15 * floor_relative_power_score +
    0.10 * temporal_stability_score +
    0.10 * bandwidth_prior + 0.10 * envelope_fit_score + strong_shape_bonus -
    rejection_penalty,
    0.0, 1.0);
  // A strong multi-hat suspension bridge is independently characteristic.
  // Do not reserve 20% of confidence for a U-dip that may be outside the tuned
  // capture. The strict guards keep this path unavailable to sparse/DC frames.
  let bridge_dominant_confidence = select(
    0.0,
    clamp(
      0.75 * suspension_bridge_score +
      0.15 * envelope_fit_score +
      0.10 * metrics.envelope_residual_score,
      0.0,
      1.0),
    suspension_bridge_score >= STRONG_BRIDGE_THRESHOLD &&
    metrics.clump_count >= 2u &&
    metrics.bridge_shoulder_score >= 0.50);
  let score = max(
    weighted_score,
    max(0.0, bridge_dominant_confidence -
      SINC_PENALTY_WEIGHT * sinc_penalty_score));
  decision.confidence = score;
  decision.is_napt = select(0u, 1u,
    score >= MIN_NAPT_SCORE &&
    suspension_bridge_score >= MIN_SUSPENSION_BRIDGE_SCORE &&
    metrics.clump_count >= 2u);
}
