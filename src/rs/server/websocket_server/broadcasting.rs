use super::sources::{
  active_source_id, build_device_profile, build_source_info_snapshot,
};
#[cfg(not(test))]
use crate::sdr::hotplug::supported_usb_device_count;
use crate::server::shared_state::SharedState;
#[cfg(not(test))]
use log::warn;
use std::sync::atomic::Ordering;
use tokio::sync::broadcast;

pub const HACKRF_DISCONNECT_ADVISORY: &str =
  "HackRF One disconnected. Avoid unplugging and replugging during use; some firmware versions can take 15-20 seconds or stall before USB reattaches. Keep it connected while working, try the HackRF reset button and wait for the USB LED, and update the HackRF firmware if this repeats.";

pub fn broadcast_source_status(
  shared: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  status: &str,
) {
  let payload = serde_json::json!({
    "type": "status",
    "source_id": active_source_id(shared),
    "status": status,
    "loading_attempt": shared.recovery_attempts.load(Ordering::Relaxed),
    "loading_attempt_max": crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
  });
  let payload = payload.to_string();
  let mut last_payload = shared.last_broadcast_status.lock().unwrap();
  if last_payload.as_ref() == Some(&payload) {
    return;
  }
  *last_payload = Some(payload.clone());
  let _ = broadcast_tx.send(payload);
}

pub fn broadcast_channels(
  shared: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) {
  let payload = build_channels_snapshot(shared);
  let payload = payload.to_string();
  let mut last_payload = shared.last_broadcast_status.lock().unwrap();
  if last_payload.as_ref() == Some(&payload) {
    return;
  }
  *last_payload = Some(payload.clone());
  let _ = broadcast_tx.send(payload);
}

pub fn build_channels_snapshot(shared: &SharedState) -> serde_json::Value {
  let channels = shared.channels.lock().unwrap().clone();
  let active_signal_area =
    channels.first().map(|channel| channel.label.clone());
  serde_json::json!({
    "type": "channels",
    "source_id": active_source_id(shared),
    "channels": channels,
    "active_signal_area": active_signal_area,
    "error": serde_json::Value::Null,
  })
}

pub fn broadcast_signal_display_settings(
  shared: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  sample_rate: u32,
  fft_size: usize,
  frame_rate: u32,
) {
  let payload = serde_json::json!({
    "type": "signal_display_settings",
    "source_id": active_source_id(shared),
    "sample_rate": sample_rate,
    "fft_size": fft_size,
    "frame_rate": frame_rate,
  });
  let payload = payload.to_string();
  let mut last_payload = shared.last_broadcast_status.lock().unwrap();
  if last_payload.as_ref() == Some(&payload) {
    return;
  }
  *last_payload = Some(payload.clone());
  let _ = broadcast_tx.send(payload);
}

pub fn reconcile_stale_device_snapshot(shared: &SharedState) -> bool {
  let device_profile = shared.device_profile.lock().unwrap().clone();
  if device_profile.kind.starts_with("mock_") {
    return false;
  }

  #[cfg(test)]
  let supported_device_present = false;
  #[cfg(not(test))]
  let supported_device_present = match supported_usb_device_count() {
    Ok(count) => count > 0,
    Err(e) => {
      warn!(
        "USB reconciliation probe failed, keeping current status: {}",
        e
      );
      return false;
    }
  };

  if supported_device_present {
    return false;
  }

  shared.update_device_status(
    false,
    "Mock APT SDR".to_string(),
    build_device_profile("mock_apt"),
  );
  if device_profile.kind == "hackrf_one" {
    shared
      .set_device_backend_error(Some(HACKRF_DISCONNECT_ADVISORY.to_string()));
  } else {
    shared.set_device_backend_error(None);
  }
  true
}

/// Build and broadcast a device status message so all connected WebSocket
/// clients immediately learn about hotplug / unplug events.
pub fn broadcast_device_status(
  shared: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) {
  let msg = build_source_info_snapshot(shared);
  let payload = msg.to_string();
  let mut last_payload = shared.last_broadcast_status.lock().unwrap();
  if last_payload.as_ref() == Some(&payload) {
    return;
  }
  *last_payload = Some(payload.clone());
  let _ = broadcast_tx.send(payload);

  // Also broadcast the active source to propagate changes
  broadcast_active_source(shared, broadcast_tx);
}

pub fn broadcast_active_source(
  shared: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) {
  let active_id = active_source_id(shared);
  let paused = shared.is_paused.load(Ordering::SeqCst);
  let payload = serde_json::json!({
    "type": "active_source",
    "source_id": active_id,
    "source_mode": if paused { "file" } else { "live" },
  });
  let _ = broadcast_tx.send(payload.to_string());
}
