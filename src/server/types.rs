use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use n_apt_backend::consts::rs::mock::{
  MOCK_NARROW_BAND_WIDTH, MOCK_WIDE_BAND_WIDTH,
  MOCK_STRONG_SIGNAL_MAX, MOCK_STRONG_SIGNAL_MIN, MOCK_MEDIUM_SIGNAL_MAX, MOCK_MEDIUM_SIGNAL_MIN,
  MOCK_WEAK_SIGNAL_MAX, MOCK_WEAK_SIGNAL_MIN,
};

/// WebMCP tool request from agents
#[derive(Debug, Deserialize)]
pub struct WebMCPToolRequest {
  pub name: String,
  pub params: serde_json::Value,
}

/// WebMCP tool response
#[derive(Debug, Serialize)]
pub struct WebMCPToolResponse {
  pub success: bool,
  pub result: Option<serde_json::Value>,
  pub error: Option<String>,
  pub tool: String,
}

/// Command enum for the dedicated SDR I/O thread
#[derive(Debug, Clone)]
pub enum SdrCommand {
  SetFrequency(u32),
  SetGain(f64),
  SetPpm(i32),
  SetTunerAGC(bool),
  SetRtlAGC(bool),
  RestartDevice,
  StartTraining { label: String, signal_area: String },
  StopTraining,
  StartCapture {
    job_id: String,
    min_freq: f64,
    max_freq: f64,
    duration_s: f64,
    file_type: String,
    encrypted: bool,
    fft_size: usize,
    fft_window: String,
  },
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
pub struct WebSocketMessage {
  #[serde(rename = "type")]
  pub message_type: String,
  #[serde(skip_serializing_if = "Option::is_none", alias = "minFreq")]
  pub min_freq: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "maxFreq")]
  pub max_freq: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub paused: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub gain: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub ppm: Option<i32>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "tunerAGC")]
  pub tuner_agc: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "rtlAGC")]
  pub rtl_agc: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "fftSize")]
  pub fft_size: Option<usize>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "fftWindow")]
  pub fft_window: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "frameRate")]
  pub frame_rate: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "liveRetune")]
  pub live_retune: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub label: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "signalArea")]
  pub signal_area: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub action: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "jobId")]
  pub job_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "durationS")]
  pub duration_s: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "fileType")]
  pub file_type: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub encrypted: Option<bool>,
}

/// Spectrum data message sent to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumData {
  #[serde(rename = "type")]
  pub message_type: String,
  pub waveform: Vec<f32>,
  pub waterfall: Vec<f32>,
  pub is_mock: bool,
  pub timestamp: i64,
}

/// Status message for WebSocket communication
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusMessage {
  #[serde(rename = "type")]
  pub message_type: String,
  pub device_connected: bool,
  pub paused: bool,
  pub backend: String,
  pub device_info: String,
  pub max_sample_rate: u32,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub spectrum_frames: Option<Vec<SpectrumFrameMessage>>,
}

/// Structured signal pattern for consistent waterfall visualization
#[derive(Debug, Clone)]
pub struct MockSignal {
  pub center_bin: f32,
  pub drift_offset: f32,
  pub bandwidth: usize,
  pub base_strength: f32,
  pub modulation_phase: f32,
  pub active: bool,
  /// Type of signal (for future classification features)
#[allow(dead_code)]
pub signal_type: SignalType,
}

#[derive(Debug, Clone)]
pub enum SignalType {
  Narrow,
  Medium,
  Wide,
}

impl SignalType {
  pub fn bandwidth(&self) -> usize {
    match self {
      SignalType::Narrow => MOCK_NARROW_BAND_WIDTH,
      SignalType::Medium => (MOCK_NARROW_BAND_WIDTH + MOCK_WIDE_BAND_WIDTH) / 2,
      SignalType::Wide => MOCK_WIDE_BAND_WIDTH,
    }
  }

  pub fn random_strength_range(&self, rng: &mut rand::rngs::ThreadRng) -> f32 {
    match self {
      SignalType::Narrow => rng.gen_range(MOCK_WEAK_SIGNAL_MIN..MOCK_WEAK_SIGNAL_MAX),
      SignalType::Medium => rng.gen_range(MOCK_MEDIUM_SIGNAL_MIN..MOCK_MEDIUM_SIGNAL_MAX),
      SignalType::Wide => rng.gen_range(MOCK_STRONG_SIGNAL_MIN..MOCK_STRONG_SIGNAL_MAX),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumFramesConfig {
  pub frames: HashMap<String, SpectrumFrameConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumFrameConfig {
  pub label: String,
  #[serde(rename = "freq_range_mhz")]
  pub freq_range_mhz: Vec<f64>,
  pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumFrameMessage {
  pub id: String,
  pub label: String,
  pub min_mhz: f64,
  pub max_mhz: f64,
  pub description: String,
}

#[derive(Debug, Clone)]
pub struct CaptureArtifact {
  pub filename: String,
  pub path: std::path::PathBuf,
}

// REST auth request/response types
#[derive(Deserialize)]
pub struct AuthVerifyRequest {
  pub challenge_id: String,
  pub hmac: String,
}

#[derive(Deserialize)]
pub struct AuthSessionRequest {
  pub token: String,
}

#[derive(Deserialize)]
pub struct WsQueryParams {
  pub token: String,
}

#[derive(Deserialize)]
pub struct PasskeyRegisterFinishRequest {
  pub challenge_id: String,
  pub credential: webauthn_rs::prelude::RegisterPublicKeyCredential,
}

#[derive(Deserialize)]
pub struct PasskeyAuthFinishRequest {
  pub challenge_id: String,
  pub credential: webauthn_rs::prelude::PublicKeyCredential,
}

#[derive(Debug, Deserialize)]
pub struct CaptureDownloadParams {
  pub token: String,
  #[serde(rename = "jobId")]
  pub job_id: String,
}
