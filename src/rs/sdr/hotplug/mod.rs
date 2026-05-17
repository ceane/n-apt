use crate::server::shared_state::{
  SharedState, DEVICE_PROBE_INTERVAL, DISCONNECT_FAILURE_THRESHOLD,
  MAX_RECOVERY_ATTEMPTS,
};
use crate::sdr::{processor::SdrProcessor, SdrDeviceFactory};
use anyhow::{anyhow, Result};
use rusb::{Context, Device, Hotplug, HotplugBuilder, UsbContext};
use log::{error, info, warn};
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
    .map_err(|e| anyhow!("Failed to register libusb hotplug callback: {}", e))?;

  loop {
    ctx.handle_events(None)
      .map_err(|e| anyhow!("libusb event loop error: {}", e))?;
  }
}

fn device_type_hint<T: rusb::UsbContext>(device: &Device<T>) -> String {
  let desc = device.device_descriptor();
  if let Ok(desc) = desc {
    match (desc.vendor_id(), desc.product_id()) {
      (0x0bda, _) => "rtl-sdr".to_string(),
      (0x1d50, _) => "hackrf".to_string(),
      _ => "unknown".to_string(),
    }
  } else {
    "unknown".to_string()
  }
}

pub(crate) fn should_enter_hardware_recovery(device_type: &str) -> bool {
  !device_type.to_ascii_lowercase().contains("mock")
}

pub(crate) fn is_recovery_budget_exhausted(
  recovery_attempts: u32,
  max_recovery_attempts: u32,
) -> bool {
  recovery_attempts >= max_recovery_attempts
}

pub async fn drain_hotplug_events(
  monitor: &HotplugMonitor,
  state: &mut HotplugState,
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) {
  while let Some(event) = monitor.try_recv() {
    match event.kind {
      HotplugEventKind::Attached => {
        if processor.is_mock() {
          info!("USB attach event received for {}", event.device_type);
          if let Err(e) = attach_real_device(processor, shared_state, broadcast_tx).await {
            error!("hotplug attach failed: {}", e);
          } else {
            state.last_hardware_swap = Some(Instant::now());
          }
        }
      }
      HotplugEventKind::Detached => {
        if !processor.is_mock() {
          info!("USB detach event received for {}", event.device_type);
          let _ = disconnect_to_mock(state, processor, shared_state, broadcast_tx).await;
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
  shared_state.set_device_state("loading", Some("connect"));
  broadcast_device_status(shared_state, broadcast_tx);
  let new_device = SdrDeviceFactory::create_rtlsdr_device()?;
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
) {
  if state.last_poll.elapsed() < DEVICE_PROBE_INTERVAL {
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
  if processor.is_healthy() || is_warming_up {
    let prev = shared_state.health_failure_streak.load(Ordering::Relaxed);
    if prev > 0 {
      info!("RTL-SDR health restored after {} failure(s)", prev);
      shared_state.health_failure_streak.store(0, Ordering::Relaxed);
      shared_state.recovery_attempts.store(0, Ordering::Relaxed);
      shared_state.set_device_state("connected", None);
      broadcast_device_status(shared_state, broadcast_tx);
    }
    return;
  }

  let streak = shared_state.record_health_failure();
  let recovery_count = shared_state.recovery_attempts.load(Ordering::Relaxed);
  warn!(
    "RTL-SDR health check failed (streak {}/{}, recovery attempts {}/{})",
    streak, DISCONNECT_FAILURE_THRESHOLD, recovery_count, MAX_RECOVERY_ATTEMPTS
  );

  if streak < DISCONNECT_FAILURE_THRESHOLD {
    let usb_count = crate::sdr::rtlsdr::device::RtlSdrDevice::get_device_count();
    if usb_count == 0 {
      warn!("RTL-SDR disappeared during recovery window. Falling back to mock immediately.");
      shared_state.set_device_state("disconnected", None);
      broadcast_device_status(shared_state, broadcast_tx);
      let _ = stop_capture(processor);
      let mock_device = SdrDeviceFactory::create_mock_device();
      if let Err(e) = processor.swap_device(mock_device) {
        error!("Failed to fall back to mock device after early unplug: {}", e);
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
      shared_state.recovery_attempts.fetch_add(1, Ordering::Relaxed);
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
    let usb_count = crate::sdr::rtlsdr::device::RtlSdrDevice::get_device_count();
    if usb_count == 0 {
      warn!("RTL-SDR confirmed unplugged (device_count=0). Falling back to mock.");
      shared_state.set_device_state("disconnected", None);
      broadcast_device_status(shared_state, broadcast_tx);
      let _ = stop_capture(processor);
      let mock_device = SdrDeviceFactory::create_mock_device();
      if let Err(e) = processor.swap_device(mock_device) {
        error!("Failed to fall back to mock device after confirmed unplug: {}", e);
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
        "RTL-SDR still on USB (count={}) but unhealthy. Attempting full restart...",
        usb_count
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
