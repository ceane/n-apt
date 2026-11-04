//! Types for the live stream test module

use serde::{Deserialize, Serialize};

/// One source-scoped RX frame received through the managed stream transport.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveData {
  pub source_id: String,
  pub stream_epoch: u64,
  pub sequence: u64,
  pub timestamp: i64,
  pub center_frequency_hz: u64,
  pub sample_rate_hz: u32,
  pub iq_bytes: Vec<u8>,
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
