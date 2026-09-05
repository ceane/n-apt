//! Types for the live stream test module

use serde::{Deserialize, Serialize};

/// Live stream data received from WebSocket
#[derive(Debug, Clone)]
pub enum LiveData {
  /// FFT spectrum data (power values)
  Spectrum {
    timestamp: i64,
    /// Full-width u64: the wire header carries 8 bytes and SDR centers can
    /// exceed the 32-bit range (e.g. 6 GHz HackRF band).
    center_frequency_hz: u64,
    sample_rate_hz: u32,
    waveform: Vec<f32>,
  },
  /// Raw I/Q samples
  RawIQ {
    timestamp: i64,
    center_frequency_hz: u64,
    sample_rate_hz: u32,
    iq_bytes: Vec<u8>,
  },
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
///
/// Payload schemas for the standalone diagnostic harness: fields are
/// populated when a measurement is recorded and are intentionally not
/// read back by the binary itself.
#[allow(dead_code)]
#[derive(Debug)]
pub struct AlgorithmResult {
  pub name: String,
  pub timestamp: i64,
  pub result_type: AlgorithmResultType,
}

#[allow(dead_code)]
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
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct PeakInfo {
  pub bin_index: usize,
  pub frequency_hz: f64,
  pub power_db: f32,
}
