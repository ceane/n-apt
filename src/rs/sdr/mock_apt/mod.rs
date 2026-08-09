//! Mock APT SDR Device Implementation.
//!
//! This device does not stream a single precomputed I/Q recording. Instead, it
//! synthesizes the requested FFT frame on demand each time `read_samples_sync`
//! is called.
//!
//! The signal layout is initialized from `signals.yaml` into an in-memory set of
//! mock carriers, then each frame is generated from that state using the current
//! center frequency, sample rate, gain, and realism settings. This keeps the
//! output responsive to tuning changes while still allowing seeded, repeatable
//! generation when desired.
//!
//! A separate small cache is used only for selected Mock Tx overlays
//! (`wifi`/`5g`/related modes) so those blocks can be reused when the transmit
//! parameters are unchanged. That cache is not the main Mock APT I/Q source.

use crate::s::fft::types::RawSamples;
use crate::s::ifft::complex_baseband::{
  canonical_complex_baseband_signal_key, ComplexBasebandIQGenerator,
  ComplexBasebandIQParams,
};
use std::sync::{Arc, LazyLock, Mutex};

/// Cached Mock Tx synthesis state.
///
/// This cache exists only for transmit overlay generation. The main Mock APT
/// receive path still recomputes the requested frame on every read.
struct ComplexBasebandIQBuffer {
  params: Option<ComplexBasebandIQParams>,
  samples: Arc<Vec<Complex<f32>>>,
  generator: ComplexBasebandIQGenerator,
}

impl ComplexBasebandIQBuffer {
  fn new() -> Self {
    Self {
      params: None,
      samples: Arc::new(Vec::new()),
      generator: ComplexBasebandIQGenerator::new(),
    }
  }

  fn prepare(&mut self, params: &ComplexBasebandIQParams) {
    if self.params.as_ref() == Some(params)
      && !self.samples.is_empty()
      && self.samples.len() == params.tx_ifft_size
    {
      return;
    }

    self
      .generator
      .generate_into(params, Arc::make_mut(&mut self.samples));
    self.params = Some(params.clone());
  }

  fn snapshot_samples(&self) -> Arc<Vec<Complex<f32>>> {
    Arc::clone(&self.samples)
  }
}

static COMPLEX_BASEBAND_IQ_CACHE: LazyLock<Mutex<ComplexBasebandIQBuffer>> =
  LazyLock::new(|| Mutex::new(ComplexBasebandIQBuffer::new()));

use std::cell::RefCell;

thread_local! {
  static PLANNER: RefCell<FftPlanner<f32>> = RefCell::new(FftPlanner::new());
}

use anyhow::Result;
use crossbeam_channel::Receiver;
use rand::rngs::StdRng;
use rand::{RngExt, SeedableRng};
use rayon::prelude::*;
use rustfft::{num_complex::Complex, FftPlanner};
use std::f32::consts::PI;
use std::f64::consts::PI as PI64;
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

use crate::server::types::{MockAptRealisticRfConfig, TxIqPowerModel};

use super::SdrDevice;

#[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
mod metal_backend;
#[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
use metal_backend::MockAptMetalBackend;
#[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
use std::sync::OnceLock;

/// One configured mock carrier in the simulated spectrum.
#[derive(Debug, Clone)]
struct MockAptSignalConfig {
  center_frequency_hz: f64,
  strength_db: f64,
}

/// Mock APT SDR device implementation.
///
/// The device stores a persistent signal model, but the output samples are
/// generated per request. That means tuning, gain, ppm, and RF realism options
/// are applied at read time rather than being baked into a static capture.
pub struct MockAptDevice {
  center_freq: u32,
  sample_rate: u32,
  gain: f64,
  ppm: u32,
  tuner_agc: bool,
  rtl_agc: bool,
  offset_tuning: bool,
  tuner_bandwidth: u32,
  direct_sampling: u8,
  total_samples: u64,
  signals: Vec<MockAptSignal>,
  noise_floor_db: f32,
  realistic_rf: MockAptRealisticRfConfig,
  rng: StdRng,
  settle_time_samples: u64,
  retune_settle_time_samples: u64,
  samples_since_retune: u64,
  previous_center_freq: u32,
  samples_since_init: u64,
  rx_active: bool,
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

impl Default for MockAptRealisticRfConfig {
  fn default() -> Self {
    Self {
      enabled: false,
      aliasing: true,
      passband: true,
      retune_settling: true,
    }
  }
}

/// Fold an RF offset into the complex-baseband Nyquist interval.
pub fn alias_to_baseband(rel_freq_hz: f64, sample_rate_hz: f64) -> f64 {
  if !rel_freq_hz.is_finite()
    || !sample_rate_hz.is_finite()
    || sample_rate_hz <= 0.0
  {
    return 0.0;
  }

  (rel_freq_hz + sample_rate_hz / 2.0).rem_euclid(sample_rate_hz)
    - sample_rate_hz / 2.0
}

/// Smooth mock receiver passband response for a displayed baseband offset.
pub fn passband_gain(rel_freq_hz: f64, sample_rate_hz: f64) -> f64 {
  if !rel_freq_hz.is_finite()
    || !sample_rate_hz.is_finite()
    || sample_rate_hz <= 0.0
  {
    return 0.0;
  }

  let nyquist = sample_rate_hz / 2.0;
  let x = (rel_freq_hz.abs() / nyquist).min(1.5);
  if x <= 0.70 {
    1.0 - 0.08 * (x / 0.70).powi(2)
  } else if x <= 1.0 {
    let t = (x - 0.70) / 0.30;
    let smooth = t * t * (3.0 - 2.0 * t);
    0.92 + (0.30 - 0.92) * smooth
  } else {
    0.0
  }
}

/// Combined visibility for realistic mock RF: passband plus folded leakage.
pub fn realistic_visibility_gain(
  abs_rel_freq_hz: f64,
  displayed_rel_freq_hz: f64,
  sample_rate_hz: f64,
) -> f64 {
  if !abs_rel_freq_hz.is_finite()
    || !displayed_rel_freq_hz.is_finite()
    || !sample_rate_hz.is_finite()
    || sample_rate_hz <= 0.0
  {
    return 0.0;
  }

  let nyquist = sample_rate_hz / 2.0;
  let fold_order = if abs_rel_freq_hz <= nyquist {
    0
  } else {
    ((abs_rel_freq_hz - nyquist) / sample_rate_hz).floor() as i32 + 1
  };

  if fold_order > 8 {
    return 0.0;
  }

  let leakage = 0.52f64.powi(fold_order);
  passband_gain(displayed_rel_freq_hz, sample_rate_hz) * leakage
}

#[derive(Debug, Clone, Copy)]
struct MockTxRuntimePreset {
  center_frequency_hz: f64,
  tone_hz: f64,
  bandwidth_hz: f64,
}

fn clamp_window_to_range(
  center_hz: f64,
  sample_rate_hz: f64,
  min_hz: f64,
  max_hz: f64,
) -> (f64, f64) {
  let channel_span = (max_hz - min_hz).max(1.0);
  let sample_rate_hz = sample_rate_hz
    .max(1.0)
    .min(channel_span)
    .min(u32::MAX as f64);
  let half = sample_rate_hz / 2.0;
  let center_hz = center_hz.clamp(min_hz + half, max_hz - half);
  (center_hz, sample_rate_hz)
}

fn resolve_mock_tx_preset(signal_name: &str) -> MockTxRuntimePreset {
  let settings = crate::server::utils::load_mock_tx_settings();
  let mock_apt_settings = crate::server::utils::load_mock_apt_settings();
  let signal_key = canonical_complex_baseband_signal_key(signal_name);
  let preset = settings
    .signals
    .get(&signal_key)
    .or_else(|| settings.signals.get("wifi"));

  let channel = preset
    .and_then(|preset| preset.channel.as_deref())
    .unwrap_or("a")
    .to_ascii_lowercase();
  let channel_range = mock_apt_settings
    .channels
    .get(&channel)
    .and_then(|channel| {
      if channel.freq_range_hz.len() >= 2 {
        Some((channel.freq_range_hz[0], channel.freq_range_hz[1]))
      } else {
        None
      }
    })
    .unwrap_or((18_000.0, 4_390_000.0));

  let (min_hz, max_hz) = channel_range;
  let fallback_center = (min_hz + max_hz) / 2.0;
  let fallback_sample_rate = (max_hz - min_hz).min(2_400_000.0).max(1.0);
  let center_hz = preset
    .and_then(|preset| preset.center_frequency_hz)
    .unwrap_or(fallback_center);
  let sample_rate_hz = preset
    .and_then(|preset| preset.sample_rate_hz)
    .unwrap_or(fallback_sample_rate);
  let (center_frequency_hz, sample_rate_hz) =
    clamp_window_to_range(center_hz, sample_rate_hz, min_hz, max_hz);

  MockTxRuntimePreset {
    center_frequency_hz,
    tone_hz: preset.and_then(|preset| preset.tone_hz).unwrap_or(2_400.0),
    bandwidth_hz: preset
      .and_then(|preset| preset.bandwidth_hz)
      .unwrap_or(sample_rate_hz / 5.0)
      .max(1.0)
      .min(sample_rate_hz),
  }
}

const MOCK_APT_FRAME_NOISE_KEY: u64 = 0x5749_4649_5f46_524d;
const MOCK_APT_SAMPLE_NOISE_KEY: u64 = 0x534d_504c_5458_4741;
const MOCK_APT_I_DITHER_KEY: u64 = 0x4d41_5054_5458_4949;
const MOCK_APT_Q_DITHER_KEY: u64 = 0x4d41_5054_5458_5151;
// Model the small receiver DC offset that real SDRs expose at the centered
// FFT bin. The display can remove it, while raw IQ captures retain it.
const MOCK_APT_DC_OFFSET: f64 = 0.04;

fn mock_apt_motion_unit(sample_index: u64, noise_key: u64) -> f64 {
  let mut x = sample_index
    .wrapping_mul(0x9E37_79B9_7F4A_7C15)
    .wrapping_add(noise_key);
  x ^= x >> 30;
  x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
  x ^= x >> 27;
  x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
  x ^= x >> 31;
  ((x >> 11) as f64 / ((1u64 << 53) as f64)) * 2.0 - 1.0
}

fn wifi_5g_motion_gain(
  signal_name: &str,
  frame_seed: u64,
  sample_index: u64,
) -> f64 {
  if signal_name != "wifi" && signal_name != "5g" {
    return 1.0;
  }

  // OFDM-like transmit blocks need a little frame-to-frame texture so the
  // signal does not look frozen when the same cached block is reused.
  let frame_noise = mock_apt_motion_unit(frame_seed, MOCK_APT_FRAME_NOISE_KEY);
  let sample_noise =
    mock_apt_motion_unit(sample_index ^ frame_seed, MOCK_APT_SAMPLE_NOISE_KEY);
  (1.0 + 0.06 * frame_noise + 0.03 * sample_noise).clamp(0.85, 1.15)
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
        eprintln!("Mock APT Metal backend unavailable at startup: {}", error);
        log::warn!("Mock APT Metal backend unavailable at startup: {}", error);
      }
    });
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  pub fn metal_backend_available() -> bool {
    Self::metal_backend_probe_result().is_ok()
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  fn resolve_metal_backend(
    enabled: bool,
  ) -> (Option<MockAptMetalBackend>, Option<String>) {
    if !enabled {
      return (None, None);
    }

    match Self::metal_backend_probe_result() {
      Ok(()) => match MockAptMetalBackend::new() {
        Ok(backend) => (Some(backend), None),
        Err(error) => (None, Some(error.to_string())),
      },
      Err(error) => (None, Some(error.clone())),
    }
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

  /// Create a new mock APT SDR device.
  ///
  /// The signal configuration is loaded once at construction, but the I/Q
  /// frames themselves are synthesized on demand.
  pub fn new() -> Self {
    Self::new_with_rng(StdRng::from_rng(&mut ::rand::rng()))
  }

  /// Create a new mock APT SDR device with a fixed seed for deterministic output.
  ///
  /// This makes the signal layout and subsequent frame generation repeatable.
  pub fn new_with_seed(seed: u64) -> Self {
    Self::new_with_rng(StdRng::seed_from_u64(seed))
  }

  fn new_with_rng(rng: StdRng) -> Self {
    Self::new_with_rng_and_config(rng)
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  pub fn new_with_gpu_backend() -> Self {
    Self::new_with_rng_and_config(StdRng::from_rng(&mut ::rand::rng()))
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  pub fn new_with_seed_and_gpu_backend(seed: u64) -> Self {
    Self::new_with_rng_and_config(StdRng::seed_from_u64(seed))
  }

  fn new_with_rng_and_config(mut rng: StdRng) -> Self {
    let mock_settings = crate::server::utils::load_mock_apt_settings();
    let signals = Self::create_signals_with_rng(&mock_settings, &mut rng);
    let noise_floor_db = Self::noise_floor_from_settings(&mock_settings);
    let realistic_rf = mock_settings.realistic_rf.unwrap_or_default();
    #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
    let (metal_backend, metal_backend_error) =
      Self::resolve_metal_backend(mock_settings.gpu_gen_via_metal);

    #[cfg(not(all(feature = "mock_apt_metal", target_os = "macos")))]
    let _metal_backend_error = None::<String>;

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
      realistic_rf,
      rng,
      settle_time_samples: 160_000, // 50ms at 3.2MSPS
      retune_settle_time_samples: 64_000, // 20ms at 3.2MSPS
      samples_since_retune: u64::MAX,
      previous_center_freq: 1_600_000,
      samples_since_init: 0,
      rx_active: false,
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

  /// Create initial signals based on configuration.
  ///
  /// This builds the persistent carrier set used by the runtime generator. It
  /// does not allocate a full waveform buffer; the actual I/Q samples are still
  /// produced lazily per frame.
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
      // Account for the +10dB max modulation gain (factor of ~3.162)
      let max_expected_peak = total_amp * 3.16227766;
      let norm_factor = if max_expected_peak > 0.8 {
        0.8 / max_expected_peak
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
    self.realistic_rf = mock_settings.realistic_rf.unwrap_or_default();
    #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
    {
      if !mock_settings.gpu_gen_via_metal {
        self.metal_backend = None;
        self.metal_backend_error = None;
      } else if self.metal_backend.is_none() {
        let (metal_backend, metal_backend_error) =
          Self::resolve_metal_backend(true);
        self.metal_backend = metal_backend;
        self.metal_backend_error = metal_backend_error;
      }
    }
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
    self.samples_since_retune = u64::MAX;
    self.rx_active = true;

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
    if freq != self.center_freq {
      self.previous_center_freq = self.center_freq;
      self.samples_since_retune = 0;
    }
    self.center_freq = freq;
    log::debug!("Mock device center frequency set to {} Hz", freq);
    Ok(())
  }

  fn set_gain(&mut self, gain: f64) -> Result<()> {
    self.gain = gain;
    log::debug!("Mock device gain set to {} dB", gain);
    Ok(())
  }

  fn set_ppm(&mut self, ppm: u32) -> Result<()> {
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

  fn get_max_sample_rate(&mut self) -> u32 {
    20_000_000
  }

  fn reset_buffer(&mut self) -> Result<()> {
    log::debug!("Mock APT device buffer reset");
    self.total_samples = 0;
    self.samples_since_init = 0;
    self.samples_since_retune = u64::MAX;
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
    self.rx_active = false;
    log::info!("Mock APT device cleanup completed");
    Ok(())
  }

  fn is_rx_active(&self) -> bool {
    self.rx_active
  }

  fn is_healthy(&self) -> bool {
    // Check if async thread is still running (if it exists)
    if let Some(handle) = &self.async_thread {
      !handle.is_finished()
    } else {
      true // Not initialized yet or sync mode
    }
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  fn get_error(&self) -> Option<String> {
    self.metal_backend_error.clone()
  }

  #[cfg(not(all(feature = "mock_apt_metal", target_os = "macos")))]
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

fn hash_noise(t: u64, seed: u64) -> f64 {
  let mut x = t.wrapping_mul(0x85ebca6b) ^ seed;
  x = x.wrapping_mul(0xc2b2ae35);
  x ^= x >> 16;
  let r = (x & 0xfffffff) as f64 / 268435456.0; // 0.0 to 1.0
  r * 2.0 - 1.0
}

fn quantize_mock_apt_sample(
  value: f64,
  sample_index: u64,
  noise_key: u64,
  stochastic: bool,
) -> u8 {
  let scaled = value.clamp(-1.0, 1.0) * 127.0;
  if !stochastic {
    return (scaled + 128.0) as u8;
  }

  let lower = scaled.floor();
  let fraction = scaled - lower;
  let dither = (hash_noise(sample_index, noise_key) + 1.0) * 0.5;
  let signed = lower + if dither < fraction { 1.0 } else { 0.0 };
  (128.0 + signed).clamp(0.0, 255.0) as u8
}

fn constrain_mock_apt_tx_overlay_to_bandwidth(
  i_accumulator: &mut [f64],
  q_accumulator: &mut [f64],
  before_i: &[f64],
  before_q: &[f64],
  rel_center_hz: f64,
  tx_bandwidth_hz: f64,
  view_sample_rate_hz: f64,
) {
  let len = i_accumulator
    .len()
    .min(q_accumulator.len())
    .min(before_i.len())
    .min(before_q.len());
  if len == 0
    || !rel_center_hz.is_finite()
    || !tx_bandwidth_hz.is_finite()
    || !view_sample_rate_hz.is_finite()
  {
    return;
  }

  let half_tx_hz = (tx_bandwidth_hz.max(1.0) / 2.0).max(0.5);
  let bin_width_hz = view_sample_rate_hz.max(1.0) / len as f64;
  let guard_hz = bin_width_hz * 1.5;
  let mut overlay: Vec<Complex<f32>> = (0..len)
    .map(|index| {
      Complex::new(
        (i_accumulator[index] - before_i[index]) as f32,
        (q_accumulator[index] - before_q[index]) as f32,
      )
    })
    .collect();
  let (fft, ifft) = PLANNER.with(|p| {
    let mut planner = p.borrow_mut();
    (planner.plan_fft_forward(len), planner.plan_fft_inverse(len))
  });
  fft.process(&mut overlay);

  for (index, bin) in overlay.iter_mut().enumerate() {
    let bin_hz = if index <= len / 2 {
      index as f64 * bin_width_hz
    } else {
      -((len - index) as f64 * bin_width_hz)
    };
    if (bin_hz - rel_center_hz).abs() > half_tx_hz + guard_hz {
      *bin = Complex::new(0.0, 0.0);
    }
  }

  ifft.process(&mut overlay);
  let scale = 1.0 / len as f32;
  for index in 0..len {
    let filtered = overlay[index] * scale;
    i_accumulator[index] = before_i[index] + filtered.re as f64;
    q_accumulator[index] = before_q[index] + filtered.im as f64;
  }
}

fn add_bandlimited_mock_tx_noise_overlay(
  i_accumulator: &mut [f64],
  q_accumulator: &mut [f64],
  rel_center_hz: f64,
  tx_bandwidth_hz: f64,
  view_sample_rate_hz: f64,
  amp: f64,
  frame_start_sample: u64,
) {
  let len = i_accumulator.len().min(q_accumulator.len());
  if len == 0
    || !rel_center_hz.is_finite()
    || !tx_bandwidth_hz.is_finite()
    || !view_sample_rate_hz.is_finite()
    || tx_bandwidth_hz <= 0.0
    || view_sample_rate_hz <= 0.0
  {
    return;
  }

  let bin_width_hz = view_sample_rate_hz / len as f64;
  let half_tx_hz = tx_bandwidth_hz / 2.0;
  let edge_taper_hz = (tx_bandwidth_hz * 0.04).max(bin_width_hz * 2.0);
  let mut spectrum = vec![Complex::new(0.0f32, 0.0f32); len];
  let mut occupied_bins = 0usize;

  for (index, bin) in spectrum.iter_mut().enumerate() {
    let bin_hz = if index <= len / 2 {
      index as f64 * bin_width_hz
    } else {
      -((len - index) as f64 * bin_width_hz)
    };
    let offset_from_tx_center = (bin_hz - rel_center_hz).abs();
    if offset_from_tx_center > half_tx_hz {
      continue;
    }

    let taper = if offset_from_tx_center >= half_tx_hz - edge_taper_hz {
      let x =
        ((half_tx_hz - offset_from_tx_center) / edge_taper_hz).clamp(0.0, 1.0);
      x * x * (3.0 - 2.0 * x)
    } else {
      1.0
    };
    let phase_unit = (hash_noise(
      frame_start_sample.wrapping_add(index as u64),
      0x4241_4e44_4e4f_4953,
    ) + 1.0)
      * 0.5;
    let phase = 2.0 * std::f64::consts::PI * phase_unit;
    let (sin, cos) = phase.sin_cos();
    *bin = Complex::new((cos * taper) as f32, (sin * taper) as f32);
    occupied_bins += 1;
  }

  if occupied_bins == 0 {
    return;
  }

  let magnitude = (amp * len as f64 / (occupied_bins as f64).sqrt()) as f32;
  for bin in spectrum.iter_mut() {
    *bin *= magnitude;
  }

  let ifft = PLANNER.with(|p| p.borrow_mut().plan_fft_inverse(len));
  ifft.process(&mut spectrum);
  let scale = 1.0 / len as f32;
  for index in 0..len {
    let sample = spectrum[index] * scale;
    i_accumulator[index] += sample.re as f64;
    q_accumulator[index] += sample.im as f64;
  }
}

#[allow(dead_code)]
impl MockAptDevice {
  /// Fallback synchronous read method
  /// Synthesize one I/Q frame synchronously.
  ///
  /// This is the hot path: it computes the requested `fft_size` samples from
  /// the current device state, applies noise and quantization, then returns the
  /// resulting bytes. No global capture buffer is replayed here.
  pub fn read_samples_sync(&mut self, fft_size: usize) -> Result<RawSamples> {
    if fft_size == 0 {
      return Err(anyhow::anyhow!("FFT size cannot be 0"));
    }

    let sample_rate = self.sample_rate as f64;
    let center_freq = self.center_freq as f64;
    let frame_pulse_phase_base =
      2.0 * PI64 * 3.0 * self.total_samples as f64 / sample_rate;
    let modulation_phase_step = 0.31 / sample_rate;

    // Calculate settle factor (0.0 to 1.0) for realistic warm-up
    let settle_factor = if self.realistic_rf.enabled
      && self.samples_since_init < self.settle_time_samples
    {
      (self.samples_since_init as f64 / self.settle_time_samples as f64)
        .powf(2.0)
    } else {
      1.0
    };
    let realistic_retune_factor = if self.realistic_rf.enabled
      && self.realistic_rf.retune_settling
      && self.samples_since_retune < self.retune_settle_time_samples
    {
      (self.samples_since_retune as f64
        / self.retune_settle_time_samples.max(1) as f64)
        .powf(1.6)
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
          center_freq * (1.0 - (self.ppm as f64) / 1_000_000.0);
        let raw_rel_freq = abs_freq_hz - effective_center_freq;
        let mut rel_freq = raw_rel_freq;
        let mut visibility_gain = 1.0;

        if self.realistic_rf.enabled {
          let displayed_rel_freq = if self.realistic_rf.aliasing {
            alias_to_baseband(raw_rel_freq, sample_rate)
          } else {
            raw_rel_freq
          };

          if !self.realistic_rf.aliasing
            && displayed_rel_freq.abs() > (sample_rate / 2.0) + 100_000.0
          {
            continue;
          }

          let visibility = if self.realistic_rf.passband {
            realistic_visibility_gain(
              raw_rel_freq.abs(),
              displayed_rel_freq,
              sample_rate,
            )
          } else if self.realistic_rf.aliasing {
            0.52f64.powi(
              ((raw_rel_freq.abs() - sample_rate / 2.0).max(0.0) / sample_rate)
                .floor() as i32,
            )
          } else {
            1.0
          };

          if visibility < 1.0e-5 {
            continue;
          }

          rel_freq = displayed_rel_freq;
          visibility_gain = visibility;
        } else {
          // Skip signals way out of range. This is the canonical path used by
          // checksum-sensitive tests; keep it byte-identical when realism is off.
          if raw_rel_freq.abs() > (sample_rate / 2.0) + 100_000.0 {
            continue;
          }
        }

        let rf_signal_db = signal.config.strength_db;
        let adc_signal_db = rf_signal_db + analog_gain;
        let mut amp = (adc_signal_db / 20.0 * std::f64::consts::LN_10).exp()
          * settle_factor;
        if self.realistic_rf.enabled {
          amp *= visibility_gain * realistic_retune_factor;
        }

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
              let (pulse_im, _pulse_re) = pulse_phase_base.sin_cos();
              let cur_amp = amp * modulation_gain(pulse_im);

              for j in 0..current_chunk_size {
                i_chunk[j] += cur_amp * p_re;
                q_chunk[j] += cur_amp * p_im;

                let next_re = p_re * r_re - p_im * r_im;
                let next_im = p_im * r_re + p_re * r_im;
                p_re = next_re;
                p_im = next_im;
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
            let (pulse_im, _pulse_re) = pulse_phase_base.sin_cos();
            let cur_amp = amp * modulation_gain(pulse_im);

            for j in 0..current_chunk_size {
              i_chunk[j] += cur_amp * p_re;
              q_chunk[j] += cur_amp * p_im;

              let next_re = p_re * r_re - p_im * r_im;
              let next_im = p_im * r_re + p_re * r_im;
              p_re = next_re;
              p_im = next_im;
            }
          }
        }
      }
    }

    // Simulate transmit leakage (loopback) into the receiver's spectrum
    if crate::safety::TX_TRANSMITTING.load(std::sync::atomic::Ordering::Relaxed)
    {
      use rand::SeedableRng;
      let before_tx_i = self.i_accumulator[..fft_size].to_vec();
      let before_tx_q = self.q_accumulator[..fft_size].to_vec();
      let active_tx_overlay_center_hz: f64;
      let tx_signal = crate::safety::TX_SIGNAL.lock().unwrap().clone();
      let tx_signal = canonical_complex_baseband_signal_key(&tx_signal);
      let tx_preset = resolve_mock_tx_preset(&tx_signal);
      let tx_power_dbm = *crate::safety::TX_POWER_DBM.lock().unwrap();
      // Mock APT is a verification receiver for Mock Tx, so render the Tx
      // overlay at the same monitor calibration instead of hiding it behind
      // an arbitrary coupling loss.
      let amp = 10.0f64
        .powf((tx_power_dbm - TxIqPowerModel::default().calibration_db) / 20.0);

      let hop_enabled = crate::safety::TX_HOP_ENABLED
        .load(std::sync::atomic::Ordering::Relaxed);
      if hop_enabled {
        let hop_rate = *crate::safety::TX_HOP_RATE_HZ.lock().unwrap();
        let elapsed_time_sec = self.total_samples as f64 / sample_rate;
        let hop_idx = (elapsed_time_sec * hop_rate) as usize;

        let current_freq = if crate::safety::TX_HOP_TYPE_IS_RANGE
          .load(std::sync::atomic::Ordering::Relaxed)
        {
          let start_hz = *crate::safety::TX_HOP_START_HZ.lock().unwrap();
          let end_hz = *crate::safety::TX_HOP_END_HZ.lock().unwrap();
          if start_hz >= end_hz {
            start_hz
          } else {
            let mut hop_rng = rand::rngs::StdRng::seed_from_u64(hop_idx as u64);
            hop_rng.random_range(start_hz..=end_hz)
          }
        } else {
          let mask = crate::safety::TX_HOP_CHANNELS_MASK
            .load(std::sync::atomic::Ordering::Relaxed);
          let mut target_freqs = Vec::new();
          if mask & 1 != 0 {
            target_freqs.push(2_204_000.0);
          }
          if mask & 2 != 0 {
            target_freqs.push(27_235_000.0);
          }
          if mask & 4 != 0 {
            target_freqs.push(13_875_000.0);
          }

          if target_freqs.is_empty() {
            2_204_000.0
          } else {
            let ch_idx = hop_idx % target_freqs.len();
            target_freqs[ch_idx]
          }
        };

        // Add band-limited noise spike at current_freq
        active_tx_overlay_center_hz = current_freq;
        let rel_freq = current_freq - center_freq;
        // Check if the signal is within the displayable passband
        if rel_freq.abs() <= (sample_rate / 2.0) + 100_000.0 {
          let phase_step = 2.0 * std::f64::consts::PI * rel_freq / sample_rate;
          for j in 0..fft_size {
            let t = self.total_samples + j as u64;
            let phase = phase_step * t as f64;
            let noise_val = self.rng.random_range(-1.0..1.0);
            let (p_im, p_re) = phase.sin_cos();
            self.i_accumulator[j] += noise_val * p_re * amp;
            self.q_accumulator[j] += noise_val * p_im * amp;
          }
        }
      } else {
        let active_tx_center_hz =
          *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap();
        let rel_freq = if active_tx_center_hz > 0.0 {
          active_tx_center_hz - center_freq
        } else {
          tx_preset.center_frequency_hz - center_freq
        };
        active_tx_overlay_center_hz = center_freq + rel_freq;
        // Only synthesize non-hop leakage if it is within the receiver passband
        if rel_freq.abs() <= (sample_rate / 2.0) + 100_000.0 {
          let phase_step = 2.0 * std::f64::consts::PI * rel_freq / sample_rate;
          let tx_bandwidth_hz = *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap();
          if tx_signal == "d"
            || tx_signal == "d_sharp"
            || tx_signal == "wifi"
            || tx_signal == "5g"
          {
            let tx_ifft_size = *crate::safety::TX_IFFT_SIZE.lock().unwrap();
            let render_ifft_size = tx_ifft_size.min(fft_size).max(256);
            let bw = if tx_bandwidth_hz > 0.0 {
              tx_bandwidth_hz
            } else {
              tx_preset.bandwidth_hz
            };
            let is_ofdm = tx_signal == "wifi" || tx_signal == "5g";
            let current_params = ComplexBasebandIQParams {
              signal_key: tx_signal.clone(),
              sample_rate_hz: sample_rate,
              bandwidth_hz: bw,
              tx_ifft_size: render_ifft_size,
              phase_seed: if is_ofdm { self.frame_log_counter } else { 0 },
            };
            let block = {
              let mut cache = COMPLEX_BASEBAND_IQ_CACHE.lock().unwrap();
              cache.prepare(&current_params);
              cache.snapshot_samples()
            };
            let block_cursor =
              (self.frame_log_counter as usize) % render_ifft_size;
            let frame_seed = self.frame_log_counter;

            let mut max_peak = 0.0_f64;
            for s in block.iter() {
              let peak = ((s.re * s.re + s.im * s.im) as f64).sqrt();
              if peak > max_peak {
                max_peak = peak;
              }
            }
            let peak_env = amp * max_peak;
            let scale = if peak_env > 0.95 {
              0.95 / peak_env
            } else {
              1.0
            };

            for j in 0..fft_size {
              let t = self.total_samples + j as u64;
              let phase = phase_step * t as f64;
              let (sin_p, cos_p) = phase.sin_cos();

              let block_sample = block
                [((t as usize + block_cursor) % render_ifft_size) as usize];
              let motion_gain = wifi_5g_motion_gain(&tx_signal, frame_seed, t);
              let i_sig = (block_sample.re as f64 * cos_p
                - block_sample.im as f64 * sin_p)
                * amp
                * scale
                * motion_gain;
              let q_sig = (block_sample.re as f64 * sin_p
                + block_sample.im as f64 * cos_p)
                * amp
                * scale
                * motion_gain;

              self.i_accumulator[j] += i_sig;
              self.q_accumulator[j] += q_sig;
            }
          } else if tx_signal == "tone" {
            for j in 0..fft_size {
              let t = self.total_samples + j as u64;
              let phase = phase_step * t as f64;
              let (p_im, p_re) = phase.sin_cos();
              self.i_accumulator[j] += p_re * amp;
              self.q_accumulator[j] += p_im * amp;
            }
          } else if tx_signal == "noise" {
            let bw = if tx_bandwidth_hz > 0.0 {
              tx_bandwidth_hz
            } else {
              tx_preset.bandwidth_hz
            };
            add_bandlimited_mock_tx_noise_overlay(
              &mut self.i_accumulator[..fft_size],
              &mut self.q_accumulator[..fft_size],
              rel_freq,
              bw,
              sample_rate,
              amp,
              self.total_samples,
            );
          } else if tx_signal == "custom" {
            let bw = if tx_bandwidth_hz > 0.0 {
              tx_bandwidth_hz
            } else {
              2_400_000.0
            };
            let symbol_rate = tx_preset.tone_hz * (bw / 2_400_000.0).min(1.0);
            let bit_period =
              (sample_rate / symbol_rate.max(1.0)).round().max(1.0) as u64;

            for j in 0..fft_size {
              let t = self.total_samples + j as u64;
              let phase = phase_step * t as f64;
              let (p_im, p_re) = phase.sin_cos();

              let bit_index = t / bit_period;
              let bit = (bit_index ^ (bit_index >> 1)) & 1;
              let symbol = if bit == 0 { -1.0 } else { 1.0 };
              let shaped = 0.75 + 0.25 * symbol;
              self.i_accumulator[j] += p_re * shaped * amp;
              self.q_accumulator[j] += p_im * symbol * amp * 0.5;
            }
          } else {
            for j in 0..fft_size {
              let t = self.total_samples + j as u64;
              let phase = phase_step * t as f64;
              let (p_im, p_re) = phase.sin_cos();

              let tone_phase = (2.0 * std::f64::consts::PI * tx_preset.tone_hz
                / sample_rate)
                * t as f64;
              let mod_val = 1.0 + 0.8 * tone_phase.sin();
              self.i_accumulator[j] += p_re * mod_val * amp;
              self.q_accumulator[j] += p_im * mod_val * amp;
            }
          }
        }
      }
      let tx_bandwidth_hz = *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap();
      let needs_bandwidth_constraint =
        tx_signal == "wifi" || tx_signal == "5g" || tx_signal == "noise";
      if needs_bandwidth_constraint {
        constrain_mock_apt_tx_overlay_to_bandwidth(
          &mut self.i_accumulator[..fft_size],
          &mut self.q_accumulator[..fft_size],
          &before_tx_i,
          &before_tx_q,
          active_tx_overlay_center_hz - center_freq,
          tx_bandwidth_hz,
          sample_rate,
        );
      }
    }

    // Keep the receiver's DC offset outside the signal/Tx overlay processing
    // so it remains a stable centered spike in every generated frame.
    for sample in self.i_accumulator[..fft_size].iter_mut() {
      *sample += MOCK_APT_DC_OFFSET;
    }

    // Apply noise, clip and quantize (Sequential to keep RNG identical).
    // If Metal is enabled, we only offload the final conversion stage and
    // keep the RNG on CPU so the seeded stream stays stable.
    let noise_amp_f64 = noise_amplitude as f64;

    #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
    if self.metal_backend.is_some() {
      let (noise_i, noise_q) =
        self.build_noise_buffers(fft_size, noise_amp_f64);
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
      let noise_i_f32: Vec<f32> =
        noise_i.iter().copied().map(|value| value as f32).collect();
      let noise_q_f32: Vec<f32> =
        noise_q.iter().copied().map(|value| value as f32).collect();

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
          self.samples_since_retune =
            self.samples_since_retune.wrapping_add(fft_size as u64);
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
            fft_size, noise_i, noise_q,
          );
        }
      }
    }

    // Write directly into the pre-reserved byte_buffer via pointer to avoid
    // 2×fft_size bounds-checked push() calls (already reserved on line 522).
    let buf_ptr = self.byte_buffer.as_mut_ptr();
    let stochastic_tx_quantization =
      crate::safety::TX_TRANSMITTING.load(std::sync::atomic::Ordering::Relaxed);
    for j in 0..fft_size {
      let sample_index = self.total_samples + j as u64;
      let i_noise = (self.rng.random::<f64>() - 0.5) * 2.0 * noise_amp_f64;
      let q_noise = (self.rng.random::<f64>() - 0.5) * 2.0 * noise_amp_f64;

      let i_u8 = quantize_mock_apt_sample(
        self.i_accumulator[j] + i_noise,
        sample_index,
        MOCK_APT_I_DITHER_KEY,
        stochastic_tx_quantization,
      );
      let q_u8 = quantize_mock_apt_sample(
        self.q_accumulator[j] + q_noise,
        sample_index,
        MOCK_APT_Q_DITHER_KEY,
        stochastic_tx_quantization,
      );

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
    self.samples_since_retune =
      self.samples_since_retune.wrapping_add(fft_size as u64);

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
    self.samples_since_retune =
      self.samples_since_retune.wrapping_add(fft_size as u64);

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

  /// Enable or disable realistic RF modeling.
  pub fn set_realistic_rf_config(&mut self, config: MockAptRealisticRfConfig) {
    self.realistic_rf = config;
  }

  /// Set the realistic-mode retune settling duration in samples.
  pub fn set_retune_settle_time(&mut self, samples: u64) {
    self.retune_settle_time_samples = samples;
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

  #[test]
  fn mock_tx_overlay_cache_reuses_plans_when_phase_changes() {
    let mut cache = ComplexBasebandIQBuffer::new();
    let mut params = ComplexBasebandIQParams {
      signal_key: "wifi".to_string(),
      sample_rate_hz: 3_200_000.0,
      bandwidth_hz: 100_000.0,
      tx_ifft_size: 1024,
      phase_seed: 1,
    };

    cache.prepare(&params);
    let first_capacity = cache.samples.capacity();
    params.phase_seed = 2;
    cache.prepare(&params);

    assert_eq!(cache.samples.len(), 1024);
    assert_eq!(cache.samples.capacity(), first_capacity);
    assert_eq!(cache.generator.cached_fft_size_count(), 1);
  }

  fn write_test_signals_yaml(
    path: &std::path::Path,
    spike_hz: u32,
    noise_floor_db: i32,
    gpu_gen_via_metal: bool,
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
    gpu_gen_via_metal: {gpu_gen_via_metal}
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
    write_test_signals_yaml(&yaml_path, 500_000, -95, false);
    let mut device = MockAptDevice::new();
    assert_eq!(device.signals.len(), 9);
    assert_eq!(device.noise_floor_db, -95.0);

    sleep(Duration::from_millis(300));
    write_test_signals_yaml(&yaml_path, 1_000_000, -70, false);
    sleep(Duration::from_millis(300));

    device.reload_config_if_needed();

    assert_eq!(device.signals.len(), 5);
    assert_eq!(device.noise_floor_db, -70.0);

    std::env::set_current_dir(&original_dir).expect("restore dir");
    let _ = fs::remove_dir_all(&temp_dir);
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  #[test]
  fn gpu_gen_via_metal_controls_mock_apt_backend() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    let original_dir = std::env::current_dir().expect("current dir");
    let temp_dir = std::env::temp_dir().join(format!(
      "napt-mock-metal-config-{}",
      SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("time")
        .as_nanos()
    ));
    fs::create_dir_all(&temp_dir).expect("create temp dir");
    std::env::set_current_dir(&temp_dir).expect("set current dir");
    crate::server::utils::clear_signals_config_cache();

    let yaml_path = temp_dir.join("signals.yaml");
    write_test_signals_yaml(&yaml_path, 500_000, -95, false);
    let mut device = MockAptDevice::new();
    assert!(!device.gpu_backend_enabled());
    assert_eq!(device.device_type(), "Mock APT SDR");

    sleep(Duration::from_millis(300));
    write_test_signals_yaml(&yaml_path, 500_000, -95, true);
    crate::server::utils::clear_signals_config_cache();
    let metal_device = MockAptDevice::new();

    if MockAptDevice::metal_backend_available() {
      assert!(metal_device.gpu_backend_enabled());
      assert_eq!(metal_device.device_type(), "Mock APT SDR (Metal)");
      assert_eq!(metal_device.generation_backend_label(), "Metal");
    } else {
      assert!(!metal_device.gpu_backend_enabled());
      assert!(metal_device.gpu_backend_error().is_some());
    }

    sleep(Duration::from_millis(300));
    write_test_signals_yaml(&yaml_path, 500_000, -95, false);
    crate::server::utils::clear_signals_config_cache();
    device.reload_config_if_needed();
    assert!(!device.gpu_backend_enabled());
    assert_eq!(device.device_type(), "Mock APT SDR");

    std::env::set_current_dir(&original_dir).expect("restore dir");
    crate::server::utils::clear_signals_config_cache();
    let _ = fs::remove_dir_all(&temp_dir);
  }
}
