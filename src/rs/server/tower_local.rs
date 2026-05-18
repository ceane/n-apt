use axum::{http::StatusCode, Json};
use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::f64::consts::PI;

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

struct StateBounds {
  min_lat: f64,
  max_lat: f64,
  min_lng: f64,
  max_lng: f64,
}

static STATE_BOUNDARIES: &[(&str, StateBounds)] = &[
  (
    "AL",
    StateBounds {
      min_lat: 30.2,
      max_lat: 35.0,
      min_lng: -88.5,
      max_lng: -84.9,
    },
  ),
  (
    "AK",
    StateBounds {
      min_lat: 51.2,
      max_lat: 71.4,
      min_lng: -179.1,
      max_lng: -129.9,
    },
  ),
  (
    "AZ",
    StateBounds {
      min_lat: 31.3,
      max_lat: 37.0,
      min_lng: -114.8,
      max_lng: -109.0,
    },
  ),
  (
    "AR",
    StateBounds {
      min_lat: 33.0,
      max_lat: 36.5,
      min_lng: -94.6,
      max_lng: -89.6,
    },
  ),
  (
    "CA",
    StateBounds {
      min_lat: 32.5,
      max_lat: 42.0,
      min_lng: -124.4,
      max_lng: -114.1,
    },
  ),
  (
    "CO",
    StateBounds {
      min_lat: 37.0,
      max_lat: 41.0,
      min_lng: -109.1,
      max_lng: -102.0,
    },
  ),
  (
    "CT",
    StateBounds {
      min_lat: 40.9,
      max_lat: 42.0,
      min_lng: -73.7,
      max_lng: -71.8,
    },
  ),
  (
    "DE",
    StateBounds {
      min_lat: 38.4,
      max_lat: 39.8,
      min_lng: -75.8,
      max_lng: -75.0,
    },
  ),
  (
    "FL",
    StateBounds {
      min_lat: 24.4,
      max_lat: 31.0,
      min_lng: -87.6,
      max_lng: -79.8,
    },
  ),
  (
    "GA",
    StateBounds {
      min_lat: 30.4,
      max_lat: 35.0,
      min_lng: -85.6,
      max_lng: -80.8,
    },
  ),
  (
    "HI",
    StateBounds {
      min_lat: 18.9,
      max_lat: 22.2,
      min_lng: -160.3,
      max_lng: -154.8,
    },
  ),
  (
    "ID",
    StateBounds {
      min_lat: 41.9,
      max_lat: 49.0,
      min_lng: -117.2,
      max_lng: -111.0,
    },
  ),
  (
    "IL",
    StateBounds {
      min_lat: 37.0,
      max_lat: 42.5,
      min_lng: -91.5,
      max_lng: -87.5,
    },
  ),
  (
    "IN",
    StateBounds {
      min_lat: 37.8,
      max_lat: 41.8,
      min_lng: -88.1,
      max_lng: -84.8,
    },
  ),
  (
    "IA",
    StateBounds {
      min_lat: 40.4,
      max_lat: 43.5,
      min_lng: -96.6,
      max_lng: -90.1,
    },
  ),
  (
    "KS",
    StateBounds {
      min_lat: 37.0,
      max_lat: 40.0,
      min_lng: -102.1,
      max_lng: -94.6,
    },
  ),
  (
    "KY",
    StateBounds {
      min_lat: 36.5,
      max_lat: 39.1,
      min_lng: -89.6,
      max_lng: -81.9,
    },
  ),
  (
    "LA",
    StateBounds {
      min_lat: 28.9,
      max_lat: 33.0,
      min_lng: -94.0,
      max_lng: -88.8,
    },
  ),
  (
    "ME",
    StateBounds {
      min_lat: 43.1,
      max_lat: 47.5,
      min_lng: -71.1,
      max_lng: -66.9,
    },
  ),
  (
    "MD",
    StateBounds {
      min_lat: 37.9,
      max_lat: 39.7,
      min_lng: -79.5,
      max_lng: -75.0,
    },
  ),
  (
    "MA",
    StateBounds {
      min_lat: 41.2,
      max_lat: 42.9,
      min_lng: -73.5,
      max_lng: -69.9,
    },
  ),
  (
    "MI",
    StateBounds {
      min_lat: 41.7,
      max_lat: 48.1,
      min_lng: -90.4,
      max_lng: -82.4,
    },
  ),
  (
    "MN",
    StateBounds {
      min_lat: 43.5,
      max_lat: 49.4,
      min_lng: -97.2,
      max_lng: -89.5,
    },
  ),
  (
    "MS",
    StateBounds {
      min_lat: 30.2,
      max_lat: 35.0,
      min_lng: -91.7,
      max_lng: -88.1,
    },
  ),
  (
    "MO",
    StateBounds {
      min_lat: 36.0,
      max_lat: 40.6,
      min_lng: -95.8,
      max_lng: -89.1,
    },
  ),
  (
    "MT",
    StateBounds {
      min_lat: 44.4,
      max_lat: 49.0,
      min_lng: -116.1,
      max_lng: -104.0,
    },
  ),
  (
    "NE",
    StateBounds {
      min_lat: 40.0,
      max_lat: 43.0,
      min_lng: -104.1,
      max_lng: -95.3,
    },
  ),
  (
    "NV",
    StateBounds {
      min_lat: 35.0,
      max_lat: 42.0,
      min_lng: -120.0,
      max_lng: -114.0,
    },
  ),
  (
    "NH",
    StateBounds {
      min_lat: 42.7,
      max_lat: 45.3,
      min_lng: -72.6,
      max_lng: -70.6,
    },
  ),
  (
    "NJ",
    StateBounds {
      min_lat: 38.9,
      max_lat: 41.4,
      min_lng: -75.6,
      max_lng: -73.9,
    },
  ),
  (
    "NM",
    StateBounds {
      min_lat: 31.3,
      max_lat: 37.0,
      min_lng: -109.1,
      max_lng: -103.0,
    },
  ),
  (
    "NY",
    StateBounds {
      min_lat: 40.5,
      max_lat: 45.0,
      min_lng: -79.8,
      max_lng: -71.8,
    },
  ),
  (
    "NC",
    StateBounds {
      min_lat: 33.8,
      max_lat: 36.6,
      min_lng: -84.3,
      max_lng: -75.4,
    },
  ),
  (
    "ND",
    StateBounds {
      min_lat: 45.9,
      max_lat: 49.0,
      min_lng: -104.1,
      max_lng: -96.6,
    },
  ),
  (
    "OH",
    StateBounds {
      min_lat: 38.4,
      max_lat: 42.1,
      min_lng: -84.8,
      max_lng: -80.5,
    },
  ),
  (
    "OK",
    StateBounds {
      min_lat: 33.6,
      max_lat: 37.0,
      min_lng: -103.0,
      max_lng: -94.4,
    },
  ),
  (
    "OR",
    StateBounds {
      min_lat: 41.9,
      max_lat: 46.3,
      min_lng: -124.7,
      max_lng: -116.5,
    },
  ),
  (
    "PA",
    StateBounds {
      min_lat: 39.7,
      max_lat: 42.5,
      min_lng: -80.5,
      max_lng: -74.7,
    },
  ),
  (
    "RI",
    StateBounds {
      min_lat: 41.1,
      max_lat: 42.0,
      min_lng: -71.9,
      max_lng: -71.1,
    },
  ),
  (
    "SC",
    StateBounds {
      min_lat: 32.0,
      max_lat: 35.2,
      min_lng: -83.4,
      max_lng: -78.5,
    },
  ),
  (
    "SD",
    StateBounds {
      min_lat: 42.5,
      max_lat: 45.9,
      min_lng: -104.1,
      max_lng: -96.4,
    },
  ),
  (
    "TN",
    StateBounds {
      min_lat: 34.9,
      max_lat: 36.7,
      min_lng: -90.3,
      max_lng: -81.6,
    },
  ),
  (
    "TX",
    StateBounds {
      min_lat: 25.8,
      max_lat: 36.5,
      min_lng: -106.6,
      max_lng: -93.5,
    },
  ),
  (
    "UT",
    StateBounds {
      min_lat: 37.0,
      max_lat: 42.0,
      min_lng: -114.1,
      max_lng: -109.0,
    },
  ),
  (
    "VA",
    StateBounds {
      min_lat: 36.5,
      max_lat: 39.5,
      min_lng: -83.7,
      max_lng: -75.2,
    },
  ),
  (
    "VT",
    StateBounds {
      min_lat: 42.7,
      max_lat: 45.0,
      min_lng: -73.4,
      max_lng: -71.5,
    },
  ),
  (
    "WA",
    StateBounds {
      min_lat: 45.5,
      max_lat: 49.0,
      min_lng: -125.0,
      max_lng: -116.9,
    },
  ),
  (
    "WI",
    StateBounds {
      min_lat: 42.5,
      max_lat: 47.1,
      min_lng: -92.9,
      max_lng: -86.3,
    },
  ),
  (
    "WV",
    StateBounds {
      min_lat: 37.2,
      max_lat: 40.6,
      min_lng: -82.6,
      max_lng: -77.7,
    },
  ),
  (
    "WY",
    StateBounds {
      min_lat: 40.9,
      max_lat: 45.0,
      min_lng: -111.3,
      max_lng: -104.1,
    },
  ),
];

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

  // Log at debug level without exposing PII coordinates
  debug!("Loading local towers: radius={}km", radius_km);

  // Check if already cached
  if let Ok(cached_result) =
    check_local_cache(request.latitude, request.longitude, radius_km).await
  {
    info!("Found cached local towers: {}", cached_result.loaded);
    return Ok(Json(cached_result));
  }

  // Load towers dynamically
  match load_towers_direct(request.latitude, request.longitude, radius_km).await
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
#[derive(Debug)]
struct TowerRecord {
  id: String,
  radio: String,
  mcc: String,
  mnc: String,
  lac: String,
  cell: String,
  range: String,
  lon: f64,
  lat: f64,
  samples: String,
  created: String,
  updated: String,
}

fn calculate_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
  let r = 6371.0;
  let d_lat = (lat2 - lat1) * PI / 180.0;
  let d_lon = (lon2 - lon1) * PI / 180.0;
  let a = (d_lat / 2.0).sin().powi(2)
    + (lat1 * PI / 180.0).cos()
      * (lat2 * PI / 180.0).cos()
      * (d_lon / 2.0).sin().powi(2);
  let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
  r * c
}

fn normalize_tower_record(
  tower_key: String,
  tower_data: HashMap<String, String>,
) -> Option<TowerRecord> {
  let lat = tower_data.get("lat")?.parse::<f64>().ok()?;
  let lon = tower_data.get("lon")?.parse::<f64>().ok()?;

  if lat == 0.0 || lon == 0.0 {
    return None;
  }

  Some(TowerRecord {
    id: tower_key,
    radio: tower_data
      .get("radio")
      .or_else(|| tower_data.get("type"))
      .cloned()
      .unwrap_or_else(|| "UNKNOWN".to_string()),
    mcc: tower_data
      .get("mcc")
      .cloned()
      .unwrap_or_else(|| "0".to_string()),
    mnc: tower_data
      .get("mnc")
      .cloned()
      .unwrap_or_else(|| "0".to_string()),
    lac: tower_data
      .get("lac")
      .cloned()
      .unwrap_or_else(|| "0".to_string()),
    cell: tower_data
      .get("cell")
      .or_else(|| tower_data.get("cellId"))
      .cloned()
      .unwrap_or_else(|| "0".to_string()),
    range: tower_data
      .get("range")
      .cloned()
      .unwrap_or_else(|| "-1".to_string()),
    lon,
    lat,
    samples: tower_data
      .get("samples")
      .cloned()
      .unwrap_or_else(|| "0".to_string()),
    created: tower_data.get("created").cloned().unwrap_or_default(),
    updated: tower_data.get("updated").cloned().unwrap_or_default(),
  })
}

fn get_states_in_radius(
  center_lat: f64,
  center_lng: f64,
  radius_km: u32,
) -> usize {
  let lat_delta = radius_km as f64 / 111.0;
  let lng_delta =
    radius_km as f64 / (111.0 * (center_lat * PI / 180.0).cos().max(0.000001));

  let bounds = (
    center_lat - lat_delta,
    center_lat + lat_delta,
    center_lng - lng_delta,
    center_lng + lng_delta,
  );

  STATE_BOUNDARIES
    .iter()
    .filter(|(_, state_bounds)| {
      bounds.1 >= state_bounds.min_lat
        && bounds.0 <= state_bounds.max_lat
        && bounds.3 >= state_bounds.min_lng
        && bounds.2 <= state_bounds.max_lng
    })
    .count()
}

async fn load_towers_direct(
  lat: f64,
  lng: f64,
  radius_km: u32,
) -> Result<LoadLocalRadiusResponse, Box<dyn std::error::Error>> {
  let redis_url = std::env::var("REDIS_URL")
    .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
  let client = redis::Client::open(redis_url)?;
  let mut con = client.get_connection()?;

  redis::cmd("SELECT").arg(3).query::<()>(&mut con)?;
  let tower_keys: Vec<String> =
    redis::cmd("KEYS").arg("tower:*").query(&mut con)?;

  let states = get_states_in_radius(lat, lng, radius_km);
  let mut towers = Vec::new();

  for tower_key in tower_keys {
    let tower_data: HashMap<String, String> = redis::cmd("HGETALL")
      .arg(&tower_key)
      .query(&mut con)
      .unwrap_or_default();

    if let Some(tower) = normalize_tower_record(tower_key, tower_data) {
      if calculate_distance(lat, lng, tower.lat, tower.lon) <= radius_km as f64
      {
        towers.push(tower);
      }
    }
  }

  redis::cmd("SELECT").arg(4).query::<()>(&mut con)?;
  let geohash = get_geohash(lat, lng, 4);
  let cache_key = format!("local:{}:{}", geohash, radius_km);

  redis::cmd("DEL")
    .arg(&cache_key)
    .arg(format!("{cache_key}:data"))
    .query::<()>(&mut con)?;

  for tower in &towers {
    let full_tower_data = serde_json::json!({
      "type": tower.radio,
      "mcc": tower.mcc.parse::<u64>().unwrap_or(0),
      "mnc": tower.mnc.parse::<u64>().unwrap_or(0),
      "lac": tower.lac.parse::<u64>().unwrap_or(0),
      "cellId": tower.cell.parse::<u64>().unwrap_or(0),
      "range": tower.range.parse::<i64>().unwrap_or(0),
      "lon": tower.lon,
      "lat": tower.lat,
      "samples": tower.samples.parse::<u64>().unwrap_or(0),
      "created": tower.created.parse::<u64>().unwrap_or(0),
      "updated": tower.updated.parse::<u64>().unwrap_or(0),
    })
    .to_string();

    let _: () = redis::cmd("SETEX")
      .arg(&tower.id)
      .arg(6 * 3600)
      .arg(full_tower_data)
      .query(&mut con)?;

    let _: () = redis::cmd("GEOADD")
      .arg(&cache_key)
      .arg(tower.lon)
      .arg(tower.lat)
      .arg(&tower.id)
      .query(&mut con)?;
  }

  let _: () = redis::cmd("EXPIRE")
    .arg(&cache_key)
    .arg(6 * 3600)
    .query(&mut con)?;

  Ok(LoadLocalRadiusResponse {
    loaded: towers.len(),
    radius: radius_km,
    center: (lat, lng),
    states,
    cached: false,
  })
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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn calculates_reasonable_distance() {
    let distance = calculate_distance(37.7749, -122.4194, 37.8044, -122.2711);
    assert!(distance > 12.0);
    assert!(distance < 16.0);
  }

  #[test]
  fn finds_states_near_california_coordinates() {
    let states = get_states_in_radius(37.7749, -122.4194, 25);
    assert!(states >= 1);
  }
}
