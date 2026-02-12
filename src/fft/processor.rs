use anyhow::Result;
use crate::fft::now_millis;
use rustfft::{num_complex::Complex, FftPlanner};
use rand::SeedableRng;
use rand::Rng;
use std::sync::Arc;

use super::types::*;
use crate::consts::rs::fft::{SAMPLE_RATE, NUM_SAMPLES};
#[cfg(target_arch = "wasm32")]
use crate::wasm_simd::SIMDFFTProcessor;
#[cfg(not(target_arch = "wasm32"))]
use crate::native_simd::NativeSIMDProcessor;

/**
 * SDR++ style FFT configuration with enhanced parameters
 */
#[derive(Debug, Clone)]
pub struct EnhancedFFTConfig {
    /// FFT size (number of samples)
    pub fft_size: usize,
    /// Sample rate in Hz
    pub sample_rate: u32,
    /// Gain multiplier for input signal
    pub gain: f32,
    /// PPM correction for frequency offset
    pub ppm: f32,
    /// Minimum dB level for FFT display
    pub fft_min: f32,
    /// Maximum dB level for FFT display
    pub fft_max: f32,
    /// Minimum dB level for waterfall display
    pub waterfall_min: f32,
    /// Maximum dB level for waterfall display
    pub waterfall_max: f32,
    /// Window function type for FFT processing
    pub window_type: WindowType,
    /// Zoom offset for spectrum display
    pub zoom_offset: usize,
    /// Zoom width for spectrum display
    pub zoom_width: usize,
}

impl Default for EnhancedFFTConfig {
    fn default() -> Self {
        Self {
            fft_size: NUM_SAMPLES,
            sample_rate: SAMPLE_RATE,
            gain: 1.0,
            ppm: 0.0,
            fft_min: -80.0,
            fft_max: 0.0,
            waterfall_min: -80.0,
            waterfall_max: 0.0,
            window_type: WindowType::Rectangular,
            zoom_offset: 0,
            zoom_width: NUM_SAMPLES,
        }
    }
}

/**
 * Enhanced FFT processor with SDR++ style features and SIMD optimization
 */
pub struct FFTProcessor {
  /// FFT algorithm instance
  fft: Arc<dyn rustfft::Fft<f32>>,
  /// Current FFT configuration
  config: EnhancedFFTConfig,
  /// Time counter for mock signal generation
  time: f32,
  /// Random number generator for mock signals
  rng: rand::rngs::StdRng,
  /// Peak hold data (optional)
  fft_hold: Option<Vec<f32>>,
  /// Waterfall history buffer
  waterfall_history: Vec<Vec<f32>>,
  /// Maximum number of waterfall lines to keep
  max_waterfall_lines: usize,
  /// SIMD processor for WASM targets
  #[cfg(target_arch = "wasm32")]
  simd_processor: Option<SIMDFFTProcessor>,
  /// Native SIMD processor for backend targets
  #[cfg(not(target_arch = "wasm32"))]
  native_simd_processor: Option<NativeSIMDProcessor>,
}

impl Default for FFTProcessor {
    fn default() -> Self {
        Self::new()
    }
}

impl FFTProcessor {
  /// Create a new FFT processor with default configuration
  /// 
  /// # Returns
  /// 
  /// New FFTProcessor with SIMD optimization enabled on WASM targets
  /// 
  /// # Performance
  /// 
  /// - WASM targets: 30-50% faster with SIMD
  /// - Native targets: Standard FFT performance
  pub fn new() -> Self {
    let config = EnhancedFFTConfig::default();
    let fft_size = config.fft_size;
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    
    Self {
      fft,
      config,
      time: 0.0,
      rng: rand::rngs::StdRng::from_entropy(),
      fft_hold: None,
      waterfall_history: Vec::new(),
      max_waterfall_lines: 1000,
      #[cfg(target_arch = "wasm32")]
      simd_processor: Some(SIMDFFTProcessor::new(fft_size)),
      #[cfg(not(target_arch = "wasm32"))]
      native_simd_processor: Some(NativeSIMDProcessor::new(fft_size)),
    }
  }

  /// Create a new FFT processor with custom configuration
  /// 
  /// # Arguments
  /// 
  /// * `config` - FFT configuration parameters
  /// 
  /// # Returns
  /// 
  /// New FFTProcessor with SIMD optimization enabled on WASM targets
  pub fn with_config(config: EnhancedFFTConfig) -> Self {
    let fft_size = config.fft_size;
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);

    #[cfg(target_arch = "wasm32")]
    let simd_processor = {
      let mut p = SIMDFFTProcessor::new(fft_size);
      p.set_gain(config.gain);
      p.set_ppm(config.ppm);
      p.set_window_type(config.window_type);
      Some(p)
    };

    #[cfg(not(target_arch = "wasm32"))]
    let native_simd_processor = {
      let mut p = NativeSIMDProcessor::new(fft_size);
      p.set_gain(config.gain);
      p.set_ppm(config.ppm);
      p.set_window_type(config.window_type);
      Some(p)
    };

    Self {
      fft,
      config,
      time: 0.0,
      rng: rand::rngs::StdRng::from_entropy(),
      fft_hold: None,
      waterfall_history: Vec::new(),
      max_waterfall_lines: 1000,
      #[cfg(target_arch = "wasm32")]
      simd_processor,
      #[cfg(not(target_arch = "wasm32"))]
      native_simd_processor,
    }
  }

  /// Update the FFT configuration
  /// 
  /// # Arguments
  /// 
  /// * `config` - New FFT configuration
  pub fn update_config(&mut self, config: EnhancedFFTConfig) {
    self.config = config.clone();
    // Recreate FFT if size changed
    if config.fft_size != self.fft.len() {
      let mut planner = FftPlanner::<f32>::new();
      self.fft = planner.plan_fft_forward(config.fft_size);
      #[cfg(target_arch = "wasm32")]
      {
        self.simd_processor = Some(SIMDFFTProcessor::new(config.fft_size));
      }
      #[cfg(not(target_arch = "wasm32"))]
      {
        self.native_simd_processor = Some(NativeSIMDProcessor::new(config.fft_size));
      }
    }
    
    #[cfg(target_arch = "wasm32")]
    {
      if let Some(ref mut simd_proc) = self.simd_processor {
        simd_proc.set_gain(config.gain);
        simd_proc.set_ppm(config.ppm);
        simd_proc.set_window_type(config.window_type);
      }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
      if let Some(ref mut native_proc) = self.native_simd_processor {
        native_proc.set_gain(config.gain);
        native_proc.set_ppm(config.ppm);
        native_proc.set_window_type(config.window_type);
      }
    }
  }

  /// Enable/disable FFT hold (peak hold functionality)
  pub fn set_fft_hold(&mut self, enabled: bool) {
    if !enabled {
      self.fft_hold = None;
    }
  }

  /// Clear waterfall history
  pub fn clear_waterfall(&mut self) {
    self.waterfall_history.clear();
  }

  /// Get waterfall history
  pub fn get_waterfall_history(&self) -> &[Vec<f32>] {
    &self.waterfall_history
  }

  /// Process raw samples into FFT result with SDR++ style enhancements
  /// 
  /// This function automatically uses SIMD acceleration on WASM targets
  /// and falls back to scalar processing on other platforms.
  /// 
  /// # Arguments
  /// 
  /// * `samples` - Raw IQ sample data
  /// 
  /// # Returns
  /// 
  /// FFT result with power spectrum data
  /// 
  /// # Performance
  /// 
  /// - WASM with SIMD: 30-50% faster
  /// - Native with SIMD: 2-4x faster (NEON/SSE)
  pub fn process_samples(&mut self, samples: &RawSamples) -> Result<FFTResult> {
    // SIMD processing on WASM builds
    #[cfg(target_arch = "wasm32")]
    {
      if let Some(ref mut simd_proc) = self.simd_processor {
        let mut power = vec![0.0; self.config.fft_size];
        match simd_proc.process_samples_simd(samples, &mut power) {
          Ok(()) => {
            return self.finalize_spectrum(power, false);
          }
          Err(_) => {
            // Fall back to scalar processing if SIMD fails
          }
        }
      }
    }

    // Native SIMD processing on backend builds
    #[cfg(not(target_arch = "wasm32"))]
    {
      if let Some(ref mut native_proc) = self.native_simd_processor {
        let mut power = vec![0.0; self.config.fft_size];
        match native_proc.process_samples(samples, &mut power) {
          Ok(()) => {
            return self.finalize_spectrum(power, false);
          }
          Err(_) => {
            // Fall back to scalar processing if native SIMD fails
          }
        }
      }
    }

    // Scalar processing fallback
    self.process_samples_scalar(samples)
  }

  /// Common post-processing: zoom, hold, waterfall, and result construction
  fn finalize_spectrum(&mut self, power: Vec<f32>, is_mock: bool) -> Result<FFTResult> {
    // Apply zoom if configured (SDR++ style)
    let zoomed_power = if self.config.zoom_width < self.config.fft_size {
      crate::fft::zoom_fft(&power, self.config.zoom_offset, self.config.zoom_width, self.config.zoom_width)
    } else {
      power
    };

    // Update FFT hold (peak hold)
    if let Some(ref mut hold_data) = self.fft_hold {
      for (i, &value) in zoomed_power.iter().enumerate() {
        if i < hold_data.len() {
          hold_data[i] = hold_data[i].max(value);
        }
      }
    } else {
      self.fft_hold = Some(zoomed_power.clone());
    }

    // Update waterfall history
    self.waterfall_history.push(zoomed_power.clone());
    if self.waterfall_history.len() > self.max_waterfall_lines {
      self.waterfall_history.remove(0);
    }

    Ok(FFTResult {
      power_spectrum: zoomed_power.clone(),
      waterfall: zoomed_power,
      is_mock,
      timestamp: now_millis(),
    })
  }

  /// Scalar implementation of sample processing
  /// 
  /// This is the original implementation used when SIMD is not available
  fn process_samples_scalar(&mut self, samples: &RawSamples) -> Result<FFTResult> {
    let mut buf: Vec<Complex<f32>> = Vec::with_capacity(self.config.fft_size);
    let gain_f32 = self.config.gain;
    let ppm_f32 = self.config.ppm;

    // Convert raw bytes to complex numbers and apply corrections
    for i in 0..self.config.fft_size {
      let idx = i * 2;
      if idx + 1 < samples.data.len() {
        // Convert from u8 [0, 255] to f32 [-1.0, 1.0]
        let i_sample = (samples.data[idx] as f32 / 255.0 - 0.5) * 2.0 * gain_f32;
        let q_sample = (samples.data[idx + 1] as f32 / 255.0 - 0.5) * 2.0 * gain_f32;

        // Apply PPM correction
        let phase = 2.0 * std::f32::consts::PI * ppm_f32 * i as f32 / self.config.fft_size as f32;
        let rot = Complex::from_polar(1.0, phase);

        buf.push(Complex::new(i_sample, q_sample) * rot);
      } else {
        buf.push(Complex::new(0.0, 0.0));
      }
    }

    // Apply window function to both real and imaginary parts (SDR++ style)
    if self.config.window_type != WindowType::None {
      let len = buf.len();
      let mut window = vec![1.0f32; len];
      crate::fft::apply_window(&mut window, self.config.window_type);
      for (i, w) in window.iter().enumerate() {
        buf[i].re *= w;
        buf[i].im *= w;
      }
    }

    // Perform FFT
    self.fft.process(&mut buf);

    // Calculate power spectrum with normalization (magnitude, DC at left)
    let norm = (self.config.fft_size as f32) * (self.config.fft_size as f32);
    let mut power = Vec::with_capacity(self.config.fft_size);
    for c in buf {
      let mag = c.norm_sqr() / norm;
      power.push(10.0 * mag.log10().max(-120.0));
    }

    // Apply zoom if configured (SDR++ style)
    let zoomed_power = if self.config.zoom_width < self.config.fft_size {
      crate::fft::zoom_fft(&power, self.config.zoom_offset, self.config.zoom_width, self.config.zoom_width)
    } else {
      power.clone()
    };

    // Update FFT hold (peak hold)
    if let Some(ref mut hold_data) = self.fft_hold {
      for (i, &value) in zoomed_power.iter().enumerate() {
        if i < hold_data.len() {
          hold_data[i] = hold_data[i].max(value);
        }
      }
    } else {
      self.fft_hold = Some(zoomed_power.clone());
    }

    // Update waterfall history
    self.waterfall_history.push(zoomed_power.clone());
    if self.waterfall_history.len() > self.max_waterfall_lines {
      self.waterfall_history.remove(0);
    }

    Ok(FFTResult {
      power_spectrum: zoomed_power.clone(),
      waterfall: zoomed_power,
      is_mock: false,
      timestamp: now_millis(),
    })
  }

  /// Generate mock signal for testing
  pub fn generate_mock_signal(&mut self, signal_config: Option<MockSignalConfig>) -> Result<FFTResult> {
    let config = signal_config.unwrap_or_default();
    let mut buf: Vec<Complex<f32>> = Vec::with_capacity(self.config.fft_size);

    for i in 0..self.config.fft_size {
      let t = self.time + i as f32 / self.config.sample_rate as f32;
      
      // Generate composite signal with multiple frequency components
      let mut signal = 0.0;
      
      for (freq, amp) in config.frequencies.iter().zip(config.amplitudes.iter()) {
        signal += (2.0 * std::f32::consts::PI * freq * t).sin() * amp;
      }
      
      // Add noise
      signal += (self.rng.gen::<f32>() - 0.5) * config.noise_level * 2.0;
      
      // Add some phase variation for realism
      let phase_variation = (2.0 * std::f32::consts::PI * 0.1 * t).sin() * 0.05;
      signal += phase_variation;

      buf.push(Complex::new(signal, signal * 0.5));
    }

    self.time += self.config.fft_size as f32 / self.config.sample_rate as f32;

    // Perform FFT
    self.fft.process(&mut buf);

    // Calculate power spectrum
    let mut power = Vec::with_capacity(self.config.fft_size);
    for c in buf {
      let mag = c.norm_sqr();
      power.push(10.0 * mag.log10().max(-120.0));
    }

    // Apply zoom if configured (SDR++ style)
    let zoomed_power = if self.config.zoom_width < self.config.fft_size {
      crate::fft::zoom_fft(&power, self.config.zoom_offset, self.config.zoom_width, self.config.zoom_width)
    } else {
      power.clone()
    };

    // Update waterfall history
    self.waterfall_history.push(zoomed_power.clone());
    if self.waterfall_history.len() > self.max_waterfall_lines {
      self.waterfall_history.remove(0);
    }

    Ok(FFTResult {
      power_spectrum: zoomed_power,
      waterfall: power,
      is_mock: true,
      timestamp: now_millis(),
    })
  }

  /// Get current configuration
  pub fn config(&self) -> &EnhancedFFTConfig {
    &self.config
  }

  /// Get FFT size
  pub fn fft_size(&self) -> usize {
    self.config.fft_size
  }

  /// Reset time counter (useful for synchronized mock signals)
  pub fn reset_time(&mut self) {
    self.time = 0.0;
  }
}

/// Utility functions for FFT processing
pub mod utils {

/**
 * Convert frequency in Hz to FFT bin index
 * @param freq_hz - Frequency in Hz
 * @param sample_rate - Sample rate in Hz
 * @param fft_size - FFT size (number of bins)
 * @returns FFT bin index
 */
pub fn freq_to_bin(freq_hz: f32, sample_rate: u32, fft_size: usize) -> usize {
    ((freq_hz / sample_rate as f32) * fft_size as f32) as usize
}
}

/// Convert FFT bin index to frequency in Hz
///
/// # Parameters
///
/// * `bin_index`: FFT bin index
/// * `sample_rate`: Sample rate in Hz
/// * `fft_size`: FFT size (number of bins)
///
/// # Returns
///
/// Frequency in Hz
pub fn bin_to_freq(bin_index: usize, sample_rate: u32, fft_size: usize) -> f32 {
    (bin_index as f32 / fft_size as f32) * sample_rate as f32
}

/// Calculate frequency resolution in Hz per bin
/// @param sample_rate - Sample rate in Hz
/// @param fft_size - FFT size (number of bins)
/// @returns Frequency resolution in Hz per bin
pub fn frequency_resolution(sample_rate: u32, fft_size: usize) -> f32 {
    sample_rate as f32 / fft_size as f32
}

/// Apply window function to samples
/// @param samples - Sample array to apply window to
/// @param window_type - Type of window function to apply
pub fn apply_window(samples: &mut [f32], window_type: WindowType) {
    let len = samples.len();
    match window_type {
      WindowType::Hanning => {
        for (i, sample) in samples.iter_mut().enumerate() {
          *sample *= 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32).cos();
        }
      }
      WindowType::Hamming => {
        for (i, sample) in samples.iter_mut().enumerate() {
          *sample *= 0.54 - 0.46 * (2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32).cos();
        }
      }
      WindowType::Blackman => {
        let a0 = 0.42;
        let a1 = -0.5;
        let a2 = 0.08;
        for (i, sample) in samples.iter_mut().enumerate() {
          let phase = 2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32;
          *sample *= a0 + a1 * phase.cos()
            + a2 * (4.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32).cos();
        }
      }
      WindowType::Rectangular => {} // No windowing (same as None)
      WindowType::Nuttall => {
        // Nuttall window: 0.355768 - 0.487396*cos(2πn) + 0.144232*cos(4πn) - 0.012604*cos(6πn)
        for (i, sample) in samples.iter_mut().enumerate() {
          let n = i as f32 / (len - 1) as f32;
          let two_pi_n = 2.0 * std::f32::consts::PI * n;
          let four_pi_n = 4.0 * std::f32::consts::PI * n;
          let six_pi_n = 6.0 * std::f32::consts::PI * n;
          *sample *= 0.355768 - 0.487396 * two_pi_n.cos() + 0.144232 * four_pi_n.cos()
            - 0.012604 * six_pi_n.cos();
        }
      }
      WindowType::None => {} // No windowing
    }
  }

/// Window function types
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WindowType {
    Hanning,
    Hamming,
    Blackman,
    Rectangular,
    Nuttall,
    None,
}

  /// Calculate signal-to-noise ratio in dB
/// @param signal - Signal data array
/// @param noise_floor - Noise floor level
/// @returns SNR in dB
pub fn calculate_snr(signal: &[f32], noise_floor: f32) -> f32 {
    let signal_power: f32 = signal.iter().map(|x| x * x).sum();
    let noise_power = noise_floor * noise_floor * signal.len() as f32;
    
    if noise_power > 0.0 {
      10.0 * (signal_power / noise_power).log10()
    } else {
      f32::INFINITY
    }
  }

/// Find peak frequency in spectrum
/// @param spectrum - Power spectrum data
/// @param sample_rate - Sample rate in Hz
/// @param fft_size - FFT size (number of bins)
/// @returns Tuple of (peak_index, peak_frequency)
pub fn find_peak_frequency(spectrum: &[f32], sample_rate: u32, fft_size: usize) -> (usize, f32) {
    let max_value = spectrum.iter()
      .enumerate()
      .max_by(|(_, &value1), (_, &value2)| value1.total_cmp(&value2))
      .unwrap_or((0, &spectrum[0]));
    
    let peak_freq = bin_to_freq(max_value.0, sample_rate, fft_size);
    (max_value.0, peak_freq)
  }

  /// Detect peaks in spectrum above threshold
/// @param spectrum - Power spectrum data
/// @param threshold - Minimum threshold for peak detection
/// @param min_distance - Minimum distance between peaks
/// @returns Vector of (peak_index, peak_frequency) tuples
pub fn detect_peaks(spectrum: &[f32], threshold: f32, min_distance: usize) -> Vec<(usize, f32)> {
    let mut peaks = Vec::new();
    
    for i in 1..spectrum.len() - 1 {
      if spectrum[i] > threshold {
        // Check if this is a local maximum
        let is_peak = spectrum[i] > spectrum[i - 1] && spectrum[i] > spectrum[i + 1];
        
        if is_peak {
          // Check minimum distance from other peaks
          let valid_distance = peaks.iter().all(|(other_index, _)| {
            (*other_index as isize - i as isize).abs() >= min_distance as isize
          });
          
          if valid_distance {
            let freq = bin_to_freq(i, SAMPLE_RATE, spectrum.len());
            peaks.push((i, freq));
          }
        }
      }
    }
    
    peaks
  }

  /// SDR++ style FFT zoom function
/// @param input - Input FFT data array
/// @param offset - Starting offset for zoom
/// @param width - Width of zoomed region
/// @param output_size - Size of output array
/// @returns Zoomed FFT data array
pub fn zoom_fft(input: &[f32], offset: usize, width: usize, output_size: usize) -> Vec<f32> {
    let mut output = vec![0.0; output_size];
    
    if offset >= input.len() || width == 0 {
      return output;
    }
    
    let actual_width = std::cmp::min(width, input.len() - offset);
    let factor = actual_width as f32 / output_size as f32;
    let s_factor = factor.ceil() as usize;
    
    let mut id = offset as f32;
    for output_item in output.iter_mut().take(output_size) {
      let mut max_val = -f32::INFINITY;
      let s_id = id as usize;
      let u_factor = if s_id + s_factor > input.len() {
        s_factor - ((s_id + s_factor) - input.len())
      } else {
        s_factor
      };
      
      for j in 0..u_factor {
        let idx = s_id + j;
        if idx < input.len() && input[idx] > max_val {
          max_val = input[idx];
        }
      }
      
      *output_item = max_val;
      id += factor;
    }
    
    output
  }

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_fft_processor_creation() {
    let processor = FFTProcessor::new();
    assert_eq!(processor.fft_size(), NUM_SAMPLES);
  }

  #[test]
  fn test_frequency_conversion() {
    let sample_rate = 32000;
    let fft_size = 1024;
    
    let bin = utils::freq_to_bin(8000.0, sample_rate, fft_size);
    assert_eq!(bin, 256);
    
    let freq = bin_to_freq(256, sample_rate, fft_size);
    assert!((freq - 8000.0).abs() < 0.1);
  }

  #[test]
  fn test_mock_signal_generation() {
    let mut processor = FFTProcessor::new();
    let result = processor.generate_mock_signal(None).unwrap();
    
    assert_eq!(result.power_spectrum.len(), NUM_SAMPLES);
    assert!(result.is_mock);
    assert!(result.timestamp > 0);
  }

  #[test]
  fn test_window_functions() {
    let mut samples = vec![1.0; 8];
    
    // Test each window type
    apply_window(&mut samples, WindowType::Hanning);
    assert!(samples.iter().any(|&x| x != 1.0)); // Should be modified
    
    samples = vec![1.0; 8];
    apply_window(&mut samples, WindowType::Rectangular);
    assert!(samples.iter().all(|&x| x == 1.0)); // Should be unchanged
    
    samples = vec![1.0; 8];
    apply_window(&mut samples, WindowType::None);
    assert!(samples.iter().all(|&x| x == 1.0)); // Should be unchanged
    
    samples = vec![1.0; 8];
    apply_window(&mut samples, WindowType::Nuttall);
    assert!(samples.iter().any(|&x| x != 1.0)); // Should be modified
  }
}
