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
  padding: f32,
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

const MAX_SPIKES: u32 = 128u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let i = global_id.x;
  let l = params.length;

  if (i >= l || l < 3u) { return; }
  
  let val = waveform[i];
  if (val != val) { return; }
  
  // Pass 1: edge-safe immediate local maximum. This keeps real edge spikes
  // without requiring a two-bin peak plateau that suppresses clusters.
  let has_left = i > 0u;
  let has_right = i + 1u < l;
  let left = select(val - 1.0, waveform[i - 1u], has_left);
  let right = select(val - 1.0, waveform[i + 1u], has_right);
  if (val <= left + 0.45 || val <= right + 0.45) {
    return;
  }

  let left2 = select(left, waveform[i - 2u], i > 1u);
  let right2 = select(right, waveform[i + 2u], i + 2u < l);
  let immediate_floor = max(max(left, right), max(left2, right2));
  let immediate_prominence = val - immediate_floor;
  if (immediate_prominence < 2.5) {
    return;
  }

  let left_far = select(left2, waveform[i - 3u], i > 2u);
  let right_far = select(right2, waveform[i + 3u], i + 3u < l);
  let sharpness = val - ((left + right + left2 + right2 + left_far + right_far) / 6.0);
  if (sharpness < 1.35) {
    return;
  }

  // Pass 2: score the candidate against a small edge-clamped neighborhood.
  // Keep this bounded so the compute pass does not generate more candidates
  // than the fixed render buffer can display stably.
  let radius = min(max(12u, params.window_size), 32u);
  let guard = 1u;
  let start = select(0u, i - radius, i > radius);
  let end = min(l - 1u, i + radius);

  var local_sum: f32 = 0.0;
  var local_count: u32 = 0u;
  var local_max: f32 = -100000.0;

  for (var j: u32 = start; j <= end; j = j + 1u) {
    let sample = waveform[j];
    if (sample != sample) { continue; }

    let distance = abs(i32(j) - i32(i));
    if (distance > i32(guard)) {
      local_sum = local_sum + sample;
      local_count = local_count + 1u;
      local_max = max(local_max, sample);
    }
  }

  if (local_count == 0u) { return; }

  let local_avg = local_sum / f32(local_count);
  let global_floor = bitcast<f32>(floor_result.sum_bits);
  let avg_prominence = val - local_avg;
  let global_floor_score = val - global_floor;
  let competitor_gap = val - local_max;
  let min_avg_prominence = max(9.0, params.min_z_score * 3.0);
  let cluster_prominence = avg_prominence >= 6.5 && immediate_prominence >= 2.5 && sharpness >= 1.35 && competitor_gap >= -8.5;
  let global_floor_prominent = global_floor_score >= 7.5 && sharpness >= 1.35;
  let edge_prominence = (i < radius || i + radius >= l) && global_floor_score >= 5.75 && sharpness >= 1.1;

  if (avg_prominence >= min_avg_prominence || cluster_prominence || global_floor_prominent || edge_prominence) {
    let idx = atomicAdd(&spike_count, 1u);
    if (idx < MAX_SPIKES) {
      spikes[idx].index = i;
      spikes[idx].value = val;
      spikes[idx].score = max(max(avg_prominence, global_floor_score), sharpness);
      spikes[idx].radius = 8.0;
    }
  }
}
