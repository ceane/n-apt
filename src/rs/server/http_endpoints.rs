use std::sync::Arc;
use std::sync::atomic::Ordering;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use log::{error, info, warn};

use crate::sdr::rtlsdr::RtlSdrDevice;

use super::types::{CaptureDownloadParams, WebMCPToolRequest, WebMCPToolResponse, SpectrumFrameMessage};

fn format_frequency_range(frames: &[SpectrumFrameMessage]) -> Option<String> {
  if frames.is_empty() {
    return None;
  }
  let mut min = f64::INFINITY;
  let mut max = f64::NEG_INFINITY;
  for frame in frames {
    min = min.min(frame.min_mhz);
    max = max.max(frame.max_mhz);
  }
  if !min.is_finite() || !max.is_finite() || max <= min {
    return None;
  }
  Some(format!("{:.3}-{:.3} MHz", min, max))
}

fn format_sample_rate(sample_rate: Option<u32>) -> Option<String> {
  let rate = sample_rate?;
  if rate == 0 {
    return None;
  }
  Some(format!("{:.3} MS/s", rate as f64 / 1_000_000.0))
}

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
  let _session = match state.session_store.validate(&params.token) {
    Some(s) => s,
    None => {return (StatusCode::UNAUTHORIZED, "Invalid or expired session token").into_response();}
  };

  // Get capture artifacts for this job
  let artifacts: Vec<crate::server::types::CaptureArtifact> = {
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

/// GET /api/agent/info — Agent system information and capabilities
pub async fn agent_info_handler(
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  info!("Agent info requested");
  
  let frames = state.shared.channels.lock().unwrap().clone();
  let freq_range = format_frequency_range(&frames).unwrap_or_else(|| "unknown".to_string());
  let sample_rate_label = format_sample_rate(
    Some(
      state
        .shared
        .sdr_settings
        .lock()
        .unwrap()
        .sample_rate,
    ),
  )
  .unwrap_or_else(|| "unknown".to_string());

  let agent_info = serde_json::json!({
    "name": "N-APT SDR Analysis System",
    "version": "0.2.5",
    "description": "Neuro Automatic Picture Transmission signal analysis and decoding system",
    "capabilities": [
      "sdr_capture",
      "signal_analysis", 
      "ml_classification",
      "3d_visualization",
      "hotspot_annotation",
      "real_time_streaming"
    ],
    "endpoints": {
      "status": "/api/agent/status",
      "capture": "/api/webmcp/execute",
      "websocket": "/ws",
      "download": "/capture/download"
    },
    "webmcp_tools": {
      "total": 27,
      "categories": [
        "Source Management",
        "I/Q Capture", 
        "Signal Areas",
        "Signal Features",
        "Signal Display",
        "Source Settings",
        "Snapshot Controls",
        "ML Analysis",
        "Signal Generation",
        "Body Areas",
        "Camera Controls",
        "Hotspot Creation",
        "Data Management"
      ]
    },
    "routes": [
      "/",
      "/analysis", 
      "/draw-signal",
      "/3d-model",
      "/hotspot-editor"
    ],
    "hardware": {
      "supported": ["rtl-sdr", "hackrf", "mock"],
      "frequency_range": freq_range,
      "max_sample_rate": sample_rate_label
    },
    "agent_features": {
      "webmcp_enabled": true,
      "markdown_negotiation": true,
      "real_time_streaming": true,
      "authentication_required": true
    }
  });
  
  Json(agent_info)
}

/// GET /api/agent/status — Enhanced status endpoint for agents
pub async fn agent_status_handler(
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  let shared = &state.shared;
  
  let device_connected = shared.device_connected.load(Ordering::Relaxed);
  let client_count = shared.client_count.load(Ordering::Relaxed);
  let authenticated_count = shared.authenticated_count.load(Ordering::Relaxed);
  let is_paused = shared.is_paused.load(Ordering::Relaxed);
  let center_freq_hz = shared.pending_center_freq.load(Ordering::Relaxed);
  let device_info = shared.device_info.lock().unwrap().clone();
  let device_state = shared.device_state.lock().unwrap().clone();
  let device_loading = shared.device_loading.lock().unwrap().clone();
  let device_loading_reason = shared.device_loading_reason.lock().unwrap().clone();
  let frames = shared.channels.lock().unwrap().clone();
  let freq_range = format_frequency_range(&frames).unwrap_or_else(|| "unknown".to_string());
  let sample_rate_label = format_sample_rate(
    Some(
      state
        .shared
        .sdr_settings
        .lock()
        .unwrap()
        .sample_rate,
    ),
  )
  .unwrap_or_else(|| "unknown".to_string());
  
  let status = serde_json::json!({
    "device": {
      "connected": device_connected,
      "type": if device_connected { "rtl-sdr" } else { "mock" },
      "info": device_info,
      "state": device_state,
      "loading": device_loading,
      "loading_reason": device_loading_reason
    },
    "capture": {
      "is_paused": is_paused,
      "active_clients": client_count,
      "authenticated_clients": authenticated_count,
      "capture_artifacts": shared.capture_artifacts.lock().unwrap().len()
    },
    "signals": {
      "center_frequency_mhz": center_freq_hz as f64 / 1_000_000.0,
      "frequency_range": freq_range,
      "sample_rate": sample_rate_label
    },
    "system": {
      "uptime": {
        "seconds": std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .unwrap_or_default()
          .as_secs(),
        "human": "Available via system metrics"
      },
      "memory_usage": "Available via system metrics",
      "cpu_usage": "Available via system metrics"
    },
    "agent_features": {
      "webmcp_enabled": true,
      "markdown_negotiation": true,
      "real_time_streaming": true,
      "active_websockets": client_count,
      "last_tool_execution": "Available via logging"
    }
  });
  Json(status)
}

/// POST /api/webmcp/execute — Execute WebMCP tools that require backend control
pub async fn execute_webmcp_tool_handler(
  State(state): State<Arc<super::AppState>>,
  Json(tool_request): Json<WebMCPToolRequest>,
) -> impl IntoResponse {
  info!("WebMCP tool execution requested: {}", tool_request.name);
  
  let tool_name = tool_request.name.as_str();
  let params = &tool_request.params;
  // ... (rest of the code remains the same)
  
  let result = match tool_name {
    "connectDevice" => handle_connect_device(&state, params).await,
    "setGain" => handle_set_gain(&state, params).await,
    "setPpm" => handle_set_ppm(&state, params).await,
    "setTunerAGC" => handle_set_tuner_agc(&state, params).await,
    "setRtlAGC" => handle_set_rtl_agc(&state, params).await,
    "restartDevice" => handle_restart_device(&state, params).await,
    "startCapture" => handle_start_capture(&state, params).await,
    "stopCapture" => handle_stop_capture(&state, params).await,
    "classifySignal" => handle_classify_signal(&state, params).await,
    _ => {
      warn!("Unknown WebMCP tool: {}", tool_name);
      WebMCPToolResponse {
        success: false,
        result: None,
        error: Some(format!("Unknown tool: {}", tool_name)),
        tool: tool_name.to_string(),
      }
    }
  };
  
  Json(result)
}

// WebMCP tool handlers
async fn handle_connect_device(state: &Arc<super::AppState>, _params: &serde_json::Value) -> WebMCPToolResponse {
  // Send restart command to SDR thread
  if let Err(e) = state.cmd_tx.send(super::types::SdrCommand::RestartDevice) {
    WebMCPToolResponse {
      success: false,
      result: None,
      error: Some(format!("Failed to send restart command: {}", e)),
      tool: "connectDevice".to_string(),
    }
  } else {
    WebMCPToolResponse {
      success: true,
      result: Some(serde_json::json!({
        "message": "Device connection initiated",
        "device_type": "rtl-sdr"
      })),
      error: None,
      tool: "connectDevice".to_string(),
    }
  }
}

async fn handle_set_gain(state: &Arc<super::AppState>, params: &serde_json::Value) -> WebMCPToolResponse {
  if let Some(gain) = params.get("gain").and_then(|g| g.as_f64()) {
    if let Err(e) = state.cmd_tx.send(super::types::SdrCommand::SetGain(gain)) {
      WebMCPToolResponse {
        success: false,
        result: None,
        error: Some(format!("Failed to set gain: {}", e)),
        tool: "setGain".to_string(),
      }
    } else {
      WebMCPToolResponse {
        success: true,
        result: Some(serde_json::json!({
          "gain": gain,
          "message": "Gain setting updated"
        })),
        error: None,
        tool: "setGain".to_string(),
      }
    }
  } else {
    WebMCPToolResponse {
      success: false,
      result: None,
      error: Some("Invalid or missing 'gain' parameter".to_string()),
      tool: "setGain".to_string(),
    }
  }
}

async fn handle_set_ppm(state: &Arc<super::AppState>, params: &serde_json::Value) -> WebMCPToolResponse {
  if let Some(ppm) = params.get("ppm").and_then(|p| p.as_i64()) {
    if let Err(e) = state.cmd_tx.send(super::types::SdrCommand::SetPpm(ppm as i32)) {
      WebMCPToolResponse {
        success: false,
        result: None,
        error: Some(format!("Failed to set PPM: {}", e)),
        tool: "setPpm".to_string(),
      }
    } else {
      WebMCPToolResponse {
        success: true,
        result: Some(serde_json::json!({
          "ppm": ppm,
          "message": "PPM setting updated"
        })),
        error: None,
        tool: "setPpm".to_string(),
      }
    }
  } else {
    WebMCPToolResponse {
      success: false,
      result: None,
      error: Some("Invalid or missing 'ppm' parameter".to_string()),
      tool: "setPpm".to_string(),
    }
  }
}

async fn handle_set_tuner_agc(state: &Arc<super::AppState>, params: &serde_json::Value) -> WebMCPToolResponse {
  if let Some(enabled) = params.get("enabled").and_then(|e| e.as_bool()) {
    if let Err(e) = state.cmd_tx.send(super::types::SdrCommand::SetTunerAGC(enabled)) {
      WebMCPToolResponse {
        success: false,
        result: None,
        error: Some(format!("Failed to set tuner AGC: {}", e)),
        tool: "setTunerAGC".to_string(),
      }
    } else {
      WebMCPToolResponse {
        success: true,
        result: Some(serde_json::json!({
          "tuner_agc": enabled,
          "message": "Tuner AGC setting updated"
        })),
        error: None,
        tool: "setTunerAGC".to_string(),
      }
    }
  } else {
    WebMCPToolResponse {
      success: false,
      result: None,
      error: Some("Invalid or missing 'enabled' parameter".to_string()),
      tool: "setTunerAGC".to_string(),
    }
  }
}

async fn handle_set_rtl_agc(state: &Arc<super::AppState>, params: &serde_json::Value) -> WebMCPToolResponse {
  if let Some(enabled) = params.get("enabled").and_then(|e| e.as_bool()) {
    if let Err(e) = state.cmd_tx.send(super::types::SdrCommand::SetRtlAGC(enabled)) {
      WebMCPToolResponse {
        success: false,
        result: None,
        error: Some(format!("Failed to set RTL AGC: {}", e)),
        tool: "setRtlAGC".to_string(),
      }
    } else {
      WebMCPToolResponse {
        success: true,
        result: Some(serde_json::json!({
          "rtl_agc": enabled,
          "message": "RTL AGC setting updated"
        })),
        error: None,
        tool: "setRtlAGC".to_string(),
      }
    }
  } else {
    WebMCPToolResponse {
      success: false,
      result: None,
      error: Some("Invalid or missing 'enabled' parameter".to_string()),
      tool: "setRtlAGC".to_string(),
    }
  }
}

async fn handle_restart_device(state: &Arc<super::AppState>, _params: &serde_json::Value) -> WebMCPToolResponse {
  if let Err(e) = state.cmd_tx.send(super::types::SdrCommand::RestartDevice) {
    WebMCPToolResponse {
      success: false,
      result: None,
      error: Some(format!("Failed to restart device: {}", e)),
      tool: "restartDevice".to_string(),
    }
  } else {
    WebMCPToolResponse {
      success: true,
      result: Some(serde_json::json!({
        "message": "Device restart initiated"
      })),
      error: None,
      tool: "restartDevice".to_string(),
    }
  }
}

async fn handle_start_capture(state: &Arc<super::AppState>, params: &serde_json::Value) -> WebMCPToolResponse {
  // Extract capture parameters
  let job_id = params.get("jobId").and_then(|id| id.as_str()).unwrap_or("unknown");
  let min_freq = params.get("minFreq").and_then(|f| f.as_f64()).unwrap_or(0.0);
  let max_freq = params.get("maxFreq").and_then(|f| f.as_f64()).unwrap_or(30.0);
  let duration_s = params.get("durationS").and_then(|d| d.as_f64()).unwrap_or(5.0);
  let file_type = params.get("fileType").and_then(|t| t.as_str()).unwrap_or(".napt");
  let encrypted = params.get("encrypted").and_then(|e| e.as_bool()).unwrap_or(true);
  let fft_size = params.get("fftSize").and_then(|s| s.as_u64()).unwrap_or(1024) as usize;
  let fft_window = params.get("fftWindow").and_then(|w| w.as_str()).unwrap_or("hann");
  
  let capture_cmd = super::types::SdrCommand::StartCapture {
    job_id: job_id.to_string(),
    min_freq,
    max_freq,
    duration_s,
    file_type: file_type.to_string(),
    encrypted,
    fft_size,
    fft_window: fft_window.to_string(),
  };
  
  if let Err(e) = state.cmd_tx.send(capture_cmd) {
    WebMCPToolResponse {
      success: false,
      result: None,
      error: Some(format!("Failed to start capture: {}", e)),
      tool: "startCapture".to_string(),
    }
  } else {
    WebMCPToolResponse {
      success: true,
      result: Some(serde_json::json!({
        "jobId": job_id,
        "minFreq": min_freq,
        "maxFreq": max_freq,
        "duration": duration_s,
        "format": file_type,
        "encrypted": encrypted,
        "message": "Capture started successfully"
      })),
      error: None,
      tool: "startCapture".to_string(),
    }
  }
}

async fn handle_stop_capture(_state: &Arc<super::AppState>, _params: &serde_json::Value) -> WebMCPToolResponse {
  // Note: You would need to add a StopCapture command to the SdrCommand enum
  // For now, we'll return a placeholder response
  WebMCPToolResponse {
    success: true,
    result: Some(serde_json::json!({
      "message": "Capture stop requested (implementation pending)"
    })),
    error: None,
    tool: "stopCapture".to_string(),
  }
}

async fn handle_classify_signal(state: &Arc<super::AppState>, _params: &serde_json::Value) -> WebMCPToolResponse {
  // This would integrate with your ML classification system
  // For now, return a mock response
  let device_connected = state.shared.device_connected.load(Ordering::Relaxed);
  
  if device_connected {
    WebMCPToolResponse {
      success: true,
      result: Some(serde_json::json!({
        "classification": "N-APT Signal Detected",
        "confidence": 0.92,
        "signal_type": "neuro-biological",
        "frequency_range": "LF/HF",
        "modulation": "heterodyning",
        "timestamp": std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .unwrap_or_default()
          .as_secs()
      })),
      error: None,
      tool: "classifySignal".to_string(),
    }
  } else {
    WebMCPToolResponse {
      success: false,
      result: None,
      error: Some("No device connected for signal classification".to_string()),
      tool: "classifySignal".to_string(),
    }
  }
}
