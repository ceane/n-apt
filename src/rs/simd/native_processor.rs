//! # Native SIMD FFT Processor
//!
//! Platform-specific SIMD acceleration for FFT pre/post-processing on native targets.
//! Uses aarch64 NEON or x86_64 SSE intrinsics for vectorized operations.

use crate::fft::processor::WindowType;
use crate::fft::types::RawSamples;
use crate::simd::common::{SIMDProcessor, WindowFunctions};
use anyhow::Result;
use rustfft::FftPlanner;
use std::sync::Arc;

/// Native SIMD-accelerated FFT processor for signal analysis.
pub struct NativeProcessor {
  /// FFT algorithm instance
  fft: Arc<dyn rustfft::Fft<f32>>,
  /// FFT size (number of samples)
  fft_size: usize,
  /// Gain multiplier for input signal
  gain: f32,
  /// PPM correction for frequency offset
  ppm: f32,
  /// Window function type
  window_type: WindowType,
  /// Precomputed window coefficients (avoids recomputation each frame)
  window_cache: Option<Vec<f32>>,
  /// Current sample rate
  sample_rate: u32,
  /// Current center frequency
  center_frequency: u32,

  // Scratch buffers to eliminate allocation on every frame
  complex_buf: Vec<rustfft::num_complex::Complex<f32>>,
  re_buf: Vec<f32>,
  im_buf: Vec<f32>,
}

impl SIMDProcessor for NativeProcessor {
  fn new(fft_size: usize) -> Self {
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);

    Self {
      fft,
      fft_size,
      gain: 1.0,
      ppm: 0.0,
      window_type: WindowType::Hanning,
      window_cache: None,
      sample_rate: 3_200_000,
      center_frequency: 1_600_000,
      complex_buf: vec![rustfft::num_complex::Complex::new(0.0, 0.0); fft_size],
      re_buf: vec![0.0; fft_size],
      im_buf: vec![0.0; fft_size],
    }
  }

  fn set_gain(&mut self, gain: f32) {
    self.gain = gain;
  }

  fn set_ppm(&mut self, ppm: f32) {
    self.ppm = ppm;
  }

  fn set_window_type(&mut self, window_type: WindowType) {
    if self.window_type != window_type {
      self.window_cache = None;
    }
    self.window_type = window_type;
  }

  fn set_sample_rate(&mut self, sample_rate: u32) {
    self.sample_rate = sample_rate;
  }

  fn set_center_frequency(&mut self, center_frequency: u32) {
    self.center_frequency = center_frequency;
  }

  fn process_samples(
    &mut self,
    samples: &RawSamples,
    output: &mut [f32],
  ) -> Result<()> {
    if output.len() < self.fft_size {
      return Err(anyhow::anyhow!("Output buffer too small"));
    }
    if samples.data.len() < self.fft_size * 2 {
      return Err(anyhow::anyhow!("Input buffer too small"));
    }

    let phase_step = 2.0
      * std::f32::consts::PI
      * (self.center_frequency as f32 * self.ppm / 1_000_000.0)
      / self.sample_rate as f32;

    crate::simd::arm_optimized_common::ARMOptimizedSIMD::convert_to_complex_arm_optimized(
      &samples.data,
      &mut self.re_buf,
      &mut self.im_buf,
      self.gain,
      1.0 + (phase_step * self.fft_size as f32 / (2.0 * std::f32::consts::PI)),
      self.fft_size,
    );

    if self.window_type != WindowType::None
      && self.window_type != WindowType::Rectangular
    {
      let window_coeffs = self.get_window_coeffs();
      crate::simd::arm_optimized_common::ARMOptimizedSIMD::apply_window_arm_optimized(
        &mut self.re_buf,
        &mut self.im_buf,
        &window_coeffs,
      );
    }

    for i in 0..self.fft_size {
      self.complex_buf[i].re = self.re_buf[i];
      self.complex_buf[i].im = self.im_buf[i];
    }

    self.fft.process(&mut self.complex_buf);

    for i in 0..self.fft_size {
      self.re_buf[i] = self.complex_buf[i].re;
      self.im_buf[i] = self.complex_buf[i].im;
    }

    let window_sum =
      WindowFunctions::get_window_sum(self.window_type, self.fft_size);
    let inv_norm = 1.0 / (window_sum * window_sum);

    crate::simd::arm_optimized_common::ARMOptimizedSIMD::to_power_spectrum_db_arm_optimized(
      &self.re_buf, &self.im_buf, output, inv_norm,
    );

    let half = self.fft_size / 2;
    output.rotate_right(half);

    Ok(())
  }

  fn fft_size(&self) -> usize {
    self.fft_size
  }
}

impl NativeProcessor {
  /// Creates a new native SIMD FFT processor
  pub fn new(fft_size: usize) -> Self {
    <Self as SIMDProcessor>::new(fft_size)
  }

  /// Sets the gain multiplier for input signal
  pub fn set_gain(&mut self, gain: f32) {
    <Self as SIMDProcessor>::set_gain(self, gain);
  }

  /// Sets the PPM correction for frequency offset
  pub fn set_ppm(&mut self, ppm: f32) {
    <Self as SIMDProcessor>::set_ppm(self, ppm);
  }

  /// Sets the window function type and invalidates the cache
  pub fn set_window_type(&mut self, window_type: WindowType) {
    <Self as SIMDProcessor>::set_window_type(self, window_type);
  }

  pub fn set_sample_rate(&mut self, sample_rate: u32) {
    <Self as SIMDProcessor>::set_sample_rate(self, sample_rate);
  }

  pub fn set_center_frequency(&mut self, center_frequency: u32) {
    <Self as SIMDProcessor>::set_center_frequency(self, center_frequency);
  }

  /// Process raw IQ samples into a power spectrum using SIMD-accelerated operations
  pub fn process_samples(
    &mut self,
    samples: &RawSamples,
    output: &mut [f32],
  ) -> Result<()> {
    <Self as SIMDProcessor>::process_samples(self, samples, output)
  }

  /// Get or compute window coefficients using common function
  fn get_window_coeffs(&mut self) -> Vec<f32> {
    if self.window_cache.is_none() {
      self.window_cache =
        Some(WindowFunctions::get_coeffs(self.window_type, self.fft_size));
    }
    self.window_cache.as_ref().unwrap().clone()
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::fft::types::RawSamples;

  #[test]
  fn test_native_simd_processor_creation() {
    let processor = NativeProcessor::new(1024);
    assert_eq!(processor.fft_size, 1024);
    assert_eq!(processor.gain, 1.0);
    assert_eq!(processor.ppm, 0.0);
  }

  #[test]
  fn test_window_functions() {
    let mut processor = NativeProcessor::new(256);

    processor.set_window_type(WindowType::Hanning);
    assert_eq!(processor.window_type, WindowType::Hanning);

    processor.set_window_type(WindowType::Hamming);
    assert_eq!(processor.window_type, WindowType::Hamming);

    processor.set_gain(2.0);
    assert_eq!(processor.gain, 2.0);

    processor.set_ppm(10.0);
    assert_eq!(processor.ppm, 10.0);
  }

  #[test]
  fn test_native_simd_consistency() {
    // Running the same input twice should produce the same output
    let mut processor = NativeProcessor::new(128);
    processor.set_window_type(WindowType::Hanning);

    let samples = RawSamples {
      data: vec![100u8; 256],
      sample_rate: 32000,
    };

    let mut output1 = vec![0.0f32; 128];
    let mut output2 = vec![0.0f32; 128];

    processor.process_samples(&samples, &mut output1).unwrap();
    processor.process_samples(&samples, &mut output2).unwrap();

    for (a, b) in output1.iter().zip(output2.iter()) {
      assert!((a - b).abs() < 1e-6, "Outputs differ: {} vs {}", a, b);
    }
  }
}
