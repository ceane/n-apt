/// FFT configuration constants
pub const SAMPLE_RATE: u32 = 3_200_000; // 3.2 MHz
pub const CENTER_FREQ: u32 = 1_600_000; // 1.6 MHz
pub const NUM_SAMPLES: usize = 1024 * 32; // 32768 samples
pub const FFT_FRAME_RATE: u32 = 30; // Target frame rate

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
      gain: 49.6,
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
      frequencies: vec![1000.0, 5000.0, 10000.0], // 1kHz, 5kHz, 10kHz
      amplitudes: vec![0.3, 0.2, 0.1],
      noise_level: 0.1,
    }
  }
}
