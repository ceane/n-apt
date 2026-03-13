use crate::consts::fft::{NUM_SAMPLES, SAMPLE_RATE};

/// FFT processing result containing both waveform and waterfall data
#[derive(Debug, Clone)]
pub struct FFTResult {
  /// Power spectrum data (log scale, dB)
  pub power_spectrum: Vec<f32>,
  /// Waterfall data (same as power_spectrum for now)
  pub waterfall: Vec<f32>,
  /// Whether this is mock data
  pub is_mock: bool,
  /// Timestamp of the processing
  pub timestamp: i64,
  /// Phase data from I/Q samples (radians, same length as spectrum)
  pub phase_spectrum: Option<Vec<f32>>,
}

/// Phase coherence result for stitching validation
#[derive(Debug, Clone)]
pub struct PhaseCoherenceResult {
  /// Average phase difference between overlapping regions (radians)
  pub phase_diff: f32,
  /// Phase coherence score (0-1, higher is better)
  pub coherence_score: f32,
  /// Recommended phase correction (radians)
  pub phase_correction: f32,
  /// Whether phase alignment is acceptable
  pub is_aligned: bool,
}

/// Correlation result for stitching validation
#[derive(Debug, Clone)]
pub struct CorrelationResult {
  /// Correlation score (-1 to 1, higher is better)
  pub correlation_score: f32,
  /// Time delay in samples (peak position)
  pub time_delay_samples: isize,
  /// Time delay in seconds
  pub time_delay_seconds: f64,
  /// Fractional delay in samples
  pub fractional_delay_samples: f32,
  /// Correlation method used
  pub method: CorrelationMethod,
  /// Signal-to-noise ratio estimate
  pub snr_estimate: f32,
  /// Whether correlation is acceptable
  pub is_acceptable: bool,
}

/// Correlation methods for stitching validation
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CorrelationMethod {
  /// Complex correlation: |∑ s₁(t) · s₂*(t+τ)|
  Complex,
  /// Amplitude correlation: ∑ |s₁(t)| · |s₂(t+τ)|
  Amplitude,
  /// Phase correlation: ∑ ∠s₁(t) · ∠s₂(t+τ)
  Phase,
  /// Phase difference correlation: ∑ [∠s₁(t) - ∠s₁(t-1)] · [∠s₂(t+τ) - ∠s₂(t-1+τ)]
  PhaseDifference,
}

/// Signal quality metrics for correlation strategy selection
#[derive(Debug, Clone)]
pub struct SignalQualityMetrics {
  /// Estimated bandwidth of signal (Hz)
  pub bandwidth_hz: f32,
  /// Signal-to-noise ratio estimate (dB)
  pub snr_db: f32,
  /// Estimated frequency offset (Hz)
  pub frequency_offset_hz: f32,
  /// Whether signal has amplitude modulation
  pub has_am_modulation: bool,
  /// Whether signal has angular modulation
  pub has_angular_modulation: bool,
  /// Recommended correlation method
  pub recommended_method: CorrelationMethod,
  /// Recommended window size (samples)
  pub recommended_window_size: usize,
}

/// Comprehensive stitching validation result
#[derive(Debug, Clone)]
pub struct StitchingValidationResult {
  /// Primary correlation result
  pub primary_correlation: CorrelationResult,
  /// Secondary correlation result (for cross-validation)
  pub secondary_correlation: Option<CorrelationResult>,
  /// Signal quality metrics
  pub signal_quality: SignalQualityMetrics,
  /// Overall stitching quality score (0-1)
  pub overall_quality: f32,
  /// Recommended action
  pub recommendation: StitchingRecommendation,
}

/// Recommended action for stitching
#[derive(Debug, Clone, PartialEq)]
pub enum StitchingRecommendation {
  /// Stitching is good, proceed
  Accept,
  /// Apply phase correction then stitch
  ApplyPhaseCorrection(f32),
  /// Apply time correction then stitch
  ApplyTimeCorrection(f64),
  /// Apply gain normalization (dB)
  ApplyGainNormalization(f32),
  /// Apply spectral flattening (vector of per-bin gain)
  ApplySpectralFlattening(Vec<f32>),
  /// Reject and recapture
  Reject,
  /// Use alternative method
  UseAlternativeMethod(CorrelationMethod),
}

/// Sample data from RTL-SDR device
#[derive(Debug)]
pub struct RawSamples {
  /// Raw IQ sample data
  pub data: Vec<u8>,
  /// Sample rate used for capture
  pub sample_rate: u32,
}

/// FFT processing configuration
#[derive(Debug, Clone)]
pub struct FFTConfig {
  /// FFT size (number of samples)
  pub fft_size: usize,
  /// Gain applied to samples
  pub gain: f32,
  /// PPM correction factor
  pub ppm: f32,
  /// Sample rate
  pub sample_rate: u32,
}

impl Default for FFTConfig {
  fn default() -> Self {
    Self {
      fft_size: NUM_SAMPLES,
      gain: 49.0,
      ppm: 1.0,
      sample_rate: SAMPLE_RATE,
    }
  }
}

/// Mock signal generation configuration
#[derive(Debug, Clone)]
pub struct MockSignalConfig {
  /// Base frequency components (Hz)
  pub frequencies: Vec<f32>,
  /// Amplitudes for each frequency
  pub amplitudes: Vec<f32>,
  /// Noise level
  pub noise_level: f32,
}

impl Default for MockSignalConfig {
  fn default() -> Self {
    Self {
      frequencies: vec![100000.0, 500000.0, 1000000.0], // 100kHz, 500kHz, 1MHz
      amplitudes: vec![0.3, 0.2, 0.1],
      noise_level: 0.1,
    }
  }
}
