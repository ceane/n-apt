//! Source selection, warm-device ownership, and first-frame lifecycle rules.
//!
//! Keeping these transitions outside the streaming loop makes source loading
//! and recovery explicit: selection opens the RX gate, warm sources bypass
//! setup latency, and swapped devices remain owned by the warm pool.

use anyhow::Result;
use log::{debug, info, warn};
use std::collections::HashMap;

use super::{
  active_source_id, build_source_info_snapshot, open_device_for_source_id,
};
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
pub(super) fn prepare_selected_source_for_rx(
  shared: &SharedState,
  source_id: &str,
  phase: SourceLifecyclePhase,
) {
  shared.set_active_source_pause_state(source_id, false);
  if phase == SourceLifecyclePhase::Loading {
    shared.set_device_state("loading", Some("connect"));
  }
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
pub(super) fn take_warm_source_for_active<T>(
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
pub(super) fn should_restore_warm_source(
  processor_is_mock: bool,
  active_source_id: &str,
) -> bool {
  processor_is_mock && !matches!(active_source_id, "mock-apt" | "mock-tx")
}

/// Returns every inactive source that can be initialized ahead of selection.
///
/// Mock peers are included so an APT/Tx handoff does not pay generator setup
/// and reader startup costs after the UI has already entered handoff state.
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

/// Initializes all inactive sources once and transfers ownership to the pool.
pub(super) fn prewarm_inactive_sources(
  processor: &SdrProcessor,
  shared_state: &SharedState,
  warm_devices: &mut HashMap<String, Box<dyn SdrDevice>>,
) {
  let active_id = active_source_id(shared_state);
  let snapshot = build_source_info_snapshot(shared_state);
  for source_id in warmable_source_ids(&snapshot, &active_id) {
    if warm_devices.contains_key(&source_id) {
      continue;
    }

    match open_device_for_source_id(&source_id) {
      Ok(mut device) => match initialize_warm_source(device.as_mut()) {
        Ok(()) => {
          info!("Pre-warmed inactive SDR source {}", source_id);
          warm_devices.insert(source_id, device);
        }
        Err(error) => {
          warn!("Failed to pre-warm SDR source {}: {}", source_id, error);
        }
      },
      Err(error) => {
        warn!(
          "Failed to open inactive SDR source {} for warm pool: {}",
          source_id, error
        );
      }
    }
  }

  debug!(
    "Warm pool contains {} inactive source(s) while {} is active",
    warm_devices.len(),
    processor.device_type()
  );
}

fn initialize_warm_source(device: &mut dyn SdrDevice) -> Result<()> {
  device.initialize()?;
  if !device.is_rx_active() {
    return Err(anyhow::anyhow!(
      "{} initialized without an active RX reader",
      device.device_type()
    ));
  }
  device.flush_read_queue();
  Ok(())
}
