//! WebSocket server with SDR processor integration
//! Handles real-time spectrum data streaming to frontend clients

use anyhow::Result;
use log::{debug, info, warn};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use super::shared_state::SharedState;
use super::stream_manager::{
  StreamKey, StreamMode, StreamingSourceModeManager,
};
#[cfg(test)]
use super::stream_manager::{StreamOptions, TxStreamOptions};
use super::types::SpectrumData;
use crate::app::readiness::{ReadinessEvent, ReadinessState};
use crate::capture::session::{CaptureStartRequest, CaptureWorker};
use crate::devices::{DeviceHealthWorker, DeviceSupervisor};
use crate::sdr::processor::SdrProcessor;
use crate::streaming::acquisition_worker::{
  AcquisitionWorker, FramePublicationGate, ProcessedFrame,
};
use crate::streaming::analysis_worker::AnalysisWorker;
use crate::streaming::commands::{into_fast_path, FastPathCommand};
use crate::tx::monitor::{TxStatusRequest, TxWorker};

pub mod broadcasting;
pub mod complex_baseband;
pub(crate) mod source_lifecycle;
pub mod sources;
pub mod tx_suite;

#[cfg(test)]
use source_lifecycle::{
  prepare_selected_source_for_rx, should_cache_swapped_source,
  should_restore_warm_source, source_phase_on_select, warmable_source_ids,
};
#[cfg(test)]
use source_lifecycle::source_phase_on_switch_away;

// Re-export key symbols for tests and other modules
pub use broadcasting::{
  broadcast_active_source, broadcast_channels, broadcast_device_status,
  broadcast_signal_display_settings, broadcast_signals_defaults,
  broadcast_source_status, broadcast_source_status_for_id,
  build_channels_snapshot, reconcile_stale_device_snapshot,
};
pub use complex_baseband::{
  MOCK_TX_DISPLAY_NAME, MOCK_TX_MONITOR_SAMPLE_CURSOR,
};
pub use source_lifecycle::SourceLifecyclePhase;
pub use sources::{
  active_source_id, apply_stream_keys, build_device_profile,
  build_signals_defaults_snapshot, build_source_info_snapshot,
  enumerate_inventory_source_ids, open_device_for_source_id,
  resolve_source_selection, resolve_stream_key_source_id,
};

pub(crate) const MOCK_TX_SOURCE_ID: &str = "mock-tx";
// Active Tx Suite monitoring is presentation-latest and bounded downstream,
// so it can match a 60 Hz Rx view without accumulating stale monitor frames.
// Standby remains request-only through should_hold_mock_tx_standby_stream.
pub(crate) const TX_MONITOR_FRAME_INTERVAL: Duration =
  Duration::from_micros(16_667);

pub(crate) fn sync_shared_sample_rate(
  shared_state: &SharedState,
  processor: &SdrProcessor,
) {
  let sample_rate = processor.get_sample_rate();
  if sample_rate == 0 {
    return;
  }
  let device_kind = shared_state.device_profile.lock().unwrap().kind.clone();
  let mut settings = shared_state.sdr_settings.lock().unwrap();
  settings.sample_rate = sample_rate;
  settings.fft = crate::server::utils::resolve_fft_config(
    &device_kind,
    sample_rate,
    Some(settings.fft.default_size),
    Some(&settings),
  );
}

/// Cleanup invalidates the current device handle. Recovery must never leave a
/// cleaned processor in the live frame loop when reopening the selected
/// source fails, or the next read can call device FFI through a null handle.
pub(crate) fn fallback_to_mock_after_recovery_failure(
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  error_message: String,
) -> Result<()> {
  processor.swap_device(crate::sdr::SdrDeviceFactory::create_mock_device())?;
  sync_shared_sample_rate(shared_state, processor);
  shared_state.update_device_status(
    false,
    processor.get_device_info(),
    build_device_profile(processor.device_type()),
  );
  shared_state.set_active_source_pause_state("mock-apt", false);
  shared_state.set_device_backend_error(Some(error_message));
  broadcast_device_status(shared_state, broadcast_tx);
  Ok(())
}

/// The monitor payload is consumed by the browser's configured FFT. The Tx
/// IFFT size controls waveform construction, but must not determine how many
/// samples the frontend measures.
pub(crate) fn resolve_mock_tx_monitor_fft_size(
  frontend_fft_size: usize,
  _tx_ifft_size: usize,
) -> usize {
  frontend_fft_size.clamp(256, 262_144)
}

fn spawn_tx_monitor_stream(
  shared_state: Arc<SharedState>,
  spectrum_tx: broadcast::Sender<Arc<SpectrumData>>,
  stream_manager: StreamingSourceModeManager,
) -> tokio::task::JoinHandle<()> {
  crate::tx::monitor::spawn_monitor_stream(
    shared_state,
    spectrum_tx,
    stream_manager,
  )
}

fn should_delegate_tx_monitor(
  active_source_id: &str,
  tx_is_active: bool,
) -> bool {
  tx_is_active
    && (active_source_id == MOCK_TX_SOURCE_ID
      || active_source_id == "hackrf_one"
      || active_source_id.starts_with("hackrf_one-"))
}

pub(crate) fn should_run_tx_monitor(
  active_source_id: &str,
  tx_is_active: bool,
  managed_tx_stream: bool,
) -> bool {
  // Standby remains request-only. A managed subscription must not auto-start
  // continuous monitor playback; only an explicit transmitting state does.
  tx_is_active
    && (should_delegate_tx_monitor(active_source_id, true) || managed_tx_stream)
}

fn broadcast_source_switch_error(
  broadcast_tx: &broadcast::Sender<String>,
  source_id: &str,
  error: &anyhow::Error,
) {
  let payload = serde_json::json!({
    "type": "error",
    "source_id": source_id,
    "code": "source_switch_failed",
    "message": format!("Unable to activate {source_id}: {error}"),
  });
  let _ = broadcast_tx.send(payload.to_string());
}

#[cfg(test)]
fn should_stop_streaming(shared_state: &SharedState) -> bool {
  shared_state.shutdown.load(Ordering::Relaxed)
}

pub(crate) fn should_synthesize_mock_tx_monitor_frame(
  active_source_id: &str,
  _tx_is_active: bool,
  _requested_single_frame: bool,
) -> bool {
  active_source_id == MOCK_TX_SOURCE_ID
}

/// Classify the compatibility flag from the canonical frame owner.
///
/// `is_mock_apt` is a legacy v1 hint, not a general "is any mock device"
/// marker. Deriving it from the processor display name incorrectly labels
/// Mock Tx frames as Mock APT and makes v1/source-preview consumers reject the
/// current frame in favour of stale data.
pub(crate) fn frame_is_mock_apt(
  frame_source_id: &str,
  streaming_mock_tx_monitor: bool,
) -> bool {
  !streaming_mock_tx_monitor && frame_source_id == "mock-apt"
}

/// Publish only when both the produced frame and the active processor belong
/// to the same source and no newer source request is still warming up.
#[cfg(test)]
fn should_publish_frame_for_source_transition(
  frame_source_id: &str,
  active_source_id: &str,
  pending_source_id: Option<&str>,
) -> bool {
  FramePublicationGate::new(active_source_id, pending_source_id)
    .accepts(frame_source_id)
}

fn should_hold_mock_tx_standby_stream(
  active_source_id: &str,
  tx_is_active: bool,
  requested_single_frame: bool,
) -> bool {
  active_source_id == MOCK_TX_SOURCE_ID
    && !tx_is_active
    && !requested_single_frame
}

#[cfg(test)]
mod frame_ownership_tests {
  use super::{
    frame_is_mock_apt, should_publish_frame_for_active_source,
    should_publish_frame_for_source_transition,
  };

  #[test]
  fn drops_frames_produced_before_a_source_switch() {
    assert!(!should_publish_frame_for_active_source(
      "mock-apt", "mock-tx"
    ));
    assert!(should_publish_frame_for_active_source("mock-tx", "mock-tx"));
  }

  #[test]
  fn legacy_mock_flag_follows_frame_source_not_processor_name() {
    assert!(frame_is_mock_apt("mock-apt", false));
    assert!(!frame_is_mock_apt("mock-tx", false));
    assert!(!frame_is_mock_apt("mock-tx", true));
    assert!(!frame_is_mock_apt("rtl-sdr-0001", false));
  }

  #[test]
  fn pending_source_switch_is_a_publication_fence() {
    assert!(!should_publish_frame_for_source_transition(
      "mock-apt",
      "mock-apt",
      Some("mock-tx")
    ));
    assert!(!should_publish_frame_for_source_transition(
      "mock-apt",
      "mock-tx",
      Some("mock-tx")
    ));
    assert!(should_publish_frame_for_source_transition(
      "mock-tx",
      "mock-tx",
      Some("mock-tx")
    ));
    assert!(should_publish_frame_for_source_transition(
      "mock-tx", "mock-tx", None
    ));
  }
}

#[cfg(test)]
fn should_publish_frame_for_active_source(
  frame_source_id: &str,
  active_source_id: &str,
) -> bool {
  frame_source_id == active_source_id
}

pub(crate) fn should_apply_transmit_settings_to_receiver(
  is_mock_tx_device: bool,
  _active_kind: &str,
) -> bool {
  !is_mock_tx_device
}

pub(crate) fn is_async_sample_timeout_error(error: &anyhow::Error) -> bool {
  error.chain().any(|cause| {
    cause
      .to_string()
      .contains("Timeout waiting for async SDR samples")
  })
}

pub(crate) fn should_fallback_to_mock_on_early_read_error(
  streak: u32,
  supported_device_present: bool,
) -> bool {
  streak < super::shared_state::DISCONNECT_FAILURE_THRESHOLD
    && !supported_device_present
}

pub(crate) fn read_failure_state(current_state: &str) -> Option<&'static str> {
  match current_state {
    "loading" | "disconnected" => None,
    _ => Some("stale"),
  }
}

/// Decide whether a read error is already covered by a terminal transition.
///
/// A stale source has already crossed the liveness boundary. Further reader
/// errors belong to the stale/reconnect path and must not keep incrementing
/// the read-error streak while the USB supervisor waits for a fresh handle.
/// This prevents a plug-out/plug-in cycle from inheriting an exhausted streak.
pub(crate) fn should_ignore_read_error(
  current_state: &str,
  _error: &anyhow::Error,
) -> bool {
  current_state == "loading"
    || current_state == "disconnected"
    || current_state == "stale"
}

pub(crate) fn should_mark_read_error_stale(
  error: &anyhow::Error,
  streak: u32,
) -> bool {
  !is_async_sample_timeout_error(error)
    || streak >= super::shared_state::DISCONNECT_FAILURE_THRESHOLD
}

#[cfg(test)]
fn should_restart_real_device_reader_on_read_error(
  error: &anyhow::Error,
  streak: u32,
  _recovery_count: u32,
) -> bool {
  streak >= super::shared_state::DISCONNECT_FAILURE_THRESHOLD
    && is_async_sample_timeout_error(error)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReaderRecoveryAction {
  RestartReader,
  ReopenDevice,
  FallbackToMock,
}

pub(crate) fn resolve_reader_recovery_action(
  is_async_timeout: bool,
  reader_is_active: bool,
  streak: u32,
  supported_device_present: bool,
) -> ReaderRecoveryAction {
  if !supported_device_present {
    // Physical absence is terminal for the current reader. Do not restart a
    // detached async handle just because the timeout reached the threshold;
    // that path creates Stale and increments the error streak during a normal
    // unplug.
    ReaderRecoveryAction::FallbackToMock
  } else if is_async_timeout && !reader_is_active {
    // `initialize()` is safe to retry here: the RTL device refuses to start
    // another reader while cancellation is still unwinding, and succeeds on
    // the first recovery tick after the old reader has actually stopped.
    ReaderRecoveryAction::RestartReader
  } else if is_async_timeout
    && streak >= super::shared_state::DISCONNECT_FAILURE_THRESHOLD
  {
    ReaderRecoveryAction::RestartReader
  } else {
    ReaderRecoveryAction::ReopenDevice
  }
}

pub(crate) fn should_fallback_to_mock_on_threshold_read_error(
  error: &anyhow::Error,
  supported_device_present: bool,
) -> bool {
  !supported_device_present && !is_async_sample_timeout_error(error)
}

pub(crate) fn should_promote_fast_path_error_to_read_error(
  error: &anyhow::Error,
  supported_device_present: bool,
) -> bool {
  !supported_device_present && !is_async_sample_timeout_error(error)
}

#[cfg(test)]
#[derive(Default)]
struct SourceLifecycleModel {
  phases: HashMap<String, SourceLifecyclePhase>,
}

#[cfg(test)]
impl SourceLifecycleModel {
  fn select(&mut self, source_id: &str, is_warm: bool) -> SourceLifecyclePhase {
    let is_mock = source_id.starts_with("mock");
    let phase = source_phase_on_select(is_warm, is_mock);
    self.phases.insert(source_id.to_string(), phase);
    phase
  }

  fn first_frame(&mut self, source_id: &str) -> SourceLifecyclePhase {
    self
      .phases
      .insert(source_id.to_string(), SourceLifecyclePhase::Streaming);
    SourceLifecyclePhase::Streaming
  }

  fn switch_away(&mut self, source_id: &str) -> SourceLifecyclePhase {
    let phase = source_phase_on_switch_away(source_id);
    self.phases.insert(source_id.to_string(), phase);
    phase
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serial_test::serial;

  #[test]
  fn mock_tx_request_next_frame_uses_monitor_synthesis_when_not_transmitting() {
    assert!(should_synthesize_mock_tx_monitor_frame(
      "mock-tx", false, true
    ));
    assert!(should_synthesize_mock_tx_monitor_frame(
      "mock-tx", false, false
    ));
    assert!(!should_synthesize_mock_tx_monitor_frame(
      "mock-apt", false, true
    ));
  }

  #[test]
  fn mock_tx_standby_stream_waits_for_explicit_request() {
    assert!(should_hold_mock_tx_standby_stream("mock-tx", false, false));
    assert!(!should_hold_mock_tx_standby_stream("mock-tx", false, true));
    assert!(!should_hold_mock_tx_standby_stream("mock-tx", true, false));
    assert!(!should_hold_mock_tx_standby_stream(
      "mock-apt", false, false
    ));
  }

  #[test]
  fn mock_tx_monitor_uses_frontend_fft_size_not_tx_ifft_size() {
    assert_eq!(resolve_mock_tx_monitor_fft_size(65_536, 262_144), 65_536);
  }

  #[test]
  fn mock_tx_reload_and_reconnect_hold_standby_before_pause_state_arrives() {
    // Reload/reconnect starts with the legacy pause flag cleared. Mock Tx
    // must still hold the general processor loop so it cannot emit a frame
    // generated by the underlying Mock APT device.
    let reload_is_paused = false;
    let reconnect_is_paused = false;
    assert!(!reload_is_paused);
    assert!(!reconnect_is_paused);
    assert!(should_hold_mock_tx_standby_stream("mock-tx", false, false));
    assert!(should_hold_mock_tx_standby_stream("mock-tx", false, false));

    // An explicit request_next_frame remains the intentional exception.
    assert!(!should_hold_mock_tx_standby_stream("mock-tx", false, true));
  }

  #[test]
  fn active_mock_tx_monitor_targets_sixty_frames_per_second() {
    assert!(TX_MONITOR_FRAME_INTERVAL <= Duration::from_millis(17));
  }

  #[test]
  fn active_mock_tx_monitor_is_delegated_to_the_monitor_worker() {
    assert!(should_delegate_tx_monitor("mock-tx", true));
    assert!(!should_delegate_tx_monitor("mock-tx", false));
    assert!(!should_delegate_tx_monitor("mock-apt", true));
  }

  #[test]
  fn managed_tx_subscription_does_not_auto_start_standby_monitor() {
    // Standby is announcement + request-only preview. A managed subscription
    // alone must not invoke continuous Tx monitor playback.
    assert!(!should_run_tx_monitor("mock-tx", false, true));
    assert!(!should_run_tx_monitor("hackrf_one-test", false, true));
    assert!(!should_run_tx_monitor("mock-tx", false, false));
    assert!(!should_run_tx_monitor("mock-apt", false, true));
    assert!(should_run_tx_monitor("mock-tx", true, true));
    assert!(should_run_tx_monitor("mock-tx", true, false));
    assert!(should_run_tx_monitor("mock-apt", true, true));
  }

  #[test]
  fn active_hackrf_tx_monitor_is_delegated_to_the_monitor_worker() {
    assert!(should_delegate_tx_monitor("hackrf_one-test", true));
  }

  #[tokio::test]
  #[serial]
  async fn active_hackrf_tx_monitor_emits_fresh_iq_for_each_tick() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let _mock_tx_test_guard =
      complex_baseband::MOCK_TX_TEST_LOCK.lock().unwrap();
    let shared = SharedState::new("redis://127.0.0.1:6379");
    *shared.device_profile.lock().unwrap() = build_device_profile("hackrf_one");
    *shared.device_serial.lock().unwrap() = "test".to_string();
    let tx_iq = vec![128, 129, 127, 130, 126, 131];
    let (spectrum_tx, mut spectrum_rx) = broadcast::channel(8);
    let stream_manager =
      StreamingSourceModeManager::new(Duration::from_millis(250));
    stream_manager.set_tx_payload(
      StreamKey::new("hackrf_one-test", StreamMode::Tx),
      2_400_000,
      2_000_000,
      tx_iq.clone(),
    );
    crate::safety::TX_TRANSMITTING.store(true, Ordering::Relaxed);

    let monitor =
      spawn_tx_monitor_stream(shared.clone(), spectrum_tx, stream_manager);
    let first =
      tokio::time::timeout(Duration::from_secs(2), spectrum_rx.recv())
        .await
        .expect("first active HackRF Tx monitor frame should arrive")
        .expect("active HackRF Tx monitor channel should remain open");
    let second =
      tokio::time::timeout(Duration::from_secs(2), spectrum_rx.recv())
        .await
        .expect("second active HackRF Tx monitor frame should arrive")
        .expect("active HackRF Tx monitor channel should remain open");

    assert_eq!(first.source_id, "hackrf_one-test");
    assert_eq!(second.source_id, "hackrf_one-test");
    assert_ne!(first.sequence, second.sequence);
    assert_eq!(first.iq_data, tx_iq);
    assert_eq!(second.iq_data, first.iq_data);

    shared.shutdown.store(true, Ordering::Relaxed);
    monitor
      .await
      .expect("active HackRF Tx monitor should stop cleanly");
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
  }

  #[tokio::test]
  #[serial]
  async fn active_mock_tx_monitor_emits_fresh_iq_for_each_tick() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let _mock_tx_test_guard =
      complex_baseband::MOCK_TX_TEST_LOCK.lock().unwrap();
    let shared = SharedState::new("redis://127.0.0.1:6379");
    *shared.device_profile.lock().unwrap() = build_device_profile("mock_tx");
    let (spectrum_tx, mut spectrum_rx) = broadcast::channel(8);
    let stream_manager =
      StreamingSourceModeManager::new(Duration::from_millis(250));
    crate::safety::TX_TRANSMITTING.store(true, Ordering::Relaxed);
    shared.mock_tx_transmitting.store(true, Ordering::Relaxed);

    let monitor =
      spawn_tx_monitor_stream(shared.clone(), spectrum_tx, stream_manager);
    let first =
      tokio::time::timeout(Duration::from_secs(2), spectrum_rx.recv())
        .await
        .expect("first active Tx monitor frame should arrive")
        .expect("active Tx monitor channel should remain open");
    let second =
      tokio::time::timeout(Duration::from_secs(2), spectrum_rx.recv())
        .await
        .expect("second active Tx monitor frame should arrive")
        .expect("active Tx monitor channel should remain open");

    assert_eq!(first.source_id, MOCK_TX_SOURCE_ID);
    assert_eq!(second.source_id, MOCK_TX_SOURCE_ID);
    assert_ne!(first.iq_data, second.iq_data);

    shared.shutdown.store(true, Ordering::Relaxed);
    monitor
      .await
      .expect("active Tx monitor should stop cleanly");
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    shared.mock_tx_transmitting.store(false, Ordering::Relaxed);
  }

  #[tokio::test]
  #[serial]
  async fn managed_mock_tx_subscriber_does_not_auto_start_standby_frames() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let _mock_tx_test_guard =
      complex_baseband::MOCK_TX_TEST_LOCK.lock().unwrap();
    let shared = SharedState::new("redis://127.0.0.1:6379");
    *shared.device_profile.lock().unwrap() = build_device_profile("mock_tx");
    shared.mock_tx_transmitting.store(false, Ordering::Relaxed);
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);

    let (spectrum_tx, mut spectrum_rx) = broadcast::channel(8);
    let stream_manager =
      StreamingSourceModeManager::new(Duration::from_millis(250));
    let _subscription = stream_manager
      .subscribe(
        StreamKey::new(MOCK_TX_SOURCE_ID, StreamMode::Tx),
        StreamOptions::Tx(TxStreamOptions {
          center_frequency_hz: 2_400_000,
          sample_rate_hz: 2_000_000,
          bandwidth_hz: 2_000_000,
          signal: "wifi".to_string(),
          power_dbm: -18.0,
          ifft_size: 1024,
        }),
      )
      .expect("managed Tx subscription should open");

    let monitor =
      spawn_tx_monitor_stream(shared.clone(), spectrum_tx, stream_manager);
    assert!(
      tokio::time::timeout(Duration::from_millis(100), spectrum_rx.recv())
        .await
        .is_err(),
      "standby Tx subscriptions must wait for an explicit preview request"
    );

    shared.shutdown.store(true, Ordering::Relaxed);
    monitor
      .await
      .expect("standby Tx monitor should stop cleanly");
  }

  #[test]
  fn logical_mock_sources_are_not_overridden_by_warm_source_recovery() {
    assert!(!should_restore_warm_source(true, "mock-tx"));
    assert!(!should_restore_warm_source(true, "mock-apt"));
    assert!(!should_restore_warm_source(false, "mock-apt"));
    assert!(should_restore_warm_source(true, "rtl-sdr-v4"));
  }

  #[test]
  fn mock_tx_transmit_coordinates_do_not_retune_receiver() {
    assert!(!should_apply_transmit_settings_to_receiver(true, "mock_tx"));
    assert!(!should_apply_transmit_settings_to_receiver(
      true, "mock_apt"
    ));
    assert!(should_apply_transmit_settings_to_receiver(
      false,
      "hackrf_one"
    ));
  }

  #[test]
  fn shutdown_flag_stops_streaming() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
    let shared = SharedState::new("redis://127.0.0.1:6379");
    assert!(!should_stop_streaming(&shared));
    shared.shutdown.store(true, Ordering::Relaxed);
    assert!(should_stop_streaming(&shared));
  }

  #[test]
  fn selecting_a_source_opens_its_rx_gate_until_the_first_frame() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
    let shared = SharedState::new("redis://127.0.0.1:6379");
    shared.set_active_source_pause_state("hackrf-one", true);

    prepare_selected_source_for_rx(
      &shared,
      "hackrf-one",
      SourceLifecyclePhase::Loading,
    );

    assert!(!shared.is_source_paused("hackrf-one"));
    assert!(!shared.is_paused.load(Ordering::SeqCst));
    assert_eq!(&*shared.device_state.lock().unwrap(), "loading");
  }

  #[test]
  fn warm_source_pool_reuses_devices_in_stable_order() {
    let mut warm = HashMap::from([
      ("rtl-sdr-b".to_string(), 2),
      ("hackrf_one-a".to_string(), 1),
    ]);

    assert_eq!(
      source_lifecycle::take_next_warm_source(&mut warm),
      Some(("hackrf_one-a".to_string(), 1))
    );
    assert_eq!(
      source_lifecycle::take_next_warm_source(&mut warm),
      Some(("rtl-sdr-b".to_string(), 2))
    );
    assert!(source_lifecycle::take_next_warm_source(&mut warm).is_none());
  }

  #[test]
  fn warm_source_recovery_never_takes_an_inactive_peer() {
    let mut warm = HashMap::from([
      ("mock-tx".to_string(), 1),
      ("rtl-sdr-v4".to_string(), 2),
    ]);

    assert_eq!(
      source_lifecycle::take_warm_source_for_active(&mut warm, "rtl-sdr-v4",),
      Some(2)
    );
    assert!(warm.contains_key("mock-tx"));
    assert!(source_lifecycle::take_warm_source_for_active(
      &mut warm, "mock-apt",
    )
    .is_none());
  }

  #[test]
  fn mock_sources_remain_warm_across_bidirectional_switches() {
    assert!(should_cache_swapped_source("mock-apt"));
    assert!(should_cache_swapped_source("mock-tx"));
  }

  #[test]
  fn startup_warm_pool_includes_every_non_active_source() {
    let snapshot = serde_json::json!({
      "sources": [
        {"id": "rtl-sdr-a", "kind": "rtl-sdr"},
        {"id": "hackrf_one-b", "kind": "hackrf_one"},
        {"id": "mock-apt", "kind": "mock_apt"}
      ]
    });

    assert_eq!(
      warmable_source_ids(&snapshot, "rtl-sdr-a"),
      vec!["hackrf_one-b".to_string(), "mock-apt".to_string()]
    );
  }

  #[test]
  fn startup_warm_pool_prepares_the_inactive_mock_peer() {
    let snapshot = serde_json::json!({
      "sources": [
        {"id": "mock-apt", "kind": "mock_apt"},
        {"id": "mock-tx", "kind": "mock_tx"}
      ]
    });

    assert_eq!(
      warmable_source_ids(&snapshot, "mock-apt"),
      vec!["mock-tx".to_string()]
    );
  }

  #[test]
  fn hardware_sources_load_once_then_stream_across_repeated_warm_switches() {
    let mut lifecycle = SourceLifecycleModel::default();

    assert_eq!(
      lifecycle.select("rtl", false),
      SourceLifecyclePhase::Loading
    );
    assert_eq!(
      lifecycle.first_frame("rtl"),
      SourceLifecyclePhase::Streaming
    );
    assert_eq!(
      lifecycle.switch_away("rtl"),
      SourceLifecyclePhase::Connected
    );

    assert_eq!(
      lifecycle.select("hackrf", false),
      SourceLifecyclePhase::Loading
    );
    assert_eq!(
      lifecycle.first_frame("hackrf"),
      SourceLifecyclePhase::Streaming
    );
    assert_eq!(
      lifecycle.switch_away("hackrf"),
      SourceLifecyclePhase::Standby
    );

    for _ in 0..4 {
      assert_eq!(
        lifecycle.select("rtl", true),
        SourceLifecyclePhase::Streaming
      );
      assert_eq!(
        lifecycle.switch_away("rtl"),
        SourceLifecyclePhase::Connected
      );
      assert_eq!(
        lifecycle.select("hackrf", true),
        SourceLifecyclePhase::Streaming
      );
      assert_eq!(
        lifecycle.switch_away("hackrf"),
        SourceLifecyclePhase::Standby
      );
    }
  }

  #[test]
  fn read_failure_marks_a_connected_reader_stale_not_disconnected() {
    assert_eq!(read_failure_state("connected"), Some("stale"));
    assert_eq!(read_failure_state("stale"), Some("stale"));
    assert_eq!(read_failure_state("disconnected"), None);
  }

  #[test]
  fn transient_async_timeout_does_not_mark_device_stale_or_stop_recovery() {
    let error = anyhow::anyhow!("Timeout waiting for async SDR samples");

    assert!(should_ignore_read_error("stale", &error));
    assert!(!should_mark_read_error_stale(
      &error,
      super::super::shared_state::DISCONNECT_FAILURE_THRESHOLD - 1,
    ));
    assert!(should_mark_read_error_stale(
      &error,
      super::super::shared_state::DISCONNECT_FAILURE_THRESHOLD,
    ));
  }

  #[test]
  fn non_timeout_errors_keep_the_existing_stale_guard() {
    let error = anyhow::anyhow!("Async reader thread disconnected");

    assert!(should_ignore_read_error("stale", &error));
    assert!(should_mark_read_error_stale(&error, 1));
  }

  #[test]
  fn async_sample_timeout_with_confirmed_usb_absence_falls_back_early() {
    assert!(should_fallback_to_mock_on_early_read_error(1, false));
  }

  #[test]
  fn non_timeout_read_error_without_usb_still_forces_early_mock_fallback() {
    assert!(should_fallback_to_mock_on_early_read_error(1, false));
  }

  #[test]
  fn async_sample_timeout_at_threshold_restarts_real_reader() {
    let error = anyhow::anyhow!("Timeout waiting for async SDR samples");

    assert!(should_restart_real_device_reader_on_read_error(
      &error,
      super::super::shared_state::DISCONNECT_FAILURE_THRESHOLD,
      0
    ));
    assert!(should_restart_real_device_reader_on_read_error(
      &error,
      super::super::shared_state::DISCONNECT_FAILURE_THRESHOLD,
      super::super::shared_state::MAX_RECOVERY_ATTEMPTS,
    ));
  }

  #[test]
  fn repeated_rtl_timeouts_restart_the_reader_without_reopening_usb() {
    let threshold = super::super::shared_state::DISCONNECT_FAILURE_THRESHOLD;
    let mut actions = Vec::new();
    for streak in threshold..threshold + 3 {
      actions.push(resolve_reader_recovery_action(true, true, streak, true));
    }

    assert_eq!(
      actions,
      vec![
        ReaderRecoveryAction::RestartReader,
        ReaderRecoveryAction::RestartReader,
        ReaderRecoveryAction::RestartReader,
      ]
    );
    assert_eq!(
      resolve_reader_recovery_action(false, true, threshold, true),
      ReaderRecoveryAction::ReopenDevice
    );
    assert_eq!(
      resolve_reader_recovery_action(false, true, threshold, false),
      ReaderRecoveryAction::FallbackToMock
    );
    assert_eq!(
      resolve_reader_recovery_action(true, false, threshold, true),
      ReaderRecoveryAction::RestartReader
    );
    assert_eq!(
      resolve_reader_recovery_action(true, true, threshold, false),
      ReaderRecoveryAction::FallbackToMock
    );
  }

  #[test]
  fn async_sample_timeout_without_usb_does_not_force_threshold_mock_fallback() {
    let error = anyhow::anyhow!("Timeout waiting for async SDR samples");

    assert!(!should_fallback_to_mock_on_threshold_read_error(
      &error, false
    ));
  }

  #[test]
  fn fast_path_hardware_error_without_usb_enters_disconnect_recovery() {
    let error = anyhow::anyhow!("Failed to set baseband bandwidth to 4372000");

    assert!(should_promote_fast_path_error_to_read_error(&error, false));
    assert!(!should_promote_fast_path_error_to_read_error(&error, true));
  }
}

#[derive(Clone)]
pub struct WebSocketServer {
  device_supervisor: DeviceSupervisor,
  shared_state: Arc<SharedState>,
  broadcast_tx: broadcast::Sender<String>,
  spectrum_tx: broadcast::Sender<Arc<SpectrumData>>,
  stream_manager: StreamingSourceModeManager,
}

impl Default for WebSocketServer {
  fn default() -> Self {
    let redis_url = std::env::var("REDIS_URL")
      .unwrap_or_else(|_| "redis://127.0.0.1/".to_string());
    Self::new(&redis_url)
  }
}

impl WebSocketServer {
  pub fn new(redis_url: &str) -> Self {
    info!("Creating WebSocket server with SDR processor");
    #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
    crate::sdr::mock_apt::MockAptDevice::log_metal_backend_status_once();

    // Create only the lightweight placeholder. DeviceSupervisor performs
    // physical discovery after the listener and worker are running.
    let sdr_processor =
      SdrProcessor::new_mock_apt().expect("Failed to create SDR processor");

    // Create broadcast channel for WebSocket clients
    let (broadcast_tx, _) = broadcast::channel(1000);
    let (spectrum_tx, _) = broadcast::channel(1000);
    let stream_manager =
      StreamingSourceModeManager::new(Duration::from_millis(250));

    let shared = SharedState::new(redis_url);
    shared.set_readiness(ReadinessState::Starting);
    *shared.device_loading.lock().unwrap() = true;
    *shared.device_loading_reason.lock().unwrap() = Some("connect".to_string());
    *shared.device_state.lock().unwrap() = "initializing".to_string();

    Self {
      device_supervisor: DeviceSupervisor::new(sdr_processor),
      shared_state: shared,
      broadcast_tx,
      spectrum_tx,
      stream_manager,
    }
  }

  async fn initialize_hardware(&self) -> Result<()> {
    let shared = self.shared_state.clone();
    shared.set_readiness(
      shared
        .readiness_state()
        .transition(ReadinessEvent::HardwareInitializationStarted),
    );

    let used_mock_fallback = self.device_supervisor.initialize().await?;
    let processor_handle = self.device_supervisor.processor_handle();
    let processor = processor_handle.lock().await;

    info!(
      "SDR processor initialized with device: {}",
      processor.device_type()
    );
    shared.update_device_status(
      !processor.is_mock(),
      processor.get_device_info(),
      build_device_profile(processor.device_type()),
    );
    // Publish the rate the device actually accepted before clients build
    // their first managed-stream subscription. RTL-SDR, for example, clamps
    // a persisted 4.372 MHz request to its 3.2 MHz hardware limit; leaving
    // the requested value in shared state makes the browser immediately send
    // the invalid rate back through the acquisition worker.
    sync_shared_sample_rate(&shared, &processor);
    shared.update_device_usb_strings(
      processor.get_serial_number(),
      processor.get_manufacturer(),
      processor.get_product(),
    );
    if processor.device_type().to_ascii_lowercase().contains("rtl") {
      shared.cache_active_rtl_sdr(
        processor.get_serial_number(),
        processor.get_manufacturer(),
        processor.get_product(),
      );
    }
    shared.set_device_backend_error(processor.get_error());
    *shared.device_loading.lock().unwrap() = false;
    *shared.device_loading_reason.lock().unwrap() = None;
    let readiness_event = if used_mock_fallback || processor.is_mock() {
      ReadinessEvent::HardwareFailed
    } else {
      ReadinessEvent::HardwareReady
    };
    shared.set_readiness(shared.readiness_state().transition(readiness_event));
    Ok(())
  }

  pub async fn run(
    &self,
    cmd_rx: std::sync::mpsc::Receiver<crate::server::types::SdrCommand>,
  ) -> Result<()> {
    info!("Starting SDR data streaming thread");

    if let Err(error) = self.initialize_hardware().await {
      self.shared_state.set_readiness(
        self
          .shared_state
          .readiness_state()
          .transition(ReadinessEvent::HardwareFailed),
      );
      *self.shared_state.device_loading.lock().unwrap() = false;
      *self.shared_state.device_loading_reason.lock().unwrap() = None;
      *self.shared_state.device_state.lock().unwrap() = "error".to_string();
      self
        .shared_state
        .set_device_backend_error(Some(error.to_string()));
      return Err(error);
    }

    let sdr_processor = self.device_supervisor.processor_handle();
    let shared_state = self.shared_state.clone();
    let _broadcast_tx = self.broadcast_tx.clone();
    let acquisition_worker =
      AcquisitionWorker::new(sdr_processor.clone(), shared_state.clone());
    let analysis_worker =
      AnalysisWorker::new(sdr_processor.clone(), _broadcast_tx.clone());
    let capture_worker = CaptureWorker::new(
      sdr_processor.clone(),
      shared_state.clone(),
      _broadcast_tx.clone(),
    );
    let device_health_worker = DeviceHealthWorker::new(sdr_processor.clone());
    let spectrum_tx = self.spectrum_tx.clone();
    let stream_manager = self.stream_manager.clone();
    let tx_worker = TxWorker::new(
      sdr_processor.clone(),
      shared_state.clone(),
      _broadcast_tx.clone(),
      spectrum_tx.clone(),
      stream_manager.clone(),
    );

    let hotplug_monitor = crate::sdr::hotplug::HotplugMonitor::new()
      .expect("Failed to create hotplug monitor");
    let _ = hotplug_monitor.start();
    let mut hotplug_state = crate::sdr::hotplug::HotplugState::new();
    let mut target_fps: u32 = 30; // sensible default until first frame
    let mut allow_next_paused_frame = false;
    let tx_monitor_task = spawn_tx_monitor_stream(
      shared_state.clone(),
      spectrum_tx.clone(),
      stream_manager.clone(),
    );
    let mut warm_devices: HashMap<String, Box<dyn crate::sdr::SdrDevice>> =
      HashMap::new();

    // Hardware attach is owned by the device health worker before the
    // streaming loop begins. Inactive peers are opened lazily on selection so
    // one failed USB device cannot block the active source's first frame.
    device_health_worker
      .attach_startup(
        &hotplug_monitor,
        &mut hotplug_state,
        &shared_state,
        &_broadcast_tx,
      )
      .await;

    // Pre-open every connected peer into the warm pool so switching devices
    // never pays a cold USB open + full async-reader swap latency. Failures
    // are logged and skipped: a failed peer stays cold and is retried on
    // selection, without blocking the active source's stream.
    {
      let active_id = active_source_id(&shared_state);
      for source_id in enumerate_inventory_source_ids(&shared_state) {
        if source_id == active_id || warm_devices.contains_key(&source_id) {
          continue;
        }
        match open_device_for_source_id(&shared_state, &source_id) {
          Ok(device) => {
            info!("Warming source {} for instant switching", source_id);
            warm_devices.insert(source_id, device);
          }
          Err(error) => {
            warn!(
              "Skipping warm-open of source {} (will open cold on selection): {}",
              source_id, error
            );
          }
        }
      }
    }

    loop {
      if shared_state.shutdown.load(Ordering::Relaxed) {
        info!("Shutdown flag observed, stopping SDR streaming thread");
        break;
      }
      let start_time = Instant::now();
      // 1. Process pending commands
      //
      // "Fast" settings (FFT size, gain, PPM, AGC) are routed through
      // `shared_state.pending_fast_settings` so they can be applied inside
      // the blocking frame loop WITHOUT waiting for the processor lock.
      // Only commands that need broadcast_tx / shared_state interaction
      // (StartCapture, transmit, and analysis commands) remain here.
      while let Ok(cmd) = cmd_rx.try_recv() {
        let cmd = match into_fast_path(cmd) {
          Ok(FastPathCommand::ApplySettings(settings)) => {
            shared_state
              .pending_fast_settings
              .lock()
              .unwrap()
              .push(settings);
            continue;
          }
          Ok(FastPathCommand::SetFrequency(frequency)) => {
            shared_state.request_center_frequency(frequency);
            continue;
          }
          Err(command) => command,
        };
        let cmd = match analysis_worker.try_handle(cmd).await {
          Ok(()) => continue,
          Err(command) => command,
        };
        match cmd {
          crate::server::types::SdrCommand::RequestNextFrame => {
            match tx_worker.try_publish_standby_preview() {
              crate::tx::monitor::StandbyPreviewOutcome::Published => {
                allow_next_paused_frame = false;
              }
              crate::tx::monitor::StandbyPreviewOutcome::NoRequest => {
                allow_next_paused_frame = true;
              }
            }
          }
          crate::server::types::SdrCommand::SetActiveSource {
            source_id,
            sample_rate,
          } => {
            let mut processor = sdr_processor.lock().await;
            source_lifecycle::activate_source(
              source_id,
              sample_rate,
              &mut processor,
              &shared_state,
              &_broadcast_tx,
              &spectrum_tx,
              &stream_manager,
              &mut warm_devices,
              &mut hotplug_state,
              &mut allow_next_paused_frame,
            )
            .await;
          }
          crate::server::types::SdrCommand::RestartDevice => {
            self
              .device_supervisor
              .restart(&shared_state, &_broadcast_tx, &mut hotplug_state)
              .await;
          }
          crate::server::types::SdrCommand::SetSimulatedHardwarePresence(
            present,
          ) => {
            let mut processor = sdr_processor.lock().await;
            if let Err(error) = crate::sdr::hotplug::simulate_hardware_presence(
              present,
              &mut hotplug_state,
              &mut processor,
              &shared_state,
              &_broadcast_tx,
            )
            .await
            {
              log::error!(
                "Simulated hardware transition failed (present={}): {}",
                present,
                error
              );
            }
          }
          crate::server::types::SdrCommand::StartCapture {
            job_id,
            fragments,
            bandwidth,
            bandwidth_center_frequency,
            duration_mode,
            duration_s,
            file_type,
            acquisition_mode,
            encrypted,
            fft_size,
            fft_window,
            geolocation,
            ref_based_demod_baseline,
            is_ephemeral,
            channels,
          } => {
            capture_worker
              .start(CaptureStartRequest {
                job_id,
                fragments,
                bandwidth,
                bandwidth_center_frequency,
                duration_mode,
                duration_s,
                file_type,
                acquisition_mode,
                encrypted,
                fft_size,
                fft_window,
                geolocation,
                ref_based_demod_baseline,
                is_ephemeral,
                channels,
              })
              .await;
          }
          crate::server::types::SdrCommand::StopCapture { job_id } => {
            capture_worker.stop(job_id.as_deref()).await;
          }
          crate::server::types::SdrCommand::SetPowerScale { scale } => {
            self.device_supervisor.set_power_scale(scale).await;
          }
          crate::server::types::SdrCommand::SetTransmitStatus {
            enabled,
            device,
            tx_signal,
            center_frequency_hz,
            sample_rate_hz,
            bandwidth_hz,
            tx_ifft_size,
            power_dbm,
            lna_gain_db,
            vga_gain_db,
            amp_enabled,
            tuner_agc,
            rtl_agc,
            ppm,
            ..
          } => {
            tx_worker
              .apply_status(TxStatusRequest {
                enabled,
                device,
                tx_signal,
                center_frequency_hz,
                sample_rate_hz,
                bandwidth_hz,
                tx_ifft_size,
                power_dbm,
                lna_gain_db,
                vga_gain_db,
                amp_enabled,
                tuner_agc,
                rtl_agc,
                ppm,
              })
              .await?;
          }
          _ => {
            warn!("Unhandled command: {:?}", cmd);
          }
        }
      }

      // 1b. Monitor device health and handle hot-plugging. The supervisor
      // owns this recovery policy so the websocket loop remains orchestration.
      device_health_worker
        .poll(
          &hotplug_monitor,
          &mut hotplug_state,
          &mut warm_devices,
          &shared_state,
          &_broadcast_tx,
          |processor| {
            if processor.capture_active {
              warn!("Stopping active capture due to device transition.");
              if let Some(result) = processor.stop_capture() {
                CaptureWorker::handle_stopped(
                  result,
                  &shared_state,
                  &_broadcast_tx,
                  Some("Capture stopped due to hardware transition"),
                );
              }
            }
            Ok(())
          },
        )
        .await;

      device_health_worker.reload_channels(&shared_state, &_broadcast_tx);

      // If the stream is paused by the client, don't read from SDR or broadcast
      // unless the frontend explicitly requested one fresh frame.
      let active_source_for_pause = active_source_id(&shared_state);
      if shared_state
        .pending_source_switch()
        .as_deref()
        .is_some_and(|pending| pending != active_source_for_pause)
      {
        // A queued handoff owns the stream boundary. Do not start another
        // read from the old processor while the swap command is waiting.
        tokio::time::sleep(Duration::from_millis(5)).await;
        continue;
      }
      let requested_single_frame = allow_next_paused_frame;
      let tx_is_active_for_gate =
        crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed);
      if should_delegate_tx_monitor(
        &active_source_for_pause,
        tx_is_active_for_gate,
      ) {
        // The dedicated Tx monitor worker owns active Mock Tx and HackRF
        // frames. Avoid blocking it with the general SDR read/process loop.
        tokio::time::sleep(Duration::from_millis(20)).await;
        continue;
      }
      let should_stream_while_tx_active =
        matches!(active_source_for_pause.as_str(), "mock-tx" | "mock-apt")
          && tx_is_active_for_gate;
      if should_hold_mock_tx_standby_stream(
        &active_source_for_pause,
        tx_is_active_for_gate,
        requested_single_frame,
      ) {
        tokio::time::sleep(Duration::from_millis(100)).await;
        continue;
      }
      if shared_state.is_paused.load(Ordering::SeqCst)
        && !requested_single_frame
        && !should_stream_while_tx_active
      {
        tokio::select! {
          _ = tokio::time::sleep(Duration::from_millis(100)) => {},
          _ = shared_state.pending_center_freq_notify.notified() => {},
        }
        continue;
      }
      allow_next_paused_frame = false;

      // 2. Read and process one frame from SDR
      // Capture ownership before entering the blocking read. A source switch
      // may commit while this frame is being produced; such a frame must be
      // discarded rather than relabeled with the new source.
      let frame_source_id = active_source_id(&shared_state);
      let process_result = acquisition_worker
        .read_and_process(frame_source_id.clone(), requested_single_frame)
        .await;

      match process_result {
        Ok(ProcessedFrame {
          source_id: frame_source_id,
          waveform: _waveform,
          timestamp,
          center_frequency,
          is_mock_apt,
          device_type: device_type_str,
          power_scale,
          sample_rate,
          raw_iq,
          target_fps: fps,
        }) => {
          target_fps = fps;
          // Successful read — clear any failure streak and confirm
          // recovery if we were in "loading" state from a recovery attempt.
          // The legacy frame bit identifies Mock APT only. Recovery and
          // health bookkeeping must instead follow source identity so Mock
          // Tx does not get treated as a hardware reader (or vice versa).
          if !frame_source_id.starts_with("mock-") {
            let had_successful_read =
              shared_state.last_successful_read.lock().unwrap().is_some();
            shared_state.record_successful_read();
            let current_state =
              shared_state.device_state.lock().unwrap().clone();
            if current_state == "disconnected"
              || current_state == "loading"
              || current_state == "stale"
            {
              info!("First successful frame after recovery — confirming connected state");
              shared_state.update_device_status(
                true,
                device_type_str.clone(),
                build_device_profile(device_type_str.as_str()),
              );
              let device_backend_error = {
                let processor = sdr_processor.lock().await;
                processor.get_error()
              };
              shared_state.set_device_backend_error(device_backend_error);
              broadcast_device_status(&shared_state, &_broadcast_tx);
            } else if !had_successful_read {
              // `update_device_status` marks hardware as connected before
              // acquisition proves that samples are flowing. Publish the
              // first successful frame transition so clients can leave their
              // explicit Loading state without waiting for another status
              // event or a play/pause round trip.
              broadcast_device_status(&shared_state, &_broadcast_tx);
            }
          }

          if raw_iq.is_empty() {
            warn!("Raw I/Q data is empty in live stream - this may cause data stream freeze");
          }

          let publication_gate = FramePublicationGate::new(
            &active_source_id(&shared_state),
            shared_state.pending_source_switch().as_deref(),
          );
          if !publication_gate.accepts(&frame_source_id) {
            debug!(
              "Dropping frame produced for stale source: frame_source={}, active_source={}",
              frame_source_id,
              active_source_id(&shared_state),
            );
            continue;
          }

          let (stream_epoch, sequence) =
            shared_state.next_stream_frame_identity();
          let tx_is_active_for_frame =
            crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed);
          let is_mock_tx_standby_preview =
            frame_source_id == MOCK_TX_SOURCE_ID && !tx_is_active_for_frame;
          let spectrum_message = SpectrumData {
            message_type: "spectrum".to_string(),
            waveform: Vec::new(),
            is_mock_apt,
            source_id: frame_source_id.clone(),
            stream_epoch,
            sequence,
            center_frequency_hz: Some(center_frequency),
            waveform_span_hz: None,
            timestamp,
            data_type: Some("iq_raw".to_string()),
            sample_rate: Some(sample_rate),
            power_scale: Some(power_scale),
            iq_data: raw_iq,
            // Untagged Mock Tx standby frames land in the RX presentation slot
            // while the UI reads TX mode — leaving a black STANDBY canvas.
            is_tx_preview: is_mock_tx_standby_preview.then_some(true),
          };

          let publish_key = StreamKey::new(
            frame_source_id.clone(),
            if is_mock_tx_standby_preview {
              StreamMode::Tx
            } else {
              StreamMode::Rx
            },
          );
          let _ = stream_manager.publish_iq_frame_with_metadata(
            &publish_key,
            timestamp,
            Some(center_frequency as u64),
            sample_rate,
            Arc::new(spectrum_message.iq_data.clone()),
          );

          // Broadcast to all connected WebSocket clients
          if let Err(_e) = spectrum_tx.send(Arc::new(spectrum_message)) {
            // No receivers, which is normal when no clients are connected
          }
        }
        Err(e) => {
          device_health_worker
            .handle_read_error(
              e,
              &mut hotplug_state,
              &shared_state,
              &_broadcast_tx,
            )
            .await;
        }
      }

      // 3. Check capture completion. Persistence runs in the capture worker so
      // file I/O cannot hold the acquisition/display loop.
      capture_worker.check_completion().await;

      // Maintain target frame rate
      let elapsed = start_time.elapsed();
      let target_duration =
        Duration::from_micros(1_000_000 / (target_fps as u64));
      if elapsed < target_duration {
        tokio::select! {
          _ = tokio::time::sleep(target_duration - elapsed) => {},
          _ = shared_state.pending_center_freq_notify.notified() => {},
        }
      }
    }

    tx_monitor_task.abort();
    let _ = tx_monitor_task.await;
    Ok(())
  }

  pub fn get_shared_state(&self) -> Arc<SharedState> {
    self.shared_state.clone()
  }

  pub fn get_sdr_processor(&self) -> Arc<Mutex<SdrProcessor>> {
    self.device_supervisor.processor_handle()
  }

  pub fn get_broadcast_tx(&self) -> broadcast::Sender<String> {
    self.broadcast_tx.clone()
  }

  pub fn get_spectrum_tx(&self) -> broadcast::Sender<Arc<SpectrumData>> {
    self.spectrum_tx.clone()
  }

  pub fn get_stream_manager(&self) -> StreamingSourceModeManager {
    self.stream_manager.clone()
  }
}
