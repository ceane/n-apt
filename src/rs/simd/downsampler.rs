//! # SIMD Spectrum Downsampling
//!
//! High-performance spectrum downsampling using SIMD operations.
//! Preserves peaks while reducing spectrum size for display.


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
