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
  let mut last_payload = shared.last_broadcast_channels.lock().unwrap();
  if last_payload.as_ref() == Some(&payload) {
    return;
  }
  *last_payload = Some(payload.clone());
  let _ = broadcast_tx.send(payload);
}

pub fn build_channels_snapshot(shared: &SharedState) -> serde_json::Value {
  let channels = shared.channels.lock().unwrap().clone();
  let active_signal_area = shared
    .active_signal_area()
    .or_else(|| channels.first().map(|channel| channel.label.clone()));
  let frequency_range = shared
    .active_frequency_range()
    .map(|(min, max)| serde_json::json!({ "min": min, "max": max }));
  let sample_rate = shared.sdr_settings.lock().unwrap().sample_rate;
  let origin_id = shared.last_tune_origin_id.lock().unwrap().clone();
  serde_json::json!({
    "type": "channels",
    "source_id": active_source_id(shared),
    "channels": channels,
    "active_signal_area": active_signal_area,
    "frequency_range": frequency_range,
    "sample_rate": sample_rate,
    "origin_id": origin_id,
    "error": serde_json::Value::Null,
  })
}

/// Broadcast the full device settings snapshot so every subscriber adopts the
/// same device-scoped configuration (FFT size/frame rate, sample rate, gain,
/// PPM, AGC, baseband filter). The FFT window is a local viewer choice and is
/// intentionally not included, as are temporal resolution, DC spike removal,
/// power scale, display mode, and zoom/pan.
pub fn broadcast_signal_display_settings(
  shared: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  sample_rate: u32,
  fft_size: usize,
  frame_rate: u32,
) {
  let sdr_settings = shared.sdr_settings.lock().unwrap();
  let payload = serde_json::json!({
    "type": "signal_display_settings",
    "source_id": active_source_id(shared),
    "sample_rate": sample_rate,
    "fft_size": fft_size,
    "frame_rate": frame_rate,
    "gain": sdr_settings.gain.tuner_gain,
    "hackrf_lna_gain": sdr_settings.gain.hackrf_lna_gain,
    "hackrf_vga_gain": sdr_settings.gain.hackrf_vga_gain,
    "hackrf_amp_enable": sdr_settings.gain.hackrf_amp_enable,
    "tuner_bandwidth": sdr_settings.gain.tuner_bandwidth,
    "ppm": sdr_settings.ppm,
    "tuner_agc": sdr_settings.gain.tuner_agc,
    "rtl_agc": sdr_settings.gain.rtl_agc,
  });
  drop(sdr_settings);
  // A settings broadcast is a state change, not a status heartbeat: it must
  // reach every client even when the previous broadcast carried the same
  // sample_rate/fft_size/frame_rate triple (e.g. a gain-only change).
  let _ = broadcast_tx.send(payload.to_string());
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
  use serial_test::serial;

  #[test]
  fn targeted_loading_status_names_the_source_being_opened() {
    let payload =
      build_source_status_payload("hackrf_one-serial", "loading", 0, 7);
    assert_eq!(payload["source_id"], "hackrf_one-serial");
    assert_eq!(payload["status"], "loading");
    assert_eq!(payload["stream_epoch"], 7);
  }

  #[test]
  #[serial]
  fn unchanged_channels_snapshot_is_not_rebroadcast_after_status_snapshot() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let shared = SharedState::new("redis://127.0.0.1/");
    let (broadcast_tx, mut broadcast_rx) = broadcast::channel(8);

    broadcast_channels(&shared, &broadcast_tx);
    let _ = broadcast_rx.try_recv().expect("initial channels snapshot");

    broadcast_source_status(&shared, &broadcast_tx, "connected");
    let _ = broadcast_rx.try_recv().expect("status snapshot");

    broadcast_channels(&shared, &broadcast_tx);
    assert!(broadcast_rx.try_recv().is_err());
  }

  #[test]
  #[serial]
  fn signal_display_settings_broadcast_carries_device_settings_only() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let shared = SharedState::new("redis://127.0.0.1/");
    {
      let mut settings = shared.sdr_settings.lock().unwrap();
      settings.gain.tuner_gain = 18.5;
      settings.gain.tuner_agc = true;
      settings.gain.rtl_agc = false;
      settings.gain.hackrf_lna_gain = Some(8.0);
      settings.gain.hackrf_vga_gain = Some(20.0);
      settings.gain.hackrf_amp_enable = Some(true);
      settings.gain.tuner_bandwidth = Some(5_200_000);
      settings.ppm = 3.0;
    }
    let (broadcast_tx, mut broadcast_rx) = broadcast::channel(8);

    broadcast_signal_display_settings(
      &shared,
      &broadcast_tx,
      5_200_000,
      4096,
      12,
    );
    let raw = broadcast_rx.try_recv().expect("settings broadcast");
    let payload: serde_json::Value = serde_json::from_str(&raw).unwrap();

    assert_eq!(payload["type"], "signal_display_settings");
    assert_eq!(payload["sample_rate"], 5_200_000);
    assert_eq!(payload["fft_size"], 4096);
    assert_eq!(payload["frame_rate"], 12);
    assert_eq!(payload["gain"], 18.5);
    assert_eq!(payload["tuner_agc"], true);
    assert_eq!(payload["rtl_agc"], false);
    assert_eq!(payload["hackrf_lna_gain"], 8.0);
    assert_eq!(payload["hackrf_vga_gain"], 20.0);
    assert_eq!(payload["hackrf_amp_enable"], true);
    assert_eq!(payload["tuner_bandwidth"], 5_200_000);
    assert_eq!(payload["ppm"], 3.0);
    // Local viewer state must never leak into the device broadcast.
    assert!(payload.get("fft_window").is_none());
  }
}
// Hot-reload verification edit 1.
