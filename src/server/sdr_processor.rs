use anyhow::{anyhow, Result};
use log::{debug, info, warn};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread::JoinHandle;
use std::time::Instant;

use n_apt_backend::rtlsdr::ffi;
use n_apt_backend::fft::{FFTProcessor, FFTResult, RawSamples};
use n_apt_backend::rtlsdr::RtlSdrDevice;
use n_apt_backend::stitching::SignalStitcher;

use super::types::{SdrCommand, MockSignal, SignalType, CaptureArtifact};
use super::utils::{load_mock_settings, load_sdr_settings};

/// Number of async USB transfer buffers (librtlsdr default is 15)
pub const ASYNC_BUF_NUM: u32 = 15;
/// Size of each async USB buffer in bytes. 32KB = ~5ms at 3.2 MSPS.
/// Smaller buffers = lower latency and more frequent callbacks.
pub const ASYNC_BUF_LEN: u32 = 32768;

/// C callback invoked by librtlsdr's async read loop.
/// `ctx` is a raw pointer to a `SyncSender<Vec<u8>>`.
unsafe extern "C" fn rtlsdr_async_callback(buf: *mut u8, len: u32, ctx: *mut std::os::raw::c_void) {
    if ctx.is_null() || buf.is_null() || len == 0 {
        return;
    }
    let tx = &*(ctx as *const SyncSender<Vec<u8>>);
    let slice = std::slice::from_raw_parts(buf, len as usize);
    // Best-effort send — if the channel is full we drop the oldest data
    let _ = tx.try_send(slice.to_vec());
}

/// SDR processor wrapper that handles both real and mock SDR devices.
/// Runs on a dedicated std::thread — all blocking device I/O happens here,
/// never on the tokio async runtime.
#[allow(dead_code)]
pub struct SDRProcessor {
  /// Async reader thread handle (Some when async reading is active)
  pub async_reader_handle: Option<JoinHandle<()>>,
  /// Channel receiver for IQ data from the async reader callback
  pub async_rx: Option<Receiver<Vec<u8>>>,
  /// Keep the sender alive so the callback pointer remains valid
  pub async_tx: Option<Box<SyncSender<Vec<u8>>>>,
  /// FFT processor for signal processing
  pub fft_processor: FFTProcessor,
  /// SDR settings loaded from signals.yaml (sdr section)
  pub sdr_settings: super::types::SdrConfig,
  /// Mock settings loaded from signals.yaml (mock section)
  pub mock_settings: super::types::MockSignalsConfig,
  /// Whether we're using mock data
  pub is_mock: bool,
  /// RTL-SDR device handle (None when in mock mode)
  pub device: Option<RtlSdrDevice>,
  /// Persistent mock signals for structured waterfall patterns
  pub mock_signals: Vec<MockSignal>,
  /// Frame counter for time-based signal evolution
  pub frame_counter: u64,
  /// Number of IQ bytes to read per frame (2 bytes per sample × FFT size)
  pub read_size: usize,
  /// Exponential moving average buffer for frame averaging
  pub avg_spectrum: Option<Vec<f32>>,
  /// EMA smoothing factor (0.0 = no smoothing, 1.0 = no averaging)
  pub avg_alpha: f32,
  /// Current center frequency in Hz (used for mock signal shifting)
  pub center_freq: u32,
  /// Target sample rate in Hz from config
  pub target_sample_rate: u32,
  /// Display min/max dB from config
  pub display_min_db: i32,
  pub display_max_db: i32,
  /// Cached gain in tenths of dB — skip USB transfer if unchanged
  pub cached_gain_tenths: i32,
  /// Cached PPM correction — skip USB transfer if unchanged
  pub cached_ppm: i32,
  /// IQ sample accumulator — fed by async reader callback, drained by FFT processing
  pub iq_accumulator: Vec<u8>,
  /// Current read offset into iq_accumulator (avoids memmove on every frame)
  pub iq_offset: usize,
  /// Reusable IQ frame buffer (avoids per-frame Vec allocation)
  pub iq_frame: Vec<u8>,
  /// Validated frame rate for display (clamped to theoretical maximum)
  pub display_frame_rate: u32,
  /// Whether training capture is active
  pub training_active: bool,
  /// Current training label ("target" or "noise")
  pub training_label: Option<String>,
  /// Current training signal area ("A" or "B")
  pub training_signal_area: Option<String>,
  /// Signal stitcher for accumulating FFT frames during training
  pub training_stitcher: Option<SignalStitcher>,
  /// Accumulated completed training samples (flushed to CoreML service)
  pub training_samples: Vec<n_apt_backend::stitching::TrainingSample>,
  /// Whether capture is active
  pub capture_active: bool,
  /// Current capture job ID
  pub capture_job_id: Option<String>,
  /// Capture start time
  pub capture_start: Option<Instant>,
  /// Capture duration in seconds
  pub capture_duration_s: f64,
  /// Capture file type (".c64" or ".napt")
  pub capture_file_type: String,
  /// Whether capture should be encrypted
  pub capture_encrypted: bool,
  /// Whether to trigger playback after capture completion
  pub capture_playback: bool,
  /// Accumulated IQ samples for capture (u8 interleaved, SDR++ compatible)
  pub capture_buffer: Vec<u8>,
  /// Accumulated spectrum frames for capture (f32 per bin, our app's fast path)
  pub spectrum_buffer: Vec<f32>,
}

#[allow(dead_code)]
impl SDRProcessor {
  /// Create a new SDR processor instance
  pub fn new() -> Self {
    let sdr_settings = load_sdr_settings().clone();
    let mock_settings = load_mock_settings().clone();
    let fft_cfg = sdr_settings.fft.clone();
    let display_cfg = sdr_settings.display.clone();
    let gain_cfg = sdr_settings.gain.clone();

    let fft_size = fft_cfg.default_size;
    let sample_rate = sdr_settings.sample_rate;
    let min_db = display_cfg.min_db;
    let max_db = display_cfg.max_db;
    let default_frame_rate = fft_cfg.default_frame_rate;
    let center_frequency = sdr_settings.center_frequency;
    let tuner_gain_tenths = gain_cfg.tuner_gain as i32;
    let ppm = sdr_settings.ppm as i32;

    let mut fft_processor = FFTProcessor::new_with_defaults(fft_size, sample_rate, min_db, max_db);
    // Align initial zoom width and size to config
    let mut cfg = fft_processor.config().clone();
    cfg.zoom_width = fft_size;
    fft_processor.update_config(cfg);

    let mut processor = Self {
      async_reader_handle: None,
      async_rx: None,
      async_tx: None,
      fft_processor,
      is_mock: true,
      device: None,
      mock_signals: Vec::new(),
      frame_counter: 0,
      read_size: fft_size * 2, // IQ interleaved: 2 bytes per complex sample
      avg_spectrum: None,
      avg_alpha: 0.3,
      center_freq: center_frequency,
      target_sample_rate: sample_rate,
      display_min_db: min_db,
      display_max_db: max_db,
      cached_gain_tenths: tuner_gain_tenths,
      cached_ppm: ppm,
      iq_accumulator: Vec::with_capacity(fft_size * 4),
      iq_offset: 0,
      iq_frame: Vec::with_capacity(fft_size * 2),
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
      capture_encrypted: false,
      capture_playback: false,
      capture_buffer: Vec::new(),
      spectrum_buffer: Vec::new(),
      sdr_settings,
      mock_settings,
    };
    // Initialize FFT processor config with default PPM
    let mut config = processor.fft_processor.config().clone();
    config.ppm = processor.cached_ppm as f32;
    processor.fft_processor.update_config(config);
    processor.initialize_mock_signals();
    info!("Initial FFT configuration: {:?}", processor.fft_processor.config());
    processor
  }

  /// Initialize structured mock signals for consistent waterfall patterns
  pub fn initialize_mock_signals(&mut self) {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    
    self.mock_signals.clear();
    
    // Place signals randomly across the FULL spectrum based on current FFT size
    let spectrum_size = self.fft_processor.config().fft_size;
    let n_signals = self.mock_settings.global_settings.signals_per_area as usize;
    let n_signals = n_signals.max(1);
    for i in 0..n_signals {
      // Random placement across the entire spectrum width
      let center_bin = rng.gen_range(10.0..(spectrum_size as f32 - 10.0));
      
      // Vary signal types for diversity
      let signal_type = match i % 3 {
        0 => SignalType::Narrow,
        1 => SignalType::Medium,
        _ => SignalType::Wide,
      };
      
      let bandwidth = match signal_type {
        SignalType::Narrow => self.mock_settings.bandwidths.narrow as usize,
        SignalType::Medium => self.mock_settings.bandwidths.medium as usize,
        SignalType::Wide => self.mock_settings.bandwidths.wide as usize,
      };

      let base_strength = match signal_type {
        SignalType::Narrow => rng.gen_range(
          self.mock_settings.strength_ranges.weak.min as f32..
          self.mock_settings.strength_ranges.weak.max as f32
        ),
        SignalType::Medium => rng.gen_range(
          self.mock_settings.strength_ranges.medium.min as f32..
          self.mock_settings.strength_ranges.medium.max as f32
        ),
        SignalType::Wide => rng.gen_range(
          self.mock_settings.strength_ranges.strong.min as f32..
          self.mock_settings.strength_ranges.strong.max as f32
        ),
      };
      
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
  pub fn initialize(&mut self) -> Result<()> {
    let device_count = RtlSdrDevice::get_device_count();
    info!("RTL-SDR device count: {}", device_count);

    if device_count > 0 {
      match RtlSdrDevice::open_first() {
        Ok(dev) => {
          // Get device info BEFORE configuring to avoid sample rate interference
          info!("RTL-SDR device detected: {}", dev.get_device_info());
          
          // Configure the device
          if let Err(e) = dev.set_sample_rate(self.target_sample_rate) {
            warn!("Failed to set sample rate: {}. Falling back to mock mode.", e);
            self.is_mock = true;
            return Ok(());
          }
          if let Err(e) = dev.set_center_freq(self.center_freq) {
            warn!("Failed to set center freq: {}. Falling back to mock mode.", e);
            self.is_mock = true;
            return Ok(());
          }
          // Apply YAML-configured gain/AGC/PPM
          if let Err(e) = dev.set_tuner_gain(self.cached_gain_tenths) {
            warn!("Failed to set gain: {}. Continuing with default.", e);
          }
          if let Err(e) = dev.set_freq_correction(self.cached_ppm) {
            warn!("Failed to set PPM correction: {}. Continuing with default.", e);
          } else {
            let actual_ppm = dev.get_freq_correction();
            info!("PPM correction set to {}, device reports: {}", self.cached_ppm, actual_ppm);
          }
          if let Err(e) = dev.set_tuner_gain_mode(!self.sdr_settings.gain.tuner_agc) {
            warn!("Failed to set tuner gain mode: {}", e);
          }
          if let Err(e) = dev.set_agc_mode(self.sdr_settings.gain.rtl_agc) {
            warn!("Failed to set RTL AGC mode: {}", e);
          }
          if let Err(e) = dev.reset_buffer() {
            warn!("Failed to reset buffer: {}. Falling back to mock mode.", e);
            self.is_mock = true;
            return Ok(());
          }

          // Final verification of sample rate after all configuration
          let final_rate = dev.get_sample_rate();
          if final_rate != self.target_sample_rate {
            info!("Sample rate changed during initialization! Expected {} Hz, got {} Hz. Reapplying...", self.target_sample_rate, final_rate);
            if let Err(e) = dev.set_sample_rate(self.target_sample_rate) {
              warn!("Failed to reapply sample rate: {}", e);
            }
          }

          info!("RTL-SDR device configured: {}", dev.get_device_info());
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
  pub fn try_connect_device(&mut self) -> Result<bool> {
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
        if let Err(e) = dev.set_sample_rate(self.target_sample_rate) {
          warn!("Failed to set sample rate: {}. Staying in mock mode.", e);
          return Ok(false);
        }
        if let Err(e) = dev.set_center_freq(self.center_freq) {
          warn!("Failed to set center freq: {}. Staying in mock mode.", e);
          return Ok(false);
        }
        if let Err(e) = dev.set_tuner_gain(self.cached_gain_tenths) {
          warn!("Failed to set gain: {}. Continuing with default.", e);
        }
        if let Err(e) = dev.set_freq_correction(self.cached_ppm) {
          warn!("Failed to set PPM correction: {}. Continuing with default.", e);
        } else {
          let actual_ppm = dev.get_freq_correction();
          info!("PPM correction set to {}, device reports: {}", self.cached_ppm, actual_ppm);
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
        self.reinforce_sample_rate();
        Ok(true)
      }
      Err(e) => {
        debug!("RTL-SDR present but could not open: {}", e);
        Ok(false)
      }
    }
  }

  /// Reapply the fixed sample rate to the RTL-SDR device (no-op in mock mode)
  fn reinforce_sample_rate(&mut self) {
    if let Some(ref dev) = self.device {
      // Check current rate before changing
      let before_rate = dev.get_sample_rate();
      info!("Reinforcing sample rate: before={} Hz, target={} Hz", before_rate, self.target_sample_rate);
      
      if let Err(e) = dev.set_sample_rate(self.target_sample_rate) {
        warn!("Failed to reapply sample rate {} Hz: {}", self.target_sample_rate, e);
      } else {
        // Verify after setting
        let after_rate = dev.get_sample_rate();
        info!("Sample rate after reinforcement: {} Hz", after_rate);
        if after_rate != self.target_sample_rate {
          warn!("Sample rate reinforcement failed! Expected {} Hz, got {} Hz", self.target_sample_rate, after_rate);
        }
      }
    }
  }

  /// Enter mock mode without touching the device handle.
  /// The I/O loop is responsible for cancelling async read + joining the reader
  /// thread + calling release_device() BEFORE the device is dropped.
  pub fn enter_mock_mode(&mut self) {
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
  pub fn release_device(&mut self) {
    self.device = None;
  }

  /// Set the center frequency for the SDR (called on the dedicated I/O thread)
  pub fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
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
      let spectrum_size = self.fft_processor.config().fft_size;
      let freq_delta = freq as f64 - old_freq as f64;
      let bin_shift = (freq_delta / self.sdr_settings.sample_rate as f64) * spectrum_size as f64;
      for signal in &mut self.mock_signals {
        signal.center_bin -= bin_shift as f32;
      }
    }
    Ok(())
  }

  /// Set the gain for the SDR (skips USB transfer if value unchanged)
  pub fn set_gain(&mut self, gain: f64) -> Result<()> {
    let tenths = (gain * 10.0) as i32;
    if tenths == self.cached_gain_tenths {
      return Ok(());
    }
    let mut device_failed = false;
    if let Some(ref dev) = self.device {
      info!("[device] set_tuner_gain({} tenths, {} dB)", tenths, gain);
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
  pub fn set_tuner_agc(&mut self, automatic: bool) -> Result<()> {
    if let Some(ref dev) = self.device {
      info!("[device] set_tuner_gain_mode(auto={})", automatic);
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
  pub fn set_rtl_agc(&mut self, enabled: bool) -> Result<()> {
    if let Some(ref dev) = self.device {
      info!("[device] set_agc_mode(enabled={})", enabled);
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
  pub fn apply_settings(&mut self, fft_size: Option<usize>, fft_window: Option<String>, frame_rate: Option<u32>, gain: Option<f64>, ppm: Option<i32>, tuner_agc: Option<bool>, rtl_agc: Option<bool>) -> Result<()> {
    let mut config = self.fft_processor.config().clone();
    let mut config_changed = false;

    // Always ensure the FFT processor sample rate matches our expected rate
    if config.sample_rate != self.target_sample_rate {
      config.sample_rate = self.target_sample_rate;
      config_changed = true;
      info!("Updated FFT processor sample rate to {} Hz", self.target_sample_rate);
    }

    if let Some(size) = fft_size {
      if size > 0 && (size & (size - 1)) == 0 {
        if config.fft_size != size {
          let prev_size = config.fft_size;
          config.fft_size = size;
          self.read_size = size * 2;
          self.avg_spectrum = None;
          // Keep zoom width aligned with FFT size to avoid stale width in logs
          config.zoom_width = size;
          config_changed = true;
          info!("FFT size changed: {} -> {} (read_size={} bytes, zoom_width={})", prev_size, size, self.read_size, config.zoom_width);
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
      let prev_rate = self.display_frame_rate;
      if clamped_rate != requested_rate {
        warn!("Requested frame rate {} fps exceeds maximum {} fps for FFT size {}, clamping to {}", 
              requested_rate, max_rate, config.fft_size, clamped_rate);
      }
      // Store the validated frame rate for use in the processing loop
      self.display_frame_rate = clamped_rate;
      info!("Frame rate changed: {} -> {} fps (max {} for fft_size {})", prev_rate, clamped_rate, max_rate, config.fft_size);
    }

    if let Some(g_db) = gain {
      let _ = self.set_gain(g_db);

      // The UI "gain" represents tuner gain in dB. Hardware uses that value directly,
      // but the FFT pipeline expects a linear amplitude multiplier. If we feed dB
      // directly as a multiplier, small dB steps cause massive visual jumps.
      //
      // Convert dB -> linear amplitude multiplier relative to the baseline tuner gain
      // from signals.yaml so startup doesn't jump when the first settings packet arrives.
      let baseline_db = self.sdr_settings.gain.tuner_gain as f32;
      let delta_db = (g_db as f32) - baseline_db;
      config.gain = 10f32.powf(delta_db / 20.0);
      config_changed = true;
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
        // Keep hardware locked to the expected sample rate whenever settings change
        self.reinforce_sample_rate();
      }
      self.fft_processor.update_config(config);
    }

    Ok(())
  }

  /// Set the PPM correction for the SDR (skips USB transfer if value unchanged)
  pub fn set_ppm(&mut self, ppm: i32) -> Result<()> {
    if ppm == self.cached_ppm {
      return Ok(());
    }
    if let Some(ref dev) = self.device {
      info!("[device] set_freq_correction({} ppm)", ppm);
      dev.set_freq_correction(ppm)?;
    }
    self.cached_ppm = ppm;
    let mut config = self.fft_processor.config().clone();
    config.ppm = ppm as f32;
    // Ensure sample rate stays correct
    config.sample_rate = self.target_sample_rate;
    self.fft_processor.update_config(config);
    Ok(())
  }

  /// Check if the accumulator has enough IQ data for a complete FFT frame
  pub fn has_complete_frame(&self) -> bool {
    self.iq_accumulator.len().saturating_sub(self.iq_offset) >= self.read_size
  }

  /// Check if capture is complete and save the file; returns (job_id, artifact)
  pub fn check_capture_completion(&mut self) -> Option<(String, CaptureArtifact)> {
    if !self.capture_active {
      return None;
    }

    if let Some(start_time) = self.capture_start {
      let elapsed = start_time.elapsed().as_secs_f64();
      if elapsed >= self.capture_duration_s {
        info!(
          "Capture completed: duration={}s, buffer_size={} bytes",
          elapsed,
          self.capture_buffer.len()
        );

        let job_id = self.capture_job_id.as_ref().unwrap().clone();
        let file_type = self.capture_file_type.as_str();
        let encrypted = self.capture_encrypted;
        let encryption_key = [0u8; 32];

        let spectrum_size = self.fft_processor.config().fft_size;
        match super::utils::save_capture_file(
          &job_id,
          &self.capture_buffer,
          &self.spectrum_buffer,
          file_type,
          encrypted,
          &encryption_key,
          self.center_freq as f64,
          self.target_sample_rate as f64,
          30, // frame_rate: 30fps
          spectrum_size as u32,
          elapsed, // actual capture duration in seconds
        ) {
          Ok(artifact) => {
            // Reset capture state
            self.capture_active = false;
            let job_id_for_return = self.capture_job_id.take().unwrap();
            self.capture_start = None;
            self.capture_buffer.clear();
            self.spectrum_buffer.clear();
            self.capture_playback = false;

            Some((job_id_for_return, artifact))
          }
          Err(e) => {
            warn!("Failed to save capture file: {}", e);
            self.capture_active = false;
            self.capture_job_id = None;
            self.capture_start = None;
            self.capture_buffer.clear();
            None
          }
        }
      } else {
        None
      }
    } else {
      None
    }
  }

  /// Process one FFT frame from the IQ accumulator (no device read — data comes from async callback)
  pub fn process_iq_frame(&mut self) -> Result<Vec<f32>> {
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
      sample_rate: self.target_sample_rate,
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

  /// Start the async reader thread. The thread calls `rtlsdr_read_async`
  /// which blocks and continuously fires the C callback with IQ chunks.
  /// The callback sends data through a bounded channel that the I/O loop drains.
  pub fn start_async_reader(&mut self) -> Result<()> {
    let dev = self.device.as_ref().ok_or_else(|| anyhow!("No device"))?;
    let raw = dev.raw_ptr();
    if raw.is_null() {
      return Err(anyhow!("Device pointer is null"));
    }

    // Bounded channel: ~64 buffers deep (~2MB at 32KB each, ~330ms at 3.2MSPS)
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(64);
    let tx_box = Box::new(tx);
    let tx_ptr = &*tx_box as *const SyncSender<Vec<u8>> as *mut std::os::raw::c_void;

    // Convert raw pointers to usize so they are Send-safe across the thread boundary.
    // SAFETY: raw is valid while device is open.
    // tx_box is kept alive in self.async_tx for the lifetime of the reader.
    let dev_addr = raw as usize;
    let ctx_addr = tx_ptr as usize;

    let handle = std::thread::spawn(move || {
      info!("Async reader thread started");
      let ret = unsafe {
        ffi::rtlsdr_read_async(
          dev_addr as *mut ffi::RtlSdrDev,
          Some(rtlsdr_async_callback),
          ctx_addr as *mut std::os::raw::c_void,
          ASYNC_BUF_NUM,
          ASYNC_BUF_LEN,
        )
      };
      if ret != 0 {
        warn!("rtlsdr_read_async returned error code {}", ret);
      }
      info!("Async reader thread exited");
    });

    self.async_tx = Some(tx_box);
    self.async_rx = Some(rx);
    self.async_reader_handle = Some(handle);
    info!("Async IQ reader started (buf_num={}, buf_len={})", ASYNC_BUF_NUM, ASYNC_BUF_LEN);
    Ok(())
  }

  /// Stop the async reader: cancel the librtlsdr async loop, join the thread.
  pub fn stop_async_reader(&mut self) {
    if let Some(ref dev) = self.device {
      if let Err(e) = dev.cancel_async() {
        warn!("cancel_async failed: {}", e);
      }
    }
    if let Some(handle) = self.async_reader_handle.take() {
      info!("Waiting for async reader thread to exit...");
      let _ = handle.join();
      info!("Async reader thread joined");
    }
    self.async_rx = None;
    self.async_tx = None;
  }

  /// Drain the async channel into the IQ accumulator.
  /// Returns the number of bytes added.
  pub fn drain_async_channel(&mut self) -> usize {
    let mut total = 0usize;
    if let Some(ref rx) = self.async_rx {
      while let Ok(chunk) = rx.try_recv() {
        total += chunk.len();
        self.iq_accumulator.extend_from_slice(&chunk);
      }
    }
    total
  }

  /// Read from the async IQ accumulator and process into a spectrum frame.
  /// Returns Ok(spectrum) if enough data, Err if not enough yet.
  pub fn read_and_process_device(&mut self) -> Result<Vec<f32>> {
    // Drain whatever the async reader has delivered
    self.drain_async_channel();

    // Check if we have enough data
    if !self.has_complete_frame() {
      return Err(anyhow!("Not enough IQ data yet ({} / {} bytes)",
        self.iq_accumulator.len().saturating_sub(self.iq_offset), self.read_size));
    }

    // Process one frame from the accumulator
    self.process_iq_frame()
  }

  /// Generate mock spectrum data with structured signal patterns
  pub fn read_and_process_mock(&mut self) -> Result<Vec<f32>> {
    use rand::Rng;
    let mut rng = rand::thread_rng();

    let fft_size = self.fft_processor.config().fft_size;
    let sample_rate = self.target_sample_rate.max(1) as f32;
    let mut frame = Vec::with_capacity(fft_size * 2);

    self.frame_counter = self.frame_counter.wrapping_add(1);

    // Update mock signal state (appearance, drift, modulation)
    for signal in &mut self.mock_signals {
      if signal.active
        && rng.gen::<f32>() < self.mock_settings.global_settings.signal_appearance_chance as f32
      {
        signal.active = false;
      } else if !signal.active
        && rng.gen::<f32>() < self.mock_settings.global_settings.signal_disappearance_chance as f32
      {
        signal.active = true;
      }

      if signal.active {
        signal.drift_offset += rng.gen_range(
          -(self.mock_settings.global_settings.signal_drift_rate as f32)
            ..(self.mock_settings.global_settings.signal_drift_rate as f32),
        );
        signal.drift_offset = signal.drift_offset.clamp(-5.0, 5.0);

        signal.modulation_phase += self.mock_settings.global_settings.signal_modulation_rate as f32;
        if signal.modulation_phase > 2.0 * std::f32::consts::PI {
          signal.modulation_phase -= 2.0 * std::f32::consts::PI;
        }
      }
    }

    // Convert the current mock signal model into IQ samples so the FFT pipeline
    // (including windowing) affects the final spectrum.
    // Important: our FFT power computation divides by N^2. For white noise, the
    // expected per-bin power after normalization scales ~ 1/N, which would make
    // the visible noise floor shift when changing FFT size. Compensate by scaling
    // the time-domain noise amplitude by sqrt(N/reference_N) so the spectrum
    // noise floor stays roughly stable across FFT sizes.
    const MOCK_NOISE_REF_FFT_SIZE: f32 = 8192.0;
    let noise_level_base = ((self.mock_settings.global_settings.noise_floor_variation as f32) / 200.0)
      .clamp(0.001, 0.5);
    let noise_scale = ((fft_size as f32) / MOCK_NOISE_REF_FFT_SIZE).sqrt().clamp(0.25, 16.0);
    let noise_level = (noise_level_base * noise_scale).clamp(0.001, 0.9);
    let t0 = (self.frame_counter as f32) * (fft_size as f32) / sample_rate;

    for i in 0..fft_size {
      let t = t0 + (i as f32 / sample_rate);

      let mut i_acc = (rng.gen::<f32>() - 0.5) * 2.0 * noise_level;
      let mut q_acc = (rng.gen::<f32>() - 0.5) * 2.0 * noise_level;

      for signal in &self.mock_signals {
        if !signal.active {
          continue;
        }

        // Use a bin-based frequency model so our tone lands consistently in the FFT.
        // Bin -> signed bin (wrap upper half as negative frequencies)
        let current_bin = (signal.center_bin + signal.drift_offset).round() as i32;
        let mut k = current_bin.rem_euclid(fft_size as i32);
        if k > (fft_size as i32 / 2) {
          k -= fft_size as i32;
        }
        let freq_hz = (k as f32) * sample_rate / (fft_size as f32);

        let modulation = signal.modulation_phase.sin() * 0.3 + 0.7;
        let strength_variation = rng.gen_range(
          -(self.mock_settings.global_settings.signal_strength_variation as f32)
            ..(self.mock_settings.global_settings.signal_strength_variation as f32),
        );
        let current_strength_db = signal.base_strength * modulation + strength_variation;
        let amp = (10f32.powf(current_strength_db / 20.0) * 0.05).clamp(0.0, 0.9);

        let phase = 2.0 * std::f32::consts::PI * freq_hz * t;
        i_acc += amp * phase.sin();
        q_acc += amp * phase.cos();

        // Add a couple of side tones to approximate "bandwidth" without heavy cost.
        let side = (signal.bandwidth.max(1) as f32 / 4.0).round() as i32;
        if side > 0 {
          for (mult, w) in [(-side, 0.5f32), (side, 0.5f32)] {
            let k2 = k + mult;
            let freq2 = (k2 as f32) * sample_rate / (fft_size as f32);
            let phase2 = 2.0 * std::f32::consts::PI * freq2 * t;
            i_acc += (amp * w) * phase2.sin();
            q_acc += (amp * w) * phase2.cos();
          }
        }
      }

      // Soft clamp to keep within [-1, 1]
      let i_f = i_acc.tanh();
      let q_f = q_acc.tanh();

      let i_u8 = ((i_f * 127.0) + 128.0).round().clamp(0.0, 255.0) as u8;
      let q_u8 = ((q_f * 127.0) + 128.0).round().clamp(0.0, 255.0) as u8;
      frame.push(i_u8);
      frame.push(q_u8);
    }

    let samples = RawSamples {
      data: frame.clone(),
      sample_rate: self.target_sample_rate,
    };
    let result = self.fft_processor.process_samples(&samples)?;
    let data = result.power_spectrum;

    // Accumulate capture buffers when active
    if self.capture_active {
      const MAX_CAPTURE_BUFFER_SIZE: usize = 100 * 1024 * 1024; // 100MB

      // 1. Store spectrum frame (f32 per bin)
      if self.spectrum_buffer.len() + data.len() <= MAX_CAPTURE_BUFFER_SIZE / 4 {
        self.spectrum_buffer.extend_from_slice(&data);
      }

      // 2. Store IQ bytes directly (windowing is applied at processing time)
      if self.capture_buffer.len() + frame.len() <= MAX_CAPTURE_BUFFER_SIZE {
        self.capture_buffer.extend_from_slice(&frame);
      }
    }

    Ok(data)
  }

  /// Generate a mock signal using the FFT processor
  #[allow(dead_code)]
  pub fn generate_mock_signal(&mut self) -> Result<FFTResult> {
    self.fft_processor.generate_mock_signal(None)
  }

  /// Get device information string
  pub fn get_device_info(&self) -> String {
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
  pub fn get_current_sample_rate(&self) -> u32 {
    if let Some(ref dev) = self.device {
      dev.get_sample_rate()
    } else {
      self.fft_processor.config().sample_rate
    }
  }

  /// Get the maximum supported sample rate from device or config
  pub fn get_max_sample_rate(&self) -> u32 {
    if let Some(ref dev) = self.device {
      dev.get_max_sample_rate()
    } else {
      self.fft_processor.config().sample_rate
    }
  }

  /// Calculate maximum theoretical frame rate based on sample rate and FFT size
  pub fn calculate_max_frame_rate(&self, fft_size: usize) -> u32 {
    let sample_rate = self.get_current_sample_rate();
    let max_theoretical = sample_rate as f32 / fft_size as f32;
    // Cap at screen refresh rate (assume 60Hz as default)
    max_theoretical.min(60.0) as u32
  }

  /// Process a command from the async runtime (called on the dedicated I/O thread)
  pub fn handle_command(&mut self, cmd: SdrCommand) {
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
              sample_rate: self.target_sample_rate,
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
      SdrCommand::StartCapture { job_id, min_freq, max_freq, duration_s, file_type, encrypted, fft_size: _, fft_window: _ } => {
        info!("Capture started: job_id={}, range={}-{} MHz, duration={}s, type={}, encrypted={}",
          job_id, min_freq, max_freq, duration_s, file_type, encrypted);
        self.capture_active = true;
        self.capture_job_id = Some(job_id.clone());
        self.capture_start = Some(Instant::now());
        self.capture_duration_s = duration_s;
        self.capture_file_type = file_type;
        self.capture_encrypted = encrypted;
        self.capture_buffer.clear();
        self.spectrum_buffer.clear();
        // Note: fft_size and fft_window are for future use if we want to change settings during capture
      }
      SdrCommand::ApplySettings { fft_size, fft_window, frame_rate, gain, ppm, tuner_agc: _, rtl_agc: _ } => {
        if let Err(e) = self.apply_settings(fft_size, fft_window, frame_rate, gain, ppm, None, None) {
          warn!("Failed to apply settings: {}", e);
        }
      }
    }
  }
}
