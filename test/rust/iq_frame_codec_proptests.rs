//! Property tests for the encrypted IQ frame codecs and the multiplexed stream
//! JSON serializer. Verifies encoded frames always round-trip (payload bytes,
//! source id, epoch, sequence) and that `stream_event_json` emits well-formed,
//! finite JSON within the wire budget.

use n_apt_backend::crypto::decrypt_payload_binary;
use n_apt_backend::server::stream_manager::{
  StreamEvent, StreamFrame, StreamKey, StreamMode,
};
use n_apt_backend::server::types::SpectrumData;
use n_apt_backend::server::websocket_handlers::{
  encode_encrypted_iq_frame_v2, stream_event_json, IqFrameStatus,
};
use proptest::prelude::*;

fn arbitrary_spectrum_payload() -> impl Strategy<Value = SpectrumData> {
  (
    prop::collection::vec(any::<u8>(), 0..4096),
    any::<u32>(),
    any::<u64>(),
    any::<u64>(),
    any::<i64>(),
  )
    .prop_map(|(iq, center, epoch, sequence, timestamp)| SpectrumData {
      message_type: "spectrum".to_string(),
      waveform: vec![],
      is_mock_apt: false,
      source_id: "src".to_string(),
      stream_epoch: epoch,
      sequence,
      center_frequency_hz: Some(center),
      waveform_span_hz: None,
      timestamp,
      data_type: Some("iq_raw".to_string()),
      sample_rate: Some(2_400_000),
      power_scale: None,
      iq_data: iq,
      is_tx_preview: Some(false),
    })
}

fn arbitrary_stream_event() -> impl Strategy<Value = StreamEvent> {
  (
    any::<u64>(),
    any::<u64>(),
    prop::collection::vec(any::<u8>(), 0..2048),
  )
    .prop_map(|(epoch, revision, iq)| {
      StreamEvent::Frame(StreamFrame {
        key: StreamKey::new("src", StreamMode::Rx),
        stream_epoch: epoch,
        options_revision: revision,
        sequence: 1,
        timestamp: 100,
        center_frequency_hz: Some(137_100_000),
        sample_rate_hz: 2_400_000,
        iq_data: std::sync::Arc::new(iq),
        is_tx_preview: false,
      })
    })
}

/// Decode a v2 envelope into its parts. Layout:
/// `NAPT 4 / version 1 / flags 1 / header_len 2 / source_len 2 / status 1 /
/// reserved 5 / epoch 8 / sequence 8 / timestamp 8 / center 8 / dtype 4 /
/// sample_rate 4 / source / encrypted_payload`.
struct V2Decoded {
  source_id: Vec<u8>,
  epoch: u64,
  sequence: u64,
  sample_rate: u32,
  encrypted_payload: Vec<u8>,
}

fn decode_v2(encoded: &[u8]) -> Option<V2Decoded> {
  if encoded.len() < 4 || &encoded[0..4] != b"NAPT" {
    return None;
  }
  let header_len = u16::from_le_bytes([encoded[6], encoded[7]]) as usize;
  let source_len = u16::from_le_bytes([encoded[8], encoded[9]]) as usize;
  if header_len != 56 + source_len || encoded.len() < header_len {
    return None;
  }
  Some(V2Decoded {
    source_id: encoded[56..header_len].to_vec(),
    epoch: u64::from_le_bytes(encoded[16..24].try_into().ok()?),
    sequence: u64::from_le_bytes(encoded[24..32].try_into().ok()?),
    sample_rate: u32::from_le_bytes(encoded[52..56].try_into().ok()?),
    encrypted_payload: encoded[header_len..].to_vec(),
  })
}

fn run_catch_unwind<F: FnOnce()>(f: F) {
  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
  assert!(result.is_ok(), "expression panicked under fuzzing");
}

proptest! {
  #![proptest_config(ProptestConfig::with_cases(256))]

  #[test]
  fn v2_codec_round_trips_payload_and_metadata(
    mut payload in arbitrary_spectrum_payload(),
    source_id in "[a-zA-Z0-9_-]{0,32}",
    stream_epoch in 0u64..u64::MAX,
    sequence in 0u64..u64::MAX,
    status in 0u8..3,
  ) {
    payload.stream_epoch = stream_epoch;
    payload.sequence = sequence;
    let key = [0x42u8; 32];
    let status = match status {
      0 => IqFrameStatus::Receiving,
      1 => IqFrameStatus::Standby,
      _ => IqFrameStatus::Transmitting,
    };
    let encoded = encode_encrypted_iq_frame_v2(
      &key, &payload, &source_id, stream_epoch, sequence, status,
    )
    .expect("short source id must encode");
    let decoded = decode_v2(&encoded)
      .expect("round-trip decoder must accept the encoder output");
    assert_eq!(decoded.source_id, source_id.as_bytes());
    assert_eq!(decoded.epoch, stream_epoch);
    assert_eq!(decoded.sequence, sequence);
    assert_eq!(decoded.sample_rate, payload.sample_rate.unwrap_or(0));
    let decrypted = decrypt_payload_binary(&key, &decoded.encrypted_payload)
      .expect("must decrypt");
    assert_eq!(decrypted, payload.iq_data, "IQ payload round-trip");
  }

  #[test]
  fn stream_event_json_is_valid_json_and_wellformed(event in arbitrary_stream_event()) {
    let key = [0x42u8; 32];
    run_catch_unwind(|| {
      let value = stream_event_json(&event, &key).expect("serialization must succeed");
      let text = serde_json::to_string(&value).unwrap();
      let reparsed: serde_json::Value = serde_json::from_str(&text).unwrap();
      assert_eq!(reparsed, value, "round-trip JSON must be identical");
      assert!(text.len() <= 64 * 1024, "frame must fit the WS write budget");
      assert_eq!(value["type"], "stream_frame");
      assert_eq!(value["encrypted"], true);
      assert!(
        value["iqData"].is_string(),
        "iqData must be a base64 string"
      );
      assert!(
        value["sequence"].as_u64().is_some(),
        "sequence must be finite"
      );
      assert!(
        value["streamEpoch"].as_u64().is_some(),
        "epoch must be finite"
      );
      assert!(
        value["optionsRevision"].as_u64().is_some(),
        "revision must be finite"
      );
    });
  }
}
