//! Exclusive ownership of the active SDR processor.

use anyhow::Result;
use std::time::Instant;
use tokio::sync::{broadcast, Mutex};

use crate::sdr::hotplug::HotplugState;
use crate::sdr::processor::SdrProcessor;
use crate::sdr::SdrDeviceFactory;
use crate::server::shared_state::SharedState;
use crate::server::types::PowerScale;
use crate::server::websocket_server::{
  active_source_id, broadcast_device_status, build_device_profile,
  sync_shared_sample_rate,
};

#[derive(Clone)]
pub struct DeviceSupervisor {
  processor: std::sync::Arc<Mutex<SdrProcessor>>,
}

impl DeviceSupervisor {
  pub fn new(processor: SdrProcessor) -> Self {
    Self {
      processor: std::sync::Arc::new(Mutex::new(processor)),
    }
  }

  /// Initialize the active device, falling back to the simulated APT source
  /// when the selected hardware cannot be opened. No API handler performs
  /// this work directly.
  pub async fn initialize(&self) -> Result<bool> {
    let mut processor = self.processor.lock().await;
    // Construction starts from a lightweight Mock APT processor so the HTTP
    // server can bind before USB probing. Hardware discovery and processor
    // replacement happen only on the dedicated SDR worker.
    if processor.is_mock() {
      match SdrDeviceFactory::create_device() {
        Ok(device)
          if !device.device_type().to_ascii_lowercase().contains("mock") =>
        {
          match SdrProcessor::with_device(device) {
            Ok(real_processor) => *processor = real_processor,
            Err(error) => log::warn!(
              "Failed to construct processor for discovered SDR: {}; retaining mock mode",
              error
            ),
          }
        }
        Ok(_) => {}
        Err(error) => log::debug!(
          "No physical SDR available during deferred startup: {}",
          error
        ),
      }
    }

    let mut used_mock_fallback = false;
    if let Err(error) = processor.initialize() {
      used_mock_fallback = true;
      log::warn!(
        "Failed to initialize SDR processor: {}, using mock APT mode",
        error
      );
      let mut fallback = SdrProcessor::new_mock_apt().map_err(|e| {
        anyhow::anyhow!("Failed to create mock APT SDR processor: {e}")
      })?;
      fallback.initialize().map_err(|e| {
        anyhow::anyhow!("Failed to initialize mock APT SDR processor: {e}")
      })?;
      *processor = fallback;
    }
    Ok(used_mock_fallback)
  }

  /// Compatibility access for legacy handlers while they migrate to worker
  /// commands. The supervisor remains the owner of the underlying handle.
  pub fn processor_handle(&self) -> std::sync::Arc<Mutex<SdrProcessor>> {
    self.processor.clone()
  }

  /// Release and recreate the active SDR device in the safe order required by
  /// USB-backed devices. Restarting the reader alone is insufficient because
  /// the old device can retain its libusb interface claim.
  ///
  /// This is deliberately synchronous: it performs blocking USB work
  /// (release, reopen, settle). Callers must run it on the blocking pool;
  /// the processor lock is taken with `blocking_lock`, which is only valid
  /// outside the async reactor threads.
  pub fn restart(
    &self,
    shared_state: &SharedState,
    broadcast_tx: &broadcast::Sender<String>,
    hotplug_state: &mut HotplugState,
  ) {
    let mut processor = self.processor.blocking_lock();
    log::info!("Processing RestartDevice command");
    shared_state.set_device_state("loading", Some("restart"));
    broadcast_device_status(shared_state, broadcast_tx);

    let release_result = if processor.is_mock() {
      processor.cleanup()
    } else {
      processor.swap_device(SdrDeviceFactory::create_mock_device())
    };
    let new_device_res = match release_result {
      Ok(()) => SdrDeviceFactory::create_device(),
      Err(error) => Err(anyhow::anyhow!(
        "failed to release current SDR before restart: {}",
        error
      )),
    };

    match new_device_res {
      Ok(new_device) => {
        if let Err(error) = processor.swap_device(new_device) {
          log::error!("Failed to swap SDR processor device: {}", error);
          publish_current_device_state(&processor, shared_state, broadcast_tx);
        } else {
          sync_shared_sample_rate(shared_state, &processor);
          restore_last_frequency(&mut processor, shared_state);
          publish_current_device_state(&processor, shared_state, broadcast_tx);
          hotplug_state.last_hardware_swap = Some(Instant::now());
        }
      }
      Err(error) => {
        log::error!("Failed to create new device on restart: {}", error);
        if let Err(restart_error) = processor.initialize() {
          log::error!("Failed to restart existing device: {}", restart_error);
        } else {
          hotplug_state.last_hardware_swap = Some(Instant::now());
        }
        publish_current_device_state(&processor, shared_state, broadcast_tx);
        let active_id = active_source_id(shared_state);
        shared_state.sync_active_source_pause_state(&active_id);
      }
    }
  }

  pub async fn set_power_scale(&self, scale: PowerScale) {
    let mut processor = self.processor.lock().await;
    log::info!("Setting power scale to: {:?}", scale);
    processor.set_power_scale(scale);
  }
}

fn restore_last_frequency(
  processor: &mut SdrProcessor,
  shared_state: &SharedState,
) {
  let last_frequency = shared_state
    .pending_center_freq
    .load(std::sync::atomic::Ordering::Relaxed);
  if last_frequency > 0 {
    if let Err(error) = processor.set_center_frequency(last_frequency) {
      log::warn!(
        "Failed to apply last known frequency after restart swap: {}",
        error
      );
    }
  }
}

fn publish_current_device_state(
  processor: &SdrProcessor,
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) {
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
  broadcast_device_status(shared_state, broadcast_tx);
}
