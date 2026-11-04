//! Decoder for the managed RX stream frame contract.

use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::Value;

use super::types::LiveData;

/// Decode and authenticate one managed RX frame.
///
/// The stream envelope is JSON even though `iqData` contains encrypted binary
/// data encoded as base64. Requiring its identity fields here prevents the
/// diagnostic client from accepting an unscoped frame accidentally.
pub fn parse_managed_iq_frame(
  encryption_key: &[u8; 32],
  message: &[u8],
  expected_source_id: &str,
) -> Result<LiveData> {
  let frame: Value = serde_json::from_slice(message)
    .context("managed stream frame is not valid JSON")?;

  require_string(&frame, "type", "stream_frame")?;
  let source_id = required_string(&frame, "sourceId")?;
  if source_id != expected_source_id {
    bail!("managed stream frame source does not match subscription");
  }
  require_string(&frame, "mode", "rx")?;

  let stream_epoch = required_u64(&frame, "streamEpoch")?;
  let sequence = required_u64(&frame, "sequence")?;
  let timestamp = frame
    .get("timestamp")
    .and_then(Value::as_i64)
    .ok_or_else(|| anyhow!("managed stream frame is missing timestamp"))?;
  let center_frequency_hz = required_u64(&frame, "centerFrequencyHz")?;
  let sample_rate_hz = u32::try_from(required_u64(&frame, "sampleRateHz")?)
    .context("managed stream sample rate is out of range")?;
  if sample_rate_hz == 0 {
    bail!("managed stream sample rate must be positive");
  }

  require_string(&frame, "dataType", "iq_raw")?;
  if frame.get("encrypted").and_then(Value::as_bool) != Some(true) {
    bail!("managed stream I/Q payload must be encrypted");
  }
  if frame.get("isTxPreview").and_then(Value::as_bool) != Some(false) {
    bail!("managed RX stream frame cannot be a TX preview");
  }

  let encoded_iq = required_string(&frame, "iqData")?;
  let encrypted_iq = BASE64
    .decode(encoded_iq)
    .context("managed stream I/Q payload is not valid base64")?;
  let iq_bytes =
    crate::crypto::decrypt_payload_binary(encryption_key, &encrypted_iq)
      .context("managed stream I/Q payload could not be decrypted")?;
  if iq_bytes.is_empty() || iq_bytes.len() % 2 != 0 {
    bail!("managed stream I/Q payload must contain complete I/Q samples");
  }

  Ok(LiveData {
    source_id: source_id.to_owned(),
    stream_epoch,
    sequence,
    timestamp,
    center_frequency_hz,
    sample_rate_hz,
    iq_bytes,
  })
}

fn required_string<'a>(frame: &'a Value, key: &str) -> Result<&'a str> {
  frame
    .get(key)
    .and_then(Value::as_str)
    .ok_or_else(|| anyhow!("managed stream frame is missing {key}"))
}

fn require_string(frame: &Value, key: &str, expected: &str) -> Result<()> {
  if required_string(frame, key)? != expected {
    bail!("managed stream frame has an unexpected {key}");
  }
  Ok(())
}

fn required_u64(frame: &Value, key: &str) -> Result<u64> {
  frame
    .get(key)
    .and_then(Value::as_u64)
    .ok_or_else(|| anyhow!("managed stream frame is missing {key}"))
}

/// Drop duplicate or out-of-order frames while allowing a new epoch to restart
/// its sequence counter.
#[derive(Debug, Default)]
pub struct FrameSequenceGuard {
  latest: Option<(u64, u64)>,
}

impl FrameSequenceGuard {
  pub fn accept(&mut self, frame: &LiveData) -> bool {
    let incoming = (frame.stream_epoch, frame.sequence);
    if let Some((epoch, sequence)) = self.latest {
      if incoming.0 < epoch || (incoming.0 == epoch && incoming.1 <= sequence) {
        return false;
      }
    }
    self.latest = Some(incoming);
    true
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const PASSKEY: &str = "managed-stream-test-passkey";

  fn encrypted_frame(payload: &[u8]) -> Value {
    let key = crate::crypto::derive_key(PASSKEY);
    let encrypted =
      crate::crypto::encrypt_payload_binary(&key, payload).unwrap();
    serde_json::json!({
      "type": "stream_frame",
      "sourceId": "mock-apt",
      "mode": "rx",
      "streamEpoch": 7,
      "sequence": 12,
      "timestamp": 1_700_000_000_000_i64,
      "centerFrequencyHz": 137_100_000_u64,
      "sampleRateHz": 3_200_000_u32,
      "dataType": "iq_raw",
      "isTxPreview": false,
      "encrypted": true,
      "iqData": BASE64.encode(encrypted),
    })
  }

  #[test]
  fn managed_rx_frame_is_decrypted_from_the_managed_json_contract() {
    let expected_iq = [0, 128, 255, 64, 32, 240];
    let frame = encrypted_frame(&expected_iq);
    let key = crate::crypto::derive_key(PASSKEY);

    let decoded =
      parse_managed_iq_frame(&key, frame.to_string().as_bytes(), "mock-apt")
        .unwrap();

    assert_eq!(decoded.source_id, "mock-apt");
    assert_eq!(decoded.stream_epoch, 7);
    assert_eq!(decoded.sequence, 12);
    assert_eq!(decoded.timestamp, 1_700_000_000_000);
    assert_eq!(decoded.center_frequency_hz, 137_100_000);
    assert_eq!(decoded.sample_rate_hz, 3_200_000);
    assert_eq!(decoded.iq_bytes, expected_iq);
  }

  #[test]
  fn managed_rx_frame_requires_matching_source_identity_and_sequence() {
    let key = crate::crypto::derive_key(PASSKEY);
    let mut frame = encrypted_frame(&[128, 128]);
    frame["sourceId"] = Value::String("hackrf_one".to_owned());
    assert!(parse_managed_iq_frame(
      &key,
      frame.to_string().as_bytes(),
      "mock-apt",
    )
    .is_err());

    let mut frame = encrypted_frame(&[128, 128]);
    frame.as_object_mut().unwrap().remove("sequence");
    assert!(parse_managed_iq_frame(
      &key,
      frame.to_string().as_bytes(),
      "mock-apt",
    )
    .is_err());
  }

  #[test]
  fn managed_rx_frame_rejects_non_rx_or_malformed_payloads() {
    let key = crate::crypto::derive_key(PASSKEY);
    let mut frame = encrypted_frame(&[128, 128]);
    frame["mode"] = Value::String("tx".to_owned());
    assert!(parse_managed_iq_frame(
      &key,
      frame.to_string().as_bytes(),
      "mock-apt",
    )
    .is_err());

    let mut frame = encrypted_frame(&[128, 128]);
    frame["isTxPreview"] = Value::Bool(true);
    assert!(parse_managed_iq_frame(
      &key,
      frame.to_string().as_bytes(),
      "mock-apt",
    )
    .is_err());

    let mut frame = encrypted_frame(&[128, 128]);
    frame["iqData"] = Value::String("not base64".to_owned());
    assert!(parse_managed_iq_frame(
      &key,
      frame.to_string().as_bytes(),
      "mock-apt",
    )
    .is_err());

    let frame = encrypted_frame(&[128]);
    assert!(parse_managed_iq_frame(
      &key,
      frame.to_string().as_bytes(),
      "mock-apt",
    )
    .is_err());
  }

  #[test]
  fn frame_sequence_guard_drops_stale_frames_and_accepts_a_new_epoch() {
    let frame = |stream_epoch, sequence| LiveData {
      source_id: "mock-apt".to_owned(),
      stream_epoch,
      sequence,
      timestamp: 0,
      center_frequency_hz: 137_100_000,
      sample_rate_hz: 3_200_000,
      iq_bytes: vec![128, 128],
    };
    let mut guard = FrameSequenceGuard::default();

    assert!(guard.accept(&frame(3, 9)));
    assert!(!guard.accept(&frame(3, 9)));
    assert!(!guard.accept(&frame(3, 8)));
    assert!(!guard.accept(&frame(2, 20)));
    assert!(guard.accept(&frame(4, 1)));
    assert!(guard.accept(&frame(4, 2)));
  }
}
