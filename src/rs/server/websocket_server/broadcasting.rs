use super::sources::{
  active_source_id, build_device_profile, build_signals_defaults_snapshot,
  build_source_info_snapshot,
};
use crate::server::shared_state::SharedState;
use std::sync::atomic::Ordering;
use tokio::sync::broadcast;

pub const HACKRF_DISCONNECT_ADVISORY: &str =
  "HackRF One disconnected. Avoid unplugging and replugging during use; some firmware versions can take 15-20 seconds or stall before USB reattaches. Keep it connected while working, try the HackRF reset button and wait for the USB LED, and update the HackRF firmware if this repeats.";

pub fn build_source_status_payload(
  source_id: &str,
  status: &str,
  loading_attempt: u32,
  stream_epoch: u64,
) -> serde_json::Value {
  serde_json::json!({
    "type": "status",
    "source_id": source_id,
    "status": status,
    "loading_attempt": loading_attempt,
    "loading_attempt_max": crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
    "stream_epoch": stream_epoch,
  })
}

pub fn broadcast_source_status_for_id(
  shared: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  source_id: &str,
  status: &str,
) {
  let payload = build_source_status_payload(
    source_id,
    status,
    shared.recovery_attempts.load(Ordering::Relaxed),
    shared.current_stream_epoch(),
  )
  .to_string();
  let mut last_payload = shared.last_broadcast_status.lock().unwrap();
  if last_payload.as_ref() == Some(&payload) {
    return;
  }
  *last_payload = Some(payload.clone());
  let _ = broadcast_tx.send(payload);
}

pub fn broadcast_source_status(
  shared: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  status: &str,
) {
  broadcast_source_status_for_id(
    shared,
    broadcast_tx,
    &active_source_id(shared),
    status,
  );
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

  if !shared.usb_inventory_known.load(Ordering::Acquire) {
    return false;
  }
  let supported_device_present =
    shared.supported_usb_device_count.load(Ordering::Relaxed) > 0;

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
  let paused = shared.is_source_paused(&active_id);
  let payload = serde_json::json!({
    "type": "active_source",
    "source_id": active_id,
    "source_mode": if paused { "file" } else { "live" },
    "stream_epoch": shared.current_stream_epoch(),
  });
  let _ = broadcast_tx.send(payload.to_string());
}

pub fn broadcast_signals_defaults(broadcast_tx: &broadcast::Sender<String>) {
  let _ = broadcast_tx.send(build_signals_defaults_snapshot().to_string());
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn targeted_loading_status_names_the_source_being_opened() {
    let payload =
      build_source_status_payload("hackrf_one-serial", "loading", 0, 7);
    assert_eq!(payload["source_id"], "hackrf_one-serial");
    assert_eq!(payload["status"], "loading");
    assert_eq!(payload["stream_epoch"], 7);
  }
}
// Hot-reload verification edit 1.
