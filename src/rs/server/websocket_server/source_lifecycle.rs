//! Source selection, warm-device ownership, and first-frame lifecycle rules.
//!
//! Keeping these transitions outside the streaming loop makes source loading
//! and recovery explicit: selection opens the RX gate, warm sources bypass
//! setup latency, and swapped devices remain owned by the warm pool.

use log::{debug, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;

use super::super::stream_manager::{
  StreamKey, StreamMode, StreamingSourceModeManager,
};
use super::super::types::SpectrumData;
use super::{
  active_source_id, broadcast_device_status, broadcast_source_status_for_id,
  broadcast_source_switch_error, build_device_profile,
  open_device_for_source_id, sync_shared_sample_rate, MOCK_TX_DISPLAY_NAME,
};
use crate::sdr::hotplug::HotplugState;
use crate::sdr::processor::SdrProcessor;
use crate::sdr::SdrDevice;
use crate::server::shared_state::SharedState;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceLifecyclePhase {
  Connected,
  Loading,
  Streaming,
  Standby,
}

impl std::fmt::Display for SourceLifecyclePhase {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      SourceLifecyclePhase::Connected => write!(f, "Connected"),
      SourceLifecyclePhase::Loading => write!(f, "Loading"),
      SourceLifecyclePhase::Streaming => write!(f, "Streaming"),
      SourceLifecyclePhase::Standby => write!(f, "Standby"),
    }
  }
}

/// Resolves the source state exposed while selection is in flight.
pub(super) fn source_phase_on_select(
  is_warm: bool,
  is_mock: bool,
) -> SourceLifecyclePhase {
  if is_warm {
    SourceLifecyclePhase::Streaming
  } else if is_mock {
    SourceLifecyclePhase::Standby
  } else {
    SourceLifecyclePhase::Loading
  }
}

/// Opens a selected source's RX gate and publishes genuine setup work.
pub(crate) fn prepare_selected_source_for_rx(
  shared: &SharedState,
  source_id: &str,
  phase: SourceLifecyclePhase,
) {
  shared.set_active_source_pause_state(source_id, false);
  if phase == SourceLifecyclePhase::Loading {
    shared.set_device_state("loading", Some("connect"));
  }
}

/// Commit a selected source and preserve the handoff invariants used by the
/// legacy websocket loop. This owns device reuse, source epochs, pause gates,
/// status publication, and the one-shot Mock Tx preview wake-up.
pub(crate) async fn activate_source(
  source_id: String,
  sample_rate: Option<u32>,
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  spectrum_tx: &broadcast::Sender<Arc<SpectrumData>>,
  stream_manager: &StreamingSourceModeManager,
  warm_devices: &mut HashMap<String, Box<dyn SdrDevice>>,
  hotplug_state: &mut HotplugState,
  allow_next_paused_frame: &mut bool,
) {
  info!("Dequeued source switch command: requested={}", source_id);
  let current_source_id = active_source_id(shared_state);
  if current_source_id == source_id {
    debug!(
      "SetActiveSource requested for current source {}, skipping",
      source_id
    );
    // Auto-detection may have selected this source before the frontend's
    // selection command arrives. Reconcile the legacy global fast-path with
    // the source-scoped pause state so a stale pause bit cannot leave a
    // healthy reader blocked until the user clicks Play/Pause.
    shared_state.sync_active_source_pause_state(&source_id);
    shared_state.clear_pending_source_switch(&source_id);
    broadcast_device_status(shared_state, broadcast_tx);
    return;
  }

  info!("Switching active source to {}", source_id);
  let previous_source_is_transmitting = crate::safety::TX_TRANSMITTING
    .load(std::sync::atomic::Ordering::Relaxed)
    || (current_source_id == "mock-tx"
      && shared_state
        .mock_tx_transmitting
        .load(std::sync::atomic::Ordering::Relaxed));
  if !previous_source_is_transmitting {
    shared_state.set_source_pause_state(&current_source_id, true);
  }

  let was_warm = warm_devices.contains_key(&source_id);
  let is_mock = source_id.starts_with("mock");
  let selection_phase = source_phase_on_select(was_warm, is_mock);
  if selection_phase == SourceLifecyclePhase::Loading {
    shared_state.set_device_state("loading", Some("connect"));
    broadcast_source_status_for_id(
      shared_state,
      broadcast_tx,
      &source_id,
      "loading",
    );
  } else {
    shared_state.begin_stream_epoch();
  }

  let next_device = match warm_devices.remove(&source_id) {
    Some(device) => {
      info!("Reusing warm SDR source {}", source_id);
      Ok(device)
    }
    None => open_device_for_source_id(shared_state, &source_id),
  };

  match next_device {
    Ok(new_device) => {
      let mut swap_result = processor
        .swap_device_keep_warm_with_sample_rate(new_device, sample_rate);
      if swap_result.is_err() && was_warm {
        warn!(
          "Warm SDR source {} did not resume; reopening once",
          source_id
        );
        swap_result = open_device_for_source_id(shared_state, &source_id)
          .and_then(|device| {
            processor
              .swap_device_keep_warm_with_sample_rate(device, sample_rate)
          });
      }

      match swap_result {
        Err(error) => {
          log::error!(
            "Failed to swap SDR processor to source {}: {}",
            source_id,
            error
          );
          // `swap_device_keep_warm_with_sample_rate` is transactional: the
          // failed replacement has already been cleaned up and the original
          // processor remains active. Restore that source instead of turning
          // a failed peer selection into an error for the healthy stream.
          restore_previous_source_after_failed_switch(
            processor,
            shared_state,
            &current_source_id,
          );
          shared_state.clear_pending_source_switch(&source_id);
          broadcast_source_switch_error(broadcast_tx, &source_id, &error);
          broadcast_device_status(shared_state, broadcast_tx);
        }
        Ok(mut previous_device) => {
          sync_shared_sample_rate(shared_state, processor);
          let last_freq = shared_state
            .pending_center_freq
            .load(std::sync::atomic::Ordering::Relaxed);
          if last_freq > 0 {
            if let Err(error) = processor.set_center_frequency(last_freq) {
              warn!(
                "Failed to apply last known frequency after swap: {}",
                error
              );
            }
          }

          if should_cache_swapped_source(&current_source_id) {
            if !previous_source_is_transmitting {
              if let Err(error) = previous_device.enter_standby() {
                warn!(
                  "Failed to pause previous source {} before caching: {}",
                  current_source_id, error
                );
              }
            }
            warm_devices.insert(current_source_id.clone(), previous_device);
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
            if processor
              .device_type()
              .to_ascii_lowercase()
              .contains("rtl")
            {
              shared_state.cache_active_rtl_sdr(
                processor.get_serial_number(),
                processor.get_manufacturer(),
                processor.get_product(),
              );
            }
          }
          shared_state.set_device_backend_error(processor.get_error());
          hotplug_state.last_failure_at = None;

          let wake_standby_preview = shared_state
            .paused_frame_request_for_source(&source_id)
            .is_some();
          if source_id == "mock-tx" || source_id == "mock-apt" {
            shared_state.set_active_source_pause_state(&source_id, false);
          } else {
            prepare_selected_source_for_rx(
              shared_state,
              &source_id,
              selection_phase,
            );
          }
          info!(
            "Source switch committed: requested={}, active={}, device_type={}, serial={}, rx_active={}",
            source_id,
            active_source_id(shared_state),
            processor.device_type(),
            processor.get_serial_number(),
            processor.is_rx_active(),
          );
          shared_state.clear_pending_source_switch(&source_id);

          if wake_standby_preview {
            if source_id == "mock-tx" {
              let frame = crate::server::websocket_handlers::build_mock_tx_standby_preview_frame(
                shared_state,
              );
              let tx_key = StreamKey::new(
                super::MOCK_TX_SOURCE_ID.to_string(),
                StreamMode::Tx,
              );
              let _ = stream_manager.publish_iq_frame_with_metadata(
                &tx_key,
                frame.timestamp,
                frame.center_frequency_hz.map(|frequency| frequency as u64),
                frame.sample_rate.unwrap_or(1),
                Arc::new(frame.iq_data.clone()),
              );
              let _ = spectrum_tx.send(Arc::new(frame));
              shared_state.clear_paused_frame_request();
              *allow_next_paused_frame = false;
            } else {
              shared_state.mark_paused_frame_requested(&source_id);
              *allow_next_paused_frame = true;
            }
          }
          broadcast_device_status(shared_state, broadcast_tx);
          hotplug_state.last_hardware_swap = Some(std::time::Instant::now());
        }
      }
    }
    Err(error) => {
      log::error!(
        "Failed to open source {} for switching: {}",
        source_id,
        error
      );
      // Opening the requested peer failed before the processor was swapped;
      // the current source must resume immediately and keep its frame stream.
      restore_previous_source_after_failed_switch(
        processor,
        shared_state,
        &current_source_id,
      );
      shared_state.clear_pending_source_switch(&source_id);
      warn!(
        "Source switch open failed: requested={}, active remains={}, device_type={}, error={}",
        source_id,
        active_source_id(shared_state),
        processor.device_type(),
        error,
      );
      broadcast_source_switch_error(broadcast_tx, &source_id, &error);
      broadcast_device_status(shared_state, broadcast_tx);
    }
  }
}

fn restore_previous_source_after_failed_switch(
  processor: &SdrProcessor,
  shared_state: &SharedState,
  previous_source_id: &str,
) {
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
  shared_state.set_device_state("connected", Some("source-switch"));
  shared_state.set_device_backend_error(processor.get_error());
  shared_state.sync_active_source_pause_state(previous_source_id);
}

/// Removes one retained source in stable order for fallback/recovery.
#[cfg(test)]
pub(super) fn take_next_warm_source<T>(
  warm_sources: &mut HashMap<String, T>,
) -> Option<(String, T)> {
  let source_id = warm_sources.keys().min().cloned()?;
  warm_sources
    .remove(&source_id)
    .map(|device| (source_id, device))
}

/// Restores only the retained device that belongs to the selected source.
///
/// Recovery must not pick an arbitrary warm peer: mock sources share a
/// receiver implementation, but each one owns independent tuning state.
pub(crate) fn take_warm_source_for_active<T>(
  warm_sources: &mut HashMap<String, T>,
  active_source_id: &str,
) -> Option<T> {
  warm_sources.remove(active_source_id)
}

/// Keeps every successfully swapped source reusable, including mock sources.
///
/// Mock APT carries checksum-sensitive generator continuity, and recreating it
/// on every Mock Tx handoff both adds latency and restarts that continuity.
pub(super) fn should_cache_swapped_source(source_id: &str) -> bool {
  !source_id.trim().is_empty()
}

/// Allows automatic warm-source recovery only when a non-mock logical source
/// has fallen back to a mock receiver. Both mock sources are deliberate
/// selections, so recovery must not replace either with an inactive peer.
pub(crate) fn should_restore_warm_source(
  processor_is_mock: bool,
  active_source_id: &str,
) -> bool {
  processor_is_mock && !matches!(active_source_id, "mock-apt" | "mock-tx")
}

/// Returns every inactive source that can be initialized ahead of selection.
///
/// Mock peers are included so an APT/Tx handoff does not pay generator setup
/// and reader startup costs after the UI has already entered handoff state.
#[cfg(test)]
pub(super) fn warmable_source_ids(
  snapshot: &serde_json::Value,
  active_source_id: &str,
) -> Vec<String> {
  let mut source_ids = snapshot["sources"]
    .as_array()
    .into_iter()
    .flatten()
    .filter_map(|source| {
      let id = source["id"].as_str()?;
      let kind = source["kind"].as_str()?;
      (id != active_source_id
        && matches!(
          kind,
          "mock_apt"
            | "mock_tx"
            | "rtl-sdr"
            | "rtl_sdr"
            | "hackrf_one"
            | "hackrf"
        ))
      .then(|| id.to_string())
    })
    .collect::<Vec<_>>();
  source_ids.sort();
  source_ids.dedup();
  source_ids
}
