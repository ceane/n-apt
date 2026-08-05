//! WebSocket server with SDR processor integration
//! Handles real-time spectrum data streaming to frontend clients

use anyhow::Result;
use log::{debug, error, info, warn};
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
use super::types::{PowerScale, SpectrumData};
use crate::sdr::processor::SdrProcessor;

pub mod broadcasting;
pub mod complex_baseband;
mod source_lifecycle;
pub mod sources;
pub mod tx_suite;

#[cfg(test)]
use source_lifecycle::warmable_source_ids;
use source_lifecycle::{
  prepare_selected_source_for_rx, prewarm_inactive_sources,
  should_cache_swapped_source, should_restore_warm_source,
  source_phase_on_select, take_warm_source_for_active,
};

// Re-export key symbols for tests and other modules
pub use broadcasting::{
  broadcast_active_source, broadcast_channels, broadcast_device_status,
  broadcast_signal_display_settings, broadcast_source_status,
  broadcast_source_status_for_id, build_channels_snapshot,
  reconcile_stale_device_snapshot,
};
pub use complex_baseband::{
  MOCK_TX_DISPLAY_NAME, MOCK_TX_MONITOR_SAMPLE_CURSOR,
};
pub use source_lifecycle::SourceLifecyclePhase;
pub use sources::{
  active_source_id, apply_stream_keys, build_device_profile,
  build_source_info_snapshot, open_device_for_source_id,
  resolve_source_selection, resolve_stream_key_source_id,
};

const MOCK_TX_SOURCE_ID: &str = "mock-tx";
// Active Tx Suite monitoring is presentation-latest and bounded downstream,
// so it can match a 60 Hz Rx view without accumulating stale monitor frames.
// Standby remains request-only through should_hold_mock_tx_standby_stream.
const TX_MONITOR_FRAME_INTERVAL: Duration = Duration::from_micros(16_667);

fn sync_shared_sample_rate(
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
fn fallback_to_mock_after_recovery_failure(
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
  tokio::spawn(async move {
    let mut ticker = tokio::time::interval(TX_MONITOR_FRAME_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
      ticker.tick().await;
      if shared_state.shutdown.load(Ordering::Relaxed) {
        break;
      }
      let tx_is_active = crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed);
      let active_source_id = active_source_id(&shared_state);
      let active_tx_key = StreamKey::new(active_source_id.clone(), StreamMode::Tx);
      let mock_tx_key = StreamKey::new(MOCK_TX_SOURCE_ID, StreamMode::Tx);
      let tx_key = if stream_manager.has_stream(&active_tx_key) {
        active_tx_key
      } else {
        mock_tx_key
      };
      let managed_tx_stream = stream_manager.has_stream(&tx_key);
      if !should_run_tx_monitor(
        &active_source_id,
        tx_is_active,
        managed_tx_stream,
      ) {
        continue;
      }
      let frame = if active_source_id == MOCK_TX_SOURCE_ID {
        let frame_state = shared_state.clone();
        match tokio::task::spawn_blocking(move || {
          crate::server::websocket_handlers::build_mock_tx_standby_preview_frame(
            &frame_state,
          )
        })
        .await
        {
          Ok(frame) => frame,
          Err(error) => {
            warn!("Mock Tx monitor worker failed: {error}");
            continue;
          }
        }
      } else {
        let Some(payload) = stream_manager.tx_payload(&tx_key) else {
          continue;
        };
        crate::server::websocket_handlers::build_tx_monitor_frame_from_iq(
          &shared_state,
          &active_source_id,
          payload.center_frequency_hz as f64,
          payload.sample_rate_hz,
          (*payload.iq_data).clone(),
          false,
        )
      };
      let _ = stream_manager.publish_iq_frame_with_metadata(
        &tx_key,
        frame.timestamp,
        frame.center_frequency_hz.map(|frequency| frequency as u64),
        frame.sample_rate.unwrap_or(1),
        Arc::new(frame.iq_data.clone()),
      );
      let _ = spectrum_tx.send(Arc::new(frame));
    }
  })
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

fn should_run_tx_monitor(
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

fn should_synthesize_mock_tx_monitor_frame(
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
fn frame_is_mock_apt(
  frame_source_id: &str,
  streaming_mock_tx_monitor: bool,
) -> bool {
  !streaming_mock_tx_monitor && frame_source_id == "mock-apt"
}

/// Publish only when both the produced frame and the active processor belong
/// to the same source and no newer source request is still warming up.
fn should_publish_frame_for_source_transition(
  frame_source_id: &str,
  active_source_id: &str,
  pending_source_id: Option<&str>,
) -> bool {
  should_publish_frame_for_active_source(frame_source_id, active_source_id)
    && pending_source_id
      .map(|pending| pending == active_source_id)
      .unwrap_or(true)
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

fn should_publish_frame_for_active_source(
  frame_source_id: &str,
  active_source_id: &str,
) -> bool {
  frame_source_id == active_source_id
}

fn should_apply_transmit_settings_to_receiver(
  is_mock_tx_device: bool,
  _active_kind: &str,
) -> bool {
  !is_mock_tx_device
}

fn is_async_sample_timeout_error(error: &anyhow::Error) -> bool {
  error.chain().any(|cause| {
    cause
      .to_string()
      .contains("Timeout waiting for async SDR samples")
  })
}

fn should_fallback_to_mock_on_early_read_error(
  error: &anyhow::Error,
  streak: u32,
  supported_device_present: bool,
) -> bool {
  streak < super::shared_state::DISCONNECT_FAILURE_THRESHOLD
    && !supported_device_present
    && !is_async_sample_timeout_error(error)
}

fn read_failure_state(current_state: &str) -> Option<&'static str> {
  match current_state {
    "loading" | "disconnected" => None,
    _ => Some("stale"),
  }
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
enum ReaderRecoveryAction {
  RestartReader,
  WaitForReaderShutdown,
  ReopenDevice,
  FallbackToMock,
}

fn resolve_reader_recovery_action(
  is_async_timeout: bool,
  reader_is_active: bool,
  streak: u32,
  supported_device_present: bool,
) -> ReaderRecoveryAction {
  if is_async_timeout && !reader_is_active {
    ReaderRecoveryAction::WaitForReaderShutdown
  } else if is_async_timeout
    && streak >= super::shared_state::DISCONNECT_FAILURE_THRESHOLD
  {
    ReaderRecoveryAction::RestartReader
  } else if supported_device_present {
    ReaderRecoveryAction::ReopenDevice
  } else {
    ReaderRecoveryAction::FallbackToMock
  }
}

fn should_fallback_to_mock_on_threshold_read_error(
  error: &anyhow::Error,
  supported_device_present: bool,
) -> bool {
  !supported_device_present && !is_async_sample_timeout_error(error)
}

fn should_promote_fast_path_error_to_read_error(
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
    self
      .phases
      .insert(source_id.to_string(), SourceLifecyclePhase::Standby);
    SourceLifecyclePhase::Standby
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
    assert_eq!(lifecycle.switch_away("rtl"), SourceLifecyclePhase::Standby);

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
      assert_eq!(lifecycle.switch_away("rtl"), SourceLifecyclePhase::Standby);
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
  fn async_sample_timeout_does_not_force_early_mock_fallback() {
    let error = anyhow::anyhow!("Timeout waiting for async SDR samples");

    assert!(!should_fallback_to_mock_on_early_read_error(
      &error, 1, false
    ));
  }

  #[test]
  fn non_timeout_read_error_without_usb_still_forces_early_mock_fallback() {
    let error = anyhow::anyhow!("USB read failed");

    assert!(should_fallback_to_mock_on_early_read_error(
      &error, 1, false
    ));
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
      ReaderRecoveryAction::WaitForReaderShutdown
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
  sdr_processor: Arc<Mutex<SdrProcessor>>,
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

    // Create SDR processor (will auto-select mock_apt or real device)
    let mut sdr_processor =
      SdrProcessor::new().expect("Failed to create SDR processor");

    // Initialize the processor
    if let Err(e) = sdr_processor.initialize() {
      warn!(
        "Failed to initialize SDR processor: {}, using mock APT mode",
        e
      );
      // Fallback to mock_apt mode
      sdr_processor = SdrProcessor::new_mock_apt()
        .expect("Failed to create mock APT SDR processor");
      sdr_processor
        .initialize()
        .expect("Failed to initialize mock APT SDR processor");
    }

    info!(
      "SDR processor initialized with device: {}",
      sdr_processor.device_type()
    );

    // Create broadcast channel for WebSocket clients
    let (broadcast_tx, _) = broadcast::channel(1000);
    let (spectrum_tx, _) = broadcast::channel(1000);
    let stream_manager =
      StreamingSourceModeManager::new(Duration::from_millis(250));

    let shared = SharedState::new(redis_url);
    // Sync initial state with SharedState
    shared.update_device_status(
      !sdr_processor.is_mock(),
      sdr_processor.get_device_info(),
      build_device_profile(sdr_processor.device_type()),
    );
    shared.update_device_usb_strings(
      sdr_processor.get_serial_number(),
      sdr_processor.get_manufacturer(),
      sdr_processor.get_product(),
    );
    shared.set_device_backend_error(sdr_processor.get_error());

    Self {
      sdr_processor: Arc::new(Mutex::new(sdr_processor)),
      shared_state: shared,
      broadcast_tx,
      spectrum_tx,
      stream_manager,
    }
  }

  pub async fn run(
    &self,
    cmd_rx: std::sync::mpsc::Receiver<crate::server::types::SdrCommand>,
  ) -> Result<()> {
    info!("Starting SDR data streaming thread");

    let sdr_processor = self.sdr_processor.clone();
    let shared_state = self.shared_state.clone();
    let _broadcast_tx = self.broadcast_tx.clone();
    let spectrum_tx = self.spectrum_tx.clone();
    let stream_manager = self.stream_manager.clone();

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

    // ── Channel hot-reload state ──────────────────────────────────────
    // Track the last known signals.yaml modification time so we can
    // detect changes to n_apt.channels and broadcast updated channel
    // definitions to all connected WebSocket clients automatically.
    let mut last_channels_check = Instant::now();
    let mut last_signals_modified =
      crate::server::utils::signals_config_modified_at();

    // Give hotplug a chance to attach immediately at startup instead of
    // waiting for the first health tick. This catches devices that are
    // already connected when the app launches.
    {
      let mut processor = sdr_processor.lock().await;
      // HackRF and libusb can take a moment to settle after process launch.
      // Give startup a short attach window so we don't miss a device that is
      // physically present but not immediately enumerable.
      for attempt in 0..5 {
        crate::sdr::hotplug::maybe_attach_hotplugged_device(
          &hotplug_monitor,
          &mut hotplug_state,
          &mut processor,
          &shared_state,
          &_broadcast_tx,
          true,
        )
        .await;
        if !processor.is_mock() {
          break;
        }
        if attempt < 4 {
          tokio::time::sleep(Duration::from_millis(250)).await;
        }
      }

      // Keep every other attached receiver open with its bounded RX reader
      // alive. Stopping RTL here and restarting it on selection recreates the
      // libusb interface-claim race that prewarming is meant to eliminate.
      prewarm_inactive_sources(&processor, &shared_state, &mut warm_devices);
      broadcast_device_status(&shared_state, &_broadcast_tx);
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
      // (RestartDevice, StartCapture, etc.) still acquire the lock here.
      while let Ok(cmd) = cmd_rx.try_recv() {
        match cmd {
          crate::server::types::SdrCommand::ApplySettings(settings) => {
            shared_state
              .pending_fast_settings
              .lock()
              .unwrap()
              .push(settings);
          }
          crate::server::types::SdrCommand::RequestNextFrame => {
            // Mock Tx standby is request-only. Publish exactly one preview and
            // do not also wake the general read loop — that produced a second
            // advancing frame and flashed the standby canvas.
            //
            // Fulfill when Mock Tx is active OR a Mock Tx preview is armed
            // before select_source commits (cold-start / early request).
            let active = active_source_id(&shared_state);
            let tx_is_active =
              crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed);
            let mock_tx_preview_armed = shared_state
              .paused_frame_request_for_source(MOCK_TX_SOURCE_ID)
              .is_some();
            if !tx_is_active
              && (mock_tx_preview_armed || active == MOCK_TX_SOURCE_ID)
            {
              let frame_state = shared_state.clone();
              let frame = crate::server::websocket_handlers::build_mock_tx_standby_preview_frame(
                &frame_state,
              );
              let tx_key =
                StreamKey::new(MOCK_TX_SOURCE_ID.to_string(), StreamMode::Tx);
              let _ = stream_manager.publish_iq_frame_with_metadata(
                &tx_key,
                frame.timestamp,
                frame.center_frequency_hz.map(|frequency| frequency as u64),
                frame.sample_rate.unwrap_or(1),
                Arc::new(frame.iq_data.clone()),
              );
              let _ = spectrum_tx.send(Arc::new(frame));
              shared_state.clear_paused_frame_request();
              allow_next_paused_frame = false;
            } else {
              allow_next_paused_frame = true;
            }
          }
          crate::server::types::SdrCommand::SetFrequency(freq) => {
            // Keep compatibility with internally queued commands while using
            // the same lock-free latest-value path as WebSocket retunes.
            shared_state.request_center_frequency(freq);
          }
          crate::server::types::SdrCommand::SetGain(gain) => {
            shared_state.pending_fast_settings.lock().unwrap().push(
              crate::server::types::SdrProcessorSettings {
                gain: Some(gain),
                ..Default::default()
              },
            );
          }
          crate::server::types::SdrCommand::SetPpm(ppm) => {
            shared_state.pending_fast_settings.lock().unwrap().push(
              crate::server::types::SdrProcessorSettings {
                ppm: Some(ppm),
                ..Default::default()
              },
            );
          }
          crate::server::types::SdrCommand::SetTunerAGC(enabled) => {
            shared_state.pending_fast_settings.lock().unwrap().push(
              crate::server::types::SdrProcessorSettings {
                tuner_agc: Some(enabled),
                ..Default::default()
              },
            );
          }
          crate::server::types::SdrCommand::SetRtlAGC(enabled) => {
            shared_state.pending_fast_settings.lock().unwrap().push(
              crate::server::types::SdrProcessorSettings {
                rtl_agc: Some(enabled),
                ..Default::default()
              },
            );
          }
          crate::server::types::SdrCommand::SetActiveSource {
            source_id,
            sample_rate,
          } => {
            info!("Dequeued source switch command: requested={}", source_id);
            let mut processor = sdr_processor.lock().await;
            let current_source_id = active_source_id(&shared_state);
            if current_source_id == source_id {
              debug!(
                "SetActiveSource requested for current source {}, skipping",
                source_id
              );
              shared_state.clear_pending_source_switch(&source_id);
              broadcast_device_status(&shared_state, &_broadcast_tx);
              continue;
            }

            info!("Switching active source to {}", source_id);
            let previous_source_is_transmitting = crate::safety::TX_TRANSMITTING
              .load(Ordering::Relaxed)
              || (current_source_id == "mock-tx"
                && shared_state.mock_tx_transmitting.load(Ordering::Relaxed));
            if !previous_source_is_transmitting {
              // Keep source pause state per device. The previous RX source
              // must not remain logically active after a handoff; a source
              // that is actively transmitting is the deliberate exception.
              shared_state.set_source_pause_state(&current_source_id, true);
            }
            let was_warm = warm_devices.contains_key(&source_id);
            let is_mock = source_id.starts_with("mock");
            let selection_phase = source_phase_on_select(was_warm, is_mock);
            if selection_phase == SourceLifecyclePhase::Loading {
              shared_state.set_device_state("loading", Some("connect"));
              broadcast_source_status_for_id(
                &shared_state,
                &_broadcast_tx,
                &source_id,
                "loading",
              );
            } else {
              // Loading transitions advance the epoch in `set_device_state`.
              // Warm and mock switches skip loading, so begin their handoff
              // explicitly. This guarantees exactly one epoch per switch.
              shared_state.begin_stream_epoch();
            }

            let next_device = match warm_devices.remove(&source_id) {
              // `swap_device_keep_warm` owns initialization. Initializing
              // here as well restarts an RTL async reader twice, leaving the
              // just-selected warm source in its loading state.
              Some(device) => {
                info!("Reusing warm SDR source {}", source_id);
                Ok(device)
              }
              None => open_device_for_source_id(&shared_state, &source_id),
            };

            match next_device {
              Ok(new_device) => {
                let mut swap_result = processor
                  .swap_device_keep_warm_with_sample_rate(
                    new_device,
                    sample_rate,
                  );
                if swap_result.is_err() && was_warm {
                  warn!(
                    "Warm SDR source {} did not resume; reopening once",
                    source_id
                  );
                  swap_result =
                    open_device_for_source_id(&shared_state, &source_id).and_then(|device| {
                      processor.swap_device_keep_warm_with_sample_rate(
                        device,
                        sample_rate,
                      )
                    });
                }

                match swap_result {
                  Err(e) => {
                    error!(
                      "Failed to swap SDR processor to source {}: {}",
                      source_id, e
                    );
                    shared_state.update_device_status(
                      !processor.is_mock(),
                      processor.get_device_info(),
                      build_device_profile(processor.device_type()),
                    );
                    shared_state.update_device_usb_strings(
                      processor.get_serial_number(),
                      processor.get_manufacturer(),
                      processor.get_product(),
                    );
                    shared_state
                      .set_device_backend_error(processor.get_error());
                    shared_state.clear_pending_source_switch(&source_id);
                    broadcast_source_switch_error(
                      &_broadcast_tx,
                      &source_id,
                      &e,
                    );
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                  }
                  Ok(mut previous_device) => {
                    sync_shared_sample_rate(&shared_state, &processor);
                    // Re-apply the last known center frequency if we have one, so we don't start at default and jump
                    let last_freq =
                      shared_state.pending_center_freq.load(Ordering::Relaxed);
                    if last_freq > 0 {
                      if let Err(e) = processor.set_center_frequency(last_freq)
                      {
                        warn!(
                          "Failed to apply last known frequency after swap: {}",
                          e
                        );
                      }
                    }

                    if should_cache_swapped_source(&current_source_id) {
                      if !previous_source_is_transmitting {
                        if let Err(e) = previous_device.enter_standby() {
                          warn!(
                            "Failed to pause previous source {} before caching: {}",
                            current_source_id, e
                          );
                        }
                      }
                      warm_devices
                        .insert(current_source_id.clone(), previous_device);
                    }
                    let next_device_profile = if source_id == "mock-tx" {
                      build_device_profile("mock_tx")
                    } else {
                      build_device_profile(processor.device_type())
                    };
                    let next_device_info = if source_id == "mock-tx" {
                      MOCK_TX_DISPLAY_NAME.to_string()
                    } else {
                      processor.get_device_info()
                    };
                    let next_device_connected =
                      source_id == "mock-tx" || !processor.is_mock();
                    shared_state.update_device_status(
                      next_device_connected,
                      next_device_info,
                      next_device_profile,
                    );
                    if source_id == "mock-tx" {
                      shared_state.update_device_usb_strings(
                        "mock-tx".to_string(),
                        "N-APT".to_string(),
                        MOCK_TX_DISPLAY_NAME.to_string(),
                      );
                    } else {
                      shared_state.update_device_usb_strings(
                        processor.get_serial_number(),
                        processor.get_manufacturer(),
                        processor.get_product(),
                      );
                    }
                    shared_state
                      .set_device_backend_error(processor.get_error());
                    // Recovery cooldowns belong to the source that failed;
                    // a successful handoff must not make the next source
                    // inherit the previous device's failure window.
                    hotplug_state.last_failure_at = None;
                    // Capture before pause-state sync. set_active_source_pause_state
                    // clears paused-frame tokens, which would drop a Mock Tx
                    // standby preview armed during the pending handoff.
                    let wake_standby_preview = shared_state
                      .paused_frame_request_for_source(&source_id)
                      .is_some();
                    if source_id == "mock-tx" || source_id == "mock-apt" {
                      shared_state
                        .set_active_source_pause_state(&source_id, false);
                    } else {
                      prepare_selected_source_for_rx(
                        &shared_state,
                        &source_id,
                        selection_phase,
                      );
                    }
                    info!(
                      "Source switch committed: requested={}, active={}, device_type={}, serial={}, rx_active={}",
                      source_id,
                      active_source_id(&shared_state),
                      processor.device_type(),
                      processor.get_serial_number(),
                      processor.is_rx_active(),
                    );
                    shared_state.clear_pending_source_switch(&source_id);
                    // A preview may have been armed during the pending handoff.
                    // Fulfill Mock Tx with exactly one published frame — never
                    // also wake the general read loop (that flashed progress).
                    if wake_standby_preview {
                      if source_id == MOCK_TX_SOURCE_ID {
                        let frame_state = shared_state.clone();
                        let frame = crate::server::websocket_handlers::build_mock_tx_standby_preview_frame(
                          &frame_state,
                        );
                        let tx_key = StreamKey::new(
                          MOCK_TX_SOURCE_ID.to_string(),
                          StreamMode::Tx,
                        );
                        let _ = stream_manager.publish_iq_frame_with_metadata(
                          &tx_key,
                          frame.timestamp,
                          frame
                            .center_frequency_hz
                            .map(|frequency| frequency as u64),
                          frame.sample_rate.unwrap_or(1),
                          Arc::new(frame.iq_data.clone()),
                        );
                        let _ = spectrum_tx.send(Arc::new(frame));
                        shared_state.clear_paused_frame_request();
                        allow_next_paused_frame = false;
                      } else {
                        shared_state.mark_paused_frame_requested(&source_id);
                        allow_next_paused_frame = true;
                      }
                    }
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                    hotplug_state.last_hardware_swap = Some(Instant::now());
                  }
                }
              }
              Err(e) => {
                error!(
                  "Failed to open source {} for switching: {}",
                  source_id, e
                );
                shared_state.update_device_status(
                  !processor.is_mock(),
                  processor.get_device_info(),
                  build_device_profile(processor.device_type()),
                );
                shared_state.update_device_usb_strings(
                  processor.get_serial_number(),
                  processor.get_manufacturer(),
                  processor.get_product(),
                );
                shared_state.set_device_backend_error(Some(format!(
                  "Failed to switch to source {}: {}",
                  source_id, e
                )));
                shared_state.clear_pending_source_switch(&source_id);
                warn!(
                  "Source switch open failed: requested={}, active remains={}, device_type={}, error={}",
                  source_id,
                  active_source_id(&shared_state),
                  processor.device_type(),
                  e,
                );
                broadcast_source_switch_error(&_broadcast_tx, &source_id, &e);
                broadcast_device_status(&shared_state, &_broadcast_tx);
              }
            }
          }
          crate::server::types::SdrCommand::RestartDevice => {
            let mut processor = sdr_processor.lock().await;
            info!("Processing RestartDevice command");
            // Immediately tell the frontend we're restarting
            shared_state.set_device_state("loading", Some("restart"));
            broadcast_device_status(&shared_state, &_broadcast_tx);

            let new_device_res = crate::sdr::SdrDeviceFactory::create_device();
            match new_device_res {
              Ok(new_device) => {
                if let Err(e) = processor.swap_device(new_device) {
                  error!("Failed to swap SDR processor device: {}", e);
                  // Revert to previous state so frontend doesn't hang
                  shared_state.update_device_status(
                    !processor.is_mock(),
                    processor.get_device_info(),
                    build_device_profile(processor.device_type()),
                  );
                  shared_state.update_device_usb_strings(
                    processor.get_serial_number(),
                    processor.get_manufacturer(),
                    processor.get_product(),
                  );
                  shared_state.set_device_backend_error(processor.get_error());
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                } else {
                  sync_shared_sample_rate(&shared_state, &processor);
                  // Re-apply the last known center frequency
                  let last_freq =
                    shared_state.pending_center_freq.load(Ordering::Relaxed);
                  if last_freq > 0 {
                    if let Err(e) = processor.set_center_frequency(last_freq) {
                      warn!("Failed to apply last known frequency after restart swap: {}", e);
                    }
                  }
                  shared_state.update_device_status(
                    !processor.is_mock(),
                    processor.get_device_info(),
                    build_device_profile(processor.device_type()),
                  );
                  shared_state.update_device_usb_strings(
                    processor.get_serial_number(),
                    processor.get_manufacturer(),
                    processor.get_product(),
                  );
                  shared_state.set_device_backend_error(processor.get_error());
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                  hotplug_state.last_hardware_swap = Some(Instant::now());
                }
              }
              Err(e) => {
                error!("Failed to create new device on restart: {}", e);
                // Try re-init of existing device
                if let Err(e) = processor.initialize() {
                  error!("Failed to restart existing device: {}", e);
                } else {
                  hotplug_state.last_hardware_swap = Some(Instant::now());
                }
                // Revert state regardless
                shared_state.update_device_status(
                  !processor.is_mock(),
                  processor.get_device_info(),
                  build_device_profile(processor.device_type()),
                );
                shared_state.update_device_usb_strings(
                  processor.get_serial_number(),
                  processor.get_manufacturer(),
                  processor.get_product(),
                );
                shared_state.set_device_backend_error(processor.get_error());
                let active_id = active_source_id(&shared_state);
                shared_state.sync_active_source_pause_state(&active_id);
                broadcast_device_status(&shared_state, &_broadcast_tx);
              }
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
            let mut processor = sdr_processor.lock().await;
            // Bind the channels payload to the processor for Patch B trimming
            processor.capture_requested_channels = channels;
            // fft_size is used by the SDR processor for FFT configuration
            info!("[CAPTURE] FFT size: {}", fft_size);
            // Save current center frequency so we can restore it after capture
            processor.capture_pre_center_freq =
              Some(processor.get_center_frequency());
            processor.capture_bandwidth = bandwidth;
            processor.capture_bandwidth_center_frequency =
              bandwidth_center_frequency;
            processor.capture_job_id = Some(job_id.clone());
            processor.capture_is_manual_mode = duration_mode == "manual";
            processor.capture_manual_stop = false;
            processor.capture_duration_s = duration_s;
            processor.capture_file_type = file_type;
            processor.capture_ref_based_demod_baseline =
              ref_based_demod_baseline;
            processor.capture_is_ephemeral = is_ephemeral;

            let mode_str = match acquisition_mode.as_str() {
              "stepwise" => "stepwise_naive".to_string(),
              "interleaved" => "interleaved".to_string(),
              _ => "whole_sample".to_string(), // Default to whole_sample
            };
            processor.capture_acquisition_mode = mode_str.clone();
            info!("[CAPTURE] acquisition_mode={}, fragments={}, hops will be computed next", mode_str, fragments.len());

            processor.capture_current_fragment = 0;
            processor.capture_last_hop = Some(std::time::Instant::now());
            processor.capture_encrypted = encrypted;
            processor.capture_start = Some(std::time::Instant::now());
            processor.capture_actual_frames = 0;
            // Apply and snapshot the FFT parameters requested for this capture.
            // This ensures the capture runs at the user-selected FFT size and window
            // even if the live stream was using different settings.
            let mut capture_settings =
              crate::server::types::SdrProcessorSettings::default();
            let mut settings_valid = false;

            if fft_size > 0 && (fft_size & (fft_size - 1)) == 0 {
              capture_settings.fft_size = Some(fft_size);
              settings_valid = true;
            }
            if !fft_window.is_empty() {
              capture_settings.fft_window = Some(fft_window.clone());
              settings_valid = true;
            }

            if settings_valid {
              if let Err(e) = processor.apply_settings(capture_settings) {
                log::warn!(
                  "[CAPTURE] Failed to apply requested FFT settings (size={}, window={}): {}",
                  fft_size,
                  fft_window,
                  e
                );
              } else {
                processor.flush_read_queue();
                processor.frame.avg_spectrum = None;
              }
            }
            processor.capture_fft_size =
              processor.fft_processor.config().fft_size;
            processor.capture_fft_window =
              processor.fft_processor.config().window_type.to_string();
            processor.capture_gain = processor.current_gain_db;
            processor.capture_ppm = processor.current_ppm;
            processor.capture_geolocation = geolocation;
            // AGC state is not tracked in config, default false for now
            processor.capture_tuner_agc = false;
            processor.capture_rtl_agc = false;

            let hw_sample_rate = processor.get_sample_rate() as f64;
            let hw_bw_hz = hw_sample_rate as f64;

            // Use only the center portion of the hardware bandwidth to avoid
            // the noisy/distorted edges of the RTL-SDR.
            const USABLE_BW_FRACTION: f64 = 0.75;
            let usable_bw_hz = hw_bw_hz * USABLE_BW_FRACTION;

            let mut all_hops: Vec<(f64, f64)> = Vec::new();
            let mut capture_channels: Vec<
              crate::sdr::processor::CaptureChannel,
            > = Vec::new();
            // Track the overall requested range for metadata
            let mut overall_min = f64::INFINITY;
            let mut overall_max = f64::NEG_INFINITY;

            for &(min_freq, max_freq) in &fragments {
              overall_min = overall_min.min(min_freq);
              overall_max = overall_max.max(max_freq);

              let span = max_freq - min_freq;
              if mode_str == "whole_sample" || span <= usable_bw_hz {
                // Small span or whole_sample mode: center the window on the requested range
                // But ensure we use the full HW bandwidth for the device tuning.
                let center = (min_freq + max_freq) / 2.0;
                let hop_start = center - hw_bw_hz / 2.0;
                all_hops.push((hop_start, hop_start + hw_bw_hz));
                capture_channels.push(crate::sdr::processor::CaptureChannel {
                  center_freq_hz: hop_start + (hw_sample_rate / 2.0),
                  sample_rate_hz: hw_sample_rate,
                  requested_min_freq_hz: Some(min_freq),
                  requested_max_freq_hz: Some(max_freq),
                  iq_data: Vec::new(),
                  spectrum_data: Vec::new(),
                  bins_per_frame: 0,
                  label: None,
                });
              } else {
                // Sliding window with overlap: first hop starts at its "usable" min,
                // last hop ends at its "usable" max.

                // Number of hops is based on USABLE bandwidth increments
                let num_hops = (span / usable_bw_hz).ceil() as usize;
                if num_hops <= 1 {
                  let center = (min_freq + max_freq) / 2.0;
                  let hop_start = center - hw_bw_hz / 2.0;
                  all_hops.push((hop_start, hop_start + hw_bw_hz));
                  capture_channels.push(
                    crate::sdr::processor::CaptureChannel {
                      center_freq_hz: hop_start + (hw_sample_rate / 2.0),
                      sample_rate_hz: hw_sample_rate,
                      requested_min_freq_hz: Some(min_freq),
                      requested_max_freq_hz: Some(max_freq),
                      iq_data: Vec::new(),
                      spectrum_data: Vec::new(),
                      bins_per_frame: 0,
                      label: None,
                    },
                  );
                } else {
                  // Distribute hops so that the "usable" centers cover the range.
                  // The first hop's usable range starts at min_freq.
                  // The last hop's usable range ends at max_freq.
                  // Usable start = center - usable_bw/2
                  // 1st hop: usable_start = min_freq => center = min_freq + usable_bw/2
                  // Last hop: usable_end = max_freq => center = max_freq - usable_bw/2

                  let first_center = min_freq + (usable_bw_hz / 2.0);
                  let last_center = max_freq - (usable_bw_hz / 2.0);
                  let step =
                    (last_center - first_center) / ((num_hops - 1) as f64);

                  for i in 0..num_hops {
                    let center = first_center + (i as f64 * step);
                    let start = center - (hw_bw_hz / 2.0);
                    let end = start + hw_bw_hz;
                    all_hops.push((start, end));
                    capture_channels.push(
                      crate::sdr::processor::CaptureChannel {
                        center_freq_hz: start + (hw_sample_rate / 2.0),
                        sample_rate_hz: hw_sample_rate,
                        requested_min_freq_hz: Some(min_freq),
                        requested_max_freq_hz: Some(max_freq),
                        iq_data: Vec::new(),
                        spectrum_data: Vec::new(),
                        bins_per_frame: 0,
                        label: None,
                      },
                    );
                  }
                }
              }
            }

            // Compute overall metadata from the REQUESTED range (not hops)
            let overall_span_hz = overall_max - overall_min;
            let overall_center_hz = (overall_min + overall_max) / 2.0;

            processor.capture_fragments = all_hops.clone();
            processor.capture_channels = capture_channels;

            processor.capture_active = true;
            processor.capture_overall_center_hz = overall_center_hz;
            processor.capture_overall_span_hz = overall_span_hz;
            processor.capture_requested_range =
              Some((overall_min, overall_max));

            // Tune to the first hop if available
            if let Some(&(min_freq, max_freq)) = all_hops.first() {
              let center_freq = (min_freq + (hw_sample_rate / 2.0)) as u32;
              if let Err(e) = processor.set_center_frequency(center_freq) {
                error!("Failed to tune to first fragment: {}", e);
              } else {
                info!("Tuned to initial capture fragment: {} Hz - {} Hz (center {} Hz, bandwidth {} Hz)", min_freq, max_freq, center_freq, hw_bw_hz);
              }
            }

            // Auto-unpause for capture on the current active source.
            let active_source_id = active_source_id(&shared_state);
            shared_state
              .set_active_source_pause_state(&active_source_id, false);

            info!(
              "Started capture job {} for {}s (auto-unpaused)",
              job_id, duration_s
            );

            let msg = serde_json::json!({
                "type": "capture_status",
                "status": {
                    "jobId": job_id,
                    "status": "started",
                    "message": "Capturing..."
                }
            });
            let _ = _broadcast_tx.send(msg.to_string());
          }
          crate::server::types::SdrCommand::StopCapture { job_id } => {
            let mut processor = sdr_processor.lock().await;
            if let Some(stopped_job_id) = job_id.as_ref() {
              if processor.capture_job_id.as_ref() != Some(stopped_job_id) {
                info!(
                  "Ignoring StopCapture for stale job_id={}, current={:?}",
                  stopped_job_id, processor.capture_job_id
                );
                continue;
              }
            }

            if let Some(result) = processor.stop_capture() {
              handle_stopped_capture(
                result,
                &shared_state,
                &_broadcast_tx,
                None,
              );
            }
          }
          crate::server::types::SdrCommand::SetPowerScale { scale } => {
            let mut processor = sdr_processor.lock().await;
            info!("Setting power scale to: {:?}", scale);
            processor.set_power_scale(scale);
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
            info!(
              "Applying transmit mode command: enabled={}, device={}",
              enabled, device
            );

            let device_normalized =
              device.to_ascii_lowercase().replace(['_', '-'], " ");
            let is_mock_tx_device = matches!(
              device_normalized.as_str(),
              "mock tx" | "mock tx device" | "mock tx sdr"
            );

            let active_kind =
              shared_state.device_profile.lock().unwrap().kind.clone();
            let active_source_id = active_source_id(&shared_state);
            if let Some(tx_signal) = tx_signal.as_deref() {
              *crate::safety::TX_SIGNAL.lock().unwrap() = tx_signal.to_string();
            }
            let effective_power_dbm =
              complex_baseband::resolve_effective_tx_power_dbm(
                power_dbm,
                vga_gain_db,
                amp_enabled,
              );
            if let Some(power_dbm) = effective_power_dbm {
              *crate::safety::TX_POWER_DBM.lock().unwrap() = power_dbm;
            }
            if let Some(center_frequency_hz) = center_frequency_hz {
              *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() =
                center_frequency_hz as f64;
            }
            if let Some(bandwidth_hz) = bandwidth_hz {
              *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = bandwidth_hz;
            }
            if let Some(tx_ifft_size) = tx_ifft_size {
              *crate::safety::TX_IFFT_SIZE.lock().unwrap() = tx_ifft_size;
            }
            let was_transmitting =
              crate::safety::TX_TRANSMITTING.swap(enabled, Ordering::Relaxed);
            if !enabled {
              crate::safety::TX_HOP_ENABLED.store(false, Ordering::Relaxed);
              shared_state.tx_hop_enabled.store(false, Ordering::Relaxed);
            }

            // Seed the monitor view only when unset. Start Tx must not clobber
            // an established standby VFO before the status payload's
            // viewCenterHz is applied — that left the carrier off-window and
            // rendered a flat noise floor.
            if is_mock_tx_device && enabled {
              let mut view_center =
                crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap();
              if *view_center <= 0.0 {
                if let Some(center_frequency_hz) = center_frequency_hz {
                  let center_hz = center_frequency_hz.min(u32::MAX as u64);
                  *view_center = center_hz as f64;
                }
              }
            }

            if should_apply_transmit_settings_to_receiver(
              is_mock_tx_device,
              &active_kind,
            ) {
              if let Some(center_frequency_hz) = center_frequency_hz {
                let mut processor = sdr_processor.lock().await;
                processor.queue_center_frequency(
                  center_frequency_hz.min(u32::MAX as u64) as u32,
                );
              }

              shared_state.pending_fast_settings.lock().unwrap().push(
                crate::server::types::SdrProcessorSettings {
                  sample_rate: sample_rate_hz
                    .map(|value| value.min(u32::MAX as u64) as u32),
                  hackrf_lna_gain: lna_gain_db,
                  hackrf_vga_gain: vga_gain_db,
                  hackrf_amp_enable: amp_enabled,
                  tuner_agc,
                  rtl_agc,
                  ppm,
                  ..Default::default()
                },
              );
            }

            if active_kind == "hackrf_one" {
              let mut processor = sdr_processor.lock().await;
              if enabled {
                let center_hz = center_frequency_hz.unwrap_or(0) as f64;
                let sample_rate =
                  sample_rate_hz.unwrap_or(2_000_000).min(u32::MAX as u64)
                    as u32;
                if let Some(center_frequency_hz) = center_frequency_hz {
                  processor.set_center_frequency(
                    center_frequency_hz.min(u32::MAX as u64) as u32,
                  )?;
                }
                if sample_rate_hz.is_some() {
                  processor.set_sample_rate(sample_rate)?;
                }
                let iq = complex_baseband::synthesize_mock_tx_monitor_iq(
                  tx_ifft_size.unwrap_or(262_144).clamp(256, 262_144),
                  center_hz,
                  sample_rate,
                  center_hz,
                  bandwidth_hz.unwrap_or(sample_rate as f64),
                  tx_signal.as_deref().unwrap_or("wifi"),
                  tx_ifft_size.unwrap_or(262_144),
                  power_dbm.unwrap_or(-18.0),
                  &complex_baseband::resolve_mock_tx_iq_power_model(),
                  &mut *shared_state.mock_tx_phase_accumulator.lock().unwrap(),
                );
                processor.transmit_iq(Some(&iq))?;
                stream_manager.set_tx_payload(
                  StreamKey::new(active_source_id.clone(), StreamMode::Tx),
                  center_hz.min(u32::MAX as f64) as u64,
                  sample_rate,
                  iq,
                );
              } else {
                processor.transmit_iq(None)?;
                stream_manager.clear_tx_payload(&StreamKey::new(
                  active_source_id.clone(),
                  StreamMode::Tx,
                ));
              }
            }

            let mut status_changed = was_transmitting != enabled;
            if active_kind == "mock_tx" || is_mock_tx_device {
              let mock_tx_was_transmitting = shared_state
                .mock_tx_transmitting
                .swap(enabled, Ordering::Relaxed);
              status_changed |= mock_tx_was_transmitting != enabled;
            }
            if status_changed
              && matches!(active_kind.as_str(), "mock_tx" | "hackrf_one")
            {
              shared_state.set_device_state(
                if enabled { "transmitting" } else { "connected" },
                None,
              );
            }
            if status_changed {
              broadcast_device_status(&shared_state, &_broadcast_tx);
            }
          }
          #[cfg(rs_decrypted)]
          crate::server::types::SdrCommand::ScanForAudio {
            job_id,
            frequency_range,
            window_size_hz,
            step_size_hz,
            audio_threshold,
          } => {
            let mut processor = sdr_processor.lock().await;
            info!("[SCAN] Starting scan job={}", job_id);
            let regions = processor.handle_scan(
              frequency_range,
              window_size_hz,
              step_size_hz,
              audio_threshold,
              &job_id,
              &_broadcast_tx,
            );
            let response = crate::server::types::ScanResultResponse {
              message_type: "scan_result".to_string(),
              job_id,
              regions,
            };
            if let Ok(json) = serde_json::to_string(&response) {
              let _ = _broadcast_tx.send(json);
            }
          }
          #[cfg(not(rs_decrypted))]
          crate::server::types::SdrCommand::ScanForAudio { job_id, .. } => {
            warn!("ScanForAudio requested for job {} but decrypted scan support is disabled in this build", job_id);
          }
          #[cfg(rs_decrypted)]
          crate::server::types::SdrCommand::DemodulateRegion {
            job_id,
            region,
          } => {
            let mut processor = sdr_processor.lock().await;
            info!("[DEMOD] Demodulating region for job={}", job_id);
            let (audio_buffer, sample_rate) =
              processor.handle_demodulate(&region);
            let response = crate::server::types::DemodResultResponse {
              message_type: "demod_result".to_string(),
              job_id,
              region,
              audio_buffer,
              sample_rate,
            };
            if let Ok(json) = serde_json::to_string(&response) {
              let _ = _broadcast_tx.send(json);
            }
          }
          #[cfg(not(rs_decrypted))]
          crate::server::types::SdrCommand::DemodulateRegion {
            job_id, ..
          } => {
            warn!("DemodulateRegion requested for job {} but decrypted demod support is disabled in this build", job_id);
          }
          #[cfg(rs_decrypted)]
          crate::server::types::SdrCommand::StartAptAnalysis {
            job_id,
            config,
          } => {
            let processor = sdr_processor.lock().await;
            info!("[APT] Starting APT analysis for job={}", job_id);

            // Send initial progress update
            let initial_result = crate::server::types::AptAnalysisResult {
              message_type: "apt_analysis_result".to_string(),
              job_id: job_id.clone(),
              channel_metadata: crate::server::types::AptChannelMetadata {
                window_size_hz: config.window_size_hz,
                content_type: config.content_type.clone(),
                sub_channel_range: config.sub_channel_range,
                center_freq_hz: processor.get_center_frequency(),
                signal_strength_db: -50.0, // Placeholder
                snr: 10.0,                 // Placeholder
                demod_processor: config.demod_processor.clone(),
              },
              progress: 0.0,
              processing_stage:
                crate::server::types::AptProcessingStage::Initializing,
              analysis_data: None,
            };

            if let Ok(json) = serde_json::to_string(&initial_result) {
              let _ = _broadcast_tx.send(json);
            }

            // Start async APT analysis
            let processor_clone = sdr_processor.clone();
            let broadcast_tx_clone = _broadcast_tx.clone();
            let job_id_clone = job_id.clone();
            let config_clone = config.clone();

            tokio::spawn(async move {
              crate::encrypted_modules::apt_analysis::run_apt_analysis(
                processor_clone,
                broadcast_tx_clone,
                job_id_clone,
                config_clone,
              )
              .await;
            });
          }
          #[cfg(not(rs_decrypted))]
          crate::server::types::SdrCommand::StartAptAnalysis {
            job_id, ..
          } => {
            warn!("StartAptAnalysis requested for job {} but APT analysis is disabled in this build", job_id);
          }
          _ => {
            warn!("Unhandled command: {:?}", cmd);
          }
        }
      }

      // 1b. Monitor device health and handle hot-plugging
      //
      // See module-level rustdoc for the full hotplug behaviour contract.
      // Key invariants:
      //   • Mock → Real: broadcast "loading" BEFORE opening the device.
      //   • Real unhealthy: debounce ≥ DISCONNECT_FAILURE_THRESHOLD strikes,
      //     attempt recovery, only then fall back to mock.
      //   • Every state change is broadcast immediately.
      if hotplug_state.last_poll.elapsed()
        >= super::shared_state::HEALTH_CHECK_INTERVAL
      {
        let mut processor = sdr_processor.lock().await;
        let active_source = active_source_id(&shared_state);
        if should_restore_warm_source(processor.is_mock(), &active_source) {
          if let Some(warm_device) =
            take_warm_source_for_active(&mut warm_devices, &active_source)
          {
            let source_id = active_source.clone();
            let restored_sample_rate =
              shared_state.sdr_settings.lock().unwrap().sample_rate;
            match processor.swap_device_keep_warm_with_sample_rate(
              warm_device,
              Some(restored_sample_rate),
            ) {
              Ok(previous_mock) => {
                drop(previous_mock);
                info!(
                  "Restored warm SDR source {} instead of reopening USB",
                  source_id
                );
                sync_shared_sample_rate(&shared_state, &processor);
                shared_state.update_device_status(
                  true,
                  processor.get_device_info(),
                  build_device_profile(processor.device_type()),
                );
                shared_state.update_device_usb_strings(
                  processor.get_serial_number(),
                  processor.get_manufacturer(),
                  processor.get_product(),
                );
                prepare_selected_source_for_rx(
                  &shared_state,
                  &source_id,
                  SourceLifecyclePhase::Streaming,
                );
                shared_state.set_device_backend_error(processor.get_error());
                broadcast_device_status(&shared_state, &_broadcast_tx);
                hotplug_state.last_hardware_swap = Some(Instant::now());
              }
              Err(e) => {
                warn!(
                  "Warm SDR source {} could not resume ({}); falling back to USB discovery",
                  source_id, e
                );
              }
            }
          }
        }
        crate::sdr::hotplug::maybe_attach_hotplugged_device(
          &hotplug_monitor,
          &mut hotplug_state,
          &mut processor,
          &shared_state,
          &_broadcast_tx,
          false,
        )
        .await;
        crate::sdr::hotplug::handle_real_hardware_health(
          &mut hotplug_state,
          &mut processor,
          &shared_state,
          &_broadcast_tx,
          |processor| {
            if processor.capture_active {
              warn!("Stopping active capture due to device transition.");
              if let Some(result) = processor.stop_capture() {
                handle_stopped_capture(
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
      }

      // 1c. Hot-reload n_apt.channels when signals.yaml changes on disk.
      //
      // Piggybacks on the same 2-second health-check cadence. When the
      // file's modification timestamp advances, we re-parse the channels
      // section and, if it actually changed, update SharedState and
      // broadcast a fresh status message so every connected frontend
      // immediately picks up the new channel boundaries.
      if last_channels_check.elapsed() >= Duration::from_secs(2) {
        last_channels_check = Instant::now();
        let current_modified =
          crate::server::utils::signals_config_modified_at();
        if current_modified != last_signals_modified {
          last_signals_modified = current_modified;
          let new_channels = crate::server::utils::load_channels();
          let channels_changed = {
            let guard = shared_state.channels.lock().unwrap();
            *guard != new_channels
          };
          if channels_changed {
            info!(
              "signals.yaml changed — hot-reloading {} channel(s)",
              new_channels.len()
            );
            {
              let mut guard = shared_state.channels.lock().unwrap();
              *guard = new_channels;
            }
            broadcast_channels(&shared_state, &_broadcast_tx);
          }
          broadcast_device_status(&shared_state, &_broadcast_tx);
        }
      }

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
      let process_result = {
        let cloned_processor = sdr_processor.clone();
        let cloned_shared = shared_state.clone();
        let captured_source_id = frame_source_id.clone();
        tokio::task::spawn_blocking(
            move || -> Result<(String, Vec<f32>, i64, u32, bool, String, PowerScale, u32, Vec<u8>, u32)> {
              let mut processor = cloned_processor.blocking_lock();

              // Apply only the newest retune request. This avoids taking the
              // processor mutex on the WebSocket task and prevents a burst of
              // VFO events from producing a queue of stale hardware writes.
              if cloned_shared
                .pending_center_freq_dirty
                .swap(false, std::sync::atomic::Ordering::AcqRel)
              {
                let pending_frequency = cloned_shared
                  .pending_center_freq
                  .load(std::sync::atomic::Ordering::Acquire);
                if pending_frequency > 0
                  && pending_frequency != processor.get_center_frequency()
                {
                  if let Err(error) =
                    processor.set_center_frequency(pending_frequency)
                  {
                    log::warn!(
                      "Failed to apply pending frequency in websocket loop: {}",
                      error
                    );
                  }
                }
              }

              // ── Apply any fast-path settings that arrived while we were
              //    blocked on the previous frame's read_samples. ──────────
              let pending: Vec<_> = {
                let mut slot = cloned_shared.pending_fast_settings.lock().unwrap();
                std::mem::take(&mut *slot)
              };
              let mut fft_size_changed = false;
              let old_fft_size = processor.fft_processor.config().fft_size;
              for settings in pending {
                if let Err(e) = processor.apply_settings(settings) {
                  let supported_device_present = cloned_shared
                    .usb_inventory_known
                    .load(Ordering::Acquire)
                    && cloned_shared
                      .supported_usb_device_count
                      .load(Ordering::Relaxed)
                      > 0;
                  if !processor.is_mock()
                    && should_promote_fast_path_error_to_read_error(
                      &e,
                      supported_device_present,
                    )
                  {
                    return Err(e);
                  }
                  log::error!("Failed to apply fast-path settings: {}", e);
                }
              }
              if processor.fft_processor.config().fft_size != old_fft_size {
                fft_size_changed = true;
              }
              // After an FFT size change, flush stale buffered data so
              // read_samples doesn't block waiting for old-size worth of bytes.
              if fft_size_changed {
                processor.flush_read_queue();
                processor.frame.avg_spectrum = None;
              }

              let current_fft_size = processor.fft_processor.config().fft_size;
              let timestamp = chrono::Utc::now().timestamp_millis();
              let mut center_frequency = if let Some(pending) = processor.frame.pending_freq.take() {
                if let Err(e) = processor.set_center_frequency(pending) {
                  log::warn!("Failed to apply pending frequency in websocket loop: {}", e);
                }
                pending
              } else {
                processor.get_center_frequency()
              };
              let active_source_id = active_source_id(&cloned_shared);
              let tx_is_active = crate::safety::TX_TRANSMITTING
                .load(std::sync::atomic::Ordering::Relaxed);
              let streaming_mock_tx_monitor = should_synthesize_mock_tx_monitor_frame(
                &active_source_id,
                tx_is_active,
                requested_single_frame,
              );
              let is_mock_apt = frame_is_mock_apt(
                &captured_source_id,
                streaming_mock_tx_monitor,
              );
              let device_type = if streaming_mock_tx_monitor {
                MOCK_TX_DISPLAY_NAME.to_string()
              } else {
                processor.device_type().to_string()
              };
              let power_scale = if streaming_mock_tx_monitor {
                PowerScale::DBm
              } else {
                processor.get_power_scale()
              };
              let sample_rate = {
                let processor_sample_rate = processor.get_sample_rate();
                if processor_sample_rate == 0 {
                  cloned_shared.sdr_settings.lock().unwrap().sample_rate.max(1)
                } else {
                  processor_sample_rate
                }
              };
              let (waveform, raw_iq) = if streaming_mock_tx_monitor {
                let tx_signal = crate::safety::TX_SIGNAL.lock().unwrap().clone();
                let tx_power_dbm = *crate::safety::TX_POWER_DBM.lock().unwrap();
                let tx_center_hz =
                  *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap();
                let tx_bandwidth_hz =
                  *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap();
                let tx_ifft_size = *crate::safety::TX_IFFT_SIZE.lock().unwrap();
                let tx_iq_power_model = complex_baseband::resolve_mock_tx_iq_power_model();
                let tx_view_center_hz = *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap();
                // Use TX_MONITOR_VIEW_CENTER_HZ as the view center.
                // apply_mock_tx_preview_settings writes the frontend's display
                // center (mockMonitorCenterHz) here on every request_next_frame,
                // keeping it stable during slider drags while tx_center_hz moves.
                center_frequency = if tx_view_center_hz > 0.0 {
                  tx_view_center_hz.round().clamp(1.0, u32::MAX as f64) as u32
                } else if tx_center_hz > 0.0 {
                  tx_center_hz.round().clamp(1.0, u32::MAX as f64) as u32
                } else {
                  center_frequency
                };
                let tx_monitor_sample_rate = crate::safety::TX_MONITOR_SAMPLE_RATE_HZ
                  .load(std::sync::atomic::Ordering::Relaxed);
                let monitor_sample_rate = if tx_monitor_sample_rate > 0 {
                  tx_monitor_sample_rate
                } else {
                  sample_rate
                };
                let monitor_fft_size = resolve_mock_tx_monitor_fft_size(
                  current_fft_size,
                  tx_ifft_size,
                );
                let raw_iq = complex_baseband::synthesize_mock_tx_monitor_iq(
                  monitor_fft_size,
                  center_frequency as f64,
                  monitor_sample_rate,
                  if tx_center_hz > 0.0 {
                    tx_center_hz
                  } else {
                    center_frequency as f64
                  },
                  tx_bandwidth_hz,
                  &tx_signal,
                  tx_ifft_size,
                  tx_power_dbm,
                  &tx_iq_power_model,
                  &mut *cloned_shared.mock_tx_phase_accumulator.lock().unwrap(),
                );
                (Vec::new(), raw_iq)
              } else {
                let force_noise =
                  cloned_shared.force_noise.load(std::sync::atomic::Ordering::Relaxed);
                let waveform =
                  processor.read_and_process_frame_with_noise(force_noise)?;
                (waveform, processor.frame.last_frame_raw_iq.clone())
              };
              let fps = processor.display_frame_rate;
              Ok((
                captured_source_id,
                waveform,
                timestamp,
                center_frequency,
                is_mock_apt,
                device_type,
                power_scale,
                sample_rate,
                raw_iq,
                fps,
              ))
            },
          )
          .await
      };

      match process_result {
        Ok(Ok((
          frame_source_id,
          _waveform,
          timestamp,
          center_frequency,
          is_mock_apt,
          device_type_str,
          power_scale,
          sample_rate,
          raw_iq,
          fps,
        ))) => {
          target_fps = fps;
          // Successful read — clear any failure streak and confirm
          // recovery if we were in "loading" state from a recovery attempt.
          // The legacy frame bit identifies Mock APT only. Recovery and
          // health bookkeeping must instead follow source identity so Mock
          // Tx does not get treated as a hardware reader (or vice versa).
          if !frame_source_id.starts_with("mock-") {
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
            }
          }

          if raw_iq.is_empty() {
            warn!("Raw I/Q data is empty in live stream - this may cause data stream freeze");
          }

          if !should_publish_frame_for_source_transition(
            &frame_source_id,
            &active_source_id(&shared_state),
            shared_state.pending_source_switch().as_deref(),
          ) {
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
        Ok(Err(e)) => {
          // ── Read error: use the same debounced recovery logic ──
          //
          // A read error from real hardware is treated as a health failure.
          // Mock errors are extremely unlikely but handled gracefully.
          let mut processor = sdr_processor.lock().await;

          if processor.is_mock() {
            // Mock should never fail, but don't crash — just wait briefly
            warn!("Mock SDR read error (unexpected): {}", e);
            tokio::time::sleep(Duration::from_millis(100)).await;
          } else {
            let current_state =
              shared_state.device_state.lock().unwrap().clone();
            if current_state == "loading"
              || current_state == "stale"
              || current_state == "disconnected"
            {
              debug!(
                "Ignoring read error/timeout while device is in {} state: {}",
                current_state, e
              );
              tokio::time::sleep(Duration::from_millis(100)).await;
              continue;
            }

            // A reader failure is not proof of USB removal. Mark the stream
            // stale so the frontend stops treating old frames as current,
            // while the hotplug monitor independently checks for a real
            // disconnect and keeps the reconnect path available.
            if let Some(read_state) = read_failure_state(&current_state) {
              if current_state != read_state {
                shared_state.set_device_state(read_state, None);
                broadcast_device_status(&shared_state, &_broadcast_tx);
              }
            }

            let streak = shared_state.record_health_failure();
            let recovery_count =
              shared_state.recovery_attempts.load(Ordering::Relaxed);

            error!(
              "SDR read error (streak {}/{}, recovery {}/{}): {}",
              streak,
              super::shared_state::DISCONNECT_FAILURE_THRESHOLD,
              recovery_count,
              super::shared_state::MAX_RECOVERY_ATTEMPTS,
              e,
            );

            if let Some(last_failed) = hotplug_state.last_failure_at {
              if last_failed.elapsed() < hotplug_state.retry_cooldown {
                debug!(
                    "Skipping recovery while cooling down after repeated device failure"
                  );
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
              }
            }

            if streak < super::shared_state::DISCONNECT_FAILURE_THRESHOLD {
              let supported_device_present = shared_state
                .usb_inventory_known
                .load(Ordering::Acquire)
                && shared_state
                  .supported_usb_device_count
                  .load(Ordering::Relaxed)
                  > 0;
              if should_fallback_to_mock_on_early_read_error(
                &e,
                streak,
                supported_device_present,
              ) {
                warn!(
                  "Supported USB device unplugged after read error. Falling back to mock immediately."
                );
                let was_hackrf = processor.device_type() == "hackrf_one";
                shared_state.set_device_state("disconnected", None);
                if was_hackrf {
                  shared_state.set_device_backend_error(Some(
                    broadcasting::HACKRF_DISCONNECT_ADVISORY.to_string(),
                  ));
                }
                broadcast_device_status(&shared_state, &_broadcast_tx);

                let mock_device =
                  crate::sdr::SdrDeviceFactory::create_mock_device();
                if let Err(swap_e) = processor.swap_device(mock_device) {
                  error!(
                    "Failed to swap to mock after early unplug: {}",
                    swap_e
                  );
                } else {
                  sync_shared_sample_rate(&shared_state, &processor);
                  shared_state.update_device_status(
                    false,
                    processor.get_device_info(),
                    build_device_profile(processor.device_type()),
                  );
                  if was_hackrf {
                    shared_state.set_device_backend_error(Some(
                      broadcasting::HACKRF_DISCONNECT_ADVISORY.to_string(),
                    ));
                  } else {
                    shared_state
                      .set_device_backend_error(processor.get_error());
                  }
                  shared_state.set_active_source_pause_state("mock-apt", false);
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                }
              } else if !supported_device_present
                && is_async_sample_timeout_error(&e)
              {
                debug!(
                  "Async SDR sample timeout occurred before disconnect threshold; keeping real device in recovery"
                );
              }

              // Brief settle regardless
              tokio::time::sleep(Duration::from_millis(100)).await;
            } else {
              // Threshold reached: restart stalled readers before falling back.
              let supported_device_present = shared_state
                .usb_inventory_known
                .load(Ordering::Acquire)
                && shared_state
                  .supported_usb_device_count
                  .load(Ordering::Relaxed)
                  > 0;
              warn!(
                  "Read-error threshold reached (streak={}). Supported USB device present={}.",
                  streak, supported_device_present,
                );
              let reader_recovery_action = resolve_reader_recovery_action(
                is_async_sample_timeout_error(&e),
                processor.is_rx_active(),
                streak,
                supported_device_present,
              );
              if matches!(
                reader_recovery_action,
                ReaderRecoveryAction::WaitForReaderShutdown
              ) {
                warn!(
                  "RTL-SDR reader is still stopping; waiting before any reopen"
                );
                shared_state.set_device_state("stale", None);
                shared_state.set_device_backend_error(Some(e.to_string()));
                broadcast_device_status(&shared_state, &_broadcast_tx);
              } else if matches!(
                reader_recovery_action,
                ReaderRecoveryAction::RestartReader
              ) {
                // A sample timeout means the current reader stalled; it does
                // not mean the USB device should be reopened. Keep the
                // existing handle, restart its reader, and reserve the device
                // recovery budget for an actual handle replacement.
                shared_state.recovery_attempts.store(0, Ordering::Relaxed);
                shared_state.set_device_state("loading", Some("restart"));
                broadcast_device_status(&shared_state, &_broadcast_tx);

                match processor.initialize() {
                  Ok(()) => {
                    info!(
                      "Restarted current SDR async reader after sample timeout. Awaiting first healthy frame."
                    );
                    shared_state
                      .health_failure_streak
                      .store(0, Ordering::Relaxed);
                    let active_id = active_source_id(&shared_state);
                    shared_state
                      .set_active_source_pause_state(&active_id, false);
                    shared_state
                      .set_device_backend_error(processor.get_error());
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                    hotplug_state.last_hardware_swap = Some(Instant::now());
                  }
                  Err(restart_e) => {
                    error!(
                      "Failed to restart current SDR async reader after sample timeout: {}",
                      restart_e
                    );
                    let supported_device_present = shared_state
                      .usb_inventory_known
                      .load(Ordering::Acquire)
                      && shared_state
                        .supported_usb_device_count
                        .load(Ordering::Relaxed)
                        > 0;
                    if !supported_device_present {
                      warn!(
                        "USB device disappeared while restarting reader; falling back to Mock APT"
                      );
                      shared_state.set_device_state("disconnected", None);
                      broadcast_device_status(&shared_state, &_broadcast_tx);
                      if let Err(swap_e) = processor.swap_device(
                        crate::sdr::SdrDeviceFactory::create_mock_device(),
                      ) {
                        error!(
                          "Failed to swap to mock after reader loss: {}",
                          swap_e
                        );
                      } else {
                        sync_shared_sample_rate(&shared_state, &processor);
                        shared_state.update_device_status(
                          false,
                          processor.get_device_info(),
                          build_device_profile(processor.device_type()),
                        );
                        shared_state
                          .set_active_source_pause_state("mock-apt", false);
                      }
                      shared_state.set_device_backend_error(Some(format!(
                        "Async SDR sample reader restart failed after USB removal: {}",
                        restart_e
                      )));
                    } else {
                      // A failed restart means the current USB handle is no
                      // longer trustworthy (the common unplug/replug case
                      // can leave the old handle present while its interface
                      // has already been detached). Reopen the real device
                      // immediately instead of retrying the same stale
                      // handle forever on the loading placeholder.
                      shared_state.set_device_state("stale", None);
                      broadcast_device_status(&shared_state, &_broadcast_tx);
                      match processor.cleanup() {
                        Err(cleanup_e) => {
                          warn!(
                            "Deferring RTL-SDR reopen until the old reader stops: {}",
                            cleanup_e
                          );
                          shared_state.set_device_backend_error(Some(
                            format!(
                              "Async SDR sample reader restart failed; waiting for USB reader shutdown: {}",
                              cleanup_e
                            ),
                          ));
                        }
                        Ok(()) => {
                          let requested_source_id =
                            active_source_id(&shared_state);
                          match open_device_for_source_id(&shared_state, &requested_source_id)
                          {
                            Ok(new_device)
                              if !new_device
                                .device_type()
                                .to_ascii_lowercase()
                                .contains("mock") =>
                            {
                              if let Err(swap_e) =
                                processor.swap_device(new_device)
                              {
                                let fallback_error = format!(
                                  "Failed to reopen selected SDR after reader restart failure: {}",
                                  swap_e
                                );
                                error!("{}", fallback_error);
                                if let Err(mock_swap_e) =
                                  fallback_to_mock_after_recovery_failure(
                                    &mut processor,
                                    &shared_state,
                                    &_broadcast_tx,
                                    fallback_error.clone(),
                                  )
                                {
                                  error!(
                                    "Failed to fall back to Mock APT after device reopen failure: {}",
                                    mock_swap_e
                                  );
                                  shared_state.set_device_backend_error(Some(
                                    fallback_error,
                                  ));
                                }
                              } else {
                                info!("Reopened SDR after stale reader restart failure");
                                shared_state
                                  .recovery_attempts
                                  .store(0, Ordering::Relaxed);
                                let active_id = active_source_id(&shared_state);
                                shared_state.set_active_source_pause_state(
                                  &active_id, false,
                                );
                                hotplug_state.last_hardware_swap =
                                  Some(Instant::now());
                                shared_state.set_device_backend_error(
                                  processor.get_error(),
                                );
                              }
                            }
                            _ => {
                              let fallback_error = format!(
                                "Async SDR sample reader restart failed; no supported device available: {}",
                                restart_e
                              );
                              if let Err(swap_e) =
                                fallback_to_mock_after_recovery_failure(
                                  &mut processor,
                                  &shared_state,
                                  &_broadcast_tx,
                                  fallback_error.clone(),
                                )
                              {
                                error!(
                                  "Failed to fall back to Mock APT after reader restart failure: {}",
                                  swap_e
                                );
                                shared_state.set_device_backend_error(Some(
                                  fallback_error,
                                ));
                              }
                            }
                          }
                        }
                      }
                    }
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                  }
                }
              } else if supported_device_present {
                if !crate::sdr::hotplug::is_recovery_budget_exhausted(
                  recovery_count,
                  super::shared_state::MAX_RECOVERY_ATTEMPTS,
                ) {
                  shared_state.set_device_state("loading", Some("restart"));
                  broadcast_device_status(&shared_state, &_broadcast_tx);

                  let cleanup_ready = match processor.cleanup() {
                    Ok(()) => true,
                    Err(cleanup_e) => {
                      // Do not reopen the USB interface while a cancelled
                      // RTL async reader is still unwinding.  Retrying the
                      // open in that window is what causes claim-interface
                      // failures and the permanent loading placeholder.
                      warn!(
                        "SDR handle is still stopping; deferring replacement: {}",
                        cleanup_e
                      );
                      shared_state.set_device_state("loading", Some("restart"));
                      shared_state
                        .set_device_backend_error(Some(cleanup_e.to_string()));
                      broadcast_device_status(&shared_state, &_broadcast_tx);
                      hotplug_state.last_hardware_swap = Some(Instant::now());
                      false
                    }
                  };

                  if !cleanup_ready {
                    continue;
                  }

                  let requested_source_id = active_source_id(&shared_state);
                  match open_device_for_source_id(&shared_state, &requested_source_id) {
                    Ok(new_device)
                      if !new_device
                        .device_type()
                        .to_ascii_lowercase()
                        .contains("mock") =>
                    {
                      if let Err(swap_e) = processor.swap_device(new_device) {
                        let fallback_error = format!(
                          "Failed to swap to selected SDR on read error: {}",
                          swap_e
                        );
                        error!("{}", fallback_error);
                        if let Err(mock_swap_e) =
                          fallback_to_mock_after_recovery_failure(
                            &mut processor,
                            &shared_state,
                            &_broadcast_tx,
                            fallback_error.clone(),
                          )
                        {
                          error!(
                            "Failed to fall back to Mock APT after read-error swap failure: {}",
                            mock_swap_e
                          );
                          shared_state
                            .set_device_backend_error(Some(fallback_error));
                          broadcast_device_status(
                            &shared_state,
                            &_broadcast_tx,
                          );
                        }
                      } else {
                        info!("Read-error swap succeeded. Awaiting first healthy frame.");
                        shared_state
                          .recovery_attempts
                          .fetch_add(1, Ordering::Relaxed);
                        let active_id = active_source_id(&shared_state);
                        shared_state
                          .set_active_source_pause_state(&active_id, false);
                        shared_state
                          .set_device_backend_error(processor.get_error());
                        broadcast_device_status(&shared_state, &_broadcast_tx);
                        hotplug_state.last_hardware_swap = Some(Instant::now());
                      }
                    }
                    _ => {
                      warn!(
                        "Read-error restart did not return the selected real device while USB is still present; falling back to Mock APT"
                      );
                      let fallback_error = format!(
                        "Selected SDR could not be reopened while USB is present: {}",
                        processor
                          .get_error()
                          .unwrap_or_else(|| "device reopen failed".to_string())
                      );
                      if let Err(swap_e) =
                        fallback_to_mock_after_recovery_failure(
                          &mut processor,
                          &shared_state,
                          &_broadcast_tx,
                          fallback_error.clone(),
                        )
                      {
                        error!(
                          "Failed to fall back to Mock APT after read-error reopen failure: {}",
                          swap_e
                        );
                        shared_state
                          .set_device_backend_error(Some(fallback_error));
                        broadcast_device_status(&shared_state, &_broadcast_tx);
                      }
                      hotplug_state.last_hardware_swap = Some(Instant::now());
                    }
                  }
                } else {
                  warn!(
                      "Recovery attempts exhausted ({}). Holding disconnected for {:?}.",
                      super::shared_state::MAX_RECOVERY_ATTEMPTS,
                      hotplug_state.exhausted_recovery_cooldown
                    );
                  shared_state.set_device_state("disconnected", None);
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                  hotplug_state.last_failure_at = Some(Instant::now());
                  tokio::time::sleep(hotplug_state.exhausted_recovery_cooldown)
                    .await;
                }
              } else if should_fallback_to_mock_on_threshold_read_error(
                &e,
                supported_device_present,
              ) {
                let was_hackrf = processor.device_type() == "hackrf_one";
                shared_state.set_device_state("disconnected", None);
                if was_hackrf {
                  shared_state.set_device_backend_error(Some(
                    broadcasting::HACKRF_DISCONNECT_ADVISORY.to_string(),
                  ));
                }
                broadcast_device_status(&shared_state, &_broadcast_tx);

                let mock_device =
                  crate::sdr::SdrDeviceFactory::create_mock_device();
                if let Err(swap_e) = processor.swap_device(mock_device) {
                  error!("Failed to swap to mock on read error: {}", swap_e);
                } else {
                  sync_shared_sample_rate(&shared_state, &processor);
                  shared_state.update_device_status(
                    false,
                    processor.get_device_info(),
                    build_device_profile(processor.device_type()),
                  );
                  if was_hackrf {
                    shared_state.set_device_backend_error(Some(
                      broadcasting::HACKRF_DISCONNECT_ADVISORY.to_string(),
                    ));
                  } else {
                    shared_state
                      .set_device_backend_error(processor.get_error());
                  }
                  shared_state.set_active_source_pause_state("mock-apt", false);
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                  hotplug_state.last_hardware_swap = Some(Instant::now());
                }
              } else {
                warn!(
                  "Async SDR sample timeout reached read-error threshold without reliable USB presence; keeping real device in recovery"
                );
                shared_state.set_device_state("loading", Some("restart"));
                shared_state.set_device_backend_error(Some(e.to_string()));
                broadcast_device_status(&shared_state, &_broadcast_tx);
              }
              hotplug_state.last_failure_at = Some(Instant::now());
              tokio::time::sleep(Duration::from_millis(250)).await;
            }
          }
        }
        Err(join_e) => {
          error!("SDR block join error: {}", join_e);
        }
      }

      // 3. Check capture completion
      let capture_result =
        { sdr_processor.lock().await.check_capture_completion() };
      if let Some(result) = capture_result {
        let enc_key = shared_state.encryption_key;
        let shared_clone = shared_state.clone();
        let bcast = _broadcast_tx.clone();

        let processing_msg = serde_json::json!({
          "type": "capture_status",
          "status": {
            "jobId": result.job_id,
            "status": "progress",
            "message": "Processing data..."
          }
        });
        let _ = bcast.send(processing_msg.to_string());

        tokio::task::spawn_blocking(move || {
          if result.is_ephemeral {
            info!(
              "Ephemeral capture job {} completed. Skipping persistence.",
              result.job_id
            );
            let msg = serde_json::json!({
                "type": "capture_status",
                "status": {
                    "jobId": result.job_id,
                    "status": "done",
                    "message": "Processing data...",
                    "ephemeral": true,
                    "duration": result.duration_s
                }
            });
            let _ = bcast.send(msg.to_string());
            return;
          }

          let creating_msg = serde_json::json!({
            "type": "capture_status",
            "status": {
              "jobId": result.job_id,
              "status": "progress",
              "message": "Creating file..."
            }
          });
          let _ = bcast.send(creating_msg.to_string());

          match crate::server::utils::save_capture_file_multi(&result, &enc_key)
          {
            Ok(artifact) => {
              let mut artifacts = shared_clone
                .get_capture_artifacts(&result.job_id)
                .unwrap_or_default();
              artifacts.push(artifact.clone());

              if let Err(e) =
                shared_clone.store_capture_artifacts(&result.job_id, &artifacts)
              {
                error!("Failed to store capture artifacts in Redis: {}", e);
              }

              let file_name = artifact.filename.clone();

              let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

              let msg = serde_json::json!({
                  "type": "capture_status",
                  "status": {
                      "jobId": result.job_id,
                      "status": "done",
                      "message": "Capture complete",
                      "filename": file_name,
                      "downloadUrl": format!("/api/capture/download?jobId={}", result.job_id),
                      "timestamp": timestamp,
                      "fileSize": artifact.file_size,
                      "duration": result.duration_s,
                      "checksum": artifact.checksum
                  }
              });
              let _ = bcast.send(msg.to_string());
            }
            Err(e) => {
              error!("Failed to save capture file: {}", e);
              let msg = serde_json::json!({
                  "type": "capture_status",
                  "status": {
                      "jobId": result.job_id,
                      "status": "failed",
                      "message": "Capture failed",
                      "error": e.to_string()
                  }
              });
              let _ = bcast.send(msg.to_string());
            }
          }
        });
      }

      // Maintain target frame rate
      let elapsed = start_time.elapsed();
      let target_duration = Duration::from_millis(1000 / (target_fps as u64));
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
    self.sdr_processor.clone()
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

fn handle_stopped_capture(
  result: crate::sdr::processor::CaptureResult,
  shared_state: &Arc<SharedState>,
  broadcast_tx: &broadcast::Sender<String>,
  reason: Option<&str>,
) {
  let enc_key = shared_state.encryption_key;
  let shared_clone = shared_state.clone();
  let bcast = broadcast_tx.clone();
  let status_msg = reason.unwrap_or("Capture stopped").to_string();
  let status_msg_done = status_msg.clone();

  let processing_msg = serde_json::json!({
    "type": "capture_status",
    "status": {
      "jobId": result.job_id,
      "status": "progress",
      "message": "Processing stopped capture..."
    }
  });
  let _ = bcast.send(processing_msg.to_string());

  tokio::task::spawn_blocking(move || {
    if result.is_ephemeral {
      let msg = serde_json::json!({
          "type": "capture_status",
          "status": {
              "jobId": result.job_id,
              "status": "done",
              "message": status_msg_done,
              "ephemeral": true,
              "duration": result.duration_s
          }
      });
      let _ = bcast.send(msg.to_string());
      return;
    }

    match crate::server::utils::save_capture_file_multi(&result, &enc_key) {
      Ok(artifact) => {
        let mut artifacts = shared_clone
          .get_capture_artifacts(&result.job_id)
          .unwrap_or_default();
        artifacts.push(artifact.clone());

        if let Err(e) =
          shared_clone.store_capture_artifacts(&result.job_id, &artifacts)
        {
          error!("Failed to store capture artifacts in Redis: {}", e);
        }

        let timestamp = std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .unwrap()
          .as_millis() as u64;

        let msg = serde_json::json!({
            "type": "capture_status",
            "status": {
                "jobId": result.job_id,
                "status": "done",
                "message": status_msg_done,
                "filename": artifact.filename,
                "downloadUrl": format!("/api/capture/download?jobId={}", result.job_id),
                "timestamp": timestamp,
                "fileSize": artifact.file_size,
                "duration": result.duration_s,
                "checksum": artifact.checksum
            }
        });
        let _ = bcast.send(msg.to_string());
      }
      Err(e) => {
        error!("Failed to save stopped capture file: {}", e);
        let msg = serde_json::json!({
            "type": "capture_status",
            "status": {
                "jobId": result.job_id,
                "status": "failed",
                "message": "Capture failed",
                "error": e.to_string()
            }
        });
        let _ = bcast.send(msg.to_string());
      }
    }
  });
}
