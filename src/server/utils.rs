use anyhow::Result;
use log::{info, warn};
use std::io::Write;
use serde_yaml::Value;

use super::types::CaptureArtifact;

/// Downsample spectrum data to a target length using averaging
#[allow(dead_code)]
fn downsample_spectrum(data: &[f32], target_len: usize) -> Vec<f32> {
  n_apt_backend::native_simd::fft_simd::downsample_spectrum_simd(data, target_len)
}

fn read_config_file(filename: &str) -> Option<String> {
  if let Ok(content) = std::fs::read_to_string(filename) {
    return Some(content);
  }

  let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(filename);
  std::fs::read_to_string(manifest_path).ok()
}

pub fn load_channels() -> Vec<super::types::SpectrumFrameMessage> {
  let content = match read_config_file("signals.yaml") {
    Some(c) => c,
    None => return Vec::new(),
  };

  // Try new signals.yaml format first (typed)
  if let Ok(parsed) = serde_yaml::from_str::<super::types::SignalsConfig>(&content) {
    let mut out = Vec::new();
    for (id, f) in parsed.signals.n_apt.channels {
      if f.freq_range_mhz.len() < 2 {
        continue;
      }
      let min_mhz = f.freq_range_mhz[0];
      let max_mhz = f.freq_range_mhz[1];
      if !(min_mhz.is_finite() && max_mhz.is_finite() && max_mhz > min_mhz) {
        continue;
      }
      out.push(super::types::SpectrumFrameMessage {
        id,
        label: f.label,
        min_mhz,
        max_mhz,
        description: f.description,
      });
    }
    return out;
  }

  // Try extracting only the n_apt.channels section (lenient YAML parse)
  if let Ok(value) = serde_yaml::from_str::<Value>(&content) {
    if let Some(out) = extract_channels_from_value(&value) {
      return out;
    }
  }

  // Fallback to old format
  let parsed = match serde_yaml::from_str::<super::types::SpectrumFramesConfig>(&content) {
    Ok(p) => p,
    Err(e) => {
      warn!("Failed to parse signals.yaml: {}", e);
      return Vec::new();
    }
  };

  let mut out = Vec::new();
  for (id, f) in parsed.frames {
    if f.freq_range_mhz.len() < 2 {
      continue;
    }
    let min_mhz = f.freq_range_mhz[0];
    let max_mhz = f.freq_range_mhz[1];
    if !(min_mhz.is_finite() && max_mhz.is_finite() && max_mhz > min_mhz) {
      continue;
    }
    out.push(super::types::SpectrumFrameMessage {
      id,
      label: f.label,
      min_mhz,
      max_mhz,
      description: f.description,
    });
  }
  out.sort_by(|a, b| a.min_mhz.partial_cmp(&b.min_mhz).unwrap_or(std::cmp::Ordering::Equal));
  out
}

/// Load SDR settings from signals.yaml
pub fn load_sdr_settings() -> Option<super::types::SdrConfig> {
  let content = match read_config_file("signals.yaml") {
    Some(c) => c,
    None => return None,
  };

  if let Ok(parsed) = serde_yaml::from_str::<super::types::SignalsConfig>(&content) {
    return Some(parsed.signals.sdr);
  }

  // Lenient parse: extract signals.sdr only
  if let Ok(value) = serde_yaml::from_str::<Value>(&content) {
    if let Some(sdr_value) = value
      .get("signals")
      .and_then(|v| v.get("sdr"))
      .cloned()
    {
      match serde_yaml::from_value::<super::types::SdrConfig>(sdr_value) {
        Ok(config) => return Some(config),
        Err(e) => warn!("Failed to parse signals.sdr from signals.yaml: {}", e),
      }
    }
  }

  None
}

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
      .get(&Value::String("label".to_string()))
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string();
    let description = mapping
      .get(&Value::String("description".to_string()))
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string();
    let freq_range = mapping
      .get(&Value::String("freq_range_mhz".to_string()))
      .and_then(|v| v.as_sequence())?;
    if freq_range.len() < 2 {
      continue;
    }
    let min_mhz = freq_range[0].as_f64()?;
    let max_mhz = freq_range[1].as_f64()?;
    if !(min_mhz.is_finite() && max_mhz.is_finite() && max_mhz > min_mhz) {
      continue;
    }
    out.push(super::types::SpectrumFrameMessage {
      id,
      label,
      min_mhz,
      max_mhz,
      description,
    });
  }
  out.sort_by(|a, b| a.min_mhz.partial_cmp(&b.min_mhz).unwrap_or(std::cmp::Ordering::Equal));
  Some(out)
}

pub fn reconcile_device_state(device_connected: bool, device_state: &str) -> String {
    match (device_connected, device_state) {
        (true, "disconnected") => "connected".to_string(),
        (false, "connected") => "disconnected".to_string(), 
        (false, "loading") => "disconnected".to_string(),
        (true, "stale") => "connected".to_string(),
        _ => device_state.to_string(),
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
  use std::time::{SystemTime, UNIX_EPOCH};

  #[test]
  fn load_sdr_settings_uses_manifest_dir_when_cwd_missing() {
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
    let value: serde_yaml::Value =
      serde_yaml::from_str(&content).expect("parse signals.yaml into value");
    let sdr_value = value
      .get("signals")
      .and_then(|v| v.get("sdr"))
      .cloned();
    assert!(sdr_value.is_some(), "expected signals.sdr in signals.yaml");
    let parsed: Result<crate::types::SdrConfig, _> =
      serde_yaml::from_value(sdr_value.expect("signals.sdr value"));
    assert!(parsed.is_ok(), "expected signals.sdr to parse");

    let settings = load_sdr_settings();

    std::env::set_current_dir(&original_dir).expect("restore dir");
    let _ = std::fs::remove_dir_all(&temp_dir);
    assert!(
      settings.is_some(),
      "expected sdr settings from signals.yaml in manifest dir"
    );
  }
}

/// Save capture IQ data to a file (.wav with metadata, or encrypted .napt)
#[allow(dead_code)]
pub fn save_capture_file(
  job_id: &str,
  iq_data: &[u8],
  spectrum_data: &[f32],
  file_type: &str,
  encrypted: bool,
  encryption_key: &[u8; 32],
  center_freq_hz: f64,
  sample_rate_hz: f64,
  frame_rate: u32,
  fft_size: u32,
  duration_s: f64,
) -> Result<CaptureArtifact, String> {
  // Create temp directory if it doesn't exist
  let temp_dir = std::path::PathBuf::from("/tmp/n-apt-captures");
  std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

  let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
  let filename = if encrypted && file_type == ".napt" {
    format!("capture_{}_{}.napt", job_id, timestamp)
  } else {
    // default to wav for non-encrypted capture
    format!("capture_{}_{}.wav", job_id, timestamp)
  };

  let path = temp_dir.join(&filename);

  if encrypted && file_type == ".napt" {
    // Encrypt the IQ data using AES-256-GCM
    let encrypted_payload = n_apt_backend::crypto::encrypt_payload(encryption_key, iq_data)
      .map_err(|e| format!("Encryption failed: {}", e))?;

    // Write encrypted data
    let mut file = std::fs::File::create(&path)
      .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(encrypted_payload.as_bytes())
      .map_err(|e| format!("Failed to write file: {}", e))?;
  } else {
    // Write WAV with custom metadata chunk (nAPT) and raw IQ payload in data chunk
    let mut file = std::fs::File::create(&path)
      .map_err(|e| format!("Failed to create file: {}", e))?;

    // WAV fmt: PCM u8, 2 channels (I+Q interleaved), actual SDR sample rate
    // This makes the file loadable in SDR++ and other SDR tools.
    let channels: u16 = 2; // I and Q as stereo channels
    let bits_per_sample: u16 = 8;
    let sample_rate = sample_rate_hz as u32;
    let byte_rate: u32 = sample_rate * channels as u32 * (bits_per_sample as u32 / 8);
    let block_align: u16 = channels * (bits_per_sample / 8);

    // nAPT metadata chunk (JSON)
    let timestamp_utc = chrono::Utc::now().to_rfc3339();
    let meta_json = serde_json::json!({
      "center_frequency_hz": center_freq_hz,
      "sample_rate_hz": sample_rate_hz,
      "encrypted": encrypted,
      "timestamp_utc": timestamp_utc,
      "frame_rate": frame_rate,
      "fft_size": fft_size,
      "duration_s": duration_s,
      "data_format": "iq_u8",
    })
    .to_string();
    let meta_bytes = meta_json.as_bytes();
    let meta_padding = if (meta_bytes.len() + 1) % 2 == 0 { 0u32 } else { 1u32 };
    let meta_chunk_size = meta_bytes.len() as u32 + 1 + meta_padding;

    // nSPC spectrum chunk: raw f32 LE spectrum frames for our app's fast path
    let spec_bytes: Vec<u8> = spectrum_data.iter().flat_map(|&v| v.to_le_bytes()).collect();
    let spec_padding = if spec_bytes.len() % 2 == 0 { 0u32 } else { 1u32 };
    let spec_chunk_size = spec_bytes.len() as u32 + spec_padding;

    let data_chunk_size = iq_data.len() as u32;
    // RIFF size = 4 (WAVE) + fmt(24) + data(8+data) + nAPT(8+meta) + nSPC(8+spec)
    let riff_size = 4
      + (8 + 16)
      + (8 + data_chunk_size)
      + (8 + meta_chunk_size)
      + if spec_chunk_size > 0 { 8 + spec_chunk_size } else { 0 };

    // RIFF header
    file.write_all(b"RIFF").map_err(|e| e.to_string())?;
    file.write_all(&riff_size.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(b"WAVE").map_err(|e| e.to_string())?;

    // fmt chunk (PCM u8, 2ch = I+Q stereo)
    file.write_all(b"fmt ").map_err(|e| e.to_string())?;
    file.write_all(&16u32.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?; // PCM
    file.write_all(&channels.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&sample_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&byte_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&block_align.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&bits_per_sample.to_le_bytes()).map_err(|e| e.to_string())?;

    // data chunk (u8 IQ interleaved)
    file.write_all(b"data").map_err(|e| e.to_string())?;
    file.write_all(&data_chunk_size.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(iq_data).map_err(|e| e.to_string())?;

    // nAPT chunk (metadata JSON)
    file.write_all(b"nAPT").map_err(|e| e.to_string())?;
    file.write_all(&meta_chunk_size.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(meta_bytes).map_err(|e| e.to_string())?;
    file.write_all(&[0u8]).map_err(|e| e.to_string())?; // null terminator
    for _ in 0..meta_padding {
      file.write_all(&[0u8]).map_err(|e| e.to_string())?;
    }

    // nSPC chunk (f32 LE spectrum frames — our app's lossless fast path)
    if !spec_bytes.is_empty() {
      file.write_all(b"nSPC").map_err(|e| e.to_string())?;
      file.write_all(&spec_chunk_size.to_le_bytes()).map_err(|e| e.to_string())?;
      file.write_all(&spec_bytes).map_err(|e| e.to_string())?;
      for _ in 0..spec_padding {
        file.write_all(&[0u8]).map_err(|e| e.to_string())?;
      }
    }
  }
  
  info!("Saved capture file: {}", path.display());
  Ok(CaptureArtifact { filename, path })
}
