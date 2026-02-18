use anyhow::Result;
use log::info;
use std::io::Write;

use super::types::CaptureArtifact;

/// Downsample spectrum data to a target length using averaging
#[allow(dead_code)]
fn downsample_spectrum(data: &[f32], target_len: usize) -> Vec<f32> {
  n_apt_backend::native_simd::fft_simd::downsample_spectrum_simd(data, target_len)
}

pub fn load_spectrum_frames() -> Vec<super::types::SpectrumFrameMessage> {
  let content = match std::fs::read_to_string("spectrum_frames.yaml") {
    Ok(c) => c,
    Err(_) => return Vec::new(),
  };

  let parsed = match serde_yaml::from_str::<super::types::SpectrumFramesConfig>(&content) {
    Ok(p) => p,
    Err(e) => {
      log::warn!("Failed to parse spectrum_frames.yaml: {}", e);
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

pub fn reconcile_device_state(device_connected: bool, device_state: &str) -> String {
  if device_connected && device_state == "disconnected" {
    "connected".to_string()
  } else if !device_connected && device_state == "connected" {
    "disconnected".to_string()
  } else {
    device_state.to_string()
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

/// Save capture IQ data to a file (.c64 or encrypted .napt)
/// Save captured IQ data to a file with optional encryption
#[allow(dead_code)]
pub fn save_capture_file(
  job_id: &str,
  iq_data: &[u8],
  file_type: &str,
  encrypted: bool,
  encryption_key: &[u8; 32],
) -> Result<CaptureArtifact, String> {
  // Create temp directory if it doesn't exist
  let temp_dir = std::path::PathBuf::from("/tmp/n-apt-captures");
  std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
  
  let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
  let filename = if encrypted && file_type == ".napt" {
    format!("capture_{}_{}.napt", job_id, timestamp)
  } else {
    format!("capture_{}_{}.c64", job_id, timestamp)
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
    // Write raw IQ data
    let mut file = std::fs::File::create(&path)
      .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(iq_data)
      .map_err(|e| format!("Failed to write file: {}", e))?;
  }
  
  info!("Saved capture file: {}", path.display());
  Ok(CaptureArtifact { filename, path })
}
