export const WATERFALL_RETUNE_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> previous_row: array<f32>;
@group(0) @binding(1) var<storage, read> current_row: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_row: array<f32>;
@group(0) @binding(3) var<uniform> params: vec4<f32>;

fn smoother_step(value: f32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

fn sample_shifted_previous(index: f32, fallback_db: f32, row_len: u32) -> f32 {
  if (index < 0.0 || index > f32(row_len - 1u)) {
    return fallback_db;
  }

  if (index >= f32(row_len - 1u)) {
    let edge = previous_row[row_len - 1u];
    return select(fallback_db, edge, edge == edge);
  }

  let lower_index = u32(floor(index));
  let upper_index = lower_index + 1u;
  let fraction = index - f32(lower_index);
  let lower = previous_row[lower_index];
  let upper = previous_row[upper_index];
  let safe_lower = select(fallback_db, lower, lower == lower);
  let safe_upper = select(safe_lower, upper, upper == upper);

  return safe_lower + (safe_upper - safe_lower) * fraction;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row_len = u32(params.x);
  let idx = gid.x;

  if (idx >= row_len || row_len == 0u) {
    return;
  }

  let drift_bins = params.y;
  let progress = clamp(params.z, 0.0, 1.0);
  let floor_db = params.w;
  let current = current_row[idx];
  let current_value = select(floor_db, current, current == current);
  let shifted_index = f32(idx) + drift_bins * progress;
  let previous_value = sample_shifted_previous(
    shifted_index,
    current_value,
    row_len,
  );
  let blend = smoother_step(progress);

  output_row[idx] = previous_value + (current_value - previous_value) * blend;
}
`;
