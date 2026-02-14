use anyhow::Result;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use webauthn_rs::prelude::*;

use n_apt_backend::consts::rs::fft::{FFT_MAX_DB, FFT_MIN_DB, NUM_SAMPLES, SAMPLE_RATE};
use n_apt_backend::consts::rs::mock::{
  MOCK_NOISE_FLOOR_BASE, MOCK_NOISE_FLOOR_VARIATION, MOCK_SPECTRUM_SIZE, MOCK_PERSISTENT_SIGNALS,
  MOCK_NARROW_BAND_WIDTH, MOCK_WIDE_BAND_WIDTH, MOCK_SIGNAL_DRIFT_RATE, MOCK_SIGNAL_MODULATION_RATE,
  MOCK_STRONG_SIGNAL_MAX, MOCK_STRONG_SIGNAL_MIN, MOCK_MEDIUM_SIGNAL_MAX, MOCK_MEDIUM_SIGNAL_MIN,
  MOCK_WEAK_SIGNAL_MAX, MOCK_WEAK_SIGNAL_MIN, MOCK_SIGNAL_APPEARANCE_CHANCE,
  MOCK_SIGNAL_DISAPPEARANCE_CHANCE, MOCK_SIGNAL_STRENGTH_VARIATION,
};
use n_apt_backend::credentials::CredentialStore;
use n_apt_backend::crypto;
use n_apt_backend::fft::{FFTProcessor, FFTResult, RawSamples};
use n_apt_backend::rtlsdr::RtlSdrDevice;
use n_apt_backend::rtlsdr::ffi as rtlsdr_ffi;
use n_apt_backend::consts::rs::env::{WS_HOST, WS_PORT};
use n_apt_backend::session::SessionStore;
use n_apt_backend::stitching::SignalStitcher;

const SERVER_SPECTRUM_BINS: usize = 4096;
/// Passkey for AES-256-GCM encryption. Read from N_APT_PASSKEY env var at startup.
/// Falls back to a default for development.
const DEFAULT_PASSKEY: &str = "n-apt-dev-key";
/// Number of async USB transfer buffers (librtlsdr default is 15)
const ASYNC_BUF_NUM: u32 = 15;
/// Size of each async USB buffer in bytes. 32KB = ~5ms at 3.2 MSPS.
/// Smaller buffers = lower latency and more frequent callbacks.
const ASYNC_BUF_LEN: u32 = 32768;

/// How often to probe for a newly attached RTL-SDR while running in mock mode.
const DEVICE_PROBE_INTERVAL: Duration = Duration::from_millis(200);

const DISCONNECT_DEBOUNCE_STREAK: u32 = 3;

fn reconcile_device_state(device_connected: bool, device_state: &str) -> String {
  if device_connected && device_state == "disconnected" {
    "connected".to_string()
  } else if !device_connected && device_state == "connected" {
    "disconnected".to_string()
  } else {
    device_state.to_string()
  }
}

fn next_missing_device_probe_streak(prev: u32, device_count: u32) -> u32 {
  if device_count == 0 {
    prev.saturating_add(1)
  } else {
    0
  }
}

fn should_declare_disconnected(missing_streak: u32) -> bool {
  missing_streak >= DISCONNECT_DEBOUNCE_STREAK
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reconcile_device_state_prefers_boolean_when_string_is_stale() {
    assert_eq!(reconcile_device_state(true, "disconnected"), "connected");
    assert_eq!(reconcile_device_state(false, "connected"), "disconnected");
  }

  #[test]
  fn reconcile_device_state_preserves_other_states() {
    assert_eq!(reconcile_device_state(true, "loading"), "loading");
    assert_eq!(reconcile_device_state(true, "stale"), "stale");
    assert_eq!(reconcile_device_state(false, "loading"), "loading");
    assert_eq!(reconcile_device_state(false, "stale"), "stale");
  }

  #[test]
  fn disconnect_debounce_requires_consecutive_missing_probes() {
    let mut streak = 0;
    streak = next_missing_device_probe_streak(streak, 1);
    assert_eq!(streak, 0);
    assert!(!should_declare_disconnected(streak));

    streak = next_missing_device_probe_streak(streak, 0);
    assert_eq!(streak, 1);
    assert!(!should_declare_disconnected(streak));

    streak = next_missing_device_probe_streak(streak, 0);
    assert_eq!(streak, 2);
    assert!(!should_declare_disconnected(streak));

    streak = next_missing_device_probe_streak(streak, 0);
    assert_eq!(streak, 3);
    assert!(should_declare_disconnected(streak));

    // Any non-zero count resets the streak.
    streak = next_missing_device_probe_streak(streak, 1);
    assert_eq!(streak, 0);
    assert!(!should_declare_disconnected(streak));
  }
}

/// Command enum for the dedicated SDR I/O thread
enum SdrCommand {
  SetFrequency(u32),
  SetGain(f64),
  SetPpm(i32),
  SetTunerAGC(bool),
  SetRtlAGC(bool),
  RestartDevice,
  StartTraining { label: String, signal_area: String },
  StopTraining,
  ApplySettings {
    fft_size: Option<usize>,
    fft_window: Option<String>,
    frame_rate: Option<u32>,
    gain: Option<f64>,
    ppm: Option<i32>,
    tuner_agc: Option<bool>,
    rtl_agc: Option<bool>,
  },
}

/// WebSocket message structure for client-server communication
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WebSocketMessage {
  #[serde(rename = "type")]
  message_type: String,
  #[serde(skip_serializing_if = "Option::is_none", alias = "minFreq")]
  min_freq: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "maxFreq")]
  max_freq: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  paused: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  gain: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  ppm: Option<i32>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "tunerAGC")]
  tuner_agc: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "rtlAGC")]
  rtl_agc: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "fftSize")]
  fft_size: Option<usize>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "fftWindow")]
  fft_window: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "frameRate")]
  frame_rate: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "liveRetune")]
  live_retune: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  label: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "signalArea")]
  signal_area: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  action: Option<String>,
}

/// Spectrum data message sent to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SpectrumData {
  #[serde(rename = "type")]
  message_type: String,
  waveform: Vec<f32>,
  waterfall: Vec<f32>,
  is_mock: bool,
  timestamp: i64,
}

/// Status message sent to new clients on connection
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StatusMessage {
  #[serde(rename = "type")]
  message_type: String,
  device_connected: bool,
  paused: bool,
  backend: String,
  device_info: String,
  max_sample_rate: u32,
}

/// Structured signal pattern for consistent waterfall visualization
#[derive(Debug, Clone)]
struct MockSignal {
  center_bin: f32,
  drift_offset: f32,
  bandwidth: usize,
  base_strength: f32,
  modulation_phase: f32,
  active: bool,
  signal_type: SignalType,
}

#[derive(Debug, Clone)]
enum SignalType {
  Narrow,
  Medium,
  Wide,
}

impl SignalType {
  fn bandwidth(&self) -> usize {
    match self {
      SignalType::Narrow => MOCK_NARROW_BAND_WIDTH,
      SignalType::Medium => (MOCK_NARROW_BAND_WIDTH + MOCK_WIDE_BAND_WIDTH) / 2,
      SignalType::Wide => MOCK_WIDE_BAND_WIDTH,
    }
  }

  fn random_strength_range(&self, rng: &mut rand::rngs::ThreadRng) -> f32 {
    match self {
      SignalType::Narrow => rng.gen_range(MOCK_WEAK_SIGNAL_MIN..MOCK_WEAK_SIGNAL_MAX),
      SignalType::Medium => rng.gen_range(MOCK_MEDIUM_SIGNAL_MIN..MOCK_MEDIUM_SIGNAL_MAX),
      SignalType::Wide => rng.gen_range(MOCK_STRONG_SIGNAL_MIN..MOCK_STRONG_SIGNAL_MAX),
    }
  }
}

fn downsample_spectrum(data: &[f32], target_len: usize) -> Vec<f32> {
  n_apt_backend::native_simd::fft_simd::downsample_spectrum_simd(data, target_len)
}

/// SDR processor wrapper that handles both real and mock SDR devices.
/// Runs on a dedicated std::thread — all blocking device I/O happens here,
/// never on the tokio async runtime.
struct SDRProcessor {
  /// FFT processor for signal processing
  fft_processor: FFTProcessor,
  /// Whether we're using mock data
  is_mock: bool,
  /// RTL-SDR device handle (None when in mock mode)
  device: Option<RtlSdrDevice>,
  /// Persistent mock signals for structured waterfall patterns
  mock_signals: Vec<MockSignal>,
  /// Frame counter for time-based signal evolution
  frame_counter: u64,
  /// Number of IQ bytes to read per frame (2 bytes per sample × FFT size)
  read_size: usize,
  /// Exponential moving average buffer for frame averaging
  avg_spectrum: Option<Vec<f32>>,
  /// EMA smoothing factor (0.0 = no smoothing, 1.0 = no averaging)
  avg_alpha: f32,
  /// Current center frequency in Hz (used for mock signal shifting)
  center_freq: u32,
  /// Cached gain in tenths of dB — skip USB transfer if unchanged
  cached_gain_tenths: i32,
  /// Cached PPM correction — skip USB transfer if unchanged
  cached_ppm: i32,
  /// IQ sample accumulator — fed by async reader callback, drained by FFT processing
  iq_accumulator: Vec<u8>,
  /// Current read offset into iq_accumulator (avoids memmove on every frame)
  iq_offset: usize,
  /// Reusable IQ frame buffer (avoids per-frame Vec allocation)
  iq_frame: Vec<u8>,
  /// Validated frame rate for display (clamped to theoretical maximum)
  display_frame_rate: u32,
  /// Whether training capture is active
  training_active: bool,
  /// Current training label ("target" or "noise")
  training_label: Option<String>,
  /// Current training signal area ("A" or "B")
  training_signal_area: Option<String>,
  /// Signal stitcher for accumulating FFT frames during training
  training_stitcher: Option<SignalStitcher>,
  /// Accumulated completed training samples (flushed to CoreML service)
  training_samples: Vec<n_apt_backend::stitching::TrainingSample>,
}

impl SDRProcessor {
  /// Create a new SDR processor instance
  fn new() -> Self {
    let mut processor = Self {
      fft_processor: FFTProcessor::new(),
      is_mock: true,
      device: None,
      mock_signals: Vec::new(),
      frame_counter: 0,
      read_size: NUM_SAMPLES * 2, // IQ interleaved: 2 bytes per complex sample
      avg_spectrum: None,
      avg_alpha: 0.3,
      center_freq: n_apt_backend::consts::rs::fft::CENTER_FREQ,
      cached_gain_tenths: 496, // 49.6 dB default (matches Sidebar default)
      cached_ppm: 1, // matches Sidebar default
      iq_accumulator: Vec::with_capacity(NUM_SAMPLES * 4),
      iq_offset: 0,
      iq_frame: Vec::with_capacity(NUM_SAMPLES * 2),
      display_frame_rate: 30, // Default frame rate
      training_active: false,
      training_label: None,
      training_signal_area: None,
      training_stitcher: None,
      training_samples: Vec::new(),
    };
    processor.initialize_mock_signals();
    processor
  }

  /// Initialize structured mock signals for consistent waterfall patterns
  fn initialize_mock_signals(&mut self) {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    
    self.mock_signals.clear();
    
    // Place signals randomly across the FULL spectrum (0..MOCK_SPECTRUM_SIZE)
    // so both signal areas A and B have activity.
    for i in 0..MOCK_PERSISTENT_SIGNALS {
      // Random placement across the entire spectrum width
      let center_bin = rng.gen_range(10.0..(MOCK_SPECTRUM_SIZE as f32 - 10.0));
      
      // Vary signal types for diversity
      let signal_type = match i % 3 {
        0 => SignalType::Narrow,
        1 => SignalType::Medium,
        _ => SignalType::Wide,
      };
      
      let bandwidth = signal_type.bandwidth();
      let base_strength = signal_type.random_strength_range(&mut rng);
      
      self.mock_signals.push(MockSignal {
        center_bin,
        drift_offset: 0.0,
        bandwidth,
        base_strength,
        modulation_phase: rng.gen_range(0.0..2.0 * std::f32::consts::PI),
        active: true,
        signal_type,
      });
    }
  }

  /// Initialize the SDR processor
  ///
  /// Attempts to open a real RTL-SDR device. Falls back to mock mode if
  /// no device is found or if initialization fails.
  fn initialize(&mut self) -> Result<()> {
    let device_count = RtlSdrDevice::get_device_count();
    info!("RTL-SDR device count: {}", device_count);

    if device_count > 0 {
      match RtlSdrDevice::open_first() {
        Ok(dev) => {
          // Configure the device
          if let Err(e) = dev.set_sample_rate(SAMPLE_RATE) {
            warn!("Failed to set sample rate: {}. Falling back to mock mode.", e);
            self.is_mock = true;
            return Ok(());
          }
          if let Err(e) = dev.set_center_freq(n_apt_backend::consts::rs::fft::CENTER_FREQ) {
            warn!("Failed to set center freq: {}. Falling back to mock mode.", e);
            self.is_mock = true;
            return Ok(());
          }
          // Default gain: 49.6 dB (496 tenths)
          if let Err(e) = dev.set_tuner_gain(496) {
            warn!("Failed to set gain: {}. Continuing with default.", e);
          }
          if let Err(e) = dev.set_agc_mode(false) {
            warn!("Failed to disable AGC: {}", e);
          }
          if let Err(e) = dev.reset_buffer() {
            warn!("Failed to reset buffer: {}. Falling back to mock mode.", e);
            self.is_mock = true;
            return Ok(());
          }

          info!("RTL-SDR device initialized: {}", dev.get_device_info());
          self.device = Some(dev);
          self.is_mock = false;
        }
        Err(e) => {
          warn!("Could not open RTL-SDR device: {}. Using mock mode.", e);
          self.is_mock = true;
        }
      }
    } else {
      warn!("No RTL-SDR devices found. Using mock mode.");
      self.is_mock = true;
    }

    Ok(())
  }

  /// Attempt to connect to an RTL-SDR if one is available.
  ///
  /// Returns `Ok(true)` when a device was successfully opened + configured.
  fn try_connect_device(&mut self) -> Result<bool> {
    if self.device.is_some() {
      self.is_mock = false;
      return Ok(true);
    }

    let device_count = RtlSdrDevice::get_device_count();
    if device_count == 0 {
      return Ok(false);
    }

    match RtlSdrDevice::open_first() {
      Ok(dev) => {
        if let Err(e) = dev.set_sample_rate(SAMPLE_RATE) {
          warn!("Failed to set sample rate: {}. Staying in mock mode.", e);
          return Ok(false);
        }
        if let Err(e) = dev.set_center_freq(n_apt_backend::consts::rs::fft::CENTER_FREQ) {
          warn!("Failed to set center freq: {}. Staying in mock mode.", e);
          return Ok(false);
        }
        if let Err(e) = dev.set_tuner_gain(self.cached_gain_tenths) {
          warn!("Failed to set gain: {}. Continuing with default.", e);
        }
        if let Err(e) = dev.set_agc_mode(false) {
          warn!("Failed to disable AGC: {}", e);
        }
        if let Err(e) = dev.reset_buffer() {
          warn!("Failed to reset buffer: {}. Staying in mock mode.", e);
          return Ok(false);
        }

        info!("RTL-SDR device initialized (hotplug): {}", dev.get_device_info());
        self.device = Some(dev);
        self.is_mock = false;
        self.iq_accumulator.clear();
        self.iq_offset = 0;
        self.avg_spectrum = None;
        Ok(true)
      }
      Err(e) => {
        debug!("RTL-SDR present but could not open: {}", e);
        Ok(false)
      }
    }
  }

  /// Enter mock mode without touching the device handle.
  /// The I/O loop is responsible for cancelling async read + joining the reader
  /// thread + calling release_device() BEFORE the device is dropped.
  fn enter_mock_mode(&mut self) {
    if !self.is_mock {
      warn!("Switching to mock mode.");
      self.is_mock = true;
      self.iq_accumulator.clear();
      self.iq_offset = 0;
      if self.mock_signals.is_empty() {
        self.initialize_mock_signals();
      }
    }
  }

  /// Release the device handle (calls rtlsdr_close via Drop).
  /// MUST only be called after cancel_async + join reader thread.
  fn release_device(&mut self) {
    self.device = None;
  }

  /// Set the center frequency for the SDR (called on the dedicated I/O thread)
  fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
    if freq == self.center_freq {
      return Ok(());
    }
    let mut device_failed = false;
    if let Some(ref dev) = self.device {
      if let Err(e) = dev.set_center_freq(freq) {
        warn!("Device error setting frequency: {}. Entering mock mode.", e);
        device_failed = true;
      } else {
        // Clear accumulator + averaging so stale data doesn't bleed into new frequency
        self.iq_accumulator.clear();
        self.iq_offset = 0;
        self.avg_spectrum = None;
      }
    }
    if device_failed {
      self.enter_mock_mode();
    }
    // Track center freq for mock signal shifting
    let old_freq = self.center_freq;
    self.center_freq = freq;
    if self.is_mock && old_freq != freq {
      let freq_delta = freq as f64 - old_freq as f64;
      let bin_shift = (freq_delta / SAMPLE_RATE as f64) * MOCK_SPECTRUM_SIZE as f64;
      for signal in &mut self.mock_signals {
        signal.center_bin -= bin_shift as f32;
      }
    }
    Ok(())
  }

  /// Set the gain for the SDR (skips USB transfer if value unchanged)
  fn set_gain(&mut self, gain: f64) -> Result<()> {
    let tenths = (gain * 10.0) as i32;
    if tenths == self.cached_gain_tenths {
      return Ok(());
    }
    let mut device_failed = false;
    if let Some(ref dev) = self.device {
      match dev.set_tuner_gain(tenths) {
        Ok(()) => {
          self.cached_gain_tenths = tenths;
          debug!("Hardware gain set to {} dB (tenths: {})", gain, tenths);
        }
        Err(e) => {
          warn!("Device error setting gain: {}. Entering mock mode.", e);
          device_failed = true;
        }
      }
    }
    if device_failed {
      self.enter_mock_mode();
    }
    Ok(())
  }

  /// Set tuner AGC mode (automatic vs manual gain control)
  fn set_tuner_agc(&mut self, automatic: bool) -> Result<()> {
    if let Some(ref dev) = self.device {
      match dev.set_tuner_gain_mode(!automatic) {
        Ok(()) => {
          debug!("Tuner AGC set to automatic: {}", automatic);
        }
        Err(e) => {
          warn!("Device error setting tuner AGC: {}. Entering mock mode.", e);
          self.enter_mock_mode();
        }
      }
    }
    Ok(())
  }

  /// Set RTL AGC mode (automatic gain correction)
  fn set_rtl_agc(&mut self, enabled: bool) -> Result<()> {
    if let Some(ref dev) = self.device {
      match dev.set_agc_mode(enabled) {
        Ok(()) => {
          debug!("RTL AGC set to enabled: {}", enabled);
        }
        Err(e) => {
          warn!("Device error setting RTL AGC: {}. Entering mock mode.", e);
          self.enter_mock_mode();
        }
      }
    }
    Ok(())
  }

  /// Apply settings from a WebSocket settings message
  fn apply_settings(&mut self, fft_size: Option<usize>, fft_window: Option<String>, frame_rate: Option<u32>, gain: Option<f64>, ppm: Option<i32>, tuner_agc: Option<bool>, rtl_agc: Option<bool>) -> Result<()> {
    let mut config = self.fft_processor.config().clone();
    let mut config_changed = false;

    if let Some(size) = fft_size {
      if size > 0 && (size & (size - 1)) == 0 {
        if config.fft_size != size {
          config.fft_size = size;
          self.read_size = size * 2;
          self.avg_spectrum = None;
          config_changed = true;
          info!("FFT size changed to {}", size);
        }
      } else {
        warn!("Invalid FFT size {} (must be power of 2), ignoring", size);
      }
    }

    if let Some(ref window_name) = fft_window {
      let window_type = match window_name.to_lowercase().as_str() {
        "rectangular" | "none" => n_apt_backend::fft::WindowType::Rectangular,
        "hanning" | "hann" => n_apt_backend::fft::WindowType::Hanning,
        "hamming" => n_apt_backend::fft::WindowType::Hamming,
        "blackman" => n_apt_backend::fft::WindowType::Blackman,
        "nuttall" => n_apt_backend::fft::WindowType::Nuttall,
        _ => {
          warn!("Unknown window type '{}', using Rectangular", window_name);
          n_apt_backend::fft::WindowType::Rectangular
        }
      };
      if config.window_type != window_type {
        config.window_type = window_type;
        config_changed = true;
        info!("FFT window changed to {:?}", window_type);
      }
    }

    // Validate and clamp frame rate
    if let Some(requested_rate) = frame_rate {
      let max_rate = self.calculate_max_frame_rate(config.fft_size);
      let clamped_rate = requested_rate.clamp(1, max_rate);
      
      if clamped_rate != requested_rate {
        warn!("Requested frame rate {} fps exceeds maximum {} fps for FFT size {}, clamping to {}", 
              requested_rate, max_rate, config.fft_size, clamped_rate);
      }
      
      // Store the validated frame rate for use in the processing loop
      self.display_frame_rate = clamped_rate;
      info!("Frame rate set to {} fps", clamped_rate);
    }

    if let Some(g) = gain {
      let _ = self.set_gain(g);
    }

    if let Some(p) = ppm {
      let _ = self.set_ppm(p);
    }

    if let Some(tuner_agc) = tuner_agc {
      let _ = self.set_tuner_agc(tuner_agc);
    }

    if let Some(rtl_agc) = rtl_agc {
      let _ = self.set_rtl_agc(rtl_agc);
    }

    if config_changed {
      if !self.is_mock {
        config.gain = 1.0;
      }
      self.fft_processor.update_config(config);
    }

    Ok(())
  }

  /// Set the PPM correction for the SDR (skips USB transfer if value unchanged)
  fn set_ppm(&mut self, ppm: i32) -> Result<()> {
    if ppm == self.cached_ppm {
      return Ok(());
    }
    if let Some(ref dev) = self.device {
      dev.set_freq_correction(ppm)?;
    }
    self.cached_ppm = ppm;
    let mut config = self.fft_processor.config().clone();
    config.ppm = ppm as f32;
    self.fft_processor.update_config(config);
    Ok(())
  }

  /// Check if the accumulator has enough IQ data for a complete FFT frame
  fn has_complete_frame(&self) -> bool {
    self.iq_accumulator.len().saturating_sub(self.iq_offset) >= self.read_size
  }

  /// Process one FFT frame from the IQ accumulator (no device read — data comes from async callback)
  fn process_iq_frame(&mut self) -> Result<Vec<f32>> {
    let start = self.iq_offset;
    let end = start + self.read_size;

    let mut frame = std::mem::take(&mut self.iq_frame);
    if frame.len() != self.read_size {
      frame.resize(self.read_size, 0);
    }
    frame.copy_from_slice(&self.iq_accumulator[start..end]);
    self.iq_offset = end;

    // Occasionally compact the accumulator to avoid unbounded growth.
    // This is O(n) but happens infrequently (amortized O(1) per frame).
    if self.iq_offset >= self.read_size.saturating_mul(8) {
      let remaining = self.iq_accumulator.len().saturating_sub(self.iq_offset);
      if remaining > 0 {
        self.iq_accumulator.copy_within(self.iq_offset.., 0);
      }
      self.iq_accumulator.truncate(remaining);
      self.iq_offset = 0;
    }

    let samples = RawSamples {
      data: frame,
      sample_rate: SAMPLE_RATE,
    };
    let result = self.fft_processor.process_samples(&samples)?;
    self.iq_frame = samples.data;
    let mut spectrum = result.power_spectrum;

    // DC spike suppression: interpolate center bins
    let len = spectrum.len();
    if len > 6 {
      let center = len / 2;
      let left = spectrum[center - 3];
      let right = spectrum[center + 3];
      for i in 0..5 {
        let t = (i + 1) as f32 / 6.0;
        spectrum[center - 2 + i] = left * (1.0 - t) + right * t;
      }
    }

    // Frame averaging (exponential moving average)
    let alpha = self.avg_alpha;
    if let Some(ref mut avg) = self.avg_spectrum {
      if avg.len() == spectrum.len() {
        for (i, val) in spectrum.iter().enumerate() {
          avg[i] = alpha * val + (1.0 - alpha) * avg[i];
        }
        Ok(avg.clone())
      } else {
        self.avg_spectrum = Some(spectrum.clone());
        Ok(spectrum)
      }
    } else {
      self.avg_spectrum = Some(spectrum.clone());
      Ok(spectrum)
    }
  }

  /// Generate mock spectrum data with structured signal patterns
  fn read_and_process_mock(&mut self) -> Result<Vec<f32>> {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let mut data = Vec::with_capacity(MOCK_SPECTRUM_SIZE);

    self.frame_counter = self.frame_counter.wrapping_add(1);

    for _i in 0..MOCK_SPECTRUM_SIZE {
      let noise_floor = MOCK_NOISE_FLOOR_BASE
        + rng.gen_range(-MOCK_NOISE_FLOOR_VARIATION..MOCK_NOISE_FLOOR_VARIATION);
      data.push(noise_floor.clamp(FFT_MIN_DB as f32, FFT_MAX_DB as f32));
    }

    for signal in &mut self.mock_signals {
      if signal.active && rng.gen::<f32>() < MOCK_SIGNAL_DISAPPEARANCE_CHANCE {
        signal.active = false;
      } else if !signal.active && rng.gen::<f32>() < MOCK_SIGNAL_APPEARANCE_CHANCE {
        signal.active = true;
      }

      if signal.active {
        signal.drift_offset += rng.gen_range(-MOCK_SIGNAL_DRIFT_RATE..MOCK_SIGNAL_DRIFT_RATE);
        signal.drift_offset = signal.drift_offset.clamp(-5.0, 5.0);

        signal.modulation_phase += MOCK_SIGNAL_MODULATION_RATE;
        if signal.modulation_phase > 2.0 * std::f32::consts::PI {
          signal.modulation_phase -= 2.0 * std::f32::consts::PI;
        }

        let modulation = signal.modulation_phase.sin() * 0.3 + 0.7;
        let strength_variation = rng.gen_range(-MOCK_SIGNAL_STRENGTH_VARIATION..MOCK_SIGNAL_STRENGTH_VARIATION);
        let current_strength = signal.base_strength * modulation + strength_variation;

        let current_bin = signal.center_bin + signal.drift_offset;
        let half_bandwidth = signal.bandwidth as f32 / 2.0;
        
        for bin_offset in 0..signal.bandwidth as i32 {
          let bin_index = (current_bin + bin_offset as f32 - half_bandwidth) as i32;
          
          if bin_index >= 0 && bin_index < MOCK_SPECTRUM_SIZE as i32 {
            let bin_idx = bin_index as usize;
            let distance_from_center = (bin_offset as f32 - half_bandwidth).abs();
            let signal_profile = (-distance_from_center.powi(2)
              / (2.0 * (signal.bandwidth as f32 / 4.0).powi(2)))
              .exp();

            // Convert Gaussian profile to a negative dB offset.
            // signal_profile is in (0, 1]; 10*log10(profile) is <= 0 dB.
            let profile_db = 10.0 * signal_profile.max(1e-12).log10();

            // Interpret current_strength as dB above the local noise floor.
            // This keeps signals in a realistic dB range (well below 0 dB).
            let peak_db = data[bin_idx] + current_strength;
            let signal_contribution_db = peak_db + profile_db;

            // Ensure the final value never exceeds 0dB
            let final_value = data[bin_idx].max(signal_contribution_db);
            data[bin_idx] = final_value.min(FFT_MAX_DB as f32);
          }
        }
      }
    }

    Ok(data)
  }

  /// Generate a mock signal using the FFT processor
  #[allow(dead_code)]
  fn generate_mock_signal(&mut self) -> Result<FFTResult> {
    self.fft_processor.generate_mock_signal(None)
  }

  /// Get device information string
  fn get_device_info(&self) -> String {
    if let Some(ref dev) = self.device {
      dev.get_device_info()
    } else {
      let config = self.fft_processor.config();
      format!(
        "Mock RTL-SDR Device - Sample Rate: {} Hz (max: {} Hz), Gain: {} dB, PPM: {}",
        config.sample_rate, config.sample_rate, config.gain as i32, config.ppm as i32
      )
    }
  }

  /// Get the current sample rate from device or config
  fn get_current_sample_rate(&self) -> u32 {
    if let Some(ref dev) = self.device {
      dev.get_sample_rate()
    } else {
      self.fft_processor.config().sample_rate
    }
  }

  /// Get the maximum supported sample rate from device or config
  fn get_max_sample_rate(&self) -> u32 {
    if let Some(ref dev) = self.device {
      dev.get_max_sample_rate()
    } else {
      self.fft_processor.config().sample_rate
    }
  }

  /// Calculate maximum theoretical frame rate based on sample rate and FFT size
  fn calculate_max_frame_rate(&self, fft_size: usize) -> u32 {
    let sample_rate = self.get_current_sample_rate();
    let max_theoretical = sample_rate as f32 / fft_size as f32;
    // Cap at screen refresh rate (assume 60Hz as default)
    max_theoretical.min(60.0) as u32
  }

  /// Process a command from the async runtime (called on the dedicated I/O thread)
  fn handle_command(&mut self, cmd: SdrCommand) {
    match cmd {
      SdrCommand::SetFrequency(freq) => {
        if let Err(e) = self.set_center_frequency(freq) {
          warn!("Failed to set frequency: {}", e);
        }
      }
      SdrCommand::SetGain(gain) => {
        if let Err(e) = self.set_gain(gain) {
          warn!("Failed to set gain: {}", e);
        }
      }
      SdrCommand::SetPpm(ppm) => {
        if let Err(e) = self.set_ppm(ppm) {
          warn!("Failed to set PPM: {}", e);
        }
      }
      SdrCommand::SetTunerAGC(automatic) => {
        if let Err(e) = self.set_tuner_agc(automatic) {
          warn!("Failed to set tuner AGC: {}", e);
        }
      }
      SdrCommand::SetRtlAGC(enabled) => {
        if let Err(e) = self.set_rtl_agc(enabled) {
          warn!("Failed to set RTL AGC: {}", e);
        }
      }
      SdrCommand::RestartDevice => {
        // Handled in the I/O loop directly (needs reader thread teardown)
      }
      SdrCommand::StartTraining { label, signal_area } => {
        let fft_size = self.fft_processor.fft_size();
        // Accumulate 15 frames (~500ms at 30fps) before yielding a training sample
        let target_frames = 15;
        info!("Training capture started: label={}, area={}, fft_size={}, target_frames={}",
          label, signal_area, fft_size, target_frames);
        self.training_stitcher = Some(SignalStitcher::new(fft_size, target_frames));
        self.training_label = Some(label);
        self.training_signal_area = Some(signal_area);
        self.training_active = true;
      }
      SdrCommand::StopTraining => {
        info!("Training capture stopped. Accumulated {} complete samples", self.training_samples.len());
        // Finalize any partial data in the stitcher
        if let Some(ref mut stitcher) = self.training_stitcher {
          if let Some(data) = stitcher.finalize() {
            let sample = n_apt_backend::stitching::TrainingSample {
              signal_area: self.training_signal_area.clone().unwrap_or_default(),
              label: self.training_label.clone().unwrap_or_default(),
              data,
              timestamp: chrono::Utc::now().timestamp_millis(),
              frequency_min: 0.0,
              frequency_max: 0.0,
              sample_rate: SAMPLE_RATE,
            };
            self.training_samples.push(sample);
          }
        }
        self.training_active = false;
        self.training_label = None;
        self.training_signal_area = None;
        self.training_stitcher = None;
        info!("Training stopped. Total samples collected: {}", self.training_samples.len());
      }
      SdrCommand::ApplySettings { fft_size, fft_window, frame_rate, gain, ppm, tuner_agc, rtl_agc } => {
        if let Err(e) = self.apply_settings(fft_size, fft_window, frame_rate, gain, ppm, tuner_agc, rtl_agc) {
          warn!("Failed to apply settings: {}", e);
        }
      }
    }
  }
}
/// Shared state visible to the async runtime (lock-free where possible)
struct SharedState {
  /// Latest spectrum data produced by the I/O thread
  latest_spectrum: std::sync::Mutex<Option<(Vec<f32>, bool)>>,
  /// Whether the device is connected (set once at init, updated on fallback)
  device_connected: AtomicBool,
  /// Client count
  client_count: AtomicU32,
  /// Number of authenticated clients (streaming only starts when > 0)
  authenticated_count: AtomicU32,
  /// Whether streaming is paused
  is_paused: AtomicBool,
  /// Latest requested center frequency (MHz -> Hz), coalesced atomically
  pending_center_freq: AtomicU32,
  /// Whether there is a pending frequency change
  pending_center_freq_dirty: AtomicBool,
  /// Shutdown signal — I/O thread checks this each iteration
  shutdown: AtomicBool,
  /// Device info string (set once at init)
  device_info: std::sync::Mutex<String>,
  /// Device loading state (when device is being initialized)
  device_loading: std::sync::Mutex<bool>,
  /// When device_loading is true, why: "connect" | "restart" (optional)
  device_loading_reason: std::sync::Mutex<Option<String>>,
  /// Canonical device state: "connected", "loading", "disconnected", "stale"
  /// This is the single source of truth for the frontend.
  device_state: std::sync::Mutex<String>,
  /// AES-256 encryption key derived from passkey (set once at startup)
  encryption_key: [u8; 32],
  /// Pending auth challenges: challenge_id → (nonce_bytes, created_at)
  pending_challenges: std::sync::Mutex<std::collections::HashMap<String, ([u8; 32], Instant)>>,
}

/// WebSocket server that handles client connections and broadcasts spectrum data.
/// Device I/O runs on a dedicated std::thread; the async runtime never blocks.
struct WebSocketServer {
  /// Channel to send commands to the dedicated I/O thread
  cmd_tx: std::sync::mpsc::Sender<SdrCommand>,
  /// Broadcast channel for sending data to all clients
  broadcast_tx: broadcast::Sender<String>,
  /// Shared state between I/O thread and async runtime
  shared: Arc<SharedState>,
}

impl WebSocketServer {
  /// Create a new WebSocket server, spawn the dedicated I/O thread
  fn new() -> Self {
    let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<SdrCommand>();
    let (broadcast_tx, _) = broadcast::channel::<String>(16);

    let passkey = std::env::var("N_APT_PASSKEY").unwrap_or_else(|_| DEFAULT_PASSKEY.to_string());
    let encryption_key = crypto::derive_key(&passkey);
    info!("Encryption key derived from passkey (PBKDF2-HMAC-SHA256, {} iterations)", 100_000);

    let shared = Arc::new(SharedState {
      latest_spectrum: std::sync::Mutex::new(None),
      device_connected: AtomicBool::new(false),
      client_count: AtomicU32::new(0),
      authenticated_count: AtomicU32::new(0),
      is_paused: AtomicBool::new(false),
      pending_center_freq: AtomicU32::new(n_apt_backend::consts::rs::fft::CENTER_FREQ),
      pending_center_freq_dirty: AtomicBool::new(false),
      shutdown: AtomicBool::new(false),
      device_info: std::sync::Mutex::new(String::new()),
      device_loading: std::sync::Mutex::new(false),
      device_loading_reason: std::sync::Mutex::new(None),
      device_state: std::sync::Mutex::new("disconnected".to_string()),
      encryption_key,
      pending_challenges: std::sync::Mutex::new(std::collections::HashMap::new()),
    });

    // Spawn the dedicated I/O thread — FFT processing + command handling happens here.
    // A separate reader thread runs rtlsdr_read_async to keep the USB stream alive.
    let io_shared = shared.clone();
    let io_broadcast_tx = broadcast_tx.clone();
    std::thread::Builder::new()
      .name("sdr-io".into())
      .spawn(move || {
        let mut last_probe = Instant::now() - DEVICE_PROBE_INTERVAL;
        let mut last_device_connected: bool;
        let mut missing_device_probe_streak: u32 = 0;

        let send_status_update = |shared: &Arc<SharedState>, tx: &broadcast::Sender<String>| {
          let device_connected = shared.device_connected.load(Ordering::Relaxed);
          let device_info = shared.device_info.lock().unwrap().clone();
          let device_loading = *shared.device_loading.lock().unwrap();
          let device_loading_reason = shared.device_loading_reason.lock().unwrap().clone();
          let paused = shared.is_paused.load(Ordering::Relaxed);

          let max_sample_rate = if device_connected {
            device_info
              .split("max: ")
              .nth(1)
              .and_then(|s| s.split(" Hz").next())
              .and_then(|s| s.parse::<u32>().ok())
              .unwrap_or(3_200_000)
          } else {
            device_info
              .split("Sample Rate: ")
              .nth(1)
              .and_then(|s| s.split(" Hz").next())
              .and_then(|s| s.parse::<u32>().ok())
              .unwrap_or(3_200_000)
          };

          let device_state = shared.device_state.lock().unwrap().clone();

          let status_message = serde_json::json!({
            "message_type": "status",
            "device_connected": device_connected,
            "device_info": device_info,
            "device_loading": device_loading,
            "device_loading_reason": device_loading_reason,
            "device_state": device_state,
            "paused": paused,
            "max_sample_rate": max_sample_rate,
            "backend": if device_connected { "rtl-sdr" } else { "mock" }
          });

          let _ = tx.send(status_message.to_string());
        };

        let start_async_reader = |processor: &SDRProcessor| -> (Option<std::thread::JoinHandle<()>>, Option<std::sync::mpsc::Receiver<Vec<u8>>>) {
          if processor.is_mock {
            return (None, None);
          }
          let Some(dev) = processor.device.as_ref() else {
            return (None, None);
          };

          let (iq_tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(64);
          let dev_ptr = dev.raw_ptr() as usize;

          let handle = std::thread::Builder::new()
            .name("sdr-reader".into())
            .spawn(move || {
              unsafe extern "C" fn iq_callback(
                buf: *mut u8,
                len: u32,
                ctx: *mut std::os::raw::c_void,
              ) {
                if buf.is_null() || len == 0 {
                  return;
                }
                let tx = &*(ctx as *const std::sync::mpsc::SyncSender<Vec<u8>>);
                let data = std::slice::from_raw_parts(buf, len as usize);
                let _ = tx.try_send(data.to_vec());
              }

              let dev = dev_ptr as *mut rtlsdr_ffi::RtlSdrDev;
              let ctx_ptr = &iq_tx as *const std::sync::mpsc::SyncSender<Vec<u8>>
                as *mut std::os::raw::c_void;

              log::info!(
                "Async reader starting: {} buffers × {} bytes",
                ASYNC_BUF_NUM, ASYNC_BUF_LEN
              );
              let ret = unsafe {
                rtlsdr_ffi::rtlsdr_read_async(
                  dev,
                  Some(iq_callback),
                  ctx_ptr,
                  ASYNC_BUF_NUM,
                  ASYNC_BUF_LEN,
                )
              };
              if ret != 0 {
                log::error!("rtlsdr_read_async returned error code {}", ret);
              }
              log::info!("Async reader thread exiting");
            })
            .expect("Failed to spawn SDR reader thread");

          (Some(handle), Some(rx))
        };

        let mut processor = SDRProcessor::new();
        if let Err(e) = processor.initialize() {
          error!("Failed to initialize SDR processor: {}", e);
        }
        io_shared.device_connected.store(!processor.is_mock, Ordering::Relaxed);
        *io_shared.device_info.lock().unwrap() = processor.get_device_info();
        last_device_connected = !processor.is_mock;
        *io_shared.device_state.lock().unwrap() = if !processor.is_mock { "connected".to_string() } else { "disconnected".to_string() };
        info!("SDR I/O thread started: {}", processor.get_device_info());

        // --- Async reader thread ---
        // If a real device is connected, spawn a reader thread that calls
        // rtlsdr_read_async. The callback copies each IQ buffer into the channel.
        // This keeps multiple USB transfers in-flight so the device never stalls.
        let (mut reader_handle, mut iq_rx) = start_async_reader(&processor);

        let mut frame_interval = Duration::from_millis(1000 / processor.display_frame_rate as u64);

        // Stale-frame detection: track last time we produced a real spectrum frame
        let mut last_real_spectrum_time = if !processor.is_mock { Instant::now() } else { Instant::now() };
        let mut is_stale = false;
        const STALE_THRESHOLD: Duration = Duration::from_secs(3);

        loop {
          let loop_start = std::time::Instant::now();

          // --- Hotplug: periodically probe for RTL-SDR device status ---
          if loop_start.duration_since(last_probe) >= DEVICE_PROBE_INTERVAL {
            last_probe = loop_start;
            
            if processor.is_mock && processor.device.is_none() {
              // In mock mode, try to connect to a newly attached device
              let device_count = RtlSdrDevice::get_device_count();
              if device_count > 0 {
                // Device detected — broadcast loading state immediately
                *io_shared.device_loading.lock().unwrap() = true;
                *io_shared.device_loading_reason.lock().unwrap() = Some("connect".to_string());
                *io_shared.device_state.lock().unwrap() = "loading".to_string();
                send_status_update(&io_shared, &io_broadcast_tx);
                std::thread::sleep(Duration::from_millis(50));
              }
              
              match processor.try_connect_device() {
                Ok(true) => {
                  *io_shared.device_loading.lock().unwrap() = false;
                  *io_shared.device_loading_reason.lock().unwrap() = None;
                  io_shared.device_connected.store(true, Ordering::Relaxed);
                  *io_shared.device_info.lock().unwrap() = processor.get_device_info();
                  *io_shared.device_state.lock().unwrap() = "connected".to_string();
                  last_device_connected = true;
                  last_real_spectrum_time = Instant::now();
                  is_stale = false;
                  send_status_update(&io_shared, &io_broadcast_tx);

                  let (h, rx) = start_async_reader(&processor);
                  reader_handle = h;
                  iq_rx = rx;
                }
                Ok(false) => {
                  *io_shared.device_loading.lock().unwrap() = false;
                  *io_shared.device_loading_reason.lock().unwrap() = None;
                  *io_shared.device_state.lock().unwrap() = "disconnected".to_string();
                  send_status_update(&io_shared, &io_broadcast_tx);
                }
                Err(e) => {
                  *io_shared.device_loading.lock().unwrap() = false;
                  *io_shared.device_loading_reason.lock().unwrap() = None;
                  *io_shared.device_state.lock().unwrap() = "disconnected".to_string();
                  debug!("Device probe failed: {}", e);
                  send_status_update(&io_shared, &io_broadcast_tx);
                }
              }
            } else if !processor.is_mock && processor.device.is_some() {
              // When device is connected, periodically check if it's still responsive
              let device_count = RtlSdrDevice::get_device_count();
              missing_device_probe_streak =
                next_missing_device_probe_streak(missing_device_probe_streak, device_count);

              // Debounce disconnect: macOS/USB enumeration can transiently report 0
              // even while the device is still present.
              if should_declare_disconnected(missing_device_probe_streak) {
                // Device was disconnected
                warn!("\x1b[31mRTL-SDR device disconnected. Falling back to mock mode.\x1b[0m");
                processor.enter_mock_mode();
                if let Some(ref dev) = processor.device {
                  let _ = dev.cancel_async();
                }
                if let Some(h) = reader_handle.take() {
                  let _ = h.join();
                }
                processor.release_device();
                iq_rx = None;
                io_shared.device_connected.store(false, Ordering::Relaxed);
                *io_shared.device_info.lock().unwrap() = processor.get_device_info();
                *io_shared.device_loading_reason.lock().unwrap() = None;
                *io_shared.device_state.lock().unwrap() = "disconnected".to_string();
                last_device_connected = false;
                is_stale = false;
                send_status_update(&io_shared, &io_broadcast_tx);
                missing_device_probe_streak = 0;
              }
            }
          }

          // --- Shutdown ---
          if io_shared.shutdown.load(Ordering::Relaxed) {
            info!("SDR I/O thread received shutdown signal");
            // Cancel async read so the reader thread unblocks
            if let Some(ref dev) = processor.device {
              let _ = dev.cancel_async();
            }
            if let Some(h) = reader_handle.take() {
              info!("Waiting for async reader thread to exit...");
              let _ = h.join();
            }
            break;
          }

          // --- Device cleanup (deferred from enter_mock_mode) ---
          // If a control transfer failed and we entered mock mode, the reader thread
          // is still running. Cancel it, join, then release the device.
          if processor.is_mock && processor.device.is_some() {
            warn!("Device entered mock mode, cleaning up async reader...");
            if let Some(ref dev) = processor.device {
              let _ = dev.cancel_async();
            }
            if let Some(h) = reader_handle.take() {
              let _ = h.join();
            }
            processor.release_device();
            iq_rx = None;
            io_shared.device_connected.store(false, Ordering::Relaxed);
            *io_shared.device_info.lock().unwrap() = processor.get_device_info();
            *io_shared.device_loading_reason.lock().unwrap() = None;
            *io_shared.device_state.lock().unwrap() = "disconnected".to_string();
            last_device_connected = false;
            is_stale = false;
            send_status_update(&io_shared, &io_broadcast_tx);
          }

          // --- Commands ---
          // Apply pending frequency change (coalesced via atomic)
          if io_shared.pending_center_freq_dirty.load(Ordering::Relaxed) {
            let freq = io_shared.pending_center_freq.load(Ordering::Relaxed);
            processor.handle_command(SdrCommand::SetFrequency(freq));
            io_shared.pending_center_freq_dirty.store(false, Ordering::Relaxed);
          }

          // Drain all pending commands (non-blocking), coalesce frequency
          let mut latest_freq: Option<u32> = None;
          let mut new_frame_rate: Option<u32> = None;
          let mut restart_requested = false;
          while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
              SdrCommand::SetFrequency(f) => {
                latest_freq = Some(f);
              }
              SdrCommand::RestartDevice => {
                restart_requested = true;
              }
              SdrCommand::ApplySettings {
                fft_size,
                fft_window,
                frame_rate,
                gain,
                ppm,
                tuner_agc,
                rtl_agc,
              } => {
                if let Some(fr) = frame_rate {
                  new_frame_rate = Some(fr);
                }
                processor.handle_command(SdrCommand::ApplySettings {
                  fft_size,
                  fft_window,
                  frame_rate: None,
                  gain,
                  ppm,
                  tuner_agc: None,
                  rtl_agc: None,
                });
              }
              other => processor.handle_command(other),
            }
          }

          // --- Restart device ---
          if restart_requested {
            info!("\x1b[33m[RESTART] Device restart requested by client\x1b[0m");

            // 1. Notify frontend: loading
            *io_shared.device_loading.lock().unwrap() = true;
            *io_shared.device_loading_reason.lock().unwrap() = Some("restart".to_string());
            *io_shared.device_state.lock().unwrap() = "loading".to_string();
            send_status_update(&io_shared, &io_broadcast_tx);
            std::thread::sleep(Duration::from_millis(50));

            // 2. Tear down current device + reader thread
            info!("[RESTART] Step 2: Tearing down device and reader thread...");
            if let Some(ref dev) = processor.device {
              info!("[RESTART] Cancelling async read...");
              let _ = dev.cancel_async();
            }

            let mut reader_exited = true;
            if let Some(h) = reader_handle.take() {
              info!("[RESTART] Waiting for reader thread to exit (5s timeout)...");
              let join_result = std::sync::mpsc::channel::<()>();
              let (done_tx, done_rx) = join_result;
              std::thread::spawn(move || {
                let _ = h.join();
                let _ = done_tx.send(());
              });
              match done_rx.recv_timeout(Duration::from_secs(5)) {
                Ok(()) => info!("[RESTART] Reader thread exited cleanly"),
                Err(_) => {
                  reader_exited = false;
                  warn!("[RESTART] Reader thread join timed out after 5s; aborting restart to avoid unstable state");
                }
              }
            }

            if !reader_exited {
              *io_shared.device_loading.lock().unwrap() = false;
              *io_shared.device_loading_reason.lock().unwrap() = None;
              // Restore previous state
              *io_shared.device_state.lock().unwrap() = if last_device_connected { "connected".to_string() } else { "disconnected".to_string() };
              send_status_update(&io_shared, &io_broadcast_tx);
              continue;
            }

            iq_rx = None;
            info!("[RESTART] Entering mock mode and releasing device...");
            processor.enter_mock_mode();
            processor.release_device();

            std::thread::sleep(Duration::from_millis(500));

            // 3. Try to reinitialize
            info!("[RESTART] Step 3: Attempting to reinitialize device...");
            match processor.try_connect_device() {
              Ok(true) => {
                info!("\x1b[32m[RESTART] Device restarted successfully: {}\x1b[0m", processor.get_device_info());
                io_shared.device_connected.store(true, Ordering::Relaxed);
                *io_shared.device_info.lock().unwrap() = processor.get_device_info();
                *io_shared.device_state.lock().unwrap() = "connected".to_string();
                last_device_connected = true;
                last_real_spectrum_time = Instant::now();
                is_stale = false;

                let (h, rx) = start_async_reader(&processor);
                reader_handle = h;
                iq_rx = rx;
              }
              Ok(false) => {
                warn!("[RESTART] No device found after restart, staying in mock mode");
                io_shared.device_connected.store(false, Ordering::Relaxed);
                *io_shared.device_info.lock().unwrap() = processor.get_device_info();
                *io_shared.device_state.lock().unwrap() = "disconnected".to_string();
                last_device_connected = false;
              }
              Err(e) => {
                warn!("[RESTART] Device restart failed: {}, staying in mock mode", e);
                io_shared.device_connected.store(false, Ordering::Relaxed);
                *io_shared.device_info.lock().unwrap() = processor.get_device_info();
                *io_shared.device_state.lock().unwrap() = "disconnected".to_string();
                last_device_connected = false;
              }
            }

            // 4. Clear loading state and broadcast new status
            *io_shared.device_loading.lock().unwrap() = false;
            *io_shared.device_loading_reason.lock().unwrap() = None;
            send_status_update(&io_shared, &io_broadcast_tx);
            info!("[RESTART] Restart sequence complete");
          }

          if let Some(fr) = new_frame_rate {
            let fr = fr.clamp(1, 60);
            processor.display_frame_rate = fr;
            frame_interval = Duration::from_millis(1000 / fr as u64);
          }
          if let Some(freq) = latest_freq {
            processor.handle_command(SdrCommand::SetFrequency(freq));
          }

          let has_clients = io_shared.authenticated_count.load(Ordering::Relaxed) > 0;
          let is_paused = io_shared.is_paused.load(Ordering::Relaxed);

          // --- Process IQ data from async reader ---
          if let Some(ref rx) = iq_rx {
            // Drain all available IQ chunks from the async reader
            let mut reader_disconnected = false;
            loop {
              match rx.try_recv() {
                Ok(chunk) => processor.iq_accumulator.extend_from_slice(&chunk),
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                  reader_disconnected = true;
                  break;
                }
              }
            }

            if reader_disconnected {
              error!("Async reader disconnected (device error). Falling back to mock.");
              processor.enter_mock_mode();
              if let Some(h) = reader_handle.take() {
                let _ = h.join();
              }
              processor.release_device();
              iq_rx = None;
              io_shared.device_connected.store(false, Ordering::Relaxed);
              *io_shared.device_info.lock().unwrap() = processor.get_device_info();
              *io_shared.device_loading_reason.lock().unwrap() = None;
              *io_shared.device_state.lock().unwrap() = "disconnected".to_string();
              last_device_connected = false;
              is_stale = false;
              send_status_update(&io_shared, &io_broadcast_tx);
            }

            // Process all complete FFT frames, keep only the latest for broadcast
            let mut latest_spectrum: Option<Vec<f32>> = None;
            while processor.has_complete_frame() {
              match processor.process_iq_frame() {
                Ok(spectrum) => latest_spectrum = Some(spectrum),
                Err(e) => {
                  warn!("FFT processing error: {}", e);
                  break;
                }
              }
            }

            if let Some(spectrum) = latest_spectrum {
              last_real_spectrum_time = Instant::now();

              // If we were stale, we're not anymore
              if is_stale {
                is_stale = false;
                *io_shared.device_state.lock().unwrap() = "connected".to_string();
                send_status_update(&io_shared, &io_broadcast_tx);
              }

              io_shared.device_connected.store(true, Ordering::Relaxed);
              if last_device_connected != true {
                last_device_connected = true;
                *io_shared.device_info.lock().unwrap() = processor.get_device_info();
                *io_shared.device_state.lock().unwrap() = "connected".to_string();
                send_status_update(&io_shared, &io_broadcast_tx);
              }

              // --- Training: feed spectrum to stitcher ---
              if processor.training_active {
                if let Some(ref mut stitcher) = processor.training_stitcher {
                  if let Some(stitched_data) = stitcher.add_frame(&spectrum) {
                    let sample = n_apt_backend::stitching::TrainingSample {
                      signal_area: processor.training_signal_area.clone().unwrap_or_default(),
                      label: processor.training_label.clone().unwrap_or_default(),
                      data: stitched_data,
                      timestamp: chrono::Utc::now().timestamp_millis(),
                      frequency_min: 0.0,
                      frequency_max: 0.0,
                      sample_rate: SAMPLE_RATE,
                    };
                    info!("Training sample captured: label={}, area={}, data_len={}",
                      sample.label, sample.signal_area, sample.data.len());
                    processor.training_samples.push(sample);
                  }
                }
              }

              if has_clients && !is_paused {
                *io_shared.latest_spectrum.lock().unwrap() = Some((spectrum.clone(), false));
                let payload_spectrum = downsample_spectrum(&spectrum, SERVER_SPECTRUM_BINS);
                let data = SpectrumData {
                  message_type: "spectrum".to_string(),
                  waveform: payload_spectrum.clone(),
                  waterfall: payload_spectrum,
                  is_mock: false,
                  timestamp: chrono::Utc::now().timestamp_millis(),
                };
                if let Ok(json) = serde_json::to_string(&data) {
                  let _ = io_broadcast_tx.send(json);
                }
              }
            } else if !is_stale && last_device_connected && loop_start.duration_since(last_real_spectrum_time) > STALE_THRESHOLD {
              // No spectrum produced for STALE_THRESHOLD — device is frozen
              is_stale = true;
              warn!("\x1b[33mDevice stream stale (no spectrum for {}s)\x1b[0m", STALE_THRESHOLD.as_secs());
              *io_shared.device_state.lock().unwrap() = "stale".to_string();
              send_status_update(&io_shared, &io_broadcast_tx);
            }
          } else {
            // --- Mock mode ---
            match processor.read_and_process_mock() {
              Ok(spectrum) => {
                io_shared.device_connected.store(false, Ordering::Relaxed);
                if last_device_connected != false {
                  last_device_connected = false;
                  *io_shared.device_info.lock().unwrap() = processor.get_device_info();
                  *io_shared.device_state.lock().unwrap() = "disconnected".to_string();
                  send_status_update(&io_shared, &io_broadcast_tx);
                }
                if has_clients && !is_paused {
                  *io_shared.latest_spectrum.lock().unwrap() = Some((spectrum.clone(), true));
                  let payload_spectrum = downsample_spectrum(&spectrum, SERVER_SPECTRUM_BINS);
                  let data = SpectrumData {
                    message_type: "spectrum".to_string(),
                    waveform: payload_spectrum.clone(),
                    waterfall: payload_spectrum,
                    is_mock: true,
                    timestamp: chrono::Utc::now().timestamp_millis(),
                  };
                  if let Ok(json) = serde_json::to_string(&data) {
                    let _ = io_broadcast_tx.send(json);
                  }
                }
              }
              Err(e) => {
                warn!("Mock data generation error: {}", e);
              }
            }
          }

          // Sleep for the remainder of the frame interval
          let elapsed = loop_start.elapsed();
          if elapsed < frame_interval {
            std::thread::sleep(frame_interval - elapsed);
          }
        }

        // I/O thread exiting — processor (and device) will be dropped here
        info!("SDR I/O thread shutting down, releasing device...");
      })
      .expect("Failed to spawn SDR I/O thread");

    Self {
      cmd_tx,
      broadcast_tx,
      shared,
    }
  }

  /// Start the axum HTTP + WebSocket server
  async fn start(&self) -> Result<()> {
    // Wait briefly for the I/O thread to initialize the device
    tokio::time::sleep(Duration::from_millis(200)).await;

    let device_info = self.shared.device_info.lock().unwrap().clone();
    info!("SDR processor initialized: {}", device_info);

    // Build shared application state for axum handlers
    let rp_id = std::env::var("N_APT_RP_ID").unwrap_or_else(|_| "localhost".to_string());
    // RP origin must match the browser's actual origin (Vite dev server on :5173).
    // In production, set N_APT_RP_ORIGIN to the actual serving origin.
    let rp_origin = std::env::var("N_APT_RP_ORIGIN")
      .unwrap_or_else(|_| "http://localhost:5173".to_string());
    let rp_origin_url = url::Url::parse(&rp_origin)
      .unwrap_or_else(|_| url::Url::parse("http://localhost").unwrap());

    let webauthn = WebauthnBuilder::new(&rp_id, &rp_origin_url)
      .unwrap()
      .rp_name("N-APT")
      .build()
      .expect("Failed to build WebAuthn");

    let credential_store = CredentialStore::new().expect("Failed to init credential store");

    let app_state = Arc::new(AppState {
      shared: self.shared.clone(),
      broadcast_tx: self.broadcast_tx.clone(),
      cmd_tx: self.cmd_tx.clone(),
      session_store: SessionStore::new(),
      credential_store,
      webauthn,
    });

    let cors = CorsLayer::permissive();

    let app = Router::new()
      // REST auth endpoints
      .route("/auth/info", get(auth_info_handler))
      .route("/auth/challenge", post(auth_challenge_handler))
      .route("/auth/verify", post(auth_verify_handler))
      .route("/auth/session", post(auth_session_handler))
      .route("/auth/passkey/register/start", post(passkey_register_start_handler))
      .route("/auth/passkey/register/finish", post(passkey_register_finish_handler))
      .route("/auth/passkey/auth/start", post(passkey_auth_start_handler))
      .route("/auth/passkey/auth/finish", post(passkey_auth_finish_handler))
      // WebSocket upgrade (requires valid session token)
      .route("/ws", get(ws_upgrade_handler))
      // Status endpoint (no auth required)
      .route("/status", get(status_handler))
      .layer(cors)
      .with_state(app_state);

    let server_addr = format!("{}:{}", WS_HOST, WS_PORT);
    let listener = tokio::net::TcpListener::bind(&server_addr).await?;
    info!("N-APT server listening on http://{}", server_addr);
    info!("  REST auth: POST /auth/challenge, /auth/verify, /auth/session");
    info!("  Passkey:   POST /auth/passkey/register/start, .../finish, /auth/start, .../finish");
    info!("  WebSocket: GET  /ws?token=<session_token>");
    info!("  Status:    GET  /status");

    axum::serve(listener, app).await?;

    Ok(())
  }
}

// ── Axum shared state ──────────────────────────────────────────────────

/// Application state shared across all axum handlers.
struct AppState {
  shared: Arc<SharedState>,
  broadcast_tx: broadcast::Sender<String>,
  cmd_tx: std::sync::mpsc::Sender<SdrCommand>,
  session_store: SessionStore,
  credential_store: CredentialStore,
  webauthn: Webauthn,
}

// ── REST auth request/response types ───────────────────────────────────

#[derive(Deserialize)]
struct AuthVerifyRequest {
  challenge_id: String,
  hmac: String,
}

#[derive(Deserialize)]
struct AuthSessionRequest {
  token: String,
}

#[derive(Deserialize)]
struct WsQueryParams {
  token: String,
}

#[derive(Deserialize)]
struct PasskeyRegisterFinishRequest {
  challenge_id: String,
  credential: RegisterPublicKeyCredential,
}

#[derive(Deserialize)]
struct PasskeyAuthFinishRequest {
  challenge_id: String,
  credential: PublicKeyCredential,
}

// ── REST auth handlers ─────────────────────────────────────────────────

/// GET /auth/info — returns whether passkeys are registered (so frontend
/// knows whether to show passkey button vs password-only).
async fn auth_info_handler(
  State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
  let has_passkeys = state.credential_store.has_passkeys();
  Json(serde_json::json!({
    "has_passkeys": has_passkeys,
  }))
}

/// POST /auth/challenge — generate a nonce for password-based auth.
async fn auth_challenge_handler(
  State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
  let nonce = crypto::generate_nonce();
  let nonce_b64 = crypto::to_base64(&nonce);

  // Store the nonce temporarily in a session (short-lived, 60s)
  // We reuse the session store with a special prefix
  let challenge_id = uuid::Uuid::new_v4().to_string();
  let mut challenges = state.shared.pending_challenges.lock().unwrap();
  challenges.insert(challenge_id.clone(), (nonce, Instant::now()));

  Json(serde_json::json!({
    "challenge_id": challenge_id,
    "nonce": nonce_b64,
  }))
}

/// POST /auth/verify — verify password-based HMAC response, return session token.
async fn auth_verify_handler(
  State(state): State<Arc<AppState>>,
  Json(body): Json<AuthVerifyRequest>,
) -> impl IntoResponse {
  // Look up the challenge nonce
  let nonce = {
    let mut challenges = state.shared.pending_challenges.lock().unwrap();
    challenges.remove(&body.challenge_id)
  };

  let Some((nonce_bytes, created)) = nonce else {
    return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
      "error": "invalid_challenge",
      "message": "Challenge not found or expired",
    })));
  };

  // Check challenge age (60s max)
  if created.elapsed() > Duration::from_secs(60) {
    return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
      "error": "challenge_expired",
      "message": "Challenge has expired",
    })));
  }

  // Verify HMAC
  let client_hmac = match crypto::from_base64(&body.hmac) {
    Ok(h) => h,
    Err(_) => {
      return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
        "error": "invalid_hmac",
        "message": "Invalid HMAC encoding",
      })));
    }
  };

  if !crypto::verify_hmac(&state.shared.encryption_key, &nonce_bytes, &client_hmac) {
    warn!("Password auth failed: invalid HMAC");
    return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
      "error": "auth_failed",
      "message": "Invalid passkey",
    })));
  }

  // Authentication successful — create session
  let token = state.session_store.create_session(state.shared.encryption_key);
  info!("Password authentication successful, session created");

  (StatusCode::OK, Json(serde_json::json!({
    "token": token,
    "expires_in": 86400,
  })))
}

/// POST /auth/session — validate an existing session token.
async fn auth_session_handler(
  State(state): State<Arc<AppState>>,
  Json(body): Json<AuthSessionRequest>,
) -> impl IntoResponse {
  match state.session_store.validate(&body.token) {
    Some(_session) => {
      info!("Session token validated successfully");
      (StatusCode::OK, Json(serde_json::json!({
        "valid": true,
        "token": body.token,
      })))
    }
    None => {
      (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
        "valid": false,
        "error": "session_expired",
      })))
    }
  }
}

// ── Passkey (WebAuthn) handlers ────────────────────────────────────────

/// POST /auth/passkey/register/start — begin passkey registration.
async fn passkey_register_start_handler(
  State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
  let user_unique_id = uuid::Uuid::new_v4();
  let existing_keys = state.credential_store.get_passkeys();
  let exclude_credentials: Vec<CredentialID> = existing_keys
    .iter()
    .map(|k| k.cred_id().clone())
    .collect();

  match state.webauthn.start_passkey_registration(
    user_unique_id,
    "n-apt-user",
    "N-APT User",
    Some(exclude_credentials),
  ) {
    Ok((ccr, reg_state)) => {
      let challenge_id = uuid::Uuid::new_v4().to_string();
      // Serialize registration state for later verification
      let state_json = serde_json::to_string(&reg_state).unwrap_or_default();
      if let Err(e) = state.credential_store.store_pending_registration(&challenge_id, &state_json) {
        error!("Failed to store pending registration: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
          "error": "storage_error",
        })));
      }

      let ccr_json = serde_json::to_value(&ccr).unwrap_or_else(|e| {
        error!("Failed to serialize CCR: {}", e);
        serde_json::Value::Null
      });
      info!("Sending CCR to client: {}", serde_json::to_string_pretty(&ccr_json).unwrap_or_default());
      
      (StatusCode::OK, Json(serde_json::json!({
        "challenge_id": challenge_id,
        "options": ccr_json,
      })))
    }
    Err(e) => {
      error!("WebAuthn registration start failed: {}", e);
      (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
        "error": "webauthn_error",
        "message": format!("{}", e),
      })))
    }
  }
}

/// POST /auth/passkey/register/finish — complete passkey registration.
async fn passkey_register_finish_handler(
  State(state): State<Arc<AppState>>,
  Json(body): Json<PasskeyRegisterFinishRequest>,
) -> impl IntoResponse {
  let state_json = match state.credential_store.take_pending_registration(&body.challenge_id) {
    Some(s) => s,
    None => {
      return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
        "error": "invalid_challenge",
      })));
    }
  };

  let reg_state: PasskeyRegistration = match serde_json::from_str(&state_json) {
    Ok(s) => s,
    Err(_) => {
      return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
        "error": "state_corrupt",
      })));
    }
  };

  match state.webauthn.finish_passkey_registration(&body.credential, &reg_state) {
    Ok(passkey) => {
      if let Err(e) = state.credential_store.add_passkey(passkey) {
        error!("Failed to store passkey: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
          "error": "storage_error",
        })));
      }
      info!("Passkey registered successfully");
      (StatusCode::OK, Json(serde_json::json!({
        "success": true,
      })))
    }
    Err(e) => {
      warn!("Passkey registration failed: {}", e);
      (StatusCode::BAD_REQUEST, Json(serde_json::json!({
        "error": "registration_failed",
        "message": format!("{}", e),
      })))
    }
  }
}

/// POST /auth/passkey/auth/start — begin passkey authentication.
async fn passkey_auth_start_handler(
  State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
  let existing_keys = state.credential_store.get_passkeys();
  if existing_keys.is_empty() {
    return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
      "error": "no_passkeys",
      "message": "No passkeys registered",
    })));
  }

  match state.webauthn.start_passkey_authentication(&existing_keys) {
    Ok((rcr, auth_state)) => {
      let challenge_id = uuid::Uuid::new_v4().to_string();
      let state_json = serde_json::to_string(&auth_state).unwrap_or_default();
      if let Err(e) = state.credential_store.store_pending_registration(&challenge_id, &state_json) {
        error!("Failed to store pending auth state: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
          "error": "storage_error",
        })));
      }

      (StatusCode::OK, Json(serde_json::json!({
        "challenge_id": challenge_id,
        "options": rcr,
      })))
    }
    Err(e) => {
      error!("WebAuthn auth start failed: {}", e);
      (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
        "error": "webauthn_error",
        "message": format!("{}", e),
      })))
    }
  }
}

/// POST /auth/passkey/auth/finish — complete passkey authentication.
async fn passkey_auth_finish_handler(
  State(state): State<Arc<AppState>>,
  Json(body): Json<PasskeyAuthFinishRequest>,
) -> impl IntoResponse {
  let state_json = match state.credential_store.take_pending_registration(&body.challenge_id) {
    Some(s) => s,
    None => {
      return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
        "error": "invalid_challenge",
      })));
    }
  };

  let auth_state: PasskeyAuthentication = match serde_json::from_str(&state_json) {
    Ok(s) => s,
    Err(_) => {
      return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
        "error": "state_corrupt",
      })));
    }
  };

  match state.webauthn.finish_passkey_authentication(&body.credential, &auth_state) {
    Ok(_auth_result) => {
      // Authentication successful — create session
      let token = state.session_store.create_session(state.shared.encryption_key);
      info!("Passkey authentication successful, session created");

      (StatusCode::OK, Json(serde_json::json!({
        "token": token,
        "expires_in": 86400,
      })))
    }
    Err(e) => {
      warn!("Passkey authentication failed: {}", e);
      (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
        "error": "auth_failed",
        "message": format!("{}", e),
      })))
    }
  }
}

// ── Status endpoint ────────────────────────────────────────────────────

/// GET /status — public status endpoint (no auth required).
async fn status_handler(
  State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
  let device_connected = state.shared.device_connected.load(Ordering::Relaxed);
  let device_info = state.shared.device_info.lock().unwrap().clone();
  let client_count = state.shared.client_count.load(Ordering::Relaxed);
  let authenticated_count = state.shared.authenticated_count.load(Ordering::Relaxed);

  // This is a cheap, non-blocking check (does not open the device) and remains
  // responsive even if the SDR I/O thread is busy.
  let device_count = RtlSdrDevice::get_device_count();
  let device_present = device_count > 0;

  let device_state = state.shared.device_state.lock().unwrap().clone();
  let device_loading_reason = state.shared.device_loading_reason.lock().unwrap().clone();

  Json(serde_json::json!({
    "device_connected": device_connected,
    "device_present": device_present,
    "device_count": device_count,
    "device_state": device_state,
    "device_loading_reason": device_loading_reason,
    "device_info": device_info,
    "backend": if device_connected { "rtl-sdr" } else { "mock" },
    "clients": client_count,
    "authenticated_clients": authenticated_count,
  }))
}

// ── WebSocket upgrade handler ──────────────────────────────────────────

/// GET /ws?token=<session_token> — upgrade to WebSocket after validating session.
async fn ws_upgrade_handler(
  ws: WebSocketUpgrade,
  Query(params): Query<WsQueryParams>,
  State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
  // Validate session token
  let session = match state.session_store.validate(&params.token) {
    Some(s) => s,
    None => {
      return (StatusCode::UNAUTHORIZED, "Invalid or expired session token").into_response();
    }
  };

  info!("WebSocket upgrade: valid session, starting encrypted stream");

  let shared = state.shared.clone();
  let broadcast_tx = state.broadcast_tx.clone();
  let cmd_tx = state.cmd_tx.clone();
  let enc_key = session.encryption_key;

  ws.on_upgrade(move |socket| handle_ws_connection(socket, shared, broadcast_tx, cmd_tx, enc_key))
}

/// Handle an authenticated WebSocket connection (streaming only, no auth).
async fn handle_ws_connection(
  socket: WebSocket,
  shared: Arc<SharedState>,
  broadcast_tx: broadcast::Sender<String>,
  cmd_tx: std::sync::mpsc::Sender<SdrCommand>,
  enc_key: [u8; 32],
) {
  let (mut ws_sender, mut ws_receiver) = socket.split();
  let mut broadcast_rx = broadcast_tx.subscribe();

  shared.client_count.fetch_add(1, Ordering::Relaxed);
  shared.authenticated_count.fetch_add(1, Ordering::Relaxed);

  // Send initial status
  let device_connected = shared.device_connected.load(Ordering::Relaxed);
  let device_info = shared.device_info.lock().unwrap().clone();
  let device_loading = *shared.device_loading.lock().unwrap();
  let device_loading_reason = shared.device_loading_reason.lock().unwrap().clone();
  let device_state = reconcile_device_state(
    device_connected,
    &shared.device_state.lock().unwrap().clone(),
  );
  let paused = shared.is_paused.load(Ordering::Relaxed);

  let max_sample_rate = if device_connected {
    device_info
      .split("max: ")
      .nth(1)
      .and_then(|s| s.split(" Hz").next())
      .and_then(|s| s.parse::<u32>().ok())
      .unwrap_or(3_200_000)
  } else {
    device_info
      .split("Sample Rate: ")
      .nth(1)
      .and_then(|s| s.split(" Hz").next())
      .and_then(|s| s.parse::<u32>().ok())
      .unwrap_or(3_200_000)
  };

  let initial_status = serde_json::json!({
    "message_type": "status",
    "device_connected": device_connected,
    "device_info": device_info,
    "device_loading": device_loading,
    "device_loading_reason": device_loading_reason,
    "device_state": device_state,
    "paused": paused,
    "max_sample_rate": max_sample_rate,
    "backend": if device_connected { "rtl-sdr" } else { "mock" }
  });

  if ws_sender.send(Message::Text(initial_status.to_string())).await.is_err() {
    shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
    shared.client_count.fetch_sub(1, Ordering::Relaxed);
    return;
  }

  // Encrypted streaming loop
  loop {
    tokio::select! {
      broadcast_result = broadcast_rx.recv() => {
        match broadcast_result {
          Ok(plaintext_json) => {
            // Status messages must remain plaintext so the frontend can react
            // immediately (connected/loading/disconnected/stale) without needing
            // to decrypt them.
            if plaintext_json.contains("\"message_type\":\"status\"") {
              if ws_sender.send(Message::Text(plaintext_json)).await.is_err() {
                break;
              }
              continue;
            }
            match crypto::encrypt_payload(&enc_key, plaintext_json.as_bytes()) {
              Ok(encrypted_b64) => {
                let envelope = serde_json::json!({
                  "type": "encrypted_spectrum",
                  "payload": encrypted_b64,
                });
                if ws_sender.send(Message::Text(envelope.to_string())).await.is_err() {
                  break;
                }
              }
              Err(e) => {
                error!("Encryption failed: {}", e);
              }
            }
          }
          Err(broadcast::error::RecvError::Lagged(n)) => {
            debug!("Client lagged by {} frames, skipping", n);
            continue;
          }
          Err(_) => break,
        }
      }
      client_msg = ws_receiver.next() => {
        match client_msg {
          Some(Ok(Message::Text(text))) => {
            if let Ok(message) = serde_json::from_str::<WebSocketMessage>(&text) {
              handle_message(&cmd_tx, &shared, message);
            }
          }
          Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
          _ => {}
        }
      }
    }
  }

  shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
  shared.client_count.fetch_sub(1, Ordering::Relaxed);
}

/// Handle incoming WebSocket messages from clients.
/// Sends commands to the dedicated I/O thread via mpsc channel — never blocks.
fn handle_message(
  cmd_tx: &std::sync::mpsc::Sender<SdrCommand>,
  shared: &Arc<SharedState>,
  message: WebSocketMessage,
) {
  match message.message_type.as_str() {
    "frequency_range" => {
      if let (Some(min_freq), Some(max_freq)) = (message.min_freq, message.max_freq) {
        let center_freq = ((min_freq + max_freq) * 500000.0) as u32;
        shared.pending_center_freq.store(center_freq, Ordering::Relaxed);
        shared
          .pending_center_freq_dirty
          .store(true, Ordering::Relaxed);
      }
    }
    "pause" => {
      if let Some(paused) = message.paused {
        shared.is_paused.store(paused, Ordering::Relaxed);
      }
    }
    "gain" => {
      if let Some(gain) = message.gain {
        let _ = cmd_tx.send(SdrCommand::SetGain(gain));
      }
    }
    "ppm" => {
      if let Some(ppm) = message.ppm {
        let _ = cmd_tx.send(SdrCommand::SetPpm(ppm));
      }
    }
    "settings" => {
      let _ = cmd_tx.send(SdrCommand::ApplySettings {
        fft_size: message.fft_size,
        fft_window: message.fft_window,
        frame_rate: message.frame_rate,
        gain: message.gain,
        ppm: message.ppm,
        tuner_agc: message.tuner_agc,
        rtl_agc: message.rtl_agc,
      });
    }
    "restart_device" => {
      info!("Client requested device restart");
      let _ = cmd_tx.send(SdrCommand::RestartDevice);
    }
    "training_capture" => {
      if let Some(action) = message.action.as_deref() {
        match action {
          "start" => {
            let label = message.label.unwrap_or_else(|| "target".to_string());
            let signal_area = message.signal_area.unwrap_or_else(|| "A".to_string());
            info!("Client requested training start: label={}, area={}", label, signal_area);
            let _ = cmd_tx.send(SdrCommand::StartTraining { label, signal_area });
          }
          "stop" => {
            info!("Client requested training stop");
            let _ = cmd_tx.send(SdrCommand::StopTraining);
          }
          _ => {
            debug!("Unknown training action: {}", action);
          }
        }
      }
    }
    _ => {
      debug!("Unknown message type: {}", message.message_type);
    }
  }
}

/// Main entry point for the N-APT Rust backend server
#[tokio::main]
async fn main() -> Result<()> {
  env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
    .format_timestamp_secs()
    .init();

  info!("Starting N-APT Rust Backend Server");

  let server = WebSocketServer::new();

  // Install signal handler: on SIGINT/SIGTERM, signal the I/O thread to shut down
  // so it can release the RTL-SDR device cleanly before the process exits.
  let shutdown_shared = server.shared.clone();
  tokio::spawn(async move {
    let ctrl_c = tokio::signal::ctrl_c();
    #[cfg(unix)]
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
      .expect("Failed to install SIGTERM handler");

    #[cfg(unix)]
    tokio::select! {
      _ = ctrl_c => {},
      _ = sigterm.recv() => {},
    }
    #[cfg(not(unix))]
    ctrl_c.await.ok();

    info!("Shutdown signal received, signaling I/O thread...");
    shutdown_shared.shutdown.store(true, Ordering::Relaxed);
    // Give the I/O thread time to close the device cleanly
    tokio::time::sleep(Duration::from_millis(500)).await;
    info!("Exiting.");
    std::process::exit(0);
  });

  server.start().await?;

  Ok(())
}
