//! # SDR Processor
//!
//! Main signal processing pipeline that uses the abstract SDR interface.
//! Handles both mock and real SDR devices seamlessly.

use anyhow::Result;
use log::{info, warn};
use std::time::Instant;
use rustfft::num_complex::Complex;

use crate::fft::{FFTProcessor, PhaseCoherenceResult, CorrelationResult, StitchingValidationResult, CorrelationMethod};
use crate::stitching::SignalStitcher;

use super::{SdrDevice, SdrDeviceFactory};

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
}

/// Result returned from check_capture_completion
#[derive(Debug)]
pub struct CaptureResult {
  pub job_id: String,
  pub channels: Vec<CaptureChannel>,
  pub file_type: String,
  pub acquisition_mode: String,
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
  /// Requested frequency range [min_mhz, max_mhz] from the original capture fragments
  pub frequency_range: Option<(f64, f64)>,
  /// Reference based demod baseline metadata
  pub ref_based_demod_baseline: Option<String>,
  pub is_ephemeral: bool,
}

/// SDR processor that works with any SDR device implementation
pub struct SdrProcessor {
  /// The actual SDR device (mock or real hardware)
  device: Box<dyn SdrDevice>,
  /// FFT processor for signal processing
  pub fft_processor: FFTProcessor,
  /// Frame counter for time-based operations
  pub frame_counter: u64,
  /// Exponential moving average buffer for frame averaging
  pub avg_spectrum: Option<Vec<f32>>,
  /// EMA smoothing factor (0.0 = no smoothing, 1.0 = no averaging)
  pub avg_alpha: f32,
  /// Display min/max dB
  pub display_min_db: i32,
  pub display_max_db: i32,
  /// IQ sample accumulator for async reading
  pub iq_accumulator: Vec<u8>,
  /// Current read offset into iq_accumulator
  pub iq_offset: usize,
  /// Reusable IQ frame buffer
  pub iq_frame: Vec<u8>,
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
  /// List of fragments to capture (min_mhz, max_mhz)
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
  /// Requested frequency range [min_mhz, max_mhz] from original fragments
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
  /// Last time samples were read (to maintain real-time flow)
  pub last_read_instant: Option<Instant>,
  /// Pending frequency change (applied at start of next read cycle to debounce rapid slider drags)
  pub pending_freq: Option<u32>,
  /// Last time we applied a frequency change (to throttle rapid retunes)
  pub last_retune_at: Option<Instant>,
  /// Short cooldown window after a retune to let the device settle
  pub retune_cooldown_until: Option<Instant>,
  /// Number of freshly read frames to discard after a retune to avoid warmup contamination
  pub post_retune_discard_frames: usize,
  /// Last stable spectrum shown before a retune; used while draining warmup frames
  pub last_stable_spectrum: Option<Vec<f32>>,
  /// Last phase spectrum for phase coherence tracking
  pub last_phase_spectrum: Option<Vec<f32>>,
  /// Phase coherence history for stitching validation
  pub phase_coherence_history: Vec<PhaseCoherenceResult>,
  /// Whether to enable phase-based stitching validation
  pub enable_phase_stitching: bool,
  /// Center frequency saved before capture starts, restored after capture ends
  pub capture_pre_center_freq: Option<u32>,
  /// Raw IQ bytes from the most recently read device frame (offset-binary u8 pairs: I, Q, I, Q,...)
  /// Updated on every call to `read_and_process_frame` so callers can inspect the raw signal.
  pub last_frame_raw_iq: Vec<u8>,
  /// Current power scale mode for spectrum display (dB or dBm)
  pub power_scale: crate::server::types::PowerScale,
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
    // If the SDR processes the signal at `gain = 1.0`, it passes through unaltered.
    // We initialize config.gain to 1.0 (which is +0dB over baseline).
    // Initial gain/ppm for the digital processor is identity (Hardware handles it)
    cfg.gain = 1.0;
    cfg.ppm = 0.0;

    fft_processor.update_config(cfg);

    let processor = Self {
      device,
      fft_processor,
      frame_counter: 0,
      avg_spectrum: None,
      avg_alpha: 0.3,
      display_min_db: min_db,
      display_max_db: max_db,
      iq_accumulator: Vec::new(),
      iq_offset: 0,
      iq_frame: Vec::new(),
      display_frame_rate: default_frame_rate,
      training_active: false,
      training_label: None,
      training_signal_area: None,
      training_stitcher: None,
      training_samples: Vec::new(),
      capture_active: false,
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
      capture_tuner_agc: false,
      capture_rtl_agc: false,
      capture_fft_window: String::from("Rectangular"),
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
      last_read_instant: None,
      pending_freq: None,
      last_retune_at: None,
      retune_cooldown_until: None,
      post_retune_discard_frames: 0,
      last_stable_spectrum: None,
      last_phase_spectrum: None,
      phase_coherence_history: Vec::new(),
      enable_phase_stitching: true,
      capture_pre_center_freq: None,
      last_frame_raw_iq: Vec::new(),
      power_scale: crate::server::types::PowerScale::DB, // Default to dB mode
    };

    // Apply initial settings from config immediately to tune the hardware
    let mut processor = processor;
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

    // RTL-SDR Blog V4 and others need a moment to settle after swap/init.
    // Draining the initial stale buffers prevents health-check timeouts.
    self.retune_cooldown_until = Some(std::time::Instant::now() + std::time::Duration::from_millis(500));
    self.post_retune_discard_frames = self.post_retune_discard_frame_count();
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
    if let Some(until) = self.retune_cooldown_until {
      if Instant::now() < until {
        if let Some(ref avg) = self.avg_spectrum {
          return Ok(avg.clone());
        }
        return Ok(vec![-120.0; fft_size]);
      }
      self.retune_cooldown_until = None;
    }

    // Apply any pending frequency change (debounced from rapid slider drags)
    if let Some(freq) = self.pending_freq.take() {
      if freq == self.get_center_frequency() {
        // No change needed
      } else {
        // No retune cooldown - read_async handles settling internally
        if let Err(e) = self.set_center_frequency(freq) {
          warn!("Failed to apply pending frequency: {}", e);
        }
        self.last_retune_at = Some(Instant::now());
        self.post_retune_discard_frames = self.post_retune_discard_frame_count();
      }
    }

    // 0. Handle capture fragment hopping (TDMS is per-channel, not cross-channel)
    // Each fragment is its own channel; stepwise = sequential time slicing,
    // interleaved = rapid hopping within each channel's allocated time.
    if self.capture_active && self.capture_fragments.len() > 1 {
      let elapsed = self
        .capture_start
        .map(|s| s.elapsed().as_secs_f64())
        .unwrap_or(0.0);

      let expected_segment = if self.capture_acquisition_mode == "interleaved" {
        // TDMS mode: Slice across segments with enough dwell for hardware retune+settle
        let num_segments = self.capture_fragments.len();
        let slice_duration = 1.0 / 63.0; // 4ms (250 slices per second)
        let current_slice = (elapsed / slice_duration) as usize;
        current_slice % num_segments
      } else if self.capture_acquisition_mode == "whole_sample" {
        // Whole Sample mode: NO hopping, capture exactly what's there
        // Used when capture range equals hardware sample rate
        0 // Always stay on first/only segment
      } else {
        // Stepwise Naive mode: Divide total time sequentially
        let time_per_segment =
          self.capture_duration_s / (self.capture_fragments.len() as f64);
        ((elapsed / time_per_segment) as usize)
          .min(self.capture_fragments.len() - 1)
      };

      if expected_segment != self.capture_current_fragment {
        // Moving to the next segment — flush current IQ/spectrum to the segment entry
        // then tune to the new fragment
        self.capture_current_fragment = expected_segment;
        let &(min_freq, _max_freq) = &self.capture_fragments[expected_segment];

        let new_center_freq =
          ((min_freq * 1000000.0) + (sample_rate as f64 / 2.0)) as u32;
        if let Err(e) = self.set_center_frequency(new_center_freq) {
          warn!("Failed to hop capture frequency: {}", e);
        }
        // Do NOT reset the hardware buffer on every hop.
        // Frequent reset_buffer calls during fast interleaved hopping can
        // starve async reads and trigger persistent timeout loops.
        self.capture_last_hop = Some(Instant::now());
        self.post_retune_discard_frames = self.post_retune_discard_frame_count();

      }
    }

    // 1. Read ONE fresh block of FFT size directly from the async layer
    // The async layer handles discarding backlog and returning only the newest contiguous slice.
    let mut samples = self.device.read_samples(fft_size)?;

    if samples.data.is_empty() {
      return Ok(vec![-120.0; fft_size]); // fallback or handle error gracefully
    }

    while self.post_retune_discard_frames > 0 {
      self.post_retune_discard_frames -= 1;

      let next_samples = self.device.read_samples(fft_size)?;
      if next_samples.data.is_empty() {
        if let Some(ref held) = self.last_stable_spectrum {
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

    // DC spike suppression
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
    let final_spectrum = if let Some(ref mut avg) = self.avg_spectrum {
      if avg.len() == spectrum.len() {
        for (i, val) in spectrum.iter().enumerate() {
          avg[i] = alpha * val + (1.0 - alpha) * avg[i];
        }
        avg.clone()
      } else {
        self.avg_spectrum = Some(spectrum.clone());
        spectrum.clone()
      }
    } else {
      self.avg_spectrum = Some(spectrum.clone());
      spectrum.clone()
    };

    if self.capture_active {
      // Append the latest RAW spectrum frame to current channel (no visual EMA smoothing)
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

    // Store raw IQ bytes for external callers (e.g. diagnostic phase analysis)
    self.last_frame_raw_iq = display_samples_data.clone();

    self.last_stable_spectrum = Some(final_spectrum.clone());

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

      if self.is_mock() {
        // For mock, we can use the digital gain multiplier if the device doesn't handle it
        // but MockAptDevice DOES handle it. However, if we want to allow digital delta:
        let baseline_db =
          crate::server::utils::load_sdr_settings().gain.tuner_gain;
        let delta_db = g_db - baseline_db;
        config.gain = 10f32.powf(delta_db as f32 / 20.0);
      } else {
        // For real hardware, we rely ONLY on the tuner gain.
        // Digital gain should remain 1.0 (baseline) to avoid double-scaling.
        config.gain = 1.0;
      }
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
        // Mock device doesn't shift clock, so we use digital rotation
        config.ppm = p as f32;
      } else {
        // Hardware shifts clock, so digital rotation would double-correct
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
    // Simplified calculation - base on FFT size
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
    // Synchronize with SIMD processor for digital PPM correction
    if let Some(ref mut simd) = self.fft_processor.simd_processor_mut() {
      let _: () = simd.set_center_frequency(freq);
    }
    // Clear averaging when frequency changes
    self.avg_spectrum = None;
    self.last_retune_at = Some(std::time::Instant::now());
    self.post_retune_discard_frames = self.post_retune_discard_frame_count();
    Ok(())
  }

  /// Flush the underlying device read queue and clear software buffers
  pub fn flush_read_queue(&mut self) {
    self.device.flush_read_queue();
    self.iq_accumulator.clear();
    self.iq_frame.clear();
  }

  /// Validate stitching between two captured channels using correlation
  pub fn validate_channel_stitching(
    &mut self,
    channel1_idx: usize,
    channel2_idx: usize,
    overlap_samples: usize,
  ) -> Result<StitchingValidationResult> {
    if channel1_idx >= self.capture_channels.len() || channel2_idx >= self.capture_channels.len() {
      return Err(anyhow::anyhow!("Invalid channel indices"));
    }
    
    let channel1 = &self.capture_channels[channel1_idx];
    let channel2 = &self.capture_channels[channel2_idx];
    
    // Use FFT processor for correlation validation
    let validation_result = self.fft_processor.validate_stitching(
      &channel1.iq_data,
      &channel2.iq_data,
      overlap_samples,
    )?;
    
    // Store validation result for logging
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
    if channel1_idx >= self.capture_channels.len() || channel2_idx >= self.capture_channels.len() {
      return Err(anyhow::anyhow!("Invalid channel indices"));
    }
    
    let channel1 = &self.capture_channels[channel1_idx];
    let channel2 = &self.capture_channels[channel2_idx];
    
    // Estimate overlap based on frequency spacing and sample rate
    let freq_diff = (channel2.center_freq_hz - channel1.center_freq_hz).abs();
    let sample_rate = channel1.sample_rate_hz;
    let overlap_ratio = 1.0 - (freq_diff / sample_rate);
    let overlap_samples = if overlap_ratio > 0.1 && overlap_ratio < 0.9 {
      (channel1.iq_data.len() as f64 * overlap_ratio / 2.0) as usize // Convert to IQ samples
    } else {
      // Default to 25% overlap if frequency spacing doesn't suggest clear overlap
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
    
    match &validation_result.recommendation {
      crate::fft::StitchingRecommendation::Accept => {
        info!("Channel {} stitching accepted", channel_idx);
      }
      crate::fft::StitchingRecommendation::ApplyTimeCorrection(time_offset) => {
        info!("Applying time correction to channel {}: {:.6} seconds", channel_idx, time_offset);
        let channel = &mut self.capture_channels[channel_idx];
        let total_sample_offset = *time_offset * channel.sample_rate_hz;
        
        let integer_offset = total_sample_offset.floor() as isize;
        let fractional_offset = (total_sample_offset - total_sample_offset.floor()) as f32;
        
        // 1. First handle integer shift by draining/splicing (existing logic)
        if integer_offset != 0 && integer_offset.abs() < channel.iq_data.len() as isize / 4 {
          let bytes_to_shift = integer_offset.abs() as usize * 2;
          if integer_offset > 0 {
            channel.iq_data.splice(0..0, vec![128u8; bytes_to_shift]);
          } else {
            channel.iq_data.drain(0..bytes_to_shift);
          }
        }
        
        // 2. Then handle fractional shift via linear interpolation
        if fractional_offset.abs() > 0.001 {
          let complex_samples = self.fft_processor.iq_to_complex(&channel.iq_data);
          let mut interpolated = Vec::with_capacity(complex_samples.len());
          
          for i in 0..complex_samples.len() - 1 {
            let s1 = complex_samples[i];
            let s2 = complex_samples[i+1];
            // Linear interpolation: s(t + d) = (1-d)*s(t) + d*s(t+1)
            let s_interp = s1 * (1.0 - fractional_offset) + s2 * fractional_offset;
            interpolated.push(s_interp);
          }
          // Push last sample unchanged or drop it
          if let Some(&last) = complex_samples.last() {
            interpolated.push(last);
          }
          
          // Convert back to I/Q bytes
          channel.iq_data = interpolated.iter()
            .flat_map(|c| {
              let i = ((c.re * 127.0) + 128.0).clamp(0.0, 255.0) as u8;
              let q = ((c.im * 127.0) + 128.0).clamp(0.0, 255.0) as u8;
              [i, q]
            })
            .collect();
        }
      }
      crate::fft::StitchingRecommendation::ApplyPhaseCorrection(phase_offset) => {
        info!("Applying phase correction to channel {}: {:.3} radians", channel_idx, phase_offset);
        // Apply phase correction by rotating complex samples
        let channel = &mut self.capture_channels[channel_idx];
        let complex_samples = self.fft_processor.iq_to_complex(&channel.iq_data);
        let rotation = Complex::new(phase_offset.cos(), phase_offset.sin());
        
        // Apply rotation and convert back to I/Q
        let corrected_samples: Vec<u8> = complex_samples.iter()
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
        warn!("Channel {} stitching rejected - poor correlation", channel_idx);
        return Err(anyhow::anyhow!("Stitching quality too poor"));
      }
      crate::fft::StitchingRecommendation::ApplyGainNormalization(gain_db) => {
        info!("Applying gain normalization to channel {}: {:.3} dB", channel_idx, gain_db);
        // TODO: Implement gain normalization
      }
      crate::fft::StitchingRecommendation::ApplySpectralFlattening(_flattening) => {
        info!("Applying spectral flattening to channel {}", channel_idx);
        // TODO: Implement spectral flattening
      }
      crate::fft::StitchingRecommendation::UseAlternativeMethod(method) => {
        info!("Retrying channel {} with alternative method: {:?}", channel_idx, method);
        // Re-validate with alternative method
        let channel = &self.capture_channels[channel_idx];
        let overlap_samples = channel.iq_data.len() / 8; // Default overlap
        
        // For simplicity, retry with the previous channel
        if channel_idx > 0 {
          let alt_validation = self.fft_processor.correlate_signals(
            &self.capture_channels[channel_idx - 1].iq_data,
            &channel.iq_data,
            overlap_samples,
            *method,
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
  pub fn validate_and_correct_all_stitching(&mut self) -> Result<Vec<StitchingValidationResult>> {
    let mut validation_results = Vec::new();
    
    if self.capture_channels.len() < 2 {
      return Ok(validation_results);
    }
    
    info!("Validating stitching for {} channels", self.capture_channels.len());
    
    // Validate each adjacent channel pair
    for i in 0..self.capture_channels.len() - 1 {
      match self.validate_stitching_auto(i, i + 1) {
        Ok(validation) => {
          validation_results.push(validation.clone());
          
          // Apply correction if recommended
          if let Err(e) = self.apply_stitching_correction(i + 1, &validation) {
            warn!("Failed to apply correction to channel {}: {}", i + 1, e);
          }
        }
        Err(e) => {
          warn!("Failed to validate stitching between channels {} and {}: {}", i, i + 1, e);
        }
      }
    }
    
    // Log overall results
    let acceptable_count = validation_results.iter()
      .filter(|v| v.primary_correlation.is_acceptable)
      .count();
    
    info!(
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
    self.iq_accumulator.clear();
    self.iq_offset = 0;
    self.avg_spectrum = None;
    Ok(())
  }

  /// Cleanup resources
  pub fn cleanup(&mut self) -> Result<()> {
    self.device.cleanup()?;
    info!("SDR processor cleanup completed");
    Ok(())
  }

  /// Check capture completion and return multi-channel result
  pub fn check_capture_completion(&mut self) -> Option<CaptureResult> {
    if !self.capture_active {
      return None;
    }

    if let Some(start) = self.capture_start {
      let elapsed = start.elapsed().as_secs_f64();
      if elapsed >= self.capture_duration_s {
        self.capture_active = false;
        let job_id = self
          .capture_job_id
          .take()
          .unwrap_or_else(|| "unknown".to_string());

        // Restore pre-capture center frequency so the live stream
        // resumes at the correct tuning instead of the last hop.
        if let Some(pre_freq) = self.capture_pre_center_freq.take() {
          if let Err(e) = self.set_center_frequency(pre_freq) {
            warn!("Failed to restore pre-capture center frequency: {}", e);
          }
        }

        // Reset stale capture fields to prevent post-capture glitches
        self.capture_last_hop = None;
        self.capture_fragments.clear();
        self.capture_current_fragment = 0;
        self.capture_start = None;

        // Take the raw captured channels
        let mut channels = std::mem::take(&mut self.capture_channels);

        // Diagnostic logging for TDMS debugging
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
          info!("  ch[{}]: center={:.3}MHz, sr={:.3}MHz, spectrum_frames={}, iq_bytes={}", 
                        idx, ch.center_freq_hz / 1e6, ch.sample_rate_hz / 1e6, num_frames, ch.iq_data.len());

          // Per-frame anomaly detection: flag frames with average power drop > 15dB
          if fft_size_dbg > 0 && num_frames > 1 {
            let mut prev_avg: f32 = 0.0;
            for f in 0..num_frames {
              let start = f * fft_size_dbg;
              let end = start + fft_size_dbg;
              let frame_data = &ch.spectrum_data[start..end];
              let avg: f32 =
                frame_data.iter().sum::<f32>() / fft_size_dbg as f32;
              let min_val: f32 =
                frame_data.iter().cloned().fold(f32::INFINITY, f32::min);
              let max_val: f32 =
                frame_data.iter().cloned().fold(f32::NEG_INFINITY, f32::max);

              if f > 0 && (prev_avg - avg).abs() > 15.0 {
                warn!("  [ANOMALY] ch[{}] frame {}/{}: avg={:.1}dB (prev={:.1}dB, delta={:.1}dB) min={:.1} max={:.1}",
                                    idx, f, num_frames, avg, prev_avg, avg - prev_avg, min_val, max_val);
              }
              prev_avg = avg;
            }
        }
    }

    // NOTE: capture spectra are already fftshifted by fft_processor.
    // Re-shifting here would split the spectrum into non-contiguous halves
    // and produce malformed stitched playback artifacts.

    // Trim overlapping spectrum from adjacent channels so each channel
    // contains only its unique non-overlapping portion.
    // We trim both adjacent channels to meet at the MIDPOINT of their overlap,
    // which ensures we use the cleanest (center) portion of both hops.
    if channels.len() > 1 {
      let fft_size = self.fft_processor.config().fft_size;

      for i in 1..channels.len() {
        let prev_max = channels[i - 1].center_freq_hz
          + channels[i - 1].sample_rate_hz / 2.0;
        let curr_min =
          channels[i].center_freq_hz - channels[i].sample_rate_hz / 2.0;
        let overlap_hz = prev_max - curr_min;

        if overlap_hz > 0.0 {
          let midpoint_hz = (prev_max + curr_min) / 2.0;

          // 1. Trim end of previous channel (i-1)
          let prev_overlap_hz = prev_max - midpoint_hz;
          let prev_trim_fraction = prev_overlap_hz / channels[i-1].sample_rate_hz;
          let prev_trim_bins = (fft_size as f64 * prev_trim_fraction).round() as usize;

          if prev_trim_bins > 0 && prev_trim_bins < (channels[i-1].bins_per_frame as usize) {
            if !channels[i-1].spectrum_data.is_empty() {
              let old_bins = channels[i-1].bins_per_frame as usize;
              let new_bins = old_bins - prev_trim_bins;
              let num_frames = channels[i-1].spectrum_data.len() / old_bins;
              let mut new_spectrum = Vec::with_capacity(num_frames * new_bins);

              for f in 0..num_frames {
                let start = f * old_bins;
                let end = start + new_bins;
                new_spectrum.extend_from_slice(&channels[i-1].spectrum_data[start..end]);
              }
              channels[i-1].spectrum_data = new_spectrum;
              channels[i-1].bins_per_frame = new_bins as u32;
            }

            // Update i-1 metadata
            channels[i-1].sample_rate_hz -= prev_overlap_hz;
            channels[i-1].center_freq_hz -= prev_overlap_hz / 2.0;
          }

          // 2. Trim start of current channel (i)
          let curr_overlap_hz = midpoint_hz - curr_min;
          let curr_trim_fraction = curr_overlap_hz / channels[i].sample_rate_hz;
          let curr_trim_bins = (fft_size as f64 * curr_trim_fraction).round() as usize;

          if curr_trim_bins > 0 && curr_trim_bins < fft_size {
            if !channels[i].spectrum_data.is_empty() {
              let num_frames = channels[i].spectrum_data.len() / fft_size;
              let new_bins = fft_size - curr_trim_bins;
              let mut new_spectrum = Vec::with_capacity(num_frames * new_bins);

              for f in 0..num_frames {
                let start = f * fft_size + curr_trim_bins;
                let end = (f + 1) * fft_size;
                new_spectrum.extend_from_slice(&channels[i].spectrum_data[start..end]);
              }
              channels[i].spectrum_data = new_spectrum;
              channels[i].bins_per_frame = new_bins as u32;
            } else {
              // If spectrum is empty (IQ only capture), still set bins_per_frame
              channels[i].bins_per_frame = (fft_size - curr_trim_bins) as u32;
            }
            
            // Update i metadata
            channels[i].sample_rate_hz -= curr_overlap_hz;
            channels[i].center_freq_hz += curr_overlap_hz / 2.0;
          }
            } else {
              // No overlap with previous, but still need to set bins_per_frame if not set
              if channels[i].bins_per_frame == 0 {
                channels[i].bins_per_frame = fft_size as u32;
              }
            }
          }

          // Apply seam blending across channel boundaries to minimize phase discontinuity
          for i in 1..channels.len() {
            let prev_bins = channels[i - 1].bins_per_frame as usize;
            let curr_bins = channels[i].bins_per_frame as usize;

            if prev_bins == 0 || curr_bins == 0 
              || channels[i - 1].spectrum_data.is_empty() 
              || channels[i].spectrum_data.is_empty() {
              continue;
            }

            // Use a wider seam window to smooth phase discontinuities
            // 256 bins ≈ 800kHz at 3.2MHz sample rate
            let seam_window = prev_bins.min(curr_bins).min(256);
            if seam_window == 0 {
              continue;
            }

            let prev_frames = channels[i - 1].spectrum_data.len() / prev_bins;
            let curr_frames = channels[i].spectrum_data.len() / curr_bins;
            let seam_frames = prev_frames.min(curr_frames);

            for f in 0..seam_frames {
              let prev_frame_start = f * prev_bins;
              let curr_frame_start = f * curr_bins;

              for k in 0..seam_window {
                // Use cosine taper for smoother transition
                let t = (1.0 - ((k as f32 / seam_window as f32) * std::f32::consts::PI).cos()) / 2.0;
                let prev_idx = prev_frame_start + (prev_bins - seam_window + k);
                let curr_idx = curr_frame_start + k;
                let prev_val = channels[i - 1].spectrum_data[prev_idx];
                let curr_val = channels[i].spectrum_data[curr_idx];

                // Crossfade between channels
                channels[i - 1].spectrum_data[prev_idx] = prev_val * (1.0 - t) + curr_val * t;
                channels[i].spectrum_data[curr_idx] = prev_val * (1.0 - t) + curr_val * t;
              }
            }
          }
        }

        // Ensure first channel also has bins_per_frame set
        if !channels.is_empty() && channels[0].bins_per_frame == 0 {
          channels[0].bins_per_frame =
            self.fft_processor.config().fft_size as u32;
        }

        return Some(CaptureResult {
          job_id,
          channels,
          file_type: self.capture_file_type.clone(),
          acquisition_mode: self.capture_acquisition_mode.clone(),
          encrypted: self.capture_encrypted,
          fft_size: self.fft_processor.config().fft_size as u32,
          duration_s: self.capture_duration_s,
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
          is_ephemeral: self.capture_is_ephemeral,
        });
      }
    }
    None
  }
}
