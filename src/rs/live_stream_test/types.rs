//! Types for the live stream test module

use serde::{Deserialize, Serialize};

/// Live stream data received from WebSocket
#[derive(Debug, Clone)]
pub enum LiveData {
    /// FFT spectrum data (power values)
    Spectrum {
        timestamp: i64,
        center_frequency_hz: u32,
        sample_rate_hz: u32,
        waveform: Vec<f32>,
    },
    /// Raw I/Q samples
    RawIQ {
        timestamp: i64,
        center_frequency_hz: u32,
        sample_rate_hz: u32,
        iq_bytes: Vec<u8>,
    },
}

/// WebSocket message types
#[derive(Debug, Deserialize)]
pub struct WsStatusMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub device_connected: bool,
    pub device_info: String,
    pub device_name: String,
    pub device_state: String,
    pub paused: bool,
    pub max_sample_rate: u32,
}

/// Authentication challenge response
#[derive(Debug, Serialize)]
pub struct AuthRequest {
    pub challenge_id: String,
    pub hmac: String,
}

/// Authentication challenge
#[derive(Debug, Deserialize)]
pub struct AuthChallenge {
    pub challenge_id: String,
    pub nonce: String,
}

/// Algorithm test results
#[derive(Debug)]
pub struct AlgorithmResult {
    pub name: String,
    pub timestamp: i64,
    pub result_type: AlgorithmResultType,
}

#[derive(Debug)]
pub enum AlgorithmResultType {
    PeakDetection {
        peaks: Vec<PeakInfo>,
    },
    SignalStrength {
        avg_power_db: f32,
        max_power_db: f32,
        min_power_db: f32,
    },
    FrequencyAnalysis {
        dominant_freq_hz: f64,
        bandwidth_hz: f64,
    },
    Custom {
        data: serde_json::Value,
    },
}

#[derive(Debug, Clone)]
pub struct PeakInfo {
    pub bin_index: usize,
    pub frequency_hz: f64,
    pub power_db: f32,
}
