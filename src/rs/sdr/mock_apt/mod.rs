//! Mock APT SDR Device Implementation
//!
//! Provides a simulated SDR device that generates realistic signals for testing and demonstration.
//! Uses bin-based frequency modeling for consistent FFT placement and dynamic signal behavior.
//! Reads configuration from signals.yaml for signal parameters and variation settings.

use crate::fft::types::RawSamples;
use anyhow::Result;
use crossbeam_channel::Receiver;
use rand::rngs::StdRng;
use rand::{RngExt, SeedableRng};
use rayon::prelude::*;
use std::f32::consts::PI;
use std::f64::consts::PI as PI64;
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

use super::SdrDevice;

#[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
mod metal_backend;
#[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
use metal_backend::MockAptMetalBackend;
#[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
use std::sync::OnceLock;

/// Mock APT signal configuration
#[derive(Debug, Clone)]
struct MockAptSignalConfig {
  center_frequency_hz: f64,
  strength_db: f64,
}

/// Mock APT SDR device implementation
pub struct MockAptDevice {
  center_freq: u32,
  sample_rate: u32,
  gain: f64,
  ppm: i32,
  tuner_agc: bool,
  rtl_agc: bool,
  offset_tuning: bool,
  tuner_bandwidth: u32,
  direct_sampling: u8,
  total_samples: u64,
  signals: Vec<MockAptSignal>,
  noise_floor_db: f32,
  rng: StdRng,
  settle_time_samples: u64,
  samples_since_init: u64,
  last_config_reload_check: Instant,
  last_config_modified: Option<SystemTime>,
  last_config_checksum: Option<String>,
  rx_queue: Option<Receiver<Vec<u8>>>,
  async_thread: Option<JoinHandle<()>>,
  iq_overflow: Vec<u8>,
  i_accumulator: Vec<f64>,
  q_accumulator: Vec<f64>,
  byte_buffer: Vec<u8>,
  frame_log_counter: u64,
  signal_chunk_states: Vec<SignalChunkState>,
  recycled_byte_buffer: Option<Vec<u8>>,
  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  metal_backend: Option<MockAptMetalBackend>,
  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  metal_backend_error: Option<String>,
}

/// Individual mock APT signal state
#[derive(Debug, Clone)]
struct MockAptSignal {
  config: MockAptSignalConfig,
  drift_offset: f32,
  modulation_phase: f32,
  active: bool,
  phase: f64,
}

struct SignalChunkState {
  p_re: f64,
  p_im: f64,
  modulation_phase: f32,
  frame_start_phase: f64,
  amp: f64,
  r_re: f64,
  r_im: f64,
}

#[inline(always)]
fn modulation_gain(pulse_sin: f64) -> f64 {
  // 10^x ≡ e^(x·ln10); exp() is ~3-5× faster than the general powf() path
  // because powf(base, exp) internally computes exp(exp * ln(base)) plus
  // additional branch/NaN handling for arbitrary bases.
  ((5.0 + 5.0 * pulse_sin) * (std::f64::consts::LN_10 / 20.0)).exp()
}

/// Lightweight snapshot for tracking mock APT generation cost.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MockAptPerformanceProfile {
  pub fft_size: usize,
  pub active_signals: usize,
  pub est_signal_pairs: usize,
  pub estimated_operations_per_frame: usize,
  pub estimated_bytes_per_frame: usize,
}

impl Default for MockAptDevice {
  fn default() -> Self {
    Self::new()
  }
}

impl MockAptDevice {
  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  fn metal_backend_probe_result() -> &'static Result<(), String> {
    static PROBE_RESULT: OnceLock<Result<(), String>> = OnceLock::new();
    PROBE_RESULT.get_or_init(|| {
      MockAptMetalBackend::validate().map_err(|error| error.to_string())
    })
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  pub fn log_metal_backend_status_once() {
    static LOGGED: OnceLock<()> = OnceLock::new();
    LOGGED.get_or_init(|| match Self::metal_backend_probe_result() {
      Ok(()) => {
        eprintln!("Mock APT Metal backend validated and available");
        log::info!("Mock APT Metal backend validated and available");
      }
      Err(error) => {
        eprintln!(
          "Mock APT Metal backend unavailable at startup: {}",
          error
        );
        log::warn!(
          "Mock APT Metal backend unavailable at startup: {}",
          error
        );
      }
    });
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  pub fn metal_backend_available() -> bool {
    Self::metal_backend_probe_result().is_ok()
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  fn device_type_label(&self) -> &'static str {
    if self.metal_backend.is_some() {
      "Mock APT SDR (Metal)"
    } else {
      "Mock APT SDR"
    }
  }

  #[cfg(not(all(feature = "mock_apt_metal", target_os = "macos")))]
  fn device_type_label(&self) -> &'static str {
    "Mock APT SDR"
  }

  /// Create a new mock APT SDR device
  pub fn new() -> Self {
    Self::new_with_rng(StdRng::from_rng(&mut ::rand::rng()))
  }

  /// Create a new mock APT SDR device with a fixed seed for deterministic output
  pub fn new_with_seed(seed: u64) -> Self {
    Self::new_with_rng(StdRng::seed_from_u64(seed))
  }

  fn new_with_rng(rng: StdRng) -> Self {
    Self::new_with_rng_and_backend(rng, false)
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  pub fn new_with_gpu_backend() -> Self {
    Self::new_with_rng_and_backend(StdRng::from_rng(&mut ::rand::rng()), true)
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  pub fn new_with_seed_and_gpu_backend(seed: u64) -> Self {
    Self::new_with_rng_and_backend(StdRng::seed_from_u64(seed), true)
  }

  fn new_with_rng_and_backend(
    mut rng: StdRng,
    _enable_gpu_backend: bool,
  ) -> Self {
    let mock_settings = crate::server::utils::load_mock_apt_settings();
    let signals = Self::create_signals_with_rng(&mock_settings, &mut rng);
    let noise_floor_db = Self::noise_floor_from_settings(&mock_settings);
    #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
    let (metal_backend, metal_backend_error) = if _enable_gpu_backend {
      match Self::metal_backend_probe_result() {
        Ok(()) => match MockAptMetalBackend::new() {
          Ok(backend) => (Some(backend), None),
          Err(error) => (None, Some(error.to_string())),
        },
        Err(error) => (None, Some(error.clone())),
      }
    } else {
      (None, None)
    };

    #[cfg(not(all(feature = "mock_apt_metal", target_os = "macos")))]
    let metal_backend = {
      let _ = _enable_gpu_backend;
      None::<()>
    };

    #[cfg(not(all(feature = "mock_apt_metal", target_os = "macos")))]
    let metal_backend_error = None::<String>;

    Self {
      center_freq: 1_600_000, // 1.6 MHz default
      sample_rate: 3_200_000, // 3.2 MSPS default
      gain: 49.6,
      ppm: 1,
      tuner_agc: false,
      rtl_agc: false,
      offset_tuning: false,
      tuner_bandwidth: 0,
      direct_sampling: 0,
      total_samples: 0,
      signals,
      noise_floor_db,
      rng,
      settle_time_samples: 160_000, // 50ms at 3.2MSPS
      samples_since_init: 0,
      last_config_reload_check: Instant::now(),
      last_config_modified: crate::server::utils::signals_config_modified_at(),
      last_config_checksum: crate::server::utils::signals_config_checksum(),
      rx_queue: None,
      async_thread: None,
      iq_overflow: Vec::new(),
      i_accumulator: Vec::with_capacity(16384),
      q_accumulator: Vec::with_capacity(16384),
      byte_buffer: Vec::with_capacity(32768),
      frame_log_counter: 0,
      signal_chunk_states: Vec::with_capacity(256),
      recycled_byte_buffer: None,
      #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
      metal_backend,
      #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
      metal_backend_error,
    }
  }

  /// Create initial signals based on configuration
  fn create_signals_with_rng(
    mock_settings: &crate::server::types::MockAptSignalsConfig,
    rng_source: &mut impl rand::Rng,
  ) -> Vec<MockAptSignal> {
    let mut signals = Vec::new();
    let rng = rng_source;

    // Default values
    const DEFAULT_SPIKE_HZ: f64 = 33_000.0;
    const DEFAULT_MIN_DB: f64 = -80.0;
    const DEFAULT_MAX_DB: f64 = -20.0;
    const MAX_SIGNALS_PER_CHANNEL: usize = 1024;

    // Create signals based on configured channels
    for (_, channel_config) in &mock_settings.channels {
      if channel_config.freq_range_hz.len() < 2 {
        continue;
      }

      let min_freq = channel_config.freq_range_hz[0];
      let max_freq = channel_config.freq_range_hz[1];
      let _freq_span_hz = max_freq - min_freq;

      // Get spike density (frequency spacing between signals)
      // Can be single: !frequency 33kHz → Single(33000)
      // Or range: !frequency_range 30kHz..40kHz → Range(30000, 40000)
      let _spike_hz = match &channel_config.apt_spike_density {
        Some(crate::server::types::FrequencySpacing::Range(min_hz, max_hz)) => {
          rng.random_range(*min_hz..*max_hz)
        }
        Some(crate::server::types::FrequencySpacing::Single(hz)) => *hz,
        _ => DEFAULT_SPIKE_HZ,
      };

      // Get signal strength range or use default
      let (range_min, range_max) = match &channel_config.signal_strength_range {
        Some(sr) if sr.len() >= 2 => (sr[0], sr[1]),
        _ => (DEFAULT_MIN_DB, DEFAULT_MAX_DB),
      };

      let _mid = (range_min + range_max) * 0.5;
      let _span = (range_max - range_min) * 0.5;

      // Generate signals distributed across the channel's frequency range with randomized spacing
      let mut current_freq = min_freq;

      // Calculate total potential amplitude to prevent clipping later
      let mut total_amp = 0.0;
      let mut temp_signals = Vec::new();

      while current_freq < max_freq {
        let strength_db = rng.random_range(range_min..range_max);
        let amp = 10.0f64.powf(strength_db / 20.0);
        total_amp += amp;

        temp_signals.push((current_freq, strength_db));

        // Advance frequency by a random amount within the configured density range
        let next_gap = match &channel_config.apt_spike_density {
          Some(crate::server::types::FrequencySpacing::Range(
            min_hz,
            max_hz,
          )) => rng.random_range(*min_hz..*max_hz),
          Some(crate::server::types::FrequencySpacing::Single(hz)) => *hz,
          _ => DEFAULT_SPIKE_HZ,
        };
        current_freq += next_gap;

        if temp_signals.len() >= MAX_SIGNALS_PER_CHANNEL {
          break;
        }
      }

      // Normalization factor to keep peak sum < 0.8 (room for noise)
      let norm_factor = if total_amp > 0.8 {
        0.8 / total_amp
      } else {
        1.0
      };

      for (freq, db) in temp_signals {
        // Adjust strength_db by norm_factor
        let adjusted_db = db + 20.0 * norm_factor.log10();

        signals.push(MockAptSignal {
          config: MockAptSignalConfig {
            center_frequency_hz: freq,
            strength_db: adjusted_db,
          },
          modulation_phase: rng.random_range(0.0..=2.0 * PI),
          drift_offset: rng.random_range(-50.0..=50.0),
          active: true,
          phase: rng.random_range(0.0..=2.0 * PI64),
        });
      }
    }

    // If no channels are configured, fall back to legacy behavior
    if signals.is_empty() {
      // Legacy Area A: 100kHz - 4.5MHz
      for i in 0..10 {
        let freq = 100_000.0 + (i as f64 * 450_000.0);
        let strength_db = rng.random_range(-80.0..-70.0);
        signals.push(MockAptSignal {
          config: MockAptSignalConfig {
            center_frequency_hz: freq,
            strength_db,
          },
          modulation_phase: rng.random_range(0.0..=2.0 * PI),
          drift_offset: rng.random_range(-10.0..10.0),
          active: true,
          phase: rng.random_range(0.0..=2.0 * PI64),
        });
      }

      // Legacy Area B: 24.7MHz - 30.0MHz
      for i in 0..11 {
        let freq = 24_700_000.0 + (i as f64 * 500_000.0);
        let strength_db = rng.random_range(-70.0..-50.0);
        signals.push(MockAptSignal {
          config: MockAptSignalConfig {
            center_frequency_hz: freq,
            strength_db,
          },
          drift_offset: rng.random_range(-50.0..50.0),
          modulation_phase: rng.random_range(0.0..=2.0 * PI),
          active: true,
          phase: rng.random_range(0.0..=2.0 * PI64),
        });
      }
    }

    signals
  }

  fn noise_floor_from_settings(
    mock_settings: &crate::server::types::MockAptSignalsConfig,
  ) -> f32 {
    mock_settings
      .channels
      .values()
      .filter_map(|ch| ch.noise_floor_db)
      .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
      .unwrap_or(-100.0) as f32
  }

  fn reload_config_if_needed(&mut self) {
    const CONFIG_POLL_INTERVAL: Duration = Duration::from_millis(250);

    if self.last_config_reload_check.elapsed() < CONFIG_POLL_INTERVAL {
      return;
    }
    self.last_config_reload_check = Instant::now();

    let current_modified = crate::server::utils::signals_config_modified_at();
    let current_checksum = crate::server::utils::signals_config_checksum();
    if current_modified == self.last_config_modified
      && current_checksum == self.last_config_checksum
    {
      return;
    }

    let mock_settings = crate::server::utils::load_mock_apt_settings();
    self.signals = Self::create_signals_with_rng(&mock_settings, &mut self.rng);
    self.noise_floor_db = Self::noise_floor_from_settings(&mock_settings);
    self.last_config_modified =
      crate::server::utils::signals_config_modified_at().or(current_modified);
    self.last_config_checksum = current_checksum;
    log::info!(
      "Reloaded mock APT config from signals.yaml ({} signals)",
      self.signals.len()
    );
  }
}

impl SdrDevice for MockAptDevice {
  fn device_type(&self) -> &'static str {
    self.device_type_label()
  }

  fn get_device_info(&self) -> String {
    format!(
      "{} - Freq: {} Hz, Rate: {} Hz (Sample Rate: {} Hz), Gain: {:.1} dB, PPM: {}",
      self.device_type_label(),
      self.center_freq,
      self.sample_rate,
      self.sample_rate,
      self.gain,
      self.ppm
    )
  }

  fn initialize(&mut self) -> Result<()> {
    log::info!("Initializing mock APT SDR device");
    self.total_samples = 0;
    self.samples_since_init = 0;

    // For now, use simple synchronous initialization
    // TODO: Add optional async mode when it's properly implemented
    Ok(())
  }

  fn is_ready(&self) -> bool {
    true // Mock device is always ready in sync mode
  }

  fn read_samples(&mut self, fft_size: usize) -> Result<RawSamples> {
    self.reload_config_if_needed();
    // For now, use the synchronous implementation which was working correctly
    // TODO: Fix async implementation and make it optional
    self.read_samples_sync(fft_size)
  }

  fn recycle_read_buffer(&mut self, mut buffer: Vec<u8>) {
    if self.recycled_byte_buffer.is_none() {
      buffer.clear();
      self.recycled_byte_buffer = Some(buffer);
    }
  }

  fn set_sample_rate(&mut self, rate: u32) -> Result<()> {
    if rate == 0 {
      log::warn!(
        "Ignoring invalid mock device sample rate 0 Hz; keeping {} Hz",
        self.sample_rate
      );
      return Ok(());
    }
    self.sample_rate = rate;
    log::debug!("Mock device sample rate set to {} Hz", rate);
    Ok(())
  }

  fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
    self.center_freq = freq;
    log::debug!("Mock device center frequency set to {} Hz", freq);
    Ok(())
  }

  fn set_gain(&mut self, gain: f64) -> Result<()> {
    self.gain = gain;
    log::debug!("Mock device gain set to {} dB", gain);
    Ok(())
  }

  fn set_ppm(&mut self, ppm: i32) -> Result<()> {
    self.ppm = ppm;
    log::debug!("Mock device PPM set to {}", ppm);
    Ok(())
  }

  fn set_tuner_agc(&mut self, enabled: bool) -> Result<()> {
    self.tuner_agc = enabled;
    log::debug!("Mock device tuner AGC set to {}", enabled);
    Ok(())
  }

  fn set_rtl_agc(&mut self, enabled: bool) -> Result<()> {
    self.rtl_agc = enabled;
    log::debug!("Mock device RTL AGC set to {}", enabled);
    Ok(())
  }

  fn set_offset_tuning(&mut self, enabled: bool) -> Result<()> {
    self.offset_tuning = enabled;
    log::debug!("Mock device offset tuning set to {}", enabled);
    Ok(())
  }

  fn set_tuner_bandwidth(&mut self, bw: u32) -> Result<()> {
    self.tuner_bandwidth = bw;
    log::debug!("Mock device tuner bandwidth set to {} Hz", bw);
    Ok(())
  }

  fn set_direct_sampling(&mut self, mode: u8) -> Result<()> {
    self.direct_sampling = mode;
    log::debug!("Mock device direct sampling set to {}", mode);
    Ok(())
  }

  fn get_center_frequency(&self) -> u32 {
    self.center_freq
  }

  fn get_sample_rate(&self) -> u32 {
    self.sample_rate
  }

  fn reset_buffer(&mut self) -> Result<()> {
    log::debug!("Mock APT device buffer reset");
    self.total_samples = 0;
    self.samples_since_init = 0;
    Ok(())
  }

  fn cleanup(&mut self) -> Result<()> {
    // Stop async thread if running
    if let Some(handle) = self.async_thread.take() {
      if !handle.is_finished() {
        log::info!("Stopping mock APT async thread...");
        // Note: In a real implementation, we'd need a cancellation mechanism
        // For now, the thread will be detached when the handle is dropped
      }
    }

    self.rx_queue = None;
    self.iq_overflow.clear();
    log::info!("Mock APT device cleanup completed");
    Ok(())
  }

  fn is_healthy(&self) -> bool {
    // Check if async thread is still running (if it exists)
    if let Some(handle) = &self.async_thread {
      !handle.is_finished()
    } else {
      true // Not initialized yet or sync mode
    }
  }

  fn get_error(&self) -> Option<String> {
    None
  }

  fn flush_read_queue(&mut self) {
    // Drain the async queue and clear overflow buffer
    if let Some(rx) = &self.rx_queue {
      while rx.try_recv().is_ok() {}
    }
    self.iq_overflow.clear();
  }
}

#[allow(dead_code)]
impl MockAptDevice {
  /// Fallback synchronous read method
  pub fn read_samples_sync(&mut self, fft_size: usize) -> Result<RawSamples> {
    if fft_size == 0 {
      return Err(anyhow::anyhow!("FFT size cannot be 0"));
    }

    let sample_rate = self.sample_rate as f64;
    let center_freq = self.center_freq as f64;
    let pulse_phase_step = 2.0 * PI64 * 3.0 / sample_rate;
    let frame_pulse_phase_base =
      2.0 * PI64 * 3.0 * self.total_samples as f64 / sample_rate;
    let modulation_phase_step = 0.31 / sample_rate;
    let (pulse_rot_im, pulse_rot_re) = pulse_phase_step.sin_cos();

    // Calculate settle factor (0.0 to 1.0) for realistic warm-up
    let settle_factor = if self.samples_since_init < self.settle_time_samples {
      (self.samples_since_init as f64 / self.settle_time_samples as f64)
        .powf(2.0)
    } else {
      1.0
    };

    // Use the actual device gain for realistic modeling.
    let analog_gain = 0.0;
    // Hardware RF & ADC Simulation Pipeline
    let rf_noise_db = self.noise_floor_db as f32;
    let frontend_noise_db = rf_noise_db + analog_gain as f32;
    let adc_intrinsic_noise_db = -120.0f32;

    // Combine noise sources in linear power domain (f32)
    let total_adc_noise_power = 10.0f32.powf(frontend_noise_db / 10.0)
      + 10.0f32.powf(adc_intrinsic_noise_db / 10.0);
    let noise_amplitude = (1.5f32 * total_adc_noise_power).sqrt();

    // Ensure buffers are the correct size without re-allocating if possible
    if self.i_accumulator.len() != fft_size {
      self.i_accumulator.resize(fft_size, 0.0);
      self.q_accumulator.resize(fft_size, 0.0);
    }
    // Zero the accumulators
    self.i_accumulator.fill(0.0);
    self.q_accumulator.fill(0.0);

    self.byte_buffer.clear();
    self.byte_buffer.reserve(fft_size * 2);

    const CHUNK_SIZE: usize = 1024;

    if self.signals.iter().any(|s| s.active) {
      // 2. Pre-calculate starting states for each signal per chunk to ensure bit-identity
      let num_chunks = (fft_size + CHUNK_SIZE - 1) / CHUNK_SIZE;
      self.signal_chunk_states.clear();
      self
        .signal_chunk_states
        .reserve(self.signals.len().saturating_mul(num_chunks));

      for signal in self.signals.iter_mut().filter(|s| s.active) {
        let abs_freq_hz =
          signal.config.center_frequency_hz + (signal.drift_offset as f64);
        let effective_center_freq =
          center_freq * (1.0 - self.ppm as f64 / 1_000_000.0);
        let rel_freq = abs_freq_hz - effective_center_freq;

        // Skip signals way out of range
        if rel_freq.abs() > (sample_rate / 2.0) + 100_000.0 {
          continue;
        }

        let rf_signal_db = signal.config.strength_db;
        let adc_signal_db = rf_signal_db + analog_gain;
        let amp = (adc_signal_db / 20.0 * std::f64::consts::LN_10).exp() * settle_factor;

        let frame_start_phase = signal.phase;
        let (mut p_im, mut p_re) = (frame_start_phase as f64).sin_cos();
        let phase_step = 2.0 * PI64 * rel_freq / sample_rate;
        let (r_im, r_re) = phase_step.sin_cos();
        let (mut chunk_r_re, mut chunk_r_im) = (1.0, 0.0);
        for _ in 0..CHUNK_SIZE {
          let next_re = chunk_r_re * r_re - chunk_r_im * r_im;
          let next_im = chunk_r_im * r_re + chunk_r_re * r_im;
          chunk_r_re = next_re;
          chunk_r_im = next_im;
        }

        let mut current_mod_phase = signal.modulation_phase;

        for chunk_idx in 0..num_chunks {
          self.signal_chunk_states.push(SignalChunkState {
            p_re,
            p_im,
            modulation_phase: current_mod_phase,
            frame_start_phase,
            amp,
            r_re,
            r_im,
          });

          // Advance state to start of next chunk
          let start = chunk_idx * CHUNK_SIZE;
          let end = std::cmp::min(start + CHUNK_SIZE, fft_size);
          let current_chunk_size = end - start;

          if current_chunk_size == CHUNK_SIZE {
            let next_re = p_re * chunk_r_re - p_im * chunk_r_im;
            let next_im = p_im * chunk_r_re + p_re * chunk_r_im;
            p_re = next_re;
            p_im = next_im;
          } else {
            for _ in 0..current_chunk_size {
              let next_re = p_re * r_re - p_im * r_im;
              let next_im = p_im * r_re + p_re * r_im;
              p_re = next_re;
              p_im = next_im;
            }
          }

          current_mod_phase = (current_mod_phase as f64
            + current_chunk_size as f64 * modulation_phase_step)
            as f32;
        }

        // Update signal state for next frame
        signal.phase = p_im.atan2(p_re);
        signal.modulation_phase = current_mod_phase;
      }

      // 3. Chunk processing
      let signal_states_ref = &self.signal_chunk_states;
      let signal_count = signal_states_ref.len() / num_chunks;
      let use_parallel = fft_size >= 65536 && signal_count > 1;

      if use_parallel {
        self
          .i_accumulator
          .par_chunks_mut(CHUNK_SIZE)
          .zip(self.q_accumulator.par_chunks_mut(CHUNK_SIZE))
          .enumerate()
          .for_each(|(chunk_idx, (i_chunk, q_chunk))| {
            let current_chunk_size = i_chunk.len();
            let block_start = chunk_idx * CHUNK_SIZE;
            let chunk_pulse_phase_base = frame_pulse_phase_base
              + 2.0 * PI64 * 3.0 * block_start as f64 / sample_rate;

            for sig_idx in 0..signal_count {
              let state = &signal_states_ref[sig_idx * num_chunks + chunk_idx];
              let mut p_re = state.p_re;
              let mut p_im = state.p_im;
              let r_re = state.r_re;
              let r_im = state.r_im;
              let amp = state.amp;

              let pulse_phase_base = chunk_pulse_phase_base
                + state.modulation_phase as f64
                + state.frame_start_phase as f64 * 0.15;
              let (mut pulse_im, mut pulse_re) = pulse_phase_base.sin_cos();

              for j in 0..current_chunk_size {
                let cur_amp = amp * modulation_gain(pulse_im);

                i_chunk[j] += cur_amp * p_re;
                q_chunk[j] += cur_amp * p_im;

                let next_re = p_re * r_re - p_im * r_im;
                let next_im = p_im * r_re + p_re * r_im;
                p_re = next_re;
                p_im = next_im;

                let next_pulse_re =
                  pulse_re * pulse_rot_re - pulse_im * pulse_rot_im;
                let next_pulse_im =
                  pulse_im * pulse_rot_re + pulse_re * pulse_rot_im;
                pulse_re = next_pulse_re;
                pulse_im = next_pulse_im;
              }
            }
          });
      } else {
        for (chunk_idx, (i_chunk, q_chunk)) in self
          .i_accumulator
          .chunks_mut(CHUNK_SIZE)
          .zip(self.q_accumulator.chunks_mut(CHUNK_SIZE))
          .enumerate()
        {
          let current_chunk_size = i_chunk.len();
          let block_start = chunk_idx * CHUNK_SIZE;
          let chunk_pulse_phase_base = frame_pulse_phase_base
            + 2.0 * PI64 * 3.0 * block_start as f64 / sample_rate;

          for sig_idx in 0..signal_count {
            let state = &signal_states_ref[sig_idx * num_chunks + chunk_idx];
            let mut p_re = state.p_re;
            let mut p_im = state.p_im;
            let r_re = state.r_re;
            let r_im = state.r_im;
            let amp = state.amp;

            let pulse_phase_base = chunk_pulse_phase_base
              + state.modulation_phase as f64
              + state.frame_start_phase as f64 * 0.15;
            let (mut pulse_im, mut pulse_re) = pulse_phase_base.sin_cos();

            for j in 0..current_chunk_size {
              let cur_amp = amp * modulation_gain(pulse_im);

              i_chunk[j] += cur_amp * p_re;
              q_chunk[j] += cur_amp * p_im;

              let next_re = p_re * r_re - p_im * r_im;
              let next_im = p_im * r_re + p_re * r_im;
              p_re = next_re;
              p_im = next_im;

              let next_pulse_re =
                pulse_re * pulse_rot_re - pulse_im * pulse_rot_im;
              let next_pulse_im =
                pulse_im * pulse_rot_re + pulse_re * pulse_rot_im;
              pulse_re = next_pulse_re;
              pulse_im = next_pulse_im;
            }
          }
        }
      }
    }

    // Apply noise, clip and quantize (Sequential to keep RNG identical).
    // If Metal is enabled, we only offload the final conversion stage and
    // keep the RNG on CPU so the seeded stream stays stable.
    let noise_amp_f64 = noise_amplitude as f64;

    #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
    if self.metal_backend.is_some() {
      let (noise_i, noise_q) = self.build_noise_buffers(fft_size, noise_amp_f64);
      let backend = self
        .metal_backend
        .as_mut()
        .expect("Metal backend presence checked above");
      let i_accumulator: Vec<f32> = self.i_accumulator[..fft_size]
        .iter()
        .map(|&value| value as f32)
        .collect();
      let q_accumulator: Vec<f32> = self.q_accumulator[..fft_size]
        .iter()
        .map(|&value| value as f32)
        .collect();
      let noise_i_f32: Vec<f32> = noise_i.iter().copied().map(|value| value as f32).collect();
      let noise_q_f32: Vec<f32> = noise_q.iter().copied().map(|value| value as f32).collect();

      match backend.finalize_frame(
        &i_accumulator,
        &q_accumulator,
        &noise_i_f32,
        &noise_q_f32,
      ) {
        Ok(data) => {
          self.total_samples = self.total_samples.wrapping_add(fft_size as u64);
          self.samples_since_init =
            self.samples_since_init.wrapping_add(fft_size as u64);
          self.frame_log_counter = self.frame_log_counter.wrapping_add(1);
          return Ok(RawSamples {
            data,
            sample_rate: self.sample_rate,
          });
        }
        Err(error) => {
            log::warn!(
              "Mock APT Metal finalization failed, falling back to CPU: {}",
              error
            );
          return self.finalize_samples_cpu_with_noise_buffers(
            fft_size,
            noise_i,
            noise_q,
          );
        }
      }
    }

    // Write directly into the pre-reserved byte_buffer via pointer to avoid
    // 2×fft_size bounds-checked push() calls (already reserved on line 522).
    let buf_ptr = self.byte_buffer.as_mut_ptr();
    for j in 0..fft_size {
      let i_noise =
        (self.rng.random::<f64>() - 0.5) * 2.0 * noise_amp_f64;
      let q_noise =
        (self.rng.random::<f64>() - 0.5) * 2.0 * noise_amp_f64;

      let i_u8 = (((self.i_accumulator[j] + i_noise).clamp(-1.0, 1.0) * 127.0)
        + 128.0) as u8;
      let q_u8 = (((self.q_accumulator[j] + q_noise).clamp(-1.0, 1.0) * 127.0)
        + 128.0) as u8;

      // SAFETY: byte_buffer has capacity ≥ fft_size*2 (reserved on line 522)
      unsafe {
        *buf_ptr.add(j * 2) = i_u8;
        *buf_ptr.add(j * 2 + 1) = q_u8;
      }
    }
    // SAFETY: we wrote exactly fft_size*2 bytes above into reserved capacity
    unsafe {
      self.byte_buffer.set_len(fft_size * 2);
    }

    self.total_samples = self.total_samples.wrapping_add(fft_size as u64);
    self.samples_since_init =
      self.samples_since_init.wrapping_add(fft_size as u64);

    let next_buffer = self
      .recycled_byte_buffer
      .take()
      .filter(|buffer| buffer.capacity() >= fft_size * 2)
      .unwrap_or_else(|| Vec::with_capacity(fft_size * 2));
    let data = std::mem::replace(&mut self.byte_buffer, next_buffer);
    self.frame_log_counter = self.frame_log_counter.wrapping_add(1);
    Ok(RawSamples {
      data,
      sample_rate: self.sample_rate,
    })
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  fn build_noise_buffers(
    &mut self,
    fft_size: usize,
    noise_amp_f64: f64,
  ) -> (Vec<f64>, Vec<f64>) {
    let mut noise_i = Vec::with_capacity(fft_size);
    let mut noise_q = Vec::with_capacity(fft_size);
    for _ in 0..fft_size {
      noise_i.push((self.rng.random::<f64>() - 0.5) * 2.0 * noise_amp_f64);
      noise_q.push((self.rng.random::<f64>() - 0.5) * 2.0 * noise_amp_f64);
    }
    (noise_i, noise_q)
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  fn finalize_samples_cpu_with_noise_buffers(
    &mut self,
    fft_size: usize,
    noise_i: Vec<f64>,
    noise_q: Vec<f64>,
  ) -> Result<RawSamples> {
    self.byte_buffer.clear();
    self.byte_buffer.reserve(fft_size * 2);
    let buf_ptr = self.byte_buffer.as_mut_ptr();

    for j in 0..fft_size {
      let i_u8 = (((self.i_accumulator[j] + noise_i[j]).clamp(-1.0, 1.0)
        * 127.0)
        + 128.0) as u8;
      let q_u8 = (((self.q_accumulator[j] + noise_q[j]).clamp(-1.0, 1.0)
        * 127.0)
        + 128.0) as u8;

      unsafe {
        *buf_ptr.add(j * 2) = i_u8;
        *buf_ptr.add(j * 2 + 1) = q_u8;
      }
    }

    unsafe {
      self.byte_buffer.set_len(fft_size * 2);
    }

    self.total_samples = self.total_samples.wrapping_add(fft_size as u64);
    self.samples_since_init =
      self.samples_since_init.wrapping_add(fft_size as u64);

    let next_buffer = self
      .recycled_byte_buffer
      .take()
      .filter(|buffer| buffer.capacity() >= fft_size * 2)
      .unwrap_or_else(|| Vec::with_capacity(fft_size * 2));
    let data = std::mem::replace(&mut self.byte_buffer, next_buffer);
    self.frame_log_counter = self.frame_log_counter.wrapping_add(1);
    Ok(RawSamples {
      data,
      sample_rate: self.sample_rate,
    })
  }

  /// Set settle time in samples
  pub fn set_settle_time(&mut self, samples: u64) {
    self.settle_time_samples = samples;
  }

  /// Get settle time in samples
  pub fn get_settle_time(&self) -> u64 {
    self.settle_time_samples
  }

  /// Return a stable estimate of the work required to generate one frame.
  pub fn performance_profile(
    &self,
    fft_size: usize,
  ) -> MockAptPerformanceProfile {
    let active_signals = self.signals.iter().filter(|s| s.active).count();
    let num_chunks = (fft_size + 1024 - 1) / 1024;
    let est_signal_pairs = active_signals.saturating_mul(num_chunks);
    let estimated_operations_per_frame =
      est_signal_pairs.saturating_mul(fft_size.max(1));
    MockAptPerformanceProfile {
      fft_size,
      active_signals,
      est_signal_pairs,
      estimated_operations_per_frame,
      estimated_bytes_per_frame: fft_size.saturating_mul(2),
    }
  }

  pub fn generation_backend_label(&self) -> &'static str {
    #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
    if self.metal_backend.is_some() {
      return "Metal";
    }

    #[cfg(target_arch = "aarch64")]
    {
      "CPU (rayon + NEON SIMD)"
    }

    #[cfg(not(target_arch = "aarch64"))]
    {
      "CPU (rayon)"
    }
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  pub fn gpu_backend_enabled(&self) -> bool {
    self.metal_backend.is_some()
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  pub fn gpu_backend_error(&self) -> Option<&str> {
    self.metal_backend_error.as_deref()
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::server::utils::cwd_lock;
  use std::fs;
  use std::thread::sleep;

  fn write_test_signals_yaml(
    path: &std::path::Path,
    spike_hz: u32,
    noise_floor_db: i32,
  ) {
    let yaml = format!(
      r#"
signals:
  sdr:
    sample_rate: !frequency 3.2MHz
    center_frequency: !frequency 1.6MHz
    gain:
      tuner_gain: !dB 49.6dB
      rtl_agc: false
      tuner_agc: false
    ppm: 1.0
    fft:
      default_size: 32768
      default_frame_rate: 60
      size_to_frame_rate: {{32768: 60}}
      max_size: 262144
      max_frame_rate: 60
    display:
      min_db: !dB -120dB
      max_db: !dB 0dB
      padding: 20
    devices:
      mock_apt:
        sample_rate: !max
        fft_display:
          markers:
            - kind: lower_limit
              freq_hz: !frequency 500kHz
              label: "low"
            - kind: upper_limit
              freq_hz: !frequency 28.8MHz
              label: "high"
  mock_apt:
    channels:
      a:
        label: "A"
        freq_range_hz: !frequency_range 18kHz..4.37MHz
        description: "A"
        apt_spike_density: !frequency {spike_hz}Hz
        noise_floor_db: !dB {noise_floor_db}dB
        signal_strength_range: !dB_range -80dB..-20dB
  triangulation:
    static:
      freq_range_hz: !frequency_range 2.3GHz..2.344GHz
  n_apt:
    channels:
      a:
        label: "A"
        freq_range_hz: !frequency_range 18kHz..4.37MHz
        description: "A"
"#
    );
    fs::write(path, yaml).expect("write test signals.yaml");
  }

  #[test]
  fn reloads_mock_settings_when_signals_yaml_changes() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    let original_dir = std::env::current_dir().expect("current dir");
    let temp_dir = std::env::temp_dir().join(format!(
      "napt-mock-reload-{}",
      SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("time")
        .as_nanos()
    ));
    fs::create_dir_all(&temp_dir).expect("create temp dir");
    std::env::set_current_dir(&temp_dir).expect("set current dir");

    let yaml_path = temp_dir.join("signals.yaml");
    write_test_signals_yaml(&yaml_path, 500_000, -95);
    let mut device = MockAptDevice::new();
    assert_eq!(device.signals.len(), 9);
    assert_eq!(device.noise_floor_db, -95.0);

    sleep(Duration::from_millis(300));
    write_test_signals_yaml(&yaml_path, 1_000_000, -70);
    sleep(Duration::from_millis(300));

    device.reload_config_if_needed();

    assert_eq!(device.signals.len(), 5);
    assert_eq!(device.noise_floor_db, -70.0);

    std::env::set_current_dir(&original_dir).expect("restore dir");
    let _ = fs::remove_dir_all(&temp_dir);
  }
}
