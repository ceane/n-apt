// Higher-order N-APT decision pass.
//
// napt_classify.wgsl and napt_detect.wgsl remain the one-frame baseline. This
// pass receives that baseline decision plus a persistent ring of recent shape
// metrics. It deliberately tracks structural presence (ordered bridge support
// and U support), not raw amplitude, so the expected N-APT pulse can breathe
// without being treated as temporal instability.

// Keep enough history to cover a full visible N-APT structure while tuning.
// A single FFT frame can hide the U-dip behind a bridge peak, and a short
// eight-frame ring could forget the structure before the readback at the end
// of a manual capture. The host allocates the matching 32-frame ring.
const HISTORY_LENGTH: u32 = 32u;
// Coherence can disappear while tuning and reappear several FFT frames later.
// A four-frame cadence was too tied to a stable VFO view and rejected the
// same suspension_bridge when its clumps moved in and out of the capture.
const MAX_BRIDGE_EVENT_GAP: u32 = 8u;
const MIN_LOW_RISE_BRIDGE_WIDTH: f32 = 0.48;

struct Decision {
  is_napt: u32,
  confidence: f32,
}

// The first ten words match the atomic prefix of ClassifierResult. The scalar
// metrics begin at byte offset 40, matching the read-only napt_detect view.
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
}

struct HistoryFrame {
  suspension_bridge_score: f32,
  u_dip_score: f32,
  baseline_confidence: f32,
  baseline_is_napt: u32,
  clump_count: u32,
  // This slot was previously an unused copy of above_floor_fraction. Keep
  // the history stride at 32 bytes, but use it for the structural support
  // that the one-frame bridge score can under-report when tall spikes crowd
  // out the lower members of a low-rise clump.
  bridge_shape_support: f32,
  envelope_fit_score: f32,
  sinc_penalty_score: f32,
}

struct Params {
  history_length: u32,
  write_index: u32,
  valid_count: u32,
  reserved: u32,
}

struct TemporalDecision {
  // The baseline is copied out explicitly so consumers can compare both
  // decisions without reconstructing the one-frame result.
  baseline_is_napt: u32,
  temporal_is_napt: u32,
  baseline_confidence: f32,
  temporal_confidence: f32,
  persistence: f32,
  bridge_mean: f32,
  u_dip_mean: f32,
  frame_count: u32,
}

@group(0) @binding(0) var<storage, read> baseline: Decision;
@group(0) @binding(1) var<storage, read> metrics: Metrics;
@group(0) @binding(2) var<storage, read_write> history: array<HistoryFrame>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read_write> decision: TemporalDecision;

fn structural_bridge_present(frame: HistoryFrame) -> bool {
  // A partial capture may contain only one visible clump and no useful U-dip
  // yet, but it still needs validated unimodal or partial-branch geometry.
  // The legacy suspension aggregate alone is not enough because Mock combs
  // can make it look like a bridge in every frame.
  return frame.clump_count >= 1u &&
    frame.bridge_shape_support >= 0.25;
}

fn structural_bridge_score(frame: HistoryFrame) -> f32 {
  return frame.bridge_shape_support;
}

@compute @workgroup_size(1)
fn main() {
  let history_length = min(params.history_length, HISTORY_LENGTH);
  let write_index = min(params.write_index, HISTORY_LENGTH - 1u);
  let previous_count = min(params.valid_count, history_length);

  // Preserve the validated unimodal/partial geometry for the higher-order
  // pass. This prevents a high legacy bridge aggregate from promoting a Mock
  // comb while still allowing a partial visible branch to persist.
  let validated_bridge_shape_support = max(
    metrics.unimodal_bridge_score,
    metrics.partial_bridge_score);
  history[write_index] = HistoryFrame(
    metrics.suspension_bridge_score,
    metrics.u_dip_score,
    baseline.confidence,
    baseline.is_napt,
    metrics.clump_count,
    validated_bridge_shape_support,
    metrics.envelope_fit_score,
    metrics.sinc_penalty_score,
  );

  let frame_count = min(history_length, previous_count + 1u);
  var active_count = 0u;
  var bridge_sum = 0.0;
  var u_dip_sum = 0.0;
  var u_dip_peak = 0.0;
  var u_dip_active_sum = 0.0;
  var u_dip_active_count = 0u;
  var sinc_penalty_sum = 0.0;
  var confidence_sum = 0.0;
  var active_bridge_sum = 0.0;
  var previous_active_index = 0u;
  var has_previous_active = false;
  var cadence_hits = 0u;
  var last_active_gap = 0u;
  var low_rise_event_count = 0u;
  var last_low_rise_index = 0u;
  var low_rise_event_score = 0.0;
  for (var index = 0u; index < HISTORY_LENGTH; index = index + 1u) {
    if (index >= frame_count) { continue; }
    // The history buffer is a ring. Walk it oldest-to-newest so cadence and
    // pulse spacing are based on time, not on physical buffer slot order.
    let history_slot = (
      write_index + history_length - frame_count + 1u + index) % history_length;
    let frame = history[history_slot];
    let frame_bridge_score = structural_bridge_score(frame);
    // A low-rise event is specifically a bridge whose width/shoulder support
    // is stronger than its one-frame composite score. A Mock clump that is
    // already scored as a strong bridge does not enter this recovery path.
    let is_low_rise_event = frame.bridge_shape_support >= 0.48;
    if (is_low_rise_event) {
      low_rise_event_count = low_rise_event_count + 1u;
      last_low_rise_index = index;
      low_rise_event_score = max(low_rise_event_score, frame.bridge_shape_support);
    }
    bridge_sum = bridge_sum + frame_bridge_score;
    u_dip_sum = u_dip_sum + frame.u_dip_score;
    sinc_penalty_sum = sinc_penalty_sum + frame.sinc_penalty_score;
    u_dip_peak = max(u_dip_peak, frame.u_dip_score);
    if (frame.u_dip_score >= 0.35) {
      u_dip_active_sum = u_dip_active_sum + frame.u_dip_score;
      u_dip_active_count = u_dip_active_count + 1u;
    }
    confidence_sum = confidence_sum + frame.baseline_confidence;
    if (structural_bridge_present(frame)) {
      active_count = active_count + 1u;
      active_bridge_sum = active_bridge_sum + frame_bridge_score;
      if (has_previous_active) {
        let gap = index - previous_active_index;
        last_active_gap = gap;
        // N-APT's structure pulses. Count a recurring bridge event as
        // coherent when the next event arrives within the wider tuning-aware
        // cadence window; widely separated coincidences remain non-structural.
        if (gap >= 1u && gap <= MAX_BRIDGE_EVENT_GAP) {
          cadence_hits = cadence_hits + 1u;
        }
      }
      previous_active_index = index;
      has_previous_active = true;
    }
  }

  let raw_persistence = f32(active_count) / f32(max(1u, frame_count));
  let cadence_score = select(
    0.0,
    f32(cadence_hits) / f32(max(1u, active_count - 1u)),
    active_count >= 2u);
  let pulse_density = clamp(f32(active_count) / 3.0, 0.0, 1.0);
  let three_event_pulse_support = pulse_density * cadence_score;
  // A visible pulsed bridge can legitimately produce only two strong events
  // in an eight-frame window. Treat a regular 3–4-frame interval as enough
  // support; two adjacent coincidences (the Mock failure mode) do not qualify.
  let two_event_pulse_support = select(
    0.0,
    0.75,
    active_count == 2u &&
    cadence_hits == 1u &&
    last_active_gap >= 3u &&
    last_active_gap <= 4u);
  // A longer history can contain quiet frames between visible portions of a
  // real signal. Three structural events with two valid cadence links are
  // enough evidence to keep that pulsing bridge from being diluted by the
  // widened window, while isolated or merely adjacent Mock coincidences do
  // not satisfy this path.
  let repeated_bridge_support = select(
    0.0,
    0.75,
    active_count >= 3u && cadence_hits >= 2u);
  let pulse_support = max(
    three_event_pulse_support,
    max(two_event_pulse_support, repeated_bridge_support));
  // This is intentionally not a raw “every frame must be active” measure.
  // It recognizes a repeated pulsed bridge while requiring at least three
  // nearby events before pulse support can reach 1.0.
  let persistence = max(raw_persistence, pulse_support);
  let bridge_mean = bridge_sum / f32(max(1u, frame_count));
  let u_dip_mean = u_dip_sum / f32(max(1u, frame_count));
  let sinc_penalty_mean = sinc_penalty_sum /
    f32(max(1u, frame_count));
  let u_dip_event_mean = u_dip_active_sum /
    f32(max(1u, u_dip_active_count));
  // A broad U-like envelope alone is common in Mock/hardware responses. Keep
  // U-dip as a secondary feature of the N-APT structure: it must co-occur with
  // recurring bridge evidence somewhere in the temporal window. This lets a
  // real signal retain its U score while preventing a bridge-less Mock from
  // turning a smooth or aliased floor into a high U-dip diagnostic.
  let bridge_event_support = persistence;
  // A wide U-dip can be visible only during part of the temporal window: the
  // bridge peaks and FFT/VFO movement can temporarily hide the valley. A
  // full-window mean therefore reports a false low score. Retain a repeated
  // local U peak, while discounting a one-frame coincidence so an isolated
  // broad artifact cannot dominate the classifier diagnostics.
  let u_dip_temporal_score = max(
    u_dip_mean * bridge_event_support,
    select(
      u_dip_peak * 0.65 * bridge_event_support,
      max(u_dip_peak, u_dip_event_mean) * bridge_event_support,
      u_dip_active_count >= 2u));
  let mean_confidence = confidence_sum / f32(max(1u, frame_count));
  let ready = frame_count >= 4u;
  // Convert persistent shape evidence into a confidence independent of the
  // one-frame detector's clump-count gate. A stable partial bridge around
  // 0.47 is meaningful even when its baseline decision is still false; a
  // randomly alternating bridge will be reduced by persistence below.
  let bridge_shape_confidence = clamp(
    (bridge_mean - 0.25) / 0.30,
    0.0,
    1.0);
  let event_bridge_mean = active_bridge_sum / f32(max(1u, active_count));
  let event_shape_confidence = clamp(
    (event_bridge_mean - 0.25) / 0.30,
    0.0,
    1.0);
  let u_dip_shape_confidence = clamp(
    (u_dip_temporal_score - 0.35) / 0.45,
    0.0,
    1.0);
  let persistent_shape_confidence = max(
    max(bridge_shape_confidence, event_shape_confidence),
    u_dip_shape_confidence);
  let low_rise_event_age = frame_count - 1u - last_low_rise_index;
  // Keep a newly observed partial bridge visible while the VFO settles. This
  // is deliberately a short hold, and it only applies to one low-rise event;
  // repeated events still use the normal cadence/persistence decision path.
  let low_rise_hold = low_rise_event_count == 1u &&
    low_rise_event_score >= 0.48 &&
    low_rise_event_age <= MAX_BRIDGE_EVENT_GAP;
  let temporal_confidence = clamp(
    max(
      max(mean_confidence, persistent_shape_confidence),
      select(0.0, 0.78, low_rise_hold)) *
      (0.35 + 0.65 * persistence) -
      0.60 * sinc_penalty_mean,
    0.0,
    1.0);
  let held_temporal_confidence = select(
    temporal_confidence,
    0.78,
    low_rise_hold);
  // Do not let a U-dip, floor, or baseline confidence drift into Likely by
  // itself. The temporal pass needs repeated validated bridge geometry before
  // it can raise the decision above the negative band.
  let temporal_shape_supported = low_rise_hold ||
    (active_count >= 2u &&
      persistence >= 0.60 &&
      bridge_mean >= 0.30 &&
      (raw_persistence >= 0.60 || cadence_hits >= 1u));
  let shape_guarded_confidence = select(
    min(temporal_confidence, 0.49),
    temporal_confidence,
    temporal_shape_supported);
  let temporal_decision_confidence = select(
    shape_guarded_confidence,
    0.78,
    low_rise_hold);
  let baseline_is_napt = select(0u, 1u, baseline.is_napt != 0u);
  // Once the window is ready, use the persisted structural evidence rather
  // than requiring the newest frame to contain the entire feature. That is
  // important when tuning or hardware filtering reveals only part of the
  // suspension_bridge in an individual FFT frame.
  let temporal_is_napt = select(
    baseline_is_napt,
    select(0u, 1u,
          (low_rise_hold ||
            (temporal_shape_supported &&
              ((raw_persistence >= 0.60 && bridge_mean >= 0.40) ||
                pulse_support >= 0.75) &&
              sinc_penalty_mean < 0.45 &&
              temporal_decision_confidence >= 0.60))),
    ready);

  decision.baseline_is_napt = baseline_is_napt;
  decision.temporal_is_napt = temporal_is_napt;
  decision.baseline_confidence = baseline.confidence;
  decision.temporal_confidence = select(
    baseline.confidence,
        temporal_decision_confidence,
    ready);
  decision.persistence = persistence;
  // Expose normalized higher-order feature scores to the UI. A literal mean
  // would make a persistent partial bridge look weak simply because the
  // visible clump is narrower than the full capture. The raw mean remains in
  // the local variables for persistence and decision math; the readback
  // values represent accumulated structural evidence on the same 0..1 scale
  // as the one-frame metrics.
  // Do not let a single accidental event overwrite the temporal diagnostic.
  // The raw mean preserves the measured history, while the shape confidence
  // is only trusted in proportion to event persistence. A real bridge that
  // coheres across frames remains high; a one-frame Mock coincidence cannot
  // flash a 100% bridge score before the history has validated it.
  decision.bridge_mean = max(
    bridge_mean,
    max(bridge_shape_confidence, event_shape_confidence) * persistence);
  decision.u_dip_mean = max(
    u_dip_temporal_score,
    u_dip_shape_confidence);
  decision.frame_count = frame_count;
}
