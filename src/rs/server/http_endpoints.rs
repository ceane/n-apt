use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use log::{error, info, warn};
use redis::Client as RedisClient;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio_util::io::ReaderStream;

use crate::sdr::rtlsdr::RtlSdrDevice;

use super::types::{
  CaptureDownloadParams, SpectrumFrameMessage, WebMCPToolRequest,
  WebMCPToolResponse,
};

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

#[derive(Debug, Deserialize)]
pub struct TowerBoundsQuery {
  pub ne_lat: f64,
  pub ne_lng: f64,
  pub sw_lat: f64,
  pub sw_lng: f64,
  pub zoom: Option<u32>,
  pub tech: Option<String>,
  pub range: Option<String>,
  pub mcc: Option<String>,
  pub mnc: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TowerRecord {
  pub id: String,
  pub radio: String,
  pub mcc: String,
  pub mnc: String,
  pub lac: String,
  pub cell: String,
  pub range: String,
  pub lon: f64,
  pub lat: f64,
  pub samples: String,
  pub created: String,
  pub updated: String,
  pub state: Option<String>,
  pub region: Option<String>,
  pub tech: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TowerBoundsResponse {
  pub towers: Vec<TowerRecord>,
  pub count: usize,
  pub zoom: Option<u32>,
}

fn normalize_tech_key(token: &str) -> String {
  match token.trim().to_ascii_lowercase().as_str() {
    "5g" => "nr".to_string(),
    "4g" => "lte".to_string(),
    "3g" => "umts".to_string(),
    "2g" => "gsm".to_string(),
    other => other.to_string(),
  }
}

fn default_tower_indexes() -> Vec<String> {
  vec![
    "towers:state:AL".to_string(),
    "towers:state:AK".to_string(),
    "towers:state:AZ".to_string(),
    "towers:state:AR".to_string(),
    "towers:state:CA".to_string(),
    "towers:state:CO".to_string(),
    "towers:state:CT".to_string(),
    "towers:state:DE".to_string(),
    "towers:state:FL".to_string(),
    "towers:state:GA".to_string(),
    "towers:state:HI".to_string(),
    "towers:state:IA".to_string(),
    "towers:state:ID".to_string(),
    "towers:state:IL".to_string(),
    "towers:state:IN".to_string(),
    "towers:state:KS".to_string(),
    "towers:state:KY".to_string(),
    "towers:state:LA".to_string(),
    "towers:state:MA".to_string(),
    "towers:state:MD".to_string(),
    "towers:state:ME".to_string(),
    "towers:state:MI".to_string(),
    "towers:state:MN".to_string(),
    "towers:state:MO".to_string(),
    "towers:state:MS".to_string(),
    "towers:state:MT".to_string(),
    "towers:state:NC".to_string(),
    "towers:state:ND".to_string(),
    "towers:state:NE".to_string(),
    "towers:state:NH".to_string(),
    "towers:state:NJ".to_string(),
    "towers:state:NM".to_string(),
    "towers:state:NV".to_string(),
    "towers:state:NY".to_string(),
    "towers:state:OH".to_string(),
    "towers:state:OK".to_string(),
    "towers:state:OR".to_string(),
    "towers:state:PA".to_string(),
    "towers:state:RI".to_string(),
    "towers:state:SC".to_string(),
    "towers:state:SD".to_string(),
    "towers:state:TN".to_string(),
    "towers:state:TX".to_string(),
    "towers:state:UT".to_string(),
    "towers:state:VA".to_string(),
    "towers:state:VT".to_string(),
    "towers:state:WA".to_string(),
    "towers:state:WI".to_string(),
    "towers:state:WV".to_string(),
    "towers:state:WY".to_string(),
  ]
}

fn parse_filter_set(raw: &Option<String>) -> HashSet<String> {
  match raw {
    Some(value) => value
      .split(',')
      .map(|v| v.trim())
      .filter(|v| !v.is_empty())
      .map(std::string::ToString::to_string)
      .collect(),
    None => HashSet::new(),
  }
}
/// GET /api/towers/bounds?ne_lat=<>&ne_lng=<>&sw_lat=<>&sw_lng=<>&zoom=<>&tech=<csv>&range=<csv>&mcc=<>&mnc=<>
pub async fn towers_bounds_handler(
  Query(query): Query<TowerBoundsQuery>,
) -> impl IntoResponse {
  if query.ne_lat < query.sw_lat || query.ne_lng < query.sw_lng {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({"error": "Invalid bounds: northeast must be above/right of southwest"})),
    )
      .into_response();
  }

  let redis_url =
    env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".to_string());
  let client = match RedisClient::open(redis_url.clone()) {
    Ok(c) => c,
    Err(e) => {
      error!("Failed to initialize Redis client at {}: {}", redis_url, e);
      return (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Redis unavailable"})),
      )
        .into_response();
    }
  };

  let mut con = match client.get_connection() {
    Ok(conn) => conn,
    Err(e) => {
      error!("Failed to connect to Redis: {}", e);
      return (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Redis unavailable"})),
      )
        .into_response();
    }
  };

  let indexes: Vec<String> = match &query.tech {
    Some(tech_csv) if !tech_csv.trim().is_empty() => tech_csv
      .split(',')
      .map(normalize_tech_key)
      .map(|k| format!("towers:{}", k))
      .collect(),
    _ => default_tower_indexes(),
  };

  let range_filter = parse_filter_set(&query.range);
  let mut seen_ids: HashSet<String> = HashSet::new();
  let mut towers: Vec<TowerRecord> = Vec::new();

  let center_lat = (query.ne_lat + query.sw_lat) / 2.0;
  let center_lng = (query.ne_lng + query.sw_lng) / 2.0;
  let lat_km = (query.ne_lat - query.sw_lat).abs() * 111.32;
  let lon_km = (query.ne_lng - query.sw_lng).abs()
    * 111.32
    * center_lat.to_radians().cos().abs().max(0.01);
  let radius_km = ((lat_km.powi(2) + lon_km.powi(2)).sqrt() / 2.0).max(0.5);

  for index in indexes {
    let ids_result: redis::RedisResult<Vec<String>> = redis::cmd("GEORADIUS")
      .arg(&index)
      .arg(center_lng)
      .arg(center_lat)
      .arg(radius_km)
      .arg("km")
      .query(&mut con);

    let tower_ids = match ids_result {
      Ok(ids) => ids,
      Err(e) => {
        warn!("Redis GEORADIUS failed for {}: {}", index, e);
        continue;
      }
    };

    for tower_id in tower_ids {
      if !seen_ids.insert(tower_id.clone()) {
        continue;
      }

      let fields_result: redis::RedisResult<HashMap<String, String>> =
        redis::cmd("HGETALL").arg(&tower_id).query(&mut con);

      let fields = match fields_result {
        Ok(v) => v,
        Err(_) => continue,
      };

      // In-memory filtering logic
      if let Some(target_mcc) = &query.mcc {
        if fields.get("mcc").map(|s| s.as_str()) != Some(target_mcc.as_str()) {
          continue;
        }
      }
      if let Some(target_mnc) = &query.mnc {
        if fields.get("mnc").map(|s| s.as_str()) != Some(target_mnc.as_str()) {
          continue;
        }
      }

      let lat = match fields.get("lat").and_then(|v| v.parse::<f64>().ok()) {
        Some(v) => v,
        None => continue,
      };
      let lon = match fields
        .get("lon")
        .or_else(|| fields.get("lng"))
        .and_then(|v| v.parse::<f64>().ok())
      {
        Some(v) => v,
        None => continue,
      };

      if lat < query.sw_lat
        || lat > query.ne_lat
        || lon < query.sw_lng
        || lon > query.ne_lng
      {
        continue;
      }

      let range_value = fields
        .get("range")
        .cloned()
        .unwrap_or_else(|| "-1".to_string());
      if !range_filter.is_empty()
        && !range_filter.contains(range_value.as_str())
      {
        continue;
      }

      towers.push(TowerRecord {
        id: tower_id,
        radio: fields
          .get("radio")
          .cloned()
          .unwrap_or_else(|| "UNKNOWN".to_string()),
        mcc: fields.get("mcc").cloned().unwrap_or_default(),
        mnc: fields.get("mnc").cloned().unwrap_or_default(),
        lac: fields.get("lac").cloned().unwrap_or_default(),
        cell: fields
          .get("cell")
          .or_else(|| fields.get("cid"))
          .cloned()
          .unwrap_or_default(),
        range: range_value,
        lon,
        lat,
        samples: fields.get("samples").cloned().unwrap_or_default(),
        created: fields.get("created").cloned().unwrap_or_default(),
        updated: fields.get("updated").cloned().unwrap_or_default(),
        state: fields.get("state").cloned(),
        region: fields.get("region").cloned(),
        tech: fields.get("tech").cloned(),
      });
    }
  }

  towers.sort_by(|a, b| a.id.cmp(&b.id));

  Json(TowerBoundsResponse {
    count: towers.len(),
    towers,
    zoom: query.zoom,
  })
  .into_response()
}

/// GET /status — public status endpoint (no auth required).
pub async fn status_handler(
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  let device_connected = state.shared.device_connected.load(Ordering::Relaxed);
  let device_info = state.shared.device_info.lock().unwrap().clone();
  let client_count = state.shared.client_count.load(Ordering::Relaxed);
  let authenticated_count =
    state.shared.authenticated_count.load(Ordering::Relaxed);

  // This is a cheap, non-blocking check (does not open the device) and remains
  // responsive even if the SDR I/O thread is busy.
  let device_count = RtlSdrDevice::get_device_count();
  let device_present = device_count > 0;

  let device_state = state.shared.device_state.lock().unwrap().clone();
  let device_loading_reason =
    state.shared.device_loading_reason.lock().unwrap().clone();

  Json(serde_json::json!({
    "device_connected": device_connected,
    "device_present": device_present,
    "device_count": device_count,
    "device_state": device_state,
    "device_loading_reason": device_loading_reason,
    "device_info": device_info,
    "backend": if device_connected { "rtl-sdr" } else { "mock_apt" },
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
    None => {
      return (StatusCode::UNAUTHORIZED, "Invalid or expired session token")
        .into_response();
    }
  };

  // Get capture artifacts for this job
  let artifacts: Vec<crate::server::types::CaptureArtifact> = {
    let artifacts_map = state.shared.capture_artifacts.lock().unwrap();
    match artifacts_map.get(&params.job_id) {
      Some(artifacts) => artifacts.clone(),
      None => {
        return (
          StatusCode::NOT_FOUND,
          "Capture job not found or not completed",
        )
          .into_response();
      }
    }
  };

  if artifacts.is_empty() {
    return (
      StatusCode::NOT_FOUND,
      "No artifacts found for this capture job",
    )
      .into_response();
  }

  // If single file, return it directly
  if artifacts.len() == 1 {
    let artifact = &artifacts[0];
    match tokio::fs::metadata(&artifact.path).await {
      Ok(meta) => {
        let file_size = meta.len();
        match tokio::fs::File::open(&artifact.path).await {
          Ok(file) => {
            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);

            let content_type = if artifact.filename.ends_with(".wav") {
              "audio/wav"
            } else {
              "application/octet-stream"
            };

            let mut headers = axum::http::HeaderMap::new();
            headers.insert(
              axum::http::header::CONTENT_TYPE,
              content_type.parse().unwrap(),
            );
            headers.insert(
              axum::http::header::CONTENT_LENGTH,
              file_size.to_string().parse().unwrap(),
            );
            headers.insert(
              axum::http::header::CONTENT_DISPOSITION,
              format!("attachment; filename=\"{}\"", artifact.filename)
                .parse()
                .unwrap(),
            );

            return (StatusCode::OK, headers, body).into_response();
          }
          Err(e) => {
            error!("Failed to open capture file: {}", e);
            return (
              StatusCode::INTERNAL_SERVER_ERROR,
              "Failed to read capture file",
            )
              .into_response();
          }
        }
      }
      Err(e) => {
        error!("Failed to get capture file metadata: {}", e);
        return (StatusCode::NOT_FOUND, "Capture file not found on disk")
          .into_response();
      }
    }
  }

  // Multiple files: create ZIP archive
  use std::io::Write;
  let mut zip_buffer = std::io::Cursor::new(Vec::new());
  {
    let mut zip = zip::ZipWriter::new(&mut zip_buffer);
    let options: zip::write::FileOptions<()> =
      zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    for artifact in &artifacts {
      match std::fs::read(&artifact.path) {
        Ok(data) => {
          if let Err(e) = zip.start_file(&artifact.filename, options) {
            error!("Failed to add file to ZIP: {}", e);
            return (
              StatusCode::INTERNAL_SERVER_ERROR,
              "Failed to create ZIP archive",
            )
              .into_response();
          }
          if let Err(e) = zip.write_all(&data) {
            error!("Failed to write file to ZIP: {}", e);
            return (
              StatusCode::INTERNAL_SERVER_ERROR,
              "Failed to create ZIP archive",
            )
              .into_response();
          }
        }
        Err(e) => {
          error!("Failed to read capture file for ZIP: {}", e);
          return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read capture file",
          )
            .into_response();
        }
      }
    }

    if let Err(e) = zip.finish() {
      error!("Failed to finalize ZIP: {}", e);
      return (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to create ZIP archive",
      )
        .into_response();
    }
  }

  let zip_data = zip_buffer.into_inner();
  let zip_filename = format!("capture_{}.zip", params.job_id);

  (
    StatusCode::OK,
    [
      ("Content-Type", "application/zip"),
      (
        "Content-Disposition",
        &format!("attachment; filename=\"{}\"", zip_filename),
      ),
    ],
    zip_data,
  )
    .into_response()
}

/// GET /api/agent/info — Agent system information and capabilities
pub async fn agent_info_handler(
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  info!("Agent info requested");

  let frames = state.shared.channels.lock().unwrap().clone();
  let freq_range =
    format_frequency_range(&frames).unwrap_or_else(|| "unknown".to_string());
  let sample_rate_label = format_sample_rate(Some(
    state.shared.sdr_settings.lock().unwrap().sample_rate,
  ))
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
      "supported": ["rtl-sdr", "hackrf", "mock_apt"],
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
  let device_loading = *shared.device_loading.lock().unwrap();
  let device_loading_reason =
    shared.device_loading_reason.lock().unwrap().clone();
  let frames = shared.channels.lock().unwrap().clone();
  let freq_range =
    format_frequency_range(&frames).unwrap_or_else(|| "unknown".to_string());
  let sample_rate_label = format_sample_rate(Some(
    state.shared.sdr_settings.lock().unwrap().sample_rate,
  ))
  .unwrap_or_else(|| "unknown".to_string());

  let status = serde_json::json!({
    "device": {
      "connected": device_connected,
      "type": if device_connected { "rtl-sdr" } else { "mock_apt" },
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
async fn handle_connect_device(
  state: &Arc<super::AppState>,
  _params: &serde_json::Value,
) -> WebMCPToolResponse {
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

async fn handle_set_gain(
  state: &Arc<super::AppState>,
  params: &serde_json::Value,
) -> WebMCPToolResponse {
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

async fn handle_set_ppm(
  state: &Arc<super::AppState>,
  params: &serde_json::Value,
) -> WebMCPToolResponse {
  if let Some(ppm) = params.get("ppm").and_then(|p| p.as_i64()) {
    if let Err(e) = state
      .cmd_tx
      .send(super::types::SdrCommand::SetPpm(ppm as i32))
    {
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

async fn handle_set_tuner_agc(
  state: &Arc<super::AppState>,
  params: &serde_json::Value,
) -> WebMCPToolResponse {
  if let Some(enabled) = params.get("enabled").and_then(|e| e.as_bool()) {
    if let Err(e) = state
      .cmd_tx
      .send(super::types::SdrCommand::SetTunerAGC(enabled))
    {
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

async fn handle_set_rtl_agc(
  state: &Arc<super::AppState>,
  params: &serde_json::Value,
) -> WebMCPToolResponse {
  if let Some(enabled) = params.get("enabled").and_then(|e| e.as_bool()) {
    if let Err(e) = state
      .cmd_tx
      .send(super::types::SdrCommand::SetRtlAGC(enabled))
    {
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

async fn handle_restart_device(
  state: &Arc<super::AppState>,
  _params: &serde_json::Value,
) -> WebMCPToolResponse {
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

async fn handle_start_capture(
  state: &Arc<super::AppState>,
  params: &serde_json::Value,
) -> WebMCPToolResponse {
  // Extract capture parameters
  let job_id = params
    .get("jobId")
    .and_then(|id| id.as_str())
    .unwrap_or("unknown");

  let fragments =
    if let Some(frags) = params.get("fragments").and_then(|f| f.as_array()) {
      frags
        .iter()
        .filter_map(|f| {
          let min = f.get("minFreq").and_then(|v| v.as_f64());
          let max = f.get("maxFreq").and_then(|v| v.as_f64());
          match (min, max) {
            (Some(m1), Some(m2)) => Some((m1, m2)),
            _ => None,
          }
        })
        .collect()
    } else {
      let min_freq = params
        .get("minFreq")
        .and_then(|f| f.as_f64())
        .unwrap_or(0.0);
      let max_freq = params
        .get("maxFreq")
        .and_then(|f| f.as_f64())
        .unwrap_or(30.0);
      vec![(min_freq, max_freq)]
    };

  let duration_s = params
    .get("durationS")
    .and_then(|d| d.as_f64())
    .unwrap_or(5.0);
  let file_type = params
    .get("fileType")
    .and_then(|t| t.as_str())
    .unwrap_or(".napt");
  let acquisition_mode = params
    .get("acquisitionMode")
    .and_then(|m| m.as_str())
    .unwrap_or("stepwise");
  let encrypted = params
    .get("encrypted")
    .and_then(|e| e.as_bool())
    .unwrap_or(true);
  let fft_size = params
    .get("fftSize")
    .and_then(|s| s.as_u64())
    .unwrap_or(1024) as usize;
  let fft_window = params
    .get("fftWindow")
    .and_then(|w| w.as_str())
    .unwrap_or("hann");

  let capture_cmd = super::types::SdrCommand::StartCapture {
    job_id: job_id.to_string(),
    fragments: fragments.clone(),
    duration_s,
    file_type: file_type.to_string(),
    acquisition_mode: acquisition_mode.to_string(),
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
        "fragments": fragments.iter().map(|(min, max)| serde_json::json!({"minFreq": min, "maxFreq": max})).collect::<Vec<_>>(),
        "duration": duration_s,
        "format": file_type,
        "acquisitionMode": acquisition_mode,
        "encrypted": encrypted,
        "message": "Capture started successfully"
      })),
      error: None,
      tool: "startCapture".to_string(),
    }
  }
}

async fn handle_stop_capture(
  _state: &Arc<super::AppState>,
  _params: &serde_json::Value,
) -> WebMCPToolResponse {
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

async fn handle_classify_signal(
  state: &Arc<super::AppState>,
  _params: &serde_json::Value,
) -> WebMCPToolResponse {
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
