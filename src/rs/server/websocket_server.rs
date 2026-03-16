//! WebSocket server with SDR processor integration
//! Handles real-time spectrum data streaming to frontend clients
//!
//! # RTL-SDR Hotplug Behaviour Contract
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
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use super::shared_state::SharedState;
use super::types::{DeviceProfile, SpectrumData, PowerScale};
use super::utils::reconcile_device_state;
use crate::sdr::processor::SdrProcessor;

/// Build and broadcast a device status message so all connected WebSocket
/// clients immediately learn about hotplug / unplug events.
fn broadcast_device_status(
  shared: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
) {
  let device_connected = shared.device_connected.load(Ordering::Relaxed);
  let device_info = shared.device_info.lock().unwrap().clone();
  let device_state = reconcile_device_state(
    device_connected,
    &shared.device_state.lock().unwrap(),
  );
  let device_loading = *shared.device_loading.lock().unwrap();
  let device_loading_reason =
    shared.device_loading_reason.lock().unwrap().clone();
  let paused = shared.is_paused.load(Ordering::Relaxed);
  let sdr_settings = shared.sdr_settings.lock().unwrap().clone();
  let channels = shared.channels.lock().unwrap().clone();
  let device_profile = shared.device_profile.lock().unwrap().clone();

  // Extract short device name from device_info
  let device_name = if device_connected {
    // Extract just the device name from the long device_info string
    // device_info format: "Long Name - Freq: X Hz, Rate: Y Hz, ..."
    device_info
      .split(" - ")
      .next()
      .unwrap_or("RTL-SDR")
      .to_string()
  } else {
    "Mock APT SDR".to_string()
  };

  let msg = serde_json::json!({
      "type": "status",
      "device_connected": device_connected,
      "device_info": device_info,
      "device_name": device_name,
      "device_loading": device_loading,
      "device_loading_reason": device_loading_reason,
      "device_state": device_state,
      "paused": paused,
      "max_sample_rate": sdr_settings.sample_rate,
      "sdr_settings": sdr_settings,
      "channels": channels,
      "backend": if device_connected { "rtl-sdr" } else { "mock_apt" },
      "device": if device_connected { "rtl-sdr" } else { "mock_apt" },
      "device_profile": device_profile,
  });
  let _ = broadcast_tx.send(msg.to_string());
}

fn build_device_profile(is_mock: bool) -> DeviceProfile {
  if is_mock {
    DeviceProfile {
      kind: "mock_apt".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      supports_raw_iq_stream: true,
    }
  } else {
    DeviceProfile {
      kind: "rtl-sdr".to_string(),
      is_rtl_sdr: true,
      supports_approx_dbm: true,
      supports_raw_iq_stream: true,
    }
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
        Self::new()
    }
}

impl WebSocketServer {
  pub fn new() -> Self {
    info!("Creating WebSocket server with SDR processor");

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

    let shared = SharedState::new();
    // Sync initial state with SharedState
    shared.update_device_status(
      !sdr_processor.is_mock(),
      sdr_processor.get_device_info(),
      build_device_profile(sdr_processor.is_mock()),
    );

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

    // Spawn SDR processing thread
    tokio::spawn(async move {
      let mut frame_count = 0u64;
      let mut last_stats = Instant::now();
      let mut last_poll = Instant::now();
      let mut last_hardware_swap: Option<Instant> = None;
      let mut last_failure_at: Option<Instant> = None;
      loop {
        let start_time = Instant::now();
        let target_fps = { sdr_processor.lock().await.display_frame_rate };
        // 1. Process pending commands
        while let Ok(cmd) = cmd_rx.try_recv() {
          let mut processor = sdr_processor.lock().await;
          match cmd {
            crate::server::types::SdrCommand::ApplySettings(settings) => {
              if let Err(e) = processor.apply_settings(settings) {
                error!("Failed to apply settings: {}", e);
              }
            }
            crate::server::types::SdrCommand::SetFrequency(freq) => {
              // During active captures, the hopping logic in read_and_process_frame
              // exclusively controls the SDR frequency. UI frequency range changes
              // must NOT retune the hardware or they corrupt capture frames.
              if processor.capture_active {
                log::debug!("Ignoring SetFrequency during active capture");
              } else {
                processor.pending_freq = Some(freq);
              }
            }
            crate::server::types::SdrCommand::SetGain(gain) => {
              if let Err(e) = processor.apply_settings(crate::server::types::SdrProcessorSettings {
                gain: Some(gain),
                ..Default::default()
              }) {
                error!("Failed to set gain: {}", e);
              }
            }
            crate::server::types::SdrCommand::SetPpm(ppm) => {
              if let Err(e) = processor.apply_settings(crate::server::types::SdrProcessorSettings {
                ppm: Some(ppm),
                ..Default::default()
              }) {
                error!("Failed to set PPM: {}", e);
              }
            }
            crate::server::types::SdrCommand::SetTunerAGC(enabled) => {
              if let Err(e) = processor.apply_settings(crate::server::types::SdrProcessorSettings {
                tuner_agc: Some(enabled),
                ..Default::default()
              }) {
                error!("Failed to set tuner AGC: {}", e);
              }
            }
            crate::server::types::SdrCommand::SetRtlAGC(enabled) => {
              if let Err(e) = processor.apply_settings(crate::server::types::SdrProcessorSettings {
                rtl_agc: Some(enabled),
                ..Default::default()
              }) {
                error!("Failed to set RTL AGC: {}", e);
              }
            }
            crate::server::types::SdrCommand::RestartDevice => {
              info!("Processing RestartDevice command");
              // Immediately tell the frontend we're restarting
              shared_state.set_device_state("loading", Some("restart"));
              broadcast_device_status(&shared_state, &_broadcast_tx);

              let new_device_res =
                crate::sdr::SdrDeviceFactory::create_device();
              match new_device_res {
                Ok(new_device) => {
                  if let Err(e) = processor.swap_device(new_device) {
                    error!("Failed to swap SDR processor device: {}", e);
                    // Revert to previous state so frontend doesn't hang
                    shared_state.update_device_status(
                      !processor.is_mock(),
                      processor.get_device_info(),
                      build_device_profile(processor.is_mock()),
                    );
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                  } else {
                    shared_state.update_device_status(
                      !processor.is_mock(),
                      processor.get_device_info(),
                      build_device_profile(processor.is_mock()),
                    );
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                  }
                }
                Err(e) => {
                  error!("Failed to create new device on restart: {}", e);
                  // Try re-init of existing device
                  if let Err(e) = processor.initialize() {
                    error!("Failed to restart existing device: {}", e);
                  }
                  // Revert state regardless
                  shared_state.update_device_status(
                    !processor.is_mock(),
                    processor.get_device_info(),
                    build_device_profile(processor.is_mock()),
                  );
                  broadcast_device_status(&shared_state, &_broadcast_tx);
                }
              }
            }
            crate::server::types::SdrCommand::StartCapture {
              job_id,
              fragments,
              duration_s,
              file_type,
              acquisition_mode,
              encrypted,
              fft_size,
              fft_window,
              geolocation,
              ref_based_demod_baseline,
              is_ephemeral,
            } => {
              // fft_size is used by the SDR processor for FFT configuration
              info!("[CAPTURE] FFT size: {}", fft_size);
              // Save current center frequency so we can restore it after capture
              processor.capture_pre_center_freq =
                Some(processor.get_center_frequency());
              processor.capture_job_id = Some(job_id.clone());
              processor.capture_duration_s = duration_s;
              processor.capture_file_type = file_type;
              processor.capture_ref_based_demod_baseline = ref_based_demod_baseline;
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
              // Snapshot current settings
              processor.capture_fft_window = fft_window;
              processor.capture_gain = processor.current_gain_db;
              processor.capture_ppm = processor.current_ppm;
              processor.capture_geolocation = geolocation;
              // AGC state is not tracked in config, default false for now
              processor.capture_tuner_agc = false;
              processor.capture_rtl_agc = false;

              let hw_sample_rate = processor.get_sample_rate() as f64;
              let hw_bw_mhz = hw_sample_rate / 1_000_000.0;
              
              // Use only the center portion of the hardware bandwidth to avoid 
              // the noisy/distorted edges of the RTL-SDR.
              const USABLE_BW_FRACTION: f64 = 0.75;
              let usable_bw_mhz = hw_bw_mhz * USABLE_BW_FRACTION;

              let mut all_hops: Vec<(f64, f64)> = Vec::new();
              let mut capture_channels: Vec<crate::sdr::processor::CaptureChannel> =
                Vec::new();
              // Track the overall requested range for metadata
              let mut overall_min = f64::INFINITY;
              let mut overall_max = f64::NEG_INFINITY;

              for &(min_freq, max_freq) in &fragments {
                overall_min = overall_min.min(min_freq);
                overall_max = overall_max.max(max_freq);

                let span = max_freq - min_freq;
                if mode_str == "whole_sample" || span <= usable_bw_mhz {
                  // Small span or whole_sample mode: center the window on the requested range
                  // But ensure we use the full HW bandwidth for the device tuning.
                  let center = (min_freq + max_freq) / 2.0;
                  let hop_start = center - hw_bw_mhz / 2.0;
                  all_hops.push((hop_start, hop_start + hw_bw_mhz));
                  capture_channels.push(crate::sdr::processor::CaptureChannel {
                    center_freq_hz: (hop_start * 1_000_000.0) + (hw_sample_rate / 2.0),
                    sample_rate_hz: hw_sample_rate,
                    requested_min_freq_hz: Some(min_freq * 1_000_000.0),
                    requested_max_freq_hz: Some(max_freq * 1_000_000.0),
                    iq_data: Vec::new(),
                    spectrum_data: Vec::new(),
                    bins_per_frame: 0,
                  });
                } else {
                  // Sliding window with overlap: first hop starts at its "usable" min,
                  // last hop ends at its "usable" max.
                  
                  // Number of hops is based on USABLE bandwidth increments
                  let num_hops = (span / usable_bw_mhz).ceil() as usize;
                  if num_hops <= 1 {
                    let center = (min_freq + max_freq) / 2.0;
                    let hop_start = center - hw_bw_mhz / 2.0;
                    all_hops.push((hop_start, hop_start + hw_bw_mhz));
                    capture_channels.push(crate::sdr::processor::CaptureChannel {
                      center_freq_hz: (hop_start * 1_000_000.0) + (hw_sample_rate / 2.0),
                      sample_rate_hz: hw_sample_rate,
                      requested_min_freq_hz: Some(min_freq * 1_000_000.0),
                      requested_max_freq_hz: Some(max_freq * 1_000_000.0),
                      iq_data: Vec::new(),
                      spectrum_data: Vec::new(),
                      bins_per_frame: 0,
                    });
                  } else {
                    // Distribute hops so that the "usable" centers cover the range.
                    // The first hop's usable range starts at min_freq.
                    // The last hop's usable range ends at max_freq.
                    // Usable start = center - usable_bw/2
                    // 1st hop: usable_start = min_freq => center = min_freq + usable_bw/2
                    // Last hop: usable_end = max_freq => center = max_freq - usable_bw/2
                    
                    let first_center = min_freq + (usable_bw_mhz / 2.0);
                    let last_center = max_freq - (usable_bw_mhz / 2.0);
                    let step = (last_center - first_center) / ((num_hops - 1) as f64);
                    
                    for i in 0..num_hops {
                      let center = first_center + (i as f64 * step);
                      let start = center - (hw_bw_mhz / 2.0);
                      let end = start + hw_bw_mhz;
                      all_hops.push((start, end));
                      capture_channels.push(crate::sdr::processor::CaptureChannel {
                        center_freq_hz: (start * 1_000_000.0) + (hw_sample_rate / 2.0),
                        sample_rate_hz: hw_sample_rate,
                        requested_min_freq_hz: Some(min_freq * 1_000_000.0),
                        requested_max_freq_hz: Some(max_freq * 1_000_000.0),
                        iq_data: Vec::new(),
                        spectrum_data: Vec::new(),
                        bins_per_frame: 0,
                      });
                    }
                  }
                }
              }

              // Compute overall metadata from the REQUESTED range (not hops)
              let overall_span_hz = (overall_max - overall_min) * 1_000_000.0;
              let overall_center_hz =
                ((overall_min + overall_max) / 2.0) * 1_000_000.0;

              processor.capture_fragments = all_hops.clone();
              processor.capture_channels = capture_channels;

              processor.capture_active = true;
              processor.capture_overall_center_hz = overall_center_hz;
              processor.capture_overall_span_hz = overall_span_hz;
              processor.capture_requested_range = Some((overall_min, overall_max));

              // Tune to the first hop if available
              if let Some(&(min_freq, max_freq)) = all_hops.first() {
                let center_freq =
                  ((min_freq * 1000000.0) + (hw_sample_rate / 2.0)) as u32;
                if let Err(e) = processor.set_center_frequency(center_freq) {
                  error!("Failed to tune to first fragment: {}", e);
                } else {
                  info!("Tuned to initial capture fragment: {} MHz - {} MHz (center {} Hz, bandwidth {} MHz)", min_freq, max_freq, center_freq, hw_bw_mhz);
                }
              }

              // Auto-unpause for capture
              shared_state.is_paused.store(false, Ordering::Relaxed);

              info!(
                "Started capture job {} for {}s (auto-unpaused)",
                job_id, duration_s
              );

              let msg = serde_json::json!({
                  "type": "capture_status",
                  "status": {
                      "jobId": job_id,
                      "status": "started"
                  }
              });
              let _ = _broadcast_tx.send(msg.to_string());
            }
            crate::server::types::SdrCommand::SetPowerScale { scale } => {
              info!("Setting power scale to: {:?}", scale);
              processor.set_power_scale(scale);
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
        if last_poll.elapsed() >= super::shared_state::HEALTH_CHECK_INTERVAL {
          last_poll = Instant::now();
          let mut processor = sdr_processor.lock().await;

          if processor.is_mock() {
            // ── Mock mode: scan for real hardware to hot-plug ──
            if !processor.capture_active {
              let count =
                crate::sdr::rtlsdr::device::RtlSdrDevice::get_device_count();
              
              // Only attempt re-scan if we haven't failed recently.
              // Prevents rhythmic loop if device is electrically unstable.
              let scan_cooldown = last_failure_at
                .map(|t| t.elapsed() < std::time::Duration::from_secs(5))
                .unwrap_or(false);

              if count > 0 && !scan_cooldown {
                info!("Auto-detected {} RTL-SDR device(s). Attempting hot-swap...", count);

                // Immediately tell the frontend we are loading
                shared_state.set_device_state("loading", Some("connect"));
                broadcast_device_status(&shared_state, &_broadcast_tx);

                match crate::sdr::SdrDeviceFactory::create_device() {
                  Ok(new_device) => {
                    if !new_device.device_type().contains("Mock") {
                      if let Err(e) = processor.swap_device(new_device) {
                        error!("Failed to auto-swap to detected RTL-SDR: {}", e);
                        // Revert to disconnected so frontend doesn't hang on "loading"
                        shared_state.set_device_state("disconnected", None);
                        broadcast_device_status(&shared_state, &_broadcast_tx);
                      } else {
                        shared_state.update_device_status(
                          true,
                          processor.get_device_info(),
                          build_device_profile(processor.is_mock()),
                        );
                        broadcast_device_status(&shared_state, &_broadcast_tx);
                        last_hardware_swap = Some(Instant::now());
                        info!("Successfully hot-swapped to RTL-SDR");
                      }
                    } else {
                      // Factory returned mock despite count > 0 — revert
                      shared_state.set_device_state("disconnected", None);
                      broadcast_device_status(&shared_state, &_broadcast_tx);
                    }
                  }
                  Err(e) => {
                    debug!("Auto-detection found device count > 0 but failed to open: {}", e);
                    shared_state.set_device_state("disconnected", None);
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                  }
                }
              }
            }
          } else {
            // ── Real hardware mode: debounced health monitoring ──
            
            // Be patient during the first 2 seconds of a new connection.
            // Power-hungry devices like the Blog V4 may take time to settle their 
            // internal regulators and I2C bridge after the initial 'open'.
            let is_warming_up = last_hardware_swap
              .map(|t| t.elapsed() < std::time::Duration::from_secs(5))
              .unwrap_or(false);

            if !processor.is_healthy() && !is_warming_up {
              let streak = shared_state.record_health_failure();
              let recovery_count = shared_state.recovery_attempts.load(Ordering::Relaxed);

              warn!(
                "RTL-SDR health check failed (streak {}/{}, recovery attempts {}/{})",
                streak,
                super::shared_state::DISCONNECT_FAILURE_THRESHOLD,
                recovery_count,
                super::shared_state::MAX_RECOVERY_ATTEMPTS,
              );

              if streak < super::shared_state::DISCONNECT_FAILURE_THRESHOLD {
                let usb_count = crate::sdr::rtlsdr::device::RtlSdrDevice::get_device_count();
                if usb_count == 0 {
                  warn!("RTL-SDR disappeared during recovery window. Falling back to mock immediately.");
                  shared_state.set_device_state("disconnected", None);
                  broadcast_device_status(&shared_state, &_broadcast_tx);

                  let mock_device = crate::sdr::SdrDeviceFactory::create_mock_device();
                  if let Err(e) = processor.swap_device(mock_device) {
                    error!("Failed to fall back to mock device after early unplug: {}", e);
                  } else {
                    shared_state.update_device_status(
                      false,
                      processor.get_device_info(),
                      build_device_profile(processor.is_mock()),
                    );
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                  }
                } else {
                  // ── Recovery attempt: re-init the existing device ──
                  if recovery_count < super::shared_state::MAX_RECOVERY_ATTEMPTS {
                    shared_state.recovery_attempts.fetch_add(1, Ordering::Relaxed);
                    shared_state.set_device_state("loading", Some("restart"));
                    broadcast_device_status(&shared_state, &_broadcast_tx);

                    info!("Attempting device recovery (attempt {})...", recovery_count + 1);
                    if let Err(reset_err) = processor.reset_buffer() {
                      warn!("Buffer reset during recovery failed: {}", reset_err);
                    }
                    if let Err(reinit_err) = processor.initialize() {
                      warn!("Re-init during recovery failed: {}", reinit_err);
                    } else {
                      // Re-init returned Ok, but we do NOT declare "connected" yet.
                      // The next health-check pass (if is_healthy()==true) will
                      // confirm recovery and broadcast "connected".
                      info!("Device re-init succeeded, awaiting health confirmation...");
                    }
                  }
                  // else: let the streak keep climbing until threshold
                }
              } else {
                // ── Threshold reached: confirm via USB device count ──
                let usb_count = crate::sdr::rtlsdr::device::RtlSdrDevice::get_device_count();

                if usb_count == 0 {
                  warn!("RTL-SDR confirmed unplugged (device_count=0). Falling back to mock.");
                  shared_state.set_device_state("disconnected", None);
                  broadcast_device_status(&shared_state, &_broadcast_tx);

                  let mock_device = crate::sdr::SdrDeviceFactory::create_mock_device();
                  if let Err(e) = processor.swap_device(mock_device) {
                    error!("Failed to fall back to mock device: {}", e);
                  } else {
                    shared_state.update_device_status(
                      false,
                      processor.get_device_info(),
                      build_device_profile(processor.is_mock()),
                    );
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                    last_failure_at = Some(Instant::now());
                    info!("Fell back to mock mode after confirmed unplug");
                  }
                } else {
                  // Device still on USB but stuck — try a full restart
                  warn!("RTL-SDR still on USB (count={}) but unhealthy. Attempting full restart...", usb_count);
                  shared_state.set_device_state("loading", Some("restart"));
                  broadcast_device_status(&shared_state, &_broadcast_tx);

                  match crate::sdr::SdrDeviceFactory::create_device() {
                    Ok(new_device) if !new_device.device_type().contains("Mock") => {
                      if let Err(e) = processor.swap_device(new_device) {
                        error!("Full restart swap failed: {}", e);
                        // Fall back to mock as last resort
                        let mock_device = crate::sdr::SdrDeviceFactory::create_mock_device();
                        if let Err(me) = processor.swap_device(mock_device) {
                          error!("Emergency mock fallback also failed: {}", me);
                        }
                        shared_state.update_device_status(
                          false,
                          processor.get_device_info(),
                          build_device_profile(processor.is_mock()),
                        );
                        broadcast_device_status(&shared_state, &_broadcast_tx);
                      } else {
                        shared_state.update_device_status(
                          true,
                          processor.get_device_info(),
                          build_device_profile(processor.is_mock()),
                        );
                        broadcast_device_status(&shared_state, &_broadcast_tx);
                        info!("Full device restart succeeded");
                      }
                    }
                    _ => {
                      // Couldn't re-open — fall back to mock
                      let mock_device = crate::sdr::SdrDeviceFactory::create_mock_device();
                      if let Err(me) = processor.swap_device(mock_device) {
                        error!("Mock fallback after restart failure: {}", me);
                      }
                      shared_state.update_device_status(
                        false,
                        processor.get_device_info(),
                        build_device_profile(processor.is_mock()),
                      );
                      broadcast_device_status(&shared_state, &_broadcast_tx);
                    }
                  }
                }
              }
            } else {
              // Healthy — reset the streak
              let prev = shared_state.health_failure_streak.load(Ordering::Relaxed);
              if prev > 0 {
                info!("RTL-SDR health restored after {} failure(s)", prev);
                shared_state.health_failure_streak.store(0, Ordering::Relaxed);
                shared_state.recovery_attempts.store(0, Ordering::Relaxed);
                // Ensure frontend knows we're solidly connected
                shared_state.set_device_state("connected", None);
                broadcast_device_status(&shared_state, &_broadcast_tx);
              }
            }
          }
        }

        // If the stream is paused by the client, don't read from SDR or broadcast
        if shared_state.is_paused.load(Ordering::Relaxed) {
          tokio::time::sleep(Duration::from_millis(100)).await;
          continue;
        }

        // 2. Read and process one frame from SDR
        let process_result = {
          let cloned_processor = sdr_processor.clone();
          tokio::task::spawn_blocking(
            move || -> Result<(Vec<f32>, i64, u32, bool, String)> {
              let mut processor = cloned_processor.blocking_lock();
              let waveform = processor.read_and_process_frame()?;
              let timestamp = chrono::Utc::now().timestamp_millis();
              let center_frequency = processor.get_center_frequency();
              let is_mock_apt = processor.device_type().contains("Mock");
              let device_type = processor.device_type().to_string();
              Ok((
                waveform,
                timestamp,
                center_frequency,
                is_mock_apt,
                device_type,
              ))
            },
          )
          .await
        };

        match process_result {
          Ok(Ok((
            waveform,
            timestamp,
            center_frequency,
            is_mock_apt,
            device_type_str,
          ))) => {
            // Successful read — clear any failure streak and confirm
            // recovery if we were in "loading" state from a recovery attempt.
            if !is_mock_apt {
              shared_state.record_successful_read();
              let current_state = shared_state.device_state.lock().unwrap().clone();
              if current_state != "connected" {
                info!("First successful frame after recovery — confirming connected state");
                shared_state.update_device_status(
                  true,
                  device_type_str.clone(),
                  build_device_profile(false),
                );
                broadcast_device_status(&shared_state, &_broadcast_tx);
              }
            }

            // Get current power scale and sample rate
            let power_scale = sdr_processor.lock().await.get_power_scale();
            let sample_rate = sdr_processor.lock().await.get_sample_rate();

            let spectrum_message = if matches!(power_scale, PowerScale::DBm) {
              // dBm mode: send raw I/Q data (works with both RTL-SDR and Mock APT)
              let raw_iq = sdr_processor.lock().await.last_frame_raw_iq.clone();
              
              // Only log on empty data (potential issue), not on every frame
              if raw_iq.is_empty() {
                warn!("Raw I/Q data is empty in dBm mode - this may cause data stream freeze");
              }
              
              SpectrumData {
                message_type: "spectrum".to_string(),
                waveform: waveform.clone(),
                is_mock_apt,
                center_frequency_hz: Some(center_frequency),
                waveform_span_mhz: None,
                timestamp,
                data_type: Some("iq_raw".to_string()),
                sample_rate: Some(sample_rate),
                power_scale: Some(PowerScale::DBm),
                iq_data: raw_iq,
              }
            } else {
              // Normal mode: send processed spectrum data
              SpectrumData {
                message_type: "spectrum".to_string(),
                waveform,
                is_mock_apt,
                center_frequency_hz: Some(center_frequency),
                waveform_span_mhz: None,
                timestamp,
                data_type: Some("spectrum_db".to_string()),
                sample_rate: Some(sample_rate),
                power_scale: Some(power_scale),
                iq_data: vec![], // Empty for spectrum data
              }
            };

            // Broadcast to all connected WebSocket clients
            if let Err(_e) = spectrum_tx.send(Arc::new(spectrum_message)) {
              // No receivers, which is normal when no clients are connected
            }

            frame_count += 1;

            // Log stats every 10 seconds
            if last_stats.elapsed() >= Duration::from_secs(10) {
              info!(
                "SDR streaming: {} frames sent, device: {}",
                frame_count, device_type_str
              );
              last_stats = Instant::now();
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
              let recovery_count = shared_state.recovery_attempts.load(Ordering::Relaxed);

              error!(
                "SDR read error (streak {}/{}, recovery {}/{}): {}",
                streak,
                super::shared_state::DISCONNECT_FAILURE_THRESHOLD,
                recovery_count,
                super::shared_state::MAX_RECOVERY_ATTEMPTS,
                e,
              );

              if streak < super::shared_state::DISCONNECT_FAILURE_THRESHOLD {
                let usb_count = crate::sdr::rtlsdr::device::RtlSdrDevice::get_device_count();
                if usb_count == 0 {
                  warn!("RTL-SDR unplugged after read error. Falling back to mock immediately.");
                  shared_state.set_device_state("disconnected", None);
                  broadcast_device_status(&shared_state, &_broadcast_tx);

                  let mock_device = crate::sdr::SdrDeviceFactory::create_mock_device();
                  if let Err(swap_e) = processor.swap_device(mock_device) {
                    error!("Failed to swap to mock after early unplug: {}", swap_e);
                  } else {
                    shared_state.update_device_status(
                      false,
                      processor.get_device_info(),
                      build_device_profile(processor.is_mock()),
                    );
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                  }
                } else {
                // Under threshold — try recovery if we haven't exhausted attempts
                if recovery_count < super::shared_state::MAX_RECOVERY_ATTEMPTS {
                  shared_state.recovery_attempts.fetch_add(1, Ordering::Relaxed);
                  shared_state.set_device_state("loading", Some("restart"));
                  broadcast_device_status(&shared_state, &_broadcast_tx);

                  warn!("Attempting recovery after read error (attempt {})...", recovery_count + 1);
                  if let Err(reset_err) = processor.reset_buffer() {
                    warn!("Buffer reset during read-error recovery failed: {}", reset_err);
                  }
                  if let Err(reinit_err) = processor.initialize() {
                    warn!("Re-init during read-error recovery failed: {}", reinit_err);
                  } else {
                    // Don't declare "connected" yet — the next health-check
                    // or successful frame read will confirm recovery.
                    info!("Read-error re-init succeeded, awaiting health confirmation...");
                  }
                }
                }
                // Brief settle regardless
                tokio::time::sleep(Duration::from_millis(100)).await;
              } else {
                // Threshold reached — immediate fallback
                let usb_count = crate::sdr::rtlsdr::device::RtlSdrDevice::get_device_count();
                warn!(
                  "Read-error threshold reached (streak={}). USB device_count={}. Falling back to mock.",
                  streak, usb_count,
                );
                shared_state.set_device_state("disconnected", None);
                broadcast_device_status(&shared_state, &_broadcast_tx);

                  let mock_device = crate::sdr::SdrDeviceFactory::create_mock_device();
                  if let Err(swap_e) = processor.swap_device(mock_device) {
                    error!("Failed to swap to mock on read error: {}", swap_e);
                  } else {
                    shared_state.update_device_status(
                      false,
                      processor.get_device_info(),
                      build_device_profile(processor.is_mock()),
                    );
                    broadcast_device_status(&shared_state, &_broadcast_tx);
                  }
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

          tokio::task::spawn_blocking(move || {
            if result.is_ephemeral {
                info!("Ephemeral capture job {} completed. Skipping persistence.", result.job_id);
                let msg = serde_json::json!({
                    "type": "capture_status",
                    "status": {
                        "jobId": result.job_id,
                        "status": "done",
                        "ephemeral": true
                    }
                });
                let _ = bcast.send(msg.to_string());
                return;
            }

            match crate::server::utils::save_capture_file_multi(
              &result, &enc_key,
            ) {
              Ok(artifact) => {
                let mut artifacts =
                  shared_clone.capture_artifacts.lock().unwrap();
                artifacts
                  .entry(result.job_id.clone())
                  .or_default()
                  .push(artifact.clone());

                let file_name = artifact.filename.clone();

                let msg = serde_json::json!({
                    "type": "capture_status",
                    "status": {
                        "jobId": result.job_id,
                        "status": "done",
                        "filename": file_name,
                        "downloadUrl": format!("/api/capture/download?jobId={}", result.job_id)
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
    });

    info!("SDR data streaming started successfully");
    Ok(())
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
