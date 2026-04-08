use axum::{http::StatusCode, Json};
use log::{error, info};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;

#[derive(Deserialize, Serialize)]
pub struct LoadLocalRadiusRequest {
  pub latitude: f64,
  pub longitude: f64,
  pub radius_km: Option<u32>, // Default 25
}

#[derive(Serialize, Deserialize)]
pub struct LoadLocalRadiusResponse {
  pub loaded: usize,
  pub radius: u32,
  pub center: (f64, f64),
  pub states: usize,
  pub cached: bool,
}

/**
 * Load local towers within a radius of user coordinates
 * Complements existing fast select towers with dynamic, location-specific data
 */
pub async fn load_local_radius_towers(
  Json(request): Json<LoadLocalRadiusRequest>,
) -> Result<Json<LoadLocalRadiusResponse>, StatusCode> {
  let radius_km = request.radius_km.unwrap_or(25);

  // Validate coordinates
  if request.latitude < -90.0
    || request.latitude > 90.0
    || request.longitude < -180.0
    || request.longitude > 180.0
  {
    return Err(StatusCode::BAD_REQUEST);
  }

  // Validate radius
  if radius_km < 5 || radius_km > 200 {
    return Err(StatusCode::BAD_REQUEST);
  }

  info!(
    "Loading local towers: lat={}, lng={}, radius={}km",
    request.latitude, request.longitude, radius_km
  );

  // Check if already cached
  if let Ok(cached_result) =
    check_local_cache(request.latitude, request.longitude, radius_km).await
  {
    info!("Found cached local towers: {}", cached_result.loaded);
    return Ok(Json(cached_result));
  }

  // Load towers dynamically
  match load_towers_command(request.latitude, request.longitude, radius_km)
    .await
  {
    Ok(result) => {
      info!("Successfully loaded {} local towers", result.loaded);
      Ok(Json(result))
    }
    Err(e) => {
      error!("Failed to load local towers: {}", e);
      Err(StatusCode::INTERNAL_SERVER_ERROR)
    }
  }
}

/**
 * Check if local towers are already cached for this location
 */
async fn check_local_cache(
  lat: f64,
  lng: f64,
  radius_km: u32,
) -> Result<LoadLocalRadiusResponse, Box<dyn std::error::Error>> {
  let redis_url = std::env::var("REDIS_URL")
    .unwrap_or_else(|_| "redis://127.0.0.1/".to_string());
  let client = redis::Client::open(redis_url)?;
  let mut con = client.get_connection()?;

  redis::cmd("SELECT")
    .arg(4)
    .query::<()>(&mut con)
    .map_err(|e| format!("Redis DB select failed: {}", e))?;

  // Generate geohash for cache key
  let geohash = get_geohash(lat, lng, 4);
  let cache_key = format!("local:{}:{}", geohash, radius_km);

  // Check if cache exists
  let exists: bool = redis::cmd("EXISTS")
    .arg(&cache_key)
    .query(&mut con)
    .map_err(|e| format!("Redis query failed: {}", e))?;

  if exists {
    // Get tower count from geospatial index
    let tower_count: usize = redis::cmd("ZCARD")
      .arg(&cache_key)
      .query(&mut con)
      .map_err(|e| format!("Redis query failed: {}", e))?;

    Ok(LoadLocalRadiusResponse {
      loaded: tower_count,
      radius: radius_km,
      center: (lat, lng),
      states: 1, // Approximate, could be stored in metadata
      cached: true,
    })
  } else {
    Err("No cache found".into())
  }
}

/**
 * Execute the tower loading script
 */
async fn load_towers_command(
  lat: f64,
  lng: f64,
  radius_km: u32,
) -> Result<LoadLocalRadiusResponse, Box<dyn std::error::Error>> {
  let output = Command::new("node")
    .arg("scripts/load_local_radius_towers.cjs")
    .arg(lat.to_string())
    .arg(lng.to_string())
    .arg(radius_km.to_string())
    .output()?;

  if !output.status.success() {
    let error_msg = String::from_utf8_lossy(&output.stderr);
    return Err(format!("Script execution failed: {}", error_msg).into());
  }

  // Parse JSON result from script
  let result_str = String::from_utf8_lossy(&output.stdout);

  // Find JSON in the output (last line should be JSON)
  let lines: Vec<&str> = result_str.trim().split('\n').collect();
  let json_line = lines.last().unwrap_or(&"{}");

  let result: LoadLocalRadiusResponse = serde_json::from_str(json_line)?;

  Ok(result)
}

/**
 * Simple geohash implementation for cache keys
 */
fn get_geohash(lat: f64, lng: f64, precision: usize) -> String {
  let lat_range = (-90.0, 90.0);
  let lng_range = (-180.0, 180.0);
  let mut geohash = String::new();
  let mut lat_min = lat_range.0;
  let mut lat_max = lat_range.1;
  let mut lng_min = lng_range.0;
  let mut lng_max = lng_range.1;

  for _ in 0..precision {
    let lat_mid = (lat_min + lat_max) / 2.0;
    let lng_mid = (lng_min + lng_max) / 2.0;

    if lng <= lng_mid {
      geohash.push('0');
      lng_max = lng_mid;
    } else {
      geohash.push('1');
      lng_min = lng_mid;
    }

    if lat <= lat_mid {
      geohash.push('0');
      lat_max = lat_mid;
    } else {
      geohash.push('1');
      lat_min = lat_mid;
    }
  }

  geohash
}

/**
 * Get memory usage statistics for local tower cache
 */
pub async fn get_local_cache_stats(
) -> Result<Json<serde_json::Value>, StatusCode> {
  let redis_url = std::env::var("REDIS_URL")
    .unwrap_or_else(|_| "redis://127.0.0.1/".to_string());

  match redis::Client::open(redis_url) {
    Ok(client) => {
      match client.get_connection() {
        Ok(mut con) => {
          // Switch to DB 4 (local towers)
          if redis::cmd("SELECT")
            .arg(4)
            .query::<String>(&mut con)
            .is_err()
          {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
          }

          // Get memory info
          let info: String =
            match redis::cmd("INFO").arg("memory").query(&mut con) {
              Ok(info) => info,
              Err(_) => return Err(StatusCode::SERVICE_UNAVAILABLE),
            };

          // Count local cache keys
          let keys: Vec<String> =
            match redis::cmd("KEYS").arg("local:*").query(&mut con) {
              Ok(keys) => keys,
              Err(_) => return Err(StatusCode::SERVICE_UNAVAILABLE),
            };

          let stats = serde_json::json!({
              "cache_keys": keys.len(),
              "database": 4,
              "memory_info": parse_memory_info(&info)
          });

          Ok(Json(stats))
        }
        Err(_) => Err(StatusCode::SERVICE_UNAVAILABLE),
      }
    }
    Err(_) => Err(StatusCode::SERVICE_UNAVAILABLE),
  }
}

/**
 * Parse Redis memory info string
 */
fn parse_memory_info(info: &str) -> HashMap<String, String> {
  let mut memory_info = HashMap::new();

  for line in info.lines() {
    if line.starts_with("used_memory:") {
      if let Some(value) = line.split(':').nth(1) {
        memory_info.insert("used_memory".to_string(), value.trim().to_string());
      }
    } else if line.starts_with("used_memory_human:") {
      if let Some(value) = line.split(':').nth(1) {
        memory_info
          .insert("used_memory_human".to_string(), value.trim().to_string());
      }
    }
  }

  memory_info
}
