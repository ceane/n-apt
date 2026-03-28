use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::{accept_async, tungstenite::Message};

// Import FFT module
use n_apt_backend::consts::rs::fft::{
  FFT_FRAME_RATE, FFT_MAX_DB, FFT_MIN_DB, NUM_SAMPLES, SAMPLE_RATE,
};
use n_apt_backend::consts::rs::mock::{
  MOCK_MEDIUM_SIGNAL_MAX, MOCK_MEDIUM_SIGNAL_MIN, MOCK_NARROW_BAND_WIDTH,
  MOCK_NOISE_FLOOR_BASE, MOCK_NOISE_FLOOR_VARIATION, MOCK_PERSISTENT_SIGNALS,
  MOCK_SIGNAL_APPEARANCE_CHANCE, MOCK_SIGNAL_DISAPPEARANCE_CHANCE,
  MOCK_SIGNAL_DRIFT_RATE, MOCK_SIGNAL_MODULATION_RATE,
  MOCK_SIGNAL_STRENGTH_VARIATION, MOCK_SPECTRUM_SIZE, MOCK_STRONG_SIGNAL_MAX,
  MOCK_STRONG_SIGNAL_MIN, MOCK_WEAK_SIGNAL_MAX, MOCK_WEAK_SIGNAL_MIN,
  MOCK_WIDE_BAND_WIDTH,
};
use n_apt_backend::fft::{FFTProcessor, FFTResult, RawSamples};
use n_apt_backend::rtlsdr::RtlSdrDevice;

// Server configuration from Cargo.toml metadata
use n_apt_backend::consts::rs::env::{WS_HOST, WS_PORT};

/// WebSocket message structure for client-server communication
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WebSocketMessage {
  /// Message type (e.g., "frequency_range", "pause", "gain", "ppm", "settings")
  #[serde(rename = "type")]
  message_type: String,
  /// Minimum frequency in MHz (for frequency range messages)
  #[serde(skip_serializing_if = "Option::is_none", alias = "minFreq")]
  min_freq: Option<f64>,
  /// Maximum frequency in MHz (for frequency range messages)
  #[serde(skip_serializing_if = "Option::is_none", alias = "maxFreq")]
  max_freq: Option<f64>,
  /// Pause state (for pause/resume messages)
  #[serde(skip_serializing_if = "Option::is_none")]
  paused: Option<bool>,
  /// Gain in dB (for gain control messages)
  #[serde(skip_serializing_if = "Option::is_none")]
  gain: Option<f64>,
  /// PPM correction (for PPM adjustment messages)
  #[serde(skip_serializing_if = "Option::is_none")]
  ppm: Option<i32>,
  /// FFT size (must be power of 2)
  #[serde(skip_serializing_if = "Option::is_none", alias = "fftSize")]
  fft_size: Option<usize>,
  /// FFT window function name
  #[serde(skip_serializing_if = "Option::is_none", alias = "fftWindow")]
  fft_window: Option<String>,
  /// FFT frame rate in fps
  #[serde(skip_serializing_if = "Option::is_none", alias = "frameRate")]
  frame_rate: Option<u32>,
}

/// Spectrum data message sent to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SpectrumData {
  /// Message type (always "spectrum")
  #[serde(rename = "type")]
  message_type: String,
  /// FFT waveform data in dB
  waveform: Vec<f32>,
  /// Waterfall data (same as waveform for now)
  waterfall: Vec<f32>,
  /// Whether this data is from a mock source
  is_mock: bool,
  /// Unix timestamp
  timestamp: i64,
}

/// Status message sent to new clients on connection
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StatusMessage {
  /// Message type (always "status")
  #[serde(rename = "type")]
  message_type: String,
  /// Whether a physical SDR device is connected
  device_connected: bool,
  /// Whether streaming is currently paused
  paused: bool,
  /// Backend type ("mock" or "rtl-sdr")
  backend: String,
  /// Device information string
  device_info: String,
}

/// Structured signal pattern for consistent waterfall visualization
#[derive(Debug, Clone)]
struct MockSignal {
  /// Center frequency bin (0 to MOCK_SPECTRUM_SIZE)
  center_bin: f32,
  /// Current drift offset from center
  drift_offset: f32,
  /// Signal bandwidth in frequency bins
  bandwidth: usize,
  /// Base signal strength in dB above noise floor
  base_strength: f32,
  /// Current modulation phase
  modulation_phase: f32,
  /// Whether this signal is currently active
  active: bool,
  /// Signal type: narrow, medium, or wide
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
      SignalType::Narrow => {
        rng.gen_range(MOCK_WEAK_SIGNAL_MIN..MOCK_WEAK_SIGNAL_MAX)
      }
      SignalType::Medium => {
        rng.gen_range(MOCK_MEDIUM_SIGNAL_MIN..MOCK_MEDIUM_SIGNAL_MAX)
      }
      SignalType::Wide => {
        rng.gen_range(MOCK_STRONG_SIGNAL_MIN..MOCK_STRONG_SIGNAL_MAX)
      }
    }
  }
}

/// SDR processor wrapper that handles both real and mock SDR devices
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
  /// Pending frequency change (applied at start of next read cycle to debounce rapid slider drags)
  pending_freq: Option<u32>,
  /// Last time we applied a frequency change (to throttle rapid retunes)
  last_retune_at: Option<Instant>,
  /// Short cooldown window after a retune to let the device settle
  retune_cooldown_until: Option<Instant>,
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
      pending_freq: None,
      last_retune_at: None,
      retune_cooldown_until: None,
    };
    processor.initialize_mock_signals();
    processor
  }

  /// Initialize structured mock signals for consistent waterfall patterns
  fn initialize_mock_signals(&mut self) {
    use rand::Rng;
    let mut rng = rand::thread_rng();

    self.mock_signals.clear();

    for i in 0..MOCK_PERSISTENT_SIGNALS {
      // Distribute signals across the spectrum
      let center_bin =
        (i as f32 / MOCK_PERSISTENT_SIGNALS as f32) * MOCK_SPECTRUM_SIZE as f32;

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
            warn!(
              "Failed to set sample rate: {}. Falling back to mock mode.",
              e
            );
            self.is_mock = true;
            return Ok(());
          }
          if let Err(e) =
            dev.set_center_freq(n_apt_backend::consts::rs::fft::CENTER_FREQ)
          {
            warn!(
              "Failed to set center freq: {}. Falling back to mock mode.",
              e
            );
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

  /// Fall back to mock mode when the real device becomes unresponsive
  fn fallback_to_mock(&mut self) {
    if !self.is_mock {
      warn!("RTL-SDR device unresponsive. Switching to mock mode.");
      self.device = None;
      self.is_mock = true;
      // Re-initialize mock signals so there's something to display
      if self.mock_signals.is_empty() {
        self.initialize_mock_signals();
      }
    }
  }

  /// Set the center frequency for the SDR
  ///
  /// # Arguments
  /// * `freq` - Center frequency in Hz
  ///
  /// # Returns
  /// Result indicating success or failure
  fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
    info!("Setting center frequency to {} Hz", freq);
    let mut device_failed = false;
    if let Some(ref dev) = self.device {
      if let Err(e) = dev.set_center_freq(freq) {
        warn!(
          "Device error setting frequency: {}. Falling back to mock.",
          e
        );
        device_failed = true;
      } else {
        // Reset buffer after frequency change to flush stale samples
        // (SDR++ does this — prevents corrupted data after retune)
        if let Err(e) = dev.reset_buffer() {
          warn!("Failed to reset buffer after freq change: {}. Falling back to mock.", e);
          device_failed = true;
        }
        // Clear averaging buffer so old spectrum doesn't bleed into new frequency
        self.avg_spectrum = None;
        // Allow the device to settle after a retune
        self.retune_cooldown_until =
          Some(Instant::now() + Duration::from_millis(150));
      }
    }
    if device_failed {
      self.fallback_to_mock();
    }
    // Track center freq for mock signal shifting
    let old_freq = self.center_freq;
    self.center_freq = freq;
    // Shift mock signal positions proportionally to the frequency change
    if self.is_mock && old_freq != freq {
      let freq_delta = freq as f64 - old_freq as f64;
      let bin_shift =
        (freq_delta / SAMPLE_RATE as f64) * MOCK_SPECTRUM_SIZE as f64;
      for signal in &mut self.mock_signals {
        signal.center_bin -= bin_shift as f32;
      }
    }
    Ok(())
  }

  /// Set the gain for the SDR
  ///
  /// # Arguments
  /// * `gain` - Gain value in dB (e.g. 49.6)
  ///
  /// # Returns
  /// Result indicating success or failure
  fn set_gain(&mut self, gain: f64) -> Result<()> {
    let mut device_failed = false;
    if let Some(ref dev) = self.device {
      // Convert dB to tenths of dB for librtlsdr
      let tenths = (gain * 10.0) as i32;
      match dev.set_tuner_gain(tenths) {
        Ok(()) => {
          info!("Hardware gain set to {} dB (tenths: {})", gain, tenths)
        }
        Err(e) => {
          warn!("Device error setting gain: {}. Falling back to mock.", e);
          device_failed = true;
        }
      }
    }
    if device_failed {
      self.fallback_to_mock();
    }
    Ok(())
  }

  /// Apply settings from a WebSocket settings message
  fn apply_settings(
    &mut self,
    fft_size: Option<usize>,
    fft_window: Option<String>,
    _frame_rate: Option<u32>,
    gain: Option<f64>,
    ppm: Option<i32>,
  ) -> Result<()> {
    let mut config = self.fft_processor.config().clone();
    let mut config_changed = false;

    if let Some(size) = fft_size {
      // Validate power of 2
      if size > 0 && (size & (size - 1)) == 0 {
        if config.fft_size != size {
          config.fft_size = size;
          self.read_size = size * 2;
          // Reset averaging buffer when FFT size changes
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

    if let Some(g) = gain {
      let _ = self.set_gain(g);
    }

    if let Some(p) = ppm {
      let _ = self.set_ppm(p);
    }

    if config_changed {
      // Keep software gain at 1.0 for real device
      if !self.is_mock {
        config.gain = 1.0;
      }
      self.fft_processor.update_config(config);
    }

    Ok(())
  }

  /// Set the PPM correction for the SDR
  ///
  /// # Arguments
  /// * `ppm` - PPM correction value
  ///
  /// # Returns
  /// Result indicating success or failure
  fn set_ppm(&mut self, ppm: i32) -> Result<()> {
    if let Some(ref dev) = self.device {
      dev.set_freq_correction(ppm)?;
    }
    // Update FFT processor config
    let mut config = self.fft_processor.config().clone();
    config.ppm = ppm as f32;
    self.fft_processor.update_config(config);
    Ok(())
  }

  /// Read and process SDR data
  ///
  /// When a real device is connected, reads IQ samples and runs them through
  /// the FFT processor. In mock mode, generates structured spectrum data with
  /// consistent signal patterns for waterfall visualization.
  ///
  /// # Returns
  /// Vector of f32 values representing the spectrum in dB
  fn read_and_process(&mut self) -> Result<Vec<f32>> {
    // If we're in a retune cooldown window, avoid touching the device
    if let Some(until) = self.retune_cooldown_until {
      if Instant::now() < until {
        if let Some(ref avg) = self.avg_spectrum {
          return Ok(avg.clone());
        }
        return self.read_and_process_mock();
      }
      self.retune_cooldown_until = None;
    }

    // Apply any pending frequency change (debounced from rapid slider drags)
    if let Some(freq) = self.pending_freq.take() {
      if freq == self.center_freq {
        // No change needed
      } else {
        let can_retune = if self.is_mock || self.device.is_none() {
          true
        } else {
          self
            .last_retune_at
            .map(|last| last.elapsed() >= Duration::from_millis(600))
            .unwrap_or(true)
        };

        if can_retune {
          if let Err(e) = self.set_center_frequency(freq) {
            warn!("Failed to apply pending frequency: {}", e);
          }
          self.last_retune_at = Some(Instant::now());
        } else {
          // Keep latest request queued until the debounce interval passes
          self.pending_freq = Some(freq);
        }
      }
    }

    // Real device path: read IQ samples and process through FFT
    if self.device.is_some() {
      // Try to read from device; fall back to mock on error
      let iq_result = self.device.as_ref().unwrap().read_sync(self.read_size);
      match iq_result {
        Ok(iq_data) => {
          let samples = RawSamples {
            data: iq_data,
            sample_rate: SAMPLE_RATE,
          };
          let result = self.fft_processor.process_samples(&samples)?;
          let mut spectrum = result.power_spectrum;

          // DC spike suppression: interpolate center bins after fftshift
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
              return Ok(avg.clone());
            } else {
              // Size changed, reset
              self.avg_spectrum = Some(spectrum.clone());
              return Ok(spectrum);
            }
          } else {
            self.avg_spectrum = Some(spectrum.clone());
            return Ok(spectrum);
          }
        }
        Err(e) => {
          warn!("Device read failed: {}. Falling back to mock.", e);
          self.fallback_to_mock();
          // Fall through to mock path below
        }
      }
    }

    // Mock mode: generate structured spectrum data
    self.read_and_process_mock()
  }

  /// Generate mock spectrum data with structured signal patterns
  fn read_and_process_mock(&mut self) -> Result<Vec<f32>> {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let mut data = Vec::with_capacity(MOCK_SPECTRUM_SIZE);

    // Increment frame counter for time-based evolution
    self.frame_counter = self.frame_counter.wrapping_add(1);

    // Start with base noise floor
    for _i in 0..MOCK_SPECTRUM_SIZE {
      let noise_floor = MOCK_NOISE_FLOOR_BASE
        + rng
          .gen_range(-MOCK_NOISE_FLOOR_VARIATION..MOCK_NOISE_FLOOR_VARIATION);
      data.push(noise_floor.clamp(FFT_MIN_DB as f32, FFT_MAX_DB as f32));
    }

    // Update and apply structured signals
    for signal in &mut self.mock_signals {
      // Randomly activate/deactivate signals for dynamic behavior
      if signal.active && rng.gen::<f32>() < MOCK_SIGNAL_DISAPPEARANCE_CHANCE {
        signal.active = false;
      } else if !signal.active
        && rng.gen::<f32>() < MOCK_SIGNAL_APPEARANCE_CHANCE
      {
        signal.active = true;
      }

      if signal.active {
        // Update signal drift (slow frequency drift)
        signal.drift_offset +=
          rng.gen_range(-MOCK_SIGNAL_DRIFT_RATE..MOCK_SIGNAL_DRIFT_RATE);
        signal.drift_offset = signal.drift_offset.clamp(-5.0, 5.0); // Limit drift range

        // Update modulation phase
        signal.modulation_phase += MOCK_SIGNAL_MODULATION_RATE;
        if signal.modulation_phase > 2.0 * std::f32::consts::PI {
          signal.modulation_phase -= 2.0 * std::f32::consts::PI;
        }

        // Calculate current signal strength with modulation
        let modulation = signal.modulation_phase.sin() * 0.3 + 0.7; // 0.4 to 1.0
        let strength_variation = rng.gen_range(
          -MOCK_SIGNAL_STRENGTH_VARIATION..MOCK_SIGNAL_STRENGTH_VARIATION,
        );
        let current_strength =
          signal.base_strength * modulation + strength_variation;

        // Apply signal to spectrum data
        let current_bin = signal.center_bin + signal.drift_offset;
        let half_bandwidth = signal.bandwidth as f32 / 2.0;

        for bin_offset in 0..signal.bandwidth as i32 {
          let bin_index =
            (current_bin + bin_offset as f32 - half_bandwidth) as i32;

          if bin_index >= 0 && bin_index < MOCK_SPECTRUM_SIZE as i32 {
            let bin_idx = bin_index as usize;

            // Create signal shape (Gaussian-like profile)
            let distance_from_center =
              (bin_offset as f32 - half_bandwidth).abs();
            let signal_profile = (-distance_from_center.powi(2)
              / (2.0 * (signal.bandwidth as f32 / 4.0).powi(2)))
            .exp();

            let signal_contribution = current_strength * signal_profile;
            data[bin_idx] = data[bin_idx].max(signal_contribution);
          }
        }
      }
    }

    Ok(data)
  }

  /// Generate a mock signal using the FFT processor
  ///
  /// # Returns
  /// FFTResult containing the generated mock signal
  #[allow(dead_code)]
  fn generate_mock_signal(&mut self) -> Result<FFTResult> {
    self.fft_processor.generate_mock_signal(None)
  }

  /// Get device information string
  ///
  /// # Returns
  /// Formatted string with device configuration
  fn get_device_info(&self) -> String {
    if let Some(ref dev) = self.device {
      dev.get_device_info()
    } else {
      let config = self.fft_processor.config();
      format!(
        "Mock RTL-SDR Device - Sample Rate: {} Hz, Gain: {} dB, PPM: {}",
        config.sample_rate, config.gain as i32, config.ppm as i32
      )
    }
  }
}

/// WebSocket server that handles client connections and broadcasts spectrum data
struct WebSocketServer {
  /// Shared SDR processor instance
  processor: Arc<Mutex<SDRProcessor>>,
  /// Broadcast channel for sending data to all clients
  broadcast_tx: broadcast::Sender<String>,
  /// Counter for connected clients
  client_count: Arc<Mutex<usize>>,
  /// Shared pause state for streaming
  is_paused: Arc<Mutex<bool>>,
}

impl WebSocketServer {
  /// Create a new WebSocket server instance
  fn new() -> Self {
    let processor = Arc::new(Mutex::new(SDRProcessor::new()));
    let (broadcast_tx, _) = broadcast::channel(100);
    Self {
      processor,
      broadcast_tx,
      client_count: Arc::new(Mutex::new(0)),
      is_paused: Arc::new(Mutex::new(false)),
    }
  }

  /// Start the WebSocket server and begin accepting connections
  ///
  /// This method initializes the SDR processor, starts the WebSocket listener,
  /// and spawns a streaming task that continuously generates spectrum data.
  ///
  /// # Returns
  /// Result indicating success or failure
  async fn start(&mut self) -> Result<()> {
    // Initialize SDR processor
    {
      let mut processor = self.processor.lock().await;
      processor.initialize()?;
      info!("SDR processor initialized: {}", processor.get_device_info());
    }

    // Start WebSocket server
    let server_addr = format!("{}:{}", WS_HOST, WS_PORT);
    let listener = TcpListener::bind(&server_addr).await?;
    info!("WebSocket server listening on ws://{}", server_addr);

    // Start streaming task — reuse the already-initialized processor
    // so the RTL-SDR device handle isn't opened twice
    let broadcast_tx = self.broadcast_tx.clone();
    let client_count_clone = self.client_count.clone();
    let streaming_processor = self.processor.clone();

    info!("Starting streaming task...");

    tokio::spawn(async move {
      info!("Streaming task started!");
      let frame_interval = 1000 / FFT_FRAME_RATE as u64;

      loop {
        tokio::time::sleep(Duration::from_millis(frame_interval)).await;

        let client_count = *client_count_clone.lock().await;

        // Generate data when clients are connected
        if client_count > 0 {
          let (spectrum_data, is_mock) = {
            let mut processor = streaming_processor.lock().await;
            let spectrum = processor.read_and_process();
            match spectrum {
              Ok(data) => (data, processor.is_mock),
              Err(e) => {
                error!("Failed to read SDR data: {}. Falling back to mock.", e);
                processor.fallback_to_mock();
                continue;
              }
            }
          };

          let data = SpectrumData {
            message_type: "spectrum".to_string(),
            waveform: spectrum_data.clone(),
            waterfall: spectrum_data,
            is_mock,
            timestamp: chrono::Utc::now().timestamp_millis(),
          };

          let message = serde_json::to_string(&data).unwrap();

          // Broadcast to all clients
          if let Err(e) = broadcast_tx.send(message) {
            warn!("Failed to broadcast: {}", e);
          }
        }
      }
    });

    // Handle connections
    while let Ok((stream, addr)) = listener.accept().await {
      let processor = self.processor.clone();
      let mut broadcast_rx = self.broadcast_tx.subscribe();
      let client_count = self.client_count.clone();
      let is_paused = self.is_paused.clone();

      tokio::spawn(async move {
        let ws_stream = match accept_async(stream).await {
          Ok(stream) => stream,
          Err(e) => {
            error!("WebSocket handshake failed: {}", e);
            return;
          }
        };
        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        // Send initial status BEFORE incrementing client count
        // Lock processor once to avoid multiple lock acquisitions
        let (is_mock, device_info) = {
          let proc = processor.lock().await;
          (proc.is_mock, proc.get_device_info())
        };
        let paused = *is_paused.lock().await;

        let status = StatusMessage {
          message_type: "status".to_string(),
          device_connected: !is_mock,
          paused,
          backend: if is_mock {
            "mock".to_string()
          } else {
            "rtl-sdr".to_string()
          },
          device_info,
        };

        match serde_json::to_string(&status) {
          Ok(status_json) => {
            if let Err(e) = ws_sender.send(Message::Text(status_json)).await {
              error!("Failed to send initial status: {}", e);
              return;
            }
          }
          Err(e) => {
            error!("Failed to serialize status: {}", e);
            return;
          }
        }

        // Increment client count after successful handshake and status send
        {
          let mut count = client_count.lock().await;
          *count += 1;
        }

        // Use tokio::select! to handle both broadcast messages and client messages concurrently
        loop {
          tokio::select! {
            // Handle broadcast messages from the streaming task
            broadcast_result = broadcast_rx.recv() => {
              match broadcast_result {
                Ok(message) => {
                  if let Err(e) = ws_sender.send(Message::Text(message)).await {
                    debug!("Client {} disconnected during broadcast: {}", addr, e);
                    break;
                  }
                }
                Err(e) => {
                  warn!("Broadcast channel error for {}: {}", addr, e);
                  break;
                }
              }
            }
            // Handle incoming messages from the client
            client_msg = ws_receiver.next() => {
              match client_msg {
                Some(Ok(Message::Text(text))) => {
                  if let Ok(message) = serde_json::from_str::<WebSocketMessage>(&text) {
                    handle_message(&processor, &is_paused, message).await;
                  }
                }
                Some(Ok(Message::Close(_))) => {
                  break;
                }
                Some(Ok(Message::Ping(data))) => {
                  if let Err(e) = ws_sender.send(Message::Pong(data)).await {
                    warn!("Failed to send pong to {}: {}", addr, e);
                    break;
                  }
                }
                Some(Err(_)) => {
                  break;
                }
                None => {
                  break;
                }
                _ => {}
              }
            }
          }
        }

        // Decrement client count on disconnect
        {
          let mut count = client_count.lock().await;
          *count = count.saturating_sub(1);
        }
      });
    }

    Ok(())
  }
}

/// Handle incoming WebSocket messages from clients
///
/// This function processes different message types and updates the SDR processor
/// accordingly.
///
/// # Arguments
/// * `processor` - Shared SDR processor instance
/// * `is_paused` - Shared pause state
/// * `message` - The WebSocket message to handle
async fn handle_message(
  processor: &Arc<Mutex<SDRProcessor>>,
  is_paused: &Arc<Mutex<bool>>,
  message: WebSocketMessage,
) {
  match message.message_type.as_str() {
    "frequency_range" => {
      // Handle frequency range updates
      if let (Some(min_freq), Some(max_freq)) =
        (message.min_freq, message.max_freq)
      {
        let center_freq = ((min_freq + max_freq) * 500000.0) as u32; // Convert MHz to Hz
        debug!(
          "Frequency range received: {:.2}-{:.2} MHz → center {} Hz (queued)",
          min_freq, max_freq, center_freq
        );
        // Queue the frequency change — it will be applied at the start of the next read cycle
        // This debounces rapid slider drags that would otherwise flood the USB device
        processor.lock().await.pending_freq = Some(center_freq);
      } else {
        warn!(
          "frequency_range message missing min_freq/max_freq: {:?}",
          message
        );
      }
    }
    "pause" => {
      // Handle pause/resume requests
      if let Some(paused) = message.paused {
        *is_paused.lock().await = paused;
      }
    }
    "gain" => {
      // Handle gain adjustments
      if let Some(gain) = message.gain {
        if let Err(e) = processor.lock().await.set_gain(gain) {
          error!("Failed to set gain: {}", e);
        }
      }
    }
    "ppm" => {
      // Handle PPM correction adjustments
      if let Some(ppm) = message.ppm {
        if let Err(e) = processor.lock().await.set_ppm(ppm) {
          error!("Failed to set PPM: {}", e);
        }
      }
    }
    "settings" => {
      // Handle combined settings update
      info!("Settings message received: fft_size={:?}, fft_window={:?}, frame_rate={:?}, gain={:?}, ppm={:?}",
        message.fft_size, message.fft_window, message.frame_rate, message.gain, message.ppm);
      if let Err(e) = processor.lock().await.apply_settings(
        message.fft_size,
        message.fft_window,
        message.frame_rate,
        message.gain,
        message.ppm,
      ) {
        error!("Failed to apply settings: {}", e);
      }
    }
    _ => {
      // Handle unknown message types
      warn!("Unknown message type: {}", message.message_type);
    }
  }
}

/// Main entry point for the N-APT Rust backend server
///
/// This function initializes logging and starts the WebSocket server.
///
/// # Returns
/// Result indicating success or failure
#[tokio::main]
async fn main() -> Result<()> {
  // Initialize logging with info level by default
  env_logger::Builder::from_env(
    env_logger::Env::default().default_filter_or("info"),
  )
  .init();

  info!("Starting N-APT Rust Backend Server");

  // Create and start the WebSocket server
  let mut server = WebSocketServer::new();
  server.start().await?;

  Ok(())
}
