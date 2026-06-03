//! WebSocket server with SDR processor integration
//! Handles real-time spectrum data streaming to frontend clients
//!
//! # Supported Device Hotplug Behaviour Contract
//!
//! The server MUST satisfy every scenario below without panicking, silently
//! swallowing errors, or leaving the frontend in an unknown state.
//!
//! ## Plug In (device appears on USB)
//! - Asynchronously detected during mock-mode polling.
//! - **Immediately** broadcast `device_state = "loading"` so the frontend
//!   shows a loading indicator before the device is fully initialised.
//! - Attempt to open, initialise, and swap to the real device.
//! - On success → broadcast `device_state = "connected"`.
//! - On failure → remain in mock mode; broadcast `device_state = "disconnected"`.
//!
//! ## Plugged In (stable operation)
//! - The device MUST NOT be dropped due to transient USB glitches.
//! - Health checks use **debounced failure counting** (≥ 3 consecutive
//!   failures required) before declaring the device unhealthy.
//! - A single read timeout or thread hiccup MUST trigger a recovery attempt
//!   (buffer reset + re-init), **not** an immediate fallback to mock.
//!
//! ## Device Stalled (async thread died but USB still present)
//! - Detected when `is_healthy()` returns false but `get_device_count() > 0`.
//! - Asynchronously send a restart command to re-initialise the device.
//! - Broadcast `device_state = "loading"` with `loading_reason = "restart"`.
//! - On success → `"connected"`. On failure → fall back to mock.
//!
//! ## Plugged Out (device physically removed)
//! - Detected via health-check failure **and** `get_device_count() == 0`.
//! - **Immediately** broadcast `device_state = "disconnected"` and swap to
//!   mock so the frontend never shows a stale/hanging state.
//! - The mock stream MUST start producing frames within one loop iteration.
//!
//! ## Hot Plug (rapid plug-in / plug-out cycles)
//! - Every state transition MUST be fault-tolerant: a failed swap to mock or
//!   a failed swap to real hardware must not crash or leave the processor in
//!   an inconsistent state.
//! - No silent failures — every swap error is logged at `error!` level.
//! - The mock device is the ultimate fallback and MUST always succeed.
//!
//! ## Plugged In Constantly (long-running stable session)
//! - The device must never be dropped while it is healthy.
//! - Debounced health checks prevent false-positive disconnections from
//!   minor physical disturbances or momentary USB bus resets.

use anyhow::Result;
use log::{debug, error, info, warn};
use std::ffi::CStr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use super::shared_state::SharedState;
use super::types::{DeviceProfile, PowerScale, SpectrumData};
use super::utils::{
  device_config_key, reconcile_device_state,
  resolve_device_sample_rate_options, status_device_name,
};
use crate::sdr::hotplug::{
  is_recovery_budget_exhausted, supported_usb_device_count,
};
#[cfg(has_hackrf)]
use crate::sdr::hackrf::device::HackRfDevice;
use crate::sdr::rtlsdr::{device::RtlSdrDevice, ffi as rtlsdr_ffi};
use crate::sdr::processor::SdrProcessor;
#[cfg(has_hackrf)]
use crate::sdr::hackrf::ffi as hackrf_ffi;

const HACKRF_DISCONNECT_ADVISORY: &str =
  "HackRF One disconnected. Avoid unplugging and replugging during use; some firmware versions can take 15-20 seconds or stall before USB reattaches. Keep it connected while working, try the HackRF reset button and wait for the USB LED, and update the HackRF firmware if this repeats.";

fn sanitize_source_component(value: &str) -> String {
  let mut sanitized = String::with_capacity(value.len());
  for ch in value.chars() {
    if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
      sanitized.push(ch);
    } else {
      sanitized.push('_');
    }
  }

  let trimmed = sanitized.trim_matches('_');
  if trimmed.is_empty() {
    "unknown".to_string()
  } else {
    trimmed.to_string()
  }
}

fn source_id_for_device(
  kind: &str,
  serial_number: Option<&str>,
  fallback_index: usize,
) -> String {
  if let Some(serial_number) = serial_number {
    let serial_number = serial_number.trim();
    if !serial_number.is_empty() {
      return sanitize_source_component(&format!("{kind}-{serial_number}"));
    }
  }

  sanitize_source_component(&format!("{kind}-{fallback_index}"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceSelection {
  MockApt,
  RtlSdr(u32),
  #[cfg(has_hackrf)]
  HackRf(i32),
}

fn resolve_source_selection(source_id: &str) -> Result<SourceSelection> {
  if source_id == "mock-apt" {
    return Ok(SourceSelection::MockApt);
  }

  let rtl_count = RtlSdrDevice::get_device_count();
  for index in 0..rtl_count {
    let (serial, _, _) = read_rtl_usb_strings(index);
    if source_id_for_device("rtl-sdr", Some(&serial), index as usize)
      == source_id
    {
      return Ok(SourceSelection::RtlSdr(index));
    }
  }

  #[cfg(has_hackrf)]
  unsafe {
    if hackrf_ffi::hackrf_init() != 0 {
      return Err(anyhow::anyhow!(
        "Failed to initialize HackRF device list for source selection"
      ));
    }

    let list = hackrf_ffi::hackrf_device_list();
    if list.is_null() {
      let _ = hackrf_ffi::hackrf_exit();
      return Err(anyhow::anyhow!(
        "No HackRF One device list available for source selection"
      ));
    }

    let devicecount = (*list).devicecount.max(0) as usize;
    for index in 0..devicecount {
      let serial_number = if !(*list).serial_numbers.is_null() {
        let serial_ptr = *(*list).serial_numbers.add(index);
        if serial_ptr.is_null() {
          String::new()
        } else {
          CStr::from_ptr(serial_ptr).to_string_lossy().into_owned()
        }
      } else {
        String::new()
      };

      if source_id_for_device(
        "hackrf_one",
        Some(&serial_number),
        index,
      ) == source_id
      {
        hackrf_ffi::hackrf_device_list_free(list);
        let _ = hackrf_ffi::hackrf_exit();
        return Ok(SourceSelection::HackRf(index as i32));
      }
    }

    hackrf_ffi::hackrf_device_list_free(list);
    let _ = hackrf_ffi::hackrf_exit();
  }

  Err(anyhow::anyhow!(
    "No matching source found for source_id={source_id}"
  ))
}

fn open_device_for_source_id(
  source_id: &str,
) -> Result<Box<dyn crate::sdr::SdrDevice>> {
  match resolve_source_selection(source_id)? {
    SourceSelection::MockApt => Ok(crate::sdr::SdrDeviceFactory::create_mock_device()),
    SourceSelection::RtlSdr(index) => {
      Ok(Box::new(RtlSdrDevice::open(index)?))
    }
    #[cfg(has_hackrf)]
    SourceSelection::HackRf(index) => {
      Ok(Box::new(HackRfDevice::open(index)?))
    }
  }
}

fn source_capability_for_kind(kind: &str) -> &'static str {
  match kind {
    "mock_apt" | "mock_apt_metal" => "mock",
    "hackrf_one" => "tx_rx",
    _ => "rx",
  }
}

fn source_status_for_entry(
  is_active_source: bool,
  device_state: &str,
  kind: &str,
) -> &'static str {
  if kind.starts_with("mock_apt") {
    "streaming"
  } else if is_active_source {
    match device_state {
      "loading" => "loading",
      "disconnected" => "disconnected",
      "stale" => "stale",
      "error" => "error",
      "transmitting" => "transmitting",
      _ => "connected",
    }
  } else {
    "connected"
  }
}

fn read_rtl_usb_strings(index: u32) -> (String, String, String) {
  let mut manufacturer = [0i8; 256];
  let mut product = [0i8; 256];
  let mut serial = [0i8; 256];

  let ret = unsafe {
    rtlsdr_ffi::rtlsdr_get_device_usb_strings(
      index,
      manufacturer.as_mut_ptr(),
      product.as_mut_ptr(),
      serial.as_mut_ptr(),
    )
  };
  if ret != 0 {
    return (String::new(), String::new(), String::new());
  }

  let manufacturer = unsafe { CStr::from_ptr(manufacturer.as_ptr()) }
    .to_string_lossy()
    .into_owned();
  let product = unsafe { CStr::from_ptr(product.as_ptr()) }
    .to_string_lossy()
    .into_owned();
  let serial = unsafe { CStr::from_ptr(serial.as_ptr()) }
    .to_string_lossy()
    .into_owned();
  (serial, manufacturer, product)
}

fn build_source_payload(
  shared: &SharedState,
  source_id: String,
  name: String,
  kind: &str,
  device_state: &str,
  loading_attempt: u32,
  loading_attempt_max: u32,
  serial_number: String,
  manufacturer: String,
  product: String,
  device_info: String,
  device_connected: bool,
  is_active_source: bool,
) -> serde_json::Value {
  let device_profile = build_device_profile(kind);
  let sdr_settings = shared.sdr_settings.lock().unwrap().clone();
  let (max_sample_rate, sample_rate_options) = resolve_device_sample_rate_options(
    device_connected,
    &device_info,
    &device_profile,
    &sdr_settings,
  );
  let device_limits = sdr_settings
    .devices
    .get(device_config_key(&device_profile))
    .and_then(|device_cfg| device_cfg.fft_display.as_ref())
    .map(|display| display.resolve_markers())
    .unwrap_or_default();

  serde_json::json!({
    "id": source_id,
    "name": name,
    "kind": kind,
    "capability": source_capability_for_kind(kind),
    "status": source_status_for_entry(is_active_source, device_state, kind),
    "loading_attempt": loading_attempt,
    "loading_attempt_max": loading_attempt_max,
    "supports_approx_dbm": device_profile.supports_approx_dbm,
    "supports_raw_iq_stream": device_profile.supports_raw_iq_stream,
    "serial_number": serial_number,
    "manufacturer": manufacturer,
    "product": product,
    "sdr": {
      "max_sample_rate": max_sample_rate,
      "sample_rate_options": sample_rate_options,
      "fft_display": { "markers": device_limits },
      "settings": {
        "fft": sdr_settings.fft,
        "display": sdr_settings.display,
        "devices": sdr_settings.devices,
        "fft_sizes": sdr_settings.fft_sizes,
        "fft_size": sdr_settings.fft.default_size,
        "fft_window": "Rectangular",
        "frame_rate": sdr_settings.fft.default_frame_rate,
        "sample_rate": sdr_settings.sample_rate,
        "center_frequency": sdr_settings.center_frequency,
        "gain": sdr_settings.gain.tuner_gain,
        "hackrf_lna_gain": sdr_settings.gain.hackrf_lna_gain,
        "hackrf_vga_gain": sdr_settings.gain.hackrf_vga_gain,
        "hackrf_amp_enable": sdr_settings.gain.hackrf_amp_enable,
        "ppm": sdr_settings.ppm,
        "tuner_agc": sdr_settings.gain.tuner_agc,
        "rtl_agc": sdr_settings.gain.rtl_agc,
        "tuner_bandwidth": sdr_settings.gain.tuner_bandwidth,
      }
    }
  })
}

fn build_active_source_payload(
  shared: &SharedState,
  source_id: String,
  device_state: &str,
  loading_attempt: u32,
  loading_attempt_max: u32,
) -> serde_json::Value {
  let device_profile = shared.device_profile.lock().unwrap().clone();
  let device_info = shared.device_info.lock().unwrap().clone();
  let device_serial = shared.device_serial.lock().unwrap().clone();
  let device_manufacturer = shared.device_manufacturer.lock().unwrap().clone();
  let device_product = shared.device_product.lock().unwrap().clone();
  let device_name = if device_profile.kind.starts_with("mock_apt") {
    "Mock APT SDR".to_string()
  } else {
    status_device_name(true, &device_info, &device_profile)
  };

  build_source_payload(
    shared,
    source_id,
    device_name,
    &device_profile.kind,
    device_state,
    loading_attempt,
    loading_attempt_max,
    device_serial,
    device_manufacturer,
    device_product,
    device_info,
    shared.device_connected.load(Ordering::Relaxed),
    true,
  )
}

fn enumerate_rtl_sdr_sources(
  shared: &SharedState,
  active_source_id: &str,
) -> Vec<serde_json::Value> {
  let mut sources = Vec::new();
  let count = RtlSdrDevice::get_device_count();
  for index in 0..count {
    let device_name = RtlSdrDevice::get_device_name(index);
    let (serial, manufacturer, product) = read_rtl_usb_strings(index);
    let source_id = source_id_for_device("rtl-sdr", Some(&serial), index as usize);
    if source_id == active_source_id {
      continue;
    }

    let source_name = status_device_name(
      true,
      if product.trim().is_empty() {
        &device_name
      } else {
        &product
      },
      &build_device_profile("rtl-sdr"),
    );
    sources.push(build_source_payload(
      shared,
      source_id,
      source_name,
      "rtl-sdr",
      "connected",
      0,
      crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
      serial,
      manufacturer,
      product,
      device_name,
      true,
      false,
    ));
  }
  sources
}

#[cfg(has_hackrf)]
fn enumerate_hackrf_sources(
  shared: &SharedState,
  active_source_id: &str,
) -> Vec<serde_json::Value> {
  let mut sources = Vec::new();
  unsafe {
    if hackrf_ffi::hackrf_init() != 0 {
      warn!("Failed to initialize HackRF device list for source inventory");
      return sources;
    }

    let list = hackrf_ffi::hackrf_device_list();
    if list.is_null() {
      let _ = hackrf_ffi::hackrf_exit();
      return sources;
    }

    let devicecount = (*list).devicecount.max(0) as usize;
    for index in 0..devicecount {
      let serial_number = if !(*list).serial_numbers.is_null() {
        let serial_ptr = *(*list).serial_numbers.add(index);
        if serial_ptr.is_null() {
          String::new()
        } else {
          CStr::from_ptr(serial_ptr).to_string_lossy().into_owned()
        }
      } else {
        String::new()
      };

      let source_id = source_id_for_device(
        "hackrf_one",
        Some(&serial_number),
        index,
      );
      if source_id == active_source_id {
        continue;
      }

      let source_name = status_device_name(
        true,
        "HackRF One",
        &build_device_profile("hackrf_one"),
      );
      sources.push(build_source_payload(
        shared,
        source_id,
        source_name,
        "hackrf_one",
        "connected",
        0,
        crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
        serial_number,
        String::new(),
        "HackRF One".to_string(),
        "HackRF One".to_string(),
        true,
        false,
      ));
    }

    hackrf_ffi::hackrf_device_list_free(list);
    let _ = hackrf_ffi::hackrf_exit();
  }

  sources
}

pub(crate) fn build_source_info_snapshot(
  shared: &SharedState,
) -> serde_json::Value {
  let device_connected = shared.device_connected.load(Ordering::Relaxed);
  let device_state = reconcile_device_state(
    device_connected,
    &shared.device_state.lock().unwrap(),
  );
  let device_loading_attempt = shared.recovery_attempts.load(Ordering::Relaxed);
  let paused = shared.is_paused.load(Ordering::SeqCst);
  let mut sources = Vec::new();
  let active_source_id = active_source_id(shared);
  let active_source = build_active_source_payload(
    shared,
    active_source_id.clone(),
    &device_state,
    device_loading_attempt,
    crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
  );

  sources.push(active_source);
  sources.extend(enumerate_rtl_sdr_sources(shared, &active_source_id));
  #[cfg(has_hackrf)]
  {
    sources.extend(enumerate_hackrf_sources(shared, &active_source_id));
  }

  serde_json::json!({
    "type": "source_info",
    "active_source": active_source_id,
    "active_source_mode": if paused { "file" } else { "live" },
    "sources": sources,
  })
}

pub(crate) fn active_source_id(shared: &SharedState) -> String {
  let device_profile = shared.device_profile.lock().unwrap().clone();
  if device_profile.kind.starts_with("mock_apt") {
    return "mock-apt".to_string();
  }

  let device_serial = shared.device_serial.lock().unwrap().clone();
  if !device_serial.trim().is_empty() {
    return source_id_for_device(&device_profile.kind, Some(&device_serial), 0);
  }

  source_id_for_device(&device_profile.kind, None, 0)
}

pub(crate) fn broadcast_source_status(
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

pub(crate) fn broadcast_channels(
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

pub(crate) fn build_channels_snapshot(
  shared: &SharedState,
) -> serde_json::Value {
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

pub(crate) fn broadcast_signal_display_settings(
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

pub(crate) fn reconcile_stale_device_snapshot(shared: &SharedState) -> bool {
  let device_profile = shared.device_profile.lock().unwrap().clone();
  if device_profile.kind.starts_with("mock_apt") {
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
pub(crate) fn broadcast_device_status(
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

pub(crate) fn broadcast_active_source(
  shared: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) {
  let active_id = active_source_id(shared);
  let paused = shared.is_paused.load(Ordering::SeqCst);
  let payload = serde_json::json!({
    "type": "active_source",
    "active_source": active_id,
    "active_source_mode": if paused { "file" } else { "live" },
  });
  let _ = broadcast_tx.send(payload.to_string());
}

pub(crate) fn build_device_profile(device_type: &str) -> DeviceProfile {
  match device_type.to_lowercase().as_str() {
    "rtl-sdr" | "rtl_sdr" => DeviceProfile {
      kind: "rtl-sdr".to_string(),
      is_rtl_sdr: true,
      supports_approx_dbm: true,
      supports_raw_iq_stream: true,
    },
    "hackrf_one" | "hackrf" => DeviceProfile {
      kind: "hackrf_one".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      supports_raw_iq_stream: true,
    },
    _ => DeviceProfile {
      kind: "mock_apt".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      supports_raw_iq_stream: true,
    },
  }
}

#[derive(Clone)]
pub struct WebSocketServer {
  sdr_processor: Arc<Mutex<SdrProcessor>>,
  shared_state: Arc<SharedState>,
  broadcast_tx: broadcast::Sender<String>,
  spectrum_tx: broadcast::Sender<Arc<SpectrumData>>,
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

    let hotplug_monitor = crate::sdr::hotplug::HotplugMonitor::new()
      .expect("Failed to create hotplug monitor");
    let _ = hotplug_monitor.start();
    let mut hotplug_state = crate::sdr::hotplug::HotplugState::new();
    let mut target_fps: u32 = 30; // sensible default until first frame
    let mut allow_next_paused_frame = false;

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
    }

    loop {
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
            allow_next_paused_frame = true;
          }
          crate::server::types::SdrCommand::SetFrequency(freq) => {
            // Frequency change is fast (just sets a pending field), so use brief lock
            let mut processor = sdr_processor.lock().await;
            if processor.capture_active {
              log::debug!("Ignoring SetFrequency during active capture");
            } else {
              processor.queue_center_frequency(freq);
            }
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
          crate::server::types::SdrCommand::SetActiveSource { source_id } => {
            let mut processor = sdr_processor.lock().await;
            let current_source_id = active_source_id(&shared_state);
            if current_source_id == source_id {
              debug!(
                "SetActiveSource requested for current source {}, skipping",
                source_id
              );
              broadcast_device_status(&shared_state, &_broadcast_tx);
              continue;
            }

            info!("Switching active source to {}", source_id);
            shared_state.set_device_state("loading", Some("connect"));
            broadcast_device_status(&shared_state, &_broadcast_tx);

            match open_device_for_source_id(&source_id) {
              Ok(new_device) => {
                if let Err(e) = processor.swap_device(new_device) {
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
                  shared_state.set_device_backend_error(processor.get_error());
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                } else {
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

            // Auto-unpause for capture
            shared_state.is_paused.store(false, Ordering::SeqCst);

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
        }
      }

      // If the stream is paused by the client, don't read from SDR or broadcast
      // unless the frontend explicitly requested one fresh frame.
      if shared_state.is_paused.load(Ordering::SeqCst)
        && !allow_next_paused_frame
      {
        tokio::time::sleep(Duration::from_millis(100)).await;
        continue;
      }
      allow_next_paused_frame = false;

      // 2. Read and process one frame from SDR
      let process_result = {
        let cloned_processor = sdr_processor.clone();
        let cloned_shared = shared_state.clone();
        tokio::task::spawn_blocking(
            move || -> Result<(Vec<f32>, i64, u32, bool, String, PowerScale, u32, Vec<u8>, u32)> {
              let mut processor = cloned_processor.blocking_lock();

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

              let force_noise =
                cloned_shared.force_noise.load(std::sync::atomic::Ordering::Relaxed);
              let waveform =
                processor.read_and_process_frame_with_noise(force_noise)?;
              let timestamp = chrono::Utc::now().timestamp_millis();
              let center_frequency = processor.get_center_frequency();
              let is_mock_apt = processor.device_type().contains("Mock");
              let device_type = processor.device_type().to_string();
              let power_scale = processor.get_power_scale();
              let sample_rate = {
                let processor_sample_rate = processor.get_sample_rate();
                if processor_sample_rate == 0 {
                  cloned_shared.sdr_settings.lock().unwrap().sample_rate.max(1)
                } else {
                  processor_sample_rate
                }
              };
              let raw_iq = processor.frame.last_frame_raw_iq.clone();
              let fps = processor.display_frame_rate;
              Ok((
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
          if !is_mock_apt {
            shared_state.record_successful_read();
            let current_state =
              shared_state.device_state.lock().unwrap().clone();
            if current_state != "connected" {
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

          let spectrum_message = SpectrumData {
            message_type: "spectrum".to_string(),
            waveform: Vec::new(),
            is_mock_apt,
            center_frequency_hz: Some(center_frequency),
            waveform_span_hz: None,
            timestamp,
            data_type: Some("iq_raw".to_string()),
            sample_rate: Some(sample_rate),
            power_scale: Some(power_scale),
            iq_data: raw_iq,
          };

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
              let supported_device_present =
                matches!(supported_usb_device_count(), Ok(count) if count > 0);
              if !supported_device_present {
                warn!(
                  "Supported USB device unplugged after read error. Falling back to mock immediately."
                );
                let was_hackrf = processor.device_type() == "hackrf_one";
                shared_state.set_device_state("disconnected", None);
                if was_hackrf {
                  shared_state.set_device_backend_error(Some(
                    HACKRF_DISCONNECT_ADVISORY.to_string(),
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
                  shared_state.update_device_status(
                    false,
                    processor.get_device_info(),
                    build_device_profile(processor.device_type()),
                  );
                  if was_hackrf {
                    shared_state.set_device_backend_error(Some(
                      HACKRF_DISCONNECT_ADVISORY.to_string(),
                    ));
                  } else {
                    shared_state
                      .set_device_backend_error(processor.get_error());
                  }
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                }
              } else if !is_recovery_budget_exhausted(
                recovery_count,
                super::shared_state::MAX_RECOVERY_ATTEMPTS,
              ) {
                shared_state
                  .recovery_attempts
                  .fetch_add(1, Ordering::Relaxed);
                shared_state.set_device_state("loading", Some("restart"));
                broadcast_device_status(&shared_state, &_broadcast_tx);

                warn!(
                  "Attempting recovery after read error (attempt {} of {})...",
                  recovery_count + 1,
                  super::shared_state::MAX_RECOVERY_ATTEMPTS
                );
                if let Err(reset_err) = processor.reset_buffer() {
                  warn!(
                    "Buffer reset during read-error recovery failed: {}",
                    reset_err
                  );
                }
                if let Err(reinit_err) = processor.initialize() {
                  warn!(
                    "Re-init during read-error recovery failed: {}",
                    reinit_err
                  );
                } else {
                  // Don't declare "connected" yet — the next health-check
                  // or successful frame read will confirm recovery.
                  info!("Read-error re-init succeeded, awaiting health confirmation...");
                  hotplug_state.last_hardware_swap = Some(Instant::now());
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

              // Brief settle regardless
              tokio::time::sleep(Duration::from_millis(100)).await;
            } else {
              // Threshold reached — immediate fallback
              let supported_device_present =
                matches!(supported_usb_device_count(), Ok(count) if count > 0);
              warn!(
                  "Read-error threshold reached (streak={}). Supported USB device present={}.",
                  streak, supported_device_present,
                );
              if supported_device_present {
                shared_state.set_device_state("loading", Some("restart"));
                broadcast_device_status(&shared_state, &_broadcast_tx);

                match crate::sdr::SdrDeviceFactory::create_device() {
                  Ok(new_device)
                    if !new_device
                      .device_type()
                      .to_ascii_lowercase()
                      .contains("mock") =>
                  {
                    if let Err(swap_e) = processor.swap_device(new_device) {
                      error!(
                        "Failed to swap to preferred device on read error: {}",
                        swap_e
                      );
                    } else {
                      shared_state.update_device_status(
                        true,
                        processor.get_device_info(),
                        build_device_profile(processor.device_type()),
                      );
                      shared_state
                        .set_device_backend_error(processor.get_error());
                      broadcast_device_status(&shared_state, &_broadcast_tx);
                      hotplug_state.last_hardware_swap = Some(Instant::now());
                    }
                  }
                  _ => {
                    let mock_device =
                      crate::sdr::SdrDeviceFactory::create_mock_device();
                    if let Err(swap_e) = processor.swap_device(mock_device) {
                      error!(
                        "Failed to swap to mock on read error: {}",
                        swap_e
                      );
                    } else {
                      shared_state.update_device_status(
                        false,
                        processor.get_device_info(),
                        build_device_profile(processor.device_type()),
                      );
                      shared_state
                        .set_device_backend_error(processor.get_error());
                      broadcast_device_status(&shared_state, &_broadcast_tx);
                      hotplug_state.last_hardware_swap = Some(Instant::now());
                    }
                  }
                }
              } else {
                let was_hackrf = processor.device_type() == "hackrf_one";
                shared_state.set_device_state("disconnected", None);
                if was_hackrf {
                  shared_state.set_device_backend_error(Some(
                    HACKRF_DISCONNECT_ADVISORY.to_string(),
                  ));
                }
                broadcast_device_status(&shared_state, &_broadcast_tx);

                let mock_device =
                  crate::sdr::SdrDeviceFactory::create_mock_device();
                if let Err(swap_e) = processor.swap_device(mock_device) {
                  error!("Failed to swap to mock on read error: {}", swap_e);
                } else {
                  shared_state.update_device_status(
                    false,
                    processor.get_device_info(),
                    build_device_profile(processor.device_type()),
                  );
                  if was_hackrf {
                    shared_state.set_device_backend_error(Some(
                      HACKRF_DISCONNECT_ADVISORY.to_string(),
                    ));
                  } else {
                    shared_state
                      .set_device_backend_error(processor.get_error());
                  }
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                  hotplug_state.last_hardware_swap = Some(Instant::now());
                }
              }
              hotplug_state.last_failure_at = Some(Instant::now());
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
        tokio::time::sleep(target_duration - elapsed).await;
      }
    }
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
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::sdr::hotplug::{
    is_recovery_budget_exhausted, should_enter_hardware_recovery,
    should_probe_for_hotplug,
  };
  use serial_test::serial;

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
      crate::server::shared_state::MAX_RECOVERY_ATTEMPTS
    );
  }

  #[test]
  #[serial]
  fn broadcast_device_status_includes_websocket_payload_fields() {
    let _guard = crate::server::utils::cwd_lock().lock().expect("cwd lock");
    crate::server::utils::clear_signals_config_cache();
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
        supports_raw_iq_stream: true,
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
    assert_eq!(payload["sources"][0]["status"], "connected");
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
    let _guard = crate::server::utils::cwd_lock().lock().expect("cwd lock");
    crate::server::utils::clear_signals_config_cache();
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
  fn broadcast_device_status_reports_hackrf_one_without_rtl_sdr_fallback() {
    let _guard = crate::server::utils::cwd_lock().lock().expect("cwd lock");
    crate::server::utils::clear_signals_config_cache();
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
        supports_raw_iq_stream: true,
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
  fn source_info_snapshot_contains_all_sources() {
    let _guard = crate::server::utils::cwd_lock().lock().expect("cwd lock");
    crate::server::utils::clear_signals_config_cache();
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
        supports_raw_iq_stream: true,
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
