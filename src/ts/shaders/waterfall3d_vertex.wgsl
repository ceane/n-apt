struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) depth: f32,
};

@group(0) @binding(0) var<uniform> resolution: vec2<f32>;
@group(0) @binding(1) var<uniform> time: f32;
@group(0) @binding(2) var<uniform> frequencyRange: vec2<f32>;
@group(0) @binding(3) var<uniform> fftParams: vec4<f32>; // minDb, maxDb, frameCount, frameSpacing

@vertex
fn main(@location(0) position: vec2<f32>, @location(1) intensity: f32, @location(2) frameIndex: f32) -> VertexOutput {
  var output: VertexOutput;
  
  // Normalize position to screen coordinates
  let normalizedX = (position.x - frequencyRange.x) / (frequencyRange.y - frequencyRange.x);
  let screenX = (normalizedX * 2.0 - 1.0) * resolution.x / resolution.y;
  
  // Calculate 3D depth position based on frame index
  let maxFrames = fftParams.z;
  let frameSpacing = fftParams.w;
  let depthZ = (frameIndex / maxFrames) * 2.0 - 1.0; // -1 to 1 range
  
  // Create 3D perspective effect
  let perspectiveFactor = 1.0 + depthZ * 0.3; // Subtle 3D perspective
  let screenY = ((intensity - fftParams.x) / (fftParams.y - fftParams.x)) * 2.0 - 1.0;
  let perspectiveY = screenY * perspectiveFactor;
  
  // Apply frame spacing for waterfall effect
  let spacedY = perspectiveY + (frameIndex * frameSpacing);
  
  output.position = vec4<f32>(screenX, spacedY, depthZ * 0.5 + 0.5, 1.0);
  
  // Color based on intensity and depth
  let intensityNorm = (intensity - fftParams.x) / (fftParams.y - fftParams.x);
  let depthNorm = frameIndex / maxFrames;
  
  // Create gradient from hot (near) to cool (far)
  let nearColor = vec3<f32>(1.0, 0.3, 0.1); // Hot orange/red
  let farColor = vec3<f32>(0.1, 0.3, 1.0);  // Cool blue
  let depthColor = mix(nearColor, farColor, depthNorm);
  
  // Modulate by intensity
  output.color = depthColor * intensityNorm;
  output.depth = depthZ;
  
  return output;
}
