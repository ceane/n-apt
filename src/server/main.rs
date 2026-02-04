use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
// use rtlsdr::{RTLSDRDevice, RTLSDRError};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::{accept_async, tungstenite::Message};

// Import FFT module
use n_apt_backend::consts::rs::fft::{FFT_FRAME_RATE, FFT_MAX_DB, FFT_MIN_DB};
use n_apt_backend::consts::rs::mock::{
  MOCK_NOISE_FLOOR_BASE, MOCK_NOISE_FLOOR_VARIATION, MOCK_SPECTRUM_SIZE, MOCK_STRONG_SIGNAL_CHANCE,
  MOCK_STRONG_SIGNAL_MAX, MOCK_STRONG_SIGNAL_MIN, MOCK_WEAK_SIGNAL_CHANCE, MOCK_WEAK_SIGNAL_MAX,
  MOCK_WEAK_SIGNAL_MIN,
};
use n_apt_backend::fft::{FFTProcessor, FFTResult};

// Server configuration from Cargo.toml metadata
use n_apt_backend::consts::rs::env::{WS_HOST, WS_PORT};

// Configuration constants (matching Python backend)
// Note: These are kept for compatibility, but FFT module uses its own constants

/// WebSocket message structure for client-server communication
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WebSocketMessage {
  /// Message type (e.g., "frequency_range", "pause", "gain", "ppm")
  #[serde(rename = "type")]
  message_type: String,
  /// Minimum frequency in MHz (for frequency range messages)
  #[serde(skip_serializing_if = "Option::is_none")]
  min_freq: Option<f64>,
  /// Maximum frequency in MHz (for frequency range messages)
  #[serde(skip_serializing_if = "Option::is_none")]
  max_freq: Option<f64>,
  /// Pause state (for pause/resume messages)
  #[serde(skip_serializing_if = "Option::is_none")]
  paused: Option<bool>,
  /// Gain in dB (for gain control messages)
  #[serde(skip_serializing_if = "Option::is_none")]
  gain: Option<i32>,
  /// PPM correction (for PPM adjustment messages)
  #[serde(skip_serializing_if = "Option::is_none")]
  ppm: Option<i32>,
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

/// SDR processor wrapper that handles both real and mock SDR devices
struct SDRProcessor {
  /// FFT processor for signal processing
  fft_processor: FFTProcessor,
  /// Whether we're using mock data (always true for now)
  is_mock: bool,
}

impl SDRProcessor {
  /// Create a new SDR processor instance
  fn new() -> Self {
    Self {
      fft_processor: FFTProcessor::new(),
      is_mock: true,
    }
  }

  /// Initialize the SDR processor
  ///
  /// Currently always initializes in mock mode since RTL-SDR is not available
  fn initialize(&mut self) -> Result<()> {
    warn!("RTL-SDR not available. Using mock mode.");
    self.is_mock = true;
    Ok(())
  }

  /// Set the center frequency for the SDR
  ///
  /// # Arguments
  /// * `freq` - Center frequency in Hz
  ///
  /// # Returns
  /// Result indicating success or failure
  fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
    // Update FFT processor config
    let mut config = self.fft_processor.config().clone();
    config.sample_rate = freq;
    self.fft_processor.update_config(config);
    Ok(())
  }

  /// Set the gain for the SDR
  ///
  /// # Arguments
  /// * `gain` - Gain value in dB
  ///
  /// # Returns
  /// Result indicating success or failure
  fn set_gain(&mut self, gain: i32) -> Result<()> {
    // Update FFT processor config
    let mut config = self.fft_processor.config().clone();
    config.gain = gain as f32;
    self.fft_processor.update_config(config);
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
    // Update FFT processor config
    let mut config = self.fft_processor.config().clone();
    config.ppm = ppm as f32;
    self.fft_processor.update_config(config);
    Ok(())
  }

  /// Read and process SDR data
  ///
  /// In mock mode, generates random noise-like spectrum data that simulates
  /// a real SDR signal with noise floor, occasional spikes, and edge roll-off.
  ///
  /// # Returns
  /// Vector of f32 values representing the spectrum in dB
  fn read_and_process(&mut self) -> Result<Vec<f32>> {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let mut data = Vec::with_capacity(MOCK_SPECTRUM_SIZE);

    // Generate random noise-like spectrum data similar to real SDR
    for _i in 0..MOCK_SPECTRUM_SIZE {
      // Base noise floor around -60 to -70 dB
      let noise_floor = MOCK_NOISE_FLOOR_BASE
        + rng.gen_range(-MOCK_NOISE_FLOOR_VARIATION..MOCK_NOISE_FLOOR_VARIATION);

      // Add some random spikes to simulate signals
      let spike = if rng.gen_range(0..100) < MOCK_STRONG_SIGNAL_CHANCE {
        rng.gen_range(MOCK_STRONG_SIGNAL_MIN..MOCK_STRONG_SIGNAL_MAX) // Occasional strong signal
      } else if rng.gen_range(0..100) < MOCK_WEAK_SIGNAL_CHANCE {
        rng.gen_range(MOCK_WEAK_SIGNAL_MIN..MOCK_WEAK_SIGNAL_MAX) // More frequent weaker signals
      } else {
        0.0
      };

      let value: f32 = noise_floor + spike;
      data.push(value.clamp(FFT_MIN_DB as f32, FFT_MAX_DB as f32));
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
    let config = self.fft_processor.config();
    format!(
      "Mock RTL-SDR Device - Sample Rate: {} Hz, Gain: {} dB, PPM: {}",
      config.sample_rate, config.gain as i32, config.ppm as i32
    )
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

    // Start streaming task (only once)
    let broadcast_tx = self.broadcast_tx.clone();
    let client_count_clone = self.client_count.clone();
    let _is_paused_clone = self.is_paused.clone();

    info!("Starting streaming task...");

    tokio::spawn(async move {
      info!("Streaming task started!");
      let frame_interval = 1000 / FFT_FRAME_RATE as u64;

      // Create separate processor for streaming to avoid deadlock
      let streaming_processor = Arc::new(Mutex::new(SDRProcessor::new()));
      {
        let mut proc = streaming_processor.lock().await;
        proc.initialize().unwrap();
        info!(
          "Streaming SDR processor initialized: {}",
          proc.get_device_info()
        );
      }

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
                error!("Failed to read SDR data: {}", e);
                return;
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
                    warn!("Failed to send broadcast to {}: {}", addr, e);
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
      if let (Some(min_freq), Some(max_freq)) = (message.min_freq, message.max_freq) {
        let center_freq = ((min_freq + max_freq) * 500000.0) as u32; // Convert MHz to Hz
        if let Err(e) = processor.lock().await.set_center_frequency(center_freq) {
          error!("Failed to set frequency: {}", e);
        }
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
  env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

  info!("Starting N-APT Rust Backend Server");

  // Create and start the WebSocket server
  let mut server = WebSocketServer::new();
  server.start().await?;

  Ok(())
}
