//! # SDR Processor
//!
//! Main signal processing pipeline that uses the abstract SDR interface.
//! Handles both mock and real SDR devices seamlessly.

use anyhow::Result;
use log::{info, warn};
use rustfft::num_complex::Complex;
use std::collections::VecDeque;
use std::time::Instant;

use crate::fft::{
  CorrelationMethod, CorrelationResult, FFTProcessor, PhaseCoherenceResult,
  StitchingValidationResult,
};
use crate::server::types::ChannelSpec;
#[cfg(rs_decrypted)]
use crate::simd::demod_kernels;
use crate::stitching::SignalStitcher;

use super::{SdrDevice, SdrDeviceFactory};

fn _keep_stitch_types(_result: &CorrelationResult, _method: CorrelationMethod) {
}

/// Hot per-frame state that changes on every read cycle.
#[derive(Debug)]
pub struct SdrFrameState {
  pub frame_counter: u64,
  pub avg_spectrum: Option<Vec<f32>>,
  pub avg_alpha: f32,
  pub iq_accumulator: Vec<u8>,
  pub iq_offset: usize,
  pub iq_frame: Vec<u8>,
  pub last_read_instant: Option<Instant>,
  pub pending_freq: Option<u32>,
  pub last_retune_at: Option<Instant>,
  pub retune_cooldown_until: Option<Instant>,
  pub post_retune_discard_frames: usize,
  pub last_stable_spectrum: Option<Vec<f32>>,
  pub last_frame_raw_iq: Vec<u8>,
  pub raw_iq_history: VecDeque<Vec<u8>>,
  pub raw_iq_history_capacity: usize,
}

// Helper: trim a list of CaptureChannel to a subset matching ChannelSpec[]
pub fn trim_channels_by_spec(
  all: &[CaptureChannel],
  selected: &[ChannelSpec],
) -> Vec<CaptureChannel> {
  if selected.is_empty() {
    return all.to_vec();
  }
  let mut out: Vec<CaptureChannel> = Vec::new();
  for cs in selected {
    // Try to match by center frequency in Hz with a small tolerance
    let mut found = None;
    for ch in all {
      if (ch.center_freq_hz - (cs.center_freq_hz as f64)).abs() < 1000.0 {
        found = Some(ch.clone());
        break;
      }
    }
    if let Some(ch) = found {
      let mut c = ch.clone();
      c.label = cs.label.clone();
      out.push(c);
    }
  }
  out
}

#[cfg(test)]
mod patch_b_tests {
  use super::*;
  use crate::server::types::ChannelSpec;

  #[test]
  fn test_trim_channels_by_spec_basic() {
    let ch1 = CaptureChannel {
      center_freq_hz: 1_000_000.0,
      sample_rate_hz: 2_000_000.0,
      requested_min_freq_hz: None,
      requested_max_freq_hz: None,
      iq_data: vec![0u8; 4],
      spectrum_data: vec![0.0f32],
      bins_per_frame: 1,
      label: None,
    };
    let ch2 = CaptureChannel {
      center_freq_hz: 1_010_000.0,
      sample_rate_hz: 2_000_000.0,
      requested_min_freq_hz: None,
      requested_max_freq_hz: None,
      iq_data: vec![1u8; 4],
      spectrum_data: vec![0.0f32],
      bins_per_frame: 1,
      label: None,
    };
    let all = vec![ch1.clone(), ch2.clone()];
    let cs = ChannelSpec {
      center_freq_hz: 1_000_000,
      size_hz: 2_000_000,
      offset_bytes: None,
      iq_length_bytes: None,
      label: None,
    };
    let trimmed = trim_channels_by_spec(&all, &[cs]);
    assert_eq!(trimmed.len(), 1);
    assert_eq!(trimmed[0].center_freq_hz, ch1.center_freq_hz);
  }
}

impl SdrFrameState {
  fn new(fft_size: usize) -> Self {
    let reserve = fft_size.max(1).saturating_mul(2);
    let raw_iq_history_capacity =
      Self::default_raw_iq_history_capacity(fft_size);
    Self {
      frame_counter: 0,
      avg_spectrum: None,
      avg_alpha: 0.3,
      iq_accumulator: Vec::with_capacity(reserve),
      iq_offset: 0,
      iq_frame: Vec::with_capacity(reserve),
      last_read_instant: None,
      pending_freq: None,
      last_retune_at: None,
      retune_cooldown_until: None,
      post_retune_discard_frames: 0,
      last_stable_spectrum: None,
      last_frame_raw_iq: Vec::with_capacity(reserve),
      raw_iq_history: VecDeque::with_capacity(raw_iq_history_capacity),
      raw_iq_history_capacity,
    }
  }

  fn default_raw_iq_history_capacity(fft_size: usize) -> usize {
    let bytes_per_frame = fft_size.max(1).saturating_mul(2);
    let target_seconds = 20usize;
    let max_frame_rate =
      SdrProcessor::calculate_valid_frame_rate(fft_size).max(1) as usize;
    target_seconds
      .saturating_mul(max_frame_rate)
      .max(1)
      .min(12_000)
      .max(1)
      .min(usize::MAX / bytes_per_frame.max(1))
  }

  fn resize_raw_iq_history(&mut self, fft_size: usize) {
    let desired_capacity = Self::default_raw_iq_history_capacity(fft_size);
    self.raw_iq_history_capacity = desired_capacity;

    while self.raw_iq_history.len() > desired_capacity {
      self.raw_iq_history.pop_front();
    }

    if self.raw_iq_history.capacity() < desired_capacity {
      let mut resized = VecDeque::with_capacity(desired_capacity);
      resized.extend(self.raw_iq_history.drain(..));
      self.raw_iq_history = resized;
    }
  }

  fn push_raw_iq_frame(&mut self, frame: Vec<u8>) {
    if self.raw_iq_history_capacity == 0 {
      return;
    }

    if self.raw_iq_history.len() == self.raw_iq_history_capacity {
      self.raw_iq_history.pop_front();
    }

    self.raw_iq_history.push_back(frame);
  }
}

/// One captured channel's data
#[derive(Debug, Clone)]
pub struct CaptureChannel {
  pub center_freq_hz: f64,
  pub sample_rate_hz: f64,
  pub requested_min_freq_hz: Option<f64>,
  pub requested_max_freq_hz: Option<f64>,
  pub iq_data: Vec<u8>,
  pub spectrum_data: Vec<f32>,
  pub bins_per_frame: u32,
  pub label: Option<String>,
}

/// Result returned from check_capture_completion
#[derive(Debug)]
pub struct CaptureResult {
  pub job_id: String,
  pub channels: Vec<CaptureChannel>,
  pub file_type: String,
  pub acquisition_mode: String,
  pub duration_mode: String,
  pub encrypted: bool,
  pub fft_size: u32,
  pub duration_s: f64,
  pub actual_frame_count: u32,
  pub fft_window: String,
  pub gain: f64,
  pub ppm: i32,
  pub tuner_agc: bool,
  pub rtl_agc: bool,
  pub source_device: String,
  pub hardware_sample_rate_hz: f64,
  /// Center frequency of the overall requested capture range (not a single hop)
  pub overall_center_frequency_hz: f64,
  /// Total bandwidth of the overall requested capture range
  pub overall_capture_sample_rate_hz: f64,
  /// Geolocation data if available
  pub geolocation: Option<crate::server::types::GeolocationData>,
  /// Requested frequency range [min_hz, max_hz] from the original capture fragments
  pub frequency_range: Option<(f64, f64)>,
  /// Reference based demod baseline metadata
  pub ref_based_demod_baseline: Option<String>,
  pub is_mock_apt: bool,
  pub is_ephemeral: bool,
}

/// SDR processor that works with any SDR device implementation
pub struct SdrProcessor {
  /// The actual SDR device (mock or real hardware)
  device: Box<dyn SdrDevice>,
  /// FFT processor for signal processing
  pub fft_processor: FFTProcessor,
  /// Hot per-frame state.
  pub frame: SdrFrameState,
  /// Display min/max dB
  pub display_min_db: i32,
  pub display_max_db: i32,
  /// Validated frame rate for display
  pub display_frame_rate: u32,
  /// Whether training capture is active
  pub training_active: bool,
  /// Current training label
  pub training_label: Option<String>,
  /// Current training signal area
  pub training_signal_area: Option<String>,
  /// Signal stitcher for accumulating FFT frames during training
  pub training_stitcher: Option<SignalStitcher>,
  /// Accumulated training samples
  pub training_samples: Vec<crate::stitching::TrainingSample>,
  /// Whether capture is active
  pub capture_active: bool,
  /// Whether this capture uses manual stop mode (vs timed)
  pub capture_is_manual_mode: bool,
  /// Set to true when a stop command has been received for the active capture
  pub capture_manual_stop: bool,
  /// Current capture job ID
  pub capture_job_id: Option<String>,
  /// Capture start time
  pub capture_start: Option<Instant>,
  /// Capture duration in seconds
  pub capture_duration_s: f64,
  /// Capture file type
  pub capture_file_type: String,
  /// Capture acquisition mode ('stepwise' or 'interleaved')
  pub capture_acquisition_mode: String,
  /// List of fragments to capture (min_hz, max_hz)
  pub capture_fragments: Vec<(f64, f64)>,
  /// Index of the currently active capture fragment
  pub capture_current_fragment: usize,
  /// Last time the SDR hopped to a new fragment
  pub capture_last_hop: Option<Instant>,
  /// Whether capture should be encrypted
  pub capture_encrypted: bool,
  /// Whether to trigger playback after capture completion
  pub capture_playback: bool,
  /// Per-channel capture data
  pub capture_channels: Vec<CaptureChannel>,
  /// Actual frame count during capture (tracks drops)
  pub capture_actual_frames: u32,
  /// Snapshot of gain at capture start
  pub capture_gain: f64,
  /// Snapshot of PPM at capture start
  pub capture_ppm: i32,
  /// Snapshot of FFT size at capture start
  pub capture_fft_size: usize,
  /// Snapshot of tuner AGC at capture start
  pub capture_tuner_agc: bool,
  /// Snapshot of RTL AGC at capture start
  pub capture_rtl_agc: bool,
  /// Snapshot of FFT window at capture start
  pub capture_fft_window: String,
  /// Geolocation data at capture start
  pub capture_geolocation: Option<crate::server::types::GeolocationData>,
  /// Overall center frequency of the requested capture range (Hz)
  pub capture_overall_center_hz: f64,
  /// Overall bandwidth of the requested capture range (Hz)
  pub capture_overall_span_hz: f64,
  /// Requested frequency range [min_hz, max_hz] from original fragments
  pub capture_requested_range: Option<(f64, f64)>,
  /// Metadata for reference based demod baseline
  pub capture_ref_based_demod_baseline: Option<String>,
  /// Whether capture is ephemeral (not persisted to disk)
  pub capture_is_ephemeral: bool,
  /// Last read gain (dB)
  pub current_gain_db: f64,
  /// Last read PPM
  pub current_ppm: i32,
  /// Last applied Tuner AGC
  pub current_tuner_agc: bool,
  /// Last applied RTL AGC
  pub current_rtl_agc: bool,
  /// Last phase spectrum for phase coherence tracking
  pub last_phase_spectrum: Option<Vec<f32>>,
  /// Phase coherence history for stitching validation
  pub phase_coherence_history: Vec<PhaseCoherenceResult>,
  /// Whether to enable phase-based stitching validation
  pub enable_phase_stitching: bool,
  /// Center frequency saved before capture starts, restored after capture ends
  pub capture_pre_center_freq: Option<u32>,
  /// Current power scale mode for spectrum display (dB or dBm)
  pub power_scale: crate::server::types::PowerScale,
  pub capture_requested_channels: Option<Vec<ChannelSpec>>,
}

impl SdrProcessor {
  /// Create a new SDR processor with automatic device selection
  pub fn new() -> Result<Self> {
    let device = SdrDeviceFactory::create_device()?;
    Self::with_device(device)
  }

  /// Create a new SDR processor with a specific device
  pub fn with_device(device: Box<dyn SdrDevice>) -> Result<Self> {
    let sample_rate = device.get_sample_rate();
    let _center_freq = device.get_center_frequency();

    // Load settings from signals.yaml
    let sdr_settings = crate::server::utils::load_sdr_settings();

    let fft_size = sdr_settings.fft.default_size;
    let min_db = sdr_settings.display.min_db;
    let max_db = sdr_settings.display.max_db;
    let default_frame_rate = sdr_settings.fft.default_frame_rate;

    let mut fft_processor =
      FFTProcessor::new_with_defaults(fft_size, sample_rate, min_db, max_db);

    // Align initial zoom width and size to config
    let mut cfg = fft_processor.config().clone();
    cfg.zoom_width = fft_size;

    // Set initial gain properly so baseline tuner gain maps to 0dB delta
    cfg.gain = 1.0;
    cfg.ppm = 0.0;

    fft_processor.update_config(cfg);

    let processor = Self {
      device,
      fft_processor,
      frame: SdrFrameState::new(fft_size),
      display_min_db: min_db,
      display_max_db: max_db,
      display_frame_rate: default_frame_rate,
      training_active: false,
      training_label: None,
      training_signal_area: None,
      training_stitcher: None,
      training_samples: Vec::new(),
      capture_active: false,
      capture_is_manual_mode: false,
      capture_manual_stop: false,
      capture_job_id: None,
      capture_start: None,
      capture_duration_s: 0.0,
      capture_file_type: String::new(),
      capture_acquisition_mode: String::from("stepwise"),
      capture_fragments: Vec::new(),
      capture_current_fragment: 0,
      capture_last_hop: None,
      capture_encrypted: false,
      capture_playback: false,
      capture_channels: Vec::new(),
      capture_actual_frames: 0,
      capture_gain: 0.0,
      capture_ppm: 0,
      capture_fft_size: fft_size,
      capture_tuner_agc: false,
      capture_rtl_agc: false,
      capture_fft_window: String::from("Hanning"),
      capture_geolocation: None,
      capture_overall_center_hz: 0.0,
      capture_overall_span_hz: 0.0,
      capture_requested_range: None,
      capture_ref_based_demod_baseline: None,
      capture_is_ephemeral: false,
      current_gain_db: -999.0, // Force first update
      current_ppm: -999999,    // Force first update
      current_tuner_agc: false,
      current_rtl_agc: false,
      last_phase_spectrum: None,
      phase_coherence_history: Vec::new(),
      enable_phase_stitching: true,
      capture_pre_center_freq: None,
      power_scale: crate::server::types::PowerScale::DB, // Default to dB mode
      capture_requested_channels: None,
    };

    let mut processor = processor;

    // Apply initial settings from config immediately to tune the hardware
    processor.apply_settings(crate::server::types::SdrProcessorSettings {
      fft_size: Some(sdr_settings.fft.default_size),
      frame_rate: Some(sdr_settings.fft.default_frame_rate),
      gain: Some(sdr_settings.gain.tuner_gain),
      ppm: Some(sdr_settings.ppm as i32),
      tuner_agc: Some(sdr_settings.gain.tuner_agc),
      rtl_agc: Some(sdr_settings.gain.rtl_agc),
      ..Default::default()
    })?;

    processor.set_center_frequency(sdr_settings.center_frequency)?;

    info!(
      "SDR processor created and synchronized with device: {}",
      processor.device.device_type()
    );
    Ok(processor)
  }

  /// Force mock APT mode
  pub fn new_mock_apt() -> Result<Self> {
    let device = SdrDeviceFactory::create_mock_device();
    Self::with_device(device)
  }

  /// Force RTL-SDR mode (will error if no device available)
  pub fn new_rtlsdr() -> Result<Self> {
    let device = SdrDeviceFactory::create_rtlsdr_device()?;
    Self::with_device(device)
  }

  /// Initialize the SDR processor and device
  pub fn initialize(&mut self) -> Result<()> {
    self.device.initialize()?;
    info!(
      "SDR processor initialized with {}",
      self.device.device_type()
    );
    Ok(())
  }

  /// Swap out the fundamental SDR device during execution (e.g. mock -> real)
  pub fn swap_device(&mut self, mut device: Box<dyn SdrDevice>) -> Result<()> {
    device.initialize()?;
    self.device = device;

    // Reset tracked state to force re-application to new hardware
    self.current_gain_db = -1.0;
    self.current_ppm = -999;

    // Push current config to the new hardware
    let settings = crate::server::utils::load_sdr_settings();
    self.apply_settings(crate::server::types::SdrProcessorSettings {
      gain: Some(settings.gain.tuner_gain),
      ppm: Some(settings.ppm as i32),
      tuner_agc: Some(settings.gain.tuner_agc),
      rtl_agc: Some(settings.gain.rtl_agc),
      ..Default::default()
    })?;
    self.set_center_frequency(settings.center_frequency)?;

    info!(
      "SDR processor swapped and synchronized to {}",
      self.device.device_type()
    );

    self.frame.retune_cooldown_until =
      Some(std::time::Instant::now() + std::time::Duration::from_millis(500));
    self.frame.post_retune_discard_frames =
      self.post_retune_discard_frame_count();
    self.flush_read_queue();

    Ok(())
  }

  /// Check if the current device is a mock device
  pub fn is_mock(&self) -> bool {
    self.device.device_type().contains("Mock")
  }

  /// Check if the underlying device is still healthy
  pub fn is_healthy(&self) -> bool {
    self.device.is_healthy()
  }

  /// Get detailed device info from the underlying hardware
  pub fn get_device_info(&self) -> String {
    self.device.get_device_info()
  }

  /// Check if the device is ready for reading
  pub fn is_ready(&self) -> bool {
    self.device.is_ready()
  }

  /// Read and process one frame from the device
  pub fn read_and_process_frame(&mut self) -> Result<Vec<f32>> {
    let fft_size = self.fft_processor.config().fft_size;
    let sample_rate = self.get_sample_rate();

    // If we're in a retune cooldown window, avoid touching the device
    if let Some(until) = self.frame.retune_cooldown_until {
      if Instant::now() < until {
        if let Some(ref avg) = self.frame.avg_spectrum {
          return Ok(avg.clone());
        }
        return Ok(vec![-120.0; fft_size]);
      }
      self.frame.retune_cooldown_until = None;
    }

    if let Some(freq) = self.frame.pending_freq {
      self.frame.pending_freq = None;

      if freq != self.get_center_frequency() {
        if let Err(e) = self.set_center_frequency(freq) {
          warn!("Failed to apply pending frequency: {}", e);
        } else {
          self.frame.last_retune_at = Some(Instant::now());
          self.frame.post_retune_discard_frames =
            self.post_retune_discard_frame_count();
        }
      }
    }

    // 0. Handle capture fragment hopping
    if self.capture_active && self.capture_fragments.len() > 1 {
      let elapsed = self
        .capture_start
        .map(|s| s.elapsed().as_secs_f64())
        .unwrap_or(0.0);

      let expected_segment = if self.capture_acquisition_mode == "interleaved" {
        let num_segments = self.capture_fragments.len();
        let slice_duration = 1.0 / 63.0;
        let current_slice = (elapsed / slice_duration) as usize;
        current_slice % num_segments
      } else if self.capture_acquisition_mode == "whole_sample" {
        0
      } else {
        let time_per_segment =
          self.capture_duration_s / (self.capture_fragments.len() as f64);
        ((elapsed / time_per_segment) as usize)
          .min(self.capture_fragments.len() - 1)
      };

      if expected_segment != self.capture_current_fragment {
        self.capture_current_fragment = expected_segment;
        let &(min_freq, _max_freq) = &self.capture_fragments[expected_segment];

        let new_center_freq =
          ((min_freq) + (sample_rate as f64 / 2.0)) as u32;
        if let Err(e) = self.set_center_frequency(new_center_freq) {
          warn!("Failed to hop capture frequency: {}", e);
        }
        self.capture_last_hop = Some(Instant::now());
        self.frame.post_retune_discard_frames =
          self.post_retune_discard_frame_count();
      }
    }

    // 1. Read ONE fresh block of FFT size directly from the async layer
    let mut samples = self.device.read_samples(fft_size)?;

    if samples.data.is_empty() {
      return Ok(vec![-120.0; fft_size]);
    }

    while self.frame.post_retune_discard_frames > 0 {
      self.frame.post_retune_discard_frames -= 1;

      let next_samples = self.device.read_samples(fft_size)?;
      if next_samples.data.is_empty() {
        if let Some(ref held) = self.frame.last_stable_spectrum {
          return Ok(held.clone());
        }
        return Ok(vec![-120.0; fft_size]);
      }

      samples = next_samples;
    }

    let display_samples_data = samples.data;
    let display_samples = crate::fft::types::RawSamples {
      data: display_samples_data.clone(),
      sample_rate,
    };

    // Process the samples through FFT
    let result = self.fft_processor.process_samples(&display_samples)?;
    let mut spectrum = result.power_spectrum;

    // DC spike suppression (skip for mock devices as they don't have hardware DC offset)
    let len = spectrum.len();
    if len > 6 && !self.device.device_type().contains("Mock") {
      let center = len / 2;
      let left = spectrum[center - 3];
      let right = spectrum[center + 3];
      for i in 0..5 {
        let t = (i + 1) as f32 / 6.0;
        spectrum[center - 2 + i] = left * (1.0 - t) + right * t;
      }
    }

    // Frame averaging (exponential moving average)
    let alpha = self.frame.avg_alpha;
    if let Some(ref mut avg) = self.frame.avg_spectrum {
      if avg.len() == spectrum.len() {
        for (i, val) in spectrum.iter().enumerate() {
          avg[i] = alpha * val + (1.0 - alpha) * avg[i];
        }
      } else {
        *avg = spectrum.clone();
      }
    } else {
      self.frame.avg_spectrum = Some(spectrum.clone());
    }
    // Borrow the averaged spectrum for output (avoids extra clone)
    let final_spectrum = self
      .frame
      .avg_spectrum
      .as_ref()
      .cloned()
      .unwrap_or_else(|| spectrum.clone());

    if self.capture_active {
      let ch_idx = self.capture_current_fragment;
      if ch_idx < self.capture_channels.len() {
        self.capture_channels[ch_idx]
          .iq_data
          .extend_from_slice(&display_samples_data);
        self.capture_channels[ch_idx]
          .spectrum_data
          .extend_from_slice(&spectrum);
      }
      self.capture_actual_frames += 1;
    }

    self.frame.push_raw_iq_frame(display_samples_data.clone());
    self.frame.last_frame_raw_iq = display_samples_data;
    self.frame.last_stable_spectrum = Some(final_spectrum.clone());

    Ok(final_spectrum)
  }

  /// Apply settings to both the device and FFT processor
  pub fn apply_settings(
    &mut self,
    settings: crate::server::types::SdrProcessorSettings,
  ) -> Result<()> {
    let mut config = self.fft_processor.config().clone();
    let mut config_changed = false;

    let fft_size = settings.fft_size;
    let fft_window = settings.fft_window;
    let frame_rate = settings.frame_rate;
    let gain = settings.gain;
    let ppm = settings.ppm;
    let tuner_agc = settings.tuner_agc;
    let rtl_agc = settings.rtl_agc;

    // Always ensure the FFT processor sample rate matches the device
    let device_sample_rate = self.device.get_sample_rate();
    if config.sample_rate != device_sample_rate {
      config.sample_rate = device_sample_rate;
      if let Some(ref mut simd) = self.fft_processor.simd_processor_mut() {
        let _: () = simd.set_sample_rate(device_sample_rate);
      }
      config_changed = true;
      info!(
        "Updated FFT processor sample rate to {} Hz",
        device_sample_rate
      );
    }

    // FFT size
    if let Some(size) = fft_size {
      if size > 0 && (size & (size - 1)) == 0 {
        if config.fft_size != size {
          config.fft_size = size;
          config.zoom_width = size;
          config_changed = true;
          info!("FFT size changed to {}", size);

          let reserve_samples = size.saturating_mul(2);
          self.frame.iq_accumulator.reserve_exact(reserve_samples);
          self.frame.iq_frame.reserve_exact(reserve_samples);
          self.frame.last_frame_raw_iq.reserve_exact(reserve_samples);
          self.frame.resize_raw_iq_history(size);
        }
      } else {
        warn!("Invalid FFT size {} (must be power of 2), ignoring", size);
      }
    }

    // FFT window
    if let Some(ref window_name) = fft_window {
      let window_type = match window_name.to_lowercase().as_str() {
        "rectangular" | "none" => crate::fft::WindowType::Rectangular,
        "hanning" | "hann" => crate::fft::WindowType::Hanning,
        "hamming" => crate::fft::WindowType::Hamming,
        "blackman" => crate::fft::WindowType::Blackman,
        "nuttall" => crate::fft::WindowType::Nuttall,
        _ => {
          warn!("Unknown window type '{}', using Rectangular", window_name);
          crate::fft::WindowType::Rectangular
        }
      };
      if config.window_type != window_type {
        config.window_type = window_type;
        config_changed = true;
        info!("FFT window changed to {:?}", window_type);
      }
    }

    // Frame rate
    if let Some(requested_rate) = frame_rate {
      let max_rate = Self::calculate_valid_frame_rate(config.fft_size);
      let clamped_rate = requested_rate.clamp(1, max_rate);
      if clamped_rate != requested_rate {
        warn!(
          "Requested frame rate {} fps exceeds maximum {} fps, clamping to {}",
          requested_rate, max_rate, clamped_rate
        );
      }
      self.display_frame_rate = clamped_rate;
      info!("Frame rate set to {} fps", clamped_rate);
    }

    // Device settings
    if let Some(g_db) = gain {
      if (self.current_gain_db - g_db).abs() > 0.01 {
        if let Err(e) = self.device.set_gain(g_db) {
          warn!("Failed to set hardware gain: {}", e);
        }
        self.current_gain_db = g_db;
      }

      // SIMD gain is always 1.0 (passthrough).
      // Mock devices handle gain internally in IQ generation (signal amplitude
      // scales with gain, noise floor stays fixed). Real hardware gain is
      // applied by the physical tuner before ADC sampling.
      config.gain = 1.0;
      config_changed = true;
    }

    if let Some(p) = ppm {
      if self.current_ppm != p {
        if let Err(e) = self.device.set_ppm(p) {
          warn!("Failed to set hardware PPM: {}", e);
        }
        self.current_ppm = p;
      }

      if self.is_mock() {
        config.ppm = p as f32;
      } else {
        config.ppm = 0.0;
      }
      config_changed = true;
    }

    if let Some(tuner_agc) = tuner_agc {
      if self.current_tuner_agc != tuner_agc {
        self.device.set_tuner_agc(tuner_agc)?;
        self.current_tuner_agc = tuner_agc;
      }
    }

    if let Some(rtl_agc) = rtl_agc {
      if self.current_rtl_agc != rtl_agc {
        self.device.set_rtl_agc(rtl_agc)?;
        self.current_rtl_agc = rtl_agc;
      }
    }

    if let Some(offset_tuning) = settings.offset_tuning {
      self.device.set_offset_tuning(offset_tuning)?;
    }

    if let Some(direct_sampling) = settings.direct_sampling {
      self.device.set_direct_sampling(direct_sampling)?;
    }

    if let Some(bandwidth) = settings.tuner_bandwidth {
      self.device.set_tuner_bandwidth(bandwidth)?;
    }

    if config_changed {
      self.fft_processor.update_config(config);
    }

    Ok(())
  }

  /// Calculate maximum frame rate for given FFT size
  pub fn calculate_valid_frame_rate(fft_size: usize) -> u32 {
    match fft_size {
      0..=8192 => 60,
      8193..=16384 => 60,
      16385..=32768 => 60,
      32769..=65536 => 48,
      65537..=131072 => 24,
      _ => 12,
    }
  }

  fn post_retune_discard_frame_count(&self) -> usize {
    if self.is_mock() {
      0
    } else {
      3
    }
  }

  /// Set center frequency
  pub fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
    self.device.set_center_frequency(freq)?;
    if let Some(ref mut simd) = self.fft_processor.simd_processor_mut() {
      let _: () = simd.set_center_frequency(freq);
    }
    self.frame.avg_spectrum = None;
    self.frame.last_retune_at = Some(std::time::Instant::now());
    self.frame.post_retune_discard_frames =
      self.post_retune_discard_frame_count();
    Ok(())
  }

  /// Queue a center frequency change for the next stable window instead of applying immediately.
  pub fn queue_center_frequency(&mut self, freq: u32) {
    self.frame.pending_freq = Some(freq);
  }

  /// Flush the underlying device read queue and clear software buffers
  pub fn flush_read_queue(&mut self) {
    self.device.flush_read_queue();
    self.frame.iq_accumulator.clear();
    self.frame.iq_frame.clear();
    self.frame.raw_iq_history.clear();
  }

  /// Validate stitching between two captured channels using correlation
  pub fn validate_channel_stitching(
    &mut self,
    channel1_idx: usize,
    channel2_idx: usize,
    overlap_samples: usize,
  ) -> Result<StitchingValidationResult> {
    if channel1_idx >= self.capture_channels.len()
      || channel2_idx >= self.capture_channels.len()
    {
      return Err(anyhow::anyhow!("Invalid channel indices"));
    }

    let channel1 = &self.capture_channels[channel1_idx];
    let channel2 = &self.capture_channels[channel2_idx];

    let validation_result = self.fft_processor.validate_stitching(
      &channel1.iq_data,
      &channel2.iq_data,
      overlap_samples,
    )?;

    info!(
      "Stitching validation: ch{} <-> ch{} = {:.3} (method: {:?}, quality: {:.3})",
      channel1_idx,
      channel2_idx,
      validation_result.primary_correlation.correlation_score,
      validation_result.primary_correlation.method,
      validation_result.overall_quality
    );

    Ok(validation_result)
  }

  /// Validate stitching with automatic overlap detection
  pub fn validate_stitching_auto(
    &mut self,
    channel1_idx: usize,
    channel2_idx: usize,
  ) -> Result<StitchingValidationResult> {
    if channel1_idx >= self.capture_channels.len()
      || channel2_idx >= self.capture_channels.len()
    {
      return Err(anyhow::anyhow!("Invalid channel indices"));
    }

    let channel1 = &self.capture_channels[channel1_idx];
    let channel2 = &self.capture_channels[channel2_idx];

    let freq_diff = (channel2.center_freq_hz - channel1.center_freq_hz).abs();
    let sample_rate = channel1.sample_rate_hz;
    let overlap_ratio = 1.0 - (freq_diff / sample_rate);
    let overlap_samples = if overlap_ratio > 0.1 && overlap_ratio < 0.9 {
      (channel1.iq_data.len() as f64 * overlap_ratio / 2.0) as usize
    } else {
      channel1.iq_data.len() / 8
    };

    info!(
      "Auto overlap detection: freq_diff={:.1}kHz, overlap_ratio={:.3}, overlap_samples={}",
      freq_diff / 1000.0,
      overlap_ratio,
      overlap_samples
    );

    self.validate_channel_stitching(channel1_idx, channel2_idx, overlap_samples)
  }

  /// Apply stitching correction based on validation result
  pub fn apply_stitching_correction(
    &mut self,
    channel_idx: usize,
    validation_result: &StitchingValidationResult,
  ) -> Result<()> {
    if channel_idx >= self.capture_channels.len() {
      return Err(anyhow::anyhow!("Invalid channel index"));
    }

    match validation_result.recommendation.clone() {
      crate::fft::StitchingRecommendation::Accept => {
        info!("Channel {} stitching accepted", channel_idx);
      }
      crate::fft::StitchingRecommendation::ApplyTimeCorrection(time_offset) => {
        info!(
          "Applying time correction to channel {}: {:.6} seconds",
          channel_idx, time_offset
        );
        let channel = &mut self.capture_channels[channel_idx];
        let total_sample_offset = time_offset * channel.sample_rate_hz;

        let integer_offset = total_sample_offset.floor() as isize;
        let fractional_offset =
          (total_sample_offset - total_sample_offset.floor()) as f32;

        if integer_offset != 0
          && integer_offset.abs() < channel.iq_data.len() as isize / 4
        {
          let bytes_to_shift = integer_offset.abs() as usize * 2;
          if integer_offset > 0 {
            channel.iq_data.splice(0..0, vec![128u8; bytes_to_shift]);
          } else {
            channel.iq_data.drain(0..bytes_to_shift);
          }
        }

        if fractional_offset.abs() > 0.001 {
          let complex_samples =
            self.fft_processor.iq_to_complex(&channel.iq_data);
          let mut interpolated = Vec::with_capacity(complex_samples.len());

          for i in 0..complex_samples.len() - 1 {
            let s1 = complex_samples[i];
            let s2 = complex_samples[i + 1];
            let s_interp =
              s1 * (1.0 - fractional_offset) + s2 * fractional_offset;
            interpolated.push(s_interp);
          }
          if let Some(&last) = complex_samples.last() {
            interpolated.push(last);
          }

          channel.iq_data = interpolated
            .iter()
            .flat_map(|c| {
              let i = ((c.re * 127.0) + 128.0).clamp(0.0, 255.0) as u8;
              let q = ((c.im * 127.0) + 128.0).clamp(0.0, 255.0) as u8;
              [i, q]
            })
            .collect();
        }
      }
      crate::fft::StitchingRecommendation::ApplyPhaseCorrection(
        phase_offset,
      ) => {
        info!(
          "Applying phase correction to channel {}: {:.3} radians",
          channel_idx, phase_offset
        );
        let channel = &mut self.capture_channels[channel_idx];
        let complex_samples =
          self.fft_processor.iq_to_complex(&channel.iq_data);
        let rotation = Complex::new(phase_offset.cos(), phase_offset.sin());

        let corrected_samples: Vec<u8> = complex_samples
          .iter()
          .map(|c| {
            let corrected = c * rotation;
            let i = ((corrected.re * 127.0) + 128.0) as u8;
            let q = ((corrected.im * 127.0) + 128.0) as u8;
            [i, q]
          })
          .flatten()
          .collect();

        channel.iq_data = corrected_samples;
      }
      crate::fft::StitchingRecommendation::Reject => {
        warn!(
          "Channel {} stitching rejected - poor correlation",
          channel_idx
        );
        return Err(anyhow::anyhow!("Stitching quality too poor"));
      }
      crate::fft::StitchingRecommendation::ApplyGainNormalization(gain_db) => {
        info!(
          "Applying gain normalization to channel {}: {:.3} dB",
          channel_idx, gain_db
        );
      }
      crate::fft::StitchingRecommendation::ApplySpectralFlattening(
        _flattening,
      ) => {
        info!("Applying spectral flattening to channel {}", channel_idx);
      }
      crate::fft::StitchingRecommendation::UseAlternativeMethod(method) => {
        info!(
          "Retrying channel {} with alternative method: {:?}",
          channel_idx, method
        );
        let channel = &self.capture_channels[channel_idx];
        let overlap_samples = channel.iq_data.len() / 8;

        if channel_idx > 0 {
          let alt_validation = self.fft_processor.correlate_signals(
            &self.capture_channels[channel_idx - 1].iq_data,
            &channel.iq_data,
            overlap_samples,
            method,
          )?;

          if alt_validation.is_acceptable {
            info!("Alternative method succeeded for channel {}", channel_idx);
          } else {
            warn!("Alternative method also failed for channel {}", channel_idx);
            return Err(anyhow::anyhow!("All correlation methods failed"));
          }
        }
      }
    }

    Ok(())
  }

  /// Validate and correct all channel stitching in capture
  pub fn validate_and_correct_all_stitching(
    &mut self,
  ) -> Result<Vec<StitchingValidationResult>> {
    let mut validation_results = Vec::new();

    if self.capture_channels.len() < 2 {
      return Ok(validation_results);
    }

    info!(
      "Validating stitching for {} channels",
      self.capture_channels.len()
    );

    for i in 0..self.capture_channels.len() - 1 {
      match self.validate_stitching_auto(i, i + 1) {
        Ok(validation) => {
          validation_results.push(validation.clone());

          if let Err(e) = self.apply_stitching_correction(i + 1, &validation) {
            warn!("Failed to apply correction to channel {}: {}", i + 1, e);
          }
        }
        Err(e) => {
          warn!(
            "Failed to validate stitching between channels {} and {}: {}",
            i,
            i + 1,
            e
          );
        }
      }
    }

    let acceptable_count = validation_results
      .iter()
      .filter(|v| v.primary_correlation.is_acceptable)
      .count();

    warn!(
      "Stitching validation complete: {}/{} channel pairs acceptable",
      acceptable_count,
      validation_results.len()
    );

    Ok(validation_results)
  }

  /// Get current center frequency
  pub fn get_center_frequency(&self) -> u32 {
    self.device.get_center_frequency()
  }

  /// Get current sample rate
  pub fn get_sample_rate(&self) -> u32 {
    self.device.get_sample_rate()
  }

  /// Set power scale mode (dB or dBm)
  pub fn set_power_scale(&mut self, scale: crate::server::types::PowerScale) {
    info!("Power scale set to: {:?}", scale);
    self.power_scale = scale;
  }

  /// Get current power scale mode
  pub fn get_power_scale(&self) -> crate::server::types::PowerScale {
    self.power_scale.clone()
  }

  /// Get device type information
  pub fn device_type(&self) -> &'static str {
    self.device.device_type()
  }

  /// Reset device buffers
  pub fn reset_buffer(&mut self) -> Result<()> {
    self.device.reset_buffer()?;
    self.frame.iq_accumulator.clear();
    self.frame.iq_offset = 0;
    self.frame.avg_spectrum = None;
    self.frame.raw_iq_history.clear();
    Ok(())
  }

  /// Cleanup resources
  pub fn cleanup(&mut self) -> Result<()> {
    self.device.cleanup()?;
    info!("SDR processor cleanup completed");
    Ok(())
  }

  /// Stop an active capture immediately.
  pub fn stop_capture(&mut self) -> Option<CaptureResult> {
    if !self.capture_active {
      return None;
    }

    self.capture_manual_stop = true;
    self.check_capture_completion()
  }

  /// Check capture completion and return multi-channel result
  pub fn check_capture_completion(&mut self) -> Option<CaptureResult> {
    if !self.capture_active {
      return None;
    }

    if !self.capture_manual_stop {
      if self.capture_is_manual_mode {
        return None;
      }
      if let Some(start) = self.capture_start {
        if start.elapsed().as_secs_f64() < self.capture_duration_s {
          return None;
        }
      } else {
        return None;
      }
    }

    self.capture_active = false;
    let duration_mode = if self.capture_is_manual_mode {
      "manual"
    } else {
      "timed"
    }
    .to_string();
    let actual_duration_s = if self.capture_is_manual_mode {
      self
        .capture_start
        .map(|start| start.elapsed().as_secs_f64())
        .unwrap_or(self.capture_duration_s)
    } else {
      self.capture_duration_s
    };
    self.capture_is_manual_mode = false;
    self.capture_manual_stop = false;
    let job_id = self
      .capture_job_id
      .take()
      .unwrap_or_else(|| "unknown".to_string());

    if let Some(pre_freq) = self.capture_pre_center_freq.take() {
      if let Err(e) = self.set_center_frequency(pre_freq) {
        warn!("Failed to restore pre-capture center frequency: {}", e);
      }
    }

    self.capture_last_hop = None;
    self.capture_fragments.clear();
    self.capture_current_fragment = 0;
    self.capture_start = None;

    let mut channels = std::mem::take(&mut self.capture_channels);
    // Apply frontend channel selection trimming if provided (Patch B)
    if let Some(sel) = self.capture_requested_channels.as_ref() {
      channels = trim_channels_by_spec(&channels, sel);
    }

    info!(
      "[CAPTURE COMPLETE] job={}, mode={}, num_channels={}",
      job_id,
      self.capture_acquisition_mode,
      channels.len()
    );

    let fft_size_dbg = self.fft_processor.config().fft_size;
    for (idx, ch) in channels.iter().enumerate() {
      let num_frames = if fft_size_dbg > 0 {
        ch.spectrum_data.len() / fft_size_dbg
      } else {
        0
      };
      info!("  ch[{}]: center={:.3}Hz, sr={:.3}Hz, spectrum_frames={}, iq_bytes={}", idx, ch.center_freq_hz, ch.sample_rate_hz, num_frames, ch.iq_data.len());
    }

    if channels.len() > 1 {
      let fft_size = self.fft_processor.config().fft_size;

      for i in 1..channels.len() {
        let prev_max =
          channels[i - 1].center_freq_hz + channels[i - 1].sample_rate_hz / 2.0;
        let curr_min =
          channels[i].center_freq_hz - channels[i].sample_rate_hz / 2.0;
        let overlap_hz = prev_max - curr_min;

        if overlap_hz > 0.0 {
          let midpoint_hz = (prev_max + curr_min) / 2.0;

          let prev_overlap_hz = prev_max - midpoint_hz;
          let prev_trim_fraction =
            prev_overlap_hz / channels[i - 1].sample_rate_hz;
          let prev_trim_bins =
            (fft_size as f64 * prev_trim_fraction).round() as usize;

          if prev_trim_bins > 0
            && prev_trim_bins < (channels[i - 1].bins_per_frame as usize)
          {
            if !channels[i - 1].spectrum_data.is_empty() {
              let old_bins = channels[i - 1].bins_per_frame as usize;
              let new_bins = old_bins - prev_trim_bins;
              let num_frames = channels[i - 1].spectrum_data.len() / old_bins;
              let mut new_spectrum = Vec::with_capacity(num_frames * new_bins);

              for f in 0..num_frames {
                let start = f * old_bins;
                let end = start + new_bins;
                new_spectrum.extend_from_slice(
                  &channels[i - 1].spectrum_data[start..end],
                );
              }
              channels[i - 1].spectrum_data = new_spectrum;
              channels[i - 1].bins_per_frame = new_bins as u32;
            }
            channels[i - 1].sample_rate_hz -= prev_overlap_hz;
            channels[i - 1].center_freq_hz -= prev_overlap_hz / 2.0;
          }

          let curr_overlap_hz = midpoint_hz - curr_min;
          let curr_trim_fraction = curr_overlap_hz / channels[i].sample_rate_hz;
          let curr_trim_bins =
            (fft_size as f64 * curr_trim_fraction).round() as usize;

          if curr_trim_bins > 0 && curr_trim_bins < fft_size {
            if !channels[i].spectrum_data.is_empty() {
              let num_frames = channels[i].spectrum_data.len() / fft_size;
              let new_bins = fft_size - curr_trim_bins;
              let mut new_spectrum = Vec::with_capacity(num_frames * new_bins);

              for f in 0..num_frames {
                let start = f * fft_size + curr_trim_bins;
                let end = (f + 1) * fft_size;
                new_spectrum
                  .extend_from_slice(&channels[i].spectrum_data[start..end]);
              }
              channels[i].spectrum_data = new_spectrum;
              channels[i].bins_per_frame = new_bins as u32;
            } else {
              channels[i].bins_per_frame = (fft_size - curr_trim_bins) as u32;
            }
            channels[i].sample_rate_hz -= curr_overlap_hz;
            channels[i].center_freq_hz += curr_overlap_hz / 2.0;
          }
        } else if channels[i].bins_per_frame == 0 {
          channels[i].bins_per_frame = fft_size as u32;
        }
      }

      for i in 1..channels.len() {
        let (previous, rest) = channels.split_at_mut(i);
        let prev = &previous[i - 1];
        let curr = &mut rest[0];
        if prev.spectrum_data.is_empty()
          || curr.spectrum_data.is_empty()
          || prev.bins_per_frame == 0
          || curr.bins_per_frame == 0
        {
          continue;
        }

        let prev_bins = prev.bins_per_frame as usize;
        let curr_bins = curr.bins_per_frame as usize;
        let prev_frame_start =
          prev.spectrum_data.len().saturating_sub(prev_bins);
        let curr_frame_end = curr_bins.min(curr.spectrum_data.len());
        let seam_bins = prev_bins.min(curr_bins).min(128);

        crate::fft::match_noise_floor_db(
          &prev.spectrum_data[prev_frame_start..],
          &mut curr.spectrum_data[..curr_frame_end],
          seam_bins,
        );
      }
    }

    if !channels.is_empty() && channels[0].bins_per_frame == 0 {
      channels[0].bins_per_frame = self.fft_processor.config().fft_size as u32;
    }

    Some(CaptureResult {
      job_id,
      channels,
      file_type: self.capture_file_type.clone(),
      acquisition_mode: self.capture_acquisition_mode.clone(),
      duration_mode,
      encrypted: self.capture_encrypted,
      fft_size: self.capture_fft_size as u32,
      duration_s: actual_duration_s,
      actual_frame_count: self.capture_actual_frames,
      fft_window: self.capture_fft_window.clone(),
      gain: self.capture_gain,
      ppm: self.capture_ppm,
      tuner_agc: self.capture_tuner_agc,
      rtl_agc: self.capture_rtl_agc,
      source_device: self.device_type().to_string(),
      hardware_sample_rate_hz: self.get_sample_rate() as f64,
      overall_center_frequency_hz: self.capture_overall_center_hz,
      overall_capture_sample_rate_hz: self.capture_overall_span_hz,
      geolocation: self.capture_geolocation.clone(),
      frequency_range: self.capture_requested_range,
      ref_based_demod_baseline: self.capture_ref_based_demod_baseline.take(),
      is_mock_apt: self.device.device_type().contains("Mock"),
      is_ephemeral: self.capture_is_ephemeral,
    })
  }

  #[cfg(rs_decrypted)]
  pub fn handle_scan(
    &mut self,
    range_hz: (f64, f64),
    window_hz: f64,
    step_hz: f64,
    threshold: f32,
    job_id: &str,
    broadcast_tx: &tokio::sync::broadcast::Sender<String>,
  ) -> Vec<FrequencyRegion> {
    if self.frame.last_frame_raw_iq.is_empty() {
      return vec![];
    }

    let iq_samples = &self.frame.last_frame_raw_iq;
    let sample_rate = self.get_sample_rate() as f32;
    let total_samples = (iq_samples.len() / 2) as f32;

    let start_hz = range_hz.0;
    let end_hz = range_hz.1;
    let total_steps = ((end_hz - start_hz) / step_hz).ceil() as usize;

    let mut regions = Vec::new();

    for step in 0..total_steps {
      let center_hz = start_hz + (step as f64 * step_hz) + (window_hz / 2.0);
      if center_hz + (window_hz / 2.0) > end_hz {
        break;
      }

      let freq_to_sample_ratio = total_samples / sample_rate;
      let center_sample = (center_hz * freq_to_sample_ratio as f64) as usize;
      let window_samples = (window_hz * freq_to_sample_ratio as f64) as usize;

      let start_idx = center_sample.saturating_sub(window_samples / 2);
      let end_idx =
        (center_sample + window_samples / 2).min(total_samples as usize);

      if start_idx >= end_idx {
        continue;
      }

      let window_iq = &iq_samples[start_idx * 2..end_idx * 2];
      let demodulated = demod_kernels::fm_demodulate(window_iq, sample_rate);
      let audio_score =
        demod_kernels::calculate_audio_score(&demodulated, sample_rate);

      if audio_score >= threshold {
        regions.push(FrequencyRegion {
          start_freq: center_hz - window_hz / 2.0,
          end_freq: center_hz + window_hz / 2.0,
          center_freq: center_hz,
          audio_score,
          signal_strength: 0.0, // Should implement signal power calculation
          snr: 15.0,            // Mock SNR
        });
      }

      // Progress reporting
      if step % 20 == 0 || step == total_steps - 1 {
        let progress = (step + 1) as f32 / total_steps as f32;
        let prog_msg = ScanProgressResponse {
          message_type: "scan_progress".to_string(),
          job_id: job_id.to_string(),
          progress,
          current_freq: center_hz,
          regions_length: regions.len(),
        };
        if let Ok(json) = serde_json::to_string(&prog_msg) {
          let _ = broadcast_tx.send(json);
        }
      }
    }

    regions
  }

  #[cfg(rs_decrypted)]
  pub fn handle_demodulate(
    &mut self,
    region: &FrequencyRegion,
  ) -> (Vec<f32>, u32) {
    if self.frame.last_frame_raw_iq.is_empty() {
      return (vec![], 48000);
    }

    let iq_samples = &self.frame.last_frame_raw_iq;
    let sample_rate = self.get_sample_rate() as f32;
    let total_samples = (iq_samples.len() / 2) as f32;

    let freq_to_sample_ratio = total_samples / sample_rate;
    let center_sample =
      (region.center_freq * freq_to_sample_ratio as f64) as usize;
    let width_hz = region.end_freq - region.start_freq;
    let window_samples = (width_hz * freq_to_sample_ratio as f64) as usize;

    let start_idx = center_sample.saturating_sub(window_samples / 2);
    let end_idx =
      (center_sample + window_samples / 2).min(total_samples as usize);

    if start_idx >= end_idx {
      return (vec![], 48000);
    }

    let window_iq = &iq_samples[start_idx * 2..end_idx * 2];
    let demodulated_fm = demod_kernels::fm_demodulate(window_iq, sample_rate);

    let target_rate = 48000.0;
    let audio_buffer = demod_kernels::am_demodulate_and_resample(
      &demodulated_fm,
      sample_rate,
      target_rate,
    );

    (audio_buffer, target_rate as u32)
  }
}
