struct SpikeMarker {
  index: u32,
  value: f32,
  score: f32,
  radius: f32,
}

@group(0) @binding(0) var<storage, read> spikes: array<SpikeMarker>;
@group(0) @binding(1) var<uniform> uniforms: array<vec4<f32>, 4>;
@group(0) @binding(2) var<storage, read> spike_count_buffer: array<u32>;
// uniforms:
// [0] = plot bounds (minX, minY, maxX, maxY)
// [1] = (dBmin, dBmax, displayWidth, srcLen)
// [2-3] = colors (line RGBA, fill RGBA)

const MAX_SPIKES: u32 = 1024u;

fn idx_to_x(idx: u32) -> f32 {
  // uniforms[1].w = source waveform length (NOT display width at [1].z)
  // Spike indices are raw waveform positions, so we must normalize against srcLen
  let len = uniforms[1].w;
  let t = f32(idx) / max(1.0, len - 1.0);
  return mix(uniforms[0].x, uniforms[0].z, clamp(t, 0.0, 1.0));
}

fn value_to_y(value: f32) -> f32 {
  let range = uniforms[1].y - uniforms[1].x;
  let norm = clamp((value - uniforms[1].x) / max(1.0, range), 0.0, 1.0);
  return mix(uniforms[0].y, uniforms[0].w, norm);
}

fn marker_radius_ndc() -> f32 {
  return 0.009;
}

fn marker_x_for_peak(peak_x: f32) -> f32 {
  let radius = marker_radius_ndc();
  let plot_left = uniforms[0].x;
  let plot_right = uniforms[0].z;
  return clamp(peak_x, plot_left + radius, plot_right - radius);
}

fn marker_y_for_peak(peak_y: f32) -> f32 {
  let plot_top = uniforms[0].w;
  let hover_gap = 0.045;
  return min(plot_top - marker_radius_ndc() - 0.03, peak_y + hover_gap);
}

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) is_active: u32,
}

// ---------------------------------------------
// Line renderer (draw 2 vertices per instance)
// ---------------------------------------------
@vertex
fn vs_line(@builtin(vertex_index) vertex_index: u32, @builtin(instance_index) instance_index: u32) -> VertexOut {
  let count = spike_count_buffer[0];
  var out: VertexOut;
  
  if (instance_index >= count || instance_index >= MAX_SPIKES) {
    out.is_active = 0u;
    out.position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    return out;
  }
  out.is_active = 1u;
  
  let spike = spikes[instance_index];
  let x = marker_x_for_peak(idx_to_x(spike.index));
  let peak_y = value_to_y(spike.value);
  let marker_y = marker_y_for_peak(peak_y);
  let radius = marker_radius_ndc();
  let line_bottom = peak_y;
  let line_top = marker_y - radius - 0.006;
  
  let current_y = select(line_top, line_bottom, vertex_index == 1u);
  
  out.position = vec4<f32>(x, current_y, 0.0, 1.0);
  out.uv = vec2<f32>(0.0, select(0.0, 1.0, vertex_index == 1u));
  return out;
}

@fragment
fn fs_line(in: VertexOut) -> @location(0) vec4<f32> {
  if (in.is_active == 0u) {
    discard;
  }
  return vec4<f32>(1.0, 0.78, 0.78, 0.72);
}

// ---------------------------------------------
// Circle renderer (draw 6 vertices per instance for quad)
// ---------------------------------------------
@vertex
fn vs_circle(@builtin(vertex_index) vertex_index: u32, @builtin(instance_index) instance_index: u32) -> VertexOut {
  let count = spike_count_buffer[0];
  var out: VertexOut;
  
  if (instance_index >= count || instance_index >= MAX_SPIKES) {
    out.is_active = 0u;
    out.position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    return out;
  }
  out.is_active = 1u;
  
  let spike = spikes[instance_index];
  let x = marker_x_for_peak(idx_to_x(spike.index));
  let y = marker_y_for_peak(value_to_y(spike.value));
  let radius = marker_radius_ndc();
  let rx = radius;
  let ry = radius;
  
  var offset = vec2<f32>(0.0, 0.0);
  if (vertex_index == 0u || vertex_index == 3u) { offset = vec2<f32>(-1.0, -1.0); out.uv = vec2<f32>(-1.0, -1.0); }
  if (vertex_index == 1u) { offset = vec2<f32>( 1.0, -1.0); out.uv = vec2<f32>( 1.0, -1.0); }
  if (vertex_index == 2u || vertex_index == 4u) { offset = vec2<f32>(-1.0,  1.0); out.uv = vec2<f32>(-1.0,  1.0); }
  if (vertex_index == 5u) { offset = vec2<f32>( 1.0,  1.0); out.uv = vec2<f32>( 1.0,  1.0); }
  
  out.position = vec4<f32>(x + offset.x * rx, y + offset.y * ry, 0.0, 1.0);
  return out;
}

@fragment
fn fs_circle(in: VertexOut) -> @location(0) vec4<f32> {
  if (in.is_active == 0u) {
    discard;
  }
  let dist = length(in.uv);
  if (dist > 1.0) {
    discard;
  }
  
  // inner solid, outer glow
  if (dist < 0.6) {
    return vec4<f32>(1.0, 0.33, 0.33, 0.95);
  }
  let alpha = (1.0 - dist) / 0.4;
  return vec4<f32>(1.0, 0.75, 0.75, 0.45 * alpha);
}
