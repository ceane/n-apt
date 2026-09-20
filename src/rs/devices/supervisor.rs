//! Exclusive ownership of the active SDR processor.

use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, Mutex};

use crate::sdr::processor::{DeviceAttachOutcome, SdrProcessor};
use crate::sdr::{SdrDevice, SdrDeviceFactory};
use crate::server::shared_state::{
  SharedState, DEVICE_OPEN_DEADLINE, DEVICE_RELEASE_DEADLINE,
  DEVICE_RESTART_DEADLINE,
};
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
  /// Returns whether a real replacement device was installed. A restart that
  /// only reaches the simulated source reports `false` so the caller applies
  /// its retry cooldown.
  ///
  /// This is deliberately synchronous: it performs blocking USB work (release,
  /// reopen, settle). It **must** be invoked through `spawn_blocking` — it takes
  /// the processor lock with `blocking_lock`, which panics if called from inside
  /// a runtime context. Use [`DeviceSupervisor::restart_off_reactor`] instead.
  pub fn restart(
    &self,
    shared_state: &SharedState,
    broadcast_tx: &broadcast::Sender<String>,
  ) -> bool {
    log::info!("Processing RestartDevice command");
    let device_kind = shared_state.device_profile.lock().unwrap().kind.clone();
    shared_state.set_device_state("loading", Some("restart"));
    broadcast_device_status(shared_state, broadcast_tx);

    // Detach under a brief lock. Everything with an unbounded worst case — the
    // native close of the old handle and the open of its replacement — then runs
    // without the processor lock, so a wedged USB call can no longer stall
    // frame production, health checks, or hotplug fallback.
    let detached = {
      let mut processor = self.processor.blocking_lock();
      processor.detach_device()
    };

    if let Err(error) = release_device_with_deadline(
      detached.device,
      DEVICE_RELEASE_DEADLINE,
    ) {
      log::error!(
        "Failed to release the previous SDR before restart: {}",
        error
      );
      resolve_unfinished_restart(
        shared_state,
        broadcast_tx,
        &device_kind,
        &error,
      );
      return false;
    }

    // Open only once the previous interface is actually released: opening into
    // a still-claimed interface is the `usb_claim_interface error -3` loop.
    let device = match open_with_deadline(DEVICE_OPEN_DEADLINE, || {
      SdrDeviceFactory::create_device()
    }) {
      Ok(device) => device,
      Err(error) => {
        log::error!("Failed to create new device on restart: {}", error);
        resolve_unfinished_restart(
          shared_state,
          broadcast_tx,
          &device_kind,
          &error.to_string(),
        );
        return false;
      }
    };

    let reopened_real =
      !device.device_type().to_ascii_lowercase().contains("mock");
    if !reopened_real {
      // Keep streaming from the simulated source, but report the restart as
      // failed so the caller applies its retry cooldown.
      log::error!(
        "Restart reopened no physical SDR; retaining the simulated source"
      );
    }

    let mut processor = self.processor.blocking_lock();
    match processor.attach_device(device, detached.generation) {
      DeviceAttachOutcome::Installed => {
        sync_shared_sample_rate(shared_state, &processor);
        restore_last_frequency(&mut processor, shared_state);
        publish_current_device_state(&processor, shared_state, broadcast_tx);
        reopened_real
      }
      DeviceAttachOutcome::ConfigureFailed(error) => {
        log::error!("Failed to configure the reopened SDR: {}", error);
        publish_current_device_state(&processor, shared_state, broadcast_tx);
        false
      }
      DeviceAttachOutcome::Superseded(device) => {
        // A newer replacement landed while this restart was opening. Retire the
        // unused handle without the lock.
        drop(processor);
        log::warn!(
          "Restart was superseded by a newer device; discarding the reopened handle"
        );
        let _ = release_device_with_deadline(device, DEVICE_OPEN_DEADLINE);
        false
      }
    }
  }

  /// Restart the active device without blocking the reactor, under a deadline.
  ///
  /// Runs [`DeviceSupervisor::restart`] on the blocking pool and bounds the wait
  /// with [`DEVICE_RESTART_DEADLINE`]. A restart that overruns the deadline — or
  /// panics — resolves the device to an actionable state instead of leaving the
  /// UI pinned on the `loading`/`restart` placeholder: `stale` while the device
  /// is still on the bus so Restart stays available, `disconnected` once it is
  /// gone so the mock fallback runs.
  ///
  /// A timed-out restart is a last resort rather than the expected path: the
  /// unbounded native work already runs detached, so the processor lock is free
  /// while it happens. The timeout path still never touches the processor, since
  /// the task may be mid-install, and leaves fallback to the health/hotplug poll.
  pub async fn restart_off_reactor(
    &self,
    shared_state: &Arc<SharedState>,
    broadcast_tx: &broadcast::Sender<String>,
  ) -> bool {
    let device_kind = shared_state.device_profile.lock().unwrap().kind.clone();
    let supervisor = self.clone();
    let shared_for_task = Arc::clone(shared_state);
    let broadcast_for_task = broadcast_tx.clone();

    let joined = tokio::time::timeout(
      DEVICE_RESTART_DEADLINE,
      tokio::task::spawn_blocking(move || {
        supervisor.restart(&shared_for_task, &broadcast_for_task)
      }),
    )
    .await;

    match joined {
      Ok(Ok(restarted)) => restarted,
      Ok(Err(join_error)) => {
        resolve_unfinished_restart(
          shared_state,
          broadcast_tx,
          &device_kind,
          &format!("Device restart task failed: {join_error}"),
        );
        false
      }
      Err(_elapsed) => {
        resolve_unfinished_restart(
          shared_state,
          broadcast_tx,
          &device_kind,
          &format!(
            "Device restart exceeded the {:?} deadline",
            DEVICE_RESTART_DEADLINE
          ),
        );
        false
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

/// Run blocking native work on a named scratch thread, waiting at most
/// `deadline` for it.
///
/// librtlsdr's open and close can both block indefinitely on a busy or
/// half-detached USB handle. Recovery must not inherit that: a scratch thread
/// that overruns its deadline is abandoned rather than joined, so a wedged call
/// can never pin the caller or the processor lock.
fn run_off_thread<T: Send + 'static>(
  name: &str,
  deadline: Duration,
  work: impl FnOnce() -> T + Send + 'static,
) -> std::result::Result<T, String> {
  let (tx, rx) = std::sync::mpsc::channel();
  std::thread::Builder::new()
    .name(name.to_string())
    .spawn(move || {
      let _ = tx.send(work());
    })
    .map_err(|error| format!("failed to spawn the {name} thread: {error}"))?;

  match rx.recv_timeout(deadline) {
    Ok(value) => Ok(value),
    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(format!(
      "{name} exceeded the {deadline:?} deadline; the work is left to unwind in the background"
    )),
    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
      Err(format!("{name} exited without reporting a result"))
    }
  }
}

/// Open a replacement device, bounded by `deadline`.
fn open_with_deadline(
  deadline: Duration,
  open: impl FnOnce() -> Result<Box<dyn SdrDevice>> + Send + 'static,
) -> Result<Box<dyn SdrDevice>> {
  run_off_thread("n-apt-sdr-open", deadline, open)
    .map_err(|error| anyhow::anyhow!("SDR device open {error}"))?
}

/// Quiesce and close a detached device, waiting at most `deadline`.
///
/// The standby handshake and `rtlsdr_close` are both unbounded in librtlsdr, so
/// the work runs on a thread that is abandoned on timeout rather than joined: a
/// handle that will not release must not be able to pin recovery. Reporting
/// failure here is deliberate — opening a replacement while the old interface is
/// still claimed is what produces `usb_claim_interface error -3`.
fn release_device_with_deadline(
  device: Box<dyn SdrDevice>,
  deadline: Duration,
) -> std::result::Result<(), String> {
  let standby = run_off_thread("n-apt-sdr-close", deadline, move || {
    let mut device = device;
    let standby = crate::sdr::processor::stop_warm_device(device.as_mut());
    // Dropping the handle performs the native close.
    drop(device);
    standby.err().map(|error| error.to_string())
  })?;

  match standby {
    None => Ok(()),
    Some(error) => {
      Err(format!("device standby failed before restart: {error}"))
    }
  }
}

/// Device state to publish when a restart did not complete.
///
/// Presence-aware: a device still on the bus becomes `stale` so the Restart
/// action stays available, while a missing one becomes `disconnected` so the
/// normal mock fallback takes over.
fn unfinished_restart_state(device_present: bool) -> &'static str {
  if device_present {
    "stale"
  } else {
    "disconnected"
  }
}

/// Resolve a restart that did not complete into a state the UI can act on.
fn resolve_unfinished_restart(
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  device_kind: &str,
  error: &str,
) {
  let present =
    crate::sdr::hotplug::active_device_present(device_kind, shared_state);
  shared_state.set_device_state(unfinished_restart_state(present), None);
  shared_state.set_device_backend_error(Some(error.to_string()));
  // Mirror the stored pause state into the streaming fast path so a leftover
  // pause bit cannot leave the next frame blocked after an unresolved restart.
  let active_id = active_source_id(shared_state);
  shared_state.sync_active_source_pause_state(&active_id);
  broadcast_device_status(shared_state, broadcast_tx);
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::panic::AssertUnwindSafe;
  use std::time::Instant;

  #[test]
  #[serial_test::serial]
  fn blocking_restart_panics_inside_a_runtime() {
    // Guards the reason the dispatch must use `restart_off_reactor`: the
    // blocking entry point takes the processor lock with `blocking_lock`, which
    // panics while the current thread is driving a runtime. That panic used to
    // unwind the whole `n-apt-sdr-io` worker, freezing frames, health checks,
    // and hotplug fallback together.
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
    let runtime = tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .expect("runtime");
    let shared = Arc::new(SharedState::new("redis://127.0.0.1:6379"));
    let (broadcast_tx, _rx) = broadcast::channel(4);
    let supervisor = DeviceSupervisor::new(
      SdrProcessor::new_mock_apt().expect("mock processor"),
    );

    let outcome = runtime.block_on(async {
      std::panic::catch_unwind(AssertUnwindSafe(|| {
        supervisor.restart(&shared, &broadcast_tx)
      }))
    });

    assert!(
      outcome.is_err(),
      "blocking restart must not be callable from the reactor"
    );
  }

  #[test]
  fn open_with_deadline_returns_the_open_result_before_the_deadline() {
    let opened =
      open_with_deadline(Duration::from_secs(5), || {
        Ok(SdrDeviceFactory::create_mock_device())
      })
      .expect("a fast open must be returned");
    assert!(opened.device_type().to_ascii_lowercase().contains("mock"));
  }

  #[test]
  fn open_with_deadline_gives_up_when_the_open_overruns() {
    let deadline = Duration::from_millis(50);
    let started = Instant::now();
    let result = open_with_deadline(deadline, || {
      std::thread::sleep(Duration::from_secs(2));
      Ok(SdrDeviceFactory::create_mock_device())
    });

    assert!(
      result.is_err(),
      "an overrunning open must be abandoned, not waited on"
    );
    assert!(
      started.elapsed() < Duration::from_secs(5),
      "the processor lock hold must be bounded by the deadline"
    );
  }

  #[test]
  fn unfinished_restart_state_is_presence_aware() {
    assert_eq!(unfinished_restart_state(true), "stale");
    assert_eq!(unfinished_restart_state(false), "disconnected");
  }

  #[test]
  fn off_thread_work_returns_its_result_before_the_deadline() {
    let result = run_off_thread("test-fast", Duration::from_secs(5), || 7);
    assert_eq!(result.expect("bounded work must report its result"), 7);
  }

  #[test]
  fn off_thread_work_is_abandoned_when_it_overruns_the_deadline() {
    // The native close and open are unbounded in librtlsdr. Recovery must not
    // inherit that, so a scratch thread that overruns is left behind instead of
    // being waited on.
    let deadline = Duration::from_millis(50);
    let started = Instant::now();
    let result = run_off_thread("test-stall", deadline, || {
      std::thread::sleep(Duration::from_secs(2));
      7
    });

    assert!(result.is_err(), "an overrunning release must be reported");
    assert!(
      started.elapsed() < Duration::from_secs(1),
      "the caller must not wait for the overrunning work"
    );
  }
}
