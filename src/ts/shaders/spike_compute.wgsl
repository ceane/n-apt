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

@group(0) @binding(0) var<storage, read> waveform: array<f32>;
@group(0) @binding(1) var<storage, read> params: Params;
@group(0) @binding(2) var<storage, read_write> spikes: array<SpikeMarker>;
@group(0) @binding(3) var<storage, read_write> spike_count: atomic<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let i = global_id.x;
  let l = params.length;

  // SCATTER TEST REMOVED - Implementing Simple Peak Detection
  if (i < 10u || i >= l - 10u) { return; }
  
  let val = waveform[i];
  
  // 1. Local Maxima Check (Strict)
  if (val <= waveform[i-1u] || val <= waveform[i+1u] || val <= waveform[i-2u] || val <= waveform[i+2u]) {
    return;
  }

  // 2. Simple Local Average (10-bin window)
  var local_sum: f32 = 0.0;
  for (var j: u32 = i - 10u; j <= i + 10u; j = j + 1u) {
    if (j == i) { continue; }
    local_sum = local_sum + waveform[j];
  }
  let local_avg = local_sum / 20.0;

  // 3. Threshold Check: Must be 15dB above local average
  if (val > local_avg + 15.0) {
    let idx = atomicAdd(&spike_count, 1u);
    if (idx < 100u) {
      spikes[idx].index = i;
      spikes[idx].value = val;
      spikes[idx].score = val - local_avg;
      spikes[idx].radius = 8.0;
    }
  }
}
