use std::sync::Arc;
use std::sync::atomic::Ordering;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use log::error;

use n_apt_backend::rtlsdr::RtlSdrDevice;

use super::types::CaptureDownloadParams;

/// GET /status — public status endpoint (no auth required).
pub async fn status_handler(
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  let device_connected = state.shared.device_connected.load(Ordering::Relaxed);
  let device_info = state.shared.device_info.lock().unwrap().clone();
  let client_count = state.shared.client_count.load(Ordering::Relaxed);
  let authenticated_count = state.shared.authenticated_count.load(Ordering::Relaxed);

  // This is a cheap, non-blocking check (does not open the device) and remains
  // responsive even if the SDR I/O thread is busy.
  let device_count = RtlSdrDevice::get_device_count();
  let device_present = device_count > 0;

  let device_state = state.shared.device_state.lock().unwrap().clone();
  let device_loading_reason = state.shared.device_loading_reason.lock().unwrap().clone();

  Json(serde_json::json!({
    "device_connected": device_connected,
    "device_present": device_present,
    "device_count": device_count,
    "device_state": device_state,
    "device_loading_reason": device_loading_reason,
    "device_info": device_info,
    "backend": if device_connected { "rtl-sdr" } else { "mock" },
    "clients": client_count,
    "authenticated_clients": authenticated_count,
  }))
}

/// GET /capture/download?token=<session_token>&jobId=<job_id>
/// Returns captured file(s). If multiple files, returns a ZIP archive.
pub async fn capture_download_handler(
  Query(params): Query<CaptureDownloadParams>,
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  // Validate session token
  if state.session_store.validate(&params.token).is_none() {
    return (StatusCode::UNAUTHORIZED, "Invalid or expired session token").into_response();
  }

  // Get capture artifacts for this job
  let artifacts = {
    let artifacts_map = state.shared.capture_artifacts.lock().unwrap();
    match artifacts_map.get(&params.job_id) {
      Some(artifacts) => artifacts.clone(),
      None => {
        return (StatusCode::NOT_FOUND, "Capture job not found or not completed").into_response();
      }
    }
  };

  if artifacts.is_empty() {
    return (StatusCode::NOT_FOUND, "No artifacts found for this capture job").into_response();
  }

  // If single file, return it directly
  if artifacts.len() == 1 {
    let artifact = &artifacts[0];
    match tokio::fs::read(&artifact.path).await {
      Ok(data) => {
        let content_type = if artifact.filename.ends_with(".napt") {
          "application/octet-stream"
        } else {
          "application/octet-stream"
        };
        
        return (
          StatusCode::OK,
          [
            ("Content-Type", content_type),
            ("Content-Disposition", &format!("attachment; filename=\"{}\"", artifact.filename)),
          ],
          data,
        ).into_response();
      }
      Err(e) => {
        error!("Failed to read capture file: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read capture file").into_response();
      }
    }
  }

  // Multiple files: create ZIP archive
  use std::io::Write;
  let mut zip_buffer = std::io::Cursor::new(Vec::new());
  {
    let mut zip = zip::ZipWriter::new(&mut zip_buffer);
    let options: zip::write::FileOptions<()> = zip::write::FileOptions::default()
      .compression_method(zip::CompressionMethod::Deflated)
      .unix_permissions(0o644);

    for artifact in &artifacts {
      match std::fs::read(&artifact.path) {
        Ok(data) => {
          if let Err(e) = zip.start_file(&artifact.filename, options) {
            error!("Failed to add file to ZIP: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create ZIP archive").into_response();
          }
          if let Err(e) = zip.write_all(&data) {
            error!("Failed to write file to ZIP: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create ZIP archive").into_response();
          }
        }
        Err(e) => {
          error!("Failed to read capture file for ZIP: {}", e);
          return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read capture file").into_response();
        }
      }
    }

    if let Err(e) = zip.finish() {
      error!("Failed to finalize ZIP: {}", e);
      return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create ZIP archive").into_response();
    }
  }

  let zip_data = zip_buffer.into_inner();
  let zip_filename = format!("capture_{}.zip", params.job_id);

  (
    StatusCode::OK,
    [
      ("Content-Type", "application/zip"),
      ("Content-Disposition", &format!("attachment; filename=\"{}\"", zip_filename)),
    ],
    zip_data,
  ).into_response()
}
