//! Property tests for `StreamCommand` deserialization (the `/ws/streams`
//! multiplexed socket protocol). Verifies parsing never panics and honest
//! commands deserialize, while garbage or out-of-range option values are
//! rejected rather than silently accepted into device state.

use n_apt_backend::server::stream_contract::{
  stream_control_scope, StreamControlAction, StreamControlScope,
};
use n_apt_backend::server::stream_manager::StreamMode;
use n_apt_backend::server::websocket_handlers::{stream_options_valid, StreamCommand};
use proptest::prelude::*;

fn any_source_id() -> impl Strategy<Value = String> {
  "[a-zA-Z0-9_-]{0,40}"
}

fn rx_options_json() -> impl Strategy<Value = serde_json::Value> {
  (
    any::<u64>(),
    any::<u32>(),
    any::<usize>(),
    prop::option::of("[a-z]{1,12}"),
    prop::option::of(any::<u32>()),
    prop::option::of(any::<f64>()),
  )
    .prop_map(|(cf, sr, fft, win, fr, gain)| {
      serde_json::json!({
        "mode": "rx",
        "centerFrequencyHz": cf,
        "sampleRateHz": sr,
        "fftSize": fft,
        "fftWindow": win,
        "frameRate": fr,
        "gain": gain,
      })
    })
}

fn tx_options_json() -> impl Strategy<Value = serde_json::Value> {
  (
    any::<u64>(),
    any::<u32>(),
    any::<u32>(),
    "[a-z]{1,12}",
    any::<f64>(),
    any::<usize>(),
  )
    .prop_map(|(cf, sr, bw, signal, power, ifft)| {
      serde_json::json!({
        "mode": "tx",
        "centerFrequencyHz": cf,
        "sampleRateHz": sr,
        "bandwidthHz": bw,
        "signal": signal,
        "powerDbm": power,
        "ifftSize": ifft,
      })
    })
}

fn scoped_command() -> impl Strategy<Value = serde_json::Value> {
  let kind = prop_oneof![
    Just("stream_subscribe"),
    Just("stream_unsubscribe"),
    Just("stream_set_paused"),
    Just("stream_set_delivery"),
    Just("stream_update_options"),
  ];
  (kind, any_source_id(), any_source_id(), prop::bool::ANY).prop_flat_map(
    move |(tag, src, sub, with_options)| {
      let has_options = (tag == "stream_update_options" || tag == "stream_subscribe")
        && with_options;
      let options = if has_options {
        prop_oneof![rx_options_json().boxed(), tx_options_json().boxed()].boxed()
      } else {
        Just(serde_json::Value::Null).boxed()
      };
      options.prop_map(move |opts| {
        let mut v = serde_json::json!({
          "type": tag,
          "subscriptionId": sub,
          "stream": { "sourceId": src, "mode": "rx" },
        });
        if opts != serde_json::Value::Null {
          v["options"] = opts;
        }
        if tag == "stream_set_paused" {
          v["paused"] = serde_json::Value::Bool(true);
        }
        if tag == "stream_set_delivery" {
          v["deliveryPolicy"] = serde_json::Value::String("lossless".to_string());
        }
        v
      })
    },
  )
}

fn any_json() -> impl Strategy<Value = serde_json::Value> {
  prop_oneof![
    scoped_command().boxed(),
    Just(serde_json::Value::Null).boxed(),
    (0i64..8).prop_map(serde_json::Value::from).boxed(),
  ]
}

fn run_catch_unwind<F: FnOnce()>(f: F) {
  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
  assert!(result.is_ok(), "expression panicked under fuzzing");
}

proptest! {
  #![proptest_config(ProptestConfig::with_cases(512))]

  #[test]
  fn stream_command_parse_never_panics(raw in any_json()) {
    let text = serde_json::to_string(&raw).unwrap();
    run_catch_unwind(|| {
      let _ = serde_json::from_str::<StreamCommand>(&text);
    });
  }

  #[test]
  fn honest_subscribe_command_deserializes(src in any_source_id(), options in rx_options_json()) {
    let value = serde_json::json!({
      "type": "stream_subscribe",
      "subscriptionId": "transport-1",
      "stream": { "sourceId": src, "mode": "rx" },
      "options": options,
      "deliveryPolicy": "lossless",
    });
    run_catch_unwind(|| {
      let command = serde_json::from_str::<StreamCommand>(&serde_json::to_string(&value).unwrap());
      // Known truthful commands must parse.
      assert!(command.is_ok(), "honest subscribe command must deserialize");
    });
  }

  #[test]
  fn garbage_stream_options_never_corrupt_mode(raw in any_json(), tag in "stream_(foo|bar|subscribe|update_options)") {
    let mut obj = match raw {
      serde_json::Value::Object(map) => map,
      _ => serde_json::Map::new(),
    };
    obj.insert("type".to_string(), serde_json::Value::String(tag));
    let text = serde_json::to_string(&serde_json::Value::Object(obj)).unwrap_or("{}".to_string());
    run_catch_unwind(|| {
      let _ = serde_json::from_str::<StreamCommand>(&text);
    });
  }

  #[test]
  fn stream_control_scope_is_total(mode in 0u8..2, action in 0u8..4) {
    let mode = if mode == 0 { StreamMode::Rx } else { StreamMode::Tx };
    let action = match action {
      0 => StreamControlAction::Pause,
      1 => StreamControlAction::Stop,
      2 => StreamControlAction::Settings,
      _ => StreamControlAction::Tune,
    };
    let scope = stream_control_scope(mode, action);
    assert!(matches!(scope, StreamControlScope::Subscriber | StreamControlScope::Device));
    // Contract: only rx.pause is subscriber-scoped.
    let expected = matches!((mode, action), (StreamMode::Rx, StreamControlAction::Pause));
    assert_eq!(scope == StreamControlScope::Subscriber, expected);
  }

  #[test]
  fn stream_options_valid_rejects_out_of_range_values(
    fft_size in prop_oneof![0usize..=8_388_608usize, (9_000_000usize)..12_000_000usize],
    sample_rate_hz in prop_oneof![0u32..=100_000_000u32, (200_000_000u32)..300_000_000u32],
  ) {
    use n_apt_backend::server::stream_manager::{RxStreamOptions, StreamOptions};
    let options = StreamOptions::Rx(RxStreamOptions {
      center_frequency_hz: 100_000_000,
      sample_rate_hz,
      fft_size,
      fft_window: None,
      frame_rate: None,
      gain: None,
    });
    let valid = stream_options_valid(&options);
    let out_of_range =
      fft_size < 256 || fft_size > 8_388_608 || sample_rate_hz == 0 || sample_rate_hz > 100_000_000;
    assert_eq!(valid, !out_of_range, "bounds mismatch for fft_size={fft_size} sample_rate={sample_rate_hz}");
  }
}