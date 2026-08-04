use n_apt_backend::server::shared_state::SharedState;
use n_apt_backend::server::types::DeviceProfile;
use n_apt_backend::server::types::TxIqPowerModel;
use n_apt_backend::server::websocket_server::*;
use serial_test::serial;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::broadcast;

use n_apt_backend::sdr::hotplug::{
  is_recovery_budget_exhausted, should_enter_hardware_recovery,
  should_probe_for_hotplug,
};

#[test]
fn mock_apt_never_enters_hardware_recovery() {
  assert!(!should_enter_hardware_recovery("Mock APT SDR"));
  assert!(!should_enter_hardware_recovery("mock_apt"));
  assert!(should_enter_hardware_recovery("rtl-sdr"));
  assert!(should_enter_hardware_recovery("hackrf_one"));
}

#[test]
fn recovery_budget_is_exhausted_at_max_attempts() {
  assert!(!is_recovery_budget_exhausted(0, 2));
  assert!(!is_recovery_budget_exhausted(1, 2));
  assert!(is_recovery_budget_exhausted(2, 2));
  assert!(is_recovery_budget_exhausted(3, 2));
}

#[test]
fn hotplug_probe_only_runs_for_mock_devices() {
  assert!(should_probe_for_hotplug("Mock APT SDR"));
  assert!(should_probe_for_hotplug("mock_apt"));
  assert!(!should_probe_for_hotplug("rtl-sdr"));
  assert!(!should_probe_for_hotplug("hackrf_one"));
}

#[test]
#[serial]
fn restart_status_payload_reports_attempt_budget() {
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");
  shared.recovery_attempts.store(1, Ordering::Relaxed);
  shared.set_device_state("loading", Some("restart"));
  let (broadcast_tx, mut broadcast_rx) = broadcast::channel(1);

  broadcast_source_status(&shared, &broadcast_tx, "loading");

  let payload = serde_json::from_str::<serde_json::Value>(
    &broadcast_rx.try_recv().expect("status broadcast"),
  )
  .expect("status payload should be valid JSON");

  assert_eq!(payload["type"], "status");
  assert_eq!(payload["source_id"], "mock-apt");
  assert_eq!(payload["status"], "loading");
  assert_eq!(payload["loading_attempt"], 1);
  assert_eq!(
    payload["loading_attempt_max"],
    n_apt_backend::server::shared_state::MAX_RECOVERY_ATTEMPTS
  );
}

#[test]
#[serial]
fn broadcast_device_status_includes_websocket_payload_fields() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");
  let (broadcast_tx, mut broadcast_rx) = broadcast::channel(16);

  *shared.device_serial.lock().unwrap() = "1".to_string();
  shared.update_device_status(
    true,
    "Generic RTL2832U".to_string(),
    DeviceProfile {
      kind: "rtl-sdr".to_string(),
      is_rtl_sdr: true,
      supports_approx_dbm: true,
      iq_format: Some(n_apt_backend::server::types::IqFormat::default()),
    },
  );
  shared.recovery_attempts.store(1, Ordering::Relaxed);

  broadcast_device_status(&shared, &broadcast_tx);

  let payload = serde_json::from_str::<serde_json::Value>(
    &broadcast_rx.try_recv().expect("status broadcast"),
  )
  .expect("status payload should be valid JSON");

  assert_eq!(payload["type"], "source_info");
  assert_eq!(payload["sources"][0]["capability"], "rx");
  assert_eq!(payload["sources"][0]["status"], "receiving");
  assert_eq!(payload["active_source"], "rtl-sdr-1");
  assert_eq!(payload["active_source_mode"], "live");
  assert!(payload.get("device_name").is_none());
  assert!(payload.get("sample_rate_options").is_none());
  let markers = payload["sources"][0]["sdr"]["fft_display"]["markers"]
    .as_array()
    .expect("source markers should be an array");
  assert!(
    markers.len() >= 2,
    "expected at least the base lower/upper SDR limit markers"
  );
  assert!(
    markers.iter().any(|marker| marker["kind"] == "lower_limit"),
    "expected lower limit marker in websocket payload"
  );
}

#[test]
#[serial]
fn broadcast_device_status_suppresses_duplicate_snapshots() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");
  let (broadcast_tx, mut broadcast_rx) = broadcast::channel(16);

  shared.update_device_status(
    false,
    "Mock APT SDR".to_string(),
    build_device_profile("mock_apt"),
  );

  broadcast_device_status(&shared, &broadcast_tx);
  broadcast_device_status(&shared, &broadcast_tx);

  let first = broadcast_rx.try_recv().expect("first status broadcast");
  assert!(first.contains(r#""type":"source_info""#));
  if let Ok(second) = broadcast_rx.try_recv() {
    assert!(second.contains(r#""type":"active_source""#));
  }
  assert!(
    broadcast_rx.try_recv().is_err(),
    "expected duplicate snapshot to be suppressed"
  );
}

#[test]
#[serial]
fn broadcast_active_source_uses_frontend_contract_fields() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");
  let (broadcast_tx, mut broadcast_rx) = broadcast::channel(16);

  broadcast_active_source(&shared, &broadcast_tx);

  let payload = serde_json::from_str::<serde_json::Value>(
    &broadcast_rx.try_recv().expect("active source broadcast"),
  )
  .expect("active source payload should be valid JSON");

  assert_eq!(payload["type"], "active_source");
  assert_eq!(payload["source_id"], "mock-apt");
  assert_eq!(payload["source_mode"], "live");
  assert!(payload.get("active_source").is_none());
  assert!(payload.get("active_source_mode").is_none());
}

#[test]
#[serial]
fn broadcast_device_status_reports_hackrf_one_without_rtl_sdr_fallback() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");
  let (broadcast_tx, mut broadcast_rx) = broadcast::channel(16);

  shared.update_device_status(
    true,
    "Great Scott Gadgets HackRF - Freq: 100 Hz, Rate: 2000000 Hz".to_string(),
    DeviceProfile {
      kind: "hackrf_one".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      iq_format: Some(n_apt_backend::server::types::IqFormat::default()),
    },
  );

  broadcast_device_status(&shared, &broadcast_tx);

  let payload = serde_json::from_str::<serde_json::Value>(
    &broadcast_rx.try_recv().expect("status broadcast"),
  )
  .expect("status payload should be valid JSON");

  assert_eq!(payload["type"], "source_info");
  assert_eq!(payload["sources"][0]["name"], "HackRF One");
  assert_eq!(payload["sources"][0]["kind"], "hackrf_one");
  assert_eq!(payload["sources"][0]["capability"], "tx_rx");
  assert_eq!(payload["sources"][0]["status"], "connected");
}

#[test]
#[serial]
fn source_info_reports_active_hackrf_as_transmitting_when_tx_is_active() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");
  shared.update_device_status(
    true,
    "HackRF One".to_string(),
    build_device_profile("hackrf_one"),
  );
  shared.update_device_usb_strings(
    "hackrf-test-serial".to_string(),
    "Great Scott Gadgets".to_string(),
    "HackRF One".to_string(),
  );
  crate::safety::TX_TRANSMITTING.store(true, Ordering::Relaxed);

  let snapshot = build_source_info_snapshot(&shared);
  crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);

  let sources = snapshot["sources"].as_array().expect("sources array");
  let active = sources
    .iter()
    .find(|source| {
      source["id"].as_str() == Some("hackrf_one-hackrf-test-serial")
    })
    .expect("active HackRF source");

  assert_eq!(snapshot["active_source"], "hackrf_one-hackrf-test-serial");
  assert_eq!(active["status"], "transmitting");
}

#[test]
#[serial]
fn source_info_snapshot_contains_all_sources() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");

  let snapshot = build_source_info_snapshot(&shared);

  assert_eq!(snapshot["type"], "source_info");
  assert!(snapshot["sources"].is_array());
  let sources = snapshot["sources"].as_array().expect("sources array");
  assert!(!sources.is_empty());
  let active_source = snapshot["active_source"]
    .as_str()
    .expect("active source id");
  assert!(sources
    .iter()
    .any(|source| source["id"].as_str() == Some(active_source)));
  let unique_ids = sources
    .iter()
    .filter_map(|source| source["id"].as_str())
    .collect::<std::collections::HashSet<_>>();
  assert_eq!(unique_ids.len(), sources.len());
}

#[test]
#[serial]
fn paused_active_sources_do_not_report_streaming_status() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");
  shared.set_active_source_pause_state("mock-apt", true);

  let snapshot = build_source_info_snapshot(&shared);

  assert_eq!(snapshot["active_source"], "mock-apt");
  assert_eq!(snapshot["active_source_mode"], "file");
  let sources = snapshot["sources"].as_array().expect("sources array");
  let active = sources
    .iter()
    .find(|source| source["id"].as_str() == Some("mock-apt"))
    .expect("active mock apt source");
  assert_eq!(active["status"], "paused");
}

#[test]
#[serial]
fn source_info_snapshot_includes_mock_tx_device() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");

  let snapshot = build_source_info_snapshot(&shared);
  let sources = snapshot["sources"].as_array().expect("sources array");
  let mock_tx = sources
    .iter()
    .find(|source| source["id"].as_str() == Some("mock-tx"))
    .expect("mock TX source should be present");

  assert_eq!(mock_tx["name"], "Mock Tx SDR");
  assert_eq!(mock_tx["kind"], "mock_tx");
  assert_eq!(mock_tx["capability"], "tx");
  assert_eq!(mock_tx["status"], "connected");
  assert_eq!(mock_tx["product"], "Mock Tx SDR");
  assert_eq!(mock_tx["stream_key"], "mock-tx");
  assert_eq!(mock_tx["stream_key_kind"], "source_id");
  assert_eq!(mock_tx["sdr"]["max_sample_rate"], 20_000_000);
  assert!(mock_tx["sdr"]["sample_rate_options"]
    .as_array()
    .expect("sample rate options")
    .iter()
    .any(|option| option.as_u64() == Some(20_000_000)));
}

#[test]
#[serial]
fn resolves_stream_key_to_source_id_from_snapshot() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");

  assert_eq!(
    resolve_stream_key_source_id(&shared, "mock-tx").as_deref(),
    Some("mock-tx")
  );
}

#[test]
fn source_stream_key_prefers_unique_serial_number() {
  let mut sources = vec![serde_json::json!({
    "id": "rtl-sdr-0",
    "serial_number": "00000001",
  })];

  apply_stream_keys(&mut sources);

  assert_eq!(sources[0]["stream_key"], "00000001");
  assert_eq!(sources[0]["stream_key_kind"], "serial");
}

#[test]
fn source_stream_key_falls_back_to_source_id_for_blank_serial() {
  let mut sources = vec![serde_json::json!({
    "id": "rtl-sdr-0",
    "serial_number": "   ",
  })];

  apply_stream_keys(&mut sources);

  assert_eq!(sources[0]["stream_key"], "rtl-sdr-0");
  assert_eq!(sources[0]["stream_key_kind"], "source_id");
}

#[test]
fn source_stream_key_falls_back_to_source_id_for_duplicate_serial() {
  let mut sources = vec![
    serde_json::json!({
      "id": "rtl-sdr-0",
      "serial_number": "DUPLICATE",
    }),
    serde_json::json!({
      "id": "rtl-sdr-1",
      "serial_number": "DUPLICATE",
    }),
  ];

  apply_stream_keys(&mut sources);

  assert_eq!(sources[0]["stream_key"], "rtl-sdr-0");
  assert_eq!(sources[0]["stream_key_kind"], "source_id");
  assert_eq!(sources[1]["stream_key"], "rtl-sdr-1");
  assert_eq!(sources[1]["stream_key_kind"], "source_id");
}

#[test]
#[serial]
fn mock_tx_monitor_returns_flat_noise_outside_tx_window() {
  let model = TxIqPowerModel::default();
  let frame = synthesize_mock_tx_monitor_iq(
    2048,
    20_000_000.0,
    2_400_000,
    2_204_000.0,
    2_400_000.0,
    "apt",
    2048,
    -18.0,
    &model,
    &mut 0.0,
  );

  let max_delta = frame
    .iter()
    .map(|byte| (*byte as i16 - 128).abs())
    .max()
    .unwrap_or(0);
  assert!(
    max_delta <= 3,
    "off-window monitor should be a flat noise floor, max delta {max_delta}"
  );
}

#[test]
#[serial]
fn mock_tx_monitor_signal_is_visible_inside_tx_window() {
  let model = TxIqPowerModel::default();
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(100_000, Ordering::Relaxed);
  let frame = synthesize_mock_tx_monitor_iq(
    2048,
    2_204_000.0,
    2_400_000,
    2_204_000.0,
    2_400_000.0,
    "apt",
    2048,
    -18.0,
    &model,
    &mut 0.0,
  );

  let max_delta = frame
    .iter()
    .map(|byte| (*byte as i16 - 128).abs())
    .max()
    .unwrap_or(0);

  assert!(
    max_delta > 0,
    "in-window monitor should contain the Tx waveform, max delta {max_delta}"
  );
}

#[test]
#[serial]
fn mock_tx_monitor_includes_noise_floor_across_the_view() {
  let model = TxIqPowerModel::default();
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(100_000, Ordering::Relaxed);
  let frame = synthesize_mock_tx_monitor_iq(
    4096,
    137_100_000.0,
    3_200_000,
    137_100_000.0,
    2_400_000.0,
    "apt",
    4096,
    -18.0,
    &model,
    &mut 0.0,
  );

  let non_center_samples = frame
    .chunks_exact(2)
    .filter(|sample| sample[0] != 128 || sample[1] != 128)
    .count();

  assert!(
    non_center_samples > 256,
    "Mock Tx monitor should include a visible configured noise floor, got {non_center_samples} non-center samples"
  );
}

#[test]
#[serial]
fn mock_tx_monitor_power_dbm_controls_waveform_amplitude() {
  let model = TxIqPowerModel::default();
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(100_000, Ordering::Relaxed);
  let high_power_frame = synthesize_mock_tx_monitor_iq(
    65_536,
    2_204_000.0,
    2_400_000,
    2_204_000.0,
    2_400_000.0,
    "carrier",
    65_536,
    -18.0,
    &model,
    &mut 0.0,
  );
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(100_000, Ordering::Relaxed);
  let low_power_frame = synthesize_mock_tx_monitor_iq(
    65_536,
    2_204_000.0,
    2_400_000,
    2_204_000.0,
    2_400_000.0,
    "carrier",
    65_536,
    -70.0,
    &model,
    &mut 0.0,
  );

  let high_dbm = iq_display_bin_dbm_at(&high_power_frame, 0.0, 2_400_000.0);
  let low_dbm = iq_display_bin_dbm_at(&low_power_frame, 0.0, 2_400_000.0);
  let low_floor_dbm = crate::safety::get_quantized_iq_power_floor_dbm(
    8,
    65_536,
    model.calibration_db,
  )
  .ceil();

  assert!(
    (high_dbm - -18.0).abs() < 1.5,
    "-18 dBm monitor should measure near requested power, got {high_dbm:.2} dBm"
  );
  assert!(
    low_dbm <= low_floor_dbm + 2.0,
    "-70 dBm monitor should quantize below the visible Mock Tx carrier floor instead of dithering into ghosts, quantized floor {low_floor_dbm:.2} dBm, got {low_dbm:.2} dBm"
  );
  assert!(
    high_dbm > low_dbm + 35.0,
    "monitor amplitude should track requested power: high={high_dbm:.2} dBm, low={low_dbm:.2} dBm"
  );
}

#[test]
#[serial]
fn mock_tx_monitor_apt_peak_matches_requested_display_power() {
  let model = TxIqPowerModel::default();
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(100_000, Ordering::Relaxed);
  let frame = synthesize_mock_tx_monitor_iq(
    8192,
    139_615_000.0,
    4_372_000,
    139_615_000.0,
    2_400_000.0,
    "apt",
    2048,
    -18.0,
    &model,
    &mut 0.0,
  );

  let center_dbm = iq_display_bin_dbm_at(&frame, 0.0, 4_372_000.0);

  assert!(
    (center_dbm - -18.0).abs() < 2.0,
    "Mock Tx monitor center peak should match requested display power, got {center_dbm:.2} dBm"
  );
}

#[test]
#[serial]
fn mock_tx_monitor_has_no_discrete_offband_ghosts() {
  let model = TxIqPowerModel::default();
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(100_000, Ordering::Relaxed);
  let frame = synthesize_mock_tx_monitor_iq(
    8192,
    139_615_000.0,
    4_372_000,
    139_615_000.0,
    2_400_000.0,
    "apt",
    2048,
    -18.0,
    &model,
    &mut 0.0,
  );

  let max_upper = max_iq_display_dbm_between(
    &frame,
    1_260_000.0,
    2_100_000.0,
    25_000.0,
    4_372_000.0,
  );
  let max_lower = max_iq_display_dbm_between(
    &frame,
    -2_100_000.0,
    -1_260_000.0,
    25_000.0,
    4_372_000.0,
  );
  let max_offband = max_upper.max(max_lower);

  assert!(
    max_offband < -70.0,
    "Mock Tx monitor should not create discrete off-band ghost carriers, max off-band {max_offband:.2} dBm"
  );
}

#[test]
fn tx_power_resolution_uses_explicit_power_before_vga_amp_mapping() {
  assert_eq!(
    resolve_effective_tx_power_dbm(Some(-18.0), Some(47.0), Some(true)),
    Some(-18.0)
  );
}

#[test]
fn tx_power_resolution_falls_back_to_vga_amp_mapping() {
  let resolved =
    resolve_effective_tx_power_dbm(None, Some(25.0), Some(true)).unwrap();
  let expected = crate::safety::get_approx_output_power(25.0, true);
  assert!(
    (resolved - expected).abs() < 1e-6,
    "expected VGA/AMP-derived power {expected}, got {resolved}"
  );
}

#[test]
fn mock_tx_iq_power_model_calibration_controls_dbm_to_rms() {
  let model = TxIqPowerModel {
    calibration_db: 24.0,
    ..Default::default()
  };

  let target = mock_tx_monitor_target_rms_from_dbm(-18.0, &model);
  let expected = 10.0f64.powf((-18.0 - 24.0) / 20.0);

  assert!(
    (target - expected).abs() < 1e-12,
    "configured calibration should drive dBm to RMS conversion: target={target}, expected={expected}"
  );
}

#[test]
#[serial]
fn mock_tx_monitor_live_frames_are_non_empty_and_change() {
  let model = TxIqPowerModel::default();
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(100_000, Ordering::Relaxed);
  let mut phase = 0.0;
  let first = synthesize_mock_tx_monitor_iq(
    4096,
    137_100_000.0,
    3_200_000,
    137_100_000.0,
    2_400_000.0,
    "apt",
    4096,
    -18.0,
    &model,
    &mut phase,
  );
  let second = synthesize_mock_tx_monitor_iq(
    4096,
    137_100_000.0,
    3_200_000,
    137_100_000.0,
    2_400_000.0,
    "apt",
    4096,
    -18.0,
    &model,
    &mut phase,
  );

  assert_eq!(first.len(), 8192);
  assert_eq!(second.len(), 8192);
  assert!(
    first.iter().any(|byte| *byte != 128)
      && second.iter().any(|byte| *byte != 128),
    "active transmit monitor frames should contain quantized I/Q energy"
  );
  assert_ne!(
    first, second,
    "active transmit monitor frames should advance instead of replaying a static preview"
  );
}

#[test]
#[serial]
fn mock_tx_monitor_apt_does_not_pulse_to_flatline() {
  let model = TxIqPowerModel::default();
  let mut phase = 0.0;
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(0, Ordering::Relaxed);
  let early_frame = synthesize_mock_tx_monitor_iq(
    4096,
    137_100_000.0,
    3_200_000,
    137_100_000.0,
    2_400_000.0,
    "apt",
    4096,
    -18.0,
    &model,
    &mut phase,
  );
  phase = 0.0;
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(800_000, Ordering::Relaxed);
  let later_frame = synthesize_mock_tx_monitor_iq(
    4096,
    137_100_000.0,
    3_200_000,
    137_100_000.0,
    2_400_000.0,
    "apt",
    4096,
    -18.0,
    &model,
    &mut phase,
  );

  let early_rms = frame_complex_rms(&early_frame);
  let later_rms = frame_complex_rms(&later_frame);
  let ratio = early_rms.min(later_rms) / early_rms.max(later_rms).max(1e-12);

  assert!(
    ratio > 0.4,
    "Mock Tx APT monitor should not pulse into a near-flat frame: early={early_rms:.6}, later={later_rms:.6}, ratio={ratio:.3}"
  );
}

fn iq_power_at(frame: &[u8], rel_hz: f64, sample_rate_hz: f64) -> f64 {
  let mut acc_i = 0.0;
  let mut acc_q = 0.0;
  for (index, sample) in frame.chunks_exact(2).enumerate() {
    let i = (sample[0] as f64 - 128.0) / 127.0;
    let q = (sample[1] as f64 - 128.0) / 127.0;
    let phase =
      -2.0 * std::f64::consts::PI * rel_hz * index as f64 / sample_rate_hz;
    let (sin_phase, cos_phase) = phase.sin_cos();
    acc_i += i * cos_phase - q * sin_phase;
    acc_q += i * sin_phase + q * cos_phase;
  }
  acc_i * acc_i + acc_q * acc_q
}

fn frame_complex_rms(frame: &[u8]) -> f64 {
  let sample_count = frame.len() / 2;
  if sample_count == 0 {
    return 0.0;
  }
  let sum = frame
    .chunks_exact(2)
    .map(|sample| {
      let i = (sample[0] as f64 - 128.0) / 127.0;
      let q = (sample[1] as f64 - 128.0) / 127.0;
      i * i + q * q
    })
    .sum::<f64>();
  (sum / sample_count as f64).sqrt()
}

fn iq_display_bin_dbm_at(
  frame: &[u8],
  rel_hz: f64,
  sample_rate_hz: f64,
) -> f64 {
  let sample_count = frame.len() / 2;
  if sample_count == 0 {
    return -150.0;
  }
  let mut acc_i = 0.0;
  let mut acc_q = 0.0;
  for (index, sample) in frame.chunks_exact(2).enumerate() {
    let i = (sample[0] as f64 - 128.0) / 128.0;
    let q = (sample[1] as f64 - 128.0) / 128.0;
    let phase =
      -2.0 * std::f64::consts::PI * rel_hz * index as f64 / sample_rate_hz;
    let (sin_phase, cos_phase) = phase.sin_cos();
    acc_i += i * cos_phase - q * sin_phase;
    acc_q += i * sin_phase + q * cos_phase;
  }
  let normalized_power =
    (acc_i * acc_i + acc_q * acc_q) / (sample_count * sample_count) as f64;
  10.0 * normalized_power.max(1e-15).log10()
    + TxIqPowerModel::default().calibration_db
}

fn max_iq_display_dbm_between(
  frame: &[u8],
  min_rel_hz: f64,
  max_rel_hz: f64,
  step_hz: f64,
  sample_rate_hz: f64,
) -> f64 {
  let mut rel_hz = min_rel_hz;
  let mut max_dbm = -150.0;
  while rel_hz <= max_rel_hz {
    let dbm = iq_display_bin_dbm_at(frame, rel_hz, sample_rate_hz);
    if dbm > max_dbm {
      max_dbm = dbm;
    }
    rel_hz += step_hz.max(1.0);
  }
  max_dbm
}

fn max_iq_power_between(
  frame: &[u8],
  min_rel_hz: f64,
  max_rel_hz: f64,
  step_hz: f64,
  sample_rate_hz: f64,
) -> f64 {
  let mut rel_hz = min_rel_hz;
  let mut max_power = 0.0;
  while rel_hz <= max_rel_hz {
    let power = iq_power_at(frame, rel_hz, sample_rate_hz);
    if power > max_power {
      max_power = power;
    }
    rel_hz += step_hz.max(1.0);
  }
  max_power
}

#[test]
#[serial]
fn mock_tx_monitor_centers_active_signal_on_requested_tx_center() {
  let model = TxIqPowerModel::default();
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(100_000, Ordering::Relaxed);
  let frame = synthesize_mock_tx_monitor_iq(
    4096,
    2_204_000.0,
    2_400_000,
    2_204_000.0,
    2_400_000.0,
    "apt",
    4096,
    -18.0,
    &model,
    &mut 0.0,
  );

  let center_power = iq_power_at(&frame, 0.0, 2_400_000.0);
  let preset_offset_power = iq_power_at(&frame, 25_000.0, 2_400_000.0);

  assert!(
    center_power > preset_offset_power * 4.0,
    "active Tx should center on requested slider frequency: center={center_power}, offset={preset_offset_power}"
  );
}

#[test]
#[serial]
fn mock_tx_monitor_keeps_modulation_inside_requested_tx_bandwidth() {
  let model = TxIqPowerModel::default();
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(100_000, Ordering::Relaxed);
  let frame = synthesize_mock_tx_monitor_iq(
    4096,
    2_204_000.0,
    2_400_000,
    2_204_000.0,
    10_000.0,
    "tone",
    4096,
    -18.0,
    &model,
    &mut 0.0,
  );

  let inside_power =
    max_iq_power_between(&frame, -4_000.0, 4_000.0, 500.0, 2_400_000.0);
  let outside_power =
    max_iq_power_between(&frame, 8_000.0, 20_000.0, 500.0, 2_400_000.0).max(
      max_iq_power_between(&frame, -20_000.0, -8_000.0, 500.0, 2_400_000.0),
    );

  assert!(
    inside_power > outside_power * 4.0,
    "active Tx modulation should stay inside requested bandwidth: inside={inside_power}, outside={outside_power}"
  );
}

#[test]
#[serial]
fn mock_tx_monitor_synthesis_is_lightweight_for_realtime_streaming() {
  let model = TxIqPowerModel::default();
  MOCK_TX_MONITOR_SAMPLE_CURSOR.store(100_000, Ordering::Relaxed);
  let started_at = std::time::Instant::now();
  let mut phase = 0.0;

  for _ in 0..120 {
    let frame = synthesize_mock_tx_monitor_iq(
      4096,
      2_204_000.0,
      2_400_000,
      2_204_000.0,
      760_000.0,
      "apt",
      4096,
      -18.0,
      &model,
      &mut phase,
    );
    assert_eq!(frame.len(), 8192);
  }

  let elapsed = started_at.elapsed();
  assert!(
    elapsed < Duration::from_millis(400),
    "Mock Tx monitor synthesis is too slow for realtime streaming: {elapsed:?}"
  );
}

#[test]
#[serial]
fn source_info_snapshot_hides_disabled_mock_tx_device() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  let original_dir = std::env::current_dir().expect("current dir");
  let unique = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .expect("time")
    .as_nanos();
  let temp_dir =
    std::env::temp_dir().join(format!("napt-mock-tx-disabled-{}", unique));
  std::fs::create_dir_all(&temp_dir).expect("create temp dir");
  let manifest_signals =
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("signals.yaml");
  let mut yaml =
    std::fs::read_to_string(manifest_signals).expect("read signals.yaml");
  yaml = yaml.replace(
    "mock_tx:\n    enabled: true",
    "mock_tx:\n    enabled: false",
  );
  std::fs::write(temp_dir.join("signals.yaml"), yaml)
    .expect("write temp signals.yaml");
  std::env::set_current_dir(&temp_dir).expect("set temp dir");
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");

  let snapshot = build_source_info_snapshot(&shared);
  let sources = snapshot["sources"].as_array().expect("sources array");

  std::env::set_current_dir(original_dir).expect("restore dir");
  n_apt_backend::server::utils::clear_signals_config_cache();
  let _ = std::fs::remove_dir_all(&temp_dir);
  assert!(sources
    .iter()
    .all(|source| source["id"].as_str() != Some("mock-tx")));
}

#[test]
#[serial]
fn mock_tx_profile_becomes_active_tx_source() {
  let _guard = n_apt_backend::server::utils::cwd_lock()
    .lock()
    .expect("cwd lock");
  n_apt_backend::server::utils::clear_signals_config_cache();
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");
  shared.update_device_status(
    true,
    "Mock Tx SDR".to_string(),
    build_device_profile("mock_tx"),
  );
  shared.update_device_usb_strings(
    "mock-tx".to_string(),
    "N-APT".to_string(),
    "Mock Tx SDR".to_string(),
  );

  let snapshot = build_source_info_snapshot(&shared);
  let sources = snapshot["sources"].as_array().expect("sources array");

  assert_eq!(snapshot["active_source"], "mock-tx");
  assert!(sources
    .iter()
    .all(|source| source["id"].as_str() != Some("mock_tx-0")));
  let mock_apt = sources
    .iter()
    .find(|source| source["id"].as_str() == Some("mock-apt"))
    .expect("mock APT source should stay visible");
  assert_eq!(mock_apt["name"], "Mock APT SDR");
  assert_eq!(mock_apt["kind"], "mock_apt");
  assert_eq!(mock_apt["capability"], "mock");
  assert_eq!(mock_apt["status"], "connected");
  assert_eq!(mock_apt["stream_key"], "mock-apt");
  let active = sources
    .iter()
    .find(|source| source["id"].as_str() == Some("mock-tx"))
    .expect("active mock TX source");
  assert_eq!(active["kind"], "mock_tx");
  assert_eq!(active["capability"], "tx");
  assert_eq!(active["status"], "connected");
}

#[test]
#[serial]
fn stale_hackrf_snapshot_reconciles_to_mock_when_usb_is_gone() {
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  let shared = SharedState::new("redis://127.0.0.1:6379");

  shared.update_device_status(
    true,
    "Great Scott Gadgets HackRF - Freq: 100 Hz, Rate: 2000000 Hz".to_string(),
    DeviceProfile {
      kind: "hackrf_one".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      iq_format: Some(n_apt_backend::server::types::IqFormat::default()),
    },
  );

  let changed = reconcile_stale_device_snapshot(&shared);

  assert!(changed, "expected stale hackrf status to reconcile");
  assert!(!shared.device_connected.load(Ordering::Relaxed));
  assert_eq!(shared.device_state.lock().unwrap().as_str(), "disconnected");
  assert_eq!(shared.device_info.lock().unwrap().as_str(), "Mock APT SDR");
  assert_eq!(shared.device_profile.lock().unwrap().kind, "mock_apt");
  assert!(shared
    .device_backend_error
    .lock()
    .unwrap()
    .as_ref()
    .expect("expected disconnect advisory")
    .contains("HackRF One disconnected"));
}
