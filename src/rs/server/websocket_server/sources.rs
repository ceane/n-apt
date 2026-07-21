use anyhow::Result;
use log::warn;
use std::ffi::CStr;
use std::sync::atomic::Ordering;

use crate::server::shared_state::SharedState;
use crate::server::types::DeviceProfile;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceSelection {
  MockApt,
  MockTx,
  RtlSdr(u32),
  #[cfg(has_hackrf)]
  HackRf(i32),
}
use super::mock_tx::MOCK_TX_DISPLAY_NAME;
#[cfg(has_hackrf)]
use crate::sdr::hackrf::device::HackRfDevice;
#[cfg(has_hackrf)]
use crate::sdr::hackrf::ffi as hackrf_ffi;
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
      supports_raw_iq_stream: true,
    },
    "hackrf_one" | "hackrf" => DeviceProfile {
      kind: "hackrf_one".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      supports_raw_iq_stream: true,
    },
    "mock_tx" | "mock-tx" => DeviceProfile {
      kind: "mock_tx".to_string(),
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

pub fn resolve_source_selection(source_id: &str) -> Result<SourceSelection> {
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

      if source_id_for_device("hackrf_one", Some(&serial_number), index)
        == source_id
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

pub fn open_device_for_source_id(
  source_id: &str,
) -> Result<Box<dyn crate::sdr::SdrDevice>> {
  match resolve_source_selection(source_id)? {
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
      if is_tx_capable_source_kind(kind) { "tx_rx" } else { "rx" }
    }
    _ => source_capability_for_kind(kind),
  }
}

#[cfg(test)]
mod tx_suite_tests {
  use super::super::tx_suite::{resolve_tx_suite_pair, DeviceCapability};

  #[test]
  fn prefers_dedicated_rx_and_half_duplex_tx_pair() {
    let pair = resolve_tx_suite_pair(&[
      DeviceCapability::new("rx", true, false, false),
      DeviceCapability::new("tx", true, true, false),
    ])
    .expect("pair should resolve");

    assert_eq!(pair.rx_source_id, "rx");
    assert_eq!(pair.tx_source_id, "tx");
    assert_eq!(pair.tx_mode, "standby");
  }

  #[test]
  fn uses_one_full_duplex_device_for_both_roles() {
    let pair = resolve_tx_suite_pair(&[
      DeviceCapability::new("duplex", true, true, true),
    ])
    .expect("duplex pair should resolve");

    assert_eq!(pair.rx_source_id, "duplex");
    assert_eq!(pair.tx_source_id, "duplex");
  }

  #[test]
  fn rejects_tx_only_pair_without_an_rx_source() {
    assert!(resolve_tx_suite_pair(&[
      DeviceCapability::new("tx", false, true, false),
    ])
    .is_none());
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
) -> &'static str {
  if is_paused {
    return "connected";
  }
  let active_tx_state = is_active_source
    && is_tx_capable_source_kind(kind)
    && crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed);
  if kind.starts_with("mock_apt") {
    if is_active_source {
      "streaming"
    } else {
      "connected"
    }
  } else if kind == "mock_tx" {
    if active_tx_state || device_state == "transmitting" {
      "transmitting"
    } else {
      "connected"
    }
  } else if active_tx_state {
    "transmitting"
  } else if is_active_source {
    match device_state {
      "loading" => "loading",
      "loose" => "loading",
      "disconnected" => "disconnected",
      "stale" => "stale",
      "error" => "error",
      "transmitting" => "transmitting",
      _ => "streaming",
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

  serde_json::json!({
    "id": source_id,
    "name": name,
    "kind": kind,
    "capability": source_capability_for_kind_and_duplex(kind, duplex_mode),
    "duplex_mode": duplex_mode,
    "status": source_status_for_entry(is_active_source, paused, device_state, kind),
    "paused": paused,
    "device_loading_reason": device_loading_reason,
    "loading_attempt": loading_attempt,
    "loading_attempt_max": loading_attempt_max,
    "supports_approx_dbm": device_profile.supports_approx_dbm,
    "supports_raw_iq_stream": device_profile.supports_raw_iq_stream,
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
      || source["status"].as_str() == Some("transmitting")
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

  let mut payload = build_source_payload(
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
      "connected"
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

  if let Some(obj) = payload.as_object_mut() {
    obj.insert(
      "mock_tx".to_string(),
      serde_json::to_value(&mock_tx_settings)
        .unwrap_or(serde_json::Value::Null),
    );
  }

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
  let count = RtlSdrDevice::get_device_count();
  for index in 0..count {
    let device_name = RtlSdrDevice::get_device_name(index);
    let (serial, manufacturer, product) = read_rtl_usb_strings(index);
    let source_id =
      source_id_for_device("rtl-sdr", Some(&serial), index as usize);
    if source_id == active_source_id {
      continue;
    }
    let paused = shared.is_source_paused(&source_id);

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
      None,
      0,
      crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
      serial,
      manufacturer,
      product,
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

      let source_id =
        source_id_for_device("hackrf_one", Some(&serial_number), index);
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
        serial_number,
        String::new(),
        "HackRF One".to_string(),
        "HackRF One".to_string(),
        true,
        paused,
        false,
      ));
    }

    hackrf_ffi::hackrf_device_list_free(list);
    let _ = hackrf_ffi::hackrf_exit();
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
  let paused = shared.is_paused.load(Ordering::SeqCst);
  let mut sources = Vec::new();
  let active_source_id = active_source_id(shared);
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
  {
    sources.extend(enumerate_hackrf_sources(shared, &active_source_id));
  }
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
}
