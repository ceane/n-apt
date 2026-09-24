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
  pub source_id: Option<String>,
  pub fragments: Vec<(f64, f64)>,
  pub bandwidth: Option<u64>,
  pub bandwidth_center_frequency: Option<u64>,
  pub duration_mode: String,
  pub duration_s: f64,
  pub file_type: String,
  pub acquisition_mode: String,
  pub encrypted: bool,
  pub sample_rate: Option<u32>,
  pub fft_size: usize,
  pub fft_window: String,
  pub frame_rate: Option<u32>,
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

fn canonical_fft_window(name: &str) -> Option<&'static str> {
  match name.to_lowercase().as_str() {
    "rectangular" | "none" => Some("rectangular"),
    "hanning" | "hann" => Some("hanning"),
    "hamming" => Some("hamming"),
    "blackman" => Some("blackman"),
    "nuttall" => Some("nuttall"),
    _ => None,
  }
}

fn reject_capture_start(
  shared_state: &SharedState,
  broadcast_tx: &broadcast::Sender<String>,
  job_id: &str,
  source_id: Option<&str>,
  code: &str,
  error_message: &str,
) {
  shared_state.clear_capture_owner_if(job_id);
  let mut status = serde_json::json!({
    "jobId": job_id,
    "status": "failed",
    "settingsApplied": false,
    "code": code,
    "message": "Capture preflight failed",
    "error": error_message
  });
  if let Some(source_id) = source_id {
    status["sourceId"] = serde_json::Value::String(source_id.to_string());
  }
  let message = serde_json::json!({
    "type": "capture_status",
    "status": status
  });
  let _ = broadcast_tx.send(message.to_string());
}

impl CaptureWorker {
  /// Configure and start a capture, including hop planning and first-hop tune.
  pub async fn start(&self, request: CaptureStartRequest) {
    let CaptureStartRequest {
      job_id,
      source_id,
      fragments,
      bandwidth,
      bandwidth_center_frequency,
      duration_mode,
      duration_s,
      file_type,
      acquisition_mode,
      encrypted,
      sample_rate,
      fft_size,
      fft_window,
      frame_rate,
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
      reject_capture_start(
        &shared_state,
        &broadcast_tx,
        &job_id,
        source_id.as_deref(),
        "capture_already_active",
        &format!(
          "A capture ({active_job}) is already running on this device; stop it before starting another"
        ),
      );
      return;
    }

    // Bind the channels payload to the processor for Patch B trimming
    let resolved_active_source_id = active_source_id(&shared_state);
    if let Some(expected_source_id) = source_id.as_deref() {
      if resolved_active_source_id != expected_source_id {
        reject_capture_start(
          &shared_state,
          &broadcast_tx,
          &job_id,
          source_id.as_deref(),
          "capture_source_changed",
          &format!(
            "Capture source {expected_source_id} is not active; active source is {resolved_active_source_id}"
          ),
        );
        return;
      }
    }

    let requested_sample_rate =
      sample_rate.unwrap_or_else(|| processor.get_sample_rate());
    let Some(requested_window) = canonical_fft_window(&fft_window) else {
      reject_capture_start(
        &shared_state,
        &broadcast_tx,
        &job_id,
        source_id.as_deref(),
        "capture_settings_invalid",
        &format!("Unsupported FFT window: {fft_window}"),
      );
      return;
    };
    if requested_sample_rate == 0
      || requested_sample_rate > 100_000_000
      || fft_size < 256
      || fft_size > 8_388_608
      || fft_size & (fft_size - 1) != 0
      || frame_rate.is_some_and(|value| !(1..=100).contains(&value))
    {
      reject_capture_start(
        &shared_state,
        &broadcast_tx,
        &job_id,
        source_id.as_deref(),
        "capture_settings_invalid",
        "Capture sample rate, FFT size, window, or frame rate is invalid",
      );
      return;
    }

    let capture_settings = crate::server::types::SdrProcessorSettings {
      sample_rate: Some(requested_sample_rate),
      fft_size: Some(fft_size),
      fft_window: Some(requested_window.to_string()),
      frame_rate,
      ..Default::default()
    };
    if let Err(error) = processor.apply_settings(capture_settings) {
      reject_capture_start(
        &shared_state,
        &broadcast_tx,
        &job_id,
        source_id.as_deref(),
        "capture_settings_apply_failed",
        &format!("Failed to apply capture preflight settings: {error}"),
      );
      return;
    }

    let effective_sample_rate = processor.get_sample_rate();
    let effective_fft_size = processor.fft_processor.config().fft_size;
    let effective_window_name =
      processor.fft_processor.config().window_type.to_string();
    let effective_window =
      canonical_fft_window(&effective_window_name).unwrap_or_default();
    let effective_frame_rate = processor.display_frame_rate;
    let mut mismatches = Vec::new();
    if effective_sample_rate != requested_sample_rate {
      mismatches.push(format!(
        "requested sample rate {requested_sample_rate}, effective {effective_sample_rate}"
      ));
    }
    if effective_fft_size != fft_size {
      mismatches.push(format!(
        "requested FFT size {fft_size}, effective {effective_fft_size}"
      ));
    }
    if effective_window != requested_window {
      mismatches.push(format!(
        "requested FFT window {requested_window}, effective {effective_window}"
      ));
    }
    if frame_rate.is_some_and(|value| value != effective_frame_rate) {
      mismatches.push(format!(
        "requested frame rate {}, effective {effective_frame_rate}",
        frame_rate.unwrap_or_default()
      ));
    }
    if !mismatches.is_empty() {
      reject_capture_start(
        &shared_state,
        &broadcast_tx,
        &job_id,
        source_id.as_deref(),
        "capture_settings_not_effective",
        &mismatches.join("; "),
      );
      return;
    }
    processor.flush_read_queue();
    processor.frame.avg_spectrum = None;
    let requested_frame_rate = frame_rate.unwrap_or(effective_frame_rate);
    let requested_settings = serde_json::json!({
      "sampleRateHz": requested_sample_rate,
      "fftSize": fft_size,
      "fftWindow": requested_window,
      "frameRateHz": requested_frame_rate
    });
    let effective_settings = serde_json::json!({
      "sampleRateHz": effective_sample_rate,
      "fftSize": effective_fft_size,
      "fftWindow": effective_window,
      "frameRateHz": effective_frame_rate
    });

    processor.capture_requested_channels = channels;
    processor.capture_last_frame_signature = None;
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
    processor.capture_encrypted = encrypted;
    processor.capture_actual_frames = 0;
    processor.capture_fft_size = effective_fft_size;
    processor.capture_fft_window = effective_window_name;
    processor.capture_gain = processor.current_gain_db;
    processor.capture_ppm = processor.current_ppm;
    processor.capture_geolocation = geolocation;
    processor.capture_tuner_agc = false;
    processor.capture_rtl_agc = false;

    let hw_sample_rate = effective_sample_rate as f64;
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
    processor.capture_overall_center_hz = overall_center_hz;
    processor.capture_overall_span_hz = overall_span_hz;
    processor.capture_requested_range = Some((overall_min, overall_max));

    // Tune to the first hop if available
    if let Some(&(min_freq, max_freq)) = all_hops.first() {
      let center_freq = (min_freq + (hw_sample_rate / 2.0)) as u32;
      if let Err(error) = processor.set_center_frequency(center_freq) {
        processor.capture_job_id = None;
        reject_capture_start(
          &shared_state,
          &broadcast_tx,
          &job_id,
          source_id.as_deref(),
          "capture_first_tune_failed",
          &format!("Failed to tune to first capture fragment: {error}"),
        );
        return;
      }
      info!("Tuned to initial capture fragment: {} Hz - {} Hz (center {} Hz, bandwidth {} Hz)", min_freq, max_freq, center_freq, hw_bw_hz);
    }

    // Auto-unpause for capture on the current active source.
    let active_source_id = active_source_id(&shared_state);
    shared_state.set_active_source_pause_state(&active_source_id, false);

    let mut status = serde_json::json!({
      "jobId": job_id,
      "status": "started",
      "settingsApplied": true,
      "message": "Capture settings applied; recording",
      "requestedSettings": requested_settings,
      "effectiveSettings": effective_settings
    });
    if let Some(source_id) = source_id.as_deref() {
      status["sourceId"] = serde_json::Value::String(source_id.to_string());
    }
    let message = serde_json::json!({
      "type": "capture_status",
      "status": status
    });
    if broadcast_tx.send(message.to_string()).is_err() {
      processor.capture_job_id = None;
      shared_state.clear_capture_owner_if(&job_id);
      return;
    }
    let capture_started_at = std::time::Instant::now();
    processor.capture_start = Some(capture_started_at);
    processor.capture_last_hop = Some(capture_started_at);
    processor.capture_active = true;

    info!(
      "Started capture job {} for {}s with acknowledged settings",
      job_id, duration_s
    );
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

#[cfg(test)]
mod tests {
  use super::*;
  use tokio::time::{timeout, Duration};

  fn test_request(fft_window: &str) -> CaptureStartRequest {
    CaptureStartRequest {
      job_id: "cli_test_capture".to_string(),
      source_id: Some("mock-apt".to_string()),
      fragments: vec![(135_000_000.0, 140_000_000.0)],
      bandwidth: None,
      bandwidth_center_frequency: None,
      duration_mode: "timed".to_string(),
      duration_s: 1.0,
      file_type: ".iq".to_string(),
      acquisition_mode: "whole_sample".to_string(),
      encrypted: false,
      sample_rate: Some(3_200_000),
      fft_size: 65_536,
      fft_window: fft_window.to_string(),
      frame_rate: Some(48),
      geolocation: None,
      ref_based_demod_baseline: None,
      is_ephemeral: false,
      channels: None,
    }
  }

  fn test_shared_state() -> Arc<SharedState> {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    SharedState::new("redis://127.0.0.1:6379")
  }

  async fn next_capture_status(
    receiver: &mut broadcast::Receiver<String>,
  ) -> serde_json::Value {
    let raw = timeout(Duration::from_secs(2), receiver.recv())
      .await
      .expect("capture status timeout")
      .expect("capture status broadcast");
    serde_json::from_str(&raw).expect("capture status JSON")
  }

  #[tokio::test]
  async fn started_status_acknowledges_effective_capture_settings() {
    let processor = Arc::new(Mutex::new(
      SdrProcessor::new_mock_apt().expect("mock processor"),
    ));
    let shared_state = test_shared_state();
    let (broadcast_tx, _) = broadcast::channel(8);
    let mut receiver = broadcast_tx.subscribe();
    let worker =
      CaptureWorker::new(processor.clone(), shared_state, broadcast_tx);

    worker.start(test_request("hanning")).await;
    let message = next_capture_status(&mut receiver).await;
    let status = &message["status"];

    assert_eq!(status["status"], "started");
    assert_eq!(status["settingsApplied"], true);
    assert!(
      status["effectiveSettings"]["sampleRateHz"]
        .as_u64()
        .unwrap()
        > 0
    );
    assert_eq!(status["effectiveSettings"]["fftSize"], 65_536);
    assert_eq!(status["effectiveSettings"]["frameRateHz"], 48);
  }

  #[tokio::test]
  async fn invalid_capture_settings_fail_before_activation() {
    let processor = Arc::new(Mutex::new(
      SdrProcessor::new_mock_apt().expect("mock processor"),
    ));
    let shared_state = test_shared_state();
    let (broadcast_tx, _) = broadcast::channel(8);
    let mut receiver = broadcast_tx.subscribe();
    let worker =
      CaptureWorker::new(processor.clone(), shared_state, broadcast_tx);

    worker.start(test_request("triangle")).await;
    let message = next_capture_status(&mut receiver).await;

    assert_eq!(message["status"]["status"], "failed");
    assert_eq!(message["status"]["code"], "capture_settings_invalid");
    assert!(!processor.lock().await.capture_active);
  }

  #[tokio::test]
  async fn source_mismatch_fails_before_settings_are_applied() {
    let processor = Arc::new(Mutex::new(
      SdrProcessor::new_mock_apt().expect("mock processor"),
    ));
    let shared_state = test_shared_state();
    let (broadcast_tx, _) = broadcast::channel(8);
    let mut receiver = broadcast_tx.subscribe();
    let worker =
      CaptureWorker::new(processor.clone(), shared_state, broadcast_tx);
    let mut request = test_request("hanning");
    request.source_id = Some("different-source".to_string());

    worker.start(request).await;
    let message = next_capture_status(&mut receiver).await;

    assert_eq!(message["status"]["status"], "failed");
    assert_eq!(message["status"]["code"], "capture_source_changed");
    assert!(!processor.lock().await.capture_active);
  }

  #[tokio::test]
  async fn silently_clamped_settings_fail_before_activation() {
    let processor = Arc::new(Mutex::new(
      SdrProcessor::new_mock_apt().expect("mock processor"),
    ));
    let shared_state = test_shared_state();
    let (broadcast_tx, _) = broadcast::channel(8);
    let mut receiver = broadcast_tx.subscribe();
    let worker =
      CaptureWorker::new(processor.clone(), shared_state, broadcast_tx);
    let mut request = test_request("hanning");
    request.sample_rate = Some(20_000_001);

    worker.start(request).await;
    let message = next_capture_status(&mut receiver).await;

    assert_eq!(message["status"]["status"], "failed");
    assert_eq!(message["status"]["code"], "capture_settings_not_effective");
    assert!(!processor.lock().await.capture_active);
  }
}
