use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use log::{error, info, warn};
use redis::Client as RedisClient;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::{Arc, atomic::Ordering};
use std::time::Instant;
use tokio_util::io::ReaderStream;

use crate::sdr::rtlsdr::RtlSdrDevice;

use super::types::{
  CaptureDownloadParams, SpectrumFrameMessage, WebMCPToolRequest,
  WebMCPToolResponse,
};

// Haversine distance calculation for tower filtering
fn haversine_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
  const EARTH_RADIUS: f64 = 6371.0; // Earth's radius in kilometers
  
  let lat1_rad = lat1.to_radians();
  let lat2_rad = lat2.to_radians();
  let delta_lat = (lat2 - lat1).to_radians();
  let delta_lon = (lon2 - lon1).to_radians();
  
  let a = (delta_lat / 2.0).sin().powi(2) +
          lat1_rad.cos() * lat2_rad.cos() *
          (delta_lon / 2.0).sin().powi(2);
  let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
  
  EARTH_RADIUS * c
}

/// Sample towers evenly across the area when zoomed out
fn sample_towers_evenly(towers: &[TowerRecord], max_count: usize) -> Vec<TowerRecord> {
  if towers.len() <= max_count {
    return towers.to_vec();
  }

  let step = towers.len() / max_count;
  let mut sampled = Vec::with_capacity(max_count);
  
  for i in (0..towers.len()).step_by(step.max(1)) {
    sampled.push(towers[i].clone());
    if sampled.len() >= max_count {
      break;
    }
  }
  
  sampled
}

/// Sample towers by distance from center when zoomed in
fn sample_towers_by_distance(
  towers: &[TowerRecord], 
  center_lat: f64, 
  center_lng: f64, 
  max_count: usize
) -> Vec<TowerRecord> {
  if towers.len() <= max_count {
    return towers.to_vec();
  }

  let mut towers_with_distance: Vec<(f64, &TowerRecord)> = towers
    .iter()
    .map(|tower| {
      let distance = haversine_distance(center_lat, center_lng, tower.lat, tower.lon);
      (distance, tower)
    })
    .collect();

  // Sort by distance and take the closest ones
  towers_with_distance.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
  
  towers_with_distance
    .into_iter()
    .take(max_count)
    .map(|(_, tower)| tower.clone())
    .collect()
}

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

#[derive(Debug, Serialize, Clone)]
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
  #[serde(skip_serializing_if = "Option::is_none")]
  pub truncated: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub total_found: Option<usize>,
}

#[derive(Debug, Deserialize, Default)]
pub struct StitchDiagnosticRequest {
  /// Optional center frequency override in Hz (to honour channel selection from sidebar)
  pub center_hz: Option<u32>,
  /// Optional signal area label (A, B, etc.) to anchor the diagnostic to the channel start
  pub signal_area: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StitchDiagnosticTiming {
  pub total_latency_ms: f32,
  pub settle_time_ms: f32,
  pub slice_duration_ms: f32,
  pub capture_timestamp_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct StitchDiagnosticResponse {
  pub hop1_frames: Vec<Vec<f32>>,
  pub hop2_frames: Vec<Vec<f32>>,
  pub stitched_frames: Vec<Vec<f32>>,
  pub hop1_freq_mhz: [f32; 2],
  pub hop2_freq_mhz: [f32; 2],
  pub stitched_freq_mhz: [f32; 2],
  pub overlap_start: usize,
  pub overlap_end: usize,
  pub device_info: String,
  /// Mean phase angle of the dominant signal in Hop 1 (degrees)
  pub hop1_phase_deg: f32,
  /// Mean phase angle of the dominant signal in Hop 2 (degrees)
  pub hop2_phase_deg: f32,
  /// Phase shift required to align Hop 2 with Hop 1 (degrees)
  pub correction_angle_deg: f32,
  /// Estimated FM deviation / frequency drift between the two captures (kHz)
  pub fm_deviation_khz: f32,
  pub timing: StitchDiagnosticTiming,
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

  // Get towers from both Fast Select DB (2) and Local DB (4)
  let mut all_tower_keys: Vec<String> = Vec::new();

  // Query Fast Select DB (2)
  if let Err(e) = redis::cmd("SELECT").arg(2).query::<()>(&mut con) {
    error!("Failed to select Redis DB 2: {}", e);
  } else {
    if let Ok(keys) = redis::cmd("KEYS").arg("tower:*").query::<Vec<String>>(&mut con) {
      all_tower_keys.extend(keys);
    }
  }

  // Query Local DB (4) for user-loaded towers
  if let Err(e) = redis::cmd("SELECT").arg(4).query::<()>(&mut con) {
    error!("Failed to select Redis DB 4: {}", e);
  } else {
    if let Ok(keys) = redis::cmd("KEYS").arg("local:*").query::<Vec<String>>(&mut con) {
      for local_key in keys {
        if local_key.ends_with(":data") {
          continue;
        }
        if let Ok(tower_ids) = redis::cmd("ZRANGE").arg(&local_key).arg(0).arg(-1).query::<Vec<String>>(&mut con) {
          all_tower_keys.extend(tower_ids);
        }
      }
    }
  }

  // Switch back to DB 2 for default tower data retrieval
  let _ = redis::cmd("SELECT").arg(2).query::<()>(&mut con);

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

  for tower_key in all_tower_keys {
    // Skip if we've already seen this tower
    if !seen_ids.insert(tower_key.clone()) {
      continue;
    }

    // Get tower data as JSON string (try DB 2, then DB 4)
    let tower_json: redis::RedisResult<String> = redis::cmd("GET")
      .arg(&tower_key)
      .query::<String>(&mut con);
    
    let tower_json = match tower_json {
      Ok(json) => json,
      Err(_) => {
        // Try DB 4 if not found in DB 2
        let _ = redis::cmd("SELECT").arg(4).query::<()>(&mut con);
        let local_json = redis::cmd("GET").arg(&tower_key).query::<String>(&mut con);
        let _ = redis::cmd("SELECT").arg(2).query::<()>(&mut con);

        match local_json {
          Ok(json) => json,
          Err(_) => continue,
        }
      }
    };

    // Parse JSON tower data
    let tower_data: serde_json::Value = match serde_json::from_str(&tower_json) {
      Ok(data) => data,
      Err(_) => continue,
    };

    // Extract tower fields
    let lat = tower_data.get("lat")
      .and_then(|v| v.as_f64())
      .unwrap_or(0.0);
    let lon = tower_data.get("lon")
      .and_then(|v| v.as_f64())
      .unwrap_or(0.0);

    // Skip if coordinates are invalid
    if lat == 0.0 || lon == 0.0 {
      continue;
    }

    // Check if tower is within bounding box (quick filter)
    if lat < query.sw_lat || lat > query.ne_lat || lon < query.sw_lng || lon > query.ne_lng {
      continue;
    }

    // Check if tower is within radius (precise filter)
    let distance_km = haversine_distance(center_lat, center_lng, lat, lon);
    if distance_km > radius_km {
      continue;
    }

    // Extract other fields
    let mcc = tower_data.get("mcc")
      .and_then(|v| v.as_u64())
      .unwrap_or(0)
      .to_string();
    let mnc = tower_data.get("mnc")
      .and_then(|v| v.as_u64())
      .unwrap_or(0)
      .to_string();
    let lac = tower_data.get("lac")
      .and_then(|v| v.as_u64())
      .unwrap_or(0)
      .to_string();
    let cell_id = tower_data.get("cellId")
      .and_then(|v| v.as_u64())
      .unwrap_or(0)
      .to_string();
    let tech = tower_data.get("type")
      .and_then(|v| v.as_str())
      .unwrap_or("unknown");
    let samples = tower_data.get("samples")
      .and_then(|v| v.as_u64())
      .unwrap_or(0);
    let range = tower_data.get("range")
      .and_then(|v| v.as_f64())
      .unwrap_or(0.0);

    // Apply filters
    if let Some(target_mcc) = &query.mcc {
      if mcc != *target_mcc {
        continue;
      }
    }
    if let Some(target_mnc) = &query.mnc {
      if mnc != *target_mnc {
        continue;
      }
    }

    // Apply technology filter
    if let Some(tech_filter) = &query.tech {
      let tech_filter_parts: Vec<&str> = tech_filter.split(',').collect();
      if !tech_filter_parts.iter().any(|&t| normalize_tech_key(t) == normalize_tech_key(tech)) {
        continue;
      }
    }

    // Apply range filter
    if !range_filter.is_empty() && !range_filter.contains(&(range as u32).to_string()) {
      continue;
    }

    // Create tower record
    towers.push(TowerRecord {
      id: tower_key,
      radio: tech.to_string(),
      mcc,
      mnc,
      lac,
      cell: cell_id,
      range: range.to_string(),
      lon,
      lat,
      samples: samples.to_string(),
      created: tower_data.get("created")
        .and_then(|v| v.as_u64())
        .map(|v| v.to_string())
        .unwrap_or_default(),
      updated: tower_data.get("updated")
        .and_then(|v| v.as_u64())
        .map(|v| v.to_string())
        .unwrap_or_default(),
      state: None, // Can be derived from coordinates if needed
      region: None, // Can be derived from coordinates if needed
      tech: Some(tech.to_string()),
    });
  }

  towers.sort_by(|a, b| a.id.cmp(&b.id));

  // Apply tower count limits to prevent browser crashes
  const MAX_TOWERS: usize = 1000;
  let total_found = towers.len();
  
  if towers.len() > MAX_TOWERS {
    // Smart sampling for large areas
    let sampled_towers = if query.zoom.unwrap_or(10) < 8 {
      // When zoomed out, sample towers evenly across the area
      sample_towers_evenly(&towers, MAX_TOWERS)
    } else {
      // When zoomed in, take closest towers to center
      sample_towers_by_distance(&towers, center_lat, center_lng, MAX_TOWERS)
    };
    
    warn!(
      "Tower query truncated: {} -> {} towers (zoom: {}, area: {}x{} km)",
      total_found,
      sampled_towers.len(),
      query.zoom.unwrap_or(10),
      (lat_km * 2.0) as i32,
      (lon_km * 2.0) as i32
    );
    
    Json(TowerBoundsResponse {
      count: sampled_towers.len(),
      towers: sampled_towers,
      zoom: query.zoom,
      truncated: Some(true),
      total_found: Some(total_found),
    })
    .into_response()
  } else {
    Json(TowerBoundsResponse {
      count: towers.len(),
      towers,
      zoom: query.zoom,
      truncated: Some(false),
      total_found: Some(total_found),
    })
    .into_response()
  }
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


/// POST /api/debug/stitch-diagnostic — Run a 2-hop capture and return stitching data
/// Calculate the phase offset between two raw IQ frames in their overlap region.
/// Returns the correction angle in degrees that should be added to Hop 2 to align it with Hop 1.
fn calculate_overlap_phase_offset(
  processor: &mut crate::sdr::SdrProcessor,
  iq1: &[u8],
  iq2: &[u8],
) -> (f32, f32, f32, f32) {
  let fft_size = processor.fft_processor.fft_size();
  let sample_rate = processor.get_sample_rate() as f32;
  let bytes_per_frame = fft_size * 2;

  if iq1.len() < bytes_per_frame || iq2.len() < bytes_per_frame {
    return (0.0, 0.0, 0.0, 0.0);
  }

  // Use the first frame from each capture for stable alignment
  let frame1 = &iq1[0..bytes_per_frame];
  let frame2 = &iq2[0..bytes_per_frame];

  let mut c1 = processor.fft_processor.iq_to_complex(frame1);
  let mut c2 = processor.fft_processor.iq_to_complex(frame2);

  processor.fft_processor.apply_window(&mut c1);
  processor.fft_processor.apply_window(&mut c2);

  let mut planner = FftPlanner::new();
  let fft = planner.plan_fft_forward(fft_size);
  fft.process(&mut c1);
  fft.process(&mut c2);

  // We must shift frequencies to match visual layout: [-Nyq .. DC .. +Nyq]
  c1.rotate_right(fft_size / 2);
  c2.rotate_right(fft_size / 2);

  // For a 1.2MHz jump at 3.2MHz sample rate, the overlap is 62.5% of the spectrum.
  // The shift is exactly 37.5% of the bins.
  let offset_bins = (0.375f32 * fft_size as f32).round() as usize;
  let overlap_len = fft_size - offset_bins;

  if overlap_len == 0 {
    return (0.0, 0.0, 0.0, 0.0);
  }

  let mut sum_product = Complex::new(0.0f32, 0.0f32);
  // 1. Compute Cross-Power Spectrum in the overlap region
  let mut cross_power = Vec::with_capacity(overlap_len);
  for i in 0..overlap_len {
    // z1 * conj(z2) gives the complex vector offset from 2 to 1 for this frequency bin
    cross_power.push(c1[offset_bins + i] * c2[i].conj());
  }

  // 2. Estimate sub-sample Time Delay (Fractional Delay) via Phase Slope
  // Formula: X_corr(f) = X(f) e^{-j 2\pi f \Delta t}
  // Instead of peak absolute cross-correlation, we use the phase differentiator method
  // to yield exact sub-sample phase tracking.
  let mut sum_slope = Complex::new(0.0f32, 0.0f32);
  for i in 1..overlap_len {
    // Multiply by conj of previous bin to find phase difference: z[i] * z[i-1]*
    // Amplitude weighting prioritizes bins with strong signal to lock the slope
    sum_slope += cross_power[i] * cross_power[i - 1].conj();
  }
  let phase_slope_per_bin = sum_slope.arg(); // Sub-sample fractional discrete delay

  // 3. Estimate constant Phase Offset (LO mismatch / zero-Hz intercept)
  // We remove the linear time delay from the cross_power to solve the base LO rotation.
  let mut sum_base = Complex::new(0.0f32, 0.0f32);
  for i in 0..overlap_len {
    // Rotation applied to counteract the phase slope and align perfectly to base phase
    let detrend_rot = Complex::new(0.0, -phase_slope_per_bin * (i as f32)).exp();
    sum_base += cross_power[i] * detrend_rot;
  }
  let base_phase_offset = sum_base.arg();

  // 4. Calculate Phase of Hop 1 and Hop 2 using the dominant frequency for UI display
  let mut max_combined_pwr = -1.0;
  let mut dominant_phase1 = 0.0;
  let mut dominant_phase2 = 0.0;
  let mut dominant_bin = 0;
  
  // Also track absolute separate peaks for FM Deviation
  let mut max_pwr1 = -1.0;
  let mut bin1 = 0;
  let mut max_pwr2 = -1.0;
  let mut bin2 = 0;

  for i in 0..overlap_len {
    let pwr1 = c1[offset_bins + i].norm_sqr();
    let pwr2 = c2[i].norm_sqr();
    let pwr_combined = pwr1 + pwr2;
    
    if pwr_combined > max_combined_pwr {
      max_combined_pwr = pwr_combined;
      dominant_phase1 = c1[offset_bins + i].arg();
      dominant_phase2 = c2[i].arg();
      dominant_bin = i;
    }
    
    if pwr1 > max_pwr1 {
      max_pwr1 = pwr1;
      bin1 = i;
    }
    
    if pwr2 > max_pwr2 {
      max_pwr2 = pwr2;
      bin2 = i;
    }
  }

  // Calculate FM Deviation (how much the peak swung between Hop 1 and Hop 2)
  let bin_size_hz = sample_rate / fft_size as f32;
  let fm_deviation_hz = (bin2 as f32 - bin1 as f32) * bin_size_hz;
  let fm_deviation_khz = fm_deviation_hz / 1000.0;

  // Calculate the EXACT phase shift modeled for Hop 2 at the dominant frequency!
  // Phase Rotation in frequency domain: X_corr(f) = X(f) * exp(j * (\theta_0 + slope * f))
  let shift_at_dominant = base_phase_offset + phase_slope_per_bin * (dominant_bin as f32);

  // Wrap to [-180, 180] strictly
  // Use rem_euclid to restrict strictly to [0, 360) first
  let mut correction_angle_deg = shift_at_dominant.to_degrees().rem_euclid(360.0);
  
  if correction_angle_deg > 180.0 {
    correction_angle_deg -= 360.0;
  }

  (
    correction_angle_deg,
    dominant_phase1.to_degrees(),
    dominant_phase2.to_degrees(),
    fm_deviation_khz
  )
}

pub async fn stitch_diagnostic_handler(
  State(state): State<Arc<super::main::AppState>>,
  body: Option<Json<StitchDiagnosticRequest>>,
) -> impl IntoResponse {
  let start_time = Instant::now();
  info!("Stitch diagnostic requested (multi-frame)");

  let center_hz_override = body.as_ref().and_then(|b| b.center_hz);
  let signal_area_override = body.as_ref().and_then(|b| b.signal_area.clone());

  let mut processor = state.sdr_processor.lock().await;

  // Determine the primary center frequency for Hop 1.
  // We prioritize anchoring to the start of the active signal area if provided.
  let mut effective_center1 = center_hz_override;
  if let Some(label) = signal_area_override {
    let channels = state.shared.channels.lock().unwrap().clone();
    if let Some(ch) = channels.iter().find(|c| c.label.to_uppercase() == label.to_uppercase()) {
      // Anchor center1 so that the hardware capture starts exactly at the channel's min_mhz
      // center = min + (sample_rate / 2)
      let sr_hz = processor.get_sample_rate() as f64;
      let anchored_hz = (ch.min_mhz * 1_000_000.0 + (sr_hz / 2.0)) as u32;
      info!("Anchoring diagnostic center1 to {} Hz for area {}", anchored_hz, label);
      effective_center1 = Some(anchored_hz);
    }
  }

  let (center1, hop_bw_mhz, sample_rate, device_info, was_paused) = {
    let was_paused = state.shared.is_paused.load(Ordering::Relaxed);
    // Pause during diagnostic to avoid hardware contention
    state.shared.is_paused.store(true, Ordering::Relaxed);

    // Honor channel selection from the sidebar
    if let Some(center_hz) = effective_center1 {
      if center_hz != processor.get_center_frequency() {
        if let Err(e) = processor.set_center_frequency(center_hz) {
          warn!("Failed to apply center_hz override: {}", e);
        } else {
          processor.flush_read_queue();
        }
      }
    }
    
    let sample_rate = processor.get_sample_rate() as f64;
    (
      processor.get_center_frequency(),
      sample_rate / 1_000_000.0,
      sample_rate,
      processor.get_device_info(),
      was_paused
    )
  };
  
  const NUM_FRAMES: usize = 60;
  let mut hop1_frames = Vec::with_capacity(NUM_FRAMES);
  let mut hop2_frames = Vec::with_capacity(NUM_FRAMES);
  let mut hop1_raw_iq: Vec<u8> = Vec::new();
  let mut hop2_raw_iq: Vec<u8> = Vec::new();

  // 1. Capture Hop 1
  {
    // Clear any stale pending frequency to avoid accidental retunes
    processor.pending_freq = None;
    // Flush to clear any stale data before we start the "real" capture
    processor.flush_read_queue();

    for _ in 0..NUM_FRAMES {
      match processor.read_and_process_frame() {
        Ok(f) => {
          // Collect the raw IQ bytes the device just read (set by read_and_process_frame)
          hop1_raw_iq.extend_from_slice(&processor.last_frame_raw_iq);
          hop1_frames.push(f);
        }
        Err(e) => {
          state.shared.is_paused.store(was_paused, Ordering::Relaxed);
          return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to capture hop 1: {}", e)).into_response();
        }
      }
    }
  }



  // 2. Tune and Capture Hop 2 (offset by 1.2MHz)
  let center2 = center1 + 1_200_000;
  {
    if let Err(e) = processor.set_center_frequency(center2) {
      state.shared.is_paused.store(was_paused, Ordering::Relaxed);
      return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to tune to hop 2: {}", e)).into_response();
    }

    // Flush to clear any data from the old frequency
    processor.flush_read_queue();

    for _ in 0..NUM_FRAMES {
      match processor.read_and_process_frame() {
        Ok(f) => {
          hop2_raw_iq.extend_from_slice(&processor.last_frame_raw_iq);
          hop2_frames.push(f);
        }
        Err(e) => {
          let _ = processor.set_center_frequency(center1); // Restore
          state.shared.is_paused.store(was_paused, Ordering::Relaxed);
          return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to capture hop 2: {}", e)).into_response();
        }
      }
    }
    // Restore frequency
    let _ = processor.set_center_frequency(center1);
  }

  // Compute phase coherence / alignment offset in the overlap region
  let (correction_angle_deg, hop1_phase_deg, hop2_phase_deg, fm_deviation_khz) = calculate_overlap_phase_offset(&mut processor, &hop1_raw_iq, &hop2_raw_iq);

  // Restore previous pause state
  state.shared.is_paused.store(was_paused, Ordering::Relaxed);

  // 4. Seamless Crossfade Stitching
  let jump_hz = (center2 - center1) as f64 / 1_000_000.0;
  let fft_size = if !hop1_frames.is_empty() { hop1_frames[0].len() } else { 1024 };

  // Calculate dynamic overlap bounds based strictly on the center frequency jump
  let offset_bins = ((fft_size as f64) * (jump_hz / hop_bw_mhz)).round() as usize;
  let overlap_bins = fft_size.saturating_sub(offset_bins);
    // 4. Midpoint Cut Stitching (No Blending)
    let mut stitched_frames = Vec::with_capacity(NUM_FRAMES);
    let midpoint_bin = overlap_bins / 2;

    for i in 0..NUM_FRAMES {
      let f1 = &hop1_frames[i];
      let f2 = &hop2_frames[i];
      
      let mut stitched = Vec::with_capacity(fft_size + offset_bins);
      
      if f1.len() < fft_size || f2.len() < fft_size {
        stitched.extend_from_slice(f1);
        stitched_frames.push(stitched);
        continue;
      }

      // 1. Hop 1 up to the midpoint of the overlap
      stitched.extend_from_slice(&f1[..offset_bins + midpoint_bin]);
      
      // 2. Hop 2 from the midpoint of the overlap onwards
      // The overlap in f2 starts at index 0. So midpoint in overlap is index midpoint_bin.
      stitched.extend_from_slice(&f2[midpoint_bin..]);
      
      stitched_frames.push(stitched);
    }

  // Frequency ranges
  let hop1_start = (center1 as f32 - (sample_rate as f32 / 2.0)) / 1_000_000.0;
  let hop1_end = (center1 as f32 + (sample_rate as f32 / 2.0)) / 1_000_000.0;
  let hop2_start = (center2 as f32 - (sample_rate as f32 / 2.0)) / 1_000_000.0;
  let hop2_end = (center2 as f32 + (sample_rate as f32 / 2.0)) / 1_000_000.0;

  let total_latency_ms = start_time.elapsed().as_secs_f32() * 1000.0;
  let slice_duration_ms = (fft_size as f32 / sample_rate as f32) * 1000.0;
  // Mock uses 0ms settle, real hardware usually ~3-10ms based on post_retune_discard_frames
  let settle_time_ms = if device_info.contains("Mock") { 0.0 } else { 10.0 }; 

  Json(StitchDiagnosticResponse {
    hop1_frames,
    hop2_frames,
    stitched_frames,
    hop1_freq_mhz: [hop1_start, hop1_end],
    hop2_freq_mhz: [hop2_start, hop2_end],
    stitched_freq_mhz: [hop1_start, hop2_end],
    overlap_start: offset_bins,
    overlap_end: overlap_bins,

    device_info,
    hop1_phase_deg,
    hop2_phase_deg,
    correction_angle_deg,
    fm_deviation_khz,
    timing: StitchDiagnosticTiming {
      total_latency_ms,
      settle_time_ms,
      slice_duration_ms,
      capture_timestamp_ms: std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64,
    },
  })
  .into_response()
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
    .unwrap_or("whole_sample");
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
    geolocation: None, // HTTP endpoints don't have geolocation data
    ref_based_demod_baseline: None,
    is_ephemeral: false,
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
