use axum::body::{Body, Bytes};
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use log::{error, info, warn};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;
use tokio_util::io::ReaderStream;
use validator::Validate;

use super::types::{
  CaptureDownloadParams, ChannelSpec, SpectrumFrameMessage, TowerBoundsQuery,
  WebMCPToolRequest, WebMCPToolResponse,
};
use super::websocket_server::{
  build_source_info_snapshot, reconcile_stale_device_snapshot,
};
use crate::s::fft::anti_aliasing;

#[derive(Debug, Deserialize)]
pub struct HardwareSimulationRequest {
  pub present: bool,
}

/// Read-only snapshot for benchmark automation and live diagnostics.
pub async fn pipeline_performance_handler() -> impl IntoResponse {
  Json(crate::performance::pipeline_metrics().snapshot())
}

/// Read-only snapshot of logical stream registration and delivery state.
/// This distinguishes a producer that is generating frames from a stream
/// whose subscriber is actually receiving them.
pub async fn stream_performance_handler(
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  Json(state.stream_manager.metrics_snapshot())
}

/// Test-only hardware transition hook. It is available only when the backend
/// was explicitly started with N_APT_TEST_HARDWARE_SIMULATION=rtl-sdr.
pub async fn hardware_simulation_handler(
  State(state): State<Arc<super::AppState>>,
  Json(request): Json<HardwareSimulationRequest>,
) -> impl IntoResponse {
  if !crate::sdr::hotplug::hardware_simulation_enabled() {
    return StatusCode::NOT_FOUND.into_response();
  }

  if state
    .cmd_tx
    .send(super::types::SdrCommand::SetSimulatedHardwarePresence(
      request.present,
    ))
    .is_err()
  {
    return (StatusCode::SERVICE_UNAVAILABLE, "SDR worker is unavailable")
      .into_response();
  }

  Json(serde_json::json!({
    "present": request.present,
    "source": "rtl-sdr-00000001",
  }))
  .into_response()
}

#[derive(Debug, Deserialize)]
pub struct CliSnapshotFramesQuery {
  frames: Option<usize>,
  fft_size: Option<usize>,
}

const MAX_SNAPSHOT_FRAMES: usize = 128;

fn bounded_snapshot_frame_count(frames: Option<usize>) -> usize {
  match frames {
    None | Some(0) => 1,
    Some(value) if value > MAX_SNAPSHOT_FRAMES => MAX_SNAPSHOT_FRAMES,
    Some(value) => value,
  }
}

/// Build a snapshot frame carrying only the requested IQ prefix.
///
/// Copies just the first `iq_bytes` of IQ instead of cloning the full ~512 KiB
/// buffer and truncating — up to 128 frames per request would otherwise spike
/// transient allocations by tens of MB.
fn snapshot_frame_from(
  frame: &super::types::SpectrumData,
  iq_bytes: usize,
) -> super::types::SpectrumData {
  let mut snapshot = frame.clone();
  snapshot.waveform.clear();
  snapshot.iq_data =
    frame.iq_data[..iq_bytes.min(frame.iq_data.len())].to_vec();
  snapshot
}

/// Returns a short history of current Rust SDR frames for the authenticated
/// CLI snapshot harness. The endpoint exposes data only; image composition
/// stays shared with the frontend's existing 2D snapshot renderers.
pub async fn cli_snapshot_frame_handler(
  State(state): State<Arc<super::AppState>>,
  Query(query): Query<CliSnapshotFramesQuery>,
) -> impl IntoResponse {
  let mut receiver = state.spectrum_tx.subscribe();
  let requested = bounded_snapshot_frame_count(query.frames);
  let iq_bytes = query.fft_size.unwrap_or(4096).clamp(256, 262_144) * 2;
  let mut frames = Vec::new();
  let collection = async {
    while frames.len() < requested {
      match receiver.recv().await {
        Ok(frame) => frames.push(snapshot_frame_from(&frame, iq_bytes)),
        Err(error) => return Err(error),
      }
    }
    Ok(())
  };
  let result =
    tokio::time::timeout(std::time::Duration::from_secs(4), collection).await;
  if !frames.is_empty() {
    return Json(frames).into_response();
  }
  match result {
    Ok(Err(error)) => (
      StatusCode::SERVICE_UNAVAILABLE,
      format!("Signal frames unavailable: {error}"),
    )
      .into_response(),
    _ => (
      StatusCode::GATEWAY_TIMEOUT,
      "Timed out waiting for signal frames",
    )
      .into_response(),
  }
}

#[derive(Debug, Deserialize)]
pub struct MockTxPowerFrameQuery {
  fft_size: Option<usize>,
  tx_ifft_size: Option<usize>,
  sample_rate_hz: Option<u32>,
  bandwidth_hz: Option<f64>,
  power_dbm: Option<f64>,
  signal: Option<String>,
}

/// Generate a raw Mock Tx frame for the browser WebGPU power-contract test.
///
/// This intentionally goes through the production complex-baseband generator
/// so the test compares the actual Rust output with the actual WGSL shader,
/// rather than comparing two independently invented fixtures.
pub async fn mock_tx_power_frame_handler(
  State(state): State<Arc<super::AppState>>,
  Query(query): Query<MockTxPowerFrameQuery>,
) -> impl IntoResponse {
  let fft_size = query.fft_size.unwrap_or(2048).clamp(256, 262_144);
  let tx_ifft_size = query.tx_ifft_size.unwrap_or(2048).clamp(256, 262_144);
  let sample_rate_hz = query.sample_rate_hz.unwrap_or(3_200_000).max(1);
  let bandwidth_hz = query
    .bandwidth_hz
    .unwrap_or(3_200_000.0)
    .clamp(1.0, sample_rate_hz as f64);
  let power_dbm = query.power_dbm.unwrap_or(-18.0);
  if !power_dbm.is_finite() {
    return (StatusCode::BAD_REQUEST, "power_dbm must be finite")
      .into_response();
  }

  let model =
    super::websocket_server::complex_baseband::resolve_mock_tx_iq_power_model();
  let raw_iq =
    super::websocket_server::complex_baseband::synthesize_mock_tx_monitor_iq_shared_phase(
      fft_size,
      137_100_000.0,
      sample_rate_hz,
      137_100_000.0,
      bandwidth_hz,
      query.signal.as_deref().unwrap_or("wifi"),
      tx_ifft_size,
      power_dbm,
      &model,
      &state.shared.mock_tx_phase_accumulator,
    );

  let mut response = raw_iq.into_response();
  response.headers_mut().insert(
    "content-type",
    HeaderValue::from_static("application/octet-stream"),
  );
  if let Ok(value) = HeaderValue::from_str(&model.calibration_db.to_string()) {
    response
      .headers_mut()
      .insert("x-mock-tx-calibration-db", value);
  }
  response
}

// Haversine distance calculation for tower filtering
fn haversine_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
  const EARTH_RADIUS: f64 = 6371.0; // Earth's radius in kilometers

  let lat1_rad = lat1.to_radians();
  let lat2_rad = lat2.to_radians();
  let delta_lat = (lat2 - lat1).to_radians();
  let delta_lon = (lon2 - lon1).to_radians();

  let a = (delta_lat / 2.0).sin().powi(2)
    + lat1_rad.cos() * lat2_rad.cos() * (delta_lon / 2.0).sin().powi(2);
  let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());

  EARTH_RADIUS * c
}

/// Sample towers evenly across the area when zoomed out
fn sample_towers_evenly(
  towers: &[TowerRecord],
  max_count: usize,
) -> Vec<TowerRecord> {
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
  max_count: usize,
) -> Vec<TowerRecord> {
  if towers.len() <= max_count {
    return towers.to_vec();
  }

  let mut towers_with_distance: Vec<(f64, &TowerRecord)> = towers
    .iter()
    .map(|tower| {
      let distance =
        haversine_distance(center_lat, center_lng, tower.lat, tower.lon);
      (distance, tower)
    })
    .collect();

  // Sort by distance and take the closest ones
  towers_with_distance
    .sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

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
    min = min.min(frame.min_hz);
    max = max.max(frame.max_hz);
  }
  if !min.is_finite() || !max.is_finite() || max <= min {
    return None;
  }
  Some(format!("{:.0}-{:.0} Hz", min, max))
}

fn format_sample_rate(sample_rate: Option<u32>) -> Option<String> {
  let rate = sample_rate?;
  if rate == 0 {
    return None;
  }
  Some(format!("{} S/s", rate))
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
  pub center_hz: Option<f64>,
  pub fft_size: Option<usize>,
  pub frames_to_average: Option<u32>,
  pub signal_area: Option<String>,
  pub stitch_options: Option<StitchOptions>,
}

#[derive(Debug, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StitchOptions {
  pub phase_correction: bool,
  pub fm_deviation_correction: bool,
  pub anti_aliasing: bool,
  pub noise_floor_matching: bool,
  pub crossfading: bool,
  pub chinese_remainder_synthesis: bool,
  pub js_anti_aliasing: bool,
  pub js_noise_floor_matching: bool,
  pub acquisition_mode: Option<String>,
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
  pub hop1_frames: Vec<Vec<u8>>,
  pub hop2_frames: Vec<Vec<u8>>,
  pub stitched_frames: Vec<Vec<u8>>,
  pub hop1_freq_hz: [f64; 2],
  pub hop2_freq_hz: [f64; 2],
  pub stitched_freq_hz: [f64; 2],
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
  pub reconstructed_freq_hz: Option<f64>,
  pub timing: StitchDiagnosticTiming,
  pub acquisition_mode: String,
  /// Frequency of the actual stitch cut (Hz)
  pub cut_point_hz: f64,
  /// RMS error between Hop 1 and Hop 2 in the overlap region (dB)
  pub overlap_rms_error: f32,
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

fn convert_to_u8(v: Vec<f32>) -> Vec<u8> {
  v.into_iter()
    .map(|val| ((val + 150.0) * (255.0 / 150.0)).clamp(0.0, 255.0) as u8)
    .collect()
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
  State(state): State<Arc<super::AppState>>,
  Query(query): Query<TowerBoundsQuery>,
) -> impl IntoResponse {
  if let Err(e) = query.validate() {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({
        "error": "Validation failed",
        "details": format!("{}", e)
      })),
    )
      .into_response();
  }

  if query.ne_lat < query.sw_lat || query.ne_lng < query.sw_lng {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({"error": "Invalid bounds: northeast must be above/right of southwest"})),
    )
      .into_response();
  }

  let mut fast_tower_db = match state.shared.redis_store.database(2).await {
    Ok(database) => database,
    Err(error) => {
      error!("Failed to connect to Redis DB 2: {error}");
      return (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Redis unavailable"})),
      )
        .into_response();
    }
  };
  let mut local_tower_db = match state.shared.redis_store.database(4).await {
    Ok(database) => database,
    Err(error) => {
      error!("Failed to connect to Redis DB 4: {error}");
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
  let mut cursor = 0u64;
  loop {
    let (new_cursor, keys): (u64, Vec<String>) = match fast_tower_db
      .query("SCAN", |command| {
        command
          .arg(cursor)
          .arg("MATCH")
          .arg("tower:*")
          .arg("COUNT")
          .arg(100);
      })
      .await
    {
      Ok(result) => result,
      Err(error) => {
        error!("Failed to scan Redis DB 2: {error}");
        return (
          StatusCode::SERVICE_UNAVAILABLE,
          Json(serde_json::json!({"error": "Redis unavailable"})),
        )
          .into_response();
      }
    };

    all_tower_keys.extend(keys);
    cursor = new_cursor;
    if cursor == 0 {
      break;
    }
  }

  // Query Local DB (4) for user-loaded towers
  let mut cursor = 0u64;
  loop {
    let (new_cursor, keys): (u64, Vec<String>) = match local_tower_db
      .query("SCAN", |command| {
        command
          .arg(cursor)
          .arg("MATCH")
          .arg("local:*")
          .arg("COUNT")
          .arg(100);
      })
      .await
    {
      Ok(result) => result,
      Err(error) => {
        error!("Failed to scan Redis DB 4: {error}");
        return (
          StatusCode::SERVICE_UNAVAILABLE,
          Json(serde_json::json!({"error": "Redis unavailable"})),
        )
          .into_response();
      }
    };

    for local_key in keys {
      if local_key.ends_with(":data") {
        continue;
      }
      if let Ok(tower_ids) = local_tower_db
        .query::<Vec<String>, _>("ZRANGE", |command| {
          command.arg(&local_key).arg(0).arg(-1);
        })
        .await
      {
        all_tower_keys.extend(tower_ids);
      }
    }

    cursor = new_cursor;
    if cursor == 0 {
      break;
    }
  }

  let range_filter = parse_filter_set(&query.range);

  // Deduplicate keys, then fetch every tower in two round-trips (MGET on DB2
  // for all keys, MGET on DB4 for the misses) instead of one GET per tower.
  let mut seen: HashSet<String> = HashSet::new();
  let unique_keys: Vec<String> = all_tower_keys
    .into_iter()
    .filter(|key| seen.insert(key.clone()))
    .collect();
  drop(seen);

  let mut tower_payloads: Vec<Option<String>> = if unique_keys.is_empty() {
    Vec::new()
  } else {
    match fast_tower_db
      .query("MGET", |command| {
        for key in &unique_keys {
          command.arg(key);
        }
      })
      .await
      .unwrap_or_default()
    {
      payloads => payloads,
    }
  };

  let miss_indices: Vec<usize> = tower_payloads
    .iter()
    .enumerate()
    .filter(|(_, payload)| payload.is_none())
    .map(|(index, _)| index)
    .collect();
  if !miss_indices.is_empty() {
    let fallback: Vec<Option<String>> = local_tower_db
      .query("MGET", |command| {
        for index in &miss_indices {
          command.arg(&unique_keys[*index]);
        }
      })
      .await
      .unwrap_or_default();
    for (slot, value) in miss_indices.into_iter().zip(fallback) {
      tower_payloads[slot] = value;
    }
  }

  let mut towers: Vec<TowerRecord> = Vec::new();

  let center_lat = (query.ne_lat + query.sw_lat) / 2.0;
  let center_lng = (query.ne_lng + query.sw_lng) / 2.0;
  let lat_km = (query.ne_lat - query.sw_lat).abs() * 111.32;
  let lon_km = (query.ne_lng - query.sw_lng).abs()
    * 111.32
    * center_lat.to_radians().cos().abs().max(0.01);
  let radius_km = ((lat_km.powi(2) + lon_km.powi(2)).sqrt() / 2.0).max(0.5);

  for (tower_key, tower_json) in unique_keys.iter().zip(&tower_payloads) {
    let Some(tower_json) = tower_json else {
      continue;
    };

    // Parse JSON tower data
    let tower_data: serde_json::Value = match serde_json::from_str(&tower_json)
    {
      Ok(data) => data,
      Err(_) => continue,
    };

    // Extract tower fields
    let lat = tower_data
      .get("lat")
      .and_then(|v| v.as_f64())
      .unwrap_or(0.0);
    let lon = tower_data
      .get("lon")
      .and_then(|v| v.as_f64())
      .unwrap_or(0.0);

    // Skip if coordinates are invalid
    if lat == 0.0 || lon == 0.0 {
      continue;
    }

    // Check if tower is within bounding box (quick filter)
    if lat < query.sw_lat
      || lat > query.ne_lat
      || lon < query.sw_lng
      || lon > query.ne_lng
    {
      continue;
    }

    // Check if tower is within radius (precise filter)
    let distance_km = haversine_distance(center_lat, center_lng, lat, lon);
    if distance_km > radius_km {
      continue;
    }

    // Extract other fields
    let mcc = tower_data
      .get("mcc")
      .and_then(|v| v.as_u64())
      .unwrap_or(0)
      .to_string();
    let mnc = tower_data
      .get("mnc")
      .and_then(|v| v.as_u64())
      .unwrap_or(0)
      .to_string();
    let lac = tower_data
      .get("lac")
      .and_then(|v| v.as_u64())
      .unwrap_or(0)
      .to_string();
    let cell_id = tower_data
      .get("cellId")
      .and_then(|v| v.as_u64())
      .unwrap_or(0)
      .to_string();
    let tech = tower_data
      .get("type")
      .and_then(|v| v.as_str())
      .unwrap_or("unknown");
    let samples = tower_data
      .get("samples")
      .and_then(|v| v.as_u64())
      .unwrap_or(0);
    let range = tower_data
      .get("range")
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
      if !tech_filter_parts
        .iter()
        .any(|&t| normalize_tech_key(t) == normalize_tech_key(tech))
      {
        continue;
      }
    }

    // Apply range filter
    if !range_filter.is_empty()
      && !range_filter.contains(&(range as u32).to_string())
    {
      continue;
    }

    // Create tower record
    towers.push(TowerRecord {
      id: tower_key.clone(),
      radio: tech.to_string(),
      mcc,
      mnc,
      lac,
      cell: cell_id,
      range: range.to_string(),
      lon,
      lat,
      samples: samples.to_string(),
      created: tower_data
        .get("created")
        .and_then(|v| v.as_u64())
        .map(|v| v.to_string())
        .unwrap_or_default(),
      updated: tower_data
        .get("updated")
        .and_then(|v| v.as_u64())
        .map(|v| v.to_string())
        .unwrap_or_default(),
      state: None,  // Can be derived from coordinates if needed
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
  let _ = reconcile_stale_device_snapshot(&state.shared);
  let client_count = state.shared.client_count.load(Ordering::Relaxed);
  let authenticated_count =
    state.shared.authenticated_count.load(Ordering::Relaxed);
  let snapshot = build_source_info_snapshot(&state.shared);

  Json(serde_json::json!({
    "meta": {
      "clients": client_count,
      "authenticated_clients": authenticated_count,
    },
    "status": snapshot,
  }))
}

/// GET /capture/download?token=<session_token>&jobId=<job_id>
/// Returns captured file(s). If multiple files, returns a ZIP archive.
pub async fn capture_download_handler(
  Query(params): Query<CaptureDownloadParams>,
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  // SECURITY: Strict job_id validation to prevent Path Traversal
  if !crate::server::utils::RE_SAFE_ID.is_match(&params.job_id) {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({
        "error": "Invalid job_id",
        "details": "Job ID contains invalid characters"
      })),
    )
      .into_response();
  }
  if let Err(e) = params.validate() {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({
        "error": "Validation failed",
        "details": format!("{}", e)
      })),
    )
      .into_response();
  }

  let _session = match state.session_store.validate(&params.token).await {
    Some(s) => s,
    None => {
      return (StatusCode::UNAUTHORIZED, "Invalid or expired session token")
        .into_response();
    }
  };

  // Get capture artifacts asynchronously so a Redis outage cannot block the
  // HTTP runtime's worker thread.
  let artifact_key = format!("artifacts:{}", params.job_id);
  let artifacts: Vec<crate::server::types::CaptureArtifact> =
    match state.shared.redis_store.get_json(1, &artifact_key).await {
      Ok(Some(artifacts)) => artifacts,
      Ok(None) => match crate::capture::storage::read_job_manifest(&params.job_id) {
        Ok(Some(artifacts)) => artifacts,
        Ok(None) => return (StatusCode::NOT_FOUND, "Capture job not found or not completed").into_response(),
        Err(error) => {
          error!("Failed to load capture recovery manifest: {error}");
          return (StatusCode::SERVICE_UNAVAILABLE, "Capture metadata is unavailable").into_response();
        }
      },
      Err(error) => {
        error!("Failed to load capture artifacts from Redis: {error}");
        match crate::capture::storage::read_job_manifest(&params.job_id) {
          Ok(Some(artifacts)) => artifacts,
          Ok(None) => return (StatusCode::SERVICE_UNAVAILABLE, "Capture metadata is temporarily unavailable").into_response(),
          Err(manifest_error) => {
            error!("Failed to load capture recovery manifest: {manifest_error}");
            return (StatusCode::SERVICE_UNAVAILABLE, "Capture metadata is temporarily unavailable").into_response();
          }
        }
      }
    };

  let artifacts = match crate::capture::storage::recover_artifact_paths(&artifacts) {
    Ok(artifacts) => artifacts,
    Err(error) => {
      error!("Capture metadata points to unavailable artifact copies: {error}");
      return (StatusCode::SERVICE_UNAVAILABLE, "Capture artifact copies are unavailable").into_response();
    }
  };

  if artifacts.is_empty() {
    return (
      StatusCode::NOT_FOUND,
      "No artifacts found for this capture job",
    )
      .into_response();
  }

  let artifacts = match resolve_capture_download_artifacts(
    &artifacts,
    params.artifact.as_deref(),
  ) {
    Ok(artifacts) => artifacts,
    Err(error) => return (StatusCode::NOT_FOUND, error).into_response(),
  };

  let classifier_package_manifest = if params.artifact.is_none() && params.job_id.starts_with("classifier_") {
    match build_classifier_package_manifest(&params.job_id, &artifacts) {
      Ok(manifest) => Some(manifest),
      Err(error) => return (StatusCode::CONFLICT, error).into_response(),
    }
  } else {
    None
  };

  // If single file, return it directly unless this is a classifier package.
  if artifacts.len() == 1 && classifier_package_manifest.is_none() {
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

  // Multiple files: create ZIP archive on disk (streaming)
  // SECURITY: Using tempfile() which is automatically deleted after all handles are closed.
  // The ZIP build performs blocking file I/O over potentially multi-GB IQ
  // captures, so it runs on the blocking pool instead of pinning an async
  // worker thread for the duration.
  let artifacts_for_zip = artifacts.clone();
  let is_classifier_package = classifier_package_manifest.is_some();
  let classifier_package_manifest = classifier_package_manifest.clone();
  let zip_build = tokio::task::spawn_blocking(move || {
    let mut zip_temp = match tempfile::tempfile() {
      Ok(t) => t,
      Err(e) => {
        error!("Failed to create temp file for ZIP: {}", e);
        return Err(
          (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
            .into_response(),
        );
      }
    };

    {
      let mut zip = zip::ZipWriter::new(&mut zip_temp);
      let options: zip::write::FileOptions<()> =
        zip::write::FileOptions::default()
          .compression_method(zip::CompressionMethod::Stored)
          .unix_permissions(0o644);

      for artifact in &artifacts_for_zip {
        let mut file = match std::fs::File::open(&artifact.path) {
          Ok(f) => f,
          Err(e) => {
            error!("Failed to open capture file for ZIP: {}", e);
            return Err(
              (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to read capture file",
              )
                .into_response(),
            );
          }
        };

        if let Err(e) = zip.start_file(&artifact.filename, options) {
          error!("Failed to add file to ZIP: {}", e);
          return Err(
            (
              StatusCode::INTERNAL_SERVER_ERROR,
              "Failed to create ZIP archive",
            )
              .into_response(),
          );
        }

        if let Err(e) = std::io::copy(&mut file, &mut zip) {
          error!("Failed to copy file into ZIP: {}", e);
          return Err(
            (
              StatusCode::INTERNAL_SERVER_ERROR,
              "Failed to write to ZIP archive",
            )
              .into_response(),
          );
        }
      }

      if let Some(manifest) = &classifier_package_manifest {
        if let Err(e) = append_classifier_package_manifest(&mut zip, manifest) {
          error!("Failed to write classifier Data Package manifest: {}", e);
          return Err(
            (
              StatusCode::INTERNAL_SERVER_ERROR,
              "Failed to create ZIP archive",
            )
              .into_response(),
          );
        }
      }

      if let Err(e) = zip.finish() {
        error!("Failed to finalize ZIP: {}", e);
        return Err(
          (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create ZIP archive",
          )
            .into_response(),
        );
      }
    }

    // Seek back to start of temp file for reading
    use std::io::Seek;
    if let Err(e) = zip_temp.seek(std::io::SeekFrom::Start(0)) {
      error!("Failed to seek in ZIP temp file: {}", e);
      return Err(
        (
          StatusCode::INTERNAL_SERVER_ERROR,
          "Failed to read ZIP archive",
        )
          .into_response(),
      );
    }

    Ok(zip_temp)
  });

  let zip_temp = match zip_build.await {
    Ok(Ok(file)) => file,
    Ok(Err(response)) => return response,
    Err(e) => {
      error!("ZIP build task failed: {}", e);
      return (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to create ZIP archive",
      )
        .into_response();
    }
  };

  let zip_size = zip_temp.metadata().map(|m| m.len()).unwrap_or(0);
  let tokio_file = tokio::fs::File::from_std(zip_temp);
  let stream = ReaderStream::new(tokio_file);
  let body = Body::from_stream(stream);
  let zip_filename = if is_classifier_package {
    let capture_id = params
      .job_id
      .strip_prefix("classifier_")
      .unwrap_or_default();
    format!(
      "n-apt-classifier-{}.zip",
      &capture_id[..capture_id.len().min(12)]
    )
  } else {
    format!("capture_{}.zip", params.job_id)
  };

  let mut headers = axum::http::HeaderMap::new();
  headers.insert(
    axum::http::header::CONTENT_TYPE,
    "application/zip".parse().unwrap(),
  );
  if zip_size > 0 {
    headers.insert(
      axum::http::header::CONTENT_LENGTH,
      zip_size.to_string().parse().unwrap(),
    );
  }
  headers.insert(
    axum::http::header::CONTENT_DISPOSITION,
    format!("attachment; filename=\"{}\"", zip_filename)
      .parse()
      .unwrap(),
  );

  (StatusCode::OK, headers, body).into_response()
}

const MAX_CLASSIFIER_IQ_UPLOAD_BYTES: usize = 120 * 1024 * 1024;
const MAX_CLASSIFIER_ANNOTATION_UPLOAD_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct ClassifierCaptureUploadQuery {
  filename: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HuggingFaceCaptureSaveQuery {
  token: String,
  job_id: String,
  section: Option<String>,
  split: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifierCaptureUploadResponse {
  capture_id: String,
  job_id: String,
  download_url: String,
  filename: String,
  file_size: u64,
  checksum: String,
  timestamp: u64,
}

fn valid_classifier_capture_id(capture_id: &str) -> bool {
  capture_id.len() == 64
    && capture_id
      .as_bytes()
      .iter()
      .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn default_huggingface_repo_path() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .unwrap_or_else(|| Path::new("."))
    .join("n-apt-ml")
}

fn configured_huggingface_repo_path() -> Option<PathBuf> {
  let configured = std::env::var_os("N_APT_HUGGINGFACE_PATH")
    .filter(|path| !path.is_empty())
    .map(PathBuf::from)
    .unwrap_or_else(default_huggingface_repo_path);
  (configured.is_absolute()
    && configured.is_dir()
    && configured.join(".git").exists())
    .then_some(configured)
}

#[cfg(test)]
mod huggingface_path_tests {
  use super::{default_huggingface_repo_path, display_path_from_home};
  use std::path::PathBuf;

  #[test]
  fn default_dataset_path_is_a_sibling_checkout() {
    let expected = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .parent()
      .unwrap()
      .join("n-apt-ml");
    assert_eq!(default_huggingface_repo_path(), expected);
  }

  #[test]
  fn dataset_path_is_displayed_relative_to_home() {
    let home = std::env::var_os("HOME").map(PathBuf::from).expect("home directory");
    let display = display_path_from_home(&home.join("codescratch.nosync/n-apt-ml"));
    assert_eq!(display, "~/codescratch.nosync/n-apt-ml");
  }
}

fn display_path_from_home(path: &Path) -> String {
  let home = std::env::var_os("HOME").map(PathBuf::from);
  if let Some(home) = home {
    if let Ok(relative) = path.strip_prefix(home) {
      return format!("~/{}", relative.display());
    }
  }
  path.display().to_string()
}

fn valid_classifier_capture_filename(filename: &str, extension: &str) -> bool {
  let bytes = filename.as_bytes();
  !bytes.is_empty()
    && bytes.len() <= 128
    && bytes[0].is_ascii_alphanumeric()
    && filename.ends_with(extension)
    && !filename.contains("..")
    && bytes.iter().all(|byte| {
      byte.is_ascii_alphanumeric() || matches!(*byte, b'.' | b'_' | b'-')
    })
}

fn validate_classifier_iq_upload(bytes: &[u8], capture_id: &str) -> Result<(), String> {
  if !valid_classifier_capture_id(capture_id) {
    return Err("Classifier capture ID must be a lowercase SHA-256 digest".into());
  }
  let decoded = crate::server::iq_format::decode(bytes, None)
    .map_err(|error| format!("Invalid V6 I/Q capture: {error}"))?;
  if decoded.metadata.format != "iq" || decoded.metadata.format_version != 6 {
    return Err("Classifier training uploads require an unencrypted V6 I/Q capture".into());
  }
  let integrity = decoded
    .trailer
    .as_ref()
    .and_then(|trailer| trailer.get("integrity"))
    .ok_or("V6 I/Q capture has no integrity record")?;
  let digest = integrity
    .get("digest")
    .and_then(serde_json::Value::as_str)
    .ok_or("V6 I/Q capture has no integrity digest")?;
  if integrity.get("algorithm").and_then(serde_json::Value::as_str)
    != Some("SHA-256")
    || integrity.get("scope").and_then(serde_json::Value::as_str)
      != Some("file-with-integrity-digest-placeholder")
    || digest != capture_id
  {
    return Err("I/Q integrity identity does not match this classifier capture".into());
  }
  let digest_offset = bytes
    .windows(digest.len())
    .position(|window| window == digest.as_bytes())
    .ok_or("V6 I/Q integrity digest is not stamped into the capture")?;
  let mut hasher = sha2::Sha256::new();
  hasher.update(&bytes[..digest_offset]);
  hasher.update([b'0'; 64]);
  hasher.update(&bytes[digest_offset + digest.len()..]);
  let computed_digest = hasher
    .finalize()
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>();
  if computed_digest != digest {
    return Err("V6 I/Q capture checksum verification failed".into());
  }
  Ok(())
}

fn validate_classifier_annotation_upload(
  bytes: &[u8],
  capture_id: &str,
) -> Result<(), String> {
  let sidecar: serde_json::Value = serde_json::from_slice(bytes)
    .map_err(|error| format!("Invalid classifier annotation JSON: {error}"))?;
  let identity = sidecar.get("captureIdentity");
  if sidecar.get("format").and_then(serde_json::Value::as_str)
    != Some("n-apt-native-annotations-v2")
    || sidecar.get("captureId").and_then(serde_json::Value::as_str)
      != Some(capture_id)
    || identity.and_then(|value| value.get("kind")).and_then(serde_json::Value::as_str)
      != Some("v6-trailer-sha256")
    || identity.and_then(|value| value.get("algorithm")).and_then(serde_json::Value::as_str)
      != Some("SHA-256")
    || identity.and_then(|value| value.get("scope")).and_then(serde_json::Value::as_str)
      != Some("file-with-integrity-digest-placeholder")
    || identity.and_then(|value| value.get("digestHex")).and_then(serde_json::Value::as_str)
      != Some(capture_id)
  {
    return Err("Annotation sidecar identity does not match the V6 I/Q capture".into());
  }
  Ok(())
}

fn resolve_capture_download_artifacts(
  artifacts: &[crate::server::types::CaptureArtifact],
  requested_filename: Option<&str>,
) -> Result<Vec<crate::server::types::CaptureArtifact>, String> {
  match requested_filename {
    None => Ok(artifacts.to_vec()),
    Some(filename) => artifacts
      .iter()
      .find(|artifact| artifact.filename == filename)
      .cloned()
      .map(|artifact| vec![artifact])
      .ok_or_else(|| "Requested artifact is not part of this capture".into()),
  }
}

fn build_classifier_package_manifest(
  job_id: &str,
  artifacts: &[crate::server::types::CaptureArtifact],
) -> Result<Vec<u8>, String> {
  let capture_id = job_id
    .strip_prefix("classifier_")
    .filter(|capture_id| valid_classifier_capture_id(capture_id))
    .ok_or_else(|| "Classifier package job ID is invalid".to_string())?;
  let iq_artifacts: Vec<_> = artifacts
    .iter()
    .filter(|artifact| artifact.filename.ends_with(".iq"))
    .collect();
  let annotation_artifacts: Vec<_> = artifacts
    .iter()
    .filter(|artifact| artifact.filename.ends_with(".json"))
    .collect();
  if iq_artifacts.len() != 1 || annotation_artifacts.len() != 1 || artifacts.len() != 2 {
    return Err("Classifier package requires one I/Q capture and its detached labels".into());
  }
  let iq = iq_artifacts[0];
  let annotations = annotation_artifacts[0];
  if !valid_classifier_capture_filename(&iq.filename, ".iq")
    || !valid_classifier_capture_filename(&annotations.filename, ".json")
    || !valid_sha256_hex(&iq.checksum)
    || !valid_sha256_hex(&annotations.checksum)
    || !classifier_artifact_path_matches_job(iq, job_id, "iq", ".iq")
    || !classifier_artifact_path_matches_job(
      annotations,
      job_id,
      "annotations",
      ".json",
    )
  {
    return Err("Classifier package contains an invalid resource record".into());
  }

  serde_json::to_vec_pretty(&serde_json::json!({
    "$schema": "https://datapackage.org/profiles/2.0/datapackage.json",
    "name": format!("n-apt-classifier-{}", &capture_id[..12]),
    "id": capture_id,
    "title": "N-APT Classifier Capture",
    "description": "A verified V6 I/Q capture and detached human annotations.",
    "resources": [
      {
        "name": "iq-capture",
        "path": iq.filename,
        "format": "iq",
        "mediatype": "application/octet-stream",
        "bytes": iq.file_size,
        "hash": format!("sha256:{}", iq.checksum)
      },
      {
        "name": "annotations",
        "path": annotations.filename,
        "format": "json",
        "mediatype": "application/json",
        "bytes": annotations.file_size,
        "hash": format!("sha256:{}", annotations.checksum)
      }
    ],
    "napt": {
      "packageFormat": "n-apt-classifier-capture-package-v1",
      "captureId": capture_id,
      "iqFormatVersion": 6,
      "annotationFormat": "n-apt-native-annotations-v2",
      "iqIntegrity": {
        "algorithm": "SHA-256",
        "scope": "file-with-integrity-digest-placeholder",
        "digestHex": capture_id
      }
    }
  }))
  .map_err(|error| format!("Failed to serialize classifier Data Package manifest: {error}"))
}

fn append_classifier_package_manifest<W: std::io::Write + std::io::Seek>(
  zip: &mut zip::ZipWriter<W>,
  manifest: &[u8],
) -> zip::result::ZipResult<()> {
  let options: zip::write::FileOptions<()> = zip::write::FileOptions::default()
    .compression_method(zip::CompressionMethod::Stored)
    .unix_permissions(0o644);
  zip.start_file("datapackage.json", options)?;
  std::io::Write::write_all(zip, manifest)?;
  Ok(())
}

fn valid_sha256_hex(value: &str) -> bool {
  value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn classifier_artifact_path_matches_job(
  artifact: &crate::server::types::CaptureArtifact,
  job_id: &str,
  part: &str,
  extension: &str,
) -> bool {
  artifact
    .path
    .file_name()
    .and_then(|filename| filename.to_str())
    .is_some_and(|filename| {
      filename.starts_with(&format!("{job_id}-{part}-"))
        && filename.ends_with(extension)
    })
}

/// POST /api/classifier/captures/{captureId}/{part}?filename=<basename>
/// Stores verified I/Q and detached annotations in the existing capture store.
pub async fn classifier_capture_upload_handler(
  AxumPath((capture_id, part)): AxumPath<(String, String)>,
  Query(query): Query<ClassifierCaptureUploadQuery>,
  State(state): State<Arc<super::AppState>>,
  body: Bytes,
) -> impl IntoResponse {
  if !valid_classifier_capture_id(&capture_id) {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({"error": "Invalid classifier capture ID"})),
    )
      .into_response();
  }
  let (extension, max_bytes) = match part.as_str() {
    "iq" => (".iq", MAX_CLASSIFIER_IQ_UPLOAD_BYTES),
    "annotations" => (".json", MAX_CLASSIFIER_ANNOTATION_UPLOAD_BYTES),
    _ => {
      return (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({"error": "Upload part must be iq or annotations"})),
      )
        .into_response();
    }
  };
  if !valid_classifier_capture_filename(&query.filename, extension) {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({"error": "Invalid classifier artifact filename"})),
    )
      .into_response();
  }
  if body.is_empty() {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({"error": "Classifier upload is empty"})),
    )
      .into_response();
  }
  if body.len() > max_bytes {
    return (
      StatusCode::PAYLOAD_TOO_LARGE,
      Json(serde_json::json!({"error": "Classifier upload exceeds its size limit"})),
    )
      .into_response();
  }
  let validation = match part.as_str() {
    "iq" => validate_classifier_iq_upload(&body, &capture_id),
    "annotations" => validate_classifier_annotation_upload(&body, &capture_id),
    _ => unreachable!("part was validated"),
  };
  if let Err(error) = validation {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({"error": error})),
    )
      .into_response();
  }

  let job_id = format!("classifier_{capture_id}");
  let artifact_key = format!("artifacts:{job_id}");
  let mut artifacts: Vec<crate::server::types::CaptureArtifact> =
    match state.shared.redis_store.get_json(1, &artifact_key).await {
      Ok(Some(artifacts)) => artifacts,
      Ok(None) => match crate::capture::storage::read_job_manifest(&job_id) {
        Ok(Some(artifacts)) => artifacts,
        Ok(None) => Vec::new(),
        Err(error) => {
          error!("Failed to load classifier recovery manifest: {error}");
          return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
            "error": "Classifier artifact storage is unavailable"
          }))).into_response();
        }
      },
      Err(error) => {
        error!("Failed to load classifier artifact metadata from Redis: {error}");
        match crate::capture::storage::read_job_manifest(&job_id) {
          Ok(Some(artifacts)) => artifacts,
          Ok(None) => return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
            "error": "Classifier artifact storage is unavailable"
          }))).into_response(),
          Err(manifest_error) => {
            error!("Failed to load classifier recovery manifest: {manifest_error}");
            return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
              "error": "Classifier artifact storage is unavailable"
            }))).into_response();
          }
        }
      }
    };
  artifacts = match crate::capture::storage::recover_artifact_paths(&artifacts) {
    Ok(artifacts) => artifacts,
    Err(error) => {
      error!("Classifier metadata points to unavailable artifact copies: {error}");
      return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
        "error": "Classifier capture copies are unavailable"
      }))).into_response();
    }
  };
  if part == "annotations"
    && !artifacts.iter().any(|artifact| artifact.filename.ends_with(".iq"))
  {
    return (
      StatusCode::CONFLICT,
      Json(serde_json::json!({"error": "Upload the verified I/Q capture before its labels"})),
    )
      .into_response();
  }

  let checksum = sha2::Sha256::digest(&body)
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>();
  let capture_dir = crate::capture::storage::capture_storage_dir();
  if let Err(error) = tokio::fs::create_dir_all(&capture_dir).await {
    error!("Failed to create classifier capture directory: {error}");
    return (
      StatusCode::INTERNAL_SERVER_ERROR,
      Json(serde_json::json!({"error": "Classifier capture storage is unavailable"})),
    )
      .into_response();
  }
  let path = capture_dir.join(format!("{job_id}-{part}-{checksum}{extension}"));
  let nonce = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|duration| duration.as_nanos())
    .unwrap_or(0);
  let temporary_path = capture_dir.join(format!(".{job_id}-{part}-{nonce}.tmp"));
  // codeql[rust/path-injection] job_id is a validated SHA-256 hex digest, part is an enum, and nonce is generated locally.
  if let Err(error) = tokio::fs::write(&temporary_path, &body).await {
    error!("Failed to stage classifier artifact: {error}");
    return (
      StatusCode::INTERNAL_SERVER_ERROR,
      Json(serde_json::json!({"error": "Failed to persist classifier artifact"})),
    )
      .into_response();
  }
  // codeql[rust/path-injection] These paths use the validated capture ID, enum part, computed checksum, and fixed extension.
  if let Err(error) = tokio::fs::rename(&temporary_path, &path).await {
    // codeql[rust/path-injection] temporary_path was built from the same validated capture ID, enum part, and local nonce.
    let _ = tokio::fs::remove_file(&temporary_path).await;
    error!("Failed to finalize classifier artifact: {error}");
    return (
      StatusCode::INTERNAL_SERVER_ERROR,
      Json(serde_json::json!({"error": "Failed to persist classifier artifact"})),
    )
      .into_response();
  }
  if let Err(error) = crate::capture::storage::replicate_capture_file(&path, &query.filename) {
    error!("Failed to create classifier capture copies: {error}");
    return (
      StatusCode::INSUFFICIENT_STORAGE,
      Json(serde_json::json!({"error": "Failed to create durable classifier capture copies"})),
    ).into_response();
  }
  let file_size = body.len() as u64;
  let artifact = crate::server::types::CaptureArtifact {
    filename: query.filename.clone(),
    path: path.clone(),
    file_size,
    checksum: checksum.clone(),
  };
  let old_paths: Vec<PathBuf> = artifacts
    .iter()
    .filter(|existing| existing.filename.ends_with(extension))
    .map(|existing| existing.path.clone())
    .collect();
  artifacts.retain(|existing| !existing.filename.ends_with(extension));
  artifacts.push(artifact);
  if let Err(error) = crate::capture::storage::write_job_manifest(&job_id, &artifacts) {
    error!("Failed to persist classifier capture recovery manifest: {error}");
    return (
      StatusCode::INSUFFICIENT_STORAGE,
      Json(serde_json::json!({"error": "Failed to persist classifier capture index"})),
    ).into_response();
  }
  if let Err(error) = state
    .shared
    .redis_store
    .set_json(1, &artifact_key, &artifacts)
    .await
  {
    error!("Failed to register classifier artifacts in Redis: {error}");
    if !old_paths.iter().any(|old_path| old_path == &path) {
      // codeql[rust/path-injection] path is the server-generated destination built from validated upload components.
      let _ = tokio::fs::remove_file(&path).await;
    }
    return (
      StatusCode::SERVICE_UNAVAILABLE,
      Json(serde_json::json!({"error": "Classifier artifact registry is unavailable"})),
    )
      .into_response();
  }
  for old_path in old_paths {
    if old_path != path {
      let _ = tokio::fs::remove_file(old_path).await;
    }
  }

  let timestamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0);
  Json(ClassifierCaptureUploadResponse {
    capture_id,
    job_id: job_id.clone(),
    download_url: format!("/api/capture/download?jobId={job_id}&artifact={}", query.filename),
    filename: query.filename,
    file_size,
    checksum,
    timestamp,
  })
  .into_response()
}

/// GET /api/capture/destinations?token=<session_token>
/// Reports which locally configured destinations can accept a capture.
pub async fn capture_destinations_handler(
  Query(params): Query<super::types::CaptureDestinationParams>,
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  if state.session_store.validate(&params.token).await.is_none() {
    return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
      "error": "Invalid or expired session token"
    }))).into_response();
  }
  let aspect_available = std::env::var_os("N_APT_ASPECT_PATH")
    .filter(|path| !path.is_empty())
    .map(PathBuf::from)
    .is_some_and(|path| path.is_absolute() && path.is_dir());
  let huggingface_available = configured_huggingface_repo_path().is_some();
  let huggingface_path = configured_huggingface_repo_path()
    .as_deref()
    .map(display_path_from_home);
  Json(serde_json::json!({
    "destinations": [
      { "id": "local", "available": true },
      { "id": "aspect", "available": aspect_available },
      { "id": "huggingface", "available": huggingface_available, "path": huggingface_path }
    ]
  }))
  .into_response()
}

/// POST /api/capture/save/huggingface?token=&jobId=&section=&split=
/// Encrypts completed capture artifacts before placing them in the local dataset checkout.
pub async fn save_capture_to_huggingface_handler(
  Query(params): Query<HuggingFaceCaptureSaveQuery>,
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  if !crate::server::utils::RE_SAFE_ID.is_match(&params.job_id) {
    return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Invalid job_id" }))).into_response();
  }
  if state.session_store.validate(&params.token).await.is_none() {
    return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
      "error": "Invalid or expired session token"
    }))).into_response();
  }
  let repo_path = match configured_huggingface_repo_path() {
    Some(path) => path,
    _ => return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
      "error": "Hugging Face dataset checkout is unavailable; set N_APT_HUGGINGFACE_PATH"
    }))).into_response(),
  };
  let section = params.section.as_deref().unwrap_or("evidentiary");
  let relative_directory = match section {
    "evidentiary" => PathBuf::from("training-captures/evidentiary/captures"),
    "demod" => PathBuf::from("training-captures/demod"),
    "classification" => {
      let split = match params.split.as_deref() {
        Some("train") => "train",
        Some("validation") => "validation",
        Some("test") => "test",
        _ => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
          "error": "Classification captures require an explicit train, validation, or test split"
        }))).into_response(),
      };
      PathBuf::from("training-captures/classification").join(split)
    }
    _ => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
      "error": "section must be evidentiary, demod, or classification"
    }))).into_response(),
  };
  let artifact_key = format!("artifacts:{}", params.job_id);
  let artifacts = match state.shared.redis_store.get_json::<Vec<crate::server::types::CaptureArtifact>>(1, &artifact_key).await {
    Ok(Some(artifacts)) if !artifacts.is_empty() => artifacts,
    Ok(_) => match crate::capture::storage::read_job_manifest(&params.job_id) {
      Ok(Some(artifacts)) if !artifacts.is_empty() => artifacts,
      _ => return (StatusCode::NOT_FOUND, Json(serde_json::json!({
        "error": "Capture job not found or not completed"
      }))).into_response(),
    },
    Err(error) => {
      error!("Failed to load capture artifacts for Hugging Face save: {error}");
      match crate::capture::storage::read_job_manifest(&params.job_id) {
        Ok(Some(artifacts)) if !artifacts.is_empty() => artifacts,
        _ => return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
          "error": "Capture metadata is unavailable"
        }))).into_response(),
      }
    }
  };
  let artifacts = match crate::capture::storage::recover_artifact_paths(&artifacts) {
    Ok(artifacts) => artifacts,
    Err(error) => {
      error!("Hugging Face metadata points to unavailable capture copies: {error}");
      return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
        "error": "Capture copies are unavailable"
      }))).into_response();
    }
  };
  let protection_key = format!("capture-protection:{}", params.job_id);
  let salt = match get_or_create_capture_salt(&state, &protection_key).await {
    Ok(salt) => salt,
    Err(error) => {
      error!("Failed to load capture protection salt: {error}");
      return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
        "error": "Capture protection metadata is unavailable"
      }))).into_response();
    }
  };
  let mut saved = Vec::new();
  for artifact in &artifacts {
    let relative_directory = if section == "demod" {
      if artifact.filename.ends_with(".wav") {
        relative_directory.join("audio")
      } else {
        relative_directory.join("reference_captures")
      }
    } else {
      relative_directory.clone()
    };
    let directory = repo_path.join(&relative_directory);
    if let Err(error) = tokio::fs::create_dir_all(&directory).await {
      return (StatusCode::INSUFFICIENT_STORAGE, Json(serde_json::json!({
        "error": format!("Failed to create dataset folder: {error}")
      }))).into_response();
    }
    match write_protected_capture_artifacts_to_directory(
      std::slice::from_ref(artifact),
      &directory,
      &state.shared.encryption_key,
      &salt,
    ).await {
      Ok(paths) => saved.extend(paths.iter().map(|path| {
        path.strip_prefix(&repo_path).unwrap_or(path).to_string_lossy().to_string()
      })),
      Err(error) => {
        return (StatusCode::INSUFFICIENT_STORAGE, Json(serde_json::json!({
          "error": format!("Failed to save encrypted capture to the dataset checkout: {error}")
        }))).into_response();
      }
    }
  }
  if section == "classification" {
    let labels_path = repo_path.join("training-captures/classification/labels.csv");
    if let Err(error) = append_classifier_label_to_csv(&labels_path, &params, &artifacts).await {
      error!("Failed to update classification labels.csv: {error}");
      return (StatusCode::INSUFFICIENT_STORAGE, Json(serde_json::json!({
        "error": "Encrypted capture saved, but classification labels.csv could not be updated"
      }))).into_response();
    }
  } else {
    let metadata_directory = if section == "demod" {
      repo_path.join("training-captures/demod/metadata")
    } else {
      repo_path.join("training-captures/evidentiary/manifests")
    };
    if let Err(error) = tokio::fs::create_dir_all(&metadata_directory).await {
      return (StatusCode::INSUFFICIENT_STORAGE, Json(serde_json::json!({
        "error": format!("Failed to create dataset metadata folder: {error}")
      }))).into_response();
    }
    let manifest = serde_json::json!({
      "format": "n-apt-protected-capture-v1",
      "jobId": params.job_id,
      "section": section,
      "files": saved,
      "increasedProtection": true,
      "saltKey": protection_key
    });
    let manifest_bytes = match serde_json::to_vec_pretty(&manifest) {
      Ok(bytes) => bytes,
      Err(error) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
        "error": format!("Failed to encode dataset manifest: {error}")
      }))).into_response(),
    };
    let manifest_path = metadata_directory.join(format!("{}.json", params.job_id));
    let temporary_path = manifest_path.with_extension("json.tmp");
    // codeql[rust/path-injection] params.job_id was validated against RE_SAFE_ID before it is used in this path.
    if let Err(error) = tokio::fs::write(&temporary_path, manifest_bytes).await {
      return (StatusCode::INSUFFICIENT_STORAGE, Json(serde_json::json!({
        "error": format!("Failed to write dataset manifest: {error}")
      }))).into_response();
    }
    // codeql[rust/path-injection] Both paths share the fixed metadata directory and the validated job ID.
    if let Err(error) = tokio::fs::rename(&temporary_path, &manifest_path).await {
      // codeql[rust/path-injection] temporary_path was derived from the validated manifest_path.
      let _ = tokio::fs::remove_file(&temporary_path).await;
      return (StatusCode::INSUFFICIENT_STORAGE, Json(serde_json::json!({
        "error": format!("Failed to persist dataset manifest: {error}")
      }))).into_response();
    }
  }
  Json(serde_json::json!({
    "destination": "huggingface",
    "section": section,
    "split": params.split,
    "increasedProtection": true,
    "files": saved
  })).into_response()
}

fn csv_cell(value: &str) -> String {
  format!("\"{}\"", value.replace('"', "\"\""))
}

async fn append_classifier_label_to_csv(
  labels_path: &Path,
  params: &HuggingFaceCaptureSaveQuery,
  artifacts: &[crate::server::types::CaptureArtifact],
) -> std::io::Result<()> {
  let annotation_artifact = artifacts
    .iter()
    .find(|artifact| artifact.filename.ends_with(".json"))
    .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "classifier annotation artifact is missing"))?;
  let sidecar_bytes = tokio::fs::read(&annotation_artifact.path).await?;
  let sidecar: serde_json::Value = serde_json::from_slice(&sidecar_bytes)
    .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()))?;
  let annotations = sidecar.get("annotations").ok_or_else(|| {
    std::io::Error::new(std::io::ErrorKind::InvalidData, "classifier labels are missing")
  })?;
  let values = [
    params.job_id.strip_prefix("classifier_").unwrap_or(&params.job_id).to_string(),
    params.split.clone().unwrap_or_default(),
    annotations.get("label").and_then(serde_json::Value::as_str).unwrap_or("uncertain").to_string(),
    annotations.get("channel").and_then(serde_json::Value::as_str).unwrap_or("unspecified").to_string(),
    annotations.get("features").and_then(serde_json::Value::as_array).map(|items| items.iter().filter_map(serde_json::Value::as_str).collect::<Vec<_>>().join(";" )).unwrap_or_default(),
    annotations.get("tags").and_then(serde_json::Value::as_array).map(|items| items.iter().filter_map(serde_json::Value::as_str).collect::<Vec<_>>().join(";" )).unwrap_or_default(),
    artifacts.iter().find(|artifact| artifact.filename.ends_with(".iq")).map(|artifact| format!("{}.enc", artifact.filename)).unwrap_or_default(),
  ];
  let row = values.iter().map(|value| csv_cell(value)).collect::<Vec<_>>().join(",");
  let header = "capture_id,split,label,channel,features,tags,capture_file\n";
  let existing = match tokio::fs::read_to_string(labels_path).await {
    Ok(existing) => existing,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
    Err(error) => return Err(error),
  };
  let capture_prefix = format!("\"{}\",", values[0]);
  if existing.lines().any(|line| line.starts_with(&capture_prefix)) {
    return Ok(());
  }
  let contents = if existing.is_empty() {
    format!("{header}{row}\n")
  } else {
    format!("{existing}{}{row}\n", if existing.ends_with('\n') { "" } else { "\n" })
  };
  let parent = labels_path.parent().ok_or_else(|| {
    std::io::Error::new(std::io::ErrorKind::InvalidInput, "labels.csv has no parent")
  })?;
  tokio::fs::create_dir_all(parent).await?;
  let nonce = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|duration| duration.as_nanos())
    .unwrap_or(0);
  let temp = parent.join(format!(".labels-{}-{nonce}.tmp", std::process::id()));
  tokio::fs::write(&temp, contents).await?;
  if let Err(error) = tokio::fs::rename(&temp, labels_path).await {
    let _ = tokio::fs::remove_file(&temp).await;
    return Err(error);
  }
  Ok(())
}

/// POST /api/capture/save/aspect?token=<session_token>&jobId=<job_id>
/// Copies completed capture artifacts to the configured Aspect mount.
pub async fn save_capture_to_aspect_handler(
  Query(params): Query<CaptureDownloadParams>,
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  if !crate::server::utils::RE_SAFE_ID.is_match(&params.job_id) {
    return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
      "error": "Invalid job_id"
    }))).into_response();
  }
  if let Err(error) = params.validate() {
    return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
      "error": format!("Validation failed: {error}")
    }))).into_response();
  }
  if state.session_store.validate(&params.token).await.is_none() {
    return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
      "error": "Invalid or expired session token"
    }))).into_response();
  }
  let aspect_path = match std::env::var_os("N_APT_ASPECT_PATH")
    .filter(|path| !path.is_empty())
  {
    Some(path) => PathBuf::from(path),
    None => return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
      "error": "Aspect destination is not configured; set N_APT_ASPECT_PATH in the backend environment"
    }))).into_response(),
  };
  if !aspect_path.is_absolute() || !aspect_path.is_dir() {
    return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
      "error": "Aspect mount folder is unavailable; N_APT_ASPECT_PATH must be an existing absolute directory"
    }))).into_response();
  }

  let key = format!("artifacts:{}", params.job_id);
  let artifacts: Vec<crate::server::types::CaptureArtifact> = match state
    .shared
    .redis_store
    .get_json::<Vec<crate::server::types::CaptureArtifact>>(1, &key)
    .await
  {
    Ok(Some(artifacts)) if !artifacts.is_empty() => artifacts,
    Ok(_) => match crate::capture::storage::read_job_manifest(&params.job_id) {
      Ok(Some(artifacts)) if !artifacts.is_empty() => artifacts,
      _ => return (StatusCode::NOT_FOUND, Json(serde_json::json!({
        "error": "Capture job not found or not completed"
      }))).into_response(),
    },
    Err(error) => {
      error!("Failed to load capture artifacts for Aspect save: {error}");
      match crate::capture::storage::read_job_manifest(&params.job_id) {
        Ok(Some(artifacts)) if !artifacts.is_empty() => artifacts,
        _ => return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
          "error": "Capture metadata is temporarily unavailable"
        }))).into_response(),
      }
    }
  };
  let artifacts = match crate::capture::storage::recover_artifact_paths(&artifacts) {
    Ok(artifacts) => artifacts,
    Err(error) => {
      error!("Aspect metadata points to unavailable capture copies: {error}");
      return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
        "error": "Capture copies are unavailable"
      }))).into_response();
    }
  };
  let protection_key = format!("capture-protection:{}", params.job_id);
  let salt = match get_or_create_capture_salt(&state, &protection_key).await {
    Ok(salt) => salt,
    Err(error) => {
      error!("Failed to load capture protection salt: {error}");
      return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
        "error": "Capture protection metadata is unavailable"
      }))).into_response();
    }
  };
  match write_protected_capture_artifacts_to_directory(
    &artifacts,
    &aspect_path,
    &state.shared.encryption_key,
    &salt,
  )
  .await
  {
    Ok(saved) => Json(serde_json::json!({
      "destination": "aspect",
      "increasedProtection": true,
      "files": saved.iter().filter_map(|path| path.file_name()).map(|name| name.to_string_lossy()).collect::<Vec<_>>()
    })).into_response(),
    Err(error) => {
      error!("Failed to save capture to Aspect mount: {error}");
      (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
        "error": format!("Failed to save capture to Aspect: {error}")
      }))).into_response()
    }
  }
}

fn encode_capture_salt(salt: &[u8; 32]) -> String {
  salt.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_capture_salt(encoded: &str) -> Option<[u8; 32]> {
  // Earlier Rust builds stored this JSON string quoted; Node tools and the
  // current Redis contract use the raw 64-character hex value.
  let legacy_encoded = serde_json::from_str::<String>(encoded).ok();
  let encoded = legacy_encoded.as_deref().unwrap_or(encoded);
  if encoded.len() != 64 {
    return None;
  }
  let mut salt = [0u8; 32];
  for (index, pair) in encoded.as_bytes().chunks_exact(2).enumerate() {
    let high = (pair[0] as char).to_digit(16)? as u8;
    let low = (pair[1] as char).to_digit(16)? as u8;
    salt[index] = (high << 4) | low;
  }
  Some(salt)
}

async fn get_or_create_capture_salt(
  state: &super::AppState,
  key: &str,
) -> Result<[u8; 32], String> {
  match state.shared.redis_store.get_string(1, key).await? {
    Some(encoded) => decode_capture_salt(&encoded)
      .ok_or_else(|| "stored capture protection salt is invalid".to_string()),
    None => {
      let salt = crate::crypto::generate_capture_salt();
      if state
        .shared
        .redis_store
        .set_string_if_absent(1, key, &encode_capture_salt(&salt))
        .await?
      {
        return Ok(salt);
      }

      state
        .shared
        .redis_store
        .get_string(1, key)
        .await?
        .and_then(|encoded| decode_capture_salt(&encoded))
        .ok_or_else(|| {
          "capture protection salt was not persisted by the winning writer"
            .to_string()
        })
    }
  }
}

async fn write_protected_capture_artifacts_to_directory(
  artifacts: &[crate::server::types::CaptureArtifact],
  destination: &Path,
  vault_key: &[u8; 32],
  salt: &[u8; 32],
) -> std::io::Result<Vec<PathBuf>> {
  if !tokio::fs::metadata(destination).await?.is_dir() {
    return Err(std::io::Error::new(
      std::io::ErrorKind::NotFound,
      "destination is not an available directory",
    ));
  }
  let mut saved = Vec::with_capacity(artifacts.len());
  for artifact in artifacts {
    let filename = Path::new(&artifact.filename);
    if artifact.filename.is_empty()
      || artifact.filename.contains(['/', '\\'])
      || filename.components().count() != 1
      || !matches!(filename.components().next(), Some(Component::Normal(_)))
    {
      return Err(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "capture artifact contains an unsafe filename",
      ));
    }
    let target = destination.join(format!("{}.enc", artifact.filename));
    let result = async {
      let bytes = tokio::fs::read(&artifact.path).await?;
      if !artifact.checksum.is_empty() {
        let checksum = sha2::Sha256::digest(&bytes)
          .iter()
          .map(|byte| format!("{byte:02x}"))
          .collect::<String>();
        if checksum != artifact.checksum {
          return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "capture checksum verification failed before encryption",
          ));
        }
      }
      if tokio::fs::try_exists(&target).await? {
        let existing = tokio::fs::read(&target).await?;
        let decrypted = crate::crypto::decrypt_capture_envelope_with_salt(vault_key, &existing, salt)
          .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()))?;
        return if decrypted == bytes {
          Ok(())
        } else {
          Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "encrypted capture destination contains different data",
          ))
        };
      }
      let encrypted = crate::crypto::encrypt_capture_envelope_with_salt(vault_key, &bytes, salt)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()))?;
      let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
      let temporary = target.with_extension(format!("enc-{nonce}.tmp"));
      let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .await?;
      tokio::io::AsyncWriteExt::write_all(&mut output, &encrypted).await?;
      tokio::io::AsyncWriteExt::flush(&mut output).await?;
      output.sync_all().await?;
      drop(output);
      if let Err(error) = tokio::fs::rename(&temporary, &target).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error);
      }
      Ok::<(), std::io::Error>(())
    }
    .await;
    if let Err(error) = result {
      for saved_path in &saved {
        let _ = tokio::fs::remove_file(saved_path).await;
      }
      return Err(error);
    }
    saved.push(target);
  }
  Ok(saved)
}

#[cfg(test)]
async fn copy_capture_artifacts_to_directory(
  artifacts: &[crate::server::types::CaptureArtifact],
  destination: &Path,
) -> std::io::Result<Vec<PathBuf>> {
  if !tokio::fs::metadata(destination).await?.is_dir() {
    return Err(std::io::Error::new(
      std::io::ErrorKind::NotFound,
      "destination is not an available directory",
    ));
  }
  let mut targets = Vec::with_capacity(artifacts.len());
  for artifact in artifacts {
    let filename = Path::new(&artifact.filename);
    if artifact.filename.is_empty()
      || artifact.filename.contains(['/', '\\'])
      || filename.components().count() != 1
      || !matches!(filename.components().next(), Some(Component::Normal(_)))
    {
      return Err(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "capture artifact contains an unsafe filename",
      ));
    }
    targets.push(destination.join(filename));
  }

  let mut saved = Vec::with_capacity(artifacts.len());
  for (artifact, target) in artifacts.iter().zip(targets) {
    let mut output = match tokio::fs::OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&target)
      .await
    {
      Ok(output) => output,
      Err(error) => {
        for saved_path in &saved {
          let _ = tokio::fs::remove_file(saved_path).await;
        }
        return Err(error);
      }
    };
    let mut source = match tokio::fs::File::open(&artifact.path).await {
      Ok(source) => source,
      Err(error) => {
        drop(output);
        let _ = tokio::fs::remove_file(&target).await;
        for saved_path in &saved {
          let _ = tokio::fs::remove_file(saved_path).await;
        }
        return Err(error);
      }
    };
    if let Err(error) = tokio::io::copy(&mut source, &mut output).await {
      drop(output);
      let _ = tokio::fs::remove_file(&target).await;
      for saved_path in &saved {
        let _ = tokio::fs::remove_file(saved_path).await;
      }
      return Err(error);
    }
    if let Err(error) = tokio::io::AsyncWriteExt::flush(&mut output).await {
      drop(output);
      let _ = tokio::fs::remove_file(&target).await;
      for saved_path in &saved {
        let _ = tokio::fs::remove_file(saved_path).await;
      }
      return Err(error);
    }
    saved.push(target);
  }
  Ok(saved)
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
      "supported": ["rtl-sdr", "hackrf_one", "mock_apt"],
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
  let _ = reconcile_stale_device_snapshot(shared);

  let device_connected = shared.device_connected.load(Ordering::Relaxed);
  let client_count = shared.client_count.load(Ordering::Relaxed);
  let authenticated_count = shared.authenticated_count.load(Ordering::Relaxed);
  let is_paused = shared.is_paused.load(Ordering::Relaxed);
  let center_freq_hz = shared.pending_center_freq.load(Ordering::Relaxed);
  let device_info = shared.device_info.lock().unwrap().clone();
  let device_profile = shared.device_profile.lock().unwrap().clone();
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
  let device_backend = crate::server::utils::status_device_backend_label(
    device_connected,
    &device_info,
    &device_profile,
  );

  let status = serde_json::json!({
    "device": {
      "connected": device_connected,
      "type": device_backend,
      "info": device_info,
      "state": device_state,
      "loading": device_loading,
      "loading_reason": device_loading_reason
    },
    "capture": {
      "is_paused": is_paused,
      "active_clients": client_count,
      "authenticated_clients": authenticated_count,
      "redis_metadata_active": true
    },
    "signals": {
      "center_frequency_hz": center_freq_hz as f64,
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
  if let Err(e) = tool_request.validate() {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({
        "error": "Validation failed",
        "details": format!("{}", e)
      })),
    )
      .into_response();
  }

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
    "getDeviceStatus" => handle_get_device_status(&state).await,
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

  Json(result).into_response()
}

async fn handle_get_device_status(
  state: &Arc<super::AppState>,
) -> WebMCPToolResponse {
  let status = build_source_info_snapshot(&state.shared);
  WebMCPToolResponse {
    success: true,
    result: Some(
      serde_json::to_value(status).unwrap_or_else(|_| serde_json::json!({})),
    ),
    error: None,
    tool: "getDeviceStatus".to_string(),
  }
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

  let _sum_product = Complex::new(0.0f32, 0.0f32);
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
    let detrend_rot =
      Complex::new(0.0, -phase_slope_per_bin * (i as f32)).exp();
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
  let shift_at_dominant =
    base_phase_offset + phase_slope_per_bin * (dominant_bin as f32);

  // Wrap to [-180, 180] strictly
  // Use rem_euclid to restrict strictly to [0, 360) first
  let mut correction_angle_deg =
    shift_at_dominant.to_degrees().rem_euclid(360.0);

  if correction_angle_deg > 180.0 {
    correction_angle_deg -= 360.0;
  }

  (
    correction_angle_deg,
    dominant_phase1.to_degrees(),
    dominant_phase2.to_degrees(),
    fm_deviation_khz,
  )
}

pub async fn stitch_diagnostic_handler(
  State(state): State<Arc<super::main::AppState>>,
  body: Option<Json<StitchDiagnosticRequest>>,
) -> impl IntoResponse {
  let start_time = Instant::now();
  info!("Stitch diagnostic requested (multi-frame)");

  // The capture loop performs blocking hardware I/O; run it on the blocking
  // pool so an async worker thread is never pinned for the whole diagnostic.
  let result = tokio::task::spawn_blocking(move || {
    stitch_diagnostic_blocking(state, body, start_time)
  })
  .await;
  match result {
    Ok(response) => response,
    Err(e) => (
      StatusCode::INTERNAL_SERVER_ERROR,
      format!("Stitch diagnostic task failed: {}", e),
    )
      .into_response(),
  }
}

fn stitch_diagnostic_blocking(
  state: Arc<super::main::AppState>,
  body: Option<Json<StitchDiagnosticRequest>>,
  start_time: Instant,
) -> axum::response::Response {
  let mut processor = state.sdr_processor.blocking_lock();

  // Apply FFT size if requested before any processing
  if let Some(requested_fft_size) = body.as_ref().and_then(|b| b.fft_size) {
    log::info!(
      "Stitch diagnostic requested FFT size: {}",
      requested_fft_size
    );
    if let Err(e) =
      processor.apply_settings(crate::server::types::SdrProcessorSettings {
        fft_size: Some(requested_fft_size),
        ..Default::default()
      })
    {
      warn!(
        "Failed to apply requested FFT size {}: {}",
        requested_fft_size, e
      );
    }
  }

  let center_hz_override = body.as_ref().and_then(|b| b.center_hz);
  let signal_area_override = body.as_ref().and_then(|b| b.signal_area.clone());

  // Determine the primary center frequency for Hop 1.
  // We prioritize anchoring to the start of the active signal area if provided.
  let mut effective_center1 = center_hz_override;
  if let Some(label) = signal_area_override {
    let channels = state.shared.channels.lock().unwrap().clone();
    if let Some(ch) = channels
      .iter()
      .find(|c| c.label.to_uppercase() == label.to_uppercase())
    {
      // Anchor center1 so that the hardware capture starts exactly at the channel's min_hz
      // center = min + (sample_rate / 2)
      let sr_hz = processor.get_sample_rate() as f64;
      let anchored_hz = (ch.min_hz + (sr_hz / 2.0)) as u32;
      info!(
        "Anchoring diagnostic center1 to {} Hz for area {}",
        anchored_hz, label
      );
      effective_center1 = Some(anchored_hz as f64);
    }
  }

  log::info!("Starting multi-frame stitch diagnostic...");

  let was_paused = state.shared.is_paused.load(Ordering::Relaxed);
  let original_center_hz = processor.get_center_frequency();
  let (center1, hop_bw_hz, sample_rate, device_info) = {
    // Pause during diagnostic to avoid hardware contention
    state.shared.is_paused.store(true, Ordering::Relaxed);

    // Honor channel selection from the sidebar
    if let Some(center_hz) = effective_center1 {
      let chz_u32 = center_hz as u32;
      if chz_u32 != processor.get_center_frequency() {
        if let Err(e) = processor.set_center_frequency(chz_u32) {
          warn!("Failed to apply center_hz override: {}", e);
        } else {
          processor.flush_read_queue();
        }
      }
    }

    let sample_rate = processor.get_sample_rate() as f64;
    (
      processor.get_center_frequency(),
      sample_rate,
      sample_rate,
      processor.get_device_info(),
    )
  };

  let num_frames_to_average = body
    .as_ref()
    .and_then(|b| b.frames_to_average)
    .map(|f| f as usize)
    .unwrap_or(10)
    .max(1);
  let num_frames = num_frames_to_average;
  let mut hop1_frames = Vec::with_capacity(num_frames);
  let mut hop2_frames = Vec::with_capacity(num_frames);
  let mut hop1_raw_iq = Vec::new();
  let mut hop2_raw_iq = Vec::new();

  let options = body
    .as_ref()
    .and_then(|b| b.stitch_options.clone())
    .unwrap_or(StitchOptions {
      phase_correction: true,
      fm_deviation_correction: true,
      anti_aliasing: true,
      noise_floor_matching: true,
      crossfading: true,
      chinese_remainder_synthesis: false,
      js_anti_aliasing: false,
      js_noise_floor_matching: false,
      acquisition_mode: Some("interleaved".to_string()),
    });

  let acq_mode = options
    .acquisition_mode
    .clone()
    .unwrap_or_else(|| "interleaved".to_string());

  let center2 = center1 + 1_200_000;
  let capture_result: Result<(), axum::response::Response> = 'capture: {
    if acq_mode == "interleaved" {
    log::info!("Performing INTERLEAVED capture (rapid hopping)...");
    for i in 0..num_frames {
      // Frame for Hop 1
      if let Err(e) = processor.set_center_frequency(center1) {
        break 'capture Err(
          (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to tune to hop 1: {}", e),
          )
            .into_response(),
        );
      }
      processor.flush_read_queue();
      match processor.read_and_process_frame() {
        Ok(f) => {
          hop1_raw_iq.extend_from_slice(&processor.frame.last_frame_raw_iq);
          hop1_frames.push(f);
        }
        Err(e) => {
          break 'capture Err(
            (
              StatusCode::INTERNAL_SERVER_ERROR,
              format!("Failed to capture hop 1 at index {}: {}", i, e),
            )
              .into_response(),
          );
        }
      }

      // Frame for Hop 2
      if let Err(e) = processor.set_center_frequency(center2) {
        break 'capture Err(
          (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to tune to hop 2: {}", e),
          )
            .into_response(),
        );
      }
      processor.flush_read_queue();
      match processor.read_and_process_frame() {
        Ok(f) => {
          hop2_raw_iq.extend_from_slice(&processor.frame.last_frame_raw_iq);
          hop2_frames.push(f);
        }
        Err(e) => {
          break 'capture Err(
            (
              StatusCode::INTERNAL_SERVER_ERROR,
              format!("Failed to capture hop 2 at index {}: {}", i, e),
            )
              .into_response(),
          );
        }
      }
    }
    } else {
    log::info!("Performing STEPWISE capture (block-wise)...");
    // 1. Capture Hop 1 Block
    {
      if let Err(e) = processor.set_center_frequency(center1) {
        break 'capture Err(
          (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to tune to hop 1: {}", e),
          )
            .into_response(),
        );
      }
      processor.flush_read_queue();
      for _ in 0..num_frames {
        match processor.read_and_process_frame() {
          Ok(f) => {
            hop1_raw_iq.extend_from_slice(&processor.frame.last_frame_raw_iq);
            hop1_frames.push(f);
          }
          Err(e) => {
            break 'capture Err(
              (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to capture hop 1: {}", e),
              )
                .into_response(),
            );
          }
        }
      }
    }

    // 2. Capture Hop 2 Block
    {
      if let Err(e) = processor.set_center_frequency(center2) {
        break 'capture Err(
          (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to tune to hop 2: {}", e),
          )
            .into_response(),
        );
      }
      processor.flush_read_queue();
      for _ in 0..num_frames {
        match processor.read_and_process_frame() {
          Ok(f) => {
            hop2_raw_iq.extend_from_slice(&processor.frame.last_frame_raw_iq);
            hop2_frames.push(f);
          }
          Err(e) => {
            break 'capture Err(
              (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to capture hop 2: {}", e),
              )
                .into_response(),
            );
          }
        }
      }
    }
    }
    Ok(())
  };

  // Restore the previous pause state and tuned frequency regardless of
  // whether the capture completed or aborted mid-way.
  state.shared.is_paused.store(was_paused, Ordering::Relaxed);
  if processor.get_center_frequency() != original_center_hz {
    if let Err(e) = processor.set_center_frequency(original_center_hz) {
      warn!(
        "Failed to restore diagnostic center frequency {}: {}",
        original_center_hz, e
      );
    } else {
      processor.flush_read_queue();
    }
  }
  if let Err(response) = capture_result {
    return response;
  }

  // Compute phase coherence / alignment offset in the overlap region
  log::info!("Calculating phase offset and stitching...");
  let (correction_angle_deg, hop1_phase_deg, hop2_phase_deg, fm_deviation_khz) =
    if options.phase_correction || options.fm_deviation_correction {
    calculate_overlap_phase_offset(&mut processor, &hop1_raw_iq, &hop2_raw_iq)
  } else {
    (0.0, 0.0, 0.0, 0.0)
  };

  // 4. Seamless Crossfade Stitching
  let jump_hz = (center2 - center1) as f64;
  let fft_size = if !hop1_frames.is_empty() {
    hop1_frames[0].len()
  } else {
    1024
  };

  // Calculate dynamic overlap bounds based strictly on the center frequency jump
  let offset_bins =
    ((fft_size as f64) * (jump_hz / hop_bw_hz)).round() as usize;
  let overlap_bins = fft_size.saturating_sub(offset_bins);

  // 4. Stitching with Options
  let mut stitched_frames = Vec::with_capacity(num_frames);
  let midpoint_bin = overlap_bins / 2;

  for i in 0..num_frames {
    let mut f1 = hop1_frames[i].clone();
    let mut f2 = hop2_frames[i].clone();

    if options.anti_aliasing {
      // Apply spectral masking to edges to suppress aliasing/roll-off artifacts
      let mask_bins = (fft_size / 20).max(1); // 5% edge masking
      for j in 0..mask_bins {
        let weight = (j as f32 / mask_bins as f32).powf(0.5);
        let atten_db = 20.0 * (weight + 1e-9).log10();

        f1[j] += atten_db;
        f1[fft_size - 1 - j] += atten_db;
        f2[j] += atten_db;
        f2[fft_size - 1 - j] += atten_db;
      }
    }

    if options.noise_floor_matching {
      anti_aliasing::match_noise_floor_db(&f1, &mut f2, overlap_bins);
    }

    let stitched = if options.crossfading && overlap_bins > 1 {
      anti_aliasing::crossfade_f32(&f1, &f2, overlap_bins)
    } else {
      let mut s = Vec::with_capacity(f1.len() + f2.len() - overlap_bins);
      s.extend_from_slice(&f1[..offset_bins + midpoint_bin]);
      s.extend_from_slice(&f2[midpoint_bin..]);
      s
    };

    stitched_frames.push(stitched);
  }

  // Frequency ranges (Hz)
  let hop1_start = center1 as f64 - (sample_rate / 2.0);
  let hop1_end = center1 as f64 + (sample_rate / 2.0);
  let hop2_start = center2 as f64 - (sample_rate / 2.0);
  let hop2_end = center2 as f64 + (sample_rate / 2.0);

  let overlap_rms_error = if !hop1_frames.is_empty() && !hop2_frames.is_empty()
  {
    let f1_overlap = &hop1_frames[0][offset_bins..];
    let f2_overlap = &hop2_frames[0][..overlap_bins];
    anti_aliasing::calculate_rms_error_db(f1_overlap, f2_overlap)
  } else {
    0.0
  };

  let bin_size_hz = sample_rate / fft_size as f64;
  let cut_point_hz =
    hop1_start + (offset_bins + midpoint_bin) as f64 * bin_size_hz;

  let reconstructed_freq_hz = if options.chinese_remainder_synthesis {
    let m1 =
      anti_aliasing::Measurement::new(&hop1_frames[0], fft_size, sample_rate);
    let m2 =
      anti_aliasing::Measurement::new(&hop2_frames[0], fft_size, sample_rate);
    if let (Some(m1), Some(m2)) = (m1, m2) {
      anti_aliasing::reconstruct_frequency_crt(&[m1, m2], 1.5e9, 500.0)
    } else {
      None
    }
  } else {
    None
  };

  let total_latency_ms = start_time.elapsed().as_secs_f32() * 1000.0;
  let slice_duration_ms = (fft_size as f32 / sample_rate as f32) * 1000.0;
  // Mock uses 0ms settle, real hardware usually ~3-10ms based on post_retune_discard_frames
  let settle_time_ms = if device_info.contains("Mock") {
    0.0
  } else {
    10.0
  };

  // Convert frames to u8
  let hop1_u8 = hop1_frames
    .into_iter()
    .map(convert_to_u8)
    .collect::<Vec<_>>();
  let hop2_u8 = hop2_frames
    .into_iter()
    .map(convert_to_u8)
    .collect::<Vec<_>>();
  let stitched_u8 = stitched_frames
    .into_iter()
    .map(convert_to_u8)
    .collect::<Vec<_>>();

  let final_len = if !hop1_u8.is_empty() {
    hop1_u8[0].len()
  } else {
    0
  };

  // Pack response into a binary format:
  // [Magic:4][HeaderLen:4][JSON_Metadata][Binary_Data]
  let metadata = serde_json::json!({
    "fft_size": final_len,
    "num_frames": num_frames,
    "hop1_freq_hz": [hop1_start, hop1_end],
    "hop2_freq_hz": [hop2_start, hop2_end],
    "stitched_freq_hz": [hop1_start, hop2_end],
    "overlap_start": offset_bins,
    "overlap_end": overlap_bins,
    "device_info": device_info,
    "hop1_phase_deg": hop1_phase_deg,
    "hop2_phase_deg": hop2_phase_deg,
    "correction_angle_deg": correction_angle_deg,
    "fm_deviation_khz": fm_deviation_khz,
    "reconstructed_freq_hz": reconstructed_freq_hz,
    "acquisition_mode": acq_mode,
    "cut_point_hz": cut_point_hz,
    "overlap_rms_error": overlap_rms_error,
    "timing": {
      "total_latency_ms": total_latency_ms,
      "settle_time_ms": settle_time_ms,
      "slice_duration_ms": slice_duration_ms,
      "capture_timestamp_ms": std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64,
    }
  });

  let json_header = serde_json::to_string(&metadata).unwrap();
  let json_bytes = json_header.as_bytes();

  // Header: Magic(4) + JSONLen(4) + JSONData + BinaryData
  let mut response_bytes =
    Vec::with_capacity(8 + json_bytes.len() + (num_frames * final_len * 3));
  response_bytes.extend_from_slice(b"NAPT");
  response_bytes.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
  response_bytes.extend_from_slice(json_bytes);

  // Flatten and pack binary frames (u8)
  for frames in [&hop1_u8, &hop2_u8, &stitched_u8] {
    for frame in frames {
      response_bytes.extend_from_slice(frame);
    }
  }

  log::info!(
    "Stitch diagnostic complete. Returning {} MB binary payload (u8, {} pts/frame).",
    response_bytes.len() / 1_000_000,
    final_len
  );

  Response::builder()
    .header("Content-Type", "application/octet-stream")
    .body(axum::body::Body::from(response_bytes))
    .unwrap()
    .into_response()
}

// WebMCP tool handlers
async fn handle_connect_device(
  state: &Arc<super::AppState>,
  _params: &serde_json::Value,
) -> WebMCPToolResponse {
  // Send restart command to SDR thread
  if let Err(e) = state
    .cmd_tx
    .send(super::types::SdrCommand::RestartDevice { source_id: None })
  {
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
      .send(super::types::SdrCommand::SetPpm(ppm.max(0) as u32))
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
  if let Err(e) = state
    .cmd_tx
    .send(super::types::SdrCommand::RestartDevice { source_id: None })
  {
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
  let bandwidth = params.get("bandwidth").and_then(|b| b.as_u64());
  let bandwidth_center_frequency = params
    .get("bandwidthCenterFrequency")
    .and_then(|b| b.as_u64());

  // Parse optional channel selections from request payload
  let channels_opt: Option<Vec<ChannelSpec>> = params
    .get("channels")
    .and_then(|v| serde_json::from_value(v.clone()).ok());

  let capture_cmd = super::types::SdrCommand::StartCapture {
    job_id: job_id.to_string(),
    source_id: None,
    fragments: fragments.clone(),
    duration_mode: "timed".to_string(),
    duration_s,
    file_type: file_type.to_string(),
    acquisition_mode: acquisition_mode.to_string(),
    encrypted,
    sample_rate: None,
    fft_size,
    fft_window: fft_window.to_string(),
    frame_rate: None,
    geolocation: None, // HTTP endpoints don't have geolocation data
    ref_based_demod_baseline: None,
    capture_labels: None,
    is_ephemeral: false,
    channels: channels_opt,
    bandwidth,
    bandwidth_center_frequency,
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
        "bandwidth": bandwidth,
        "bandwidthCenterFrequency": bandwidth_center_frequency,
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
// Hot-reload handoff probe 1.

#[cfg(test)]
mod snapshot_tests {
  use super::{bounded_snapshot_frame_count, snapshot_frame_from};
  use crate::server::types::SpectrumData;

  fn sample_frame(iq_len: usize) -> SpectrumData {
    SpectrumData {
      message_type: "spectrum".to_string(),
      waveform: vec![1.0, 2.0, 3.0],
      is_mock_apt: false,
      source_id: "mock-apt".to_string(),
      stream_epoch: 7,
      sequence: 42,
      center_frequency_hz: Some(137_500_000),
      waveform_span_hz: None,
      timestamp: 1_700_000_000_000,
      data_type: Some("iq_raw".to_string()),
      sample_rate: Some(2_400_000),
      power_scale: None,
      iq_data: (0..iq_len).map(|i| (i % 251) as u8).collect(),
      is_tx_preview: None,
    }
  }

  #[test]
  fn snapshot_truncates_iq_to_requested_prefix() {
    let frame = sample_frame(8192);
    let snapshot = snapshot_frame_from(&frame, 4096);

    assert_eq!(snapshot.iq_data.len(), 4096);
    assert_eq!(snapshot.iq_data[..], frame.iq_data[..4096]);
    // Metadata is preserved for the harness.
    assert_eq!(snapshot.source_id, frame.source_id);
    assert_eq!(snapshot.stream_epoch, frame.stream_epoch);
    assert_eq!(snapshot.sequence, frame.sequence);
    assert_eq!(snapshot.center_frequency_hz, frame.center_frequency_hz);
    // Waveform payload is dropped; it is not part of the snapshot contract.
    assert!(snapshot.waveform.is_empty());
  }

  #[test]
  fn snapshot_handles_frames_shorter_than_the_request() {
    let frame = sample_frame(100);
    let snapshot = snapshot_frame_from(&frame, 4096);

    assert_eq!(snapshot.iq_data.len(), 100);
    assert_eq!(snapshot.iq_data, frame.iq_data);
  }

  #[test]
  fn snapshot_never_allocates_more_than_the_source() {
    let frame = sample_frame(262_144);
    let snapshot = snapshot_frame_from(&frame, 524_288);
    assert_eq!(snapshot.iq_data.len(), 262_144);
  }

  #[test]
  fn snapshot_frame_count_is_bounded_before_collection() {
    assert_eq!(bounded_snapshot_frame_count(None), 1);
    assert_eq!(bounded_snapshot_frame_count(Some(0)), 1);
    assert_eq!(bounded_snapshot_frame_count(Some(128)), 128);
    assert_eq!(bounded_snapshot_frame_count(Some(usize::MAX)), 128);
  }
}

#[cfg(test)]
mod capture_destination_tests {
  use super::{copy_capture_artifacts_to_directory, write_protected_capture_artifacts_to_directory};
  use crate::server::types::CaptureArtifact;
  use sha2::Digest;

  #[tokio::test]
  async fn copies_capture_bytes_to_an_existing_destination() {
    let source = tempfile::NamedTempFile::new().expect("source file");
    tokio::fs::write(source.path(), b"capture bytes")
      .await
      .expect("write source");
    let destination = tempfile::tempdir().expect("destination directory");
    let artifacts = vec![CaptureArtifact {
      filename: "capture.napt".to_string(),
      path: source.path().to_path_buf(),
      file_size: 13,
      checksum: "unused-in-copy".to_string(),
    }];

    let saved = copy_capture_artifacts_to_directory(&artifacts, destination.path())
      .await
      .expect("copy artifact");

    assert_eq!(saved, vec![destination.path().join("capture.napt")]);
    assert_eq!(
      tokio::fs::read(destination.path().join("capture.napt"))
        .await
        .expect("read copy"),
      b"capture bytes"
    );
  }

  #[tokio::test]
  async fn online_capture_copy_is_encrypted_with_the_capture_salt() {
    let source = tempfile::NamedTempFile::new().expect("source file");
    tokio::fs::write(source.path(), b"sensitive capture")
      .await
      .expect("write source");
    let destination = tempfile::tempdir().expect("destination directory");
    let artifacts = vec![CaptureArtifact {
      filename: "capture.iq".to_string(),
      path: source.path().to_path_buf(),
      file_size: 17,
      checksum: sha2::Sha256::digest(b"sensitive capture")
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect(),
    }];
    let key = [9u8; 32];
    // codeql[rust/hard-coded-cryptographic-value] Fixed salt is a unit-test fixture and is not used in production.
    let salt = [6u8; 32];

    let saved = write_protected_capture_artifacts_to_directory(
      &artifacts,
      destination.path(),
      &key,
      &salt,
    )
    .await
    .expect("encrypted copy");

    assert_eq!(saved[0].file_name().unwrap(), "capture.iq.enc");
    let encrypted = tokio::fs::read(&saved[0]).await.expect("read encrypted copy");
    assert!(encrypted.starts_with(b"NAPTENC2"));
    assert!(!encrypted.windows(salt.len()).any(|window| window == salt));
    assert_eq!(crate::crypto::decrypt_capture_envelope_with_salt(&key, &encrypted, &salt).unwrap(), b"sensitive capture");
  }

  #[tokio::test]
  async fn rejects_artifact_names_that_escape_the_destination() {
    let source = tempfile::NamedTempFile::new().expect("source file");
    let destination = tempfile::tempdir().expect("destination directory");
    let artifacts = vec![CaptureArtifact {
      filename: "../outside.napt".to_string(),
      path: source.path().to_path_buf(),
      file_size: 0,
      checksum: String::new(),
    }];

    let result = copy_capture_artifacts_to_directory(&artifacts, destination.path()).await;
    assert!(result.is_err());
    assert!(!destination.path().parent().unwrap().join("outside.napt").exists());
  }

  #[tokio::test]
  async fn does_not_overwrite_an_existing_capture() {
    let source = tempfile::NamedTempFile::new().expect("source file");
    tokio::fs::write(source.path(), b"new").await.expect("write source");
    let destination = tempfile::tempdir().expect("destination directory");
    let target = destination.path().join("capture.napt");
    tokio::fs::write(&target, b"keep").await.expect("write existing");
    let artifacts = vec![CaptureArtifact {
      filename: "capture.napt".to_string(),
      path: source.path().to_path_buf(),
      file_size: 3,
      checksum: String::new(),
    }];

    assert!(copy_capture_artifacts_to_directory(&artifacts, destination.path())
      .await
      .is_err());
    assert_eq!(tokio::fs::read(target).await.expect("read existing"), b"keep");
  }

  #[tokio::test]
  async fn rejects_an_unavailable_destination_directory() {
    let source = tempfile::NamedTempFile::new().expect("source file");
    let destination = tempfile::tempdir().expect("destination directory");
    let missing = destination.path().join("not-mounted");
    let artifacts = vec![CaptureArtifact {
      filename: "capture.napt".to_string(),
      path: source.path().to_path_buf(),
      file_size: 0,
      checksum: String::new(),
    }];

    let result = copy_capture_artifacts_to_directory(&artifacts, &missing).await;
    assert!(result.is_err());
    assert!(!missing.exists());
  }
}

#[cfg(test)]
mod classifier_capture_upload_tests {
  use super::{
    append_classifier_package_manifest, build_classifier_package_manifest,
    resolve_capture_download_artifacts, valid_classifier_capture_filename,
    validate_classifier_annotation_upload, validate_classifier_iq_upload,
  };
  use crate::server::iq_format::{self, IqChunk, IqFile, IqMetadata};
  use crate::server::types::CaptureArtifact;

  fn valid_v6_iq() -> (Vec<u8>, String) {
    let bytes = iq_format::encode(&IqFile {
      metadata: IqMetadata::default(),
      private_metadata: None,
      frames: vec![],
      chunks: vec![IqChunk { sample_offset: 0, channel: 0, data: vec![127, 128, 129, 130] }],
      trailer: Some(serde_json::json!({ "capture": "classifier-test" })),
    }, None).expect("encode V6 fixture");
    let decoded = iq_format::decode(&bytes, None).expect("decode V6 fixture");
    let digest = decoded.trailer.expect("V6 trailer")["integrity"]["digest"]
      .as_str().expect("integrity digest").to_string();
    (bytes, digest)
  }

  #[test]
  fn accepts_only_integrity_verified_v6_iq_and_detached_matching_annotations() {
    let (bytes, capture_id) = valid_v6_iq();
    validate_classifier_iq_upload(&bytes, &capture_id).expect("verified V6 IQ");
    let labels = serde_json::to_vec(&serde_json::json!({
      "format": "n-apt-native-annotations-v2",
      "captureId": capture_id,
      "captureIdentity": {
        "kind": "v6-trailer-sha256",
        "algorithm": "SHA-256",
        "scope": "file-with-integrity-digest-placeholder",
        "digestHex": capture_id,
      }
    })).expect("serialize sidecar");
    validate_classifier_annotation_upload(&labels, &capture_id).expect("matching detached labels");
  }

  #[test]
  fn rejects_tampered_iq_and_labels_for_a_different_capture() {
    let (mut bytes, capture_id) = valid_v6_iq();
    let decoded = iq_format::decode(&bytes, None).expect("decode V6 fixture");
    let payload_offset = decoded.metadata.fields["sections"]["binary"]["offset_bytes"]
      .as_u64().expect("binary offset") as usize;
    bytes[payload_offset] ^= 1;
    assert!(validate_classifier_iq_upload(&bytes, &capture_id).is_err());
    let wrong_labels = br#"{"format":"n-apt-native-annotations-v2","captureId":"wrong","captureIdentity":{"kind":"v6-trailer-sha256","algorithm":"SHA-256","scope":"file-with-integrity-digest-placeholder","digestHex":"wrong"}}"#;
    assert!(validate_classifier_annotation_upload(wrong_labels, &capture_id).is_err());
  }

  #[test]
  fn download_selection_returns_one_exact_registered_artifact() {
    let artifacts = vec![
      CaptureArtifact { filename: "capture.iq".into(), path: "/tmp/capture.iq".into(), file_size: 4, checksum: "iq-checksum".into() },
      CaptureArtifact { filename: "labels.json".into(), path: "/tmp/labels.json".into(), file_size: 2, checksum: "labels-checksum".into() },
    ];
    let selected = resolve_capture_download_artifacts(&artifacts, Some("labels.json"))
      .expect("registered labels artifact");
    assert_eq!(selected.len(), 1);
    assert_eq!(selected[0].filename, "labels.json");
    assert!(resolve_capture_download_artifacts(&artifacts, Some("../secret")).is_err());
    assert_eq!(resolve_capture_download_artifacts(&artifacts, None).unwrap().len(), 2);
  }

  #[test]
  fn classifier_artifact_filenames_are_basenames_with_expected_extensions() {
    assert!(valid_classifier_capture_filename("n-apt-capture.iq", ".iq"));
    assert!(valid_classifier_capture_filename("n-apt-labels.json", ".json"));
    assert!(!valid_classifier_capture_filename("../outside.iq", ".iq"));
    assert!(!valid_classifier_capture_filename("capture.json", ".iq"));
  }

  #[test]
  fn classifier_package_manifest_links_both_resources_by_checksum() {
    let iq_checksum = "a".repeat(64);
    let labels_checksum = "b".repeat(64);
    let artifacts = vec![
      CaptureArtifact {
        filename: "capture.iq".into(),
        path: format!(
          "/tmp/classifier_{}-iq-{iq_checksum}.iq",
          "a".repeat(64)
        )
        .into(),
        file_size: 64,
        checksum: iq_checksum.clone(),
      },
      CaptureArtifact {
        filename: "labels.json".into(),
        path: format!(
          "/tmp/classifier_{}-annotations-{labels_checksum}.json",
          "a".repeat(64)
        )
        .into(),
        file_size: 32,
        checksum: labels_checksum.clone(),
      },
    ];

    let manifest = build_classifier_package_manifest(
      &format!("classifier_{}", "a".repeat(64)),
      &artifacts,
    )
      .expect("complete classifier package manifest");
    let manifest: serde_json::Value = serde_json::from_slice(&manifest).expect("JSON descriptor");
    assert_eq!(manifest["$schema"], "https://datapackage.org/profiles/2.0/datapackage.json");
    assert_eq!(manifest["napt"]["captureId"], "a".repeat(64));
    assert_eq!(manifest["resources"].as_array().unwrap().len(), 2);
    assert_eq!(manifest["resources"][0]["path"], "capture.iq");
    assert_eq!(
      manifest["resources"][0]["hash"],
      format!("sha256:{iq_checksum}")
    );
    assert_eq!(manifest["resources"][1]["path"], "labels.json");
    assert_eq!(
      manifest["resources"][1]["hash"],
      format!("sha256:{labels_checksum}")
    );
  }

  #[test]
  fn classifier_package_manifest_rejects_incomplete_and_mismatched_resources() {
    let only_iq = vec![CaptureArtifact {
      filename: "capture.iq".into(),
      path: "/tmp/classifier_capture-iq-hash.iq".into(),
      file_size: 64,
      checksum: "a".repeat(64),
    }];
    assert!(
      build_classifier_package_manifest(
        &format!("classifier_{}", "a".repeat(64)),
        &only_iq
      )
      .is_err()
    );
    let mismatched = vec![
      only_iq[0].clone(),
      CaptureArtifact {
        filename: "labels.json".into(),
        path: format!(
          "/tmp/classifier_{}-annotations-hash.json",
          "a".repeat(64)
        )
        .into(),
        file_size: 32,
        checksum: "b".repeat(64),
      },
    ];
    assert!(
      build_classifier_package_manifest(
        &format!("classifier_{}", "b".repeat(64)),
        &mismatched
      )
      .is_err()
    );
  }

  #[test]
  fn classifier_zip_contains_the_manifest_alongside_both_capture_resources() {
    use std::io::{Cursor, Read};
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options: zip::write::FileOptions<()> = zip::write::FileOptions::default()
      .compression_method(zip::CompressionMethod::Stored);
    for (filename, bytes) in [("capture.iq", &b"iq-bytes"[..]), ("labels.json", &b"{}"[..])] {
      zip.start_file(filename, options).expect("resource entry");
      std::io::Write::write_all(&mut zip, bytes).expect("resource bytes");
    }
    append_classifier_package_manifest(&mut zip, br#"{"resources":[]}"#)
      .expect("Data Package descriptor entry");
    let mut archive = zip::ZipArchive::new(zip.finish().expect("finish ZIP"))
      .expect("open package ZIP");
    assert_eq!(archive.len(), 3);
    let mut descriptor = String::new();
    archive.by_name("datapackage.json").expect("top-level descriptor")
      .read_to_string(&mut descriptor).expect("read descriptor");
    assert_eq!(descriptor, r#"{"resources":[]}"#);
  }
}

#[cfg(test)]
mod classifier_dataset_label_tests {
  use super::{append_classifier_label_to_csv, HuggingFaceCaptureSaveQuery};
  use crate::server::types::CaptureArtifact;

  #[tokio::test]
  async fn appends_one_idempotent_label_row_to_the_classification_index() {
    let directory = tempfile::tempdir().expect("dataset directory");
    let annotation_path = directory.path().join("labels.json");
    tokio::fs::write(
      &annotation_path,
      br#"{"annotations":{"label":"matching","channel":"A","features":["bridge"],"tags":["verified"]}}"#,
    )
    .await
    .expect("write annotations");
    let labels_path = directory.path().join("labels.csv");
    let params = HuggingFaceCaptureSaveQuery {
      token: "not-used-by-helper".into(),
      job_id: format!("classifier_{}", "a".repeat(64)),
      section: Some("classification".into()),
      split: Some("validation".into()),
    };
    let artifacts = vec![
      CaptureArtifact {
        filename: "capture.iq".into(),
        path: directory.path().join("capture.iq"),
        file_size: 10,
        checksum: String::new(),
      },
      CaptureArtifact {
        filename: "labels.json".into(),
        path: annotation_path,
        file_size: 10,
        checksum: String::new(),
      },
    ];

    append_classifier_label_to_csv(&labels_path, &params, &artifacts)
      .await
      .expect("append classifier labels");
    append_classifier_label_to_csv(&labels_path, &params, &artifacts)
      .await
      .expect("deduplicate classifier label row");

    let csv = tokio::fs::read_to_string(labels_path).await.expect("read labels.csv");
    assert!(csv.contains("capture_id,split,label,channel,features,tags,capture_file"));
    assert!(csv.contains("\"validation\",\"matching\",\"A\",\"bridge\",\"verified\""));
    assert_eq!(csv.lines().count(), 2);
  }
}
