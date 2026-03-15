// Advanced GPU FFT Compute Shaders
// Implements Cooley-Tukey FFT algorithm entirely on GPU

export const FFT_COMPUTE_SHADER = /* wgsl */`
// FFT Compute Parameters
struct FFTParams {
  stage: u32,        // Current FFT stage
  direction: i32,    // 1 for forward, -1 for inverse
  input_size: u32,   // Size of input buffer (must be power of 2)
  window_type: u32,  // Window function type
  normalization: f32, // Normalization factor
  min_db: f32,       // Minimum dB for waterfall normalization (e.g. -120.0)
  max_db: f32,       // Maximum dB for waterfall normalization (e.g. 0.0)
  waterfall_width: u32, // Width of waterfall texture (capped by hardware)
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
  
  // Normalize dB value to [0, 1] for waterfall using min_db/max_db
  let range = params.max_db - params.min_db;
  let normalized = clamp((db_value - params.min_db) / max(range, 0.001), 0.0, 1.0);
  
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

@compute @workgroup_size(256)
fn waterfall_buffer_update(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  let width = params.input_size;
  let waterfall_width = params.waterfall_width;
  
  if (idx >= waterfall_width) {
    return;
  }
  
  // Downsample if needed (decimation)
  let ratio = width / waterfall_width;
  let input_idx = idx * ratio;
  
  // Read FFT power spectrum directly
  let complex_val = input_buffer[input_idx];
  let magnitude = complex_magnitude(complex_val);
  let db_value = 20.0 * log10(max(magnitude / params.normalization, 1e-10));
  
  // Normalize and apply color mapping using min_db/max_db
  let range = params.max_db - params.min_db;
  let normalized = clamp((db_value - params.min_db) / max(range, 0.001), 0.0, 1.0);
  
  // Map to colors: Blue -> Cyan -> Green -> Yellow -> Red
  var r = 0.0;
  var g = 0.0;
  var b = 0.0;
  
  if (normalized < 0.25) {
    b = normalized * 4.0;
  } else if (normalized < 0.5) {
    g = (normalized - 0.25) * 4.0;
    b = 1.0;
  } else if (normalized < 0.75) {
    r = (normalized - 0.5) * 4.0;
    g = 1.0;
    b = 1.0 - (normalized - 0.5) * 4.0;
  } else {
    r = 1.0;
    g = 1.0 - (normalized - 0.75) * 4.0;
  }

  let color_u32 = (u32(r * 255.0)) | (u32(g * 255.0) << 8u) | (u32(b * 255.0) << 16u) | (255u << 24u);
  
  // Pack 2 pixels per Complex element (8 bytes total, 4 bytes each)
  // real part = pixel N, imag part = pixel N+1
  if (idx % 2u == 0u) {
    output_buffer[idx / 2u].real = bitcast<f32>(color_u32);
  } else {
    output_buffer[idx / 2u].imag = bitcast<f32>(color_u32);
  }
}

fn rtl_sdr_windowed_complex_iq(idx: u32, sample: Complex) -> Complex {
  let window_val = window_function(idx, params.input_size, WINDOW_HANNING);
  return Complex(sample.real * window_val, sample.imag * window_val);
}

fn rtl_sdr_complex_power(sample: Complex) -> f32 {
  return sample.real * sample.real + sample.imag * sample.imag;
}

fn rtl_sdr_approx_dbm(sample: Complex) -> f32 {
  let power = max(rtl_sdr_complex_power(sample), 1e-20);
  let normalized_power = power / params.normalization;
  let window_correction_db = 1.5;
  let reference_offset_db = 13.0;
  return 10.0 * log10(max(normalized_power, 1e-20)) + window_correction_db + reference_offset_db;
}

@compute @workgroup_size(256)
fn rtl_sdr_iq_to_dbm(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;

  if (idx >= params.input_size) {
    return;
  }

  let iq_sample = input_buffer[idx];
  output_buffer[idx] = rtl_sdr_windowed_complex_iq(idx, iq_sample);
}

@compute @workgroup_size(256)
fn rtl_sdr_power_spectrum_dbm(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;

  if (idx >= params.input_size) {
    return;
  }

  let complex_val = input_buffer[idx];
  let dbm = rtl_sdr_approx_dbm(complex_val);
  output_buffer[idx] = Complex(dbm, 0.0);
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

export const FFT_PIPELINE_SHADER = /* wgsl */`
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
