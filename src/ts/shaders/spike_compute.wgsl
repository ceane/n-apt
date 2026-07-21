struct SpikeMarker {
  index: u32,
  value: f32,
  score: f32,
  radius: f32,
}

struct Params {
  length: u32,
  window_size: u32,
  min_z_score: f32,
  recovery_pass: u32,
}

struct FloorResult {
  sum_bits: u32,
  count: u32,
  partial_sum: i32,
}

@group(0) @binding(0) var<storage, read> waveform: array<f32>;
@group(0) @binding(1) var<storage, read> params: Params;
@group(0) @binding(2) var<storage, read_write> spikes: array<SpikeMarker>;
@group(0) @binding(3) var<storage, read_write> spike_count: atomic<u32>;
@group(0) @binding(4) var<storage, read> floor_result: FloorResult;
@group(0) @binding(5) var<storage, read> source_peak_indices: array<u32>;

const MAX_SPIKES: u32 = 1024u;
const EDGE_BAND_BINS: u32 = 10u;

fn waveform_or(index: i32, length: u32, fallback: f32) -> f32 {
  if (index < 0 || index >= i32(length)) {
    return fallback;
  }
  return waveform[u32(index)];
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let i = global_id.x;
  let l = params.length;

  if (i >= l || l < 3u) { return; }
  
  let val = waveform[i];
  if (val != val) { return; }
  
  // Pass 1: edge-safe immediate local maximum. This keeps real edge spikes
  // without requiring a two-bin peak plateau that suppresses clusters.
  let left = waveform_or(i32(i) - 1, l, val - 1.0);
  let right = waveform_or(i32(i) + 1, l, val - 1.0);
  let is_right_edge_band = i + EDGE_BAND_BINS >= l;
  let edge_band_start = select(0u, l - EDGE_BAND_BINS, l > EDGE_BAND_BINS);
  var is_edge_band_max = true;
  if (is_right_edge_band) {
    for (var edge_index = edge_band_start; edge_index < l; edge_index = edge_index + 1u) {
      let edge_sample = waveform[edge_index];
      if (edge_sample > val || (edge_sample == val && edge_index > i)) {
        is_edge_band_max = false;
      }
    }
  }
  // Select exactly one bin for plateaus: the right-most equal maximum wins.
  // This keeps the marker tied to a real FFT sample while avoiding jitter
  // between adjacent equal-valued bins.
  let immediate_peak = val >= left && val > right;
  let is_peak = immediate_peak || (is_right_edge_band && is_edge_band_max);
  if (!is_peak) {
    return;
  }

  let left2 = waveform_or(i32(i) - 2, l, left);
  let right2 = waveform_or(i32(i) + 2, l, right);
  let immediate_floor = max(max(left, right), max(left2, right2));
  let immediate_prominence = val - immediate_floor;

  let left_far = waveform_or(i32(i) - 3, l, left2);
  let right_far = waveform_or(i32(i) + 3, l, right2);
  let sharpness = val - ((left + right + left2 + right2 + left_far + right_far) / 6.0);

  // Pass 2: score the candidate against a small edge-clamped neighborhood.
  // Keep this bounded so the compute pass does not generate more candidates
  // than the fixed render buffer can display stably.
  let suppression_radius = min(max(1u, params.window_size), 2u);
  let radius = min(max(12u, suppression_radius * 3u), 24u);
  let guard = 1u;
  let start = select(0u, i - radius, i > radius);
  let end = min(l - 1u, i + radius);

  var local_sum: f32 = 0.0;
  var local_count: u32 = 0u;
  var local_max: f32 = -100000.0;
  var has_dominating_neighbor = false;
  var left_valley = val;
  var right_valley = val;

  for (var j: u32 = start; j <= end; j = j + 1u) {
    let sample = waveform[j];
    if (sample != sample) { continue; }
    let distance = abs(i32(j) - i32(i));

    // Non-maximum suppression: one annotation per local spectral feature.
    // Equal-height ties resolve to the right, matching the immediate plateau
    // rule above and keeping the result deterministic between frames.
    if (!is_right_edge_band && distance <= i32(suppression_radius) && j != i && (sample > val || (sample == val && j > i))) {
      has_dominating_neighbor = true;
    }

    if (j < i) {
      left_valley = min(left_valley, sample);
    } else if (j > i) {
      right_valley = min(right_valley, sample);
    }

    if (distance > i32(guard)) {
      local_sum = local_sum + sample;
      local_count = local_count + 1u;
      local_max = max(local_max, sample);
    }
  }

  if (local_count == 0u) { return; }
  if (has_dominating_neighbor) { return; }

  let local_avg = local_sum / f32(local_count);
  let global_floor = bitcast<f32>(floor_result.sum_bits);
  let avg_prominence = val - local_avg;
  let global_floor_score = val - global_floor;
  let competitor_gap = val - local_max;
  let valley_prominence = val - max(left_valley, right_valley);
  let min_avg_prominence = max(5.0, params.min_z_score * 1.5);
  let valley_prominent = valley_prominence >= 1.5 && immediate_prominence >= 0.15 && sharpness >= 0.15;
  let cluster_prominence = avg_prominence >= 3.5 && immediate_prominence >= 0.2 && sharpness >= 0.3 && competitor_gap >= -6.0;
  let broad_prominence = avg_prominence >= 4.0 && global_floor_score >= 4.5 && sharpness >= 0.1;
  let global_floor_prominent = global_floor_score >= 4.5 && sharpness >= 0.3;
  let edge_prominence = (i < radius || i + radius >= l) && global_floor_score >= 3.5 && sharpness >= 0.2;
  // The final display bins have no complete right-hand valley. Score their
  // local maxima from the available left-hand descent instead of requiring a
  // global floor that can be pulled upward by an SDR's DC edge ramp.
  let edge_rise = val - left_valley;
  let edge_corner = val - (left + (left - left2));
  let right_edge_prominence = is_right_edge_band && is_edge_band_max &&
    edge_rise >= 0.35 &&
    (edge_corner >= 0.1 || immediate_prominence >= 0.05);
  let is_recovery_pass = params.recovery_pass != 0u;
  let recovery_prominent = is_recovery_pass && global_floor_score >= 3.0 && (
    (valley_prominence >= 1.0 && immediate_prominence >= 0.1 && sharpness >= 0.1) ||
    (avg_prominence >= 4.0 && immediate_prominence >= 0.1 && sharpness >= 0.15)
  );

  if (valley_prominent || avg_prominence >= min_avg_prominence || cluster_prominence || broad_prominence || global_floor_prominent || edge_prominence || right_edge_prominence || recovery_prominent) {
    let source_index = source_peak_indices[i];

    // The second dispatch runs after the primary dispatch in the same command
    // pass. Preserve primary results and only append newly recovered peaks.
    if (is_recovery_pass) {
      let existing_count = min(atomicLoad(&spike_count), MAX_SPIKES);
      for (var existing_index: u32 = 0u; existing_index < existing_count; existing_index = existing_index + 1u) {
        if (spikes[existing_index].index == source_index) {
          return;
        }
      }
    }

    let idx = atomicAdd(&spike_count, 1u);
    if (idx < MAX_SPIKES) {
      spikes[idx].index = source_index;
      spikes[idx].value = val;
      spikes[idx].score = max(max(max(avg_prominence, global_floor_score), valley_prominence), sharpness);
      spikes[idx].radius = 8.0;
    }
  }
}
