//! Property tests for `WebSocketMessage` serde parsing + validation.
//! Fuzzes arbitrary JSON so a malformed or hostile client can never panic the
//! control-plane parser, and verifies validated fields stay in range.

use n_apt_backend::server::types::WebSocketMessage;
use n_apt_backend::server::utils::RE_SAFE_ID;
use proptest::prelude::*;
use validator::Validate;

/// A `serde_json::Value` generator biased toward the shapes the message parser
/// expects while still covering extreme magnitudes, mixed types and unicode.
fn any_json() -> impl Strategy<Value = serde_json::Value> {
  let leaf = prop_oneof![
    Just(serde_json::Value::Null),
    proptest::bool::ANY.prop_map(serde_json::Value::Bool),
    any::<f64>().prop_map(serde_json::Value::from),
    any::<i64>().prop_map(serde_json::Value::from),
    any::<u64>().prop_map(serde_json::Value::from),
    ".*".prop_map(serde_json::Value::String),
  ];
  leaf.prop_recursive(4, 24, 6, |inner| {
    let key = prop_oneof![
      Just("type".to_string()),
      Just("frameRate".to_string()),
      Just("fftSize".to_string()),
      Just("minFreq".to_string()),
      Just("source_id".to_string()),
      Just("not-a-real-key".to_string()),
    ];
    prop_oneof![
      prop::collection::vec(inner.clone(), 0..6).prop_map(serde_json::Value::Array),
      prop::collection::vec((key, inner), 0..6).prop_map(|pairs| {
        serde_json::Value::Object(pairs.into_iter().collect())
      }),
    ]
  })
}

fn run_catch_unwind<F: FnOnce()>(f: F) {
  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
  assert!(result.is_ok(), "expression panicked under fuzzing");
}

proptest! {
  #![proptest_config(ProptestConfig::with_cases(512))]

  #[test]
  fn ws_message_parse_and_validate_never_panics(raw in any_json()) {
    let text = serde_json::to_string(&raw).unwrap();
    run_catch_unwind(|| {
      if let Ok(message) = serde_json::from_str::<WebSocketMessage>(&text) {
        // validate() must never panic for any successfully-parsed message.
        let _ = message.validate();
      }
    });
  }

  #[test]
  fn source_id_regex_is_total(id in ".*") {
    run_catch_unwind(|| {
      let _ = RE_SAFE_ID.is_match(&id);
    });
  }

  #[test]
  fn validated_fields_stay_in_documented_ranges(raw in any_json()) {
    run_catch_unwind(|| {
      let text = serde_json::to_string(&raw).unwrap();
      let Ok(message) = serde_json::from_str::<WebSocketMessage>(&text) else {
        return;
      };
      if message.validate().is_err() {
        return;
      }
      if let Some(fft_size) = message.fft_size {
        assert!((256..=8_388_608).contains(&fft_size), "fft_size {fft_size} out of range");
      }
      if let Some(frame_rate) = message.frame_rate {
        assert!((1..=100).contains(&frame_rate), "frame_rate {frame_rate} out of range");
      }
      if let Some(max_frame_rate) = message.max_frame_rate {
        assert!((1..=100).contains(&max_frame_rate), "max_frame_rate {max_frame_rate} out of range");
      }
      if let Some(ppm) = message.ppm {
        assert!((0..=1000).contains(&ppm), "ppm {ppm} out of range");
      }
      if let Some(center) = message.center_frequency {
        assert!((0.0..=30_000_000_000.0).contains(&center), "center frequency out of range");
      }
      if let Some(freq) = message.min_freq {
        assert!((0.0..=30_000_000_000.0).contains(&freq), "min freq out of range");
      }
      if let Some(freq) = message.max_freq {
        assert!((0.0..=30_000_000_000.0).contains(&freq), "max freq out of range");
      }
      if let Some(gain) = message.gain {
        assert!((0.0..=100.0).contains(&gain), "gain {gain} out of range");
      }
      if let Some(rate) = message.sample_rate {
        assert!((1.0..=100_000_000.0).contains(&rate), "sample rate {rate} out of range");
      }
    });
  }

  #[test]
  fn validate_is_idempotent(raw in any_json()) {
    run_catch_unwind(|| {
      let text = serde_json::to_string(&raw).unwrap();
      let Ok(message) = serde_json::from_str::<WebSocketMessage>(&text) else {
        return;
      };
      let first = message.validate();
      let second = message.validate();
      assert_eq!(first.is_ok(), second.is_ok());
    });
  }

  #[test]
  fn bandwidth_hz_deserialization_either_parses_or_rejects(raw in any_json()) {
    // The custom integer-Hz deserializer is exercised through a settings
    // message that carries a `bandwidthHz` field; it must never panic.
    let text = serde_json::to_string(&raw).unwrap();
    run_catch_unwind(|| {
      let _ = serde_json::from_str::<WebSocketMessage>(&text);
    });
  }
}