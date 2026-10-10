// native-morphology-v1: no display resampling or absolute RF-frequency prior.
struct Params { length: u32, step: u32, broad: u32, floor: f32 }
@group(0) @binding(0) var<storage, read> spectrum: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;
fn at(i: i32) -> f32 { return spectrum[u32(clamp(i, 0, i32(params.length) - 1))]; }
fn local_mean(i: i32) -> f32 { return (at(i - i32(params.step)) + at(i) + at(i + i32(params.step))) / 3.0; }
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.length) { return; }
  let i = i32(id.x); let n = i32(params.length); let step = i32(params.step); let broad = i32(params.broad);
  let center = local_mean(i); let left_rise = center - local_mean(i - 4 * step); let right_rise = center - local_mean(i + 4 * step);
  let bridge_valid = i >= 5 * step && i + 5 * step < n;
  let u_valid = i >= broad + step && i + broad + step < n;
  let k = id.x * 8u;
  output[k] = select(0.0, clamp((at(i) - params.floor - 6.0) / 24.0, 0.0, 1.0), i > 0 && i + 1 < n && at(i) > at(i - 1) && at(i) >= at(i + 1));
  output[k + 1u] = select(0.0, clamp(min(left_rise, right_rise) / 12.0, 0.0, 1.0), bridge_valid);
  output[k + 2u] = select(0.0, clamp(min(local_mean(i - broad) - center, local_mean(i + broad) - center) / 12.0, 0.0, 1.0), u_valid);
  output[k + 3u] = select(clamp(max(select(0.0, left_rise, i >= 5 * step), select(0.0, right_rise, i + 5 * step < n)) / 12.0, 0.0, 1.0), 0.0, bridge_valid);
  output[k + 4u] = center - params.floor;
  output[k + 5u] = clamp((at(i) - params.floor) / 24.0, 0.0, 1.0);
  output[k + 6u] = select(0.0, 1.0, bridge_valid);
  output[k + 7u] = select(0.0, 1.0, u_valid);
}
