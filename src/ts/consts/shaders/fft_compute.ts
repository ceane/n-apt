// Advanced GPU FFT Compute Shaders
// Implements Cooley-Tukey FFT algorithm entirely on GPU

export const FFT_COMPUTE_SHADER = `
// FFT Compute Parameters
struct FFTParams {
  stage: u32,        // Current FFT stage
  direction: i32,    // 1 for forward, -1 for inverse
  input_size: u32,   // Size of input buffer (must be power of 2)
  window_type: u32,  // Window function type
  normalization: f32, // Normalization factor
};

// Window function types
const WINDOW_RECTANGULAR = 0u;
const WINDOW_HANNING = 1u;
const WINDOW_HAMMING = 2u;
const WINDOW_BLACKMAN = 3u;
const WINDOW_NUTTALL = 4u;

// Complex number operations
struct Complex {
  real: f32,
  imag: f32,
};

fn complex_add(a: Complex, b: Complex) -> Complex {
  return Complex(a.real + b.real, a.imag + b.imag);
}

fn complex_sub(a: Complex, b: Complex) -> Complex {
  return Complex(a.real - b.real, a.imag - b.imag);
}

fn complex_mul(a: Complex, b: Complex) -> Complex {
  return Complex(
    a.real * b.real - a.imag * b.imag,
    a.real * b.imag + a.imag * b.real
  );
}

fn complex_conjugate(a: Complex) -> Complex {
  return Complex(a.real, -a.imag);
}

fn complex_magnitude(a: Complex) -> f32 {
  return sqrt(a.real * a.real + a.imag * a.imag);
}

// Custom log10 function using natural log
fn log10(x: f32) -> f32 {
  return log(x) / log(10.0);
}

// Window function generator
fn window_function(index: u32, size: u32, window_type: u32) -> f32 {
  let t = f32(index) / f32(size - 1u);
  
  switch window_type {
    case WINDOW_HANNING: {
      return 0.5 - 0.5 * cos(2.0 * 3.14159265359 * t);
    }
    case WINDOW_HAMMING: {
      return 0.54 - 0.46 * cos(2.0 * 3.14159265359 * t);
    }
    case WINDOW_BLACKMAN: {
      return 0.42 - 0.5 * cos(2.0 * 3.14159265359 * t) + 0.08 * cos(4.0 * 3.14159265359 * t);
    }
    case WINDOW_NUTTALL: {
      return 0.355768 - 0.487396 * cos(2.0 * 3.14159265359 * t) + 
             0.144232 * cos(4.0 * 3.14159265359 * t) - 0.012604 * cos(6.0 * 3.14159265359 * t);
    }
    default: {
      return 1.0; // Rectangular
    }
  }
}

// Twiddle factor generator (complex exponential)
fn twiddle_factor(k: u32, n: u32, direction: i32) -> Complex {
  let angle = -2.0 * 3.14159265359 * f32(k) / f32(n) * f32(direction);
  return Complex(cos(angle), sin(angle));
}

@group(0) @binding(0) var<storage, read_write> input_buffer: array<Complex>;
@group(0) @binding(1) var<storage, read_write> output_buffer: array<Complex>;
@group(0) @binding(2) var<storage, read_write> temp_buffer: array<Complex>;
@group(0) @binding(3) var<uniform> params: FFTParams;

// Butterfly operation for FFT
fn butterfly(a: Complex, b: Complex, twiddle: Complex) -> Complex {
  let twiddled_b = complex_mul(b, twiddle);
  return complex_add(a, twiddled_b);
}

// Main FFT compute shader
@compute @workgroup_size(256)
fn fft_compute(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  
  if (idx >= params.input_size / 2u) {
    return;
  }
  
  let n = params.input_size;
  let stage = params.stage;
  let half_size = 1u << stage;
  let full_size = half_size << 1;
  
  // Calculate butterfly indices
  let group = idx / half_size;
  let butterfly_idx = idx % half_size;
  
  let idx1 = group * full_size + butterfly_idx;
  let idx2 = idx1 + half_size;
  
  // Get input values (from temp buffer for multi-stage computation)
  let a = temp_buffer[idx1];
  let b = temp_buffer[idx2];
  
  // Calculate twiddle factor
  let k = butterfly_idx;
  let twiddle = twiddle_factor(k, full_size, params.direction);
  
  // Perform butterfly operation
  let result1 = complex_add(a, complex_mul(b, twiddle));
  let result2 = complex_sub(a, complex_mul(b, twiddle));
  
  // Store results
  output_buffer[idx1] = result1;
  output_buffer[idx2] = result2;
}

// Windowing and preprocessing shader
@compute @workgroup_size(256)
fn fft_window(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  
  if (idx >= params.input_size) {
    return;
  }
  
  // Convert real input to complex
  let real_input = input_buffer[idx].real;
  let window_val = window_function(idx, params.input_size, params.window_type);
  
  // Apply window function
  let windowed = Complex(real_input * window_val, 0.0);
  
  // Store in temp buffer for FFT stages
  temp_buffer[idx] = windowed;
}

// Power spectrum calculation
@compute @workgroup_size(256)
fn fft_power_spectrum(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  
  if (idx >= params.input_size) {
    return;
  }
  
  let complex_val = input_buffer[idx];
  let magnitude = complex_magnitude(complex_val);
  
  // Convert to dB scale with normalization
  let db_value = 20.0 * log10(max(magnitude / params.normalization, 1e-10));
  
  // Store as real value in output buffer
  output_buffer[idx] = Complex(db_value, 0.0);
}

// FFT averaging and smoothing
@compute @workgroup_size(256)
fn fft_average(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  
  if (idx >= params.input_size) {
    return;
  }
  
  // Exponential moving average
  let alpha = 0.2; // Smoothing factor
  let current = input_buffer[idx].real;
  let previous = temp_buffer[idx].real;
  
  let averaged = alpha * current + (1.0 - alpha) * previous;
  
  output_buffer[idx] = Complex(averaged, 0.0);
}

// FFT smoothing (5-bin moving average)
@compute @workgroup_size(256)
fn fft_smooth(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  
  if (idx >= params.input_size) {
    return;
  }
  
  // 5-bin moving average
  var sum = 0.0;
  var count = 0u;
  
  for (var i = max(0, i32(idx) - 2); i <= min(i32(params.input_size) - 1, i32(idx) + 2); i = i + 1) {
    sum = sum + input_buffer[i].real;
    count = count + 1u;
  }
  
  let smoothed = sum / f32(count);
  output_buffer[idx] = Complex(smoothed, 0.0);
}

// Waterfall color mapping with direct FFT integration
@compute @workgroup_size(256)
fn fft_waterfall_direct(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  
  if (idx >= params.input_size) {
    return;
  }
  
  // Direct access to FFT power spectrum data
  let complex_val = input_buffer[idx];
  let magnitude = complex_magnitude(complex_val);
  
  // Convert to dB scale with normalization
  let db_value = 20.0 * log10(max(magnitude / params.normalization, 1e-10));
  
  // Normalize dB value to [0, 1] for waterfall
  let normalized = clamp((db_value + 120.0) / 120.0, 0.0, 1.0);
  
  // Direct waterfall color mapping (optimized for real-time)
  var color: vec4<f32>;
  
  // Optimized color calculation using conditional moves
  let is_low = normalized < 0.5;
  let t_low = normalized * 2.0;
  let t_high = (normalized - 0.5) * 2.0;
  
  color.r = select(0.0, t_high, is_low);
  color.g = select(t_low, 1.0 - t_high, is_low);
  color.b = select(1.0 - t_low, 0.0, is_low);
  color.a = 1.0;
  
  // Store as RGBA in output buffer for direct waterfall rendering
  output_buffer[idx] = Complex(
    color.r * 255.0 + color.g * 255.0 * 256.0 + color.b * 255.0 * 65536.0,
    color.a * 255.0
  );
}

// Optimized waterfall buffer update
@compute @workgroup_size(256)
fn waterfall_buffer_update(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  let width = params.input_size;
  let line_index = params.stage; // Reuse stage as line index
  
  if (idx >= width) {
    return;
  }
  
  // Read FFT power spectrum directly
  let complex_val = input_buffer[idx];
  let magnitude = complex_magnitude(complex_val);
  let db_value = 20.0 * log10(max(magnitude / params.normalization, 1e-10));
  
  // Normalize and apply color mapping
  let normalized = clamp((db_value + 120.0) / 120.0, 0.0, 1.0);
  
  // Fast color calculation using bit manipulation for performance
  let color_int = u32(normalized * 255.0);
  
  // Store in waterfall texture format (single float packing)
  output_buffer[idx] = Complex(f32(color_int), f32(line_index));
}

// Frequency domain filtering
@compute @workgroup_size(256)
fn fft_filter(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  
  if (idx >= params.input_size) {
    return;
  }
  
  let frequency = f32(idx) / f32(params.input_size);
  
  // Simple band-pass filter example
  let low_freq = 0.1;
  let high_freq = 0.4;
  
  var filter_gain: f32 = 0.0;
  
  if (frequency >= low_freq && frequency <= high_freq) {
    filter_gain = 1.0; // Pass band
  } else {
    filter_gain = 0.0; // Stop band
  }
  
  let filtered = complex_mul(input_buffer[idx], Complex(filter_gain, 0.0));
  output_buffer[idx] = filtered;
}
`;

export const FFT_PIPELINE_SHADER = `
// Multi-stage FFT pipeline orchestrator
@group(0) @binding(0) var<storage, read_write> fft_data: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> temp_data: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> pipeline_params: vec4<u32>;

// Helper to convert vec2 to complex operations
fn vec2_to_complex(v: vec2<f32>) -> Complex {
  return Complex(v.x, v.y);
}

fn complex_to_vec2(c: Complex) -> vec2<f32> {
  return vec2<f32>(c.real, c.imag);
}

@compute @workgroup_size(256)
fn fft_pipeline_stage(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  let n = pipeline_params.x; // FFT size
  let stage = pipeline_params.y; // Current stage
  let direction = i32(pipeline_params.z); // Direction
  
  if (idx >= n / 2u) {
    return;
  }
  
  let half_size = 1u << stage;
  let full_size = half_size << 1;
  
  let group = idx / half_size;
  let butterfly_idx = idx % half_size;
  
  let idx1 = group * full_size + butterfly_idx;
  let idx2 = idx1 + half_size;
  
  // Load complex values
  let a = vec2_to_complex(temp_data[idx1]);
  let b = vec2_to_complex(temp_data[idx2]);
  
  // Twiddle factor
  let k = butterfly_idx;
  let angle = -2.0 * 3.14159265359 * f32(k) / f32(full_size) * f32(direction);
  let twiddle = Complex(cos(angle), sin(angle));
  
  // Butterfly operation
  let result1 = complex_add(a, complex_mul(b, twiddle));
  let result2 = complex_sub(a, complex_mul(b, twiddle));
  
  // Store results
  fft_data[idx1] = complex_to_vec2(result1);
  fft_data[idx2] = complex_to_vec2(result2);
}

// Bit-reversal permutation for FFT input/output
@compute @workgroup_size(256)
fn fft_bit_reverse(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  let n = pipeline_params.x;
  
  if (idx >= n) {
    return;
  }
  
  // Bit reversal algorithm
  var reversed: u32 = 0u;
  var temp = idx;
  let log2n = 32u - clz(n - 1u); // log2 of n
  
  for (var i: u32 = 0u; i < log2n; i = i + 1u) {
    reversed = (reversed << 1u) | (temp & 1u);
    temp = temp >> 1u;
  }
  
  if (reversed < n) {
    let temp_val = fft_data[idx];
    fft_data[idx] = fft_data[reversed];
    fft_data[reversed] = temp_val;
  }
}
`;
