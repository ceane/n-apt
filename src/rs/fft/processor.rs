use crate::fft::now_millis;
use anyhow::Result;
use rand::Rng;
use rand::SeedableRng;
use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::Arc;

use super::types::*;
use crate::consts::fft::{NUM_SAMPLES, SAMPLE_RATE};

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
  /// FFT algorithm instance (lazy — only needed for correlation / phase / mock paths)
  fft: Option<Arc<dyn rustfft::Fft<f32>>>,
  /// Inverse FFT plan (lazy)
  ifft: Option<Arc<dyn rustfft::Fft<f32>>>,
  /// Cache for FFT plans to avoid recreation on size changes
  fft_plan_cache: std::collections::HashMap<usize, Arc<dyn rustfft::Fft<f32>>>,
  /// Cache for IFFT plans to avoid recreation on size changes
  ifft_plan_cache: std::collections::HashMap<usize, Arc<dyn rustfft::Fft<f32>>>,
  /// Current FFT configuration
  config: EnhancedFFTConfig,
  /// Time counter for mock signal generation
  time: f32,
  /// Random number generator for mock signals
  rng: rand::rngs::StdRng,
  /// Peak hold data (optional)
  fft_hold: Option<Vec<f32>>,
  /// Native SIMD processor for signal processing
  simd_processor: Option<crate::simd::NativeProcessor>,
}

impl Default for FFTProcessor {
  fn default() -> Self {
    Self::new()
  }
}

#[allow(dead_code)]
impl FFTProcessor {
  fn configure_simd_processor(
    simd_proc: &mut crate::simd::NativeProcessor,
    config: &EnhancedFFTConfig,
  ) {
    simd_proc.set_gain(config.gain);
    simd_proc.set_ppm(config.ppm);
    simd_proc.set_window_type(config.window_type);
  }

  fn ensure_fft_plans(&mut self) {
    let fft_size = self.config.fft_size;

    // Check cache first
    if let Some(cached_fft) = self.fft_plan_cache.get(&fft_size) {
      self.fft = Some(Arc::clone(cached_fft));
    } else {
      let mut planner = FftPlanner::<f32>::new();
      let fft_plan = planner.plan_fft_forward(fft_size);
      self.fft_plan_cache.insert(fft_size, Arc::clone(&fft_plan));
      self.fft = Some(fft_plan);
    }

    // Check cache for IFFT
    if let Some(cached_ifft) = self.ifft_plan_cache.get(&fft_size) {
      self.ifft = Some(Arc::clone(cached_ifft));
    } else {
      let mut planner = FftPlanner::<f32>::new();
      let ifft_plan = planner.plan_fft_inverse(fft_size);
      self
        .ifft_plan_cache
        .insert(fft_size, Arc::clone(&ifft_plan));
      self.ifft = Some(ifft_plan);
    }
  }

  fn ensure_simd_processor(&mut self) -> &mut crate::simd::NativeProcessor {
    let config = self.config.clone();
    self.simd_processor.get_or_insert_with(|| {
      let mut simd_proc = crate::simd::NativeProcessor::new(config.fft_size);
      Self::configure_simd_processor(&mut simd_proc, &config);
      simd_proc
    })
  }

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

    Self {
      fft: None,
      ifft: None,
      fft_plan_cache: std::collections::HashMap::new(),
      ifft_plan_cache: std::collections::HashMap::new(),
      config,
      time: 0.0,
      rng: rand::rngs::StdRng::from_entropy(),
      fft_hold: None,
      simd_processor: None,
    }
  }

  /// Create a new FFT processor with runtime-provided defaults.
  ///
  /// This is used by the backend, which treats `signals.yaml` as the single source of truth.
  pub fn new_with_defaults(
    fft_size: usize,
    sample_rate: u32,
    min_db: i32,
    max_db: i32,
  ) -> Self {
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
    Self {
      fft: None,
      ifft: None,
      fft_plan_cache: std::collections::HashMap::new(),
      ifft_plan_cache: std::collections::HashMap::new(),
      config,
      time: 0.0,
      rng: rand::rngs::StdRng::from_entropy(),
      fft_hold: None,
      simd_processor: None,
    }
  }

  /// Update the FFT configuration
  ///
  /// # Arguments
  ///
  /// * `config` - New FFT configuration
  pub fn update_config(&mut self, config: EnhancedFFTConfig) {
    let size_changed = config.fft_size != self.config.fft_size;
    self.config = config.clone();

    if size_changed {
      // Invalidate plans — they will be recreated lazily on next use
      self.fft = None;
      self.ifft = None;
      self.simd_processor = None;
      self.fft_hold = None;
    }

    // Update processor settings
    if let Some(ref mut simd_proc) = self.simd_processor {
      Self::configure_simd_processor(simd_proc, &config);
    }
  }

  /// Enable/disable FFT hold (peak hold functionality)
  pub fn set_fft_hold(&mut self, enabled: bool) {
    if !enabled {
      self.fft_hold = None;
    }
  }

  pub fn simd_processor_mut(
    &mut self,
  ) -> Option<&mut crate::simd::NativeProcessor> {
    self.simd_processor.as_mut()
  }

  /// Process raw samples into FFT result with SDR++ style enhancements
  ///
  /// This function uses native SIMD acceleration.
  /// FFT processing uses GPU compute shaders instead of WASM SIMD.
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
  /// - Native SIMD: 2-4x faster (NEON/SSE)
  pub fn process_samples(&mut self, samples: &RawSamples) -> Result<FFTResult> {
    let fft_size = self.config.fft_size;
    let mut power = vec![0.0; fft_size];
    let simd_result = {
      let simd_proc = self.ensure_simd_processor();
      simd_proc.process_samples(samples, &mut power)
    };
    match simd_result {
      Ok(()) => {
        return self.finalize_spectrum(power, false);
      }
      Err(e) => {
        return Err(anyhow::anyhow!("SIMD processing failed: {}", e));
      }
    }
  }

  /// Common post-processing: zoom, hold, and result construction
  fn finalize_spectrum(
    &mut self,
    power: Vec<f32>,
    is_mock: bool,
  ) -> Result<FFTResult> {
    // Apply zoom if configured (SDR++ style)
    let zoomed_power = if self.config.zoom_width < self.config.fft_size {
      crate::fft::zoom_fft(
        &power,
        self.config.zoom_offset,
        self.config.zoom_width,
        self.config.zoom_width,
      )
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

    Ok(FFTResult {
      power_spectrum: zoomed_power.clone(),
      waterfall: zoomed_power,
      is_mock,
      timestamp: now_millis(),
      phase_spectrum: None,
    })
  }

  /// Process raw I/Q samples and return FFT result with optional phase spectrum
  ///
  /// # Arguments
  ///
  /// * `samples` - Raw I/Q sample data from SDR device
  /// * `include_phase` - Whether to calculate and include phase spectrum
  ///
  /// # Returns
  ///
  /// FFT result with power spectrum and optionally phase spectrum
  pub fn process_samples_with_phase(
    &mut self,
    samples: &RawSamples,
    include_phase: bool,
  ) -> Result<FFTResult> {
    // Get the regular FFT result first
    let mut result = self.process_samples(samples)?;

    // Calculate phase spectrum if requested
    if include_phase {
      result.phase_spectrum =
        Some(self.calculate_phase_spectrum(&samples.data)?);
    }

    Ok(result)
  }

  /// Calculate phase spectrum from raw I/Q samples
  ///
  /// # Arguments
  ///
  /// * `iq_data` - Raw I/Q sample data (u8, offset binary format)
  ///
  /// # Returns
  ///
  /// Phase spectrum in radians (same length as FFT)
  fn calculate_phase_spectrum(&self, iq_data: &[u8]) -> Result<Vec<f32>> {
    let fft_size = self.config.fft_size;
    let mut phase_spectrum = vec![0.0f32; fft_size];

    // Convert I/Q samples to complex numbers
    let mut complex_samples: Vec<Complex<f32>> = Vec::with_capacity(fft_size);

    for chunk in iq_data.chunks_exact(2).take(fft_size) {
      if chunk.len() < 2 {
        break;
      }

      // Convert from offset binary u8 to float (-1.0 to 1.0)
      let i_f = (chunk[0] as f32 - 128.0) / 128.0;
      let q_f = (chunk[1] as f32 - 128.0) / 128.0;

      complex_samples.push(Complex::new(i_f, q_f));
    }

    // Pad with zeros if we don't have enough samples
    while complex_samples.len() < fft_size {
      complex_samples.push(Complex::new(0.0, 0.0));
    }

    // Apply window function
    self.apply_window(&mut complex_samples);

    // Perform FFT
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(fft_size);
    fft.process(&mut complex_samples);

    // Calculate phase for each frequency bin
    for (i, complex_val) in complex_samples.iter().enumerate() {
      phase_spectrum[i] = complex_val.arg();
    }

    Ok(phase_spectrum)
  }

  /// Calculate phase coherence between two phase spectra for stitching validation
  ///
  /// # Arguments
  ///
  /// * `phase1` - First phase spectrum
  /// * `phase2` - Second phase spectrum  
  /// * `overlap_bins` - Number of bins to compare in overlap region
  ///
  /// # Returns
  ///
  /// Phase coherence result with alignment metrics
  pub fn calculate_phase_coherence(
    &self,
    phase1: &[f32],
    phase2: &[f32],
    overlap_bins: usize,
  ) -> PhaseCoherenceResult {
    if phase1.len() != phase2.len() || overlap_bins == 0 {
      return PhaseCoherenceResult {
        phase_diff: 0.0,
        coherence_score: 0.0,
        phase_correction: 0.0,
        is_aligned: false,
      };
    }

    let fft_size = phase1.len();
    let start_bin = fft_size / 2 - overlap_bins / 2;
    let end_bin = start_bin + overlap_bins;

    // Calculate phase differences in overlap region
    let mut phase_diffs = Vec::new();
    for i in start_bin..end_bin.min(fft_size) {
      let diff = phase2[i] - phase1[i];
      // Wrap phase difference to [-π, π]
      let wrapped_diff = ((diff + std::f32::consts::PI)
        % (2.0 * std::f32::consts::PI))
        - std::f32::consts::PI;
      phase_diffs.push(wrapped_diff);
    }

    // Calculate average phase difference
    let avg_phase_diff = if phase_diffs.is_empty() {
      0.0
    } else {
      phase_diffs.iter().sum::<f32>() / phase_diffs.len() as f32
    };

    // Calculate coherence score based on variance of phase differences
    let variance = if phase_diffs.is_empty() {
      0.0
    } else {
      let mean = avg_phase_diff;
      phase_diffs
        .iter()
        .map(|diff| (diff - mean).powi(2))
        .sum::<f32>()
        / phase_diffs.len() as f32
    };

    // Coherence score: lower variance = higher coherence
    let coherence_score = (-variance).exp();

    // Determine if alignment is acceptable (within 30 degrees and good coherence)
    let is_aligned = avg_phase_diff.abs()
      < (30.0 * std::f32::consts::PI / 180.0)
      && coherence_score > 0.7;

    PhaseCoherenceResult {
      phase_diff: avg_phase_diff,
      coherence_score,
      phase_correction: -avg_phase_diff, // Negative to apply correction
      is_aligned,
    }
  }

  /// Apply window function to complex samples (internal helper)
  pub fn apply_window(&self, samples: &mut [Complex<f32>]) {
    match self.config.window_type {
      WindowType::Rectangular => {
        // No windowing
      }
      WindowType::Hanning => {
        let len = samples.len();
        for (i, sample) in samples.iter_mut().enumerate() {
          let window = 0.5
            - 0.5
              * (2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32)
                .cos();
          *sample *= window;
        }
      }
      WindowType::Hamming => {
        let len = samples.len();
        for (i, sample) in samples.iter_mut().enumerate() {
          let window = 0.54
            - 0.46
              * (2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32)
                .cos();
          *sample *= window;
        }
      }
      WindowType::Blackman => {
        let len = samples.len();
        for (i, sample) in samples.iter_mut().enumerate() {
          let phase = 2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32;
          let window = 0.42 - 0.5 * phase.cos() + 0.08 * (2.0 * phase).cos();
          *sample *= window;
        }
      }
      WindowType::Nuttall => {
        let len = samples.len();
        for (i, sample) in samples.iter_mut().enumerate() {
          let phase = 2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32;
          let window = 0.3535533905932738 - 0.4877762677078954 * phase.cos()
            + 0.1455559608136613 * (2.0 * phase).cos()
            - 0.0131142424856482 * (3.0 * phase).cos();
          *sample *= window;
        }
      }
      WindowType::None => {
        // No windowing
      }
    }
  }

  /// Convert raw I/Q samples to complex numbers
  pub fn iq_to_complex(&self, iq_data: &[u8]) -> Vec<Complex<f32>> {
    let mut complex_samples = Vec::with_capacity(iq_data.len() / 2);

    for chunk in iq_data.chunks_exact(2) {
      // Convert from offset binary u8 to float (-1.0 to 1.0)
      let i_f = (chunk[0] as f32 - 128.0) / 128.0;
      let q_f = (chunk[1] as f32 - 128.0) / 128.0;
      complex_samples.push(Complex::new(i_f, q_f));
    }

    complex_samples
  }

  /// Analyze signal quality metrics for correlation strategy selection
  pub fn analyze_signal_quality(&self, iq_data: &[u8]) -> SignalQualityMetrics {
    let complex_samples = self.iq_to_complex(iq_data);
    let sample_rate = self.config.sample_rate as f32;

    // Estimate bandwidth using FFT
    let bandwidth_hz = self.estimate_bandwidth(&complex_samples);

    // Estimate SNR
    let snr_db = self.estimate_snr(&complex_samples);

    // Estimate frequency offset
    let frequency_offset_hz =
      self.estimate_frequency_offset(&complex_samples, sample_rate);

    // Detect modulation types
    let (has_am_modulation, has_angular_modulation) =
      self.detect_modulation_types(&complex_samples);

    // Recommend correlation method based on signal characteristics
    let recommended_method = self.recommend_correlation_method(
      frequency_offset_hz,
      has_am_modulation,
      has_angular_modulation,
    );

    // Recommend window size based on bandwidth
    let recommended_window_size =
      self.recommend_window_size(bandwidth_hz, sample_rate);

    SignalQualityMetrics {
      bandwidth_hz,
      snr_db,
      frequency_offset_hz,
      has_am_modulation,
      has_angular_modulation,
      recommended_method,
      recommended_window_size,
    }
  }

  /// Estimate signal bandwidth using FFT analysis
  fn estimate_bandwidth(&self, samples: &[Complex<f32>]) -> f32 {
    if samples.len() < 64 {
      return 0.0;
    }

    // Perform FFT
    let mut fft_samples = samples.to_vec();
    self.apply_window(&mut fft_samples);

    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(fft_samples.len());
    fft.process(&mut fft_samples);

    // Calculate power spectrum
    let power_spectrum: Vec<f32> = fft_samples
      .iter()
      .map(|c| (c.re * c.re + c.im * c.im).sqrt())
      .collect();

    // Find noise floor (median of lower 25%)
    let mut sorted_power = power_spectrum.clone();
    sorted_power.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let noise_floor_idx = power_spectrum.len() / 4;
    let _noise_floor = if noise_floor_idx < sorted_power.len() {
      sorted_power[noise_floor_idx]
    } else {
      0.0
    };

    // Find -3dB bandwidth points
    let peak_power = power_spectrum.iter().fold(0.0f32, |a, &b| a.max(b));
    let threshold = peak_power * 0.707; // -3dB point

    let mut start_bin = 0;
    let mut end_bin = power_spectrum.len() - 1;

    // Find lower -3dB point
    for (i, &power) in power_spectrum.iter().enumerate() {
      if power > threshold {
        start_bin = i;
        break;
      }
    }

    // Find upper -3dB point
    for (i, &power) in power_spectrum.iter().enumerate().rev() {
      if power > threshold {
        end_bin = i;
        break;
      }
    }

    let bandwidth_bins = (end_bin - start_bin) as f32;
    let sample_rate = self.config.sample_rate as f32;
    let bandwidth_hz =
      bandwidth_bins * sample_rate / power_spectrum.len() as f32;

    bandwidth_hz
  }

  /// Estimate SNR in dB
  fn estimate_snr(&self, samples: &[Complex<f32>]) -> f32 {
    if samples.is_empty() {
      return 0.0;
    }

    // Calculate signal power (average magnitude)
    let signal_power: f32 = samples
      .iter()
      .map(|c| (c.re * c.re + c.im * c.im).sqrt())
      .sum::<f32>()
      / samples.len() as f32;

    // Estimate noise power (variance of imaginary part for noise-like signals)
    let noise_power: f32 =
      samples.iter().map(|c| c.im * c.im).sum::<f32>() / samples.len() as f32;

    if noise_power > 0.001 {
      20.0 * (signal_power / noise_power).log10()
    } else {
      60.0 // Cap at 60dB
    }
  }

  /// Estimate frequency offset using phase progression
  fn estimate_frequency_offset(
    &self,
    samples: &[Complex<f32>],
    sample_rate: f32,
  ) -> f32 {
    if samples.len() < 100 {
      return 0.0;
    }

    // Calculate phase differences between consecutive samples
    let mut phase_diffs = Vec::new();
    for window in samples.windows(2) {
      let phase1 = window[0].arg();
      let phase2 = window[1].arg();
      let mut diff = phase2 - phase1;

      // Wrap to [-π, π]
      while diff > std::f32::consts::PI {
        diff -= 2.0 * std::f32::consts::PI;
      }
      while diff < -std::f32::consts::PI {
        diff += 2.0 * std::f32::consts::PI;
      }

      phase_diffs.push(diff);
    }

    // Average phase difference gives frequency offset
    let avg_phase_diff =
      phase_diffs.iter().sum::<f32>() / phase_diffs.len() as f32;
    let frequency_offset =
      avg_phase_diff * sample_rate / (2.0 * std::f32::consts::PI);

    frequency_offset.abs()
  }

  /// Detect modulation types
  fn detect_modulation_types(&self, samples: &[Complex<f32>]) -> (bool, bool) {
    if samples.len() < 100 {
      return (false, false);
    }

    // Calculate amplitude variations
    let amplitudes: Vec<f32> = samples
      .iter()
      .map(|c| (c.re * c.re + c.im * c.im).sqrt())
      .collect();

    let amplitude_variance = self.calculate_variance(&amplitudes);
    let amplitude_mean =
      amplitudes.iter().sum::<f32>() / amplitudes.len() as f32;
    let amplitude_cv = if amplitude_mean > 0.0 {
      amplitude_variance.sqrt() / amplitude_mean
    } else {
      0.0
    };

    // Calculate phase variations
    let phases: Vec<f32> = samples.iter().map(|c| c.arg()).collect();
    let phase_variance = self.calculate_variance(&phases);

    // Detect AM modulation (coefficient of variation > 0.1)
    let has_am_modulation = amplitude_cv > 0.1;

    // Detect angular modulation (phase variance > 0.1 rad²)
    let has_angular_modulation = phase_variance > 0.1;

    (has_am_modulation, has_angular_modulation)
  }

  /// Calculate variance of a slice
  fn calculate_variance(&self, values: &[f32]) -> f32 {
    if values.is_empty() {
      return 0.0;
    }

    let mean = values.iter().sum::<f32>() / values.len() as f32;
    let variance = values.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>()
      / values.len() as f32;

    variance
  }

  /// Recommend correlation method based on signal characteristics
  fn recommend_correlation_method(
    &self,
    frequency_offset_hz: f32,
    has_am_modulation: bool,
    has_angular_modulation: bool,
  ) -> CorrelationMethod {
    // If frequency offset is large, use robust methods
    if frequency_offset_hz > 1000.0 {
      if has_am_modulation {
        CorrelationMethod::Amplitude
      } else {
        CorrelationMethod::PhaseDifference
      }
    } else if frequency_offset_hz > 100.0 {
      // Moderate offset - prefer robust methods
      CorrelationMethod::PhaseDifference
    } else {
      // Low offset - can use complex correlation for best accuracy
      if has_am_modulation && has_angular_modulation {
        CorrelationMethod::Complex
      } else if has_am_modulation {
        CorrelationMethod::Amplitude
      } else {
        CorrelationMethod::PhaseDifference
      }
    }
  }

  /// Recommend window size based on bandwidth
  fn recommend_window_size(
    &self,
    bandwidth_hz: f32,
    sample_rate: f32,
  ) -> usize {
    // Base window size on bandwidth and sample rate
    // Higher bandwidth allows smaller windows
    if bandwidth_hz > 0.1 * sample_rate {
      // Wideband - use smaller windows (1-5ms)
      (sample_rate * 0.001) as usize // 1ms
    } else if bandwidth_hz > 0.01 * sample_rate {
      // Medium bandwidth - use medium windows (5-10ms)
      (sample_rate * 0.005) as usize // 5ms
    } else {
      // Narrowband - use larger windows (10-50ms)
      (sample_rate * 0.010) as usize // 10ms
    }
  }

  /// Perform comprehensive stitching validation between two I/Q signals
  pub fn validate_stitching(
    &mut self,
    signal1: &[u8],
    signal2: &[u8],
    overlap_samples: usize,
  ) -> Result<StitchingValidationResult> {
    // Analyze signal quality
    let signal_quality = self.analyze_signal_quality(signal1);

    // Perform primary correlation using recommended method
    let primary_correlation = self.correlate_signals(
      signal1,
      signal2,
      overlap_samples,
      signal_quality.recommended_method,
    )?;

    // Perform secondary correlation for cross-validation
    let secondary_correlation =
      if signal_quality.recommended_method != CorrelationMethod::Amplitude {
        Some(self.correlate_signals(
          signal1,
          signal2,
          overlap_samples,
          CorrelationMethod::Amplitude,
        )?)
      } else {
        None
      };

    // Calculate overall quality score
    let overall_quality = self.calculate_overall_quality(
      &primary_correlation,
      &secondary_correlation,
      &signal_quality,
    );

    // Generate recommendation
    let recommendation = self
      .generate_stitching_recommendation(&primary_correlation, &signal_quality);

    Ok(StitchingValidationResult {
      primary_correlation,
      secondary_correlation,
      signal_quality,
      overall_quality,
      recommendation,
    })
  }

  /// Correlate two I/Q signals using specified method
  pub fn correlate_signals(
    &mut self,
    signal1: &[u8],
    signal2: &[u8],
    overlap_samples: usize,
    method: CorrelationMethod,
  ) -> Result<CorrelationResult> {
    let samples1 = self.iq_to_complex(&signal1[..overlap_samples * 2]);
    let samples2 = self.iq_to_complex(&signal2[..overlap_samples * 2]);

    match method {
      CorrelationMethod::Complex => {
        // Prefer FFT-based correlation if signal size matches FFT size
        self.ensure_fft_plans();
        let fft_len = self.fft.as_ref().map_or(0, |f| f.len());
        if samples1.len() == fft_len && samples2.len() == fft_len {
          self.fft_correlation(&samples1, &samples2)
        } else {
          self.complex_correlation(&samples1, &samples2)
        }
      }
      CorrelationMethod::Amplitude => {
        self.amplitude_correlation(&samples1, &samples2)
      }
      CorrelationMethod::Phase => self.phase_correlation(&samples1, &samples2),
      CorrelationMethod::PhaseDifference => {
        self.phase_difference_correlation(&samples1, &samples2)
      }
    }
  }

  /// FFT-based correlation: IFFT(FFT(s₁) · FFT(s₂*))
  fn fft_correlation(
    &mut self,
    signal1: &[Complex<f32>],
    signal2: &[Complex<f32>],
  ) -> Result<CorrelationResult> {
    self.ensure_fft_plans();
    let fft = self
      .fft
      .as_ref()
      .expect("FFT plan must exist after ensure_fft_plans");
    let ifft = self
      .ifft
      .as_ref()
      .expect("IFFT plan must exist after ensure_fft_plans");
    let n = fft.len();
    let mut a = signal1.to_vec();
    let mut b = signal2.to_vec();

    // 1. FFT of both signals
    fft.process(&mut a);
    fft.process(&mut b);

    // 2. Element-wise product: A · B*
    let mut c = Vec::with_capacity(n);
    for i in 0..n {
      c.push(a[i] * b[i].conj());
    }

    // 3. Inverse FFT
    ifft.process(&mut c);

    // 4. Find peak in circular correlation
    let mut best_score = 0.0f32;
    let mut best_lag = 0isize;

    let norm = n as f32;
    let scores: Vec<f32> = c.iter().map(|v| v.norm() / norm).collect();

    for (lag, &score) in scores.iter().enumerate() {
      if score > best_score {
        best_score = score;
        best_lag = lag as isize;
      }
    }

    // Convert lag to range [-n/2, n/2]
    if best_lag > (n / 2) as isize {
      best_lag -= n as isize;
    }

    let sample_rate = self.config.sample_rate as f64;
    let (fractional_offset, interpolated_score) = if best_lag.abs()
      < (n / 2) as isize
    {
      // Use parabolic interpolation
      let y_mid = best_score;
      let prev_idx = if best_lag <= -(n as isize / 2) + 1 {
        n - 1
      } else {
        ((best_lag - 1 + n as isize) as usize) % n
      };
      let next_idx = ((best_lag + 1 + n as isize) as usize) % n;

      self.estimate_fractional_delay(scores[prev_idx], y_mid, scores[next_idx])
    } else {
      (0.0, best_score)
    };

    Ok(CorrelationResult {
      correlation_score: interpolated_score,
      time_delay_samples: best_lag,
      time_delay_seconds: (best_lag as f64 + fractional_offset as f64)
        / sample_rate,
      fractional_delay_samples: fractional_offset,
      method: CorrelationMethod::Complex,
      snr_estimate: self.estimate_snr(signal1),
      is_acceptable: interpolated_score > 0.7,
    })
  }

  /// Complex correlation: |∑ s₁(t) · s₂*(t+τ)|
  fn complex_correlation(
    &self,
    signal1: &[Complex<f32>],
    signal2: &[Complex<f32>],
  ) -> Result<CorrelationResult> {
    let max_delay = signal1.len().min(signal2.len()) / 4;
    let mut best_correlation = 0.0f32;
    let mut best_delay = 0isize;

    for delay in 0..=max_delay {
      // Test both positive and negative delays
      for sign in [-1, 1] {
        let actual_delay = sign * delay as isize;
        if sign == -1 && delay == 0 {
          continue;
        } // Avoid double-counting zero delay

        let mut correlation = Complex::new(0.0, 0.0);
        let mut count = 0usize;

        for i in 0..signal1.len() {
          let j = i as isize + actual_delay;
          if j >= 0 && j < signal2.len() as isize {
            let j = j as usize;
            correlation += signal1[i] * signal2[j].conj();
            count += 1;
          }
        }

        if count > 0 {
          let score = correlation.norm() / count as f32;
          if score > best_correlation {
            best_correlation = score;
            best_delay = actual_delay;
          }
        }
      }
    }

    let sample_rate = self.config.sample_rate as f64;

    // Estimate fractional delay using parabolic interpolation
    let (fractional_offset, interpolated_score) =
      if best_delay.abs() > 0 && best_delay.abs() < max_delay as isize {
        // Helper to calculate score at a specific delay
        let calc_score = |d: isize| {
          let mut correlation = Complex::new(0.0, 0.0);
          let mut count = 0usize;
          for i in 0..signal1.len() {
            let j = i as isize + d;
            if j >= 0 && j < signal2.len() as isize {
              let j = j as usize;
              correlation += signal1[i] * signal2[j].conj();
              count += 1;
            }
          }
          if count > 0 {
            correlation.norm() / count as f32
          } else {
            0.0
          }
        };

        let y_prev = calc_score(best_delay - 1);
        let y_mid = best_correlation;
        let y_next = calc_score(best_delay + 1);

        self.estimate_fractional_delay(y_prev, y_mid, y_next)
      } else {
        (0.0f32, best_correlation)
      };

    let time_delay_seconds =
      (best_delay as f64 + fractional_offset as f64) / sample_rate;
    let snr_estimate = self.estimate_snr(signal1);

    Ok(CorrelationResult {
      correlation_score: interpolated_score,
      time_delay_samples: best_delay,
      time_delay_seconds,
      fractional_delay_samples: fractional_offset,
      method: CorrelationMethod::Complex,
      snr_estimate,
      is_acceptable: interpolated_score > 0.7,
    })
  }

  /// Estimate fractional delay component using parabolic interpolation
  fn estimate_fractional_delay(
    &self,
    y_prev: f32,
    y_mid: f32,
    y_next: f32,
  ) -> (f32, f32) {
    if (2.0 * y_mid - y_prev - y_next).abs() < 1e-6 {
      return (0.0, y_mid);
    }

    let offset = 0.5 * (y_prev - y_next) / (y_prev - 2.0 * y_mid + y_next);
    let interpolated_y = y_mid - 0.25 * (y_prev - y_next) * offset;

    (offset, interpolated_y)
  }

  /// Amplitude correlation: ∑ |s₁(t)| · |s₂(t+τ)|
  fn amplitude_correlation(
    &self,
    signal1: &[Complex<f32>],
    signal2: &[Complex<f32>],
  ) -> Result<CorrelationResult> {
    let amplitudes1: Vec<f32> = signal1.iter().map(|c| c.norm()).collect();
    let amplitudes2: Vec<f32> = signal2.iter().map(|c| c.norm()).collect();

    let max_delay = amplitudes1.len().min(amplitudes2.len()) / 4;
    let mut best_correlation = 0.0f32;
    let mut best_delay = 0isize;

    for delay in 0..=max_delay {
      // Test both positive and negative delays
      for sign in [-1, 1] {
        let actual_delay = sign * delay as isize;
        let mut correlation = 0.0f32;
        let mut count = 0usize;

        for i in 0..amplitudes1.len() {
          let j = i as isize + actual_delay;
          if j >= 0 && j < amplitudes2.len() as isize {
            let j = j as usize;
            correlation += amplitudes1[i] * amplitudes2[j];
            count += 1;
          }
        }

        if count > 0 {
          correlation /= count as f32;
          if correlation > best_correlation {
            best_correlation = correlation;
            best_delay = actual_delay;
          }
        }
      }
    }

    let sample_rate = self.config.sample_rate as f64;
    let time_delay_seconds = best_delay as f64 / sample_rate;
    let snr_estimate = self.estimate_snr(signal1);

    Ok(CorrelationResult {
      correlation_score: best_correlation,
      time_delay_samples: best_delay,
      time_delay_seconds,
      fractional_delay_samples: 0.0,
      method: CorrelationMethod::Amplitude,
      snr_estimate,
      is_acceptable: best_correlation > 0.5, // Lower threshold for amplitude
    })
  }

  /// Phase correlation: ∑ ∠s₁(t) · ∠s₂(t+τ)
  fn phase_correlation(
    &self,
    signal1: &[Complex<f32>],
    signal2: &[Complex<f32>],
  ) -> Result<CorrelationResult> {
    let phases1: Vec<f32> = signal1.iter().map(|c| c.arg()).collect();
    let phases2: Vec<f32> = signal2.iter().map(|c| c.arg()).collect();

    let max_delay = phases1.len().min(phases2.len()) / 4;
    let mut best_correlation = 0.0f32;
    let mut best_delay = 0isize;

    for delay in 0..=max_delay {
      // Test both positive and negative delays
      for sign in [-1, 1] {
        let actual_delay = sign * delay as isize;
        let mut correlation = 0.0f32;
        let mut count = 0usize;

        for i in 0..phases1.len() {
          let j = i as isize + actual_delay;
          if j >= 0 && j < phases2.len() as isize {
            let j = j as usize;
            correlation += phases1[i] * phases2[j];
            count += 1;
          }
        }

        if count > 0 {
          correlation /= count as f32;
          if correlation > best_correlation {
            best_correlation = correlation;
            best_delay = actual_delay;
          }
        }
      }
    }

    let sample_rate = self.config.sample_rate as f64;
    let time_delay_seconds = best_delay as f64 / sample_rate;
    let snr_estimate = self.estimate_snr(signal1);

    Ok(CorrelationResult {
      correlation_score: best_correlation,
      time_delay_samples: best_delay,
      time_delay_seconds,
      fractional_delay_samples: 0.0,
      method: CorrelationMethod::Phase,
      snr_estimate,
      is_acceptable: best_correlation > 0.6,
    })
  }

  /// Phase difference correlation: ∑ [∠s₁(t) - ∠s₁(t-1)] · [∠s₂(t+τ) - ∠s₂(t-1+τ)]
  fn phase_difference_correlation(
    &self,
    signal1: &[Complex<f32>],
    signal2: &[Complex<f32>],
  ) -> Result<CorrelationResult> {
    let phases1: Vec<f32> = signal1.iter().map(|c| c.arg()).collect();
    let phases2: Vec<f32> = signal2.iter().map(|c| c.arg()).collect();

    // Calculate phase differences
    let mut phase_diffs1 = Vec::with_capacity(phases1.len() - 1);
    let mut phase_diffs2 = Vec::with_capacity(phases2.len() - 1);

    for i in 1..phases1.len() {
      let mut diff = phases1[i] - phases1[i - 1];
      // Wrap to [-π, π]
      while diff > std::f32::consts::PI {
        diff -= 2.0 * std::f32::consts::PI;
      }
      while diff < -std::f32::consts::PI {
        diff += 2.0 * std::f32::consts::PI;
      }
      phase_diffs1.push(diff);
    }

    for i in 1..phases2.len() {
      let mut diff = phases2[i] - phases2[i - 1];
      // Wrap to [-π, π]
      while diff > std::f32::consts::PI {
        diff -= 2.0 * std::f32::consts::PI;
      }
      while diff < -std::f32::consts::PI {
        diff += 2.0 * std::f32::consts::PI;
      }
      phase_diffs2.push(diff);
    }

    let max_delay = phase_diffs1.len().min(phase_diffs2.len()) / 4;
    let mut best_correlation = 0.0f32;
    let mut best_delay = 0isize;

    for delay in 0..=max_delay {
      // Test both positive and negative delays
      for sign in [-1, 1] {
        let actual_delay = sign * delay as isize;
        let mut correlation = 0.0f32;
        let mut count = 0usize;

        for i in 0..phase_diffs1.len() {
          let j = i as isize + actual_delay;
          if j >= 0 && j < phase_diffs2.len() as isize {
            let j = j as usize;
            correlation += phase_diffs1[i] * phase_diffs2[j];
            count += 1;
          }
        }

        if count > 0 {
          correlation /= count as f32;
          if correlation > best_correlation {
            best_correlation = correlation;
            best_delay = actual_delay;
          }
        }
      }
    }

    let sample_rate = self.config.sample_rate as f64;
    let time_delay_seconds = best_delay as f64 / sample_rate;
    let snr_estimate = self.estimate_snr(signal1);

    Ok(CorrelationResult {
      correlation_score: best_correlation,
      time_delay_samples: best_delay,
      time_delay_seconds,
      fractional_delay_samples: 0.0,
      method: CorrelationMethod::PhaseDifference,
      snr_estimate,
      is_acceptable: best_correlation > 0.4, // Lower threshold due to noise amplification
    })
  }

  /// Calculate overall quality score
  fn calculate_overall_quality(
    &self,
    primary: &CorrelationResult,
    secondary: &Option<CorrelationResult>,
    signal_quality: &SignalQualityMetrics,
  ) -> f32 {
    let primary_score = primary.correlation_score;
    let secondary_score = secondary
      .as_ref()
      .map(|s| s.correlation_score)
      .unwrap_or(0.0);
    let snr_factor = (signal_quality.snr_db / 20.0).min(1.0).max(0.0); // Normalize to 0-1

    // Weighted combination
    0.6 * primary_score + 0.2 * secondary_score + 0.2 * snr_factor
  }

  /// Generate stitching recommendation
  fn generate_stitching_recommendation(
    &self,
    correlation: &CorrelationResult,
    signal_quality: &SignalQualityMetrics,
  ) -> StitchingRecommendation {
    if correlation.correlation_score > 0.5 {
      // Moderate correlation - try correction
      let total_offset_samples = correlation.time_delay_samples as f32
        + correlation.fractional_delay_samples;
      if total_offset_samples.abs() > 0.1 {
        StitchingRecommendation::ApplyTimeCorrection(
          correlation.time_delay_seconds,
        )
      } else {
        StitchingRecommendation::Accept // Negligible delay, accept anyway
      }
    } else if signal_quality.frequency_offset_hz > 1000.0 {
      // High frequency offset - try alternative method
      StitchingRecommendation::UseAlternativeMethod(
        CorrelationMethod::PhaseDifference,
      )
    } else {
      StitchingRecommendation::Reject
    }
  }

  /// Generate mock signal for testing
  pub fn generate_mock_signal(
    &mut self,
    signal_config: Option<MockSignalConfig>,
  ) -> Result<FFTResult> {
    let config = signal_config.unwrap_or_default();
    let mut buf: Vec<Complex<f32>> = Vec::with_capacity(self.config.fft_size);

    for i in 0..self.config.fft_size {
      let t = self.time + i as f32 / self.config.sample_rate as f32;

      // Generate composite signal with multiple frequency components
      let mut signal = 0.0;

      for (freq, amp) in config.frequencies.iter().zip(config.amplitudes.iter())
      {
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
    self.ensure_fft_plans();
    self
      .fft
      .as_ref()
      .expect("FFT plan must exist")
      .process(&mut buf);

    // Calculate power spectrum with proper normalization for true dBFS
    // We normalize by the sum of window coefficients (Coherent Power Gain compensation)
    let mut power = Vec::with_capacity(self.config.fft_size);

    // Calculate window sum for normalization
    let window_sum = match self.config.window_type {
      WindowType::Rectangular => self.config.fft_size as f32,
      WindowType::Hanning => self.config.fft_size as f32 * 0.5,
      WindowType::Hamming => self.config.fft_size as f32 * 0.54,
      WindowType::Blackman => self.config.fft_size as f32 * 0.42,
      WindowType::Nuttall => self.config.fft_size as f32 * 0.355768,
      WindowType::None => self.config.fft_size as f32,
    };

    let norm_sq = window_sum * window_sum;
    let epsilon = 1e-15; // Support down to -150dB

    for c in &buf {
      let mag_sq = c.norm_sqr() / norm_sq;
      // Convert to dB and clamp to reasonable range (-150dB to 0dB)
      let db_value = 10.0 * (mag_sq + epsilon).log10();
      power.push(db_value.clamp(-150.0, 0.0));
    }

    // Shift FFT: Move DC to the center
    let half = self.config.fft_size / 2;
    power.rotate_right(half);

    // Waterfall should also be shifted for consistency
    let waterfall_shifted = power.clone();

    // Apply zoom if configured (SDR++ style)
    let zoomed_power = if self.config.zoom_width < self.config.fft_size {
      crate::fft::zoom_fft(
        &power,
        self.config.zoom_offset,
        self.config.zoom_width,
        self.config.zoom_width,
      )
    } else {
      power.clone()
    };

    Ok(FFTResult {
      power_spectrum: zoomed_power,
      waterfall: waterfall_shifted,
      is_mock: true,
      timestamp: now_millis(),
      phase_spectrum: None,
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
  pub fn extract_frequency_features(
    &self,
    spectrum: &[f32],
  ) -> (Vec<f32>, Vec<f32>, f32, f32, f32, f32) {
    if spectrum.is_empty() {
      return (Vec::new(), Vec::new(), 0.0, 0.0, 0.0, 0.0);
    }

    let magnitude: Vec<f32> = spectrum.iter().map(|&x| x.abs()).collect();
    let count = spectrum.len() as f32;

    // Find dominant frequencies (top 5 peaks)
    let mut indexed_magnitude: Vec<(usize, f32)> =
      magnitude.iter().enumerate().map(|(i, &m)| (i, m)).collect();
    indexed_magnitude.sort_by(|a, b| {
      b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
    });

    let dominant_frequencies: Vec<f32> = indexed_magnitude
      .iter()
      .take(5)
      .map(|(i, _)| *i as f32)
      .collect();

    // Find all significant peaks (above threshold)
    let threshold = magnitude.iter().sum::<f32>() / count * 2.0; // 2x average magnitude
    let frequency_peaks: Vec<f32> = magnitude
      .iter()
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
    // For now, return a simple coherence score
    let phase_coherence = {
      let energy = magnitude.iter().sum::<f32>();
      let peak_energy = magnitude.iter().fold(0.0f32, |a, &b| a.max(b));
      if energy > 0.0 {
        peak_energy / energy
      } else {
        0.0
      }
    };

    // Calculate frequency stability
    let frequency_stability =
      self.calculate_frequency_stability(&dominant_frequencies);

    (
      dominant_frequencies,
      frequency_peaks,
      spectral_rolloff,
      spectral_flux,
      phase_coherence,
      frequency_stability,
    )
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
  pub fn detect_heterodyning_patterns(
    &self,
    spectrum: &[f32],
    sample_rate: u32,
  ) -> (bool, f32, Vec<f32>) {
    let (
      dominant_freqs,
      frequency_peaks,
      spectral_rolloff,
      spectral_flux,
      phase_coherence,
      frequency_stability,
    ) = self.extract_frequency_features(spectrum);

    // Heterodyning indicators
    let has_multiple_carriers = dominant_freqs.len() >= 2;
    let high_peak_count = frequency_peaks.len() > 5;
    let high_coherence = phase_coherence > 0.7;
    let stable_frequencies = frequency_stability > 0.8;
    let significant_flux = spectral_flux > 0.1;
    let significant_rolloff = spectral_rolloff > (spectrum.len() as f32 * 0.7); // Rolloff in upper 30% of spectrum

    // Calculate confidence based on multiple factors
    let mut confidence = 0.0f32;
    if has_multiple_carriers {
      confidence += 0.3;
    }
    if high_peak_count {
      confidence += 0.2;
    }
    if high_coherence {
      confidence += 0.2;
    }
    if stable_frequencies {
      confidence += 0.1;
    }
    if significant_flux {
      confidence += 0.1;
    }
    if significant_rolloff {
      confidence += 0.1;
    }

    confidence = confidence.min(0.95);
    let is_detected = confidence > 0.5;

    // Convert bin indices to actual frequencies
    let carrier_frequencies: Vec<f32> = dominant_freqs
      .iter()
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
  pub fn get_signal_parameters(
    &self,
    spectrum: &[f32],
    sample_rate: u32,
  ) -> (f32, f32, f32, f32, String) {
    if spectrum.is_empty() {
      return (0.0, 0.0, 0.0, 0.0, "unknown".to_string());
    }

    let magnitude: Vec<f32> = spectrum.iter().map(|&x| x.abs()).collect();

    // Basic amplitude and frequency analysis
    let amplitude = magnitude.iter().fold(0.0f32, |a, &b| a.max(b));
    let peak_index = magnitude
      .iter()
      .enumerate()
      .max_by(|(_, a), (_, b)| {
        a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
      })
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
      sorted
        .sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
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
    let variance = spacings
      .iter()
      .map(|&s| (s - mean_spacing).powi(2))
      .sum::<f32>()
      / spacings.len() as f32;
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
    let harmonics: Vec<usize> = magnitude
      .iter()
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
        *sample *= 0.355768 - 0.487396 * two_pi_n.cos()
          + 0.144232 * four_pi_n.cos()
          - 0.012604 * six_pi_n.cos();
      }
    }
    WindowType::Hamming => {
      for (i, sample) in samples.iter_mut().enumerate() {
        *sample *= 0.54
          - 0.46
            * (2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32).cos();
      }
    }
    WindowType::Hanning => {
      for (i, sample) in samples.iter_mut().enumerate() {
        *sample *= 0.5
          - 0.5
            * (2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32).cos();
      }
    }
    WindowType::Blackman => {
      let a0 = 0.42;
      let a1 = -0.5;
      let a2 = 0.08;
      for (i, sample) in samples.iter_mut().enumerate() {
        let phase = 2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32;
        *sample *= a0
          + a1 * phase.cos()
          + a2
            * (4.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32).cos();
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

impl std::fmt::Display for WindowType {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{:?}", self)
  }
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
pub fn find_peak_frequency(
  spectrum: &[f32],
  sample_rate: u32,
  fft_size: usize,
) -> (usize, f32) {
  let max_value = spectrum
    .iter()
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
pub fn detect_peaks(
  spectrum: &[f32],
  threshold: f32,
  min_distance: usize,
) -> Vec<(usize, f32)> {
  let mut peaks = Vec::new();

  for i in 1..spectrum.len() - 1 {
    if spectrum[i] > threshold {
      // Check if this is a local maximum
      let is_peak =
        spectrum[i] > spectrum[i - 1] && spectrum[i] > spectrum[i + 1];

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
pub fn zoom_fft(
  input: &[f32],
  offset: usize,
  width: usize,
  output_size: usize,
) -> Vec<f32> {
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

  #[test]
  fn test_fractional_delay_estimation() {
    let processor = FFTProcessor::new();

    // Test case 1: Exact integer delay
    let (offset1, score1) = processor.estimate_fractional_delay(0.5, 1.0, 0.5);
    assert!((offset1 - 0.0).abs() < 1e-6);
    assert!((score1 - 1.0).abs() < 1e-6);

    // Test case 2: Shifted right by 0.25 samples
    // y = -x^2 + 1, at x=-1.25, -0.25, 0.75
    // But parabolic interpolation assumes y_mid is the peak.
    // If peak is at 0.25:
    // y(x) = -(x-0.25)^2 + 1
    // y(-1) = -(-1.25)^2 + 1 = -0.5625
    // y(0) = -(-0.25)^2 + 1 = 0.9375
    // y(1) = -(0.75)^2 + 1 = 0.4375
    let (offset2, score2) =
      processor.estimate_fractional_delay(-0.5625, 0.9375, 0.4375);
    assert!((offset2 - 0.25).abs() < 0.01);
    assert!((score2 - 1.0).abs() < 0.01);

    // Test case 3: Shifted left by 0.5 samples
    // y(x) = -(x+0.5)^2 + 1
    // y(-1) = -(-0.5)^2 + 1 = 0.75
    // y(0) = -(0.5)^2 + 1 = 0.75
    // y(1) = -(1.5)^2 + 1 = -1.25
    let (offset3, score3) =
      processor.estimate_fractional_delay(0.75, 0.75, -1.25);
    assert!((offset3 - (-0.5)).abs() < 0.01);
    assert!((score3 - 1.0).abs() < 0.01);
  }
}
