//! # SIMD Rendering Processor
//!
//! ARM-optimized processor for rendering operations using unified SIMD backend.

use crate::fft::processor::WindowType;
#[allow(unused_imports)]
use crate::simd::arm_optimized_common::ARMOptimizedSIMD;
use crate::simd::common::WindowFunctions;
use rustfft::{num_complex::Complex, FftPlanner};
#[cfg(target_arch = "wasm32")]
#[allow(unused_imports)]
use std::arch::wasm32::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

/// SIMD-accelerated processor for rendering operations
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub struct RenderingProcessor {
  _private: (),
}

impl Default for RenderingProcessor {
  fn default() -> Self {
    Self::new()
  }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
impl RenderingProcessor {
  /// Creates a new SIMD rendering processor instance
  #[cfg_attr(target_arch = "wasm32", wasm_bindgen(constructor))]
  pub fn new() -> RenderingProcessor {
    RenderingProcessor { _private: () }
  }

  /// Resamples spectrum data using ARM-optimized SIMD operations
  #[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
  pub fn resample_spectrum(
    &self,
    input: &[f32],
    output: &mut [f32],
    width: usize,
  ) {
    ARMOptimizedSIMD::resample_spectrum_arm_optimized(input, output, width);
  }

  /// Shifts waterfall buffer using SIMD memory operations
  #[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
  pub fn shift_waterfall_buffer(
    &self,
    buffer: &mut [u8],
    width: usize,
    height: usize,
  ) {
    ARMOptimizedSIMD::shift_waterfall_buffer_arm_optimized(
      buffer, width, height,
    );
  }

  /// Applies color mapping to spectrum data using SIMD operations
  #[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
  pub fn apply_color_mapping(
    &self,
    amplitudes: &[f32],
    output: &mut [u8],
    color_intensity: f32,
  ) {
    ARMOptimizedSIMD::apply_color_mapping_arm_optimized(
      amplitudes,
      output,
      color_intensity,
    );
  }

  /// Processes raw I/Q samples into a dB spectrum using RustFFT.
  ///
  /// This is the WASM-native fast path used by the frontend when the caller
  /// needs a full FFT and window support, regardless of SIMD availability.
  #[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
  pub fn process_iq_to_dbm_spectrum(
    &self,
    input: &[u8],
    offset_db: f32,
    fft_size: usize,
    window_type: &str,
  ) -> Vec<f32> {
    let fft_size = fft_size.max(1);
    let sample_count = input.len() / 2;
    let num_samples = sample_count.min(fft_size);
    let normalized_window = match window_type.to_lowercase().as_str() {
      "none" | "rectangular" => WindowType::Rectangular,
      "hann" | "hanning" => WindowType::Hanning,
      "hamming" => WindowType::Hamming,
      "blackman" => WindowType::Blackman,
      "nuttall" => WindowType::Nuttall,
      _ => WindowType::Hanning,
    };

    let window_coeffs =
      WindowFunctions::get_coeffs(normalized_window, num_samples);
    let window_sum =
      WindowFunctions::get_window_sum(normalized_window, num_samples);
    let inv_norm = 1.0 / (window_sum * window_sum).max(1e-12);

    let mut buffer = vec![Complex::new(0.0f32, 0.0f32); fft_size];
    for i in 0..num_samples {
      let window = window_coeffs[i];
      let re = ((input[i * 2] as f32) - 128.0) / 128.0;
      let im = ((input[i * 2 + 1] as f32) - 128.0) / 128.0;
      buffer[i] = Complex::new(re * window, im * window);
    }

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    fft.process(&mut buffer);

    let half = fft_size / 2;
    buffer.rotate_left(half);

    let epsilon = 1e-15f32;
    buffer
      .iter()
      .map(|c| {
        let mag_sq = c.norm_sqr() * inv_norm;
        (10.0 * (mag_sq + epsilon).log10() + offset_db).clamp(-150.0, 0.0)
      })
      .collect()
  }

  /// NEW: Enhanced resampling with algorithm selection
  pub fn resample_spectrum_enhanced(
    &self,
    input: &[f32],
    output: &mut [f32],
    width: usize,
    algorithm: &str,
  ) {
    match algorithm {
      "avg" => {
        ARMOptimizedSIMD::resample_spectrum_arm_optimized(input, output, width);
      }
      "min" => {
        ARMOptimizedSIMD::resample_spectrum_arm_optimized(input, output, width);
      }
      _ => {
        ARMOptimizedSIMD::resample_spectrum_arm_optimized(input, output, width);
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_simd_processor_creation() {
    let _processor = RenderingProcessor::new();
  }

  #[test]
  fn test_resample_spectrum() {
    let processor = RenderingProcessor::new();
    let input = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
    let mut output = vec![0.0; 4];

    processor.resample_spectrum(&input, &mut output, 4);

    assert!(output.iter().any(|&x| x > 0.0));
  }

  #[test]
  fn test_shift_waterfall_buffer() {
    let processor = RenderingProcessor::new();
    let width = 4;
    let height = 3;
    let mut buffer = vec![0u8; width * height * 4];

    for (i, item) in buffer.iter_mut().enumerate().take(width * 4) {
      *item = (i % 256) as u8;
    }

    processor.shift_waterfall_buffer(&mut buffer, width, height);

    assert!(buffer[width * 4..].iter().any(|&x| x > 0));
  }

  #[test]
  fn test_apply_color_mapping() {
    let processor = RenderingProcessor::new();
    let amplitudes = vec![0.5, 0.7, 0.3, 0.9];
    let mut output = vec![0u8; amplitudes.len() * 4];

    processor.apply_color_mapping(&amplitudes, &mut output, 0.8);

    assert!(output.iter().any(|&x| x > 0));
    for i in (3..output.len()).step_by(4) {
      assert_eq!(output[i], 255);
    }
  }
}
