use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
// use rtlsdr::{RTLSDRDevice, RTLSDRError};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{accept_async, tungstenite::Message};

// Import FFT module from library
use n_apt_backend::fft::{FFTProcessor, FFTResult, RawSamples, bin_to_freq, FFT_FRAME_RATE};
use n_apt_backend::fft::processor::utils::freq_to_bin;

// Configuration constants (matching Python backend)
// Note: These are kept for compatibility, but FFT module uses its own constants

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WebSocketMessage {
  #[serde(rename = "type")]
  message_type: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  min_freq: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  max_freq: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  paused: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  gain: Option<i32>,
  #[serde(skip_serializing_if = "Option::is_none")]
  ppm: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SpectrumData {
  waveform: Vec<f32>,
  waterfall: Vec<f32>,
  is_mock: bool,
  timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StatusMessage {
  #[serde(rename = "type")]
  message_type: String,
  device_connected: bool,
  paused: bool,
  backend: String,
  device_info: String,
}

struct SDRProcessor {
  device: Option<Arc<Mutex<RTLSDRDevice>>>,
  fft_processor: FFTProcessor,
  is_mock: bool,
}

impl SDRProcessor {
  fn new() -> Self {
    Self {
      device: None,
      fft_processor: FFTProcessor::new(),
      is_mock: false,
    }
  }

  fn initialize(&mut self) -> Result<()> {
    match RTLSDRDevice::open(0) {
      Ok(dev) => {
        let device = Arc::new(Mutex::new(dev));

        // Configure device
        {
          let mut dev = device.lock().unwrap();
          dev.set_sample_rate(self.sample_rate)?;
          dev.set_center_freq(self.center_freq)?;
          dev.set_gain(self.gain)?;
          dev.set_freq_correction(self.ppm)?;
          dev.reset_buffer()?;
        }

        self.device = Some(device);
        self.is_mock = false;
        info!("RTL-SDR device initialized successfully");
        Ok(())
      }
      Err(e) => {
        warn!("Failed to open RTL-SDR device: {}. Using mock mode.", e);
        self.is_mock = true;
        Ok(())
      }
    }
  }

  fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
    if let Some(device) = &self.device {
      device.lock().unwrap().set_center_freq(freq)?;
    }
    // Update FFT processor config if needed
    let mut config = self.fft_processor.config().clone();
    config.sample_rate = freq;
    self.fft_processor.update_config(config);
    Ok(())
  }

  fn set_sample_rate(&mut self, rate: u32) -> Result<()> {
    if let Some(device) = &self.device {
      device.lock().unwrap().set_sample_rate(rate)?;
    }
    // Update FFT processor config
    let mut config = self.fft_processor.config().clone();
    config.sample_rate = rate;
    self.fft_processor.update_config(config);
    Ok(())
  }

  fn set_gain(&mut self, gain: i32) -> Result<()> {
    if let Some(device) = &self.device {
      device.lock().unwrap().set_gain(gain)?;
    }
    // Update FFT processor config
    let mut config = self.fft_processor.config().clone();
    config.gain = gain as f32;
    self.fft_processor.update_config(config);
    Ok(())
  }

  fn set_ppm(&mut self, ppm: i32) -> Result<()> {
    if let Some(device) = &self.device {
      device.lock().unwrap().set_freq_correction(ppm)?;
    }
    // Update FFT processor config
    let mut config = self.fft_processor.config().clone();
    config.ppm = ppm as f32;
    self.fft_processor.update_config(config);
    Ok(())
  }

  fn read_and_process(&mut self) -> Result<Vec<f32>> {
    if self.is_mock {
      return self.generate_mock_signal().map(|result| result.power_spectrum);
    }

    if let Some(device) = &self.device {
      let mut dev = device.lock().unwrap();
      
      // Read samples
      let samples = dev.read_sync(self.fft_processor.fft_size() * 2)?;
      
      // Create raw samples object
      let raw_samples = RawSamples {
        data: samples,
        sample_rate: self.fft_processor.config().sample_rate,
      };

      // Process samples using FFT module
      let result = self.fft_processor.process_samples(&raw_samples)?;
      
      Ok(result.power_spectrum)
    } else {
      Err(anyhow::anyhow!("Device not initialized"))
    }
  }

  fn generate_mock_signal(&mut self) -> Result<FFTResult> {
    let result = self.fft_processor.generate_mock_signal(None)?;
    Ok(result)
  }

  fn get_device_info(&self) -> String {
    if self.is_mock {
      "Mock RTL-SDR Device - Generating simulated signals".to_string()
    } else {
      let config = self.fft_processor.config();
      format!(
        "RTL-SDR Device - Sample Rate: {} Hz, Center Freq: {} Hz, Gain: {} dB, PPM: {}",
        config.sample_rate, 
        config.center_freq, 
        config.gain as i32, 
        config.ppm as i32
      )
    }
  }
}

struct WebSocketServer {
  processor: Arc<Mutex<SDRProcessor>>,
  clients: Arc<Mutex<Vec<tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>>>>,
  is_paused: Arc<Mutex<bool>>,
}

impl WebSocketServer {
  fn new() -> Self {
    let processor = Arc::new(Mutex::new(SDRProcessor::new()));
    Self {
      processor,
      clients: Arc::new(Mutex::new(Vec::new())),
      is_paused: Arc::new(Mutex::new(false)),
    }
  }

  async fn start(&mut self) -> Result<()> {
    // Initialize SDR processor
    {
      let mut processor = self.processor.lock().unwrap();
      processor.initialize()?;
      info!("SDR processor initialized: {}", processor.get_device_info());
    }

    // Start WebSocket server
    let listener = TcpListener::bind("127.0.0.1:8765").await?;
    info!("WebSocket server listening on ws://127.0.0.1:8765");

    // Start streaming task
    let processor_clone = self.processor.clone();
    let clients_clone = self.clients.clone();
    let is_paused_clone = self.is_paused.clone();
    tokio::spawn(async move {
      let mut interval = tokio::time::interval(Duration::from_millis(1000 / FFT_FRAME_RATE as u64));

      loop {
        interval.tick().await;

        let is_paused = *is_paused_clone.lock().unwrap();
        if !is_paused {
          match processor_clone.lock().unwrap().read_and_process() {
            Ok(spectrum) => {
              let data = SpectrumData {
                waveform: spectrum.clone(),
                waterfall: spectrum,
                is_mock: processor_clone.lock().unwrap().is_mock,
                timestamp: chrono::Utc::now().timestamp_millis(),
              };

              let message = serde_json::to_string(&data).unwrap();
              let mut clients = clients_clone.lock().unwrap();
              clients.retain(|client| {
                let mut client = client;
                match client.send(Message::Text(message.clone())).await {
                  Ok(_) => true,
                  Err(e) => {
                    warn!("Failed to send to client: {}", e);
                    false
                  }
                }
              });
            }
            Err(e) => {
              error!("Failed to read SDR data: {}", e);
            }
          }
        }
      }
    });

    // Handle connections
    while let Ok((stream, addr)) = listener.accept().await {
      info!("New connection from {}", addr);

      let processor = self.processor.clone();
      let clients = self.clients.clone();
      let is_paused = self.is_paused.clone();

      tokio::spawn(async move {
        let ws_stream = accept_async(stream)
          .await
          .expect("Error during WebSocket handshake");
        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        // Send initial status
        let status = StatusMessage {
          message_type: "status".to_string(),
          device_connected: !processor.lock().unwrap().is_mock,
          paused: *is_paused.lock().unwrap(),
          backend: if processor.lock().unwrap().is_mock {
            "mock".to_string()
          } else {
            "rtl-sdr".to_string()
          },
          device_info: processor.lock().unwrap().get_device_info(),
        };

        if let Ok(status_json) = serde_json::to_string(&status) {
          let _ = ws_sender.send(Message::Text(status_json)).await;
        }

        // Add to clients list
        clients.lock().unwrap().push(ws_sender);

        // Handle messages
        while let Some(msg) = ws_receiver.next().await {
          match msg {
            Ok(Message::Text(text)) => {
              if let Ok(message) = serde_json::from_str::<WebSocketMessage>(&text) {
                handle_message(&processor, &is_paused, message).await;
              }
            }
            Ok(Message::Close(_)) => {
              info!("Client disconnected");
              break;
            }
            Err(e) => {
              error!("WebSocket error: {}", e);
              break;
            }
            _ => {}
          }
        }
      });
    }

    Ok(())
  }
}

async fn handle_message(
  processor: &Arc<Mutex<SDRProcessor>>,
  is_paused: &Arc<Mutex<bool>>,
  message: WebSocketMessage,
) {
  match message.message_type.as_str() {
    "frequency_range" => {
      if let (Some(min_freq), Some(max_freq)) = (message.min_freq, message.max_freq) {
        let center_freq = ((min_freq + max_freq) * 500000.0) as u32; // Convert MHz to Hz
        if let Err(e) = processor.lock().unwrap().set_center_frequency(center_freq) {
          error!("Failed to set frequency: {}", e);
        }
      }
    }
    "pause" => {
      if let Some(paused) = message.paused {
        *is_paused.lock().unwrap() = paused;
        info!("Streaming {}", if paused { "paused" } else { "resumed" });
      }
    }
    "gain" => {
      if let Some(gain) = message.gain {
        if let Err(e) = processor.lock().unwrap().set_gain(gain) {
          error!("Failed to set gain: {}", e);
        }
      }
    }
    "ppm" => {
      if let Some(ppm) = message.ppm {
        if let Err(e) = processor.lock().unwrap().set_ppm(ppm) {
          error!("Failed to set PPM: {}", e);
        }
      }
    }
    _ => {
      warn!("Unknown message type: {}", message.message_type);
    }
  }
}

#[tokio::main]
async fn main() -> Result<()> {
  env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

  info!("Starting N-APT Rust Backend Server");

  let mut server = WebSocketServer::new();
  server.start().await?;

  Ok(())
}
