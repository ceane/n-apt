//! Device health, hotplug, and warm-source recovery orchestration.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use anyhow::Result;
use log::{debug, error, info, warn};
use tokio::sync::{broadcast, Mutex};

use crate::sdr::hotplug::{
  handle_real_hardware_health, maybe_attach_hotplugged_device, HotplugMonitor,
  HotplugState,
};
use crate::sdr::processor::SdrProcessor;
use crate::sdr::SdrDevice;
use crate::server::shared_state::SharedState;
use crate::server::websocket_server::source_lifecycle::{
  prepare_selected_source_for_rx, should_restore_warm_source,
  take_warm_source_for_active,
};
use crate::server::websocket_server::{
  active_source_id, broadcast_channels, broadcast_device_status,
  broadcast_signals_defaults, broadcasting, build_device_profile,
  fallback_to_mock_after_recovery_failure, is_async_sample_timeout_error,
  open_device_for_source_id, read_failure_state,
  resolve_reader_recovery_action, should_fallback_to_mock_on_early_read_error,
  should_fallback_to_mock_on_threshold_read_error, should_ignore_read_error,
  should_mark_read_error_stale, sync_shared_sample_rate, ReaderRecoveryAction,
  SourceLifecyclePhase,
};

/// Runs periodic device recovery without making the websocket loop own the
/// health policy or hotplug implementation details.
#[derive(Clone)]
pub struct DeviceHealthWorker {
  processor: Arc<Mutex<SdrProcessor>>,
  channels_last_check: Arc<std::sync::Mutex<Instant>>,
  last_signals_modified: Arc<std::sync::Mutex<Option<SystemTime>>>,
}

impl DeviceHealthWorker {
  pub fn new(processor: Arc<Mutex<SdrProcessor>>) -> Self {
    Self {
      processor,
      channels_last_check: Arc::new(std::sync::Mutex::new(Instant::now())),
      last_signals_modified: Arc::new(std::sync::Mutex::new(
        crate::server::utils::signals_config_modified_at(),
      )),
    }
  }

  /// Reload channel definitions when the source configuration changes.
  pub fn reload_channels(
    &self,
    shared_state: &SharedState,
    broadcast_tx: &broadcast::Sender<String>,
  ) {
    let should_check = {
      let mut last_check = self.channels_last_check.lock().unwrap();
      if last_check.elapsed() < Duration::from_secs(2) {
        false
      } else {
        *last_check = Instant::now();
        true
      }
    };
    if !should_check {
      return;
    }

    let current_modified = crate::server::utils::signals_config_modified_at();
    let changed = {
      let mut last_modified = self.last_signals_modified.lock().unwrap();
      if *last_modified == current_modified {
        false
      } else {
        *last_modified = current_modified;
        true
      }
    };
    if !changed {
      return;
    }

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
      *shared_state.channels.lock().unwrap() = new_channels;
      broadcast_channels(shared_state, broadcast_tx);
    }
    broadcast_signals_defaults(broadcast_tx);
    broadcast_device_status(shared_state, broadcast_tx);
  }

  /// Attach already-present hardware during startup.
  ///
  /// Inactive sources are opened lazily on selection. Prewarming every USB
  /// peer here made one claimed/broken device block the first frame from a
  /// healthy active device.
  pub async fn attach_startup(
    &self,
    hotplug_monitor: &HotplugMonitor,
    hotplug_state: &mut HotplugState,
    shared_state: &SharedState,
    broadcast_tx: &broadcast::Sender<String>,
  ) {
    let mut processor = self.processor.lock().await;
    for attempt in 0..5 {
      maybe_attach_hotplugged_device(
        hotplug_monitor,
        hotplug_state,
        &mut processor,
        shared_state,
        broadcast_tx,
        true,
      )
      .await;
      if !processor.is_mock() {
        break;
      }
      if attempt < 4 {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
      }
    }

    broadcast_device_status(shared_state, broadcast_tx);
  }

  /// Applies debounced recovery for a failed acquisition read.
  ///
  /// Read failures are device-health events, not websocket transport events.
  /// Keeping this policy here lets the streaming loop remain responsible for
  /// frame ownership and publication only.
  pub async fn handle_read_error(
    &self,
    e: anyhow::Error,
    hotplug_state: &mut HotplugState,
    shared_state: &SharedState,
    broadcast_tx: &broadcast::Sender<String>,
  ) {
    let _broadcast_tx = broadcast_tx;
    // ── Read error: use the same debounced recovery logic ──
    //
    // A read error from real hardware is treated as a health failure.
    // Mock errors are extremely unlikely but handled gracefully.
    let mut processor = self.processor.lock().await;

    if processor.is_mock() {
      // Mock should never fail, but don't crash — just wait briefly
      warn!("Mock SDR read error (unexpected): {}", e);
      tokio::time::sleep(Duration::from_millis(100)).await;
    } else {
      let current_state = shared_state.device_state.lock().unwrap().clone();
      if should_ignore_read_error(&current_state, &e) {
        debug!(
          "Ignoring read error/timeout while device is in {} state: {}",
          current_state, e
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
        return;
      }

      let streak = shared_state.record_health_failure();
      // A reader failure is not proof of USB removal. Non-timeout errors and
      // debounced timeout failures mark the stream stale, while transient
      // async sample timeouts keep the current presentation alive and let the
      // recovery counter reach the reader-restart path.
      if should_mark_read_error_stale(&e, streak) {
        if let Some(read_state) = read_failure_state(&current_state) {
          if current_state != read_state {
            shared_state.set_device_state(read_state, None);
            broadcast_device_status(&shared_state, &_broadcast_tx);
          }
        }
      }

      let recovery_count =
        shared_state.recovery_attempts.load(Ordering::Relaxed);

      error!(
        "SDR read error (streak {}/{}, recovery {}/{}): {}",
        streak,
        crate::server::shared_state::DISCONNECT_FAILURE_THRESHOLD,
        recovery_count,
        crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
        e,
      );

      // Publish the liveness snapshot on every read failure. The source
      // payload computes `receiving` from a recent successful frame, so this
      // lets clients leave Receiving as soon as that proof expires instead of
      // waiting for the debounced recovery transition.
      broadcast_device_status(&shared_state, &_broadcast_tx);

      if let Some(last_failed) = hotplug_state.last_failure_at {
        if last_failed.elapsed() < hotplug_state.retry_cooldown {
          debug!(
              "Skipping recovery while cooling down after repeated device failure"
            );
          tokio::time::sleep(Duration::from_millis(250)).await;
          return;
        }
      }

      if streak < crate::server::shared_state::DISCONNECT_FAILURE_THRESHOLD {
        let supported_device_present =
          shared_state.usb_inventory_known.load(Ordering::Acquire)
            && shared_state
              .supported_usb_device_count
              .load(Ordering::Relaxed)
              > 0;
        if should_fallback_to_mock_on_early_read_error(
          streak,
          supported_device_present,
        ) {
          warn!(
            "Supported USB device unplugged after read error. Falling back to mock immediately."
          );
          let was_hackrf = processor.device_type() == "hackrf_one";
          shared_state.set_device_state("disconnected", None);
          if was_hackrf {
            shared_state.set_device_backend_error(Some(
              broadcasting::HACKRF_DISCONNECT_ADVISORY.to_string(),
            ));
          }
          broadcast_device_status(&shared_state, &_broadcast_tx);

          let mock_device = crate::sdr::SdrDeviceFactory::create_mock_device();
          if let Err(swap_e) = processor.swap_device(mock_device) {
            error!("Failed to swap to mock after early unplug: {}", swap_e);
          } else {
            sync_shared_sample_rate(&shared_state, &processor);
            shared_state.update_device_status(
              false,
              processor.get_device_info(),
              build_device_profile(processor.device_type()),
            );
            if was_hackrf {
              shared_state.set_device_backend_error(Some(
                broadcasting::HACKRF_DISCONNECT_ADVISORY.to_string(),
              ));
            } else {
              shared_state.set_device_backend_error(processor.get_error());
            }
            shared_state.set_active_source_pause_state("mock-apt", false);
            broadcast_device_status(&shared_state, &_broadcast_tx);
          }
        } else if !supported_device_present && is_async_sample_timeout_error(&e)
        {
          debug!(
            "Async SDR sample timeout occurred before disconnect threshold; keeping real device in recovery"
          );
        }

        // Brief settle regardless
        tokio::time::sleep(Duration::from_millis(100)).await;
      } else {
        // Threshold reached: restart stalled readers before falling back.
        let supported_device_present =
          shared_state.usb_inventory_known.load(Ordering::Acquire)
            && shared_state
              .supported_usb_device_count
              .load(Ordering::Relaxed)
              > 0;
        warn!(
            "Read-error threshold reached (streak={}). Supported USB device present={}.",
            streak, supported_device_present,
          );
        let reader_recovery_action = resolve_reader_recovery_action(
          is_async_sample_timeout_error(&e),
          processor.is_rx_active(),
          streak,
          supported_device_present,
        );
        if matches!(
          reader_recovery_action,
          ReaderRecoveryAction::RestartReader
        ) {
          // A sample timeout means the current reader stalled; it does
          // not mean the USB device should be reopened. Keep the
          // existing handle, restart its reader, and reserve the device
          // recovery budget for an actual handle replacement.
          shared_state.recovery_attempts.store(0, Ordering::Relaxed);
          shared_state.set_device_state("loading", Some("restart"));
          broadcast_device_status(&shared_state, &_broadcast_tx);

          match processor.initialize() {
            Ok(()) => {
              info!(
                "Restarted current SDR async reader after sample timeout. Awaiting first healthy frame."
              );
              shared_state
                .health_failure_streak
                .store(0, Ordering::Relaxed);
              let active_id = active_source_id(&shared_state);
              shared_state.set_active_source_pause_state(&active_id, false);
              shared_state.set_device_backend_error(processor.get_error());
              broadcast_device_status(&shared_state, &_broadcast_tx);
              hotplug_state.last_hardware_swap = Some(Instant::now());
            }
            Err(restart_e) => {
              error!(
                "Failed to restart current SDR async reader after sample timeout: {}",
                restart_e
              );
              let supported_device_present =
                shared_state.usb_inventory_known.load(Ordering::Acquire)
                  && shared_state
                    .supported_usb_device_count
                    .load(Ordering::Relaxed)
                    > 0;
              if !supported_device_present {
                warn!(
                  "USB device disappeared while restarting reader; falling back to Mock APT"
                );
                shared_state.set_device_state("disconnected", None);
                broadcast_device_status(&shared_state, &_broadcast_tx);
                if let Err(swap_e) = processor.swap_device(
                  crate::sdr::SdrDeviceFactory::create_mock_device(),
                ) {
                  error!(
                    "Failed to swap to mock after reader loss: {}",
                    swap_e
                  );
                } else {
                  sync_shared_sample_rate(&shared_state, &processor);
                  shared_state.update_device_status(
                    false,
                    processor.get_device_info(),
                    build_device_profile(processor.device_type()),
                  );
                  shared_state.set_active_source_pause_state("mock-apt", false);
                }
                shared_state.set_device_backend_error(Some(format!(
                  "Async SDR sample reader restart failed after USB removal: {}",
                  restart_e
                )));
              } else {
                // A failed restart means the current USB handle is no
                // longer trustworthy (the common unplug/replug case
                // can leave the old handle present while its interface
                // has already been detached). Reopen the real device
                // immediately instead of retrying the same stale
                // handle forever on the loading placeholder.
                shared_state.set_device_state("stale", None);
                broadcast_device_status(&shared_state, &_broadcast_tx);
                match processor.cleanup() {
                  Err(cleanup_e) => {
                    warn!(
                      "Deferring RTL-SDR reopen until the old reader stops: {}",
                      cleanup_e
                    );
                    shared_state.set_device_backend_error(Some(
                      format!(
                        "Async SDR sample reader restart failed; waiting for USB reader shutdown: {}",
                        cleanup_e
                      ),
                    ));
                  }
                  Ok(()) => {
                    let requested_source_id = active_source_id(&shared_state);
                    match open_device_for_source_id(
                      &shared_state,
                      &requested_source_id,
                    ) {
                      Ok(new_device)
                        if !new_device
                          .device_type()
                          .to_ascii_lowercase()
                          .contains("mock") =>
                      {
                        if let Err(swap_e) = processor.swap_device(new_device) {
                          let fallback_error = format!(
                            "Failed to reopen selected SDR after reader restart failure: {}",
                            swap_e
                          );
                          error!("{}", fallback_error);
                          if let Err(mock_swap_e) =
                            fallback_to_mock_after_recovery_failure(
                              &mut processor,
                              &shared_state,
                              &_broadcast_tx,
                              fallback_error.clone(),
                            )
                          {
                            error!(
                              "Failed to fall back to Mock APT after device reopen failure: {}",
                              mock_swap_e
                            );
                            shared_state
                              .set_device_backend_error(Some(fallback_error));
                          }
                        } else {
                          info!(
                            "Reopened SDR after stale reader restart failure"
                          );
                          shared_state
                            .recovery_attempts
                            .store(0, Ordering::Relaxed);
                          let active_id = active_source_id(&shared_state);
                          shared_state
                            .set_active_source_pause_state(&active_id, false);
                          hotplug_state.last_hardware_swap =
                            Some(Instant::now());
                          shared_state
                            .set_device_backend_error(processor.get_error());
                        }
                      }
                      _ => {
                        let fallback_error = format!(
                          "Async SDR sample reader restart failed; no supported device available: {}",
                          restart_e
                        );
                        if let Err(swap_e) =
                          fallback_to_mock_after_recovery_failure(
                            &mut processor,
                            &shared_state,
                            &_broadcast_tx,
                            fallback_error.clone(),
                          )
                        {
                          error!(
                            "Failed to fall back to Mock APT after reader restart failure: {}",
                            swap_e
                          );
                          shared_state
                            .set_device_backend_error(Some(fallback_error));
                        }
                      }
                    }
                  }
                }
              }
              broadcast_device_status(&shared_state, &_broadcast_tx);
            }
          }
        } else if supported_device_present {
          if !crate::sdr::hotplug::is_recovery_budget_exhausted(
            recovery_count,
            crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
          ) {
            shared_state.set_device_state("loading", Some("restart"));
            broadcast_device_status(&shared_state, &_broadcast_tx);

            let cleanup_ready = match processor.cleanup() {
              Ok(()) => true,
              Err(cleanup_e) => {
                // Do not reopen the USB interface while a cancelled
                // RTL async reader is still unwinding.  Retrying the
                // open in that window is what causes claim-interface
                // failures and the permanent loading placeholder.
                warn!(
                  "SDR handle is still stopping; deferring replacement: {}",
                  cleanup_e
                );
                shared_state.set_device_state("loading", Some("restart"));
                shared_state
                  .set_device_backend_error(Some(cleanup_e.to_string()));
                broadcast_device_status(&shared_state, &_broadcast_tx);
                hotplug_state.last_hardware_swap = Some(Instant::now());
                false
              }
            };

            if !cleanup_ready {
              return;
            }

            let requested_source_id = active_source_id(&shared_state);
            match open_device_for_source_id(&shared_state, &requested_source_id)
            {
              Ok(new_device)
                if !new_device
                  .device_type()
                  .to_ascii_lowercase()
                  .contains("mock") =>
              {
                if let Err(swap_e) = processor.swap_device(new_device) {
                  let fallback_error = format!(
                    "Failed to swap to selected SDR on read error: {}",
                    swap_e
                  );
                  error!("{}", fallback_error);
                  if let Err(mock_swap_e) =
                    fallback_to_mock_after_recovery_failure(
                      &mut processor,
                      &shared_state,
                      &_broadcast_tx,
                      fallback_error.clone(),
                    )
                  {
                    error!(
                      "Failed to fall back to Mock APT after read-error swap failure: {}",
                      mock_swap_e
                    );
                    shared_state.set_device_backend_error(Some(fallback_error));
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                  }
                } else {
                  info!(
                    "Read-error swap succeeded. Awaiting first healthy frame."
                  );
                  shared_state
                    .recovery_attempts
                    .fetch_add(1, Ordering::Relaxed);
                  let active_id = active_source_id(&shared_state);
                  shared_state.set_active_source_pause_state(&active_id, false);
                  shared_state.set_device_backend_error(processor.get_error());
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                  hotplug_state.last_hardware_swap = Some(Instant::now());
                }
              }
              _ => {
                warn!(
                  "Read-error restart did not return the selected real device while USB is still present; falling back to Mock APT"
                );
                let fallback_error = format!(
                  "Selected SDR could not be reopened while USB is present: {}",
                  processor
                    .get_error()
                    .unwrap_or_else(|| "device reopen failed".to_string())
                );
                if let Err(swap_e) = fallback_to_mock_after_recovery_failure(
                  &mut processor,
                  &shared_state,
                  &_broadcast_tx,
                  fallback_error.clone(),
                ) {
                  error!(
                    "Failed to fall back to Mock APT after read-error reopen failure: {}",
                    swap_e
                  );
                  shared_state.set_device_backend_error(Some(fallback_error));
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                }
                hotplug_state.last_hardware_swap = Some(Instant::now());
              }
            }
          } else {
            warn!(
                "Recovery attempts exhausted ({}). Holding disconnected for {:?}.",
                crate::server::shared_state::MAX_RECOVERY_ATTEMPTS,
                hotplug_state.exhausted_recovery_cooldown
              );
            shared_state.set_device_state("disconnected", None);
            broadcast_device_status(&shared_state, &_broadcast_tx);
            hotplug_state.last_failure_at = Some(Instant::now());
            tokio::time::sleep(hotplug_state.exhausted_recovery_cooldown).await;
          }
        } else if should_fallback_to_mock_on_threshold_read_error(
          &e,
          supported_device_present,
        ) {
          let was_hackrf = processor.device_type() == "hackrf_one";
          shared_state.set_device_state("disconnected", None);
          if was_hackrf {
            shared_state.set_device_backend_error(Some(
              broadcasting::HACKRF_DISCONNECT_ADVISORY.to_string(),
            ));
          }
          broadcast_device_status(&shared_state, &_broadcast_tx);

          let mock_device = crate::sdr::SdrDeviceFactory::create_mock_device();
          if let Err(swap_e) = processor.swap_device(mock_device) {
            error!("Failed to swap to mock on read error: {}", swap_e);
          } else {
            sync_shared_sample_rate(&shared_state, &processor);
            shared_state.update_device_status(
              false,
              processor.get_device_info(),
              build_device_profile(processor.device_type()),
            );
            if was_hackrf {
              shared_state.set_device_backend_error(Some(
                broadcasting::HACKRF_DISCONNECT_ADVISORY.to_string(),
              ));
            } else {
              shared_state.set_device_backend_error(processor.get_error());
            }
            shared_state.set_active_source_pause_state("mock-apt", false);
            broadcast_device_status(&shared_state, &_broadcast_tx);
            hotplug_state.last_hardware_swap = Some(Instant::now());
          }
        } else {
          warn!(
            "Async SDR sample timeout reached read-error threshold without reliable USB presence; keeping real device in recovery"
          );
          shared_state.set_device_state("loading", Some("restart"));
          shared_state.set_device_backend_error(Some(e.to_string()));
          broadcast_device_status(&shared_state, &_broadcast_tx);
        }
        hotplug_state.last_failure_at = Some(Instant::now());
        tokio::time::sleep(Duration::from_millis(250)).await;
      }
    }
  }

  pub async fn poll(
    &self,
    hotplug_monitor: &HotplugMonitor,
    hotplug_state: &mut HotplugState,
    warm_devices: &mut HashMap<String, Box<dyn SdrDevice>>,
    shared_state: &SharedState,
    broadcast_tx: &broadcast::Sender<String>,
    mut stop_capture: impl FnMut(&mut SdrProcessor) -> Result<()>,
  ) {
    if hotplug_state.last_poll.elapsed()
      < crate::server::shared_state::HEALTH_CHECK_INTERVAL
    {
      return;
    }

    let mut processor = self.processor.lock().await;
    let active_source = active_source_id(shared_state);
    if should_restore_warm_source(processor.is_mock(), &active_source) {
      if let Some(warm_device) =
        take_warm_source_for_active(warm_devices, &active_source)
      {
        let source_id = active_source.clone();
        let restored_sample_rate =
          shared_state.sdr_settings.lock().unwrap().sample_rate;
        match processor.swap_device_keep_warm_with_sample_rate(
          warm_device,
          Some(restored_sample_rate),
        ) {
          Ok(previous_mock) => {
            drop(previous_mock);
            log::info!(
              "Restored warm SDR source {} instead of reopening USB",
              source_id
            );
            sync_shared_sample_rate(shared_state, &processor);
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
            prepare_selected_source_for_rx(
              shared_state,
              &source_id,
              SourceLifecyclePhase::Streaming,
            );
            shared_state.set_device_backend_error(processor.get_error());
            broadcast_device_status(shared_state, broadcast_tx);
            hotplug_state.last_hardware_swap = Some(Instant::now());
          }
          Err(error) => {
            log::warn!(
              "Warm SDR source {} could not resume ({}); falling back to USB discovery",
              source_id,
              error
            );
          }
        }
      }
    }

    maybe_attach_hotplugged_device(
      hotplug_monitor,
      hotplug_state,
      &mut processor,
      shared_state,
      broadcast_tx,
      false,
    )
    .await;
    handle_real_hardware_health(
      hotplug_state,
      &mut processor,
      shared_state,
      broadcast_tx,
      |processor| {
        if processor.capture_active {
          log::warn!("Stopping active capture due to device transition.");
          stop_capture(processor)?;
        }
        Ok(())
      },
    )
    .await;
  }
}
