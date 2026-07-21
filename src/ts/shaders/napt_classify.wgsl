// GPU-side N-APT feature extraction.
//
// The input waveform is a displayed FFT trace in dBm-like units. All shape
// features use bin positions normalized to [0, 1]; absolute RF frequency is
// used only for the weak bandwidth prior written during finalize(). This is
// important because tuning moves the same signal through the capture window.
struct SpikeMarker {
  index: u32,
  value: f32,
  score: f32,
  radius: f32,
}

struct Params {
  length: u32,
  source_length: u32,
  frequency_min: f32,
  frequency_max: f32,
}

struct SpikeMetric {
  frequency_hz: f32,
  power_dbm: f32,
  index: u32,
  padding: u32,
}

const MAX_SPIKES: u32 = 1024u;

// The first ten members are atomic accumulators used by classify(). The
// remaining members are finalized scalar outputs. The host reads the scalar
// fields at byte offsets 40 through 128, so changing this layout requires a
  // matching update in useDrawWebGPUFFTSignal.ts, the harness, and readback tests.
struct ClassifierResult {
  floor_sum_fixed: atomic<i32>,
  floor_count: atomic<u32>,
  above_floor_count: atomic<u32>,
  periodic_hits: atomic<u32>,
  bridge_sum_fixed: atomic<i32>,
  bridge_width_sum_fixed: atomic<i32>,
  bridge_shoulder_sum_fixed: atomic<i32>,
  u_dip_sum_fixed: atomic<i32>,
  floor_power_sum_fixed: atomic<i32>,
  bridge_clump_count: atomic<u32>,
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
  // Diagnostic: which U-dip estimator produced the winning score.
  // 0=none, 1=wide_fixed_thirds, 2=sliding_local_u, 3=waveform_quadratic,
  // 4=visible_window, 5=spike_quadratic. Fits in the existing 112-byte
  // buffer (offset 108) without a size change.
  u_dip_source: u32,
  unimodal_bridge_score: f32,
  partial_bridge_score: f32,
  apex_prominence_score: f32,
  shoulder_symmetry_score: f32,
  // [128] Quality is the inverse of the independently measured hardware-artifact
  // penalty. It is diagnostic and decision-gating data, not N-APT evidence.
  capture_quality_score: f32,
}

@group(0) @binding(0) var<storage, read> waveform: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> spikes: array<SpikeMarker>;
@group(0) @binding(3) var<storage, read_write> result: ClassifierResult;
@group(0) @binding(4) var<storage, read_write> spike_count: atomic<u32>;
@group(0) @binding(5) var<storage, read_write> spike_metrics: array<SpikeMetric>;

// A bridge is measured over 3.125% of the capture span. This is intentionally
// span-relative rather than a fixed number of FFT bins so it survives tuning
// and FFT-size changes. The 3 dB threshold suppresses small noise wiggles.
const BRIDGE_RADIUS_FRACTION: f32 = 0.03125;
const BRIDGE_ELEVATION_DB: f32 = 3.0;
const MIN_WIDE_U_CORRELATION: f32 = 0.55;
// A suspension_bridge hat should taper away from its apex. An isolated spur
// has the same low value on every neighboring sample, so its near/far drop is
// flat. This small dB scale makes the profile check tolerant of shallow hats
// while still rejecting a single spike on a flat floor.
const HAT_PROFILE_FULL_DB: f32 = 2.0;
const HAT_ORDER_TOLERANCE_DB: f32 = 0.25;
// A valid bridge is supported by several ordered hat candidates. The pair
// score receives only a conservative lift because a clipped/panned capture
// can show only part of each shoulder. A fractional exponent such as 0.20
// would turn a barely acceptable 0.55 pair score into about 0.88 and let an
// unrelated Mock comb masquerade as a bridge. The minimum pair score and clump
// count remain the anti-comb guards.
const MIN_VALIDATED_HAT_PAIR_SCORE: f32 = 0.52;
const MIN_VALIDATED_HAT_COUNT: u32 = 2u;
const BRIDGE_ORDER_LIFT_EXPONENT: f32 = 0.75;
// Unimodal geometry is the primary bridge model: one apex with an ordered
// shoulder on each side. Small bucket violations are tolerated because lower
// spikes can move in and out of a tuned FFT window.
const UNIMODAL_ORDER_TOLERANCE_DB: f32 = 0.75;
const PARTIAL_BRANCH_FULL_SCORE: f32 = 0.85;
// A low-rise bridge must occupy a meaningful normalized span. This is just
// above the random-comb fixture's accidental width, while remaining below
// the measured low-rise capture width (~0.49).
const MIN_LOW_RISE_BRIDGE_WIDTH: f32 = 0.48;
// Envelope diagnostics describe local structure, not a globally visible
// curve. Sampled slopes are normalized by capture-span distance, then
// classified as flat or directional. A small flat tolerance prevents normal
// pulse-to-pulse variation from becoming artificial residual error.
const ENVELOPE_FLAT_SLOPE_DB: f32 = 8.0;
const ENVELOPE_MIN_SUPPORT: u32 = 8u;
const ENVELOPE_SAMPLE_COUNT: u32 = 12u;
const SINC_SAMPLE_COUNT: u32 = 12u;
const EDGE_SINC_PENALTY_GAIN: f32 = 2.0;
// The structural contradiction penalty is only meaningful when both broad
// shape features are genuinely strong. Without these guards, a tall-spike
// capture can contribute a little U-like curvature in one frame and be
// mistaken for an irregular sinc response.
const IRREGULAR_SINC_MIN_BRIDGE_SCORE: f32 = 0.80;
const IRREGULAR_SINC_MIN_U_DIP_SCORE: f32 = 0.60;

// A separate edge-rolloff detector covers the irregular HackRF response seen
// in distorted captures. It is intentionally based on normalized capture
// coordinates: this is an artifact shape, not an absolute-frequency rule.
fn edge_sinc_penalty() -> f32 {
  if (params.length < 64u) { return 0.0; }

  var left_sum = 0.0;
  var right_sum = 0.0;
  var center_sum = 0.0;
  for (var sample = 0u; sample < 8u; sample = sample + 1u) {
    let t = f32(sample) / 7.0;
    let left_index = u32((0.02 + t * 0.16) * f32(params.length - 1u));
    let right_index = u32((0.82 + t * 0.16) * f32(params.length - 1u));
    let center_index = u32((0.42 + t * 0.16) * f32(params.length - 1u));
    left_sum = left_sum + waveform[left_index];
    right_sum = right_sum + waveform[right_index];
    center_sum = center_sum + waveform[center_index];
  }
  let left_mean = left_sum / 8.0;
  let right_mean = right_sum / 8.0;
  let center_mean = center_sum / 8.0;
  let edge_lift = min(left_mean - center_mean, right_mean - center_mean);
  // The distorted capture's edge lobes are only a few dB above its center on
  // an individual frame, so this threshold must remain sensitive to a weak
  // irregular response. The rolloff and bilateral tests below keep ordinary
  // high-spike and low-rise frames from becoming artifacts on edge lift alone.
  let edge_dominance = clamp((edge_lift - 3.5) / 7.0, 0.0, 1.0);
  let edge_symmetry = clamp(
    1.0 - abs(left_mean - right_mean) / 12.0,
    0.0,
    1.0);

  var left_rolloff = 0u;
  var right_rolloff = 0u;
  for (var step = 0u; step < 7u; step = step + 1u) {
    let t0 = f32(step) / 7.0;
    let t1 = f32(step + 1u) / 7.0;
    let left0 = waveform[u32((0.06 + t0 * 0.34) * f32(params.length - 1u))];
    let left1 = waveform[u32((0.06 + t1 * 0.34) * f32(params.length - 1u))];
    let right0 = waveform[u32((0.60 + t0 * 0.34) * f32(params.length - 1u))];
    let right1 = waveform[u32((0.60 + t1 * 0.34) * f32(params.length - 1u))];
    if (left0 >= left1 - 1.5) { left_rolloff = left_rolloff + 1u; }
    if (right1 >= right0 - 1.5) { right_rolloff = right_rolloff + 1u; }
  }
  let rolloff_score = min(
    f32(left_rolloff) / 7.0,
    f32(right_rolloff) / 7.0);
  return edge_dominance * edge_symmetry * rolloff_score;
}

fn sinc_penalty_score() -> f32 {
  if (params.length < 32u) { return 0.0; }

  // A hardware sinc artifact presents as one dominant centered lobe with
  // mirrored, decaying sidelobes. Find the dominant bin first, then sample
  // paired positions on both sides using normalized offsets. This is a
  // penalty feature only; it does not claim that every symmetric signal is a
  // sinc, and it deliberately requires visible sidelobe support.
  var peak_index = 0u;
  var peak_value = waveform[0];
  for (var index = 1u; index < params.length; index = index + 1u) {
    if (waveform[index] > peak_value) {
      peak_value = waveform[index];
      peak_index = index;
    }
  }

  let available_radius = min(
    peak_index,
    params.length - 1u - peak_index);
  if (available_radius < params.length / 6u) {
    return edge_sinc_penalty();
  }

  var symmetry_error = 0.0;
  var side_sum = 0.0;
  var side_support = 0u;
  var decay_violations = 0u;
  var secondary_peak = -120.0;
  for (var candidate = 0u; candidate < params.length; candidate = candidate + 1u) {
    if (abs(i32(candidate) - i32(peak_index)) > i32(max(1u, available_radius / 8u))) {
      secondary_peak = max(secondary_peak, waveform[candidate]);
    }
  }
  var previous_pair = peak_value;
  for (var sample = 1u; sample <= SINC_SAMPLE_COUNT; sample = sample + 1u) {
    // Half-step sampling avoids landing on every zero of an idealized sinc.
    let offset = max(
      1u,
      available_radius * (2u * sample - 1u) /
        (2u * SINC_SAMPLE_COUNT));
    let left = waveform[peak_index - offset];
    let right = waveform[peak_index + offset];
    let pair = (left + right) * 0.5;
    symmetry_error = symmetry_error + abs(left - right);
    side_sum = side_sum + pair;
    if (pair > result.floor_dbm + 2.0) {
      side_support = side_support + 1u;
    }
    if (pair > previous_pair + 2.0) {
      decay_violations = decay_violations + 1u;
    }
    previous_pair = pair;
  }

  let side_mean = side_sum / f32(SINC_SAMPLE_COUNT);
  let center_dominance = clamp(
    (peak_value - side_mean - 8.0) / 20.0,
    0.0,
    1.0);
  let symmetry_score = clamp(
    1.0 - symmetry_error / f32(SINC_SAMPLE_COUNT * 12u),
    0.0,
    1.0);
  let decay_score = 1.0 - f32(decay_violations) /
    f32(SINC_SAMPLE_COUNT);
  let side_support_score = clamp(
    f32(side_support) / 4.0,
    0.0,
    1.0);
  let centered_score = clamp(
    f32(available_radius) / f32(max(1u, params.length / 4u)),
    0.0,
    1.0);
  // N-APT can contain many tall, unrelated spikes. A sinc response instead
  // has one clearly dominant lobe; reduce the penalty when a second peak is
  // nearly as strong as the selected peak.
  let peak_isolation_score = clamp(
    (peak_value - secondary_peak - 3.0) / 12.0,
    0.0,
    1.0);
  let isolated_lobe_score = peak_isolation_score * peak_isolation_score;
  let centered_lobe_penalty = center_dominance * symmetry_score * decay_score *
    side_support_score * centered_score * isolated_lobe_score;
  // A weak edge response is distributed across several bins and is easy to
  // understate on any one frame. Apply a bounded gain to the edge branch; the
  // bilateral rolloff gate still keeps this from becoming an edge-spike rule.
  return clamp(
    max(centered_lobe_penalty, EDGE_SINC_PENALTY_GAIN * edge_sinc_penalty()),
    0.0,
    1.0);
}

fn waveform_envelope_at(normalized_position: f32) -> f32 {
  let position = clamp(normalized_position, 0.0, 1.0);
  let index = u32(position * f32(max(1u, params.length - 1u)));
  // Use a robust local upper envelope rather than the single highest bin. A
  // Mock comb can place one tall point in every neighborhood; taking max()
  // makes those unrelated points look like a smooth U. Averaging only raised
  // local maxima preserves the repeated N-APT pulse envelope while reducing
  // the influence of isolated spikes.
  return robust_envelope_at(index);
}

fn waveform_or(index: i32, length: u32, fallback: f32) -> f32 {
  if (index < 0 || index >= i32(length)) { return fallback; }
  return waveform[u32(index)];
}

fn envelope_min(index: u32) -> f32 {
  // A one-bin lower envelope estimate used to keep narrow peaks from
  // dominating local floor and valley measurements.
  let value = waveform[index];
  return min(value,
    min(waveform_or(i32(index) - 1, params.length, value),
        waveform_or(i32(index) + 1, params.length, value)));
}

fn envelope_peak(index: u32) -> f32 {
  // The visible N-APT U-shape is carried by the tops of repeated spikes, not
  // by the noise floor. Aggregate a short neighborhood to estimate that
  // upper envelope while remaining insensitive to individual peak placement.
  var peak = waveform[index];
  let radius = max(8u, params.length / 512u);
  let start = select(0u, index - radius, index > radius);
  let end = min(params.length - 1u, index + radius);
  for (var j = start; j <= end; j = j + 1u) {
    peak = max(peak, waveform[j]);
  }
  return peak;
}

fn robust_envelope_at(index: u32) -> f32 {
  let radius = max(8u, params.length / 512u);
  let start = select(0u, index - radius, index > radius);
  let end = min(params.length - 1u, index + radius);
  var raised_peak_sum = 0.0;
  var raised_peak_count = 0u;
  var sample_sum = 0.0;
  var sample_count = 0u;
  for (var j = start; j <= end; j = j + 1u) {
    let sample = waveform[j];
    let left = waveform_or(i32(j) - 1, params.length, sample);
    let right = waveform_or(i32(j) + 1, params.length, sample);
    sample_sum = sample_sum + sample;
    sample_count = sample_count + 1u;
    if (sample >= min(left, right) + 1.0 &&
        sample >= left && sample >= right) {
      raised_peak_sum = raised_peak_sum + sample;
      raised_peak_count = raised_peak_count + 1u;
    }
  }
  return select(
    sample_sum / f32(max(1u, sample_count)),
    raised_peak_sum / f32(raised_peak_count),
    raised_peak_count >= 2u);
}

@compute @workgroup_size(64)
fn classify(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let i = global_id.x;
  if (i >= params.length) { return; }
  let value = waveform[i];
  if (value != value) { return; }

  // Local minima are less affected by narrow spikes than a raw mean. The
  // fixed-point atomics avoid races while many workgroups scan the waveform.
  let left = waveform_or(i32(i) - 1, params.length, value);
  let right = waveform_or(i32(i) + 1, params.length, value);
  if (value <= left && value <= right) {
    atomicAdd(&result.floor_sum_fixed, i32(value * 1024.0));
    atomicAdd(&result.floor_count, 1u);
  }
  let local_floor = min(left, right);
  if (value >= local_floor + 3.0) { atomicAdd(&result.above_floor_count, 1u); }

  if (i > 1u && i + 1u < params.length &&
      value > left && value >= right) {
    atomicAdd(&result.periodic_hits, 1u);
  }

  // All structure measurements use normalized position and a span-relative
  // window, so tuning the signal does not change the classifier geometry.
  let normalized_position = f32(i) / f32(max(1u, params.length - 1u));
  let radius = max(4u, u32(f32(params.length) * BRIDGE_RADIUS_FRACTION));
  let start = select(0u, i - radius, i > radius);
  let end = min(params.length - 1u, i + radius);
  var elevated_count = 0u;
  var left_shoulder_count = 0u;
  var right_shoulder_count = 0u;
  var center_sum = 0.0;
  var center_count = 0u;
  var center_floor_sum = 0.0;
  var center_floor_count = 0u;
  var shoulder_sum = 0.0;
  var shoulder_count = 0u;
  for (var j = start; j <= end; j = j + 1u) {
    let sample = waveform[j];
    let sample_left = waveform_or(i32(j) - 1, params.length, sample);
    let sample_right = waveform_or(i32(j) + 1, params.length, sample);
    let local_floor = min(sample_left, sample_right);
    let elevated = sample >= local_floor + BRIDGE_ELEVATION_DB;
    let prev = waveform_or(i32(j) - 1, params.length, sample);
    let prev_prev = waveform_or(i32(j) - 2, params.length, prev);
    let next = waveform_or(i32(j) + 1, params.length, sample);
    let next_next = waveform_or(i32(j) + 2, params.length, next);
    let connected_left = prev >= min(prev_prev, sample) + BRIDGE_ELEVATION_DB;
    let connected_right = next >= min(sample, next_next) + BRIDGE_ELEVATION_DB;
    // A one-bin spur is not bridge energy. Require an adjacent elevated bin
    // before allowing this sample to contribute to the suspension bridge.
    // This is the key distinction between a connected suspension bridge and
    // an isolated hardware/DC spur.
    if (elevated && (connected_left || connected_right)) {
      elevated_count = elevated_count + 1u;
      if (j < i) { left_shoulder_count = left_shoulder_count + 1u; }
      if (j > i) { right_shoulder_count = right_shoulder_count + 1u; }
    }
    if (abs(i32(j) - i32(i)) <= i32(max(1u, radius / 3u))) {
      center_sum = center_sum + sample;
      center_count = center_count + 1u;
      if (sample <= sample_left && sample <= sample_right) {
        center_floor_sum = center_floor_sum + sample;
        center_floor_count = center_floor_count + 1u;
      }
    } else {
      shoulder_sum = shoulder_sum + sample;
      shoulder_count = shoulder_count + 1u;
    }
  }
  let window_count = max(1u, end - start + 1u);
  let bridge_width = f32(elevated_count) / f32(window_count);
  let bridge_shoulder = min(
    f32(left_shoulder_count) / f32(max(1u, radius)),
    f32(right_shoulder_count) / f32(max(1u, radius)),
  );
  // Use the local center floor rather than the mean: the N-APT pulse comb can
  // be active inside the valley and must not hide the broad U-shaped dip.
  let center_mean = select(
    center_sum / f32(max(1u, center_count)),
    center_floor_sum / f32(center_floor_count),
    center_floor_count > 0u);
  let shoulder_mean = shoulder_sum / f32(max(1u, shoulder_count));
  let u_dip = clamp((shoulder_mean - center_mean) / 8.0, 0.0, 1.0);
  // Normalize bridge occupancy against the minimum meaningful bridge width.
  // Values below 0.05 are treated as disconnected; values near 0.25 fill the
  // score range. The shoulder term requires support on both sides of a clump.
  // This keeps a connected, broad clump strong even when narrow FFT valleys
  // break the bridge into several elevated runs.
  let bridge_width_score = clamp((bridge_width - 0.05) / 0.20, 0.0, 1.0);
  let bridge_shoulder_score = clamp((bridge_shoulder - 0.10) / 0.30, 0.0, 1.0);
  let suspension_bridge = select(0.0,
    bridge_width_score * 0.55 + bridge_shoulder_score * 0.45,
    bridge_width >= 0.05 && bridge_shoulder >= 0.10);
  if (suspension_bridge > 0.0) {
    atomicAdd(&result.bridge_sum_fixed, i32(suspension_bridge * 1024.0));
    atomicAdd(&result.bridge_width_sum_fixed, i32(bridge_width_score * 1024.0));
    atomicAdd(&result.bridge_shoulder_sum_fixed, i32(bridge_shoulder_score * 1024.0));
    atomicAdd(&result.u_dip_sum_fixed, i32(u_dip * 1024.0));
    atomicAdd(&result.bridge_clump_count, 1u);
  }
  // Keep these expressions explicit in the GPU contract for diagnostics.
  if (normalized_position >= 0.0 && normalized_position <= 1.0 && value >= local_floor + BRIDGE_ELEVATION_DB) {
    atomicAdd(&result.floor_power_sum_fixed, i32(clamp(value - local_floor, 0.0, 32.0) * 32.0));
  }
}

@compute @workgroup_size(1)
fn finalize() {
  // finalize() runs as a separate one-thread dispatch after classify() has
  // completed. It converts atomic accumulators to stable scalar metrics and
  // emits GPU-generated frequency/power records for the UI.
  let count = atomicLoad(&result.floor_count);
  let floor = select(-120.0, f32(atomicLoad(&result.floor_sum_fixed)) / 1024.0 / f32(count), count > 0u);
  result.floor_dbm = floor;
  result.above_floor_fraction = f32(atomicLoad(&result.above_floor_count)) / f32(max(1u, params.length));
  result.periodicity = f32(atomicLoad(&result.periodic_hits)) / f32(max(1u, params.length));
  result.spike_count = atomicLoad(&spike_count);
  let bridge_count = max(1u, atomicLoad(&result.bridge_clump_count));
  result.suspension_bridge_score = clamp(
    f32(atomicLoad(&result.bridge_sum_fixed)) / 1024.0 / f32(bridge_count), 0.0, 1.0);
  // The per-bin accumulator is retained for compatibility, but it is not a
  // clump count. A clump is a validated rise/apex/fall hat in marker space.
  // Replace the old per-bin value after hat analysis below.
  result.bridge_width_score = clamp(
    f32(atomicLoad(&result.bridge_width_sum_fixed)) / 1024.0 / f32(bridge_count), 0.0, 1.0);
  result.bridge_shoulder_score = clamp(
    f32(atomicLoad(&result.bridge_shoulder_sum_fixed)) / 1024.0 / f32(bridge_count), 0.0, 1.0);
  result.u_dip_score = clamp(
    f32(atomicLoad(&result.u_dip_sum_fixed)) / 1024.0 / f32(bridge_count), 0.0, 1.0);
  // Validate the U shape globally. Local minima around random comb spikes can
  // look like a dip, so compare envelope levels in the outer thirds against
  // the center third in normalized capture coordinates.
  var edge_sum = 0.0;
  var center_sum = 0.0;
  var curve_asymmetry = 0.0;
  var broad_u_pair_count = 0u;
  var broad_u_left_count = 0u;
  var broad_u_right_count = 0u;
  var left_descending_steps = 0u;
  var right_ascending_steps = 0u;
  var previous_left_peak = 0.0;
  var previous_right_peak = 0.0;
  for (var sample_index = 0u; sample_index < 16u; sample_index = sample_index + 1u) {
    let edge_left = u32(f32(params.length - 1u) * (0.08 + f32(sample_index) * 0.015));
    let edge_right = u32(f32(params.length - 1u) * (0.68 + f32(sample_index) * 0.015));
    let center = u32(f32(params.length - 1u) * (0.42 + f32(sample_index) * 0.01));
    let left_peak = robust_envelope_at(edge_left);
    let right_peak = robust_envelope_at(edge_right);
    let center_peak = robust_envelope_at(center);
    if (sample_index > 0u) {
      // Moving left-to-right, the left shoulder should generally descend into
      // the valley while the right shoulder rises out of it. A tolerance keeps
      // pulse-height variation from breaking an otherwise broad trend.
      if (left_peak <= previous_left_peak + 0.75) {
        left_descending_steps = left_descending_steps + 1u;
      }
      if (right_peak >= previous_right_peak - 0.75) {
        right_ascending_steps = right_ascending_steps + 1u;
      }
    }
    previous_left_peak = left_peak;
    previous_right_peak = right_peak;
    edge_sum = edge_sum + (left_peak + right_peak) * 0.5;
    curve_asymmetry = curve_asymmetry + abs(left_peak - right_peak);
    center_sum = center_sum + center_peak;
    // A global U must be present over a broad fraction of both shoulders.
    // Local bridge hats may be very tall, but only affect one or two samples;
    // they therefore cannot satisfy this bilateral coverage requirement.
    if (left_peak >= center_peak + 0.35) {
      broad_u_left_count = broad_u_left_count + 1u;
    }
    if (right_peak >= center_peak + 0.35) {
      broad_u_right_count = broad_u_right_count + 1u;
    }
    if (left_peak >= center_peak + 0.35 &&
        right_peak >= center_peak + 0.35) {
      broad_u_pair_count = broad_u_pair_count + 1u;
    }
  }
  // 3 dB is the useful transition scale for the observed bridge envelope;
  // this keeps a clearly separated real capture above the 80% confidence band
  // without making shallow comb curvature look like N-APT.
  let depth_score = clamp((edge_sum / 16.0 - center_sum / 16.0) / 3.0, 0.0, 1.0);
  let curve_score = clamp(1.0 - (curve_asymmetry / 16.0) / 6.0, 0.0, 1.0);
  let broad_u_coverage = f32(broad_u_pair_count) / 16.0;
  // Score each shoulder independently, then take the weaker side. This allows
  // pulse/tuning asymmetry without accepting a one-sided ramp or local hat.
  let bilateral_shoulder_coverage = min(
    f32(broad_u_left_count) / 16.0,
    f32(broad_u_right_count) / 16.0);
  let broad_u_coverage_score = clamp(
    (max(broad_u_coverage, bilateral_shoulder_coverage) - 0.35) / 0.45,
    0.0,
    1.0);
  // Re-sample the center third and require the valley to remain below the
  // average outer shoulder. This rejects a low point between two local hats.
  var center_valley_count = 0u;
  let outer_shoulder_mean = edge_sum / 16.0;
  for (var valley_index = 0u; valley_index < 16u; valley_index = valley_index + 1u) {
    let valley_sample = u32(
      f32(params.length - 1u) * (0.34 + f32(valley_index) * 0.021));
    if (robust_envelope_at(valley_sample) <= outer_shoulder_mean - 0.35) {
      center_valley_count = center_valley_count + 1u;
    }
  }
  let sustained_center_valley = clamp(
    (f32(center_valley_count) / 16.0 - 0.40) / 0.45,
    0.0,
    1.0);
  let wide_u_trend_score = clamp(
    (min(f32(left_descending_steps), f32(right_ascending_steps)) / 15.0 -
      0.55) / 0.35,
    0.0,
    1.0);
  // Pulse phase can make the two shoulders unequal in a single frame, so
  // symmetry is only a weak pattern check rather than a rejection feature.
  var local_u_peak = 0.0;
  var local_u_sum = 0.0;
  var local_u_support = 0u;
  // Search multiple normalized centers so tuning movement does not require
  // the U-envelope to remain aligned with the capture boundaries.
  for (var candidate = 0u; candidate < 8u; candidate = candidate + 1u) {
    let center_position = 0.20 + f32(candidate) * 0.085;
    let left_position = center_position - 0.16;
    let right_position = center_position + 0.16;
    let left_index = u32(f32(params.length - 1u) * left_position);
    let right_index = u32(f32(params.length - 1u) * right_position);
    let center_index = u32(f32(params.length - 1u) * center_position);
    let local_depth = clamp(
      ((robust_envelope_at(left_index) + robust_envelope_at(right_index)) * 0.5 - robust_envelope_at(center_index)) / 3.0,
      0.0, 1.0);
    local_u_peak = max(local_u_peak, local_depth);
    if (local_depth >= 0.50) {
      local_u_sum = local_u_sum + local_depth;
      local_u_support = local_u_support + 1u;
    }
  }
  let supported_local_u = select(
    0.0,
    local_u_sum / f32(local_u_support),
    local_u_support >= 3u);
  // The fixed thirds estimate is only trusted when the sliding search also
  // finds at least three neighboring U-shaped windows. This prevents random
  // comb peaks from winning through one lucky edge/center comparison.
  // A wide U is a single global structure and need not contain three smaller
  // local U windows. Coverage and sustained depth are its independent guards.
  // Normalize broad depth to the shallow curves actually observed in a tuned
  // live capture. Trend and sustained-valley guards—not raw dBm magnitude—do
  // the discrimination from isolated hats and flat/DC spectra.
  let normalized_wide_depth = clamp(
    (edge_sum / 16.0 - center_sum / 16.0) / 1.25,
    0.0,
    1.0);
  let wide_u_dip_score =
    (normalized_wide_depth * 0.95 + curve_score * 0.05) *
    wide_u_trend_score * sustained_center_valley;
  // Track which estimator produced the winning U-dip score.
  var u_dip_source = 0u;
  var global_u_dip = select(
    0.0,
    max(
      wide_u_dip_score,
      supported_local_u * 0.35 * broad_u_coverage_score *
        sustained_center_valley),
    wide_u_trend_score > 0.0 && sustained_center_valley > 0.0);
  if (global_u_dip > 0.0) {
    u_dip_source = select(2u, 1u, wide_u_dip_score >= supported_local_u * 0.35 * broad_u_coverage_score * sustained_center_valley);
  }
  // Treat detected spike tops as a scatter plot. For several possible curve
  // centers, measure the Pearson correlation between spike power and squared
  // distance from that center. A coherent U-envelope has positive correlation;
  // random Mock spikes and isolated spurs do not. This avoids penalizing the
  // legitimate valleys between spikes as residual errors.
  let fit_spike_count = min(result.spike_count, MAX_SPIKES);
  var hat_clump_sum = 0.0;
  var hat_clump_count = 0u;
  var hat_pair_score_sum = 0.0;
  var hat_envelope_score_sum = 0.0;
  var bilateral_hat_clump_sum = 0.0;
  var bilateral_hat_clump_count = 0u;
  var bilateral_hat_pair_score_sum = 0.0;
  var max_unimodal_bridge_score = 0.0;
  var max_partial_bridge_score = 0.0;
  var max_apex_prominence_score = 0.0;
  var max_shoulder_symmetry_score = 0.0;
  var max_unimodal_violation_score = 0.0;
  // A sinc-shaped hardware response can contain an apparently ordered local
  // peak. Compute its penalty once per frame and apply it as a soft structure
  // gate, keeping the diagnostic visible without treating the artifact as a
  // real suspension bridge.
  let frame_sinc_penalty = clamp(sinc_penalty_score(), 0.0, 1.0);
  let sinc_structure_gate = select(
    1.0,
    clamp((0.72 - frame_sinc_penalty) / 0.10, 0.0, 1.0),
    frame_sinc_penalty > 0.68);
  // Detect the rise-apex-fall "hats" directly in spike-coordinate space.
  // Each accepted apex must be the strongest point in its local span and have
  // at least two lower supporting spikes on both sides.
  let hat_scan_count = min(fit_spike_count, 192u);
  for (var apex_index = 0u; apex_index < hat_scan_count; apex_index = apex_index + 1u) {
    let apex_x = f32(spikes[apex_index].index) /
      f32(max(1u, params.source_length - 1u));
    let apex_y = spikes[apex_index].value;
    var left_sum = 0.0;
    var right_sum = 0.0;
    var left_count = 0u;
    var right_count = 0u;
    var sum_distance = 0.0;
    var sum_drop = 0.0;
    var sum_distance_squared = 0.0;
    var sum_drop_squared = 0.0;
    var sum_distance_drop = 0.0;
    var left_span = 0.0;
    var right_span = 0.0;
    var left_distance_sum = 0.0;
    var left_drop_sum = 0.0;
    var left_distance_squared = 0.0;
    var left_drop_squared = 0.0;
    var left_distance_drop = 0.0;
    var right_distance_sum = 0.0;
    var right_drop_sum = 0.0;
    var right_distance_squared = 0.0;
    var right_drop_squared = 0.0;
    var right_distance_drop = 0.0;
    var left_near_drop_sum = 0.0;
    var left_near_drop_count = 0u;
    var left_far_drop_sum = 0.0;
    var left_far_drop_count = 0u;
    var right_near_drop_sum = 0.0;
    var right_near_drop_count = 0u;
    var right_far_drop_sum = 0.0;
    var right_far_drop_count = 0u;
    // Distance-bucketed ordering: 4 buckets per side (0..0.025, 0.025..0.05,
    // 0.05..0.075, 0.075..0.10). Populated during the neighbor scan below and
    // checked for monotonicity afterward. This replaces the previous O(n²)
    // pairwise ordering loop with an O(1) bucket walk.
    var left_bucket0_drop_sum = 0.0; var left_bucket0_count = 0u;
    var left_bucket1_drop_sum = 0.0; var left_bucket1_count = 0u;
    var left_bucket2_drop_sum = 0.0; var left_bucket2_count = 0u;
    var left_bucket3_drop_sum = 0.0; var left_bucket3_count = 0u;
    var right_bucket0_drop_sum = 0.0; var right_bucket0_count = 0u;
    var right_bucket1_drop_sum = 0.0; var right_bucket1_count = 0u;
    var right_bucket2_drop_sum = 0.0; var right_bucket2_count = 0u;
    var right_bucket3_drop_sum = 0.0; var right_bucket3_count = 0u;
    var is_local_apex = true;
    for (var neighbor_index = 0u; neighbor_index < hat_scan_count; neighbor_index = neighbor_index + 1u) {
      if (neighbor_index == apex_index) { continue; }
      let neighbor_x = f32(spikes[neighbor_index].index) /
        f32(max(1u, params.source_length - 1u));
      let distance = abs(neighbor_x - apex_x);
      if (distance > 0.0 && distance <= 0.10) {
        let neighbor_y = spikes[neighbor_index].value;
        if (neighbor_y > apex_y) { is_local_apex = false; }
        if (neighbor_y <= apex_y - 1.0) {
          let drop = apex_y - neighbor_y;
          sum_distance = sum_distance + distance;
          sum_drop = sum_drop + drop;
          sum_distance_squared = sum_distance_squared + distance * distance;
          sum_drop_squared = sum_drop_squared + drop * drop;
          sum_distance_drop = sum_distance_drop + distance * drop;
          if (neighbor_x < apex_x) {
            left_sum = left_sum + neighbor_y;
            left_count = left_count + 1u;
            left_span = max(left_span, distance);
            left_distance_sum = left_distance_sum + distance;
            left_drop_sum = left_drop_sum + drop;
            left_distance_squared = left_distance_squared + distance * distance;
            left_drop_squared = left_drop_squared + drop * drop;
            left_distance_drop = left_distance_drop + distance * drop;
            if (distance <= 0.025) {
              left_near_drop_sum = left_near_drop_sum + drop;
              left_near_drop_count = left_near_drop_count + 1u;
              left_bucket0_drop_sum = left_bucket0_drop_sum + drop;
              left_bucket0_count = left_bucket0_count + 1u;
            } else if (distance <= 0.05) {
              left_near_drop_sum = left_near_drop_sum + drop;
              left_near_drop_count = left_near_drop_count + 1u;
              left_bucket1_drop_sum = left_bucket1_drop_sum + drop;
              left_bucket1_count = left_bucket1_count + 1u;
            } else if (distance <= 0.075) {
              left_far_drop_sum = left_far_drop_sum + drop;
              left_far_drop_count = left_far_drop_count + 1u;
              left_bucket2_drop_sum = left_bucket2_drop_sum + drop;
              left_bucket2_count = left_bucket2_count + 1u;
            } else {
              left_far_drop_sum = left_far_drop_sum + drop;
              left_far_drop_count = left_far_drop_count + 1u;
              left_bucket3_drop_sum = left_bucket3_drop_sum + drop;
              left_bucket3_count = left_bucket3_count + 1u;
            }
          } else {
            right_sum = right_sum + neighbor_y;
            right_count = right_count + 1u;
            right_span = max(right_span, distance);
            right_distance_sum = right_distance_sum + distance;
            right_drop_sum = right_drop_sum + drop;
            right_distance_squared = right_distance_squared + distance * distance;
            right_drop_squared = right_drop_squared + drop * drop;
            right_distance_drop = right_distance_drop + distance * drop;
            if (distance <= 0.025) {
              right_near_drop_sum = right_near_drop_sum + drop;
              right_near_drop_count = right_near_drop_count + 1u;
              right_bucket0_drop_sum = right_bucket0_drop_sum + drop;
              right_bucket0_count = right_bucket0_count + 1u;
            } else if (distance <= 0.05) {
              right_near_drop_sum = right_near_drop_sum + drop;
              right_near_drop_count = right_near_drop_count + 1u;
              right_bucket1_drop_sum = right_bucket1_drop_sum + drop;
              right_bucket1_count = right_bucket1_count + 1u;
            } else if (distance <= 0.075) {
              right_far_drop_sum = right_far_drop_sum + drop;
              right_far_drop_count = right_far_drop_count + 1u;
              right_bucket2_drop_sum = right_bucket2_drop_sum + drop;
              right_bucket2_count = right_bucket2_count + 1u;
            } else {
              right_far_drop_sum = right_far_drop_sum + drop;
              right_far_drop_count = right_far_drop_count + 1u;
              right_bucket3_drop_sum = right_bucket3_drop_sum + drop;
              right_bucket3_count = right_bucket3_count + 1u;
            }
          }
        }
      }
    }
    // Validate shoulder ordering via distance-bucketed monotonicity.
    // A true hat has non-decreasing mean drop as distance from the apex
    // grows on both sides. Bucketed means avoid the O(n²) pairwise
    // comparison that the previous loop required. Each populated bucket
    // pair contributes one ordering comparison; a random comb will fail
    // because its bucket means are chaotic.
    var left_order_hits = 0u;
    var left_order_pairs = 0u;
    var right_order_hits = 0u;
    var right_order_pairs = 0u;
    if (is_local_apex) {
      // Left side: walk buckets 0→3 (near→far), check monotonicity.
      var left_prev_mean = 0.0;
      var left_has_prev = false;
      if (left_bucket0_count > 0u) {
        left_prev_mean = left_bucket0_drop_sum / f32(left_bucket0_count);
        left_has_prev = true;
      }
      if (left_bucket1_count > 0u) {
        let mean = left_bucket1_drop_sum / f32(left_bucket1_count);
        if (left_has_prev) {
          left_order_pairs = left_order_pairs + 1u;
          if (mean + HAT_ORDER_TOLERANCE_DB >= left_prev_mean) {
            left_order_hits = left_order_hits + 1u;
          }
        }
        left_prev_mean = mean; left_has_prev = true;
      }
      if (left_bucket2_count > 0u) {
        let mean = left_bucket2_drop_sum / f32(left_bucket2_count);
        if (left_has_prev) {
          left_order_pairs = left_order_pairs + 1u;
          if (mean + HAT_ORDER_TOLERANCE_DB >= left_prev_mean) {
            left_order_hits = left_order_hits + 1u;
          }
        }
        left_prev_mean = mean; left_has_prev = true;
      }
      if (left_bucket3_count > 0u) {
        let mean = left_bucket3_drop_sum / f32(left_bucket3_count);
        if (left_has_prev) {
          left_order_pairs = left_order_pairs + 1u;
          if (mean + HAT_ORDER_TOLERANCE_DB >= left_prev_mean) {
            left_order_hits = left_order_hits + 1u;
          }
        }
      }
      // Right side: same walk.
      var right_prev_mean = 0.0;
      var right_has_prev = false;
      if (right_bucket0_count > 0u) {
        right_prev_mean = right_bucket0_drop_sum / f32(right_bucket0_count);
        right_has_prev = true;
      }
      if (right_bucket1_count > 0u) {
        let mean = right_bucket1_drop_sum / f32(right_bucket1_count);
        if (right_has_prev) {
          right_order_pairs = right_order_pairs + 1u;
          if (mean + HAT_ORDER_TOLERANCE_DB >= right_prev_mean) {
            right_order_hits = right_order_hits + 1u;
          }
        }
        right_prev_mean = mean; right_has_prev = true;
      }
      if (right_bucket2_count > 0u) {
        let mean = right_bucket2_drop_sum / f32(right_bucket2_count);
        if (right_has_prev) {
          right_order_pairs = right_order_pairs + 1u;
          if (mean + HAT_ORDER_TOLERANCE_DB >= right_prev_mean) {
            right_order_hits = right_order_hits + 1u;
          }
        }
        right_prev_mean = mean; right_has_prev = true;
      }
      if (right_bucket3_count > 0u) {
        let mean = right_bucket3_drop_sum / f32(right_bucket3_count);
        if (right_has_prev) {
          right_order_pairs = right_order_pairs + 1u;
          if (mean + HAT_ORDER_TOLERANCE_DB >= right_prev_mean) {
            right_order_hits = right_order_hits + 1u;
          }
        }
      }
    }
    let is_left_edge_hat = apex_x <= 0.10 && right_count >= 3u;
    let is_right_edge_hat = apex_x >= 0.90 && left_count >= 3u;
    let has_bilateral_hat_support = left_count >= 2u && right_count >= 2u;
    if (is_local_apex &&
        (has_bilateral_hat_support || is_left_edge_hat || is_right_edge_hat)) {
      let edge_hat_support = select(
        right_count,
        left_count,
        is_right_edge_hat);
      let edge_hat_span = select(
        right_span,
        left_span,
        is_right_edge_hat);
      let shoulder_mean = select(
        (left_sum / f32(max(1u, left_count)) +
          right_sum / f32(max(1u, right_count))) * 0.5,
        select(
          right_sum / f32(max(1u, right_count)),
          left_sum / f32(max(1u, left_count)),
          is_right_edge_hat),
        is_left_edge_hat || is_right_edge_hat);
      let prominence = clamp((apex_y - shoulder_mean) / 12.0, 0.0, 1.0);
      let support = clamp(
        f32(select(min(left_count, right_count), edge_hat_support,
          is_left_edge_hat || is_right_edge_hat)) / 5.0,
        0.0, 1.0);
      let support_count = f32(left_count + right_count);
      let covariance = sum_distance_drop -
        (sum_distance * sum_drop) / support_count;
      let distance_variance = max(
        0.000001,
        sum_distance_squared - sum_distance * sum_distance / support_count);
      let drop_variance = max(
        0.000001,
        sum_drop_squared - sum_drop * sum_drop / support_count);
      let local_hat_correlation = clamp(
        covariance / sqrt(distance_variance * drop_variance),
        0.0,
        1.0);
      let left_n = max(2.0, f32(left_count));
      let left_covariance = left_distance_drop -
        left_distance_sum * left_drop_sum / left_n;
      let left_distance_variance = max(
        0.000001,
        left_distance_squared - left_distance_sum * left_distance_sum / left_n);
      let left_drop_variance = max(
        0.000001,
        left_drop_squared - left_drop_sum * left_drop_sum / left_n);
      let left_hat_correlation = clamp(
        left_covariance / sqrt(left_distance_variance * left_drop_variance),
        0.0,
        1.0);
      let right_n = max(2.0, f32(right_count));
      let right_covariance = right_distance_drop -
        right_distance_sum * right_drop_sum / right_n;
      let right_distance_variance = max(
        0.000001,
        right_distance_squared - right_distance_sum * right_distance_sum / right_n);
      let right_drop_variance = max(
        0.000001,
        right_drop_squared - right_drop_sum * right_drop_sum / right_n);
      let right_hat_correlation = clamp(
        right_covariance / sqrt(right_distance_variance * right_drop_variance),
        0.0,
        1.0);
      let bilateral_hat_correlation = select(
        min(left_hat_correlation, right_hat_correlation),
        select(right_hat_correlation, left_hat_correlation, is_right_edge_hat),
        is_left_edge_hat || is_right_edge_hat);
      let balanced_hat_support = select(
        f32(min(left_count, right_count)) /
          f32(max(1u, max(left_count, right_count))),
        1.0,
        is_left_edge_hat || is_right_edge_hat);
      let bilateral_span = clamp(
        select(min(left_span, right_span), edge_hat_span,
          is_left_edge_hat || is_right_edge_hat) / 0.035,
        0.0, 1.0);
      let left_near_drop = left_near_drop_sum /
        f32(max(1u, left_near_drop_count));
      let left_far_drop = left_far_drop_sum /
        f32(max(1u, left_far_drop_count));
      let right_near_drop = right_near_drop_sum /
        f32(max(1u, right_near_drop_count));
      let right_far_drop = right_far_drop_sum /
        f32(max(1u, right_far_drop_count));
      // spike_compute appends markers through an atomic counter, so marker
      // order is not frequency order. Compare distance buckets instead of
      // adjacent array entries; otherwise a valid hat scores as random when
      // workgroups finish in a different order.
      let left_distance_order_score = select(
        0.0,
        clamp(0.5 + (left_far_drop - left_near_drop) / 4.0, 0.0, 1.0),
        left_far_drop_count > 0u && left_near_drop_count > 0u);
      let right_distance_order_score = select(
        0.0,
        clamp(0.5 + (right_far_drop - right_near_drop) / 4.0, 0.0, 1.0),
        right_far_drop_count > 0u && right_near_drop_count > 0u);
      let distance_order_score = select(
        min(left_distance_order_score, right_distance_order_score),
        select(right_distance_order_score, left_distance_order_score, is_right_edge_hat),
        is_left_edge_hat || is_right_edge_hat);
      let left_profile_score = clamp(
        (left_far_drop - left_near_drop) / HAT_PROFILE_FULL_DB,
        0.0, 1.0);
      let right_profile_score = clamp(
        (right_far_drop - right_near_drop) / HAT_PROFILE_FULL_DB,
        0.0, 1.0);
      let left_pair_order_score = select(
        0.0,
        f32(left_order_hits) / f32(left_order_pairs),
        left_order_pairs > 0u);
      let right_pair_order_score = select(
        0.0,
        f32(right_order_hits) / f32(right_order_pairs),
        right_order_pairs > 0u);
      let pair_order_score = select(
        min(left_pair_order_score, right_pair_order_score),
        select(right_pair_order_score, left_pair_order_score, is_right_edge_hat),
        is_left_edge_hat || is_right_edge_hat);
      let bilateral_profile_score = select(
        min(left_profile_score, right_profile_score) * distance_order_score,
        select(
          right_profile_score * distance_order_score,
          left_profile_score * distance_order_score,
          is_right_edge_hat),
        is_left_edge_hat || is_right_edge_hat);
      // A suspension_bridge is not merely ordered on both sides: its two
      // shoulders have a related angle and taper. Random Mock spikes can
      // accidentally produce a monotonic left or right run, but the two
      // sides will usually have different near-to-far drop and correlation.
      // Use the weaker bilateral balance as a symmetry gate so an asymmetric
      // staircase cannot become a high bridge score.
      let profile_symmetry_score = clamp(
        1.0 - abs(left_profile_score - right_profile_score),
        0.0,
        1.0);
      let angle_symmetry_score = clamp(
        1.0 - abs(left_hat_correlation - right_hat_correlation),
        0.0,
        1.0);
      let bilateral_shape_symmetry = min(
        profile_symmetry_score,
        angle_symmetry_score);
      // Compare corresponding shoulder buckets instead of only comparing
      // their total drop. A random comb or an asymmetric staircase can have
      // two monotonic sides while still lacking the mirrored curvature of a
      // suspension bridge.
      let left_bucket0_mean = select(0.0,
        left_bucket0_drop_sum / f32(left_bucket0_count),
        left_bucket0_count > 0u);
      let left_bucket1_mean = select(0.0,
        left_bucket1_drop_sum / f32(left_bucket1_count),
        left_bucket1_count > 0u);
      let left_bucket2_mean = select(0.0,
        left_bucket2_drop_sum / f32(left_bucket2_count),
        left_bucket2_count > 0u);
      let left_bucket3_mean = select(0.0,
        left_bucket3_drop_sum / f32(left_bucket3_count),
        left_bucket3_count > 0u);
      let right_bucket0_mean = select(0.0,
        right_bucket0_drop_sum / f32(right_bucket0_count),
        right_bucket0_count > 0u);
      let right_bucket1_mean = select(0.0,
        right_bucket1_drop_sum / f32(right_bucket1_count),
        right_bucket1_count > 0u);
      let right_bucket2_mean = select(0.0,
        right_bucket2_drop_sum / f32(right_bucket2_count),
        right_bucket2_count > 0u);
      let right_bucket3_mean = select(0.0,
        right_bucket3_drop_sum / f32(right_bucket3_count),
        right_bucket3_count > 0u);
      let shoulder_curve_error =
        abs(left_bucket0_mean - right_bucket0_mean) /
          max(4.0, max(left_bucket0_mean, right_bucket0_mean)) +
        abs(left_bucket1_mean - right_bucket1_mean) /
          max(4.0, max(left_bucket1_mean, right_bucket1_mean)) +
        abs(left_bucket2_mean - right_bucket2_mean) /
          max(4.0, max(left_bucket2_mean, right_bucket2_mean)) +
        abs(left_bucket3_mean - right_bucket3_mean) /
          max(4.0, max(left_bucket3_mean, right_bucket3_mean));
      let shoulder_curve_symmetry = clamp(
        1.0 - shoulder_curve_error / 4.0,
        0.0,
        1.0);
      let left_connected_support = clamp(
        (left_far_drop - left_near_drop - 1.0) / 5.0,
        0.0,
        1.0);
      let right_connected_support = clamp(
        (right_far_drop - right_near_drop - 1.0) / 5.0,
        0.0,
        1.0);
      let bilateral_connected_support = min(
        left_connected_support,
        right_connected_support);
      let partial_connected_support = select(
        bilateral_connected_support,
        select(right_connected_support, left_connected_support, is_right_edge_hat),
        is_left_edge_hat || is_right_edge_hat);
      // Convert the side checks into an explicit tolerant unimodal model. A
      // full hat needs both ordered shoulders and a single prominent apex. A
      // clipped capture can instead expose one ordered branch at the window
      // edge; that branch is valid evidence, but only when it has enough span,
      // prominence, and connected support to reach the partial score ceiling.
      let left_order_score = left_pair_order_score;
      let right_order_score = right_pair_order_score;
      let available_order_score = select(
        min(left_order_score, right_order_score),
        select(right_order_score, left_order_score, is_right_edge_hat),
        is_left_edge_hat || is_right_edge_hat);
      // Allow small local violations from intervening low spikes while still
      // rejecting a staircase with no single apex. The tolerance is expressed
      // in dB so it remains meaningful when the display is rescaled.
      let tolerant_order_threshold = clamp(
        0.75 - UNIMODAL_ORDER_TOLERANCE_DB * 0.02,
        0.60,
        0.75);
      let ordering_violation_score = clamp(
        available_order_score,
        0.0,
        1.0);
      let partial_side_profile = max(left_profile_score, right_profile_score);
      let partial_support_score = clamp(
        f32(max(left_count, right_count)) / 6.0,
        0.0,
        1.0);
      let partial_branch_shape = clamp(
        ordering_violation_score * 0.45 +
        partial_side_profile * 0.30 +
        prominence * 0.15 +
        min(partial_support_score, partial_connected_support) * 0.10,
        0.0,
        1.0);
      let partial_branch_candidate = select(
        0.0,
        min(PARTIAL_BRANCH_FULL_SCORE, partial_branch_shape) * sinc_structure_gate,
        (is_left_edge_hat || is_right_edge_hat) &&
        ordering_violation_score >= tolerant_order_threshold &&
        partial_side_profile >= 0.35 &&
        partial_support_score >= 0.50);
      let full_unimodal_base = clamp(
        pair_order_score * 0.35 +
        bilateral_profile_score * 0.25 +
        prominence * 0.15 +
        min(bilateral_shape_symmetry, shoulder_curve_symmetry) * 0.15 +
        min(balanced_hat_support, bilateral_connected_support) * 0.10,
        0.0,
        1.0);
      let full_geometry_valid =
        has_bilateral_hat_support &&
        min(left_order_pairs, right_order_pairs) >= 3u &&
        bilateral_connected_support >= 0.30 &&
        shoulder_curve_symmetry >= 0.45;
      let full_unimodal_candidate = select(
        0.0,
        full_unimodal_base * pow(shoulder_curve_symmetry, 1.5) * sinc_structure_gate,
        full_geometry_valid);
      let unimodal_candidate = max(
        full_unimodal_candidate,
        partial_branch_candidate);
      max_unimodal_bridge_score = max(max_unimodal_bridge_score, unimodal_candidate);
      max_partial_bridge_score = max(max_partial_bridge_score, partial_branch_candidate);
      max_apex_prominence_score = max(max_apex_prominence_score, prominence);
      max_shoulder_symmetry_score = max(max_shoulder_symmetry_score, select(
        min(bilateral_shape_symmetry, shoulder_curve_symmetry),
        partial_side_profile,
        is_left_edge_hat || is_right_edge_hat));
      max_unimodal_violation_score = max(
        max_unimodal_violation_score,
        ordering_violation_score);
      // Correlation alone is numerically unstable for shallow hats, while a
      // near/far average alone accepts random combs. Require ordered taper
      // evidence first, then use correlation only as a confidence multiplier.
      let raw_correlation_hat_shape =
        (bilateral_hat_correlation - 0.65) / 0.35;
      // Low-amplitude synthetic hats can collapse the variance terms toward
      // zero. Treat a non-finite correlation as neutral evidence and let the
      // ordered taper profile decide whether the shape is valid.
      let correlation_hat_shape = select(
        0.5,
        clamp(raw_correlation_hat_shape, 0.0, 1.0),
        raw_correlation_hat_shape == raw_correlation_hat_shape);
      // Validate the broad envelope around the apex as a second, ordered
      // signal. Random combs can create a tall marker with lower neighbors,
      // but they do not normally produce far -> near -> apex -> near -> far
      // progression in the displayed trace.
      let envelope_left_far = waveform_envelope_at(apex_x - 0.09);
      let envelope_left_near = waveform_envelope_at(apex_x - 0.03);
      let envelope_apex = waveform_envelope_at(apex_x);
      let envelope_right_near = waveform_envelope_at(apex_x + 0.03);
      let envelope_right_far = waveform_envelope_at(apex_x + 0.09);
      let envelope_rise_score = min(
        clamp((envelope_left_near - envelope_left_far - 0.25) / 2.0, 0.0, 1.0),
        clamp((envelope_right_far - envelope_right_near - 0.25) / 2.0, 0.0, 1.0));
      let envelope_apex_score = min(
        clamp((envelope_apex - envelope_left_near - 0.25) / 2.0, 0.0, 1.0),
        clamp((envelope_apex - envelope_right_near - 0.25) / 2.0, 0.0, 1.0));
      let envelope_hat_score = envelope_rise_score * envelope_apex_score;
      // A staircase hat has strong pairwise ordering; a random comb does not.
      // Use a hard quality step here so a few accidental ordered pairs cannot
      // rescue an otherwise disordered clump. A failed ordering test contributes
      // no bridge evidence; a fractional fallback would reintroduce the exact
      // Mock-comb false positive this metric is meant to reject.
      let pair_quality_score = select(
        0.0,
        1.0,
        pair_order_score >= 0.75);
      let marker_hat_shape = bilateral_profile_score *
        pair_quality_score *
        max(0.5, correlation_hat_shape) *
        balanced_hat_support *
        bilateral_span;
      let ordered_hat_shape = marker_hat_shape * 0.80 +
        envelope_hat_score * 0.20;
      if (ordered_hat_shape > 0.0) {
        hat_clump_sum = hat_clump_sum +
          prominence * support * ordered_hat_shape;
        hat_clump_count = hat_clump_count + 1u;
        hat_pair_score_sum = hat_pair_score_sum + pair_order_score;
        hat_envelope_score_sum = hat_envelope_score_sum + envelope_hat_score;
        if (has_bilateral_hat_support) {
          bilateral_hat_clump_sum = bilateral_hat_clump_sum +
            prominence * support * ordered_hat_shape;
          bilateral_hat_clump_count = bilateral_hat_clump_count + 1u;
          bilateral_hat_pair_score_sum = bilateral_hat_pair_score_sum +
            pair_order_score * bilateral_shape_symmetry;
        }
      }
    }
  }
  let hat_clump_score = clamp(
    hat_clump_sum / f32(max(1u, hat_clump_count)),
    0.0, 1.0);
  let bilateral_hat_clump_score = clamp(
    bilateral_hat_clump_sum / f32(max(1u, bilateral_hat_clump_count)),
    0.0,
    1.0);
  let has_validated_bilateral_hat = bilateral_hat_clump_count >=
    MIN_VALIDATED_HAT_COUNT &&
    bilateral_hat_clump_score >= 0.20;
  let validated_bilateral_hat_score = select(
    0.0,
    bilateral_hat_clump_score,
    has_validated_bilateral_hat);
  // A clipped bridge can expose one hat or only part of a second shoulder.
  // Keep that evidence visible, but cap it below a confident bridge until
  // bilateral evidence or temporal history validates it. Two ordered clumps
  // receive a larger partial cap because a wide real bridge can be split by
  // intervening spikes; a single clump remains deliberately conservative.
  let partial_bridge_cap = select(
    0.35,
    0.65,
    hat_clump_count >= 2u);
  let partial_bridge_score = select(
    0.0,
    pow(clamp(hat_clump_score, 0.0, 1.0), 0.85) * partial_bridge_cap,
    hat_clump_count > 0u &&
      !has_validated_bilateral_hat);
  let validated_pair_score = select(
    0.0,
    hat_pair_score_sum / f32(max(1u, hat_clump_count)),
    hat_clump_count >= MIN_VALIDATED_HAT_COUNT);
  let ordered_bridge_score = select(
    0.0,
    pow(validated_pair_score, BRIDGE_ORDER_LIFT_EXPONENT),
    validated_pair_score >= MIN_VALIDATED_HAT_PAIR_SCORE);
  result.clump_count = min(hat_clump_count, MAX_SPIKES);
  result.unimodal_bridge_score = clamp(max_unimodal_bridge_score, 0.0, 1.0);
  result.partial_bridge_score = clamp(max_partial_bridge_score, 0.0, 1.0);
  result.apex_prominence_score = clamp(max_apex_prominence_score, 0.0, 1.0);
  result.shoulder_symmetry_score = clamp(max_shoulder_symmetry_score, 0.0, 1.0);
  // Keep this quadratic correlation for the independently gated wide-U
  // feature. It is deliberately not used as the envelope fit diagnostic:
  // partial captures and broad flat valleys are not well represented by one
  // global parabola.
  var quadratic_fit_score = 0.0;
  var envelope_support_count = 0u;
  for (var fit_center_index = 0u; fit_center_index < 9u; fit_center_index = fit_center_index + 1u) {
    let fit_center = 0.18 + f32(fit_center_index) * 0.08;
    var sum_q = 0.0;
    var sum_y = 0.0;
    var sum_qq = 0.0;
    var sum_yy = 0.0;
    var sum_qy = 0.0;
    for (var fit_index = 0u; fit_index < fit_spike_count; fit_index = fit_index + 1u) {
      let x = f32(spikes[fit_index].index) /
        f32(max(1u, params.source_length - 1u));
      let q = (x - fit_center) * (x - fit_center);
      let y = spikes[fit_index].value;
      sum_q = sum_q + q;
      sum_y = sum_y + y;
      sum_qq = sum_qq + q * q;
      sum_yy = sum_yy + y * y;
      sum_qy = sum_qy + q * y;
    }
    let n = f32(max(1u, fit_spike_count));
    let covariance = sum_qy - (sum_q * sum_y) / n;
    let variance_q = max(0.000001, sum_qq - (sum_q * sum_q) / n);
    let variance_y = max(0.000001, sum_yy - (sum_y * sum_y) / n);
    let correlation = clamp(covariance / sqrt(variance_q * variance_y), 0.0, 1.0);
    quadratic_fit_score = max(quadratic_fit_score, correlation);
  }
  let global_curve_correlation = quadratic_fit_score;
  // Fit the displayed upper envelope as well as the marker list. Marker
  // records are intentionally asynchronous and can be incomplete at a
  // capture edge; the ordered waveform remains authoritative for a wide
  // U-dip. This correlation uses normalized coordinates and is independent
  // of absolute RF frequency.
  var waveform_quadratic_score = 0.0;
  for (var waveform_center_index = 0u;
       waveform_center_index < 13u;
       waveform_center_index = waveform_center_index + 1u) {
    let waveform_center = 0.20 + f32(waveform_center_index) * 0.05;
    var waveform_sum_q = 0.0;
    var waveform_sum_y = 0.0;
    var waveform_sum_qq = 0.0;
    var waveform_sum_yy = 0.0;
    var waveform_sum_qy = 0.0;
    for (var waveform_sample_index = 0u;
         waveform_sample_index < 32u;
         waveform_sample_index = waveform_sample_index + 1u) {
      let x = f32(waveform_sample_index) / 31.0;
      let q = (x - waveform_center) * (x - waveform_center);
      let y = waveform_envelope_at(x);
      waveform_sum_q = waveform_sum_q + q;
      waveform_sum_y = waveform_sum_y + y;
      waveform_sum_qq = waveform_sum_qq + q * q;
      waveform_sum_yy = waveform_sum_yy + y * y;
      waveform_sum_qy = waveform_sum_qy + q * y;
    }
    let waveform_n = 32.0;
    let waveform_covariance = waveform_sum_qy -
      (waveform_sum_q * waveform_sum_y) / waveform_n;
    let waveform_variance_q = max(
      0.000001,
      waveform_sum_qq - waveform_sum_q * waveform_sum_q / waveform_n);
    let waveform_variance_y = max(
      0.000001,
      waveform_sum_yy - waveform_sum_y * waveform_sum_y / waveform_n);
    waveform_quadratic_score = max(
      waveform_quadratic_score,
      clamp(waveform_covariance /
        sqrt(waveform_variance_q * waveform_variance_y), 0.0, 1.0));
  }
  let waveform_u_depth = clamp(
    (edge_sum / 16.0 - center_sum / 16.0 - 0.75) / 2.0,
    0.0,
    1.0);
  let waveform_u_fit = sqrt(waveform_quadratic_score) * waveform_u_depth;
  // A VFO can show only a section of the U. Search visible normalized
  // windows so a partial valley is still evidence, without requiring the
  // capture edges to be the two shoulders.
  var visible_u_sum = 0.0;
  var visible_u_support = 0u;
  var visible_u_run = 0u;
  var longest_visible_u_run = 0u;
  for (var visible_center_index = 0u;
       visible_center_index < 13u;
       visible_center_index = visible_center_index + 1u) {
    let visible_center = 0.16 + f32(visible_center_index) * 0.057;
    let visible_left = waveform_envelope_at(visible_center - 0.16);
    let visible_middle = waveform_envelope_at(visible_center);
    let visible_right = waveform_envelope_at(visible_center + 0.16);
    let visible_depth = clamp(
      ((visible_left + visible_right) * 0.5 - visible_middle - 0.5) / 2.5,
      0.0,
      1.0);
    let visible_left_support = clamp(
      (visible_left - visible_middle - 0.25) / 2.5,
      0.0,
      1.0);
    let visible_right_support = clamp(
      (visible_right - visible_middle - 0.25) / 2.5,
      0.0,
      1.0);
    let visible_bilateral_support = min(
      visible_left_support,
      visible_right_support);
    let visible_score = visible_depth *
      (0.55 + 0.45 * visible_bilateral_support);
    if (visible_score >= 0.50) {
      visible_u_sum = visible_u_sum + visible_score;
      visible_u_support = visible_u_support + 1u;
      visible_u_run = visible_u_run + 1u;
      longest_visible_u_run = max(longest_visible_u_run, visible_u_run);
    } else {
      visible_u_run = 0u;
    }
  }
  // One lucky pair of random shoulders is not a U. Require several adjacent
  // normalized windows to agree before the visible-window detector contributes
  // to the global score; this still accepts a wide partial U while rejecting
  // irregular mock combs.
  let best_visible_u_score = select(
    0.0,
    visible_u_sum / f32(visible_u_support),
    visible_u_support >= 3u && longest_visible_u_run >= 3u);
  let next_u_dip_candidate = max(waveform_u_fit, best_visible_u_score);
  if (next_u_dip_candidate > global_u_dip) {
    u_dip_source = select(4u, 3u, waveform_u_fit >= best_visible_u_score);
  }
  global_u_dip = max(
    global_u_dip,
    next_u_dip_candidate);
  // The dotted spike-top envelope is the clearest representation of a very
  // wide U. Its quadratic correlation remains meaningful when fixed regional
  // sample pairs land on pulse valleys or isolated tall spikes.
  let quadratic_wide_u_score = select(
    0.0,
    sqrt(global_curve_correlation),
    global_curve_correlation >= MIN_WIDE_U_CORRELATION &&
      fit_spike_count >= 64u &&
      broad_u_coverage_score >= 0.45 &&
      wide_u_trend_score >= 0.50 &&
      sustained_center_valley >= 0.50);
  if (quadratic_wide_u_score > global_u_dip) {
    u_dip_source = 5u;
  }
  global_u_dip = max(global_u_dip, quadratic_wide_u_score);
  // Fit the visible envelope as a piecewise slope pattern. This is tolerant
  // of panning because positions are used only as normalized [0, 1] span
  // coordinates, and it is tolerant of partial visibility because the best
  // candidate may place the U-turn outside the captured segment. A valid
  // segment can therefore be descending, ascending, or flat; a full U is
  // represented by descending -> flat -> ascending slopes.
  var envelope_segment_count = 0u;
  var flat_segment_count = 0u;
  var current_flat_run = 0u;
  var longest_flat_run = 0u;
  var direction_transition_count = 0u;
  var previous_direction = 0i;
  var total_slope_energy = 0.0;
  if (fit_spike_count >= ENVELOPE_MIN_SUPPORT) {
    for (var segment_index = 0u;
         segment_index + 1u < ENVELOPE_SAMPLE_COUNT;
         segment_index = segment_index + 1u) {
      let x0 = f32(segment_index) / f32(ENVELOPE_SAMPLE_COUNT - 1u);
      let x1 = f32(segment_index + 1u) / f32(ENVELOPE_SAMPLE_COUNT - 1u);
      let dx = max(0.000001, x1 - x0);
      let slope = (waveform_envelope_at(x1) - waveform_envelope_at(x0)) / dx;
      let magnitude = abs(slope);
      total_slope_energy = total_slope_energy + magnitude;
      envelope_segment_count = envelope_segment_count + 1u;
      if (magnitude <= ENVELOPE_FLAT_SLOPE_DB) {
        flat_segment_count = flat_segment_count + 1u;
        current_flat_run = current_flat_run + 1u;
        longest_flat_run = max(longest_flat_run, current_flat_run);
      } else if (slope > 0.0) {
        current_flat_run = 0u;
        if (previous_direction != 0i && previous_direction != 1i) {
          direction_transition_count = direction_transition_count + 1u;
        }
        previous_direction = 1i;
      } else {
        current_flat_run = 0u;
        if (previous_direction != 0i && previous_direction != -1i) {
          direction_transition_count = direction_transition_count + 1u;
        }
        previous_direction = -1i;
      }
    }
  }
  var best_curve_match = 0.0;
  var best_curve_energy = 0.0;
  if (envelope_segment_count > 0u) {
    // Candidate zero is an entirely ascending visible segment; candidate
    // segment_count is entirely descending. Interior candidates model a U,
    // while the reverse orientation is retained for a partial inverted view.
    for (var candidate = 0u;
         candidate <= envelope_segment_count;
         candidate = candidate + 1u) {
      var u_matches = 0u;
      var dome_matches = 0u;
      var u_energy = 0.0;
      var dome_energy = 0.0;
      var local_segment_index = 0u;
      for (var segment_index = 0u;
           segment_index + 1u < ENVELOPE_SAMPLE_COUNT;
           segment_index = segment_index + 1u) {
        let x0 = f32(segment_index) / f32(ENVELOPE_SAMPLE_COUNT - 1u);
        let x1 = f32(segment_index + 1u) / f32(ENVELOPE_SAMPLE_COUNT - 1u);
        let dx = max(0.000001, x1 - x0);
        let slope = (waveform_envelope_at(x1) - waveform_envelope_at(x0)) / dx;
        let magnitude = abs(slope);
        let flat = magnitude <= ENVELOPE_FLAT_SLOPE_DB;
        var u_direction_match = false;
        var dome_direction_match = false;
        if (local_segment_index < candidate) {
          u_direction_match = slope < -ENVELOPE_FLAT_SLOPE_DB;
          dome_direction_match = slope > ENVELOPE_FLAT_SLOPE_DB;
        } else {
          u_direction_match = slope > ENVELOPE_FLAT_SLOPE_DB;
          dome_direction_match = slope < -ENVELOPE_FLAT_SLOPE_DB;
        }
        if (flat || u_direction_match) {
          u_matches = u_matches + 1u;
          u_energy = u_energy + magnitude;
        }
        if (flat || dome_direction_match) {
          dome_matches = dome_matches + 1u;
          dome_energy = dome_energy + magnitude;
        }
        local_segment_index = local_segment_index + 1u;
      }
      let segment_total = f32(max(1u, envelope_segment_count));
      let u_match_score = f32(u_matches) / segment_total;
      let dome_match_score = f32(dome_matches) / segment_total;
      if (u_match_score > best_curve_match) {
        best_curve_match = u_match_score;
        best_curve_energy = u_energy;
      }
      if (dome_match_score > best_curve_match) {
        best_curve_match = dome_match_score;
        best_curve_energy = dome_energy;
      }
    }
  }
  let flat_fraction = f32(flat_segment_count) /
    f32(max(1u, envelope_segment_count));
  // A flat center valley is valid when it is contiguous. Scattered flat
  // steps in an irregular comb are not equivalent to a coherent plateau.
  let flat_coherence_score = select(
    f32(longest_flat_run) / f32(max(1u, envelope_segment_count)),
    flat_fraction,
    flat_fraction >= 0.65);
  let slope_coherence_score = clamp(
    (best_curve_match - 0.50) / 0.35,
    0.0,
    1.0);
  // A valid envelope has at most one meaningful slope reversal: the broad
  // U-turn (or its inverse). Random combs can accidentally match one split,
  // but their direction changes keep accumulating across the span.
  let transition_coherence = clamp(
    1.0 - max(0.0, f32(direction_transition_count) - 1.0) / 2.0,
    0.0,
    1.0);
  let piecewise_slope_score = slope_coherence_score * transition_coherence;
  // Flat valleys are coherent structure, not zero residual. This branch also
  // makes the metric useful when the visible segment contains no strong slope.
  let envelope_fit_score = select(
    0.0,
    max(flat_coherence_score, piecewise_slope_score),
    envelope_segment_count >= ENVELOPE_MIN_SUPPORT);
  let residual_energy_score = select(
    flat_coherence_score,
    best_curve_energy / max(0.000001, total_slope_energy),
    total_slope_energy > 0.000001);
  let envelope_residual_score = select(
    0.0,
    max(flat_coherence_score, residual_energy_score * transition_coherence),
    envelope_segment_count >= ENVELOPE_MIN_SUPPORT);
  if (envelope_fit_score >= 0.45) {
    envelope_support_count = fit_spike_count;
  }
  result.envelope_fit_score = clamp(envelope_fit_score, 0.0, 1.0);
  result.envelope_residual_score = envelope_residual_score;
  result.envelope_support_count = envelope_support_count;
  result.u_dip_score = global_u_dip;
  result.u_dip_source = u_dip_source;
  // independent_bridge_shoulders: local hat width/shoulder evidence belongs to
  // suspension_bridge, not to the global U-dip. A tuned view can legitimately
  // contain several excellent hats while showing no capture-wide U at all.
      result.bridge_width_score = clamp(validated_pair_score, 0.0, 1.0);
      result.bridge_shoulder_score = max(
        clamp(validated_pair_score, 0.0, 1.0),
        clamp(hat_envelope_score_sum / f32(max(1u, hat_clump_count)), 0.0, 1.0));
  // The legacy bridge accumulator is intentionally not exposed as the final
  // suspension_bridge diagnostic. A random comb can make that accumulator
  // large through isolated apex coincidences. Make the displayed and consumed
  // bridge score agree with the connected unimodal/partial geometry instead.
  let full_validated_bridge_score = min(
    result.unimodal_bridge_score,
    min(result.bridge_width_score, result.bridge_shoulder_score));
  let partial_validated_bridge_score = min(
    result.partial_bridge_score,
    result.bridge_shoulder_score);
  result.suspension_bridge_score = max(
    full_validated_bridge_score,
    partial_validated_bridge_score);
  // A sparse frame dominated by a DC/aliased spur cannot establish either
  // feature, even if a local search window happens to resemble a U.
  if (result.spike_count < 64u) {
    result.suspension_bridge_score = 0.0;
    result.bridge_width_score = 0.0;
    result.bridge_shoulder_score = 0.0;
    result.u_dip_score = 0.0;
    result.envelope_fit_score = 0.0;
    result.envelope_residual_score = 0.0;
    result.envelope_support_count = 0u;
        result.sinc_penalty_score = 0.0;
        result.low_rise_bridge_score = 0.0;
        result.unimodal_bridge_score = 0.0;
        result.partial_bridge_score = 0.0;
        result.apex_prominence_score = 0.0;
        result.shoulder_symmetry_score = 0.0;
      }
  // A valid low-rise bridge is not necessarily a high composite hat: tall
  // spikes can crowd out the lower members while the two measurable parts of
  // the structure remain present. Preserve that evidence for the one-frame
  // classifier when at least two clumps support it and the capture-wide U is
  // absent. The temporal pass still requires recurrence before accepting it.
  let low_rise_bridge_score = select(
    0.0,
    min(result.bridge_width_score, result.bridge_shoulder_score),
    result.clump_count >= 2u &&
    result.bridge_width_score >= MIN_LOW_RISE_BRIDGE_WIDTH &&
    result.bridge_shoulder_score >= 0.50 &&
    result.u_dip_score < 0.35);
  let low_rise_recovery_score = select(
    0.0,
    low_rise_bridge_score,
    low_rise_bridge_score > result.suspension_bridge_score + 0.15);
  result.low_rise_bridge_score = low_rise_recovery_score;
  result.suspension_bridge_score = max(
    result.suspension_bridge_score,
    low_rise_recovery_score);
  // A broad U and a strong bridge can look convincing even when the observed
  // envelope is internally incoherent. That contradiction is characteristic
  // of the irregular sinc/hardware response: the local shape scores are high,
  // but the sampled envelope cannot explain the visible rise and fall. Keep
  // this as a soft quality penalty rather than a hard N-APT rejection so a
  // partial Channel C capture can remain useful as a low-confidence result.
  let irregular_sinc_structure_penalty = select(
    0.0,
    clamp(
      result.u_dip_score *
      result.suspension_bridge_score *
      clamp(1.0 - result.envelope_fit_score, 0.0, 1.0) *
      clamp(1.0 - result.envelope_residual_score, 0.0, 1.0) *
      1.50,
      0.0,
      1.0),
    result.suspension_bridge_score >= IRREGULAR_SINC_MIN_BRIDGE_SCORE &&
    result.u_dip_score >= IRREGULAR_SINC_MIN_U_DIP_SCORE);
  result.sinc_penalty_score = max(
    sinc_penalty_score(),
    irregular_sinc_structure_penalty);
  result.capture_quality_score = clamp(
    1.0 - result.sinc_penalty_score,
    0.0,
    1.0);
  // This is intentionally a separate power feature. A strong floor-relative
  // spike population cannot, by itself, create bridge or U-dip structure.
  result.floor_relative_power_score = clamp(
    f32(atomicLoad(&result.floor_power_sum_fixed)) / f32(max(1u, params.length) * 32u), 0.0, 1.0);
  // N-APT's pulse modulation is expected. A changing pulse envelope is not
  // temporal instability, so this frame-local classifier must not penalize it.
  result.temporal_stability = 1.0;
  let bandwidth = params.frequency_max - params.frequency_min;
  result.bandwidth_prior = select(0.2, 1.0, bandwidth <= 30300000.0);
  let metric_count = min(result.spike_count, MAX_SPIKES);
  for (var spike_index = 0u; spike_index < metric_count; spike_index = spike_index + 1u) {
    let raw_index = spikes[spike_index].index;
    let ratio = f32(raw_index) / f32(max(1u, params.source_length - 1u));
    spike_metrics[spike_index].frequency_hz =
      params.frequency_min + ratio * (params.frequency_max - params.frequency_min);
    spike_metrics[spike_index].power_dbm = spikes[spike_index].value;
    spike_metrics[spike_index].index = raw_index;
    spike_metrics[spike_index].padding = 0u;
  }
}
