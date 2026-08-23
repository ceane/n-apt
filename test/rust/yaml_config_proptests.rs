//! Property tests for the signals.yaml preprocessing + parse path. Fuzzes
//! arbitrary YAML-ish strings (seeded with realistic tag fragments) and asserts
//! the pipeline never panics — invalid config must be a recoverable error, not
//! a process abort.

use n_apt_backend::server::types::SignalsConfig;
use n_apt_backend::server::utils::{
  preprocess_frequency_tags, preprocess_sdr_sample_rate_tags,
};
use proptest::prelude::*;

fn realistic_yaml_fragment() -> impl Strategy<Value = String> {
  prop_oneof![
    // Tag-heavy fragments mirroring canonical signals.yaml.
    Just("channels:\n  a:\n    freq_range_hz: !frequency_range 18kHz..4.47MHz\n    description: \"Channel A\"\n".to_owned()),
    Just("signals:\n  center_frequency: !frequency 137.5MHz\n  sample_rate: !frequency 2.4MHz\n".to_owned()),
    Just("mock_apt:\n  channels:\n    a:\n      noise_floor_db: !db -100dB\n      signal_strength_range: !db_range -80dB..-20dB\n".to_owned()),
    Just("sdr:\n  sample_rate: 3200000\n  fft:\n    default_size: 2048\n    max_frame_rate: 100\n".to_owned()),
  ]
}

fn arbitrary_yaml() -> impl Strategy<Value = String> {
  let seed = ".*".prop_map(|s| format!("{}\n", s));
  prop_oneof![
    realistic_yaml_fragment().boxed(),
    seed.boxed(),
    Just("".to_string()).boxed(),
  ]
}

fn run_catch_unwind<F: FnOnce()>(f: F) {
  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
  assert!(result.is_ok(), "expression panicked under fuzzing");
}

proptest! {
  #![proptest_config(ProptestConfig::with_cases(1024))]

  #[test]
  fn preprocessing_never_panics(content in arbitrary_yaml()) {
    run_catch_unwind(|| {
      let _ = preprocess_frequency_tags(&content);
    });
    let processed = preprocess_frequency_tags(&content);
    run_catch_unwind(|| {
      let _ = preprocess_sdr_sample_rate_tags(&processed);
    });
  }

  #[test]
  fn full_parse_path_never_panics(content in arbitrary_yaml()) {
    run_catch_unwind(|| {
      let a = preprocess_frequency_tags(&content);
      let b = preprocess_sdr_sample_rate_tags(&a);
      let _ = serde_yaml::from_str::<SignalsConfig>(&b);
    });
  }

  #[test]
  fn valid_fragment_round_trips_tags(seed in realistic_yaml_fragment()) {
    // Preprocessing must not corrupt a well-formed config (idempotence on tags).
    let once = preprocess_frequency_tags(&seed);
    let twice = preprocess_frequency_tags(&once);
    assert_eq!(once, twice, "frequency preprocessing must be idempotent");
    let rate_processed = preprocess_sdr_sample_rate_tags(&seed);
    let rate_twice = preprocess_sdr_sample_rate_tags(&rate_processed);
    assert_eq!(rate_processed, rate_twice, "sample-rate preprocessing must be idempotent");
  }
}