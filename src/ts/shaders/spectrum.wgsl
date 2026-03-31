// Spectrum WebGPU shader
@group(0) @binding(0) var<storage, read> waveform: array<f32>;
@group(0) @binding(1) var<uniform> uniforms: array<vec4<f32>, 4>;

fn idx_to_x(idx: i32) -> f32 {
  let len = max(1.0, uniforms[1].z);
  let t = select(0.0, f32(idx) / (len - 1.0), len > 1.0);
  return mix(uniforms[0].x, uniforms[0].z, t);
}

fn value_to_y(value: f32) -> f32 {
  let norm = clamp((value - uniforms[1].x) / (uniforms[1].y - uniforms[1].x), 0.0, 1.0);
  return mix(uniforms[0].y, uniforms[0].w, norm);
}

struct VertexOut {
  @builtin(position) position: vec4<f32>,
}

@vertex
fn vs_line(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let idx = i32(vertex_index);
  let x = idx_to_x(idx);
  let y = value_to_y(waveform[idx]);
  return VertexOut(vec4<f32>(x, y, 0.0, 1.0));
}

@vertex
fn vs_fill(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let idx = i32(vertex_index / 2u);
  let isTop = (vertex_index & 1u) == 0u;
  let x = idx_to_x(idx);
  let y = select(uniforms[0].y, value_to_y(waveform[idx]), isTop);
  return VertexOut(vec4<f32>(x, y, 0.0, 1.0));
}

@fragment
fn fs_line() -> @location(0) vec4<f32> {
  return uniforms[2];
}

@fragment
fn fs_fill() -> @location(0) vec4<f32> {
  return uniforms[3];
}
