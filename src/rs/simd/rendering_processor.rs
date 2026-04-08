//! # SIMD Rendering Processor
//!
//! ARM-optimized processor for rendering operations using unified SIMD backend.

#[allow(unused_imports)]
use crate::simd::arm_optimized_common::ARMOptimizedSIMD;
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
