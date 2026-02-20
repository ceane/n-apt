use anyhow::{anyhow, Result};
use log::{debug, info, warn};
use std::time::Instant;

use n_apt_backend::consts::rs::fft::{FFT_MAX_DB, FFT_MIN_DB, NUM_SAMPLES, SAMPLE_RATE};
use n_apt_backend::consts::rs::mock::{
  MOCK_NOISE_FLOOR_BASE, MOCK_NOISE_FLOOR_VARIATION, MOCK_SPECTRUM_SIZE, MOCK_PERSISTENT_SIGNALS,
  MOCK_SIGNAL_DRIFT_RATE, MOCK_SIGNAL_MODULATION_RATE, MOCK_SIGNAL_APPEARANCE_CHANCE,
  MOCK_SIGNAL_DISAPPEARANCE_CHANCE, MOCK_SIGNAL_STRENGTH_VARIATION,
};
use n_apt_backend::fft::{FFTProcessor, FFTResult, RawSamples};
use n_apt_backend::rtlsdr::RtlSdrDevice;
use n_apt_backend::stitching::SignalStitcher;

use super::types::{SdrCommand, MockSignal, SignalType, CaptureArtifact};

/// Number of async USB transfer buffers (librtlsdr default is 15)
#[allow(dead_code)]
pub const ASYNC_BUF_NUM: u32 = 15;
/// Size of each async USB buffer in bytes. 32KB = ~5ms at 3.2 MSPS.
/// Smaller buffers = lower latency and more frequent callbacks.
#[allow(dead_code)]
pub const ASYNC_BUF_LEN: u32 = 32768;

/// SDR processor wrapper that handles both real and mock SDR devices.
/// Runs on a dedicated std::thread — all blocking device I/O happens here,
/// never on the tokio async runtime.
#[allow(dead_code)]
pub struct SDRProcessor {
  /// FFT processor for signal processing
  pub fft_processor: FFTProcessor,
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
      capture_active: false,
      capture_job_id: None,
      capture_start: None,
      capture_duration_s: 0.0,
      capture_file_type: String::new(),
      capture_encrypted: false,
      capture_playback: false,
      capture_buffer: Vec::new(),
      spectrum_buffer: Vec::new(),
    };
    // Initialize FFT processor config with default PPM
    let mut config = processor.fft_processor.config().clone();
    config.ppm = 1.0;
    processor.fft_processor.update_config(config);
    processor.initialize_mock_signals();
    processor
  }

  /// Initialize structured mock signals for consistent waterfall patterns
  pub fn initialize_mock_signals(&mut self) {
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
  pub fn initialize(&mut self) -> Result<()> {
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
          // Default PPM correction: 1
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
      let freq_delta = freq as f64 - old_freq as f64;
      let bin_shift = (freq_delta / SAMPLE_RATE as f64) * MOCK_SPECTRUM_SIZE as f64;
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
  pub fn set_ppm(&mut self, ppm: i32) -> Result<()> {
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

        match super::utils::save_capture_file(
          &job_id,
          &self.capture_buffer,
          &self.spectrum_buffer,
          file_type,
          encrypted,
          &encryption_key,
          self.center_freq as f64,
          SAMPLE_RATE as f64,
          30, // frame_rate: 30fps
          MOCK_SPECTRUM_SIZE as u32,
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

  /// Read IQ samples from the real device (sync) and process into a spectrum frame.
  pub fn read_and_process_device(&mut self) -> Result<Vec<f32>> {
    let dev = self
      .device
      .as_ref()
      .ok_or_else(|| anyhow!("RTL-SDR device not initialized"))?;

    let mut frame = std::mem::take(&mut self.iq_frame);
    if frame.len() != self.read_size {
      frame.resize(self.read_size, 0);
    }

    let n_read = dev.read_sync_into(&mut frame)?;
    if n_read == 0 {
      self.iq_frame = frame;
      return Err(anyhow!("No IQ data read from device"));
    }
    frame.truncate(n_read);

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
  pub fn read_and_process_mock(&mut self) -> Result<Vec<f32>> {
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
        if signal.active && rng.gen::<f32>() < MOCK_SIGNAL_APPEARANCE_CHANCE {
            signal.active = false;
        } else if !signal.active && rng.gen::<f32>() < MOCK_SIGNAL_DISAPPEARANCE_CHANCE {
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

    // Accumulate capture buffers when active
    if self.capture_active {
      const MAX_CAPTURE_BUFFER_SIZE: usize = 100 * 1024 * 1024; // 100MB

      // 1. Store spectrum frame (f32 per bin)
      if self.spectrum_buffer.len() + data.len() <= MAX_CAPTURE_BUFFER_SIZE / 4 {
        self.spectrum_buffer.extend_from_slice(&data);
      }

      // 2. Generate simple IQ from spectrum bins (u8 interleaved)
      let n = data.len().max(1);
      let samples_per_bin = (SAMPLE_RATE as usize / n).max(1);
      let iq_bytes_len = n * samples_per_bin * 2;
      if self.capture_buffer.len() + iq_bytes_len <= MAX_CAPTURE_BUFFER_SIZE {
        for &db in &data {
          let linear = 10f32.powf(db / 20.0).clamp(0.0, 1.0);
          let amp = (linear * 127.0) as u8;
          for _ in 0..samples_per_bin {
            let i_val = (128u16 + amp as u16).clamp(0, 255) as u8;
            let q_val = 128u8; // minimal Q
            self.capture_buffer.push(i_val);
            self.capture_buffer.push(q_val);
          }
        }
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
