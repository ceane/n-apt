use anyhow::Result;
use std::ffi::CStr;
use std::sync::atomic::Ordering;

use crate::server::shared_state::SharedState;
use crate::server::types::{DeviceProfile, IqFormat};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceSelection {
  MockApt,
  MockTx,
  RtlSdr(u32),
  #[cfg(has_hackrf)]
  HackRf(i32),
}
use super::complex_baseband::MOCK_TX_DISPLAY_NAME;
#[cfg(has_hackrf)]
use crate::sdr::hackrf::device::HackRfDevice;
#[cfg(not(target_arch = "wasm32"))]
use crate::sdr::rtlsdr::{device::RtlSdrDevice, ffi as rtlsdr_ffi};
use crate::server::utils::{
  device_config_key, reconcile_device_state,
  resolve_device_sample_rate_options, status_device_name,
};

pub fn build_device_profile(device_type: &str) -> DeviceProfile {
  match device_type.to_lowercase().as_str() {
    "rtl-sdr" | "rtl_sdr" => DeviceProfile {
      kind: "rtl-sdr".to_string(),
      is_rtl_sdr: true,
      supports_approx_dbm: true,
      iq_format: Some(IqFormat::default()),
    },
    "hackrf_one" | "hackrf" => DeviceProfile {
      kind: "hackrf_one".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      iq_format: Some(IqFormat::default()),
    },
    "mock_tx" | "mock-tx" => DeviceProfile {
      kind: "mock_tx".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      iq_format: Some(IqFormat::default()),
    },
    _ => DeviceProfile {
      kind: "mock_apt".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      iq_format: Some(IqFormat::default()),
    },
  }
}

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

pub fn resolve_source_selection(
  shared: &SharedState,
  source_id: &str,
) -> Result<SourceSelection> {
  if source_id == "mock-apt" || source_id == "mock_apt" {
    return Ok(SourceSelection::MockApt);
  }
  if source_id == "mock-tx" || source_id == "mock_tx" {
    return Ok(SourceSelection::MockTx);
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
  for device in shared.hackrf_inventory.lock().unwrap().iter() {
    if source_id_for_device(
      "hackrf_one",
      Some(&device.serial_number),
      device.index,
    ) == source_id
    {
      return Ok(SourceSelection::HackRf(device.index as i32));
    }
  }

  Err(anyhow::anyhow!(
    "No matching source found for source_id={source_id}"
  ))
}

pub fn open_device_for_source_id(
  shared: &SharedState,
  source_id: &str,
) -> Result<Box<dyn crate::sdr::SdrDevice>> {
  match resolve_source_selection(shared, source_id)? {
    SourceSelection::MockApt => {
      Ok(crate::sdr::SdrDeviceFactory::create_mock_device())
    }
    SourceSelection::MockTx => {
      Ok(crate::sdr::SdrDeviceFactory::create_mock_device())
    }
    SourceSelection::RtlSdr(index) => Ok(Box::new(RtlSdrDevice::open(index)?)),
    #[cfg(has_hackrf)]
    SourceSelection::HackRf(index) => Ok(Box::new(HackRfDevice::open(index)?)),
  }
}

fn source_capability_for_kind(kind: &str) -> &'static str {
  match kind {
    "mock_apt" | "mock_apt_metal" => "mock",
    "mock_tx" => "tx",
    "hackrf_one" => "tx_rx",
    _ => "rx",
  }
}

fn source_capability_for_kind_and_duplex(
  kind: &str,
  duplex_mode: Option<&str>,
) -> &'static str {
  if kind == "mock_tx" {
    return "tx";
  }
  match duplex_mode.map(|mode| mode.to_ascii_lowercase()) {
    Some(mode) if mode == "full-duplex" || mode == "full_duplex" => "tx_rx",
    Some(mode) if mode == "half-duplex" || mode == "half_duplex" => {
      if is_tx_capable_source_kind(kind) {
        "tx_rx"
      } else {
        "rx"
      }
    }
    _ => source_capability_for_kind(kind),
  }
}

#[cfg(test)]
mod tx_suite_tests {
  use super::super::tx_suite::{resolve_tx_suite_pair, DeviceCapability};
  use serial_test::serial;
  use std::sync::atomic::Ordering;

  #[test]
  fn prefers_dedicated_rx_and_half_duplex_tx_pair() {
    let pair = resolve_tx_suite_pair(&[
      DeviceCapability::new("rx", true, false, false),
      DeviceCapability::new("tx", true, true, false),
    ])
    .expect("pair should resolve");

    assert_eq!(pair.rx_source_id, "rx");
    assert_eq!(pair.tx_source_id, "tx");
    assert_eq!(pair.tx_status, "standby");
  }

  #[test]
  fn uses_one_full_duplex_device_for_both_roles() {
    let pair = resolve_tx_suite_pair(&[DeviceCapability::new(
      "duplex", true, true, true,
    )])
    .expect("duplex pair should resolve");

    assert_eq!(pair.rx_source_id, "duplex");
    assert_eq!(pair.tx_source_id, "duplex");
  }

  #[test]
  fn rejects_tx_only_pair_without_an_rx_source() {
    assert!(resolve_tx_suite_pair(&[DeviceCapability::new(
      "tx", false, true, false
    ),])
    .is_none());
  }

  #[test]
  #[serial]
  fn reports_mock_tx_standby_when_tx_is_not_active() {
    crate::safety::TX_TRANSMITTING
      .store(false, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(
      super::source_status_for_entry(
        true, false, "connected", "mock_tx", false, false,
      ),
      "standby"
    );
  }

  #[test]
  #[serial]
  fn reports_distinct_rx_lifecycle_statuses() {
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    assert_eq!(
      super::source_status_for_entry(
        true, false, "connected", "hackrf_one", true, true,
      ),
      "receiving"
    );
    assert_eq!(
      super::source_status_for_entry(
        true, true, "connected", "hackrf_one", true, true,
      ),
      "paused"
    );
    assert_eq!(
      super::source_status_for_entry(
        true, false, "stale", "hackrf_one", true, false,
      ),
      "stale"
    );
  }

  #[test]
  #[serial]
  fn keeps_physical_rx_in_loading_until_first_frame() {
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    assert_eq!(
      super::source_status_for_entry(
        true, false, "connected", "hackrf_one", false, false,
      ),
      "loading"
    );
    assert_eq!(
      super::source_status_for_entry(
        true, false, "connected", "hackrf_one", true, true,
      ),
      "receiving"
    );
  }

  #[test]
  #[serial]
  fn keeps_mock_rx_in_loading_during_source_connect() {
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    assert_eq!(
      super::source_status_for_entry(
        true, false, "loading", "mock_apt", false, false,
      ),
      "loading"
    );
    assert_eq!(
      super::source_status_for_entry(
        true, false, "connected", "mock_apt", true, true,
      ),
      "receiving"
    );
  }

  #[test]
  #[serial]
  fn does_not_report_receiving_after_frame_liveness_expires() {
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    assert_eq!(
      super::source_status_for_entry(
        true, false, "connected", "hackrf_one", true, false,
      ),
      "stale"
    );
  }

  #[test]
  #[serial]
  fn backend_error_and_active_tx_override_stale_pause_state() {
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    assert_eq!(
      super::source_status_for_entry(
        true, true, "error", "hackrf_one", true, true,
      ),
      "error"
    );

    crate::safety::TX_TRANSMITTING.store(true, Ordering::Relaxed);
    assert_eq!(
      super::source_status_for_entry(
        true, true, "connected", "hackrf_one", true, true,
      ),
      "transmitting"
    );
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
  }
}

fn is_tx_capable_source_kind(kind: &str) -> bool {
  matches!(kind, "hackrf_one" | "mock_tx")
}

fn source_status_for_entry(
  is_active_source: bool,
  is_paused: bool,
  device_state: &str,
  kind: &str,
  has_successful_frame: bool,
  has_recent_successful_frame: bool,
) -> &'static str {
  if device_state == "error" {
    return "error";
  }
  let active_tx_state = is_active_source
    && is_tx_capable_source_kind(kind)
    && crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed);
  if active_tx_state {
    return "transmitting";
  }
  if is_paused {
    if kind == "mock_tx" {
      return "standby";
    }
    return "paused";
  }
  // Loading is a source-agnostic connection phase. Mock APT used to bypass
  // this guard and report `receiving` before its first frame, which made the
  // frontend skip the placeholder and then appear frozen if acquisition was
  // still starting.
  if is_active_source && device_state == "loading" {
    return "loading";
  }
  if kind.starts_with("mock_apt") {
    if is_active_source {
      "receiving"
    } else {
      "connected"
    }
  } else if kind == "mock_tx" {
    if active_tx_state || device_state == "transmitting" {
      "transmitting"
    } else {
      "standby"
    }
  } else if active_tx_state {
    "transmitting"
  } else if is_active_source {
    match device_state {
      "loading" => "loading",
      "disconnected" => "disconnected",
      "stale" => "stale",
      "error" => "error",
      "transmitting" => "transmitting",
      // Hardware discovery/open succeeded, but acquisition has not produced
      // a frame for this epoch yet. Keep the UI in Loading until that proof
      // exists instead of claiming Receiving and triggering a false I/O
      // watchdog error.
      _ if !has_successful_frame => "loading",
      _ if has_recent_successful_frame => "receiving",
      _ => "stale",
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
  device_loading_reason: Option<String>,
  loading_attempt: u32,
  loading_attempt_max: u32,
  serial_number: String,
  manufacturer: String,
  product: String,
  device_info: String,
  device_connected: bool,
  paused: bool,
  is_active_source: bool,
) -> serde_json::Value {
  let device_profile = build_device_profile(kind);
  let sdr_settings = shared.sdr_settings.lock().unwrap().clone();
  let (max_sample_rate, sample_rate_options) =
    resolve_device_sample_rate_options(
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
  let duplex_mode = sdr_settings
    .devices
    .get(device_config_key(&device_profile))
    .and_then(|device_cfg| device_cfg.duplex_mode.as_deref());
  let (has_successful_frame, has_recent_successful_frame) = shared
    .last_successful_read
    .lock()
    .unwrap()
    .map(|timestamp| {
      (
        true,
        timestamp.elapsed() <= std::time::Duration::from_secs(2),
      )
    })
    .unwrap_or((false, false));
  let source_capability =
    source_capability_for_kind_and_duplex(kind, duplex_mode);
  let can_receive = matches!(source_capability, "rx" | "tx_rx" | "mock");
  let can_transmit = matches!(source_capability, "tx" | "tx_rx");
  let supported_controls = [
    ("gain", can_receive),
    ("ppm", can_receive),
    ("sample_rate", can_receive || can_transmit),
    ("frequency", can_receive || can_transmit),
    ("tx_power_dbm", can_transmit),
  ]
  .into_iter()
  .filter_map(|(control, supported)| supported.then_some(control))
  .collect::<Vec<_>>();
  let gain_limits = sdr_settings
    .devices
    .get(device_config_key(&device_profile))
    .and_then(|device_cfg| device_cfg.gain_limits.clone());
  let tx_power_dbm = sdr_settings
    .devices
    .get(device_config_key(&device_profile))
    .and_then(|device_cfg| device_cfg.tx_power_mapping.as_ref())
    .and_then(|mapping| {
      let points = mapping.amp_off.iter().chain(mapping.amp_on.iter());
      let mut min = f64::INFINITY;
      let mut max = f64::NEG_INFINITY;
      for point in points {
        min = min.min(point.dbm);
        max = max.max(point.dbm);
      }
      (min.is_finite() && max.is_finite()).then_some(serde_json::json!({
        "min": min,
        "max": max,
      }))
    });
  let frequency_range = shared
    .available_spectrum
    .map(|(min, max)| serde_json::json!({ "min": min, "max": max }));
  let mut fft_sizes = sdr_settings
    .fft
    .size_to_frame_rate
    .keys()
    .copied()
    .collect::<Vec<_>>();
  if !fft_sizes.contains(&sdr_settings.fft.default_size) {
    fft_sizes.push(sdr_settings.fft.default_size);
  }
  if !fft_sizes.contains(&sdr_settings.fft.max_size) {
    fft_sizes.push(sdr_settings.fft.max_size);
  }
  fft_sizes.sort_unstable();

  serde_json::json!({
    "id": source_id,
    "name": name,
    "kind": kind,
    "capability": source_capability_for_kind_and_duplex(kind, duplex_mode),
    "duplex_mode": duplex_mode,
    "status": source_status_for_entry(
      is_active_source,
      paused,
      device_state,
      kind,
      has_successful_frame,
      has_recent_successful_frame,
    ),
    "paused": paused,
    "device_loading_reason": device_loading_reason,
    "loading_attempt": loading_attempt,
    "loading_attempt_max": loading_attempt_max,
    "supports_approx_dbm": device_profile.supports_approx_dbm,
    "iq_format": device_profile.iq_format,
    "capabilities": {
      "can_receive": can_receive,
      "can_transmit": can_transmit,
      "supports_tx_monitor": kind == "mock_tx" || kind == "mock-tx",
      "duplex_mode": duplex_mode,
      "supports_approx_dbm": device_profile.supports_approx_dbm,
      "iq_format": device_profile.iq_format,
      "supported_controls": supported_controls,
      "sample_rates": sample_rate_options,
      "max_sample_rate": max_sample_rate,
      "max_instantaneous_sample_rate": max_sample_rate,
      "gain_limits": gain_limits,
      "tx_power_dbm": tx_power_dbm,
      "frequency_range": frequency_range,
      "fft": {
        "sizes": fft_sizes,
        "default_size": sdr_settings.fft.default_size,
        "default_frame_rate": sdr_settings.fft.default_frame_rate,
        "max_size": sdr_settings.fft.max_size,
        "max_frame_rate": sdr_settings.fft.max_frame_rate,
        "size_to_frame_rate": sdr_settings.fft.size_to_frame_rate,
      },
      "display": sdr_settings.display,
    },
    "iq_stream_protocols": [1, 2],
    "stream_epoch": shared.current_stream_epoch(),
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

pub fn apply_stream_keys(sources: &mut [serde_json::Value]) {
  use std::collections::HashMap;

  let mut serial_counts: HashMap<String, usize> = HashMap::new();
  for source in sources.iter() {
    let serial = source["serial_number"].as_str().unwrap_or("").trim();
    if !serial.is_empty() {
      *serial_counts.entry(serial.to_string()).or_default() += 1;
    }
  }

  for source in sources.iter_mut() {
    let source_id = source["id"].as_str().unwrap_or("").to_string();
    let kind = source["kind"].as_str().unwrap_or("");
    let serial = source["serial_number"]
      .as_str()
      .unwrap_or("")
      .trim()
      .to_string();
    let is_mock = source_id.starts_with("mock-") || kind.starts_with("mock");
    let use_serial = !is_mock
      && !serial.is_empty()
      && serial_counts.get(&serial).copied() == Some(1);
    if let Some(obj) = source.as_object_mut() {
      if use_serial {
        obj.insert("stream_key".to_string(), serde_json::Value::String(serial));
        obj.insert(
          "stream_key_kind".to_string(),
          serde_json::Value::String("serial".to_string()),
        );
      } else {
        obj.insert(
          "stream_key".to_string(),
          serde_json::Value::String(source_id),
        );
        obj.insert(
          "stream_key_kind".to_string(),
          serde_json::Value::String("source_id".to_string()),
        );
      }
    }
  }
}

pub fn sort_sources_for_display(sources: &mut [serde_json::Value]) {
  sources.sort_by(|left, right| {
    let key = |source: &serde_json::Value| {
      let kind = source["kind"].as_str().unwrap_or("");
      let id = source["id"].as_str().unwrap_or("");
      let mock_rank = u8::from(kind.starts_with("mock"));
      (mock_rank, kind.to_string(), id.to_string())
    };
    key(left).cmp(&key(right))
  });
}

pub fn remove_idle_mock_sources_for_hardware(
  sources: &mut Vec<serde_json::Value>,
  hardware_is_active: bool,
) {
  if !hardware_is_active {
    return;
  }
  sources.retain(|source| {
    let kind = source["kind"].as_str().unwrap_or("");
    !kind.starts_with("mock")
      || matches!(
        source["status"].as_str(),
        Some("transmitting") | Some("standby")
      )
  });
}

pub(crate) fn stream_key_matches_source(
  stream_key: &str,
  source: &serde_json::Value,
) -> bool {
  source["stream_key"].as_str() == Some(stream_key)
}

pub fn resolve_stream_key_source_id(
  shared: &SharedState,
  stream_key: &str,
) -> Option<String> {
  let snapshot = build_source_info_snapshot(shared);
  snapshot["sources"]
    .as_array()
    .and_then(|sources| {
      sources
        .iter()
        .find(|source| stream_key_matches_source(stream_key, source))
    })
    .and_then(|source| source["id"].as_str())
    .map(str::to_string)
}

fn build_active_source_payload(
  shared: &SharedState,
  source_id: String,
  device_state: &str,
  device_loading_reason: Option<String>,
  loading_attempt: u32,
  loading_attempt_max: u32,
) -> serde_json::Value {
  let paused = shared.is_source_paused(&source_id);
  let device_profile = shared.device_profile.lock().unwrap().clone();
  let device_info = shared.device_info.lock().unwrap().clone();
  let device_serial = shared.device_serial.lock().unwrap().clone();
  let device_manufacturer = shared.device_manufacturer.lock().unwrap().clone();
  let device_product = shared.device_product.lock().unwrap().clone();
  let device_name = if device_profile.kind == "mock_tx" {
    MOCK_TX_DISPLAY_NAME.to_string()
  } else if device_profile.kind.starts_with("mock_apt") {
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
    device_loading_reason,
    loading_attempt,
    loading_attempt_max,
    device_serial,
    device_manufacturer,
    device_product,
    device_info,
    shared.device_connected.load(Ordering::Relaxed),
    paused,
    true,
  )
}

fn build_mock_tx_source_payload(
  shared: &SharedState,
  active_source_id: &str,
) -> Option<serde_json::Value> {
  let mock_tx_settings = crate::server::utils::load_mock_tx_settings();
  if !mock_tx_settings.enabled {
    return None;
  }
  let paused = shared.is_source_paused("mock-tx");

  let payload = build_source_payload(
    shared,
    "mock-tx".to_string(),
    MOCK_TX_DISPLAY_NAME.to_string(),
    "mock_tx",
    if shared
      .mock_tx_transmitting
      .load(std::sync::atomic::Ordering::Relaxed)
    {
      "transmitting"
    } else {
      "standby"
    },
    None,
    0,
    crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
    "mock-tx".to_string(),
    "N-APT".to_string(),
    MOCK_TX_DISPLAY_NAME.to_string(),
    MOCK_TX_DISPLAY_NAME.to_string(),
    true,
    paused,
    active_source_id == "mock-tx",
  );

  Some(payload)
}

fn build_mock_apt_source_payload(shared: &SharedState) -> serde_json::Value {
  let paused = shared.is_source_paused("mock-apt");
  build_source_payload(
    shared,
    "mock-apt".to_string(),
    "Mock APT SDR".to_string(),
    "mock_apt",
    "connected",
    None,
    0,
    crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
    "mock-apt".to_string(),
    "N-APT".to_string(),
    "Mock APT SDR".to_string(),
    "Mock APT SDR".to_string(),
    true,
    paused,
    false,
  )
}

fn enumerate_rtl_sdr_sources(
  shared: &SharedState,
  active_source_id: &str,
) -> Vec<serde_json::Value> {
  let mut sources = Vec::new();
  // Do not call librtlsdr from this HTTP/WebSocket snapshot path. On macOS,
  // descriptor reads can block in libusb while the async RTL reader owns the
  // interface, preventing stream_subscribe and starving the frontend.
  for device in shared.rtl_sdr_inventory_snapshot() {
    let device_name = if device.device_name.trim().is_empty() {
      format!("RTL-SDR Device #{}", device.index)
    } else {
      device.device_name.clone()
    };
    let source_id = source_id_for_device(
      "rtl-sdr",
      Some(&device.serial_number),
      device.index as usize,
    );
    if source_id == active_source_id {
      continue;
    }
    let paused = shared.is_source_paused(&source_id);

    let source_name = status_device_name(
      true,
      if device.product.trim().is_empty() {
        &device_name
      } else {
        &device.product
      },
      &build_device_profile("rtl-sdr"),
    );
    sources.push(build_source_payload(
      shared,
      source_id,
      source_name,
      "rtl-sdr",
      "connected",
      None,
      0,
      crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
      device.serial_number,
      device.manufacturer,
      device.product,
      device_name,
      true,
      paused,
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
  for device in shared.hackrf_inventory.lock().unwrap().iter() {
    let source_id = source_id_for_device(
      "hackrf_one",
      Some(&device.serial_number),
      device.index,
    );
    if source_id == active_source_id {
      continue;
    }
    let paused = shared.is_source_paused(&source_id);

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
      None,
      0,
      crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
      device.serial_number.clone(),
      String::new(),
      "HackRF One".to_string(),
      "HackRF One".to_string(),
      true,
      paused,
      false,
    ));
  }

  sources
}

pub fn build_source_info_snapshot(shared: &SharedState) -> serde_json::Value {
  let device_connected = shared.device_connected.load(Ordering::Relaxed);
  let device_state = reconcile_device_state(
    device_connected,
    &shared.device_state.lock().unwrap(),
  );
  let device_loading_reason =
    shared.device_loading_reason.lock().unwrap().clone();
  let device_loading_attempt = shared.recovery_attempts.load(Ordering::Relaxed);
  let mut sources = Vec::new();
  let active_source_id = active_source_id(shared);
  let paused = shared.is_source_paused(&active_source_id);
  let active_source = build_active_source_payload(
    shared,
    active_source_id.clone(),
    &device_state,
    device_loading_reason,
    device_loading_attempt,
    crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
  );

  if active_source_id != "mock-tx" {
    sources.push(active_source);
  }
  if active_source_id != "mock-apt" {
    sources.push(build_mock_apt_source_payload(shared));
  }
  if let Some(mock_tx) = build_mock_tx_source_payload(shared, &active_source_id)
  {
    sources.push(mock_tx);
  }
  sources.extend(enumerate_rtl_sdr_sources(shared, &active_source_id));
  #[cfg(has_hackrf)]
  sources.extend(enumerate_hackrf_sources(shared, &active_source_id));
  let hardware_is_active = !shared
    .device_profile
    .lock()
    .unwrap()
    .kind
    .starts_with("mock");
  remove_idle_mock_sources_for_hardware(&mut sources, hardware_is_active);
  sort_sources_for_display(&mut sources);
  apply_stream_keys(&mut sources);

  serde_json::json!({
    "type": "source_info",
    "active_source": active_source_id,
    "active_source_mode": if paused { "file" } else { "live" },
    "sources": sources,
  })
}

/// Send the effective SDR defaults loaded from signals.yaml as one atomic
/// payload. The frontend keeps this separate from mutable per-source state so
/// it can display the configured defaults without treating a stale browser
/// cache as authoritative.
pub fn build_signals_defaults_snapshot() -> serde_json::Value {
  serde_json::json!({
    "type": "signals_defaults",
    "sdr": crate::server::utils::load_sdr_settings(),
  })
}

pub fn active_source_id(shared: &SharedState) -> String {
  let device_profile = shared.device_profile.lock().unwrap().clone();
  if device_profile.kind == "mock_tx" {
    return "mock-tx".to_string();
  }
  if device_profile.kind.starts_with("mock_apt") {
    return "mock-apt".to_string();
  }

  let device_serial = shared.device_serial.lock().unwrap().clone();
  if !device_serial.trim().is_empty() {
    return source_id_for_device(&device_profile.kind, Some(&device_serial), 0);
  }

  source_id_for_device(&device_profile.kind, None, 0)
}

#[cfg(test)]
mod stable_source_order_tests {
  use super::*;

  #[test]
  fn source_inventory_advertises_versioned_iq_lifecycle_metadata() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let shared = SharedState::new("redis://127.0.0.1:6379");
    let snapshot = build_source_info_snapshot(&shared);
    let active_id = snapshot["active_source"].as_str().unwrap();
    let active = snapshot["sources"]
      .as_array()
      .unwrap()
      .iter()
      .find(|source| source["id"].as_str() == Some(active_id))
      .unwrap();

    assert_eq!(active["iq_stream_protocols"], serde_json::json!([1, 2]));
    assert!(active["stream_epoch"]
      .as_u64()
      .is_some_and(|epoch| epoch > 0));
    assert!(active["capabilities"]["can_receive"].is_boolean());
    assert!(active["capabilities"]["can_transmit"].is_boolean());
    assert!(active["capabilities"]["supported_controls"].is_array());
    assert!(active["capabilities"]["fft"]["sizes"].is_array());
    assert!(active["capabilities"]["display"].is_object());
    assert!(active["sdr"]["settings"].get("devices").is_none());
    assert!(active["sdr"]["settings"].get("fft_sizes").is_none());
    assert!(active.get("mock_tx").is_none());
    assert_eq!(
      active["capabilities"]["max_instantaneous_sample_rate"],
      active["sdr"]["max_sample_rate"]
    );
  }

  #[test]
  fn signals_defaults_payload_contains_the_effective_yaml_sdr_config() {
    let payload = build_signals_defaults_snapshot();

    assert_eq!(payload["type"], "signals_defaults");
    assert_eq!(payload["sdr"]["sample_rate"], 3_200_000);
    assert_eq!(payload["sdr"]["center_frequency"], 1_600_000);
    assert_eq!(payload["sdr"]["gain"]["tuner_gain"], 46.9);
    assert_eq!(payload["sdr"]["ppm"], 1.0);
    assert!(payload["sdr"]["devices"].is_object());
  }

  #[test]
  fn source_inventory_order_does_not_follow_the_active_source() {
    let mut sources = vec![
      serde_json::json!({"id": "rtl-sdr-b", "kind": "rtl-sdr"}),
      serde_json::json!({"id": "hackrf_one-a", "kind": "hackrf_one"}),
      serde_json::json!({"id": "mock-apt", "kind": "mock_apt"}),
    ];

    sort_sources_for_display(&mut sources);

    assert_eq!(
      sources
        .iter()
        .map(|source| source["id"].as_str().unwrap())
        .collect::<Vec<_>>(),
      vec!["hackrf_one-a", "rtl-sdr-b", "mock-apt"],
    );
  }

  #[test]
  fn mock_sources_are_removed_when_hardware_is_active() {
    let mut sources = vec![
      serde_json::json!({"id": "rtl-sdr-b", "kind": "rtl-sdr", "status": "connected"}),
      serde_json::json!({"id": "mock-apt", "kind": "mock_apt", "status": "connected"}),
      serde_json::json!({"id": "mock-tx", "kind": "mock_tx", "status": "connected"}),
    ];

    remove_idle_mock_sources_for_hardware(&mut sources, true);

    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0]["id"], "rtl-sdr-b");
  }

  #[test]
  fn rtl_inventory_snapshot_uses_sdr_owned_cache() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let shared = SharedState::new("redis://127.0.0.1:6379");
    shared
      .supported_usb_device_count
      .store(1, Ordering::Relaxed);
    shared
      .usb_inventory_known
      .store(true, Ordering::Release);
    shared.set_rtl_sdr_inventory(vec![
      crate::server::shared_state::RtlSdrInventoryDevice {
        index: 0,
        serial_number: "00000001".to_string(),
        manufacturer: "RTLSDRBlog".to_string(),
        product: "Blog V4".to_string(),
        device_name: "RTL-SDR Blog V4".to_string(),
      },
    ]);

    let snapshot = build_source_info_snapshot(&shared);
    let rtl_source = snapshot["sources"]
      .as_array()
      .unwrap()
      .iter()
      .find(|source| source["id"] == "rtl-sdr-00000001")
      .expect("cached RTL-SDR should be advertised");

    assert_eq!(rtl_source["serial_number"], "00000001");
    assert_eq!(rtl_source["product"], "Blog V4");
  }
}
