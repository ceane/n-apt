//! Capture lifecycle orchestration and persistence boundary.

use std::sync::Arc;

use log::{error, info, warn};
use tokio::sync::{broadcast, Mutex};

use crate::sdr::processor::{CaptureResult, SdrProcessor};
use crate::server::shared_state::SharedState;
use crate::server::websocket_server::active_source_id;

pub use crate::server::types::{
  CaptureArtifact, CaptureFragment, CaptureRequest,
};
/// Parameters for a capture-start command, kept separate from websocket transport.
pub struct CaptureStartRequest {
  pub job_id: String,
  pub fragments: Vec<(f64, f64)>,
  pub bandwidth: Option<u64>,
  pub bandwidth_center_frequency: Option<u64>,
  pub duration_mode: String,
  pub duration_s: f64,
  pub file_type: String,
  pub acquisition_mode: String,
  pub encrypted: bool,
  pub fft_size: usize,
  pub fft_window: String,
  pub geolocation: Option<crate::server::types::GeolocationData>,
  pub ref_based_demod_baseline: Option<String>,
  pub is_ephemeral: bool,
  pub channels: Option<Vec<crate::server::types::ChannelSpec>>,
}

/// Owns capture completion polling and delegates file persistence to a
/// blocking task. The websocket loop only needs to provide scheduling; it no
/// longer owns capture result serialization or writer lifecycle.
#[derive(Clone)]
pub struct CaptureWorker {
  processor: Arc<Mutex<SdrProcessor>>,
  shared_state: Arc<SharedState>,
  broadcast_tx: broadcast::Sender<String>,
}

impl CaptureWorker {
  /// Configure and start a capture, including hop planning and first-hop tune.
  pub async fn start(&self, request: CaptureStartRequest) {
    let CaptureStartRequest {
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
    } = request;
    let shared_state = self.shared_state.clone();
    let broadcast_tx = self.broadcast_tx.clone();
    let mut processor = self.processor.lock().await;

    // Device-scoped guard (single-Rx mode): the currently supported radios —
    // simplex and half-duplex devices with one Rx pipeline — can run exactly
    // one capture at a time. A second start used to silently clobber the
    // running job *and* its restore-frequency record, leaving the device
    // tuned to the dead job's first hop. Reject instead and tell the
    // requesting client why. Multi-receiver commercial rigs would key this
    // guard per receiver rather than remove it.
    if processor.capture_active {
      let active_job = processor
        .capture_job_id
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
      warn!(
        "[CAPTURE] Rejected StartCapture job {}: device already running capture {}",
        job_id, active_job
      );
      // The websocket layer registered ownership for this never-started job
      // before dispatching; drop that record so the slot does not claim the
      // active capture belongs to the rejected requester.
      shared_state.clear_capture_owner_if(&job_id);
      let rejected = serde_json::json!({
        "type": "capture_status",
        "status": {
          "jobId": job_id,
          "status": "error",
          "message": format!(
            "A capture ({active_job}) is already running on this device; stop it before starting another"
          ),
          "activeJobId": active_job,
        }
      });
      let _ = broadcast_tx.send(rejected.to_string());
      return;
    }

    // Bind the channels payload to the processor for Patch B trimming
    processor.capture_requested_channels = channels;
    // fft_size is used by the SDR processor for FFT configuration
    info!("[CAPTURE] FFT size: {}", fft_size);
    // Save current center frequency so we can restore it after capture
    processor.capture_pre_center_freq = Some(processor.get_center_frequency());
    processor.capture_bandwidth = bandwidth;
    processor.capture_bandwidth_center_frequency = bandwidth_center_frequency;
    processor.capture_job_id = Some(job_id.clone());
    processor.capture_is_manual_mode = duration_mode == "manual";
    processor.capture_manual_stop = false;
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
    info!(
      "[CAPTURE] acquisition_mode={}, fragments={}, hops will be computed next",
      mode_str,
      fragments.len()
    );

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
    processor.capture_fft_size = processor.fft_processor.config().fft_size;
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
    let mut capture_channels: Vec<crate::sdr::processor::CaptureChannel> =
      Vec::new();
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
          // Distribute hops so that the "usable" centers cover the range.
          // The first hop's usable range starts at min_freq.
          // The last hop's usable range ends at max_freq.
          // Usable start = center - usable_bw/2
          // 1st hop: usable_start = min_freq => center = min_freq + usable_bw/2
          // Last hop: usable_end = max_freq => center = max_freq - usable_bw/2

          let first_center = min_freq + (usable_bw_hz / 2.0);
          let last_center = max_freq - (usable_bw_hz / 2.0);
          let step = (last_center - first_center) / ((num_hops - 1) as f64);

          for i in 0..num_hops {
            let center = first_center + (i as f64 * step);
            let start = center - (hw_bw_hz / 2.0);
            let end = start + hw_bw_hz;
            all_hops.push((start, end));
            capture_channels.push(crate::sdr::processor::CaptureChannel {
              center_freq_hz: start + (hw_sample_rate / 2.0),
              sample_rate_hz: hw_sample_rate,
              requested_min_freq_hz: Some(min_freq),
              requested_max_freq_hz: Some(max_freq),
              iq_data: Vec::new(),
              spectrum_data: Vec::new(),
              bins_per_frame: 0,
              label: None,
            });
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
    processor.capture_requested_range = Some((overall_min, overall_max));

    // Tune to the first hop if available
    if let Some(&(min_freq, max_freq)) = all_hops.first() {
      let center_freq = (min_freq + (hw_sample_rate / 2.0)) as u32;
      if let Err(e) = processor.set_center_frequency(center_freq) {
        error!("Failed to tune to first fragment: {}", e);
      } else {
        info!("Tuned to initial capture fragment: {} Hz - {} Hz (center {} Hz, bandwidth {} Hz)", min_freq, max_freq, center_freq, hw_bw_hz);
      }
    }

    // Auto-unpause for capture on the current active source.
    let active_source_id = active_source_id(&shared_state);
    shared_state.set_active_source_pause_state(&active_source_id, false);

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
    let _ = broadcast_tx.send(msg.to_string());
  }

  pub fn new(
    processor: Arc<Mutex<SdrProcessor>>,
    shared_state: Arc<SharedState>,
    broadcast_tx: broadcast::Sender<String>,
  ) -> Self {
    Self {
      processor,
      shared_state,
      broadcast_tx,
    }
  }

  /// Poll for a completed capture and hand any result to the lossless writer
  /// path. This method intentionally does not await persistence: acquisition
  /// and display scheduling must remain independent from file I/O.
  pub async fn check_completion(&self) {
    let capture_result =
      { self.processor.lock().await.check_capture_completion() };
    let Some(result) = capture_result else {
      return;
    };

    // The job is done; drop its connection-ownership record so the map does
    // not hold stale entries.
    self.shared_state.clear_capture_owner_if(&result.job_id);

    let processing_msg = serde_json::json!({
      "type": "capture_status",
      "status": {
        "jobId": result.job_id,
        "status": "progress",
        "message": "Processing data..."
      }
    });
    let _ = self.broadcast_tx.send(processing_msg.to_string());

    spawn_capture_persistence(
      result,
      self.shared_state.clone(),
      self.broadcast_tx.clone(),
    );
  }

  /// Stop only the requested capture job, then hand its result to the same
  /// persistence path used by hardware-failure shutdowns.
  pub async fn stop(&self, requested_job_id: Option<&str>) {
    let mut processor = self.processor.lock().await;
    if let Some(requested_job_id) = requested_job_id {
      if processor.capture_job_id.as_deref() != Some(requested_job_id) {
        info!(
          "Ignoring StopCapture for stale job_id={}, current={:?}",
          requested_job_id, processor.capture_job_id
        );
        return;
      }
    }

    if let Some(result) = processor.stop_capture() {
      Self::handle_stopped(
        result,
        &self.shared_state,
        &self.broadcast_tx,
        None,
      );
    }
  }

  /// Preserve the existing stopped-capture behavior while keeping its file
  /// work outside the websocket orchestration loop.
  pub fn handle_stopped(
    result: CaptureResult,
    shared_state: &Arc<SharedState>,
    broadcast_tx: &broadcast::Sender<String>,
    reason: Option<&str>,
  ) {
    shared_state.clear_capture_owner_if(&result.job_id);
    let status_msg = reason.unwrap_or("Capture stopped").to_string();
    let processing_msg = serde_json::json!({
      "type": "capture_status",
      "status": {
        "jobId": result.job_id,
        "status": "progress",
        "message": "Processing stopped capture..."
      }
    });
    let _ = broadcast_tx.send(processing_msg.to_string());

    let enc_key = shared_state.encryption_key;
    let shared_clone = shared_state.clone();
    let bcast = broadcast_tx.clone();
    // Async end-to-end: only the blocking file write runs on the blocking
    // pool; the async Redis bookkeeping runs as a regular task afterwards.
    // The previous runtime.block_on(...) inside spawn_blocking pinned a pool
    // thread and panicked if the runtime was shutting down.
    let result = std::sync::Arc::new(result);
    let result_for_save = std::sync::Arc::clone(&result);
    tokio::spawn(async move {
      if result.is_ephemeral {
        let msg = serde_json::json!({
          "type": "capture_status",
          "status": {
            "jobId": result.job_id,
            "status": "done",
            "message": status_msg,
            "ephemeral": true,
            "duration": result.duration_s
          }
        });
        let _ = bcast.send(msg.to_string());
        return;
      }

      let saved = tokio::task::spawn_blocking(move || {
        crate::server::utils::save_capture_file_multi(&result_for_save, &enc_key)
      })
      .await;

      match saved {
        Ok(Ok(artifact)) => {
          store_artifact_and_broadcast(
            &result,
            artifact,
            shared_clone,
            bcast,
            &status_msg,
          )
          .await;
        }
        Ok(Err(e)) => {
          broadcast_capture_failure(&bcast, &result.job_id, &e.to_string());
        }
        Err(e) => {
          broadcast_capture_failure(
            &bcast,
            &result.job_id,
            &format!("capture persistence task failed: {e}"),
          );
        }
      }
    });
  }
}

fn spawn_capture_persistence(
  result: CaptureResult,
  shared_state: Arc<SharedState>,
  broadcast_tx: broadcast::Sender<String>,
) {
  let enc_key = shared_state.encryption_key;
  let result = std::sync::Arc::new(result);
  let result_for_save = std::sync::Arc::clone(&result);
  tokio::spawn(async move {
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
      let _ = broadcast_tx.send(msg.to_string());
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
    let _ = broadcast_tx.send(creating_msg.to_string());

    let saved = tokio::task::spawn_blocking(move || {
      crate::server::utils::save_capture_file_multi(&result_for_save, &enc_key)
    })
    .await;

    match saved {
      Ok(Ok(artifact)) => {
        store_artifact_and_broadcast(
          &result,
          artifact,
          shared_state,
          broadcast_tx,
          "Capture complete",
        )
        .await;
      }
      Ok(Err(e)) => {
        broadcast_capture_failure(&broadcast_tx, &result.job_id, &e.to_string());
      }
      Err(e) => {
        broadcast_capture_failure(
          &broadcast_tx,
          &result.job_id,
          &format!("capture persistence task failed: {e}"),
        );
      }
    }
  });
}

async fn store_artifact_and_broadcast(
  result: &CaptureResult,
  artifact: CaptureArtifact,
  shared_state: Arc<SharedState>,
  broadcast_tx: broadcast::Sender<String>,
  message: &str,
) {
  let key = format!("artifacts:{}", result.job_id);
  let mut artifacts = match shared_state
    .redis_store
    .get_json::<Vec<CaptureArtifact>>(1, &key)
    .await
  {
    Ok(Some(artifacts)) => artifacts,
    Ok(None) => Vec::new(),
    Err(error) => {
      error!("Failed to load capture artifacts from Redis: {error}");
      Vec::new()
    }
  };
  artifacts.push(artifact.clone());

  // Capture artifact metadata is refreshed per artifact; give the key a
  // generous TTL so abandoned jobs do not accumulate in Redis forever.
  const CAPTURE_ARTIFACT_TTL_SECS: u64 = 30 * 24 * 60 * 60;
  if let Err(error) = shared_state
    .redis_store
    .set_json_with_ttl(1, &key, &artifacts, Some(CAPTURE_ARTIFACT_TTL_SECS))
    .await
  {
    error!("Failed to store capture artifacts in Redis: {error}");
  }

  // Headless boards can boot with clocks before the epoch; never panic in
  // the persistence path over a timestamp.
  let timestamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|since_epoch| since_epoch.as_millis() as u64)
    .unwrap_or(0);
  let msg = serde_json::json!({
    "type": "capture_status",
    "status": {
      "jobId": result.job_id,
      "status": "done",
      "message": message,
      "filename": artifact.filename,
      "downloadUrl": format!("/api/capture/download?jobId={}", result.job_id),
      "timestamp": timestamp,
      "fileSize": artifact.file_size,
      "duration": result.duration_s,
      "checksum": artifact.checksum
    }
  });
  let _ = broadcast_tx.send(msg.to_string());
}

fn broadcast_capture_failure(
  broadcast_tx: &broadcast::Sender<String>,
  job_id: &str,
  error_message: &str,
) {
  error!("Failed to save capture file: {}", error_message);
  let msg = serde_json::json!({
    "type": "capture_status",
    "status": {
      "jobId": job_id,
      "status": "failed",
      "message": "Capture failed",
      "error": error_message
    }
  });
  let _ = broadcast_tx.send(msg.to_string());
}
