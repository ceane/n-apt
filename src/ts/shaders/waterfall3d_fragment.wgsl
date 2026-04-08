@fragment
fn main(@location(0) color: vec3<f32>, @location(1) depth: f32) -> @location(0) vec4<f32> {
  // Apply depth-based fading for waterfall effect
  let depthFade = 1.0 - abs(depth) * 0.4; // Fade with depth
  let finalColor = color * depthFade;
  
  return vec4<f32>(finalColor, 1.0);
}
