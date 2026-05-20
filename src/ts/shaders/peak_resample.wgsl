// GPU-side peak resampling: maps an input waveform of arbitrary length
// to a fixed-width output (e.g. 4096 bins for the waterfall texture).
// Each output bin takes the maximum value from its corresponding input range,
// preserving spikes better than averaging.

@group(0) @binding(0) var<storage, read> input_data: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_data: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<u32>; // [src_len, dst_len, 0, 0]

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dst_idx = gid.x;
  let src_len = params.x;
  let dst_len = params.y;

  if (dst_idx >= dst_len) { return; }

  let ratio = f32(src_len) / f32(dst_len);
  let start = u32(floor(f32(dst_idx) * ratio));
  let end = u32(floor(f32(dst_idx + 1u) * ratio));
  let safe_end = max(end, start + 1u);

  var max_val: f32 = -200.0;
  for (var j: u32 = start; j < min(safe_end, src_len); j = j + 1u) {
    let val = input_data[j];
    // NaN guard — treat NaN as floor
    if (val == val && val > max_val) {
      max_val = val;
    }
  }

  output_data[dst_idx] = max_val;
}
