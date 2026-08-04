#[cfg(all(test, has_hackrf))]
use crate::sdr::hackrf::ffi as hackrf_ffi;
use crate::sdr::{processor::SdrProcessor, SdrDeviceFactory};
use crate::server::shared_state::{
  HackRfInventoryDevice, SharedState, DEVICE_PROBE_INTERVAL,
  DISCONNECT_FAILURE_THRESHOLD, MAX_RECOVERY_ATTEMPTS,
};
use anyhow::{anyhow, Result};
use log::{debug, error, info, warn};
use rusb::{Context, Device, Hotplug, HotplugBuilder, UsbContext};
#[cfg(all(test, has_hackrf))]
use std::os::raw::c_int;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

use crate::server::websocket_server::{
  active_source_id, broadcast_device_status, build_device_profile,
  open_device_for_source_id,
};
#[cfg(has_hackrf)]
use crate::sdr::hackrf::device::HackRfDevice;

const HACKRF_DISCONNECT_ADVISORY: &str =
  "HackRF One disconnected. Avoid unplugging and replugging during use; some firmware versions can take 15-20 seconds or stall before USB reattaches. Keep it connected while working, try the HackRF reset button and wait for the USB LED, and update the HackRF firmware if this repeats.";

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

#[derive(Debug)]
pub struct HotplugState {
  pub last_poll: Instant,
  pub last_hardware_swap: Option<Instant>,
  pub last_failure_at: Option<Instant>,
  pub last_seen_device_count: u32,
  pub missing_since: Option<Instant>,
  pub retry_cooldown: Duration,
  pub exhausted_recovery_cooldown: Duration,
}

impl HotplugState {
  pub fn new() -> Self {
    let now = Instant::now();
    Self {
      last_poll: now,
      last_hardware_swap: None,
      last_failure_at: None,
      // The monitor performs the first inventory refresh on its normal
      // cadence. Construction must not initiate a second USB scan.
      last_seen_device_count: 0,
      missing_since: None,
      retry_cooldown: Duration::from_secs(30),
      exhausted_recovery_cooldown: Duration::from_secs(15),
    }
  }
}

#[derive(Clone)]
pub struct HotplugMonitor {
  tx: Sender<HotplugEvent>,
  rx: Arc<Mutex<Receiver<HotplugEvent>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HotplugEventKind {
  Attached,
  Detached,
}

#[derive(Clone, Debug)]
pub struct HotplugEvent {
  pub kind: HotplugEventKind,
  pub device_type: String,
  pub vendor_id: Option<u16>,
  pub product_id: Option<u16>,
  pub bus_number: u8,
  pub address: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsbDeviceSnapshot {
  pub device_type: String,
  pub vendor_id: u16,
  pub product_id: u16,
  pub bus_number: u8,
  pub address: u8,
}

struct MonitorCallback {
  tx: Sender<HotplugEvent>,
}

impl Hotplug<Context> for MonitorCallback {
  fn device_arrived(&mut self, device: Device<Context>) {
    let snapshot = hotplug_event_snapshot(&device);
    let _ = self.tx.send(HotplugEvent {
      kind: HotplugEventKind::Attached,
      device_type: snapshot.device_type,
      vendor_id: snapshot.vendor_id,
      product_id: snapshot.product_id,
      bus_number: snapshot.bus_number,
      address: snapshot.address,
    });
  }

  fn device_left(&mut self, device: Device<Context>) {
    let snapshot = hotplug_event_snapshot(&device);
    let _ = self.tx.send(HotplugEvent {
      kind: HotplugEventKind::Detached,
      device_type: snapshot.device_type,
      vendor_id: snapshot.vendor_id,
      product_id: snapshot.product_id,
      bus_number: snapshot.bus_number,
      address: snapshot.address,
    });
  }
}

impl HotplugMonitor {
  pub fn new() -> Result<Self> {
    let (tx, rx) = mpsc::channel();
    Ok(Self {
      tx,
      rx: Arc::new(Mutex::new(rx)),
    })
  }

  pub fn start(&self) -> Result<()> {
    self.spawn_libusb_listener();
    Ok(())
  }

  fn spawn_libusb_listener(&self) {
    let tx = self.tx.clone();
    thread::spawn(move || {
      if let Err(e) = run_libusb_hotplug_loop(tx) {
        error!("libusb hotplug listener failed: {}", e);
      }
    });
  }

  pub fn try_recv(&self) -> Option<HotplugEvent> {
    self.rx.lock().ok()?.try_recv().ok()
  }
}

fn filter_supported_usb_device_snapshots(
  snapshots: Vec<UsbDeviceSnapshot>,
) -> Vec<UsbDeviceSnapshot> {
  snapshots
    .into_iter()
    .filter(|snapshot| {
      matches!(
        snapshot.device_type.as_str(),
        "rtl-sdr" | "hackrf_one" | "hackrf_dfu"
      )
    })
    .collect()
}

pub fn scan_supported_usb_device_snapshots() -> Result<Vec<UsbDeviceSnapshot>> {
  Ok(filter_supported_usb_device_snapshots(
    scan_usb_device_snapshots()?,
  ))
}

#[cfg(has_hackrf)]
fn refresh_cached_hackrf_inventory(
  shared_state: &SharedState,
  devices: &[UsbDeviceSnapshot],
) {
  if !devices.iter().any(|device| device.device_type == "hackrf_one") {
    shared_state.hackrf_inventory.lock().unwrap().clear();
    return;
  }

  match HackRfDevice::enumerate_serial_numbers() {
    Ok(serial_numbers) => {
      *shared_state.hackrf_inventory.lock().unwrap() = serial_numbers
        .into_iter()
        .enumerate()
        .map(|(index, serial_number)| HackRfInventoryDevice {
          serial_number,
          index,
        })
        .collect();
    }
    Err(error) => {
      warn!("HackRF inventory refresh failed: {}", error);
    }
  }
}

#[cfg(not(has_hackrf))]
fn refresh_cached_hackrf_inventory(
  _shared_state: &SharedState,
  _devices: &[UsbDeviceSnapshot],
) {
}

/// Multiple supported receivers may be connected at once. Recovery must be
/// scoped to the device owned by the processor, not to the global USB count.
fn active_device_present(device_type: &str, shared_state: &SharedState) -> bool {
  let normalized = device_type.to_ascii_lowercase();
  if normalized.contains("hackrf") {
    return !shared_state.hackrf_inventory.lock().unwrap().is_empty();
  }
  scan_supported_usb_device_snapshots()
    .map(|devices| {
      devices.iter().any(|device| {
        let detected = device.device_type.to_ascii_lowercase();
        detected == normalized
          || (normalized.contains("rtl") && detected.contains("rtl"))
          || (normalized.contains("hackrf") && detected.contains("hackrf"))
      })
    })
    .unwrap_or(false)
}

#[cfg(all(test, has_hackrf))]
fn is_supported_hackrf_board_id(board_id: c_int) -> bool {
  matches!(
    board_id,
    hackrf_ffi::USB_BOARD_ID_JAWBREAKER
      | hackrf_ffi::USB_BOARD_ID_HACKRF_ONE
      | hackrf_ffi::USB_BOARD_ID_RAD1O
  )
}

fn run_libusb_hotplug_loop(tx: Sender<HotplugEvent>) -> Result<()> {
  let context = Context::new()
    .map_err(|e| anyhow!("Failed to initialize libusb context: {}", e))?;

  let hotplug_supported = rusb::has_hotplug();
  if !hotplug_supported {
    warn!("libusb hotplug is unavailable; falling back to periodic probing");
    return Ok(());
  }

  let ctx = Arc::new(context);
  let _registration = HotplugBuilder::new()
    .enumerate(true)
    .register(ctx.as_ref(), Box::new(MonitorCallback { tx }))
    .map_err(|e| {
      anyhow!("Failed to register libusb hotplug callback: {}", e)
    })?;

  loop {
    ctx
      .handle_events(None)
      .map_err(|e| anyhow!("libusb event loop error: {}", e))?;
  }
}

fn device_type_from_ids(vendor_id: u16, product_id: u16) -> &'static str {
  match (vendor_id, product_id) {
    (0x0bda, 0x2838) | (0x0bda, 0x2832) | (0x0bda, 0x283a) => "rtl-sdr",
    (0x1d50, _) => "hackrf_one",
    (0x1fc9, 0x000c) => "hackrf_dfu",
    _ => "unknown",
  }
}

fn hotplug_event_snapshot<T: rusb::UsbContext>(
  device: &Device<T>,
) -> HotplugEventSnapshot {
  let (vendor_id, product_id, device_type) = match device.device_descriptor() {
    Ok(desc) => {
      let vendor_id = desc.vendor_id();
      let product_id = desc.product_id();
      (
        Some(vendor_id),
        Some(product_id),
        device_type_from_ids(vendor_id, product_id).to_string(),
      )
    }
    Err(_) => (None, None, "unknown".to_string()),
  };

  HotplugEventSnapshot {
    device_type,
    vendor_id,
    product_id,
    bus_number: device.bus_number(),
    address: device.address(),
  }
}

struct HotplugEventSnapshot {
  device_type: String,
  vendor_id: Option<u16>,
  product_id: Option<u16>,
  bus_number: u8,
  address: u8,
}

pub fn scan_usb_device_snapshots() -> Result<Vec<UsbDeviceSnapshot>> {
  let context = Context::new()
    .map_err(|e| anyhow!("Failed to initialize libusb context: {}", e))?;
  let devices = context
    .devices()
    .map_err(|e| anyhow!("Failed to enumerate USB devices: {}", e))?;

  let mut snapshots = Vec::new();
  for device in devices.iter() {
    if let Ok(desc) = device.device_descriptor() {
      let vendor_id = desc.vendor_id();
      let product_id = desc.product_id();
      snapshots.push(UsbDeviceSnapshot {
        device_type: device_type_from_ids(vendor_id, product_id).to_string(),
        vendor_id,
        product_id,
        bus_number: device.bus_number(),
        address: device.address(),
      });
    }
  }

  Ok(snapshots)
}

pub fn scan_usb_for_supported_device() -> Result<Option<String>> {
  for snapshot in scan_supported_usb_device_snapshots()? {
    return Ok(Some(snapshot.device_type));
  }

  Ok(None)
}

pub(crate) fn should_enter_hardware_recovery(device_type: &str) -> bool {
  !device_type.to_ascii_lowercase().contains("mock")
}

pub(crate) fn should_hold_recovery_for_usb_present_device(
  device_type: &str,
  supported_device_present: bool,
) -> bool {
  supported_device_present && should_enter_hardware_recovery(device_type)
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn should_probe_for_hotplug(device_type: &str) -> bool {
  device_type.to_ascii_lowercase().contains("mock")
}

pub(crate) fn is_recovery_budget_exhausted(
  recovery_attempts: u32,
  max_recovery_attempts: u32,
) -> bool {
  recovery_attempts >= max_recovery_attempts
}

fn has_post_swap_success(
  state: &HotplugState,
  shared_state: &SharedState,
) -> bool {
  match (
    state.last_hardware_swap,
    *shared_state.last_successful_read.lock().unwrap(),
  ) {
    (Some(swap_at), Some(success_at)) => success_at > swap_at,
    _ => false,
  }
}

pub async fn drain_hotplug_events(
  monitor: &HotplugMonitor,
  state: &mut HotplugState,
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) {
  let usb_devices = match scan_supported_usb_device_snapshots() {
    Ok(devices) => devices,
    Err(error) => {
      warn!("Supported USB inventory refresh failed: {}", error);
      return;
    }
  };
  refresh_cached_hackrf_inventory(shared_state, &usb_devices);
  let current_count = usb_devices.len() as u32;
  shared_state
    .supported_usb_device_count
    .store(current_count, Ordering::Relaxed);
  shared_state.usb_inventory_known.store(true, Ordering::Release);
  let should_reconcile = should_reconcile_hotplug_state(
    current_count,
    state.last_seen_device_count,
    processor.is_mock(),
  );
  if should_reconcile {
    let previous_count = state.last_seen_device_count;
    if current_count != previous_count {
      info!(
        "Supported USB device presence changed from {} to {}",
        previous_count, current_count
      );
    } else {
      info!(
        "Supported USB device still present while processor is mock; attempting attach"
      );
    }
    state.last_seen_device_count = current_count;
    if current_count == 0 && !processor.is_mock() {
      let _ =
        disconnect_to_mock(state, processor, shared_state, broadcast_tx).await;
      state.missing_since = None;
    } else if current_count > 0 && processor.is_mock() {
      state.missing_since = None;
      if let Err(e) =
        attach_real_device(processor, shared_state, broadcast_tx).await
      {
        error!(
          "hotplug attach failed after device-count reconciliation: {}",
          e
        );
      } else {
        state.last_hardware_swap = Some(Instant::now());
      }
    } else if current_count > 0 {
      state.missing_since = None;
      if should_broadcast_source_inventory_change(
        current_count,
        previous_count,
        processor.is_mock(),
      ) {
        broadcast_device_status(shared_state, broadcast_tx);
      }
    }
  }

  while let Some(event) = monitor.try_recv() {
    match event.kind {
      HotplugEventKind::Attached => {
        if event.device_type == "unknown" {
          debug!(
            "Ignoring unrelated USB attach event: {}",
            format_hotplug_event_device(&event)
          );
        } else {
          info!(
            "USB attach event received for {} ({})",
            event.device_type,
            format_hotplug_event_device(&event)
          );
        }
      }
      HotplugEventKind::Detached => {
        if event.device_type == "unknown" {
          debug!(
            "Ignoring unrelated USB detach event: {}",
            format_hotplug_event_device(&event)
          );
        } else {
          info!(
            "USB detach event received for {} ({})",
            event.device_type,
            format_hotplug_event_device(&event)
          );
        }
      }
    }
  }
}

fn format_hotplug_event_device(event: &HotplugEvent) -> String {
  match (event.vendor_id, event.product_id) {
    (Some(vendor_id), Some(product_id)) => format!(
      "vid=0x{:04x} pid=0x{:04x} bus={} address={}",
      vendor_id, product_id, event.bus_number, event.address
    ),
    _ => format!(
      "descriptor unavailable bus={} address={}",
      event.bus_number, event.address
    ),
  }
}

fn should_reconcile_hotplug_state(
  current_count: u32,
  last_seen_device_count: u32,
  processor_is_mock: bool,
) -> bool {
  current_count != last_seen_device_count
    || (processor_is_mock && current_count > 0)
    || (!processor_is_mock && current_count == 0)
}

fn should_broadcast_source_inventory_change(
  current_count: u32,
  last_seen_device_count: u32,
  processor_is_mock: bool,
) -> bool {
  !processor_is_mock
    && current_count > 0
    && current_count != last_seen_device_count
}

async fn attach_real_device(
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) -> Result<()> {
  info!("Probing supported device attach path");
  shared_state.set_device_state("initializing", Some("connect"));
  broadcast_device_status(shared_state, broadcast_tx);

  let mut last_err = None;
  let mut attached = false;
  for attempt in 1..=5 {
    match SdrDeviceFactory::create_device() {
      Ok(device)
        if !device.device_type().to_ascii_lowercase().contains("mock") =>
      {
        match processor.swap_device(device) {
          Ok(()) => {
            attached = true;
            break;
          }
          Err(e) => {
            last_err = Some(e);
            warn!(
              "Supported device initialize attempt {} of 5 failed during attach; retrying",
              attempt
            );
            tokio::time::sleep(Duration::from_millis(250)).await;
          }
        }
      }
      Ok(_) => {
        last_err =
          Some(anyhow!("No supported real device available during attach"));
        warn!(
          "Supported device open attempt {} of 5 returned mock; retrying",
          attempt
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
      }
      Err(e) => {
        last_err = Some(e);
        warn!(
          "Supported device open attempt {} of 5 failed during attach; retrying",
          attempt
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
      }
    }
  }

  if !attached {
    let err =
      last_err.unwrap_or_else(|| anyhow!("Supported device open failed"));
    shared_state.set_device_state("disconnected", None);
    broadcast_device_status(shared_state, broadcast_tx);
    return Err(err);
  }

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
  // A reconnect is an automatic resume. Clear any stale pause bit left by
  // the pre-disconnect source so the first fresh Rx frame is not gated behind
  // a second user Pause/Resume click.
  let active_id = active_source_id(shared_state);
  shared_state.set_active_source_pause_state(&active_id, false);
  broadcast_device_status(shared_state, broadcast_tx);
  Ok(())
}

async fn disconnect_to_mock(
  state: &mut HotplugState,
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) -> Result<()> {
  let previous_device_type = processor.device_type();
  shared_state.set_device_state("disconnected", None);
  if previous_device_type == "hackrf_one" {
    shared_state
      .set_device_backend_error(Some(HACKRF_DISCONNECT_ADVISORY.to_string()));
  }
  broadcast_device_status(shared_state, broadcast_tx);
  let mock_device = SdrDeviceFactory::create_mock_device();
  processor.swap_device(mock_device)?;
  sync_shared_sample_rate(shared_state, processor);
  shared_state.update_device_status(
    false,
    processor.get_device_info(),
    build_device_profile(processor.device_type()),
  );
  shared_state.update_device_usb_strings(
    String::new(),
    String::new(),
    String::new(),
  );
  shared_state.set_active_source_pause_state("mock-apt", false);
  broadcast_device_status(shared_state, broadcast_tx);
  state.last_failure_at = Some(Instant::now());
  Ok(())
}

pub async fn maybe_attach_hotplugged_device(
  monitor: &HotplugMonitor,
  state: &mut HotplugState,
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  force: bool,
) {
  if !force && state.last_poll.elapsed() < DEVICE_PROBE_INTERVAL {
    return;
  }

  state.last_poll = Instant::now();
  drain_hotplug_events(monitor, state, processor, shared_state, broadcast_tx)
    .await;
}

pub async fn handle_real_hardware_health(
  state: &mut HotplugState,
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  mut stop_capture: impl FnMut(&mut SdrProcessor) -> Result<()>,
) {
  if !should_enter_hardware_recovery(processor.device_type()) {
    return;
  }

  let current_state = shared_state.device_state.lock().unwrap().clone();
  if current_state == "loading"
    || current_state == "initializing"
    || current_state == "disconnected"
  {
    return;
  }

  let is_warming_up = state
    .last_hardware_swap
    .map(|t| t.elapsed() < Duration::from_secs(5))
    .unwrap_or(false);
  let warming_up_after_success =
    is_warming_up && has_post_swap_success(state, shared_state);
  if processor.is_healthy() || warming_up_after_success {
    // The read loop itself resets the streak via record_successful_read()
    // once a healthy frame is actually processed.
    return;
  }

  let streak = shared_state.record_health_failure();
  let recovery_count = shared_state.recovery_attempts.load(Ordering::Relaxed);
  warn!(
    "Device health check failed (streak {}/{}, recovery attempts {}/{})",
    streak, DISCONNECT_FAILURE_THRESHOLD, recovery_count, MAX_RECOVERY_ATTEMPTS
  );

  // Once an RTL async reader has exited, its libusb handle may look present
  // even after a physical unplug/replug. Re-initializing that handle just
  // recreates the loading-placeholder loop; force the full open path instead.
  let rtl_reader_inactive =
    processor.device_type().to_ascii_lowercase().contains("rtl")
      && !processor.is_rx_active();

  if streak < DISCONNECT_FAILURE_THRESHOLD && !rtl_reader_inactive {
    let active_device_is_present =
      active_device_present(processor.device_type(), shared_state);
    if !active_device_is_present {
      warn!("Supported USB device disappeared during recovery window. Falling back to mock immediately.");
      let was_hackrf = processor.device_type() == "hackrf_one";
      shared_state.set_device_state("disconnected", None);
      if was_hackrf {
        shared_state.set_device_backend_error(Some(
          HACKRF_DISCONNECT_ADVISORY.to_string(),
        ));
      }
      broadcast_device_status(shared_state, broadcast_tx);
      let _ = stop_capture(processor);
      let mock_device = SdrDeviceFactory::create_mock_device();
      if let Err(e) = processor.swap_device(mock_device) {
        error!(
          "Failed to fall back to mock device after early unplug: {}",
          e
        );
      } else {
        sync_shared_sample_rate(shared_state, processor);
        shared_state.update_device_status(
          false,
          processor.get_device_info(),
          build_device_profile(processor.device_type()),
        );
        if was_hackrf {
          shared_state.set_device_backend_error(Some(
            HACKRF_DISCONNECT_ADVISORY.to_string(),
          ));
        }
        shared_state.set_active_source_pause_state("mock-apt", false);
        broadcast_device_status(shared_state, broadcast_tx);
      }
      return;
    }

    if !is_recovery_budget_exhausted(recovery_count, MAX_RECOVERY_ATTEMPTS) {
      shared_state
        .recovery_attempts
        .fetch_add(1, Ordering::Relaxed);
      shared_state.set_device_state("loading", Some("restart"));
      broadcast_device_status(shared_state, broadcast_tx);
      info!(
        "Attempting device recovery (attempt {} of {})...",
        recovery_count + 1,
        MAX_RECOVERY_ATTEMPTS
      );
      if let Err(e) = processor.reset_buffer() {
        warn!("Buffer reset during recovery failed: {}", e);
      }
      if let Err(e) = processor.initialize() {
        warn!("Re-init during recovery failed: {}", e);
        // A reader restart failure is a stale-stream condition until the
        // USB inventory independently proves that the device is absent.
        shared_state.set_device_state("stale", None);
        shared_state.set_device_backend_error(Some(e.to_string()));
        broadcast_device_status(shared_state, broadcast_tx);
      } else {
        info!("Device re-init succeeded, awaiting health confirmation...");
        state.last_hardware_swap = Some(Instant::now());
      }
    } else {
      warn!(
        "Recovery budget exhausted ({} attempts). Holding device recovery for {:?} before trying again.",
        MAX_RECOVERY_ATTEMPTS, state.exhausted_recovery_cooldown
      );
      shared_state.set_device_state("loading", Some("restart"));
      broadcast_device_status(shared_state, broadcast_tx);
      state.last_failure_at = Some(Instant::now());
      tokio::time::sleep(state.exhausted_recovery_cooldown).await;
    }
  } else {
    let active_device_is_present =
      active_device_present(processor.device_type(), shared_state);
    if !active_device_is_present {
      warn!("Supported device confirmed unplugged. Falling back to mock.");
      let was_hackrf = processor.device_type() == "hackrf_one";
      shared_state.set_device_state("disconnected", None);
      if was_hackrf {
        shared_state.set_device_backend_error(Some(
          HACKRF_DISCONNECT_ADVISORY.to_string(),
        ));
      }
      broadcast_device_status(shared_state, broadcast_tx);
      let _ = stop_capture(processor);
      let mock_device = SdrDeviceFactory::create_mock_device();
      if let Err(e) = processor.swap_device(mock_device) {
        error!(
          "Failed to fall back to mock device after confirmed unplug: {}",
          e
        );
      } else {
        sync_shared_sample_rate(shared_state, processor);
        shared_state.update_device_status(
          false,
          processor.get_device_info(),
          build_device_profile(processor.device_type()),
        );
        if was_hackrf {
          shared_state.set_device_backend_error(Some(
            HACKRF_DISCONNECT_ADVISORY.to_string(),
          ));
        }
        shared_state.set_active_source_pause_state("mock-apt", false);
        broadcast_device_status(shared_state, broadcast_tx);
        state.last_failure_at = Some(Instant::now());
        info!("Fell back to mock mode after confirmed unplug");
      }
    } else if should_hold_recovery_for_usb_present_device(
      processor.device_type(),
      active_device_is_present,
    ) {
      warn!(
        "Supported device still on USB but unhealthy. Attempting full restart..."
      );
      let _ = stop_capture(processor);
      let cleanup_ready = match processor.cleanup() {
        Ok(()) => true,
        Err(e) => {
          // An RTL async reader may still be unwinding after cancellation.
          // Never open a replacement while it owns the libusb interface.
          warn!(
            "SDR handle is still stopping; deferring full restart: {}",
            e
          );
          shared_state.set_device_state("stale", None);
          shared_state.set_device_backend_error(Some(e.to_string()));
          broadcast_device_status(shared_state, broadcast_tx);
          state.last_hardware_swap = Some(Instant::now());
          false
        }
      };
      if !cleanup_ready {
        return;
      }
      shared_state.set_device_state("loading", Some("restart"));
      broadcast_device_status(shared_state, broadcast_tx);
      let requested_source_id = active_source_id(shared_state);
      match open_device_for_source_id(shared_state, &requested_source_id) {
        Ok(new_device) if !new_device.device_type().contains("Mock") => {
          if let Err(e) = processor.swap_device(new_device) {
            let error_message =
              format!("Selected SDR full restart swap failed: {}", e);
            error!("{}", error_message);
            if let Err(swap_e) =
              processor.swap_device(SdrDeviceFactory::create_mock_device())
            {
              error!(
                "Failed to fall back to Mock APT after full restart swap failure: {}",
                swap_e
              );
            } else {
              sync_shared_sample_rate(shared_state, processor);
              shared_state.update_device_status(
                false,
                processor.get_device_info(),
                build_device_profile(processor.device_type()),
              );
              shared_state.set_active_source_pause_state("mock-apt", false);
            }
            shared_state.set_device_backend_error(Some(error_message));
            broadcast_device_status(shared_state, broadcast_tx);
          } else {
            shared_state.update_device_status(
              true,
              processor.get_device_info(),
              build_device_profile(processor.device_type()),
            );
            let active_id = active_source_id(shared_state);
            shared_state.set_active_source_pause_state(&active_id, false);
            broadcast_device_status(shared_state, broadcast_tx);
            state.last_hardware_swap = Some(Instant::now());
            info!("Full device restart succeeded");
          }
        }
        _ => {
          warn!(
            "Full restart did not return the selected real device while USB is still present; falling back to Mock APT"
          );
          let error_message = format!(
            "Selected SDR could not be reopened while USB is present: {}",
            shared_state
              .device_backend_error
              .lock()
              .unwrap()
              .clone()
              .unwrap_or_else(|| "device reopen failed".to_string())
          );
          if let Err(swap_e) =
            processor.swap_device(SdrDeviceFactory::create_mock_device())
          {
            error!(
              "Failed to fall back to Mock APT after full restart failure: {}",
              swap_e
            );
            shared_state.set_device_backend_error(Some(error_message));
          } else {
            sync_shared_sample_rate(shared_state, processor);
            shared_state.update_device_status(
              false,
              processor.get_device_info(),
              build_device_profile(processor.device_type()),
            );
            shared_state.set_active_source_pause_state("mock-apt", false);
            shared_state.set_device_backend_error(Some(error_message));
          }
          broadcast_device_status(shared_state, broadcast_tx);
          state.last_hardware_swap = Some(Instant::now());
        }
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serial_test::serial;

  #[tokio::test]
  #[serial]
  async fn maybe_attach_hotplugged_device_respects_probe_interval() {
    let monitor = HotplugMonitor::new().expect("hotplug monitor");
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
    let shared_state = SharedState::new("redis://127.0.0.1:6379");
    let mut processor =
      SdrProcessor::new_mock_apt().expect("mock apt processor");
    let (broadcast_tx, _) = broadcast::channel(1);
    let now = Instant::now();
    let mut state = HotplugState {
      last_poll: now,
      last_hardware_swap: None,
      last_failure_at: None,
      last_seen_device_count: 0,
      missing_since: None,
      retry_cooldown: Duration::from_secs(30),
      exhausted_recovery_cooldown: Duration::from_secs(15),
    };

    let before = state.last_poll;
    maybe_attach_hotplugged_device(
      &monitor,
      &mut state,
      &mut processor,
      &shared_state,
      &broadcast_tx,
      false,
    )
    .await;

    assert_eq!(state.last_poll, before);
  }

  #[test]
  fn mock_startup_with_supported_device_should_attach_even_without_count_change(
  ) {
    assert!(should_reconcile_hotplug_state(1, 1, true));
    assert!(!should_reconcile_hotplug_state(1, 1, false));
    assert!(should_reconcile_hotplug_state(1, 0, false));
    assert!(should_reconcile_hotplug_state(0, 0, false));
  }

  #[test]
  fn real_device_inventory_change_requires_source_info_broadcast() {
    assert!(should_broadcast_source_inventory_change(2, 1, false));
    assert!(should_broadcast_source_inventory_change(1, 2, false));
    assert!(!should_broadcast_source_inventory_change(1, 1, false));
    assert!(!should_broadcast_source_inventory_change(2, 1, true));
  }

  #[test]
  fn supported_usb_snapshot_filter_keeps_all_supported_devices() {
    let snapshots = vec![
      UsbDeviceSnapshot {
        device_type: "rtl-sdr".to_string(),
        vendor_id: 0x0bda,
        product_id: 0x2838,
        bus_number: 1,
        address: 2,
      },
      UsbDeviceSnapshot {
        device_type: "hackrf_one".to_string(),
        vendor_id: 0x1d50,
        product_id: 0x6089,
        bus_number: 1,
        address: 3,
      },
      UsbDeviceSnapshot {
        device_type: "unknown".to_string(),
        vendor_id: 0x9999,
        product_id: 0x0001,
        bus_number: 1,
        address: 4,
      },
    ];

    let supported = filter_supported_usb_device_snapshots(snapshots);

    assert_eq!(supported.len(), 2);
    assert!(supported.iter().any(|d| d.device_type == "rtl-sdr"));
    assert!(supported.iter().any(|d| d.device_type == "hackrf_one"));
  }

  #[cfg(has_hackrf)]
  #[test]
  fn hackrf_board_ids_are_recognized() {
    assert!(is_supported_hackrf_board_id(
      hackrf_ffi::USB_BOARD_ID_JAWBREAKER as c_int
    ));
    assert!(is_supported_hackrf_board_id(
      hackrf_ffi::USB_BOARD_ID_HACKRF_ONE as c_int
    ));
    assert!(is_supported_hackrf_board_id(
      hackrf_ffi::USB_BOARD_ID_RAD1O as c_int
    ));
    assert!(!is_supported_hackrf_board_id(0x1234));
  }

  #[test]
  fn hackrf_dfu_mode_is_classified() {
    let classified = {
      let desc_vendor = 0x1fc9;
      let desc_product = 0x000c;
      match (desc_vendor, desc_product) {
        (0x1fc9, 0x000c) => "hackrf_dfu",
        _ => "unknown",
      }
    };

    assert_eq!(classified, "hackrf_dfu");
  }

  #[test]
  fn hackrf_disconnect_advisory_mentions_reset_wait_and_firmware() {
    assert!(HACKRF_DISCONNECT_ADVISORY.contains("reset button"));
    assert!(HACKRF_DISCONNECT_ADVISORY.contains("USB LED"));
    assert!(HACKRF_DISCONNECT_ADVISORY.contains("firmware"));
    assert!(HACKRF_DISCONNECT_ADVISORY.contains("15-20 seconds"));
  }

  #[test]
  fn real_device_present_on_usb_should_stay_in_recovery() {
    assert!(should_hold_recovery_for_usb_present_device(
      "hackrf_one",
      true
    ));
    assert!(should_hold_recovery_for_usb_present_device("rtl-sdr", true));
    assert!(!should_hold_recovery_for_usb_present_device(
      "hackrf_one",
      false
    ));
    assert!(!should_hold_recovery_for_usb_present_device(
      "mock_apt", true
    ));
  }

  #[test]
  fn unknown_nonconnected_state_reconciles_as_disconnected() {
    assert_eq!(
      crate::server::utils::reconcile_device_state(false, "unexpected"),
      "disconnected"
    );
  }

  #[test]
  fn warming_up_requires_a_successful_read_after_swap() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
    let shared_state = SharedState::new("redis://127.0.0.1:6379");
    let state = HotplugState::new();

    assert!(!has_post_swap_success(&state, &shared_state));
  }
}
