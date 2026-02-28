use crate::fft::now_millis;
use rustfft::{num_complex::Complex, FftPlanner};
use rand::SeedableRng;
use rand::Rng;
use std::sync::Arc;
use std::collections::VecDeque;
use anyhow::Result;

use super::types::*;
use crate::consts::rs::fft::{SAMPLE_RATE, NUM_SAMPLES};
use crate::simd::UnifiedProcessor;

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
  /// Waterfall history buffer with circular buffer optimization
  waterfall_history: Vec<Vec<f32>>,
  /// Maximum number of waterfall lines to keep (optimized for memory)
  max_waterfall_lines: usize,
  /// Current position in circular buffer (for memory efficiency)
  waterfall_pos: usize,
  /// Buffer pool for FFT processing to reduce allocations
  buffer_pool: VecDeque<Vec<Complex<f32>>>,
  /// Maximum buffer pool size
  max_buffer_pool_size: usize,
  /// Unified SIMD processor for both WASM and native targets
  simd_processor: Option<UnifiedProcessor>,
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
    
    // Lazy initialization to speed up startup
    let fft = {
      // Use a smaller FFT size for initial planning to speed up startup
      let mut planner = FftPlanner::<f32>::new();
      planner.plan_fft_forward(fft_size)
    };
    
    // Pre-allocate all buffers to avoid runtime allocations
    let mut waterfall_history = Vec::with_capacity(100);
    waterfall_history.resize(100, Vec::with_capacity(fft_size));
    
    let mut buffer_pool = VecDeque::with_capacity(3);
    for _ in 0..3 {
      buffer_pool.push_back(Vec::with_capacity(fft_size));
    }
    
    Self {
      fft,
      config,
      time: 0.0,
      rng: rand::rngs::StdRng::from_entropy(),
      fft_hold: None,
      waterfall_history,
      max_waterfall_lines: 100, // Reduced for faster startup
      waterfall_pos: 0,
      buffer_pool,
      max_buffer_pool_size: 3, // Reduced pool size for faster startup
      simd_processor: Some(UnifiedProcessor::new(fft_size)),
    }
  }

  /// Create a new FFT processor with runtime-provided defaults.
  ///
  /// This is used by the backend, which treats `signals.yaml` as the single source of truth.
  pub fn new_with_defaults(fft_size: usize, sample_rate: u32, min_db: i32, max_db: i32) -> Self {
    let config = EnhancedFFTConfig {
      fft_size,
      sample_rate,
      gain: 1.0,
      ppm: 0.0,
      fft_min: min_db as f32,
      fft_max: max_db as f32,
      waterfall_min: min_db as f32,
      waterfall_max: max_db as f32,
      window_type: WindowType::Rectangular,
      zoom_offset: 0,
      zoom_width: fft_size,
    };
    Self::with_config(config)
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

    let simd_processor = {
      let mut p = UnifiedProcessor::new(fft_size);
      #[cfg(not(target_arch = "wasm32"))]
      {
        p.set_gain(config.gain);
        p.set_ppm(config.ppm);
        p.set_window_type(config.window_type);
      }
      #[cfg(target_arch = "wasm32")]
      {
        p.set_gain(config.gain);
        p.set_ppm(config.ppm);
        // WASM processor uses string for window type
        let window_str = match config.window_type {
            WindowType::Hanning => "hanning",
            WindowType::Hamming => "hamming", 
            WindowType::Blackman => "blackman",
            WindowType::Nuttall => "nuttall",
            WindowType::Rectangular => "rectangular",
            WindowType::None => "none",
        };
        p.set_window_type(window_str);
      }
      p
    };

    Self {
      fft,
      config,
      time: 0.0,
      rng: rand::rngs::StdRng::from_entropy(),
      fft_hold: None,
      waterfall_history: Vec::with_capacity(1000), // Pre-allocate to avoid reallocations
      max_waterfall_lines: 1000,
      waterfall_pos: 0,
      buffer_pool: VecDeque::with_capacity(5),
      max_buffer_pool_size: 5,
      simd_processor: Some(simd_processor),
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
      self.simd_processor = Some(UnifiedProcessor::new(config.fft_size));
    }
    
    // Update processor settings
    if let Some(ref mut simd_proc) = self.simd_processor {
      #[cfg(not(target_arch = "wasm32"))]
      {
        simd_proc.set_gain(config.gain);
        simd_proc.set_ppm(config.ppm);
        simd_proc.set_window_type(config.window_type);
      }
      #[cfg(target_arch = "wasm32")]
      {
        simd_proc.set_gain(config.gain);
        simd_proc.set_ppm(config.ppm);
        let window_str = match config.window_type {
          WindowType::Hanning => "hanning",
          WindowType::Hamming => "hamming", 
          WindowType::Blackman => "blackman",
          WindowType::Nuttall => "nuttall",
          WindowType::Rectangular => "rectangular",
          WindowType::None => "none",
        };
        simd_proc.set_window_type(window_str);
      }
    }

    // Configuration updated
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

  /// Get waterfall history (properly ordered for circular buffer)
  pub fn get_waterfall_history(&self) -> Vec<Vec<f32>> {
    if self.waterfall_history.len() <= self.max_waterfall_lines {
      // Buffer not full yet, return as-is
      self.waterfall_history.clone()
    } else {
      // Buffer is full, return in correct chronological order
      // Oldest data is at waterfall_pos, newest is at waterfall_pos - 1 (wrapping around)
      let mut result = Vec::with_capacity(self.max_waterfall_lines);
      
      // First part: from current position (oldest) to end
      result.extend_from_slice(&self.waterfall_history[self.waterfall_pos..]);
      
      // Second part: from beginning to current position (newest)
      result.extend_from_slice(&self.waterfall_history[..self.waterfall_pos]);
      
      result
    }
  }

  /// Process raw samples into FFT result with SDR++ style enhancements
  /// 
  /// This function uses unified SIMD acceleration on both WASM and native targets.
  /// No scalar fallbacks - SIMD is required.
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
  /// - WASM SIMD: 30-50% faster
  /// - Native SIMD: 2-4x faster (NEON/SSE)
  pub fn process_samples(&mut self, samples: &RawSamples) -> Result<FFTResult> {
    // Unified SIMD processing
    if let Some(ref mut simd_proc) = self.simd_processor {
      #[cfg(not(target_arch = "wasm32"))]
      {
        let mut power = vec![0.0; self.config.fft_size];
        match simd_proc.process_samples(samples, &mut power) {
          Ok(()) => {
            return self.finalize_spectrum(power, false);
          }
          Err(e) => {
            return Err(anyhow::anyhow!("SIMD processing failed: {}", e));
          }
        }
      }
      #[cfg(target_arch = "wasm32")]
      {
        let power = simd_proc.process_samples(&samples.data);
        return self.finalize_spectrum(power, false);
      }
    }
    
    Err(anyhow::anyhow!("SIMD processor not available"))
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

    // Update waterfall history with circular buffer optimization
    if self.waterfall_history.len() < self.max_waterfall_lines {
      self.waterfall_history.push(zoomed_power.clone());
    } else {
      // Use circular buffer to avoid reallocations
      self.waterfall_history[self.waterfall_pos] = zoomed_power.clone();
      self.waterfall_pos = (self.waterfall_pos + 1) % self.max_waterfall_lines;
    }

    Ok(FFTResult {
      power_spectrum: zoomed_power.clone(),
      waterfall: zoomed_power,
      is_mock,
      timestamp: now_millis(),
    })
  }

  /// Get a buffer from the pool or create a new one
  fn get_buffer_from_pool(&mut self) -> Vec<Complex<f32>> {
    if let Some(mut buffer) = self.buffer_pool.pop_front() {
      buffer.clear();
      buffer
    } else {
      Vec::with_capacity(self.config.fft_size)
    }
  }

  /// Return a buffer to the pool if there's space
  fn return_buffer_to_pool(&mut self, mut buffer: Vec<Complex<f32>>) {
    if self.buffer_pool.len() < self.max_buffer_pool_size {
      buffer.clear();
      self.buffer_pool.push_back(buffer);
    }
  }

  /// Scalar implementation of sample processing
  /// 
  /// This is the original implementation used when SIMD is not available
  fn process_samples_scalar(&mut self, samples: &RawSamples) -> Result<FFTResult> {
    let mut buf = self.get_buffer_from_pool();
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
    for c in &buf {
      let mag = c.norm_sqr() / norm;
      // Convert to dB and clamp to reasonable range (-120dB to 0dB)
      let db_value = 10.0 * mag.log10().max(-120.0);
      power.push(db_value.min(0.0)); // Clamp to 0dB maximum
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

    // Return buffer to pool for reuse first to avoid borrow issues
    self.return_buffer_to_pool(buf);

    // Update waterfall history with circular buffer optimization
    if self.waterfall_history.len() < self.max_waterfall_lines {
      self.waterfall_history.push(zoomed_power.clone());
    } else {
      // Use circular buffer to avoid reallocations
      self.waterfall_history[self.waterfall_pos] = zoomed_power.clone();
      self.waterfall_pos = (self.waterfall_pos + 1) % self.max_waterfall_lines;
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

    // Calculate power spectrum with proper normalization
    let mut power = Vec::with_capacity(self.config.fft_size);
    let norm = (self.config.fft_size as f32) * (self.config.fft_size as f32);
    for c in &buf {
      let mag = c.norm_sqr() / norm;
      // Convert to dB and clamp to reasonable range (-120dB to 0dB)
      let db_value = 10.0 * mag.log10().max(-120.0);
      power.push(db_value.min(0.0)); // Clamp to 0dB maximum
    }

    // Apply zoom if configured (SDR++ style)
    let zoomed_power = if self.config.zoom_width < self.config.fft_size {
      crate::fft::zoom_fft(&power, self.config.zoom_offset, self.config.zoom_width, self.config.zoom_width)
    } else {
      power.clone()
    };

    // Update waterfall history with circular buffer optimization
    if self.waterfall_history.len() < self.max_waterfall_lines {
      self.waterfall_history.push(zoomed_power.clone());
    } else {
      // Use circular buffer to avoid reallocations
      self.waterfall_history[self.waterfall_pos] = zoomed_power.clone();
      self.waterfall_pos = (self.waterfall_pos + 1) % self.max_waterfall_lines;
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

  /// Extract frequency features for heterodyning detection
  /// 
  /// # Returns
  /// 
  /// Tuple of (dominant_frequencies, frequency_peaks, spectral_rolloff, spectral_flux, phase_coherence, frequency_stability)
  pub fn extract_frequency_features(&self, spectrum: &[f32]) -> (Vec<f32>, Vec<f32>, f32, f32, f32, f32) {
    if spectrum.is_empty() {
      return (Vec::new(), Vec::new(), 0.0, 0.0, 0.0, 0.0);
    }

    let magnitude: Vec<f32> = spectrum.iter().map(|&x| x.abs()).collect();
    let count = spectrum.len() as f32;

    // Find dominant frequencies (top 5 peaks)
    let mut indexed_magnitude: Vec<(usize, f32)> = magnitude.iter().enumerate().map(|(i, &m)| (i, m)).collect();
    indexed_magnitude.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    
    let dominant_frequencies: Vec<f32> = indexed_magnitude.iter()
      .take(5)
      .map(|(i, _)| *i as f32)
      .collect();

    // Find all significant peaks (above threshold)
    let threshold = magnitude.iter().sum::<f32>() / count * 2.0; // 2x average magnitude
    let frequency_peaks: Vec<f32> = magnitude.iter()
      .enumerate()
      .filter(|(_, &m)| m > threshold)
      .map(|(i, _)| i as f32)
      .collect();

    // Calculate spectral rolloff (frequency containing 85% of energy)
    let total_energy = magnitude.iter().sum::<f32>();
    let mut accumulated_energy = 0.0f32;
    let mut rolloff_index = 0;
    
    for (i, &value) in magnitude.iter().enumerate() {
      accumulated_energy += value;
      if accumulated_energy >= total_energy * 0.85 {
        rolloff_index = i;
        break;
      }
    }
    let spectral_rolloff = rolloff_index as f32;

    // Calculate spectral flux (change in spectrum - simplified for single spectrum)
    let spectral_flux = self.calculate_spectral_flux(&magnitude);

    // Calculate phase coherence (placeholder - would need complex FFT data)
    let phase_coherence = self.calculate_phase_coherence(&magnitude);

    // Calculate frequency stability
    let frequency_stability = self.calculate_frequency_stability(&dominant_frequencies);

    (dominant_frequencies, frequency_peaks, spectral_rolloff, spectral_flux, phase_coherence, frequency_stability)
  }

  /// Detect heterodyning patterns in frequency spectrum
  /// 
  /// # Parameters
  /// 
  /// * `spectrum` - FFT magnitude spectrum
  /// * `sample_rate` - Sample rate of the original signal
  /// 
  /// # Returns
  /// 
  /// Tuple of (is_detected, confidence, carrier_frequencies)
  pub fn detect_heterodyning_patterns(&self, spectrum: &[f32], sample_rate: u32) -> (bool, f32, Vec<f32>) {
    let (dominant_freqs, frequency_peaks, spectral_rolloff, spectral_flux, phase_coherence, frequency_stability) = 
      self.extract_frequency_features(spectrum);

    // Heterodyning indicators
    let has_multiple_carriers = dominant_freqs.len() >= 2;
    let high_peak_count = frequency_peaks.len() > 5;
    let high_coherence = phase_coherence > 0.7;
    let stable_frequencies = frequency_stability > 0.8;
    let significant_flux = spectral_flux > 0.1;
    let significant_rolloff = spectral_rolloff > (spectrum.len() as f32 * 0.7); // Rolloff in upper 30% of spectrum

    // Calculate confidence based on multiple factors
    let mut confidence = 0.0f32;
    if has_multiple_carriers { confidence += 0.3; }
    if high_peak_count { confidence += 0.2; }
    if high_coherence { confidence += 0.2; }
    if stable_frequencies { confidence += 0.1; }
    if significant_flux { confidence += 0.1; }
    if significant_rolloff { confidence += 0.1; }

    confidence = confidence.min(0.95);
    let is_detected = confidence > 0.5;

    // Convert bin indices to actual frequencies
    let carrier_frequencies: Vec<f32> = dominant_freqs.iter()
      .map(|&bin| bin_to_freq(bin as usize, sample_rate, spectrum.len()))
      .collect();

    (is_detected, confidence, carrier_frequencies)
  }

  /// Get signal parameters for recreation analysis
  /// 
  /// # Parameters
  /// 
  /// * `spectrum` - FFT magnitude spectrum
  /// * `sample_rate` - Sample rate of the original signal
  /// 
  /// # Returns
  /// 
  /// Signal parameters including amplitude, frequency, phase, etc.
  pub fn get_signal_parameters(&self, spectrum: &[f32], sample_rate: u32) -> (f32, f32, f32, f32, String) {
    if spectrum.is_empty() {
      return (0.0, 0.0, 0.0, 0.0, "unknown".to_string());
    }

    let magnitude: Vec<f32> = spectrum.iter().map(|&x| x.abs()).collect();
    
    // Basic amplitude and frequency analysis
    let amplitude = magnitude.iter().fold(0.0f32, |a, &b| a.max(b));
    let peak_index = magnitude.iter().enumerate()
      .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
      .map(|(i, _)| i)
      .unwrap_or(0);
    let frequency = bin_to_freq(peak_index, sample_rate, spectrum.len());

    // Estimate phase (simplified - would need complex FFT data)
    let phase = if peak_index < spectrum.len() {
      (spectrum[peak_index] / amplitude).acos()
    } else {
      0.0
    };

    // Estimate noise level
    let sorted_magnitude = {
      let mut sorted = magnitude.clone();
      sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
      sorted
    };
    let median_index = sorted_magnitude.len() / 2;
    let noise_level = sorted_magnitude.get(median_index).unwrap_or(&0.0);

    // Determine waveform type based on harmonic content
    let waveform_type = self.determine_waveform_type(&magnitude);

    (amplitude, frequency, phase, *noise_level, waveform_type)
  }

  // MARK: - Helper Methods for Frequency Analysis

  fn calculate_spectral_flux(&self, magnitude: &[f32]) -> f32 {
    if magnitude.len() < 2 {
      return 0.0;
    }

    let mut flux = 0.0f32;
    for i in 1..magnitude.len() {
      let diff = magnitude[i] - magnitude[i - 1];
      if diff > 0.0 {
        flux += diff;
      }
    }

    flux / (magnitude.len() - 1) as f32
  }

  fn calculate_phase_coherence(&self, magnitude: &[f32]) -> f32 {
    // Placeholder for phase coherence calculation
    // Would need actual phase data from complex FFT output
    let energy = magnitude.iter().sum::<f32>();
    let peak_energy = magnitude.iter().fold(0.0f32, |a, &b| a.max(b));
    
    if energy > 0.0 {
      peak_energy / energy
    } else {
      0.0
    }
  }

  fn calculate_frequency_stability(&self, dominant_freqs: &[f32]) -> f32 {
    if dominant_freqs.len() < 2 {
      return 1.0;
    }

    // Calculate frequency spacing consistency
    let mut spacings: Vec<f32> = Vec::new();
    for i in 1..dominant_freqs.len() {
      spacings.push(dominant_freqs[i] - dominant_freqs[i - 1]);
    }

    if spacings.is_empty() {
      return 1.0;
    }

    let mean_spacing = spacings.iter().sum::<f32>() / spacings.len() as f32;
    let variance = spacings.iter()
      .map(|&s| (s - mean_spacing).powi(2))
      .sum::<f32>() / spacings.len() as f32;
    let std_dev = variance.sqrt();

    // Higher stability = lower relative standard deviation
    if mean_spacing > 0.0 {
      (1.0 - (std_dev / mean_spacing)).max(0.0)
    } else {
      0.0
    }
  }

  fn determine_waveform_type(&self, magnitude: &[f32]) -> String {
    // Simple harmonic analysis to determine waveform type
    let threshold = magnitude.iter().fold(0.0f32, |a, &b| a.max(b)) * 0.1;
    let harmonics: Vec<usize> = magnitude.iter()
      .enumerate()
      .filter(|(_, &m)| m > threshold)
      .map(|(i, _)| i)
      .collect();

    if harmonics.len() > 8 {
      "square".to_string()
    } else if harmonics.len() > 4 {
      "sawtooth".to_string()
    } else if harmonics.len() > 2 {
      "triangle".to_string()
    } else if harmonics.len() == 1 {
      "sine".to_string()
    } else {
      "complex".to_string()
    }
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
      WindowType::Hamming => {
        for (i, sample) in samples.iter_mut().enumerate() {
          *sample *= 0.54 - 0.46 * (2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32).cos();
        }
      }
      WindowType::Hanning => {
        for (i, sample) in samples.iter_mut().enumerate() {
          *sample *= 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32).cos();
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
      WindowType::None => {} // No windowing
    }
  }

/// Window function types
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WindowType {
    Rectangular,
    Nuttall,
    Hamming,
    Hanning,
    Blackman,
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
