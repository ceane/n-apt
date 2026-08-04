use anyhow::Result;
use log::info;
use regex::Regex;
use serde_yaml::Value;
use sha2::Digest;
use std::io::Write;
use std::sync::RwLock;

use super::types::{AvailableSpectrumConfig, CaptureArtifact, ChannelSpec};
use super::types::{DeviceProfile, NaptConfig, SdrConfig};

pub static RE_SAFE_ID: std::sync::LazyLock<Regex> =
  std::sync::LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap());

pub(crate) fn parse_frequency_hz(s: &str) -> f64 {
  let s = s.trim();
  let (num_str, unit) = if let Some(idx) = s.find(|c: char| c.is_alphabetic()) {
    (&s[..idx], &s[idx..])
  } else {
    (s, "")
  };

  let num: f64 = num_str.parse().unwrap_or(0.0);
  let unit_upper = unit.to_uppercase();

  match unit_upper.as_str() {
    "GHZ" => num * 1_000_000_000.0,
    "MHZ" => num * 1_000_000.0,
    "KHZ" => num * 1000.0,
    "HZ" => num,
    _ => num,
  }
}

pub fn preprocess_frequency_tags(content: &str) -> String {
  let re_single =
    Regex::new(r"!frequency\s+([\d.]+)\s*([kKmMgG]?Hz)\b").unwrap();
  let content = re_single
    .replace_all(content, |caps: &regex::Captures| {
      let value: f64 = caps[1].parse().unwrap_or(0.0);
      let unit = caps[2].to_uppercase();
      let multiplier = match unit.as_str() {
        "GHZ" => 1e9,
        "MHZ" => 1e6,
        "KHZ" => 1e3,
        "HZ" => 1.0,
        _ => 1.0,
      };
      (value * multiplier).to_string()
    })
    .to_string();

  let re_range = Regex::new(r"!frequency_range\s+(\d+\.?\d*[kKmMgG]?Hz)\s*\.\.\s*(\d+\.?\d*[kKmMgG]?Hz)").unwrap();
  let content = re_range
    .replace_all(&content, |caps: &regex::Captures| {
      let start = parse_frequency_hz(&caps[1]);
      let end = parse_frequency_hz(&caps[2]);
      format!("[{}, {}]", start, end)
    })
    .to_string();

  let re_db = Regex::new(
    r"!(dB|decibels|dBm|decibel_milliwatts)\s+(-?[\d.]+)\s*(dB|dBm)\b",
  )
  .unwrap();
  let content = re_db
    .replace_all(&content, |caps: &regex::Captures| caps[2].to_string())
    .to_string();

  let re_db_range = Regex::new(
    r"(\w+):\s*!dB_range\s+(-?[\d.]+)\s*(?:dB|dBm)?\s*\.\.\s*(-?[\d.]+)\s*(?:dB|dBm)?",
  )
  .unwrap();
  re_db_range
    .replace_all(&content, |caps: &regex::Captures| {
      format!("{}: [{}, {}]", &caps[1], &caps[2], &caps[3])
    })
    .to_string()
}

pub fn preprocess_sdr_sample_rate_tags(content: &str) -> String {
  let re_seq = Regex::new(r"(?ms)sample_rate:\s*\n\s*-\s*base:\s*\S+.*?\n\s*freq_hz:\s*(\d+).*?\n\s*-\s*channel:\s*\S+.*?\n\s*freq_hz:\s*[^\n]+").unwrap();
  let content = re_seq.replace_all(content, "sample_rate: $1").to_string();

  let re_floor_max = Regex::new(r"sample_rate:\s*!floor\.\.\.!max\b").unwrap();
  let content = re_floor_max
    .replace_all(
      &content,
      "sample_rate: [\"__NAPT_SAMPLE_RATE_FLOOR__\", \"__NAPT_SAMPLE_RATE_MAX__\"]",
    )
    .to_string();

  let re_floor_channel =
    Regex::new(r"sample_rate:\s*!floor\.\.\.!channel\b").unwrap();
  let content = re_floor_channel
    .replace_all(
      &content,
      "sample_rate: [\"__NAPT_SAMPLE_RATE_FLOOR__\", \"__NAPT_SAMPLE_RATE_CHANNEL__\"]",
    )
    .to_string();

  let re_clamp_tag = Regex::new(r"sample_rate:\s*!clamp\b").unwrap();
  let content = re_clamp_tag
    .replace_all(&content, "sample_rate:")
    .to_string();

  let re_channel_tag = Regex::new(r"!channel\s+sample_rate\b").unwrap();
  let content = re_channel_tag
    .replace_all(&content, "\"__NAPT_SAMPLE_RATE_CHANNEL__\"")
    .to_string();

  let re_floor_tag = Regex::new(r"!floor\s+sample_rate\b").unwrap();
  let content = re_floor_tag
    .replace_all(&content, "\"__NAPT_SAMPLE_RATE_FLOOR__\"")
    .to_string();

  let re_max_tag = Regex::new(r"!max\s+sample_rate\b").unwrap();
  let content = re_max_tag
    .replace_all(&content, "\"__NAPT_SAMPLE_RATE_MAX__\"")
    .to_string();

  let re_max = Regex::new(r"sample_rate:\s*!max\b").unwrap();
  let content = re_max
    .replace_all(&content, "sample_rate: \"__NAPT_SAMPLE_RATE_MAX__\"")
    .to_string();

  let re_floor = Regex::new(r"sample_rate:\s*!floor\b").unwrap();
  let content = re_floor
    .replace_all(&content, "sample_rate: \"__NAPT_SAMPLE_RATE_FLOOR__\"")
    .to_string();

  // Preprocess power-of-two tags (e.g. !pow2 22 or 2^11) safely:
  let re_pow2 = Regex::new(r"(?:!pow2\s+|2\^)(\d+)\b").unwrap();
  re_pow2
    .replace_all(&content, |caps: &regex::Captures| {
      let exponent: u32 = caps[1].parse().unwrap_or(0);
      if exponent >= 8 && exponent <= 24 {
        2u32.pow(exponent).to_string()
      } else {
        "2048".to_string()
      }
    })
    .to_string()
}

/// Downsample spectrum data to a target length using averaging
#[allow(dead_code)]
fn downsample_spectrum(data: &[f32], target_len: usize) -> Vec<f32> {
  crate::simd::downsample_spectrum_simd(data, target_len)
}

pub fn read_config_file(
  filename: &str,
) -> Option<(String, std::time::SystemTime)> {
  let path = std::path::Path::new(filename);
  let content = if path.exists() {
    std::fs::read_to_string(path).ok()
  } else {
    let manifest_path =
      std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(filename);
    std::fs::read_to_string(manifest_path).ok()
  }?;

  let modified =
    path.metadata().and_then(|m| m.modified()).ok().or_else(|| {
      let manifest_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(filename);
      manifest_path.metadata().and_then(|m| m.modified()).ok()
    });

  modified.map(|m| (content, m))
}

#[cfg(test)]
pub(crate) fn cwd_lock() -> &'static std::sync::Mutex<()> {
  static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
    std::sync::OnceLock::new();
  LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

#[cfg(test)]
pub(crate) fn clear_signals_config_cache() {
  let mut guard = SIGNALS_CONFIG.write().unwrap();
  *guard = None;
}

struct CachedSignalsConfig {
  config: super::types::SignalsConfig,
  modified: std::time::SystemTime,
  checksum: String,
  filename: String,
}

static SIGNALS_CONFIG: RwLock<Option<CachedSignalsConfig>> = RwLock::new(None);

fn sha256_hex(input: &[u8]) -> String {
  use sha2::Digest;
  let digest = sha2::Sha256::digest(input);
  digest
    .iter()
    .map(|b| format!("{:02x}", b))
    .collect::<String>()
}

fn reload_signals_config() -> CachedSignalsConfig {
  let filename = if std::path::Path::new("signals.yaml").exists() {
    "signals.yaml".to_string()
  } else {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
      .join("signals.yaml")
      .to_string_lossy()
      .to_string()
  };

  let (content, modified) = read_config_file(&filename)
    .expect("signals.yaml must be present alongside the binary or in CARGO_MANIFEST_DIR");

  let processed = preprocess_frequency_tags(&content);
  let processed = preprocess_sdr_sample_rate_tags(&processed);
  let checksum = sha256_hex(processed.as_bytes());

  let config = serde_yaml::from_str(&processed).unwrap_or_else(|e| {
    eprintln!("\n❌ INVALID signals.yaml CONFIGURATION");
    eprintln!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    let error_msg = e.to_string();
    if let Some(line_col) = extract_yaml_location(&error_msg) {
      eprintln!("Location: {}", line_col);
    }

    eprintln!("Error: {}", error_msg);
    eprintln!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    eprintln!("\nCommon issues:");
    eprintln!("  • Missing or invalid mock_apt.channels configuration");
    eprintln!("  • Incorrect YAML indentation (use 2 or 4 spaces, be consistent)");
    eprintln!("  • Invalid field names in channel config");
    eprintln!("  • Invalid !frequency tag values (use: !frequency 18kHz, 20MHz, 2.3GHz, 30Hz)");
    eprintln!("\nExpected mock_apt structure:");
    eprintln!("  mock_apt:");
    eprintln!("    channels:");
    eprintln!("      a:");
    eprintln!("        freq_range_hz: !frequency_range 18kHz..4.47MHz");
    eprintln!("        signal_strength_range: !dB_range -80dB..-20dB");
    eprintln!("        noise_floor_db: !dB -100dB");
    eprintln!("        ...");
    eprintln!("\nFrequency tag examples:");
    eprintln!("  center_frequency: !frequency 137.5MHz");
    eprintln!("  sample_rate: !frequency 2.4MHz");
    eprintln!();    panic!("Invalid signals.yaml configuration");
  });

  log::info!("Loaded signals.yaml (modified: {:?})", modified);
  CachedSignalsConfig {
    config,
    modified,
    checksum,
    filename,
  }
}

/// Get signals config with hot reloading support.
/// Automatically reloads if signals.yaml has been modified.
pub fn signals_config() -> super::types::SignalsConfig {
  // Check if we need to reload
  let needs_reload = {
    let guard = SIGNALS_CONFIG.read().unwrap();
    match guard.as_ref() {
      Some(cached) => {
        if let Some((_, modified)) = read_config_file(&cached.filename) {
          if modified <= cached.modified {
            false
          } else {
            let path = std::path::Path::new(&cached.filename);
            let content = if path.exists() {
              std::fs::read_to_string(path).ok()
            } else {
              std::fs::read_to_string(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                  .join(&cached.filename),
              )
              .ok()
            };
            if let Some(content) = content {
              let processed = preprocess_frequency_tags(&content);
              let processed = preprocess_sdr_sample_rate_tags(&processed);
              let checksum = sha256_hex(processed.as_bytes());
              checksum != cached.checksum
            } else {
              false
            }
          }
        } else {
          false
        }
      }
      None => true,
    }
  };

  if needs_reload {
    let mut guard = SIGNALS_CONFIG.write().unwrap();
    // Double-check after acquiring write lock
    let should_reload = match guard.as_ref() {
      Some(cached) => {
        if let Some((_, modified)) = read_config_file(&cached.filename) {
          if modified <= cached.modified {
            false
          } else {
            let path = std::path::Path::new(&cached.filename);
            let content = if path.exists() {
              std::fs::read_to_string(path).ok()
            } else {
              std::fs::read_to_string(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                  .join(&cached.filename),
              )
              .ok()
            };
            if let Some(content) = content {
              let processed = preprocess_frequency_tags(&content);
              let processed = preprocess_sdr_sample_rate_tags(&processed);
              let checksum = sha256_hex(processed.as_bytes());
              checksum != cached.checksum
            } else {
              false
            }
          }
        } else {
          false
        }
      }
      None => true,
    };

    if should_reload {
      log::info!("🔄 signals.yaml changed, reloading...");
      let cached = reload_signals_config();
      *guard = Some(cached);
    }
  }

  // Return owned config - callers can clone if needed
  SIGNALS_CONFIG
    .read()
    .unwrap()
    .as_ref()
    .unwrap()
    .config
    .clone()
}

pub fn signals_config_checksum() -> Option<String> {
  SIGNALS_CONFIG
    .read()
    .unwrap()
    .as_ref()
    .map(|cached| cached.checksum.clone())
}

/// Extract line and column numbers from serde_yaml error message
fn extract_yaml_location(error_msg: &str) -> Option<String> {
  // Error format: "field: description", line: X, column: Y"
  if let Some(line_start) = error_msg.rfind("line: ") {
    let line_part = &error_msg[line_start + 6..];
    if let Some(comma) = line_part.find(',') {
      let line_num = line_part[..comma].trim();
      if let Some(col_start) = error_msg.rfind("column: ") {
        let col_part = &error_msg[col_start + 8..];
        if let Some(quote) = col_part.find('"') {
          let col_num = col_part[..quote].trim();
          return Some(format!("signals.yaml:{}:{}", line_num, col_num));
        }
      }
    }
  }
  None
}

/// Trim a list of ChannelSpec against a selected subset to produce header channels
pub fn trim_channels_for_header(
  all: &[ChannelSpec],
  selected: &[ChannelSpec],
) -> Vec<ChannelSpec> {
  // If no selection is provided, preserve all
  if selected.is_empty() {
    return all.to_vec();
  }
  let mut out: Vec<ChannelSpec> = Vec::new();
  for cs in selected {
    if let Some(found) = all.iter().find(|a| {
      a.center_freq_hz == cs.center_freq_hz && a.size_hz == cs.size_hz
    }) {
      out.push(found.clone());
    }
  }
  out
}

pub fn compute_min_receive_sample_rate(
  napt: &NaptConfig,
  sdr_sample_rate: u32,
) -> u32 {
  const RTL_SDR_FLOOR_HZ: u32 = 3_200_000;

  let widest_channel_bandwidth = widest_channel_bandwidth(napt);

  let derived_floor = widest_channel_bandwidth / 2;
  let min_receive_sample_rate = RTL_SDR_FLOOR_HZ.max(derived_floor);
  min_receive_sample_rate.min(sdr_sample_rate)
}

/// Resolve the `!channel` sample-rate ceiling from the configured N-APT
/// channels. This is the authoritative maximum for Mock APT; device probe
/// metadata is only a fallback when the channel configuration is unavailable.
pub fn widest_channel_bandwidth(napt: &NaptConfig) -> u32 {
  napt
    .channels
    .values()
    .filter_map(|channel| {
      let range = &channel.freq_range_hz;
      if range.len() < 2 {
        return None;
      }
      let min = range[0];
      let max = range[1];
      if !min.is_finite() || !max.is_finite() || max <= min {
        return None;
      }
      Some((max - min) as u32)
    })
    .max()
    .unwrap_or(0)
}

pub fn apply_min_receive_sample_rate(sdr: &mut SdrConfig, napt: &NaptConfig) {
  let min_receive_sample_rate =
    compute_min_receive_sample_rate(napt, sdr.sample_rate);
  sdr.min_receive_sample_rate = Some(min_receive_sample_rate);
  if sdr.sample_rate < min_receive_sample_rate {
    log::warn!(
      "signals.yaml sample_rate {} Hz is below computed receive floor {} Hz; clamping",
      sdr.sample_rate,
      min_receive_sample_rate
    );
    sdr.sample_rate = min_receive_sample_rate;
  }
}

pub fn load_channels() -> Vec<super::types::SpectrumFrameMessage> {
  let parsed = signals_config();
  let mut out = Vec::new();
  for (id, f) in parsed.signals.n_apt.channels.clone() {
    if f.freq_range_hz.len() < 2 {
      continue;
    }
    let min_hz = f.freq_range_hz[0];
    let max_hz = f.freq_range_hz[1];
    if !(min_hz.is_finite() && max_hz.is_finite() && max_hz > min_hz) {
      continue;
    }
    out.push(super::types::SpectrumFrameMessage {
      id,
      label: f.label,
      min_hz,
      max_hz,
      description: f.description,
    });
  }
  out
}

pub fn resolve_fft_config(
  device_kind: &str,
  sample_rate: u32,
  preferred_size: Option<usize>,
  sdr_settings: Option<&super::types::SdrConfig>,
) -> super::types::SdrFftConfig {
  let mut min_size: usize = 2048;
  let mut max_size: usize = if device_kind == "hackrf_one" {
    262_144 // 2^18: maximum supported by the browser live visualizer
  } else {
    262_144 // 2^18
  };

  // Override from sdr_settings if available
  if let Some(settings) = sdr_settings {
    // 1. Check global fft_sizes
    if let Some(fft_sizes_list) = &settings.fft_sizes {
      for item in fft_sizes_list {
        if item.base == "base_fft_sizes" {
          if let Some(min) = item.fft_min {
            min_size = min as usize;
          }
          if let Some(max) = item.fft_max {
            max_size = max as usize;
          }
        }
      }
    }
    // 2. Check device-specific overrides
    if let Some(device_cfg) = settings.devices.get(device_kind) {
      if let Some(fft_sizes_list) = &device_cfg.fft_sizes {
        for item in fft_sizes_list {
          if item.base == "base_fft_sizes" {
            if let Some(min) = item.fft_min {
              min_size = min as usize;
            }
            if let Some(max) = item.fft_max {
              max_size = max as usize;
            }
          }
        }
      }
    }
  }

  // Security bounds checks
  if min_size < 256 {
    min_size = 256;
  }
  if max_size > 8_388_608 {
    max_size = 8_388_608;
  }
  if min_size > max_size {
    min_size = max_size;
  }

  let mut sizes: Vec<usize> = Vec::new();
  let mut current: usize = min_size;
  let sr_usize = sample_rate as usize;
  while current <= max_size {
    if current <= sr_usize || sizes.is_empty() {
      sizes.push(current);
    }
    current *= 2;
  }

  let mut size_to_frame_rate = std::collections::HashMap::new();
  for &sz in &sizes {
    let rate = if sz > 0 {
      ((sample_rate as f64) / (sz as f64)).floor() as u32
    } else {
      super::types::MAX_LOGICAL_FRAME_RATE
    };
    let rate = rate.min(super::types::MAX_LOGICAL_FRAME_RATE).max(1);
    size_to_frame_rate.insert(sz, rate);
  }

  let default_size = preferred_size
    .filter(|sz| sizes.contains(sz))
    .unwrap_or_else(|| {
      if sizes.contains(&2048) {
        2048
      } else {
        sizes[0]
      }
    });

  let default_frame_rate =
    *size_to_frame_rate.get(&default_size).unwrap_or(&60);

  let max_frame_rate = *size_to_frame_rate.values().max().unwrap_or(&60);

  super::types::SdrFftConfig {
    default_size,
    default_frame_rate,
    max_size: *sizes.last().unwrap_or(&max_size),
    max_frame_rate,
    size_to_frame_rate,
  }
}

/// Load SDR settings (panic if missing/malformed)
pub fn load_sdr_settings() -> super::types::SdrConfig {
  let config = signals_config();
  let mut sdr = config.signals.sdr.clone();
  apply_min_receive_sample_rate(&mut sdr, &config.signals.n_apt);
  sdr.fft = resolve_fft_config(
    "mock_apt",
    sdr.sample_rate,
    Some(sdr.fft.default_size),
    Some(&sdr),
  );
  sdr
}

pub fn load_available_spectrum() -> Option<AvailableSpectrumConfig> {
  let config = signals_config();
  config.signals.available_spectrum.clone().or_else(|| {
    Some(AvailableSpectrumConfig {
      min_freq: 0.0,
      max_freq: 30_000_000_000.0,
    })
  })
}

/// Load mock APT signal settings (panic if missing/malformed)
pub fn load_mock_apt_settings() -> super::types::MockAptSignalsConfig {
  signals_config().signals.mock_apt.clone()
}

pub fn load_mock_tx_settings() -> super::types::MockTxSignalsConfig {
  signals_config().signals.mock_tx.clone()
}

pub fn signals_config_modified_at() -> Option<std::time::SystemTime> {
  let needs_reload = {
    let guard = SIGNALS_CONFIG.read().unwrap();
    match guard.as_ref() {
      Some(cached) => {
        if let Some((_, modified)) = read_config_file(&cached.filename) {
          modified > cached.modified
        } else {
          false
        }
      }
      None => true,
    }
  };

  if needs_reload {
    let _ = signals_config();
  }

  SIGNALS_CONFIG
    .read()
    .unwrap()
    .as_ref()
    .map(|cached| cached.modified)
}

#[allow(dead_code)]
fn extract_channels_from_value(
  value: &Value,
) -> Option<Vec<super::types::SpectrumFrameMessage>> {
  let channels = value
    .get("signals")
    .and_then(|v| v.get("n_apt"))
    .and_then(|v| v.get("channels"))
    .and_then(|v| v.as_mapping())?;

  let mut out = Vec::new();
  for (id_value, frame_value) in channels {
    let id = id_value.as_str()?.to_string();
    let mapping = frame_value.as_mapping()?;
    let label = mapping
      .get(Value::String("label".to_string()))
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string();
    let description = mapping
      .get(Value::String("description".to_string()))
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string();
    let freq_range = mapping
      .get(Value::String("freq_range_hz".to_string()))
      .and_then(|v| v.as_sequence())?;
    if freq_range.len() < 2 {
      continue;
    }
    let min_hz = freq_range[0].as_f64()?;
    let max_hz = freq_range[1].as_f64()?;
    if !(min_hz.is_finite() && max_hz.is_finite() && max_hz > min_hz) {
      continue;
    }
    out.push(super::types::SpectrumFrameMessage {
      id,
      label,
      min_hz,
      max_hz,
      description,
    });
  }
  out.sort_by(|a, b| {
    a.min_hz
      .partial_cmp(&b.min_hz)
      .unwrap_or(std::cmp::Ordering::Equal)
  });
  Some(out)
}

/// Reconcile `device_connected` flag with `device_state` string.
///
/// Since `SharedState::set_device_state` now atomically updates both fields,
/// conflicts should be rare. This function exists as a safety net for reads
/// that race with a state transition.
pub fn reconcile_device_state(
  device_connected: bool,
  device_state: &str,
) -> String {
  match (device_connected, device_state) {
    // "loading" and "initializing" are authoritative mid-transition states.
    (_, "loading") => "loading".to_string(),
    (_, "initializing") => "initializing".to_string(),
    // "stale" is authoritative — the health loop set it deliberately
    (_, "stale") => "stale".to_string(),
    // Normal consistency checks
    (true, "disconnected") => "connected".to_string(),
    (false, "connected") => "disconnected".to_string(),
    (false, _) => "disconnected".to_string(),
    _ => device_state.to_string(),
  }
}

pub fn mock_apt_device_name(device_info: &str) -> String {
  device_info
    .split(" - ")
    .next()
    .unwrap_or("Mock APT SDR")
    .trim()
    .to_string()
}

pub fn mock_apt_backend_label(device_info: &str) -> &'static str {
  if cfg!(all(feature = "mock_apt_metal", target_os = "macos"))
    && device_info.contains("(Metal)")
  {
    "mock_apt_metal"
  } else {
    "mock_apt"
  }
}

pub fn normalize_rtl_sdr_device_name(raw_name: &str) -> String {
  let short_name = raw_name.split(" - ").next().unwrap_or("RTL-SDR").trim();
  let lower = short_name.to_ascii_lowercase();

  if let Some(version) = short_name.split_whitespace().find_map(|token| {
    let cleaned = token
      .trim_matches(|c: char| !c.is_ascii_alphanumeric())
      .to_ascii_lowercase();
    let version = cleaned.strip_prefix('v')?;
    if !version.is_empty() && version.chars().all(|c| c.is_ascii_digit()) {
      Some(version.to_string())
    } else {
      None
    }
  }) {
    return format!("RTL-SDR v{}", version);
  }

  if lower.contains("rtl-sdr blog")
    || lower.contains("rtl2832")
    || lower.contains("rtl-sdr")
    || lower.contains("generic")
    || lower.contains("rtl2832u")
  {
    return "RTL-SDR v4".to_string();
  }

  short_name.to_string()
}

pub fn device_config_key(device_profile: &super::types::DeviceProfile) -> &str {
  match device_profile.kind.as_str() {
    "rtl-sdr" | "rtl_sdr" => "rtl_sdr",
    "hackrf_one" => "hackrf_one",
    "mock_tx" => "mock_tx",
    "mock_apt_metal" => "mock_apt",
    "mock_apt" => "mock_apt",
    kind => kind,
  }
}

pub fn parse_device_info_sample_rate(device_info: &str) -> Option<u32> {
  device_info
    .split("Rate: ")
    .nth(1)
    .and_then(|s| s.split(" Hz").next())
    .and_then(|s| s.parse::<u32>().ok())
}

pub fn device_sample_rate_ceiling(
  device_connected: bool,
  device_info: &str,
  device_profile: &DeviceProfile,
  sdr_settings: &SdrConfig,
) -> u32 {
  if matches!(device_profile.kind.as_str(), "mock_apt" | "mock_apt_metal") {
    if let Some(configured_max) = sdr_settings
      .devices
      .get(device_config_key(device_profile))
      .and_then(|device_cfg| device_cfg.max_sample_rate)
    {
      return configured_max;
    }
    let configured_channel_ceiling =
      widest_channel_bandwidth(&signals_config().signals.n_apt);
    return if configured_channel_ceiling > 0 {
      configured_channel_ceiling
    } else {
      parse_device_info_sample_rate(device_info)
        .unwrap_or(sdr_settings.sample_rate)
    };
  }

  if matches!(device_profile.kind.as_str(), "hackrf_one" | "mock_tx") {
    return 20_000_000;
  }

  if device_profile.is_rtl_sdr
    || matches!(device_profile.kind.as_str(), "rtl_sdr" | "rtl-sdr")
  {
    return 3_200_000;
  }

  if device_connected {
    parse_device_info_sample_rate(device_info)
      .unwrap_or(sdr_settings.sample_rate)
  } else {
    sdr_settings.sample_rate
  }
}

pub fn resolve_device_sample_rate_options(
  device_connected: bool,
  device_info: &str,
  device_profile: &DeviceProfile,
  sdr_settings: &SdrConfig,
) -> (u32, Vec<u32>) {
  let ceiling = device_sample_rate_ceiling(
    device_connected,
    device_info,
    device_profile,
    sdr_settings,
  );
  let floor =
    if matches!(device_profile.kind.as_str(), "mock_apt" | "mock_apt_metal") {
      let config = signals_config();
      compute_min_receive_sample_rate(
        &config.signals.n_apt,
        config.signals.sdr.sample_rate,
      )
    } else {
      sdr_settings
        .min_receive_sample_rate
        .unwrap_or(sdr_settings.sample_rate)
    };

  if let Some(device_cfg) =
    sdr_settings.devices.get(device_config_key(device_profile))
  {
    (
      ceiling,
      device_cfg.sample_rate.resolve_options(floor, ceiling),
    )
  } else {
    (ceiling, vec![ceiling])
  }
}

pub fn status_device_backend_label(
  device_connected: bool,
  device_info: &str,
  device_profile: &super::types::DeviceProfile,
) -> String {
  if !device_connected {
    return mock_apt_backend_label(device_info).to_string();
  }

  match device_profile.kind.as_str() {
    "rtl-sdr" | "rtl_sdr" => "rtl-sdr".to_string(),
    "hackrf_one" => "hackrf_one".to_string(),
    "mock_tx" => "mock_tx".to_string(),
    kind => kind.to_string(),
  }
}

pub fn status_device_name(
  device_connected: bool,
  device_info: &str,
  device_profile: &super::types::DeviceProfile,
) -> String {
  if !device_connected {
    return mock_apt_device_name(device_info);
  }

  match device_profile.kind.as_str() {
    "rtl-sdr" | "rtl_sdr" => normalize_rtl_sdr_device_name(device_info),
    "hackrf_one" => "HackRF One".to_string(),
    "mock_tx" => "Mock Tx SDR".to_string(),
    _ => device_info
      .split(" - ")
      .next()
      .unwrap_or(device_info)
      .trim()
      .to_string(),
  }
}

pub fn next_missing_device_probe_streak(prev: u32, device_count: u32) -> u32 {
  if device_count == 0 {
    prev.saturating_add(1)
  } else {
    0
  }
}

pub fn should_declare_disconnected(missing_streak: u32) -> bool {
  missing_streak >= 3 // DISCONNECT_DEBOUNCE_STREAK
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::server::types::{DeviceProfile, NaptConfig, SpectrumFrameConfig};
  use indexmap::IndexMap;
  use std::time::{SystemTime, UNIX_EPOCH};

  #[test]
  fn load_sdr_settings_uses_manifest_dir_when_cwd_missing() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    let original_dir = std::env::current_dir().expect("current dir");
    let unique = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("time")
      .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!("napt-test-{}", unique));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");
    std::env::set_current_dir(&temp_dir).expect("set temp dir");

    let content = read_config_file("signals.yaml");
    assert!(
      content.is_some(),
      "expected signals.yaml at {}",
      env!("CARGO_MANIFEST_DIR")
    );
    let content = content.expect("signals.yaml content");
    let processed = preprocess_frequency_tags(&content.0);
    let processed = preprocess_sdr_sample_rate_tags(&processed);
    let value: serde_yaml::Value =
      serde_yaml::from_str(&processed).expect("parse signals.yaml into value");
    let sdr_value = value.get("signals").and_then(|v| v.get("sdr")).cloned();
    assert!(sdr_value.is_some(), "expected signals.sdr in signals.yaml");
    let parsed: Result<crate::server::types::SdrConfig, _> =
      serde_yaml::from_value(sdr_value.expect("signals.sdr value"));
    if parsed.is_err() {
      eprintln!("DESERIALIZATION ERROR: {:?}", parsed.as_ref().unwrap_err());
    }
    assert!(parsed.is_ok(), "expected signals.sdr to parse");

    let settings = load_sdr_settings();

    std::env::set_current_dir(&original_dir).expect("restore dir");
    let _ = std::fs::remove_dir_all(&temp_dir);
    assert_eq!(settings.sample_rate, parsed.unwrap().sample_rate);
  }

  #[test]
  fn normalizes_hackrf_one_status_fields_from_profile() {
    let profile = DeviceProfile {
      kind: "hackrf_one".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      iq_format: Some(crate::server::types::IqFormat::default()),
    };

    assert_eq!(
      status_device_name(
        true,
        "Great Scott Gadgets HackRF - Freq: 100 Hz, Rate: 200 Hz",
        &profile,
      ),
      "HackRF One"
    );
    assert_eq!(
      status_device_backend_label(true, "anything", &profile),
      "hackrf_one"
    );
    assert_eq!(device_config_key(&profile), "hackrf_one");
  }

  #[test]
  fn test_mock_tx_device_config_key_returns_mock_tx() {
    let profile = DeviceProfile {
      kind: "mock_tx".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      iq_format: Some(crate::server::types::IqFormat::default()),
    };

    assert_eq!(device_config_key(&profile), "mock_tx");
  }

  #[test]
  fn normalizes_generic_rtl2832u_oem_to_rtl_sdr_v4() {
    let profile = DeviceProfile {
      kind: "rtl_sdr".to_string(),
      is_rtl_sdr: true,
      supports_approx_dbm: true,
      iq_format: Some(crate::server::types::IqFormat::default()),
    };

    assert_eq!(
      status_device_name(true, "Generic RTL2832U OEM", &profile),
      "RTL-SDR v4"
    );
  }

  #[test]
  fn computes_hackrf_receive_floor_from_widest_channel() {
    let mut channels = IndexMap::new();
    channels.insert(
      "a".to_string(),
      SpectrumFrameConfig {
        label: "A".to_string(),
        freq_range_hz: vec![18_000.0, 4_390_000.0],
        description: "A".to_string(),
      },
    );
    channels.insert(
      "c".to_string(),
      SpectrumFrameConfig {
        label: "C".to_string(),
        freq_range_hz: vec![4_750_000.0, 23_000_000.0],
        description: "C".to_string(),
      },
    );
    let napt = NaptConfig { channels };
    let floor = compute_min_receive_sample_rate(&napt, 20_000_000);
    assert_eq!(floor, 9_125_000);
  }

  #[test]
  fn resolves_hackrf_sample_rate_options_from_device_ceiling() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    clear_signals_config_cache();

    let profile = DeviceProfile {
      kind: "hackrf_one".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      iq_format: Some(crate::server::types::IqFormat::default()),
    };

    let settings = load_sdr_settings();
    let (max_sample_rate, options) = resolve_device_sample_rate_options(
      true,
      "Great Scott Gadgets HackRF - Freq: 100 Hz, Rate: 2000000 Hz",
      &profile,
      &settings,
    );

    assert_eq!(max_sample_rate, 20_000_000);
    assert!(options.len() > 1);
    assert_eq!(options.last().copied(), Some(20_000_000));
  }

  #[test]
  fn resolves_mock_sample_rate_options_from_configured_whole_channel() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    clear_signals_config_cache();

    let profile = DeviceProfile {
      kind: "mock_apt".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      iq_format: Some(crate::server::types::IqFormat::default()),
    };
    let mut settings = load_sdr_settings();
    settings.sample_rate = 20_000_000;
    settings.min_receive_sample_rate = Some(9_125_000);

    let (max_sample_rate, options) = resolve_device_sample_rate_options(
      false,
      "Mock APT SDR - Freq: 1600000 Hz, Rate: 3200000 Hz (Sample Rate: 3200000 Hz), Gain: 49.6 dB, PPM: 1",
      &profile,
      &settings,
    );

    assert_eq!(max_sample_rate, 20_000_000);
    assert_eq!(options.first().copied(), Some(3_200_000));
    assert_eq!(options.last().copied(), Some(20_000_000));
    assert!(options.contains(&3_200_000));
  }

  #[test]
  fn signals_yaml_sets_mock_apt_max_sample_rate_to_20_mhz() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    clear_signals_config_cache();

    let settings = load_sdr_settings();
    let mock = settings
      .devices
      .get("mock_apt")
      .expect("mock_apt device config");

    assert_eq!(mock.max_sample_rate, Some(20_000_000));
  }

  #[test]
  fn resolves_rtl_sdr_sample_rate_options_to_exactly_3_2_mhz() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    clear_signals_config_cache();

    let profile = DeviceProfile {
      kind: "rtl_sdr".to_string(),
      is_rtl_sdr: true,
      supports_approx_dbm: true,
      iq_format: Some(crate::server::types::IqFormat::default()),
    };

    let settings = load_sdr_settings();
    let (max_sample_rate, options) = resolve_device_sample_rate_options(
      true,
      "RTL-SDR v4 - Freq: 1600000 Hz, Rate: 3200000 Hz",
      &profile,
      &settings,
    );

    assert_eq!(max_sample_rate, 3_200_000);
    assert_eq!(options, vec![3_200_000]);
  }

  #[test]
  fn signals_yaml_defaults_rtl_sdr_to_max_gain_and_one_ppm() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    clear_signals_config_cache();

    let settings = load_sdr_settings();
    let rtl = settings
      .devices
      .get("rtl_sdr")
      .expect("rtl_sdr device config");

    assert_eq!(settings.gain.tuner_gain, 46.9);
    assert_eq!(settings.ppm, 1.0);
    assert_eq!(
      rtl.gain_limits.as_ref().and_then(|limits| limits.max),
      Some(46.9)
    );
  }

  #[test]
  fn preprocesses_sdr_sample_rate_tags_for_device_blocks() {
    let yaml = r#"
signals:
  sdr:
    devices:
      rtl_sdr:
        sample_rate: !max
      hackrf_one:
        sample_rate: !floor...!max
"#;
    let processed = preprocess_sdr_sample_rate_tags(yaml);
    assert!(
      processed.contains("__NAPT_SAMPLE_RATE_MAX__"),
      "expected !max placeholder in processed YAML"
    );
    assert!(
      processed.contains("__NAPT_SAMPLE_RATE_FLOOR__"),
      "expected !floor placeholder in processed YAML"
    );
    let parsed: serde_yaml::Value =
      serde_yaml::from_str(&processed).expect("processed YAML should parse");
    let devices = parsed
      .get("signals")
      .and_then(|v| v.get("sdr"))
      .and_then(|v| v.get("devices"))
      .cloned()
      .expect("expected signals.sdr.devices");
    let rtl = devices
      .get("rtl_sdr")
      .and_then(|v| v.get("sample_rate"))
      .cloned()
      .expect("expected rtl_sdr sample_rate");
    let hack = devices
      .get("hackrf_one")
      .and_then(|v| v.get("sample_rate"))
      .cloned()
      .expect("expected hackrf_one sample_rate");
    let rtl_rate: Result<crate::server::types::SdrSampleRateSpec, _> =
      serde_yaml::from_value(rtl);
    let hack_rate: Result<crate::server::types::SdrSampleRateSpec, _> =
      serde_yaml::from_value(hack);
    assert!(rtl_rate.is_ok());
    assert!(hack_rate.is_ok());
  }

  #[test]
  fn load_channels_preserves_config_entry_order() {
    let yaml = r#"
signals:
  mock_apt:
    global_settings:
      noise_floor_base: 0.0
      noise_floor_variation: 0.0
      signal_drift_rate: 0.0
      signal_modulation_rate: 0.0
      signal_appearance_chance: 0.0
      signal_disappearance_chance: 0.0
      signal_strength_variation: 0.0
      dynamic_generation: false
      signals_per_area: 0
      area_a_density: 0.0
      area_b_density: 0.0
    bandwidths:
      narrow: 1
      medium: 2
      wide: 3
    strength_ranges:
      weak:
        min: 0.0
        max: 1.0
      medium:
        min: 1.0
        max: 2.0
      strong:
        min: 2.0
        max: 3.0
    signals: []
    training_areas: {}
  n_apt:
    channels:
      c:
        label: "C"
        freq_range_hz: [11000000.0, 23000000.0]
        description: "C"
      a:
        label: "A"
        freq_range_hz: [18000.0, 4370000.0]
        description: "A"
      b:
        label: "B"
        freq_range_hz: [24720000.0, 29880000.0]
        description: "B"
  sdr:
    sample_rate: 3200000
    center_frequency: 137500000
    gain:
      tuner_gain: 0.0
      rtl_agc: false
      tuner_agc: false
    ppm: 0.0
    fft:
      default_size: 2048
      default_frame_rate: 60
      max_size: 32768
      max_frame_rate: 60
      size_to_frame_rate: {}
    display:
      min_db: -120
      max_db: 0
      padding: 0
"#;

    let processed = preprocess_frequency_tags(yaml);
    let config: crate::server::types::SignalsConfig =
      serde_yaml::from_str(&processed).expect("parse test config");
    let ordered_ids: Vec<String> =
      config.signals.n_apt.channels.keys().cloned().collect();
    assert_eq!(ordered_ids, vec!["c", "a", "b"]);

    let mut out = Vec::new();
    for (id, f) in config.signals.n_apt.channels.clone() {
      out.push((id, f.label));
    }

    assert_eq!(
      out,
      vec![
        ("c".to_string(), "C".to_string()),
        ("a".to_string(), "A".to_string()),
        ("b".to_string(), "B".to_string())
      ]
    );
  }

  #[test]
  fn test_frequency_pipeline_parsing() {
    let yaml = r#"
signals:
  n_apt:
    channels:
      test_channel:
        label: "Test"
        freq_range_hz: !frequency_range 137.1MHz..137.9MHz
        description: "Test description"
  mock_apt:
    global_settings:
      noise_floor_base: 0.0
      noise_floor_variation: 0.0
      signal_drift_rate: 0.0
      signal_modulation_rate: 0.0
      signal_appearance_chance: 0.0
      signal_disappearance_chance: 0.0
      signal_strength_variation: 0.0
      dynamic_generation: false
      signals_per_area: 0
      area_a_density: 0.0
      area_b_density: 0.0
    bandwidths:
      narrow: 1
      medium: 2
      wide: 3
    strength_ranges:
      weak:
        min: 0.0
        max: 1.0
      medium:
        min: 1.0
        max: 2.0
      strong:
        min: 2.0
        max: 3.0
    signals: []
    training_areas: {}
  sdr:
    center_frequency: !frequency 137.5MHz
    sample_rate: 3200000
    gain:
      tuner_gain: 20
      rtl_agc: false
      tuner_agc: false
    ppm: 0
    fft:
      default_size: 8192
      default_frame_rate: 60
      max_size: 32768
      max_frame_rate: 60
      size_to_frame_rate: {}
    display:
      min_db: -120
      max_db: 0
      padding: 0
"#;
    let processed = preprocess_frequency_tags(yaml);
    let config: crate::server::types::SignalsConfig =
      serde_yaml::from_str(&processed).expect("parse yaml");

    // Check channel ranges
    let channel = config
      .signals
      .n_apt
      .channels
      .get("test_channel")
      .expect("test_channel");
    assert_eq!(channel.freq_range_hz[0], 137_100_000.0);
    assert_eq!(channel.freq_range_hz[1], 137_900_000.0);

    // Check SDR center frequency
    assert_eq!(config.signals.sdr.center_frequency, 137_500_000);
  }

  #[test]
  fn test_capture_result_metadata_integrity() {
    let result = crate::sdr::processor::CaptureResult {
      job_id: "test-job".to_string(),
      channels: vec![],
      file_type: ".wav".to_string(),
      acquisition_mode: "live".to_string(),
      duration_mode: "fixed".to_string(),
      encrypted: false,
      fft_size: 32768,
      duration_s: 1.0,
      actual_frame_count: 100,
      fft_window: "blackman".to_string(),
      gain: 20.0,
      ppm: 0,
      tuner_agc: false,
      rtl_agc: false,
      source_device: "RTL-SDR".to_string(),
      hardware_sample_rate_hz: 3_200_000.0,
      overall_center_frequency_hz: 137_500_000.0,
      overall_capture_sample_rate_hz: 3_200_000.0,
      geolocation: None,
      frequency_range: Some((137_100_000.0, 137_900_000.0)),
      ref_based_demod_baseline: None,
      is_mock_apt: false,
      is_ephemeral: false,
      dek: None,
      bandwidth: None,
      bandwidth_center_frequency: None,
      frame_updates: Vec::new(),
      device_profile: None,
    };

    // We can't call save_capture_file_multi easily because it writes to disk,
    // but we can simulate the metadata creation part.
    let meta_obj = serde_json::json!({
      "center_frequency_hz": result.overall_center_frequency_hz,
      "capture_sample_rate_hz": result.overall_capture_sample_rate_hz,
      "hardware_sample_rate_hz": result.hardware_sample_rate_hz,
    });

    assert_eq!(
      meta_obj["center_frequency_hz"].as_f64().unwrap(),
      137_500_000.0
    );
    assert_eq!(
      meta_obj["capture_sample_rate_hz"].as_f64().unwrap(),
      3_200_000.0
    );
  }

  #[test]
  fn test_preprocess_frequency_tags() {
    let yaml = r#"
signals:
  sdr:
    sample_rate: !frequency 2.4MHz
    center_frequency: !frequency 137.5MHz
    gain:
      tuner_gain: 49.6
      rtl_agc: false
      tuner_agc: false
    ppm: 1.0
    fft:
      default_size: 32768
      default_frame_rate: 60
      max_size: 262144
      max_frame_rate: 60
      size_to_frame_rate: {}
    display:
      min_db: -120
      max_db: 0
      padding: 20
"#;

    let processed = preprocess_frequency_tags(yaml);
    let value: serde_yaml::Value =
      serde_yaml::from_str(&processed).expect("parse yaml");
    let sdr = value
      .get("signals")
      .and_then(|v| v.get("sdr"))
      .expect("get sdr");
    let config: crate::server::types::SdrConfig =
      serde_yaml::from_value(sdr.clone()).expect("parse frequency test");

    assert_eq!(config.sample_rate, 2_400_000);
    assert_eq!(config.center_frequency, 137_500_000);
  }

  #[test]
  fn test_preprocess_frequency_tags_ghz() {
    let yaml = r#"
signals:
  sdr:
    sample_rate: !frequency 2.4GHz
    center_frequency: !frequency 1.6GHz
    gain:
      tuner_gain: 0.0
      rtl_agc: false
      tuner_agc: false
    ppm: 0.0
    fft:
      default_size: 2048
      default_frame_rate: 60
      max_size: 32768
      max_frame_rate: 60
      size_to_frame_rate: {}
    display:
      min_db: -120
      max_db: 0
      padding: 20
"#;

    let processed = preprocess_frequency_tags(yaml);
    let value: serde_yaml::Value =
      serde_yaml::from_str(&processed).expect("parse yaml");
    let sdr = value
      .get("signals")
      .and_then(|v| v.get("sdr"))
      .expect("get sdr");
    let config: crate::server::types::SdrConfig =
      serde_yaml::from_value(sdr.clone()).expect("parse GHz test");

    assert_eq!(config.sample_rate, 2_400_000_000);
    assert_eq!(config.center_frequency, 1_600_000_000);
  }

  #[test]
  fn test_preprocess_frequency_tags_khz() {
    let yaml = r#"
signals:
  sdr:
    sample_rate: !frequency 100kHz
    center_frequency: !frequency 18kHz
    gain:
      tuner_gain: 0.0
      rtl_agc: false
      tuner_agc: false
    ppm: 0.0
    fft:
      default_size: 2048
      default_frame_rate: 60
      max_size: 32768
      max_frame_rate: 60
      size_to_frame_rate: {}
    display:
      min_db: -120
      max_db: 0
      padding: 20
"#;

    let processed = preprocess_frequency_tags(yaml);
    // Debug: print first 500 chars of processed YAML
    eprintln!(
      "Processed YAML (first 500 chars):\n{}",
      &processed[..processed.len().min(500)]
    );
    let value: serde_yaml::Value =
      serde_yaml::from_str(&processed).expect("parse yaml");
    let sdr = value
      .get("signals")
      .and_then(|v| v.get("sdr"))
      .expect("get sdr");
    let config: crate::server::types::SdrConfig =
      serde_yaml::from_value(sdr.clone()).expect("parse kHz test");

    assert_eq!(config.sample_rate, 100_000);
    assert_eq!(config.center_frequency, 18_000);
  }

  #[test]
  fn test_preprocess_frequency_range_syntax() {
    let yaml = r#"
n_apt:
  channels:
    a:
      label: "A"
      freq_range_hz: !frequency_range 18kHz..4.47MHz
      description: "Test"
"#;

    let processed = preprocess_frequency_tags(yaml);
    let value: serde_yaml::Value =
      serde_yaml::from_str(&processed).expect("parse yaml");
    let channel = value
      .get("n_apt")
      .and_then(|v| v.get("channels"))
      .and_then(|v| v.get("a"))
      .expect("get channel");

    let freq_range = channel.get("freq_range_hz").expect("get freq_range");
    let arr = freq_range.as_sequence().expect("should be array");

    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0].as_f64().expect("start"), 18000.0);
    assert_eq!(arr[1].as_f64().expect("end"), 4470000.0);
  }

  #[test]
  fn test_preprocess_debug_real_yaml() {
    let path =
      std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("signals.yaml");
    let content = std::fs::read_to_string(path).expect("read signals.yaml");
    let processed = preprocess_frequency_tags(&content);
    let value: serde_yaml::Value =
      serde_yaml::from_str(&processed).expect("parse yaml");
    let signals = value.get("signals").expect("get signals");
    let mock_apt = signals.get("mock_apt");
    assert!(mock_apt.is_some(), "mock_apt should exist");
    let n_apt = signals.get("n_apt");
    assert!(n_apt.is_some(), "n_apt should exist");
    let sdr = signals.get("sdr");
    assert!(sdr.is_some(), "sdr should exist");

    // Check specific values
    let n_apt = n_apt.unwrap();
    let channels = n_apt.get("channels").unwrap();
    let channel_a = channels.get("a").unwrap();
    let freq_range = channel_a.get("freq_range_hz").unwrap();
    let arr = freq_range.as_sequence().unwrap();
    let start = arr[0].as_f64().unwrap();
    let end = arr[1].as_f64().unwrap();
    eprintln!("Channel A freq_range: [{}, {}]", start, end);
    assert_eq!(start, 18000.0, "start should be 18kHz = 18000.0 Hz");
    assert_eq!(end, 4390000.0, "end should be 4.39MHz = 4390000.0 Hz");
  }

  #[test]
  fn real_signals_yaml_enables_mock_tx_source() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    clear_signals_config_cache();
    let original_dir = std::env::current_dir().expect("current dir");
    std::env::set_current_dir(env!("CARGO_MANIFEST_DIR"))
      .expect("set manifest dir");

    let config = signals_config();

    std::env::set_current_dir(original_dir).expect("restore dir");
    clear_signals_config_cache();
    assert!(config.signals.mock_tx.enabled);
  }

  #[test]
  fn real_signals_yaml_sets_mock_tx_noise_floor() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    clear_signals_config_cache();
    let original_dir = std::env::current_dir().expect("current dir");
    std::env::set_current_dir(env!("CARGO_MANIFEST_DIR"))
      .expect("set manifest dir");

    let config = signals_config();

    std::env::set_current_dir(original_dir).expect("restore dir");
    clear_signals_config_cache();
    assert_eq!(config.signals.mock_tx.noise_floor_db, Some(-100.0));
  }

  #[test]
  fn test_hackrf_one_tx_power_mapping_parses() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    clear_signals_config_cache();
    let sdr_settings = load_sdr_settings();
    let hackrf_cfg = sdr_settings
      .devices
      .get("hackrf_one")
      .expect("hackrf_one should exist");
    let tx_mapping = hackrf_cfg
      .tx_power_mapping
      .as_ref()
      .expect("tx_power_mapping should exist");

    // Validate some points in the mapping
    assert_eq!(tx_mapping.amp_off.len(), 10);
    assert_eq!(tx_mapping.amp_on.len(), 7);

    assert_eq!(tx_mapping.amp_off[0].vga, 0);
    assert_eq!(tx_mapping.amp_off[0].dbm, -7.5);

    assert_eq!(tx_mapping.amp_on[6].vga, 47);
    assert_eq!(tx_mapping.amp_on[6].dbm, 15.0);
  }

  #[test]
  fn test_hackrf_one_tx_iq_power_model_parses() {
    let _guard = cwd_lock().lock().expect("cwd lock");
    clear_signals_config_cache();
    let sdr_settings = load_sdr_settings();
    let hackrf_cfg = sdr_settings
      .devices
      .get("hackrf_one")
      .expect("hackrf_one should exist");
    let tx_iq_power_model = hackrf_cfg
      .tx_iq_power_model
      .as_ref()
      .expect("tx_iq_power_model should exist");

    assert_eq!(tx_iq_power_model.iq_encoding, "offset_binary_u8");
    assert_eq!(tx_iq_power_model.signed_range, [-128, 127]);
    assert_eq!(tx_iq_power_model.normalized_sample, "(byte - 128) / 127");
    assert_eq!(
      tx_iq_power_model.complex_rms_formula,
      "sqrt(mean(i_norm^2 + q_norm^2))"
    );
    assert_eq!(
      tx_iq_power_model.dbm_formula,
      "20 * log10(complex_rms) + calibration_db"
    );
    assert_eq!(
      tx_iq_power_model.inverse_rms_formula,
      "10 ** ((dbm - calibration_db) / 20)"
    );
    assert_eq!(tx_iq_power_model.calibration_db, 15.0);
  }
}

/// A writer wrapper that calculates SHA256 checksum and tracks size on the fly.
struct HashingWriter<W: std::io::Write> {
  inner: W,
  hasher: sha2::Sha256,
  bytes_written: u64,
}

impl<W: std::io::Write> HashingWriter<W> {
  fn new(inner: W) -> Self {
    Self {
      inner,
      hasher: sha2::Sha256::new(),
      bytes_written: 0,
    }
  }

  fn finalize(self) -> (String, u64) {
    let checksum = self
      .hasher
      .finalize()
      .iter()
      .map(|b| format!("{:02x}", b))
      .collect::<String>();
    (checksum, self.bytes_written)
  }
}

impl<W: std::io::Write> std::io::Write for HashingWriter<W> {
  fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
    let n = self.inner.write(buf)?;
    self.hasher.update(&buf[..n]);
    self.bytes_written += n as u64;
    Ok(n)
  }

  fn flush(&mut self) -> std::io::Result<()> {
    self.inner.flush()
  }
}

/// Save capture IQ data to a file (.wav with metadata, or encrypted .napt)
/// Supports multiple channels.
pub fn save_capture_file_multi(
  result: &crate::sdr::processor::CaptureResult,
  encryption_key: &[u8; 32],
) -> Result<CaptureArtifact, String> {
  // SECURITY: Strict validation of job_id to prevent Path Traversal.
  // Only alphanumeric characters, underscores, and hyphens are allowed.
  if !RE_SAFE_ID.is_match(&result.job_id) {
    return Err(format!("Invalid job_id: '{}'", result.job_id));
  }

  // SECURITY: Strict validation of file_type.
  if result.file_type != ".napt"
    && result.file_type != ".wav"
    && result.file_type != ".iq"
  {
    return Err(format!("Unsupported file_type: '{}'", result.file_type));
  }

  // Create temp directory if it doesn't exist
  let temp_dir = std::env::temp_dir().join("n-apt-captures");
  std::fs::create_dir_all(&temp_dir)
    .map_err(|e| format!("Failed to create temp dir: {}", e))?;

  let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
  let filename = if result.file_type == ".iq" {
    format!("capture_{}_{}.iq", result.job_id, timestamp)
  } else if result.encrypted && result.file_type == ".napt" {
    format!("capture_{}_{}.napt", result.job_id, timestamp)
  } else {
    // default to wav for non-encrypted capture
    format!("capture_{}_{}.wav", result.job_id, timestamp)
  };

  let path = temp_dir.join(&filename);
  let timestamp_utc = chrono::Utc::now().to_rfc3339();

  // Basic metadata shared by both formats
  let mut meta_obj = serde_json::json!({
    "center_frequency_hz": result.overall_center_frequency_hz,
    "capture_sample_rate_hz": result.overall_capture_sample_rate_hz,
    "hardware_sample_rate_hz": result.hardware_sample_rate_hz,
    "encrypted": result.encrypted,
    "timestamp_utc": timestamp_utc,
    "frame_rate": if result.duration_s > 0.0 { result.actual_frame_count as f64 / result.duration_s } else { 0.0 },
    "fft_size": result.fft_size,
    "fft_window": result.fft_window,
    "duration_s": result.duration_s,
    "acquisition_mode": result.acquisition_mode,
    "source_device": result.source_device,
    "gain": result.gain,
    "ppm": result.ppm,
    "tuner_agc": result.tuner_agc,
    "rtl_agc": result.rtl_agc,
    "data_format": "iq_u8",
    "spectrum_shifted": true,
    "format": if result.file_type == ".iq" { "iq" } else if result.file_type == ".wav" { "wav" } else { "napt" },
    "format_version": 3,
    "interleaving": "IQ",
    "device_profile": {
      "kind": result.source_device,
      "firmware_version": serde_json::Value::Null,
    },
  });

  if let Some(baseline) = &result.ref_based_demod_baseline {
    meta_obj["ref_based_demod_baseline"] = serde_json::json!(baseline);
  }

  if let Some((min_hz, max_hz)) = result.frequency_range {
    meta_obj["frequency_range"] = serde_json::json!([min_hz, max_hz]);
  }

  if let Some(bw) = result.bandwidth {
    meta_obj["bandwidth"] = serde_json::json!(bw);
  }

  if let Some(bw_cf) = result.bandwidth_center_frequency {
    meta_obj["bandwidth_center_frequency"] = serde_json::json!(bw_cf);
  }

  // Add geolocation data if available
  if let Some(geo) = &result.geolocation {
    meta_obj["geolocation"] = serde_json::json!({
      "latitude": geo.latitude,
      "longitude": geo.longitude,
      "accuracy": geo.accuracy,
      "altitude": geo.altitude,
      "timestamp": geo.timestamp,
    });
  }

  if result.file_type == ".iq" {
    meta_obj["channels"] = serde_json::Value::Array(
      result
        .channels
        .iter()
        .map(|ch| {
          serde_json::json!({
            "center_freq_hz": ch.center_freq_hz,
            "sample_rate_hz": ch.sample_rate_hz,
            "bins_per_frame": ch.bins_per_frame,
            "label": ch.label,
          })
        })
        .collect(),
    );
    let mut fields = meta_obj.as_object().cloned().unwrap_or_default();
    for key in [
      "format",
      "format_version",
      "interleaving",
      "sample_encoding",
    ] {
      fields.remove(key);
    }
    let metadata = crate::server::iq_format::IqMetadata {
      fields,
      ..Default::default()
    };
    let iq_file = crate::server::iq_format::IqFile {
      metadata,
      private_metadata: if result.encrypted {
        result.device_profile.clone()
      } else {
        None
      },
      frames: result.frame_updates.clone(),
      chunks: result
        .channels
        .iter()
        .enumerate()
        .map(|(channel, ch)| crate::server::iq_format::IqChunk {
          sample_offset: 0,
          channel: channel as u32,
          data: ch.iq_data.clone(),
        })
        .collect(),
    };
    let encoded = crate::server::iq_format::encode(
      &iq_file,
      if result.encrypted {
        Some(encryption_key)
      } else {
        None
      },
    )?;
    let mut hasher = sha2::Sha256::new();
    hasher.update(&encoded);
    let checksum = hasher
      .finalize()
      .iter()
      .map(|b| format!("{b:02x}"))
      .collect::<String>();
    std::fs::write(&path, &encoded)
      .map_err(|e| format!("Failed to write IQ: {e}"))?;
    return Ok(CaptureArtifact {
      filename,
      path,
      file_size: encoded.len() as u64,
      checksum,
    });
  } else if result.encrypted && result.file_type == ".napt" {
    // Construct plaintext: JSON header with `channels` array + padding + Concatenated Data
    let header_size = 4096; // Larger header for multi-channel JSON
    let mut payload_plaintext = Vec::new();
    let mut channel_metas = Vec::new();

    for ch in &result.channels {
      let offset_iq = payload_plaintext.len();
      payload_plaintext.extend_from_slice(&ch.iq_data);
      let iq_len = ch.iq_data.len();

      channel_metas.push(serde_json::json!({
          "center_freq_hz": ch.center_freq_hz,
          "sample_rate_hz": ch.sample_rate_hz,
          "requested_min_freq_hz": ch.requested_min_freq_hz,
          "requested_max_freq_hz": ch.requested_max_freq_hz,
          "offset_iq": offset_iq,
          "iq_length": iq_len,
          "bins_per_frame": ch.bins_per_frame,
          "label": ch.label,
      }));
    }

    meta_obj["channels"] = serde_json::Value::Array(channel_metas);

    // Phase 2: Per-file key wrapping
    // 1. Use the DEK from result if available, otherwise generate a unique one
    let dek = result.dek.unwrap_or_else(|| crate::crypto::generate_key());

    // 2. Wrap the DEK using the vault key
    let wrapped_dek_bytes =
      crate::crypto::encrypt_payload_binary(encryption_key, &dek)
        .map_err(|e| format!("DEK wrapping failed: {}", e))?;

    // 3. Store the wrapped DEK in metadata
    meta_obj["wrapped_dek"] =
      serde_json::json!(crate::crypto::to_base64(&wrapped_dek_bytes));

    // Header JSON for .napt
    let complete_json = format!(r#"{{"metadata":{}}}"#, meta_obj);

    let file = std::fs::File::create(&path)
      .map_err(|e| format!("Failed to create file: {}", e))?;
    let mut writer = HashingWriter::new(file);

    // Write the plaintext JSON header
    writer
      .write_all(complete_json.as_bytes())
      .map_err(|e| format!("Failed to write header: {}", e))?;

    // Pad the header
    let mut padded_len = complete_json.len();
    if padded_len < header_size {
      writer.write_all(b"\n").map_err(|e| e.to_string())?;
      padded_len += 1;
      let padding = vec![b' '; header_size - padded_len];
      writer.write_all(&padding).map_err(|e| e.to_string())?;
    } else {
      return Err("Metadata size exceeds header_size".to_string());
    }

    // Now encrypt ONLY the fast data (IQ and Spectrum) using the DEK
    let encrypted_data =
      crate::crypto::encrypt_payload_binary(&dek, &payload_plaintext)
        .map_err(|e| format!("Encryption failed: {}", e))?;

    writer
      .write_all(&encrypted_data)
      .map_err(|e| format!("Failed to write encrypted data: {}", e))?;

    writer
      .flush()
      .map_err(|e| format!("Failed to flush file: {}", e))?;

    let (checksum, file_size) = writer.finalize();

    info!(
      "Saved encrypted capture: {} ({} bytes, sha256:{})",
      path.display(),
      file_size,
      checksum
    );

    return Ok(CaptureArtifact {
      filename,
      path,
      file_size,
      checksum,
    });
  } else {
    let file = std::fs::File::create(&path)
      .map_err(|e| format!("Failed to create file: {}", e))?;
    let mut writer = HashingWriter::new(file);

    if result.channels.is_empty() {
      return Err("No channels to save".to_string());
    }

    // ... (RIFF header calculation remains same)
    let channels_count: u16 = 2; // I and Q as stereo channels
    let bits_per_sample: u16 = 8;
    let sample_rate = result.channels[0].sample_rate_hz as u32;
    let byte_rate: u32 =
      sample_rate * channels_count as u32 * (bits_per_sample as u32 / 8);
    let block_align: u16 = channels_count * (bits_per_sample / 8);

    // nAPT metadata chunk
    let mut meta_with_channels = meta_obj.clone();
    let mut chan_list = Vec::new();
    for ch in &result.channels {
      chan_list.push(serde_json::json!({
          "center_freq_hz": ch.center_freq_hz,
          "sample_rate_hz": ch.sample_rate_hz,
          "bins_per_frame": ch.bins_per_frame,
          "label": ch.label,
      }));
    }
    meta_with_channels["channels"] = serde_json::Value::Array(chan_list);
    let meta_json = meta_with_channels.to_string();
    let meta_bytes = meta_json.as_bytes();
    let meta_padding = if (meta_bytes.len() + 1).is_multiple_of(2) {
      0u32
    } else {
      1u32
    };
    let meta_chunk_size = meta_bytes.len() as u32 + 1 + meta_padding;

    let mut iq_chunks = Vec::new();
    let mut riff_total_delta: u32 = 0;

    for (i, ch) in result.channels.iter().enumerate() {
      let tag = if i == 0 {
        "data".to_string()
      } else {
        format!("nIQ{}", i)
      };
      let iq_data = &ch.iq_data;
      let iq_size = iq_data.len() as u32;
      let iq_padding = if iq_size.is_multiple_of(2) {
        0u32
      } else {
        1u32
      };
      iq_chunks.push((tag, iq_size, iq_padding));
      riff_total_delta += 8 + iq_size + iq_padding;
    }

    let riff_size = 4 + 24 + (8 + meta_chunk_size) + riff_total_delta;

    // RIFF header
    writer.write_all(b"RIFF").map_err(|e| e.to_string())?;
    writer
      .write_all(&riff_size.to_le_bytes())
      .map_err(|e| e.to_string())?;
    writer.write_all(b"WAVE").map_err(|e| e.to_string())?;

    // fmt chunk
    writer.write_all(b"fmt ").map_err(|e| e.to_string())?;
    writer
      .write_all(&16u32.to_le_bytes())
      .map_err(|e| e.to_string())?;
    writer
      .write_all(&1u16.to_le_bytes())
      .map_err(|e| e.to_string())?; // PCM
    writer
      .write_all(&channels_count.to_le_bytes())
      .map_err(|e| e.to_string())?;
    writer
      .write_all(&sample_rate.to_le_bytes())
      .map_err(|e| e.to_string())?;
    writer
      .write_all(&byte_rate.to_le_bytes())
      .map_err(|e| e.to_string())?;
    writer
      .write_all(&block_align.to_le_bytes())
      .map_err(|e| e.to_string())?;
    writer
      .write_all(&bits_per_sample.to_le_bytes())
      .map_err(|e| e.to_string())?;

    // nAPT chunk
    writer.write_all(b"nAPT").map_err(|e| e.to_string())?;
    writer
      .write_all(&meta_chunk_size.to_le_bytes())
      .map_err(|e| e.to_string())?;
    writer.write_all(meta_bytes).map_err(|e| e.to_string())?;
    writer.write_all(&[0u8]).map_err(|e| e.to_string())?;
    for _ in 0..meta_padding {
      writer.write_all(&[0u8]).map_err(|e| e.to_string())?;
    }

    // Write IQ Chunks
    for (i, (tag, size, padding)) in iq_chunks.iter().enumerate() {
      writer
        .write_all(tag.as_bytes())
        .map_err(|e| e.to_string())?;
      writer
        .write_all(&size.to_le_bytes())
        .map_err(|e| e.to_string())?;
      writer
        .write_all(&result.channels[i].iq_data)
        .map_err(|e| e.to_string())?;
      if *padding > 0 {
        writer.write_all(&[0u8]).map_err(|e| e.to_string())?;
      }
    }

    writer.flush().map_err(|e| e.to_string())?;
    let (checksum, file_size) = writer.finalize();

    info!(
      "Saved WAV capture: {} ({} bytes, sha256:{})",
      path.display(),
      file_size,
      checksum
    );

    Ok(CaptureArtifact {
      filename,
      path,
      file_size,
      checksum,
    })
  }
}

#[cfg(test)]
mod save_tests {
  use super::*;
  use crate::sdr::processor::{CaptureChannel, CaptureResult};
  use std::fs;

  /// Deterministic test encryption key — avoids hard-coded zero-byte arrays
  /// that CodeQL flags as "hard-coded cryptographic value".
  fn test_encryption_key() -> [u8; 32] {
    crate::crypto::derive_key("test-fixture-key")
  }

  #[test]
  fn test_save_capture_file_multi_checksum() {
    let result = CaptureResult {
      job_id: "test_checksum".to_string(),
      channels: vec![CaptureChannel {
        center_freq_hz: 137.5e6,
        sample_rate_hz: 2.4e6,
        requested_min_freq_hz: None,
        requested_max_freq_hz: None,
        iq_data: vec![1u8; 200], // Different data to ensure unique checksum
        spectrum_data: vec![0f32; 10],
        bins_per_frame: 10,
        label: None,
      }],
      file_type: ".wav".to_string(), // Test unencrypted format
      acquisition_mode: "stepwise".to_string(),
      duration_mode: "timed".to_string(),
      encrypted: false,
      fft_size: 2048,
      duration_s: 1.0,
      actual_frame_count: 60,
      fft_window: "Hanning".to_string(),
      gain: 1.0,
      ppm: 0,
      tuner_agc: false,
      rtl_agc: false,
      source_device: "Test SDR".to_string(),
      hardware_sample_rate_hz: 2.4e6,
      overall_center_frequency_hz: 137.5e6,
      overall_capture_sample_rate_hz: 2.4e6,
      geolocation: None,
      frequency_range: Some((136.3, 138.7)),
      is_ephemeral: false,
      is_mock_apt: false,
      ref_based_demod_baseline: None,
      dek: None,
      bandwidth: None,
      bandwidth_center_frequency: None,
      frame_updates: Vec::new(),
      device_profile: None,
    };

    let artifact = save_capture_file_multi(&result, &test_encryption_key())
      .expect("save multi .wav with checksum");

    // Verify checksum is present and is a valid SHA256 hash (64 hex characters)
    assert!(
      !artifact.checksum.is_empty(),
      "Checksum should not be empty"
    );
    assert_eq!(
      artifact.checksum.len(),
      64,
      "SHA256 checksum should be 64 hex characters"
    );
    assert!(
      artifact.checksum.chars().all(|c| c.is_ascii_hexdigit()),
      "Checksum should only contain hex characters"
    );

    // Verify the checksum is consistent by calculating it again
    use sha2::Digest;
    let file_content =
      fs::read(&artifact.path).expect("read file for checksum verification");
    let expected_checksum = sha2::Sha256::digest(&file_content)
      .iter()
      .map(|b| format!("{:02x}", b))
      .collect::<String>();
    assert_eq!(
      artifact.checksum, expected_checksum,
      "Stored checksum should match calculated checksum"
    );

    // Verify file size is still correct
    assert_eq!(artifact.file_size, file_content.len() as u64);

    // Clean up
    let _ = fs::remove_file(artifact.path);
  }

  #[test]
  fn test_save_capture_file_multi_checksum_encrypted() {
    let result = CaptureResult {
      job_id: "test_checksum_enc".to_string(),
      channels: vec![CaptureChannel {
        center_freq_hz: 137.5e6,
        sample_rate_hz: 2.4e6,
        requested_min_freq_hz: None,
        requested_max_freq_hz: None,
        iq_data: vec![2u8; 150], // Different data for encrypted test
        spectrum_data: vec![0f32; 10],
        bins_per_frame: 10,
        label: None,
      }],
      file_type: ".napt".to_string(), // Test encrypted format
      acquisition_mode: "interleaved".to_string(),
      duration_mode: "timed".to_string(),
      encrypted: true,
      fft_size: 2048,
      duration_s: 1.0,
      actual_frame_count: 60,
      fft_window: "Hanning".to_string(),
      gain: 1.0,
      ppm: 0,
      tuner_agc: false,
      rtl_agc: false,
      source_device: "Test Encrypted SDR".to_string(),
      hardware_sample_rate_hz: 2.4e6,
      overall_center_frequency_hz: 137.5e6,
      overall_capture_sample_rate_hz: 2.4e6,
      geolocation: None,
      frequency_range: Some((136.3, 138.7)),
      is_ephemeral: false,
      is_mock_apt: false,
      ref_based_demod_baseline: None,
      dek: None,
      bandwidth: None,
      bandwidth_center_frequency: None,
      frame_updates: Vec::new(),
      device_profile: None,
    };

    let artifact = save_capture_file_multi(&result, &test_encryption_key())
      .expect("save multi .napt with checksum");

    // Verify checksum is present and valid for encrypted files too
    assert!(
      !artifact.checksum.is_empty(),
      "Checksum should not be empty for encrypted files"
    );
    assert_eq!(
      artifact.checksum.len(),
      64,
      "SHA256 checksum should be 64 hex characters"
    );
    assert!(
      artifact.checksum.chars().all(|c| c.is_ascii_hexdigit()),
      "Checksum should only contain hex characters"
    );

    // Verify the checksum matches the actual file content
    use sha2::Digest;
    let file_content = fs::read(&artifact.path)
      .expect("read encrypted file for checksum verification");
    let expected_checksum = sha2::Sha256::digest(&file_content)
      .iter()
      .map(|b| format!("{:02x}", b))
      .collect::<String>();
    assert_eq!(
      artifact.checksum, expected_checksum,
      "Stored checksum should match calculated checksum for encrypted files"
    );

    // Clean up
    let _ = fs::remove_file(artifact.path);
  }

  #[test]
  fn test_save_capture_file_multi_checksum_uniqueness() {
    let result1 = CaptureResult {
      job_id: "test_unique1".to_string(),
      channels: vec![CaptureChannel {
        center_freq_hz: 137.5e6,
        sample_rate_hz: 2.4e6,
        requested_min_freq_hz: None,
        requested_max_freq_hz: None,
        iq_data: vec![1u8; 100], // Different data
        spectrum_data: vec![0f32; 10],
        bins_per_frame: 10,
        label: None,
      }],
      file_type: ".wav".to_string(),
      acquisition_mode: "stepwise".to_string(),
      duration_mode: "timed".to_string(),
      encrypted: false,
      fft_size: 2048,
      duration_s: 1.0,
      actual_frame_count: 60,
      fft_window: "Hanning".to_string(),
      gain: 1.0,
      ppm: 0,
      tuner_agc: false,
      rtl_agc: false,
      source_device: "Test SDR".to_string(),
      hardware_sample_rate_hz: 2.4e6,
      overall_center_frequency_hz: 137.5e6,
      overall_capture_sample_rate_hz: 2.4e6,
      geolocation: None,
      frequency_range: Some((136.3, 138.7)),
      is_ephemeral: false,
      is_mock_apt: false,
      ref_based_demod_baseline: None,
      dek: None,
      bandwidth: None,
      bandwidth_center_frequency: None,
      frame_updates: Vec::new(),
      device_profile: None,
    };

    let result2 = CaptureResult {
      job_id: "test_unique2".to_string(),
      channels: vec![CaptureChannel {
        center_freq_hz: 137.5e6,
        sample_rate_hz: 2.4e6,
        requested_min_freq_hz: None,
        requested_max_freq_hz: None,
        iq_data: vec![2u8; 100], // Different data
        spectrum_data: vec![0f32; 10],
        bins_per_frame: 10,
        label: None,
      }],
      file_type: ".wav".to_string(),
      acquisition_mode: "stepwise".to_string(),
      duration_mode: "timed".to_string(),
      encrypted: false,
      fft_size: 2048,
      duration_s: 1.0,
      actual_frame_count: 60,
      fft_window: "Hanning".to_string(),
      gain: 1.0,
      ppm: 0,
      tuner_agc: false,
      rtl_agc: false,
      source_device: "Test SDR".to_string(),
      hardware_sample_rate_hz: 2.4e6,
      overall_center_frequency_hz: 137.5e6,
      overall_capture_sample_rate_hz: 2.4e6,
      geolocation: None,
      frequency_range: Some((136.3, 138.7)),
      is_ephemeral: false,
      is_mock_apt: false,
      ref_based_demod_baseline: None,
      dek: None,
      bandwidth: None,
      bandwidth_center_frequency: None,
      frame_updates: Vec::new(),
      device_profile: None,
    };

    let artifact1 = save_capture_file_multi(&result1, &test_encryption_key())
      .expect("save first file");
    let artifact2 = save_capture_file_multi(&result2, &test_encryption_key())
      .expect("save second file");

    // Verify checksums are different for different files
    assert_ne!(
      artifact1.checksum, artifact2.checksum,
      "Different files should have different checksums"
    );

    // Clean up
    let _ = fs::remove_file(artifact1.path);
    let _ = fs::remove_file(artifact2.path);
  }

  #[test]
  fn test_save_capture_file_multi_metadata() {
    let result = CaptureResult {
      job_id: "test_multi".to_string(),
      channels: vec![CaptureChannel {
        center_freq_hz: 137.5e6,
        sample_rate_hz: 2.4e6,
        requested_min_freq_hz: None,
        requested_max_freq_hz: None,
        iq_data: vec![0u8; 100],
        spectrum_data: vec![0f32; 10],
        bins_per_frame: 10,
        label: None,
      }],
      file_type: ".napt".to_string(),
      acquisition_mode: "interleaved".to_string(),
      duration_mode: "timed".to_string(),
      encrypted: true,
      fft_size: 2048,
      duration_s: 1.0,
      actual_frame_count: 60,
      fft_window: "Hanning".to_string(),
      gain: 1.0,
      ppm: 0,
      tuner_agc: false,
      rtl_agc: false,
      source_device: "Mock APT SDR".to_string(),
      hardware_sample_rate_hz: 2.4e6,
      overall_center_frequency_hz: 137.5e6,
      overall_capture_sample_rate_hz: 2.4e6,
      geolocation: None,
      frequency_range: Some((136.3, 138.7)),
      is_ephemeral: false,
      is_mock_apt: true,
      ref_based_demod_baseline: None,
      dek: None,
      bandwidth: None,
      bandwidth_center_frequency: None,
      frame_updates: Vec::new(),
      device_profile: None,
    };

    let result_napt = save_capture_file_multi(&result, &test_encryption_key())
      .expect("save multi .napt");

    let content_napt_bytes = fs::read(&result_napt.path).expect("read .napt");
    let content_napt = String::from_utf8_lossy(&content_napt_bytes);

    // Verify Phase 2: Per-file key wrapping
    assert!(
      content_napt.contains(r#""wrapped_dek":"#),
      "Missing wrapped_dek in .napt metadata"
    );
    assert!(
      content_napt.contains(r#""acquisition_mode":"interleaved""#),
      "Missing acquisition_mode"
    );
    assert!(
      content_napt.contains(r#""source_device":"Mock APT SDR""#),
      "Missing source_device"
    );
    assert!(
      content_napt.contains(r#""channels""#),
      "Missing channels array"
    );
    assert!(
      content_napt.contains(r#""frequency_range":[136.3,138.7]"#),
      "Missing frequency_range in .napt metadata"
    );
    assert!(
      content_napt.contains(r#""offset_iq":0"#),
      "Missing IQ offset metadata"
    );
    assert!(
      content_napt.contains(r#""iq_length":100"#),
      "Missing IQ length metadata"
    );
    assert!(
      !content_napt.contains(r#""offset_spectrum""#),
      "Unexpected spectrum offset metadata in IQ-only capture"
    );
    assert!(
      !content_napt.contains(r#""spectrum_length""#),
      "Unexpected spectrum length metadata in IQ-only capture"
    );

    // Test .wav unencrypted
    let result_wav_struct = CaptureResult {
      job_id: "test_multi_wav".to_string(),
      channels: vec![
        CaptureChannel {
          center_freq_hz: 137.5e6,
          sample_rate_hz: 2.4e6,
          requested_min_freq_hz: None,
          requested_max_freq_hz: None,
          iq_data: vec![0u8; 100],
          spectrum_data: vec![0f32; 10],
          bins_per_frame: 10,
          label: None,
        },
        CaptureChannel {
          center_freq_hz: 140.0e6,
          sample_rate_hz: 2.4e6,
          requested_min_freq_hz: None,
          requested_max_freq_hz: None,
          iq_data: vec![1u8; 100],
          spectrum_data: vec![1f32; 10],
          bins_per_frame: 10,
          label: None,
        },
      ],
      file_type: ".wav".to_string(),
      acquisition_mode: "stepwise".to_string(),
      duration_mode: "timed".to_string(),
      encrypted: false,
      fft_size: 2048,
      duration_s: 1.0,
      actual_frame_count: 60,
      fft_window: "Hanning".to_string(),
      gain: 1.0,
      ppm: 0,
      tuner_agc: false,
      rtl_agc: false,
      source_device: "Mock APT SDR".to_string(),
      hardware_sample_rate_hz: 2.4e6,
      overall_center_frequency_hz: 138.75e6,
      overall_capture_sample_rate_hz: 4.9e6,
      geolocation: None,
      frequency_range: Some((136.3, 141.2)),
      is_ephemeral: false,
      is_mock_apt: true,
      ref_based_demod_baseline: None,
      dek: None,
      bandwidth: None,
      bandwidth_center_frequency: None,
      frame_updates: Vec::new(),
      device_profile: None,
    };

    let result_wav =
      save_capture_file_multi(&result_wav_struct, &test_encryption_key())
        .expect("save multi .wav");

    let content_wav = fs::read(&result_wav.path).expect("read .wav");
    let wav_str = String::from_utf8_lossy(&content_wav);
    assert!(
      wav_str.contains(r#""acquisition_mode":"stepwise""#),
      "Missing acquisition_mode in .wav"
    );
    assert!(
      wav_str.contains(r#""channels""#),
      "Missing channels array in .wav"
    );
    assert!(
      wav_str.contains("data"),
      "Missing primary IQ data chunk in .wav"
    );
    assert!(wav_str.contains("nIQ1"), "Missing nIQ1 chunk in .wav");
    assert!(
      !wav_str.contains("nSPC") && !wav_str.contains("nSP1"),
      "Unexpected spectrum chunk in IQ-only .wav"
    );

    // Clean up
    let _ = fs::remove_file(result_napt.path);
    let _ = fs::remove_file(result_wav.path);
  }

  #[test]
  fn test_parse_frequency_hz() {
    assert_eq!(parse_frequency_hz("100Hz"), 100.0);
    assert_eq!(parse_frequency_hz("1.5kHz"), 1500.0);
    assert_eq!(parse_frequency_hz("3.2MHz"), 3_200_000.0);
    assert_eq!(parse_frequency_hz("1.2GHz"), 1_200_000_000.0);
    assert_eq!(parse_frequency_hz("100"), 100.0); // Default HZ
  }

  #[test]
  fn test_resolve_fft_config_scales_with_sample_rate() {
    let mock_low = resolve_fft_config("mock_apt", 1_000_000, Some(32768), None);
    assert_eq!(mock_low.default_size, 32768);
    assert_eq!(mock_low.max_size, 262_144);
    assert_eq!(mock_low.default_frame_rate, 30);
    assert_eq!(mock_low.max_frame_rate, 60);
    assert_eq!(mock_low.size_to_frame_rate.get(&2048), Some(&60));
    assert_eq!(mock_low.size_to_frame_rate.get(&262_144), Some(&3));

    let mock_fallback =
      resolve_fft_config("mock_apt", 1_000_000, Some(1024), None);
    assert_eq!(mock_fallback.default_size, 2048);

    let mock_high =
      resolve_fft_config("mock_apt", 3_200_000, Some(32768), None);
    assert_eq!(mock_high.default_size, 32768);
    assert_eq!(mock_high.max_size, 262_144);
    assert_eq!(mock_high.default_frame_rate, 60);
    assert_eq!(mock_high.max_frame_rate, 60);
    assert_eq!(mock_high.size_to_frame_rate.get(&65536), Some(&48));
    assert_eq!(mock_high.size_to_frame_rate.get(&131_072), Some(&24));
    assert_eq!(mock_high.size_to_frame_rate.get(&262_144), Some(&12));

    let hackrf = resolve_fft_config("hackrf_one", 3_200_000, Some(32768), None);
    assert_eq!(hackrf.max_size, 262_144);
    assert_eq!(hackrf.default_size, 32768);
  }
}
