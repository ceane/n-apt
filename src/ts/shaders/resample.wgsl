// WebGPU Resampling Compute Shader
//
// Every output pixel maps through display frequency space into the unchanged
// acquisition. Mirror mode reflects display f<0 onto |f| in source space.
// Live callers must
// not slice or resample the input on the CPU first.
struct ResampleParams {
  src_len: u32,
  out_len: u32,
  mirror_enabled: u32,
  _pad0: u32,
  source_min: f32,
  source_max: f32,
  display_min: f32,
  display_max: f32,
  floor_db: f32,
  presentation_offset_hz: f32,
  _pad2: f32,
  _pad3: f32,
};

@group(0) @binding(0) var<storage, read> input_buffer: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_buffer: array<f32>;
@group(0) @binding(2) var<uniform> params: ResampleParams;
@group(0) @binding(3) var<storage, read_write> output_peak_indices: array<u32>;

fn mirrored_source_frequency(display_hz: f32) -> f32 {
  // Match basebandMirror.mapDisplayFrequencyToSource: one reflection across
  // DC. Do not tile the acquisition — that repeats Channel A below 0 Hz.
  if (display_hz < 0.0) {
    return -display_hz;
  }
  return display_hz;
}

fn source_frequency(display_hz: f32, source_span: f32) -> f32 {
  if (params.mirror_enabled == 1u) {
    return mirrored_source_frequency(display_hz);
  }
  return display_hz;
}

fn frequency_to_bin(frequency_hz: f32, source_span: f32) -> f32 {
  return ((frequency_hz - params.source_min) / source_span) * f32(params.src_len - 1u);
}

fn peak_in_bin_range(start: u32, end_exclusive: u32) -> vec2<f32> {
  var max_val: f32 = -3.402823466e38;
  var max_index: u32 = start;
  for (var i = start; i < end_exclusive && i < params.src_len; i = i + 1u) {
    let v = input_buffer[i];
    if (v == v && abs(v) < 3.402823466e38 && v > max_val) {
      max_val = v;
      max_index = i;
    }
  }
  return vec2<f32>(max_val, f32(max_index));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  if (x >= params.out_len) {
    return;
  }

  let source_span = params.source_max - params.source_min;
  let display_span = params.display_max - params.display_min;
  if (source_span <= 0.0 || display_span <= 0.0 || params.src_len == 0u) {
    output_buffer[x] = params.floor_db;
    output_peak_indices[x] = 0u;
    return;
  }

  // Hardware normally presents the complete acquired frame with mirroring
  // off. Keep that hot path equivalent to the original main-branch shader:
  // proportional bins only, with no display-frequency transforms or folds.
  if (
    params.mirror_enabled == 0u &&
    abs(params.display_min - params.source_min) < 0.5 &&
    abs(params.display_max - params.source_max) < 0.5
  ) {
    let bin_scale = f32(params.src_len) / f32(params.out_len);
    let fast_path_start = u32(floor(f32(x) * bin_scale));
    let fast_path_end = max(
      fast_path_start + 1u,
      u32(ceil(f32(x + 1u) * bin_scale)),
    );
    let peak = peak_in_bin_range(fast_path_start, fast_path_end);
    output_buffer[x] = select(params.floor_db, peak.x, peak.x > -3.402823466e38);
    output_peak_indices[x] = u32(peak.y);
    return;
  }

  let t0 = f32(x) / f32(params.out_len);
  let t1 = f32(x + 1u) / f32(params.out_len);
  let d0 = params.display_min + t0 * display_span - params.presentation_offset_hz;
  let d1 = params.display_min + t1 * display_span - params.presentation_offset_hz;

  var src_lo: f32;
  var src_hi: f32;
  let s0 = source_frequency(d0, source_span);
  let s1 = source_frequency(d1, source_span);
  src_lo = min(s0, s1);
  src_hi = max(s0, s1);

  // Frequencies beyond the acquired positive half are uncovered — paint the
  // floor rather than clamping to the edge bin, which smears the +fs/2 peak
  // across the whole uncovered region.
  if (src_hi < params.source_min || src_lo > params.source_max) {
    output_buffer[x] = params.floor_db;
    output_peak_indices[x] = 0u;
    return;
  }

  let clipped_lo = max(src_lo, params.source_min);
  let clipped_hi = min(src_hi, params.source_max);
  var bin_start = u32(clamp(floor(frequency_to_bin(clipped_lo, source_span)), 0.0, f32(params.src_len - 1u)));
  var bin_end = u32(clamp(floor(frequency_to_bin(clipped_hi, source_span)) + 1.0, 0.0, f32(params.src_len)));
  bin_end = max(bin_end, bin_start + 1u);

  let peak = peak_in_bin_range(bin_start, bin_end);
  output_buffer[x] = select(params.floor_db, peak.x, peak.x > -3.402823466e38);
  output_peak_indices[x] = u32(peak.y);
}
