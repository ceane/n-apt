use crate::sdr::{processor::SdrProcessor, SdrDeviceFactory};
use crate::server::shared_state::{
  SharedState, DEVICE_PROBE_INTERVAL, DISCONNECT_FAILURE_THRESHOLD,
  MAX_RECOVERY_ATTEMPTS,
};
use anyhow::{anyhow, Result};
use log::{debug, error, info, warn};
use rusb::{Context, Device, Hotplug, HotplugBuilder, UsbContext};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

use crate::server::websocket_server::{
  broadcast_device_status, build_device_profile,
};

#[derive(Debug)]
pub struct HotplugState {
  pub last_poll: Instant,
  pub last_hardware_swap: Option<Instant>,
  pub last_failure_at: Option<Instant>,
  pub last_seen_device_count: u32,
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
      last_seen_device_count: if supported_usb_device_present() {
        1
      } else {
        0
      },
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
}

struct MonitorCallback {
  tx: Sender<HotplugEvent>,
}

impl Hotplug<Context> for MonitorCallback {
  fn device_arrived(&mut self, device: Device<Context>) {
    let device_type = device_type_hint(&device);
    let _ = self.tx.send(HotplugEvent {
      kind: HotplugEventKind::Attached,
      device_type,
    });
  }

  fn device_left(&mut self, device: Device<Context>) {
    let device_type = device_type_hint(&device);
    let _ = self.tx.send(HotplugEvent {
      kind: HotplugEventKind::Detached,
      device_type,
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

fn supported_usb_device_present() -> bool {
  matches!(scan_usb_for_supported_device(), Ok(Some(_)))
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

fn device_type_hint<T: rusb::UsbContext>(device: &Device<T>) -> String {
  let desc = device.device_descriptor();
  if let Ok(desc) = desc {
    match (desc.vendor_id(), desc.product_id()) {
      (0x0bda, 0x2838) | (0x0bda, 0x2832) | (0x0bda, 0x283a) => {
        "rtl-sdr".to_string()
      }
      (0x1d50, _) => "hackrf_one".to_string(),
      _ => "unknown".to_string(),
    }
  } else {
    "unknown".to_string()
  }
}

pub fn scan_usb_for_supported_device() -> Result<Option<String>> {
  let context = Context::new()
    .map_err(|e| anyhow!("Failed to initialize libusb context: {}", e))?;
  let devices = context
    .devices()
    .map_err(|e| anyhow!("Failed to enumerate USB devices: {}", e))?;

  for device in devices.iter() {
    if let Ok(desc) = device.device_descriptor() {
      match (desc.vendor_id(), desc.product_id()) {
        (0x0bda, 0x2838) | (0x0bda, 0x2832) | (0x0bda, 0x283a) => {
          return Ok(Some("rtl-sdr".to_string()))
        }
        (0x1d50, _) => return Ok(Some("hackrf_one".to_string())),
        _ => {}
      }
    }
  }

  Ok(None)
}

pub(crate) fn should_enter_hardware_recovery(device_type: &str) -> bool {
  !device_type.to_ascii_lowercase().contains("mock")
}

#[cfg(test)]
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
  let current_count = if supported_usb_device_present() { 1 } else { 0 };
  if current_count != state.last_seen_device_count {
    info!(
      "Supported USB device presence changed from {} to {}",
      state.last_seen_device_count, current_count
    );
    state.last_seen_device_count = current_count;
    if current_count == 0 && !processor.is_mock() {
      let _ =
        disconnect_to_mock(state, processor, shared_state, broadcast_tx).await;
    } else if current_count > 0 && processor.is_mock() {
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
    }
  }

  while let Some(event) = monitor.try_recv() {
    match event.kind {
      HotplugEventKind::Attached => {
        if event.device_type == "unknown" {
          debug!("Ignoring unrelated USB attach event");
        } else {
          info!(
            "USB attach event received for {} (will reconcile on device count)",
            event.device_type
          );
        }
      }
      HotplugEventKind::Detached => {
        if event.device_type == "unknown" {
          debug!("Ignoring unrelated USB detach event");
        } else {
          info!(
            "USB detach event received for {} (will reconcile on device count)",
            event.device_type
          );
        }
      }
    }
  }
}

async fn attach_real_device(
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) -> Result<()> {
  info!("Probing supported device attach path");
  shared_state.set_device_state("loading", Some("connect"));
  broadcast_device_status(shared_state, broadcast_tx);

  let mut last_err = None;
  let mut new_device = None;
  for attempt in 1..=5 {
    match SdrDeviceFactory::create_device() {
      Ok(device)
        if !device.device_type().to_ascii_lowercase().contains("mock") =>
      {
        new_device = Some(device);
        break;
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

  let new_device = match new_device {
    Some(device) => device,
    None => {
      let err =
        last_err.unwrap_or_else(|| anyhow!("Supported device open failed"));
      shared_state.set_device_state("disconnected", None);
      broadcast_device_status(shared_state, broadcast_tx);
      return Err(err);
    }
  };

  processor.swap_device(new_device)?;
  shared_state.update_device_status(
    true,
    processor.get_device_info(),
    build_device_profile(processor.device_type()),
  );
  broadcast_device_status(shared_state, broadcast_tx);
  Ok(())
}

async fn disconnect_to_mock(
  state: &mut HotplugState,
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) -> Result<()> {
  shared_state.set_device_state("disconnected", None);
  broadcast_device_status(shared_state, broadcast_tx);
  let mock_device = SdrDeviceFactory::create_mock_device();
  processor.swap_device(mock_device)?;
  shared_state.update_device_status(
    false,
    processor.get_device_info(),
    build_device_profile(processor.device_type()),
  );
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

  let is_warming_up = state
    .last_hardware_swap
    .map(|t| t.elapsed() < Duration::from_secs(5))
    .unwrap_or(false);
  let warming_up_after_success =
    is_warming_up && has_post_swap_success(state, shared_state);
  if processor.is_healthy() || warming_up_after_success {
    let prev = shared_state.health_failure_streak.load(Ordering::Relaxed);
    if prev > 0 {
      info!("Device health restored after {} failure(s)", prev);
      shared_state
        .health_failure_streak
        .store(0, Ordering::Relaxed);
      shared_state.recovery_attempts.store(0, Ordering::Relaxed);
      shared_state.set_device_state("connected", None);
      broadcast_device_status(shared_state, broadcast_tx);
    }
    return;
  }

  let streak = shared_state.record_health_failure();
  let recovery_count = shared_state.recovery_attempts.load(Ordering::Relaxed);
  warn!(
    "Device health check failed (streak {}/{}, recovery attempts {}/{})",
    streak, DISCONNECT_FAILURE_THRESHOLD, recovery_count, MAX_RECOVERY_ATTEMPTS
  );

  if streak < DISCONNECT_FAILURE_THRESHOLD {
    let supported_device_present = supported_usb_device_present();
    if !supported_device_present {
      warn!("Supported USB device disappeared during recovery window. Falling back to mock immediately.");
      shared_state.set_device_state("disconnected", None);
      broadcast_device_status(shared_state, broadcast_tx);
      let _ = stop_capture(processor);
      let mock_device = SdrDeviceFactory::create_mock_device();
      if let Err(e) = processor.swap_device(mock_device) {
        error!(
          "Failed to fall back to mock device after early unplug: {}",
          e
        );
      } else {
        shared_state.update_device_status(
          false,
          processor.get_device_info(),
          build_device_profile(processor.device_type()),
        );
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
      } else {
        info!("Device re-init succeeded, awaiting health confirmation...");
        state.last_hardware_swap = Some(Instant::now());
      }
    } else {
      warn!(
        "Recovery budget exhausted ({} attempts). Holding disconnected for {:?} before trying again.",
        MAX_RECOVERY_ATTEMPTS, state.exhausted_recovery_cooldown
      );
      shared_state.set_device_state("disconnected", None);
      broadcast_device_status(shared_state, broadcast_tx);
      state.last_failure_at = Some(Instant::now());
      tokio::time::sleep(state.exhausted_recovery_cooldown).await;
    }
  } else {
    let supported_device_present = supported_usb_device_present();
    if !supported_device_present {
      warn!("Supported device confirmed unplugged. Falling back to mock.");
      shared_state.set_device_state("disconnected", None);
      broadcast_device_status(shared_state, broadcast_tx);
      let _ = stop_capture(processor);
      let mock_device = SdrDeviceFactory::create_mock_device();
      if let Err(e) = processor.swap_device(mock_device) {
        error!(
          "Failed to fall back to mock device after confirmed unplug: {}",
          e
        );
      } else {
        shared_state.update_device_status(
          false,
          processor.get_device_info(),
          build_device_profile(processor.device_type()),
        );
        broadcast_device_status(shared_state, broadcast_tx);
        state.last_failure_at = Some(Instant::now());
        info!("Fell back to mock mode after confirmed unplug");
      }
    } else {
      warn!(
        "Supported device still on USB but unhealthy. Attempting full restart..."
      );
      let _ = stop_capture(processor);
      shared_state.set_device_state("loading", Some("restart"));
      broadcast_device_status(shared_state, broadcast_tx);
      match SdrDeviceFactory::create_device() {
        Ok(new_device) if !new_device.device_type().contains("Mock") => {
          if let Err(e) = processor.swap_device(new_device) {
            error!("Full restart swap failed: {}", e);
            let mock_device = SdrDeviceFactory::create_mock_device();
            if let Err(me) = processor.swap_device(mock_device) {
              error!("Emergency mock fallback also failed: {}", me);
            }
            shared_state.update_device_status(
              false,
              processor.get_device_info(),
              build_device_profile(processor.device_type()),
            );
            broadcast_device_status(shared_state, broadcast_tx);
          } else {
            shared_state.update_device_status(
              true,
              processor.get_device_info(),
              build_device_profile(processor.device_type()),
            );
            broadcast_device_status(shared_state, broadcast_tx);
            state.last_hardware_swap = Some(Instant::now());
            info!("Full device restart succeeded");
          }
        }
        _ => {
          let mock_device = SdrDeviceFactory::create_mock_device();
          if let Err(me) = processor.swap_device(mock_device) {
            error!("Mock fallback after restart failure: {}", me);
          }
          shared_state.update_device_status(
            false,
            processor.get_device_info(),
            build_device_profile(processor.device_type()),
          );
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
  fn warming_up_requires_a_successful_read_after_swap() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
    let shared_state = SharedState::new("redis://127.0.0.1:6379");
    let state = HotplugState::new();

    assert!(!has_post_swap_success(&state, &shared_state));
  }
}
