//! # Common SIMD FFT Processor Components
//!
//! Shared traits and functions for SIMD FFT processors.
//! This eliminates code duplication while maintaining platform-specific optimizations.

use crate::fft::types::RawSamples;
use crate::fft::processor::WindowType;
use anyhow::Result;
use rustfft::num_complex::Complex;

/// Common trait for all SIMD FFT processors
pub trait SIMDProcessor {
  /// Creates a new processor with specified FFT size
  fn new(fft_size: usize) -> Self;
  
  /// Sets the gain multiplier for input signal
  fn set_gain(&mut self, gain: f32);
  
  /// Sets the PPM correction for frequency offset
  fn set_ppm(&mut self, ppm: f32);
  
  /// Sets the window function type
  fn set_window_type(&mut self, window_type: WindowType);
  
  /// Process raw IQ samples into a power spectrum
  fn process_samples(&mut self, samples: &RawSamples, output: &mut [f32]) -> Result<()>;
  
  /// Gets the current FFT size
  fn fft_size(&self) -> usize;
}

/// Common window function generators
pub struct WindowFunctions;

impl WindowFunctions {
  /// Create Hanning window coefficients
  pub fn hanning(fft_size: usize) -> Vec<f32> {
    (0..fft_size)
      .map(|i| 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (fft_size - 1) as f32).cos()))
      .collect()
  }

  /// Create Hamming window coefficients
  pub fn hamming(fft_size: usize) -> Vec<f32> {
    (0..fft_size)
      .map(|i| 0.54 - 0.46 * (2.0 * std::f32::consts::PI * i as f32 / (fft_size - 1) as f32).cos())
      .collect()
  }

  /// Create Blackman window coefficients
  pub fn blackman(fft_size: usize) -> Vec<f32> {
    (0..fft_size)
      .map(|i| {
        let i_f = i as f32;
        let n = fft_size as f32;
        0.42 - 0.5 * (2.0 * std::f32::consts::PI * i_f / (n - 1.0)).cos() + 
        0.08 * (4.0 * std::f32::consts::PI * i_f / (n - 1.0)).cos()
      })
      .collect()
  }

  /// Create Nuttall window coefficients
  pub fn nuttall(fft_size: usize) -> Vec<f32> {
    (0..fft_size)
      .map(|i| {
        let i_f = i as f32;
        let n = fft_size as f32;
        0.355768 - 0.487396 * (2.0 * std::f32::consts::PI * i_f / (n - 1.0)).cos() + 
        0.144232 * (4.0 * std::f32::consts::PI * i_f / (n - 1.0)).cos() - 
        0.012604 * (6.0 * std::f32::consts::PI * i_f / (n - 1.0)).cos()
      })
      .collect()
  }

  /// Create rectangular window (all ones)
  pub fn rectangular(fft_size: usize) -> Vec<f32> {
    vec![1.0; fft_size]
  }

  /// Get window coefficients for specified type
  pub fn get_coeffs(window_type: WindowType, fft_size: usize) -> Vec<f32> {
    match window_type {
      WindowType::Hanning => Self::hanning(fft_size),
      WindowType::Hamming => Self::hamming(fft_size),
      WindowType::Blackman => Self::blackman(fft_size),
      WindowType::Nuttall => Self::nuttall(fft_size),
      WindowType::Rectangular | WindowType::None => Self::rectangular(fft_size),
    }
  }
}

/// Common power spectrum calculation utilities
pub struct PowerSpectrum;

impl PowerSpectrum {
  /// Convert complex FFT output to power spectrum in dB
  pub fn to_power_spectrum_db(complex_buffer: &[Complex<f32>], output: &mut [f32]) {
    for (i, &sample) in complex_buffer.iter().enumerate() {
      if i < output.len() {
        let magnitude_sq = sample.re * sample.re + sample.im * sample.im;
        output[i] = 10.0 * (magnitude_sq + 1e-10).log10(); // Convert to dB
      }
    }
  }

  /// Apply gain to power spectrum
  pub fn apply_gain(power_spectrum: &mut [f32], gain: f32) {
    let gain_db = 20.0 * gain.log10();
    for value in power_spectrum.iter_mut() {
      *value += gain_db;
    }
  }

  /// Clamp power spectrum to min/max values
  pub fn clamp(power_spectrum: &mut [f32], min_db: f32, max_db: f32) {
    for value in power_spectrum.iter_mut() {
      *value = value.clamp(min_db, max_db);
    }
  }
}

/// Common spectrum downsampling utilities
pub struct SpectrumDownsampler;

impl SpectrumDownsampler {
  /// Downsample spectrum while preserving peaks using max reduction
  pub fn downsample(input: &[f32], target_size: usize) -> Vec<f32> {
    if target_size >= input.len() {
      return input.to_vec();
    }

    let mut output = vec![0.0f32; target_size];
    let ratio = input.len() as f32 / target_size as f32;
    
    for i in 0..target_size {
      let start = (i as f32 * ratio) as usize;
      let end = ((i + 1) as f32 * ratio) as usize;
      let end = end.min(input.len());
      
      if start >= end {
        continue;
      }
      
      let max_val = input[start..end].iter().fold(-f32::INFINITY, |a, &b| a.max(b));
      output[i] = max_val;
    }
    
    output
  }
}

/// Re-export for backward compatibility
pub fn downsample_spectrum_simd(input: &[f32], target_size: usize) -> Vec<f32> {
  SpectrumDownsampler::downsample(input, target_size)
}

/// Common IQ conversion utilities
pub struct IQConverter;

impl IQConverter {
  /// Convert raw IQ bytes to complex numbers with gain and PPM correction
  pub fn convert_to_complex(
    data: &[u8], 
    gain: f32, 
    ppm: f32, 
    fft_size: usize
  ) -> Result<Vec<Complex<f32>>> {
    let mut buf = Vec::with_capacity(fft_size);
    
    if data.len() < fft_size * 2 {
      return Err(anyhow::anyhow!("Insufficient input samples"));
    }

    let ppm_factor = 1.0 + ppm / 1_000_000.0;
    
    for i in 0..fft_size.min(data.len() / 2) {
      let byte_idx = i * 2;
      if byte_idx + 1 < data.len() {
        let i_val = (data[byte_idx] as i8) as f32 / 128.0 * gain;
        let q_val = (data[byte_idx + 1] as i8) as f32 / 128.0 * gain;
        
        // Apply PPM correction
        let phase = 2.0 * std::f32::consts::PI * ppm_factor * i as f32 / fft_size as f32;
        let cos_phase = phase.cos();
        let sin_phase = phase.sin();
        
        buf.push(Complex::new(
          i_val * cos_phase - q_val * sin_phase,
          i_val * sin_phase + q_val * cos_phase,
        ));
      }
    }
    
    // Pad with zeros if needed
    while buf.len() < fft_size {
      buf.push(Complex::new(0.0, 0.0));
    }
    
    Ok(buf)
  }

  /// Apply window function to complex buffer
  pub fn apply_window(complex_buffer: &mut [Complex<f32>], window_coeffs: &[f32]) {
    for (i, sample) in complex_buffer.iter_mut().enumerate() {
      if i < window_coeffs.len() {
        *sample = Complex::new(
          sample.re * window_coeffs[i],
          sample.im * window_coeffs[i],
        );
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_window_functions() {
    let hanning = WindowFunctions::hanning(1024);
    assert_eq!(hanning.len(), 1024);
    
    let hamming = WindowFunctions::hamming(512);
    assert_eq!(hamming.len(), 512);
    
    let blackman = WindowFunctions::blackman(256);
    assert_eq!(blackman.len(), 256);
    
    let nuttall = WindowFunctions::nuttall(128);
    assert_eq!(nuttall.len(), 128);
  }

  #[test]
  fn test_power_spectrum() {
    let complex_data = vec![
      Complex::new(1.0, 0.0),
      Complex::new(0.0, 1.0),
      Complex::new(-1.0, 0.0),
      Complex::new(0.0, -1.0),
    ];
    
    let mut power = [0.0; 4];
    PowerSpectrum::to_power_spectrum_db(&complex_data, &mut power);
    
    // All should be 0 dB (magnitude = 1.0)
    for &value in &power {
      assert!((value - 0.0).abs() < 1e-6);
    }
  }

  #[test]
  fn test_iq_conversion() {
    let iq_data = vec![127, 0, 0, 127, 129, 0, 0, 129]; // Max positive and negative I/Q values (129 = -127 as u8)
    
    let result = IQConverter::convert_to_complex(&iq_data, 1.0, 0.0, 4).unwrap();
    assert_eq!(result.len(), 4);
    
    // First sample: I=1.0, Q=0.0
    assert!((result[0].re - 1.0).abs() < 1e-6);
    assert!((result[0].im - 0.0).abs() < 1e-6);
  }
}
