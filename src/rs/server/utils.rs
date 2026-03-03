use anyhow::Result;
use log::info;
use std::io::Write;
use serde_yaml::Value;
use std::sync::OnceLock;

use super::types::CaptureArtifact;

/// Downsample spectrum data to a target length using averaging
#[allow(dead_code)]
fn downsample_spectrum(data: &[f32], target_len: usize) -> Vec<f32> {
  crate::simd::downsample_spectrum_simd(data, target_len)
}

fn read_config_file(filename: &str) -> Option<String> {
  if let Ok(content) = std::fs::read_to_string(filename) {
    return Some(content);
  }

  let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(filename);
  std::fs::read_to_string(manifest_path).ok()
}

/// Load and cache the entire signals.yaml. Panics if missing or malformed.
static SIGNALS_CONFIG: OnceLock<super::types::SignalsConfig> = OnceLock::new();

pub fn signals_config() -> &'static super::types::SignalsConfig {
  SIGNALS_CONFIG.get_or_init(|| {
    let content = read_config_file("signals.yaml")
      .expect("signals.yaml must be present alongside the binary or in CARGO_MANIFEST_DIR");
    serde_yaml::from_str(&content).expect("Failed to parse signals.yaml")
  })
}

pub fn load_channels() -> Vec<super::types::SpectrumFrameMessage> {
  let parsed = signals_config();
  let mut out = Vec::new();
  for (id, f) in parsed.signals.n_apt.channels.clone() {
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

/// Load SDR settings (panic if missing/malformed)
pub fn load_sdr_settings() -> &'static super::types::SdrConfig {
  &signals_config().signals.sdr
}

/// Load mock APT signal settings (panic if missing/malformed)
pub fn load_mock_apt_settings() -> &'static super::types::MockAptSignalsConfig {
  &signals_config().signals.mock_apt
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
    let parsed: Result<crate::server::types::SdrConfig, _> =
      serde_yaml::from_value(sdr_value.expect("signals.sdr value"));
    assert!(parsed.is_ok(), "expected signals.sdr to parse");

    let settings = load_sdr_settings();

    std::env::set_current_dir(&original_dir).expect("restore dir");
    let _ = std::fs::remove_dir_all(&temp_dir);
    assert_eq!(settings.sample_rate, parsed.unwrap().sample_rate);
  }
}

/// Save capture IQ data to a file (.wav with metadata, or encrypted .napt)
/// Supports multiple channels.
pub fn save_capture_file_multi(
  result: &crate::sdr::processor::CaptureResult,
  encryption_key: &[u8; 32],
) -> Result<CaptureArtifact, String> {
  // Create temp directory if it doesn't exist
  let temp_dir = std::path::PathBuf::from("/tmp/n-apt-captures");
  std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

  let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
  let filename = if result.encrypted && result.file_type == ".napt" {
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
  });

  if result.encrypted && result.file_type == ".napt" {
    // Construct plaintext: JSON header with `channels` array + padding + Concatenated Data
    let header_size = 4096; // Larger header for multi-channel JSON
    let mut payload_plaintext = Vec::new();
    let mut channel_metas = Vec::new();

    for ch in &result.channels {
        let offset_iq = payload_plaintext.len();
        payload_plaintext.extend_from_slice(&ch.iq_data);
        let iq_len = ch.iq_data.len();

        let offset_spectrum = payload_plaintext.len();
        let spec_bytes: Vec<u8> = ch.spectrum_data.iter().flat_map(|&v| v.to_le_bytes()).collect();
        payload_plaintext.extend_from_slice(&spec_bytes);
        let spec_len = spec_bytes.len();

        channel_metas.push(serde_json::json!({
            "center_freq_hz": ch.center_freq_hz,
            "sample_rate_hz": ch.sample_rate_hz,
            "offset_iq": offset_iq,
            "iq_length": iq_len,
            "offset_spectrum": offset_spectrum,
            "spectrum_length": spec_len,
            "bins_per_frame": ch.bins_per_frame,
        }));
    }

    meta_obj["channels"] = serde_json::Value::Array(channel_metas);

    // Header JSON for .napt
    let complete_json = format!(
      r#"{{"metadata":{}}}"#,
      meta_obj.to_string()
    );

    let mut file = std::fs::File::create(&path)
      .map_err(|e| format!("Failed to create file: {}", e))?;

    // Write the plaintext JSON header
    file.write_all(complete_json.as_bytes())
      .map_err(|e| format!("Failed to write header: {}", e))?;

    // Pad the header
    let mut padded_len = complete_json.len();
    if padded_len < header_size {
      file.write_all(b"\n").map_err(|e| e.to_string())?;
      padded_len += 1;
      let padding = vec![b' '; header_size - padded_len];
      file.write_all(&padding).map_err(|e| e.to_string())?;
    } else {
      return Err("Metadata size exceeds header_size".to_string());
    }

    // Now encrypt ONLY the fast data (IQ and Spectrum) 
    let encrypted_data = crate::crypto::encrypt_payload_binary(encryption_key, &payload_plaintext)
      .map_err(|e| format!("Encryption failed: {}", e))?;

    file.write_all(&encrypted_data)
      .map_err(|e| format!("Failed to write encrypted data: {}", e))?;
  } else {
    // Write WAV with multi-channel chunks
    let mut file = std::fs::File::create(&path)
      .map_err(|e| format!("Failed to create file: {}", e))?;

    if result.channels.is_empty() {
        return Err("No channels to save".to_string());
    }

    let channels_count: u16 = 2; // I and Q as stereo channels
    let bits_per_sample: u16 = 8;
    let sample_rate = result.channels[0].sample_rate_hz as u32;
    let byte_rate: u32 = sample_rate * channels_count as u32 * (bits_per_sample as u32 / 8);
    let block_align: u16 = channels_count * (bits_per_sample / 8);

    // nAPT metadata chunk
    let mut meta_with_channels = meta_obj.clone();
    let mut chan_list = Vec::new();
    for ch in &result.channels {
        chan_list.push(serde_json::json!({
            "center_freq_hz": ch.center_freq_hz,
            "sample_rate_hz": ch.sample_rate_hz,
            "bins_per_frame": ch.bins_per_frame,
        }));
    }
    meta_with_channels["channels"] = serde_json::Value::Array(chan_list);
    let meta_json = meta_with_channels.to_string();
    let meta_bytes = meta_json.as_bytes();
    let meta_padding = if (meta_bytes.len() + 1) % 2 == 0 { 0u32 } else { 1u32 };
    let meta_chunk_size = meta_bytes.len() as u32 + 1 + meta_padding;

    // We'll calculate sizes and parts
    // Part 0 (Standard data chunk) = channels[0].iq_data
    // Extra Part IQ (nIQ1, nIQ2...)
    // Extra Part Spectrum (nSP0, nSP1...)

    let mut iq_chunks = Vec::new();
    let mut spectrum_chunks = Vec::new();
    let mut riff_total_delta: u32 = 0;

    for (i, ch) in result.channels.iter().enumerate() {
        // IQ Data
        let tag = if i == 0 { "data".to_string() } else { format!("nIQ{}", i) };
        let iq_data = &ch.iq_data;
        let iq_size = iq_data.len() as u32;
        let iq_padding = if iq_size % 2 == 0 { 0u32 } else { 1u32 };
        iq_chunks.push((tag, iq_size, iq_padding));
        riff_total_delta += 8 + iq_size + iq_padding;

        // Spectrum Data
        let spec_tag = if i == 0 { "nSPC".to_string() } else { format!("nSP{}", i) };
        let spec_bytes: Vec<u8> = ch.spectrum_data.iter().flat_map(|&v| v.to_le_bytes()).collect();
        let spec_size = spec_bytes.len() as u32;
        let spec_padding = if spec_size % 2 == 0 { 0u32 } else { 1u32 };
        spectrum_chunks.push((spec_tag, spec_bytes, spec_padding));
        riff_total_delta += 8 + spec_size + spec_padding;
    }

    // RIFF size = 4 (WAVE) + fmt(24) + nAPT(8+meta) + iq_chunks + spectrum_chunks
    let riff_size = 4 + 24 + (8 + meta_chunk_size) + riff_total_delta;

    // RIFF header
    file.write_all(b"RIFF").map_err(|e| e.to_string())?;
    file.write_all(&riff_size.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(b"WAVE").map_err(|e| e.to_string())?;

    // fmt chunk
    file.write_all(b"fmt ").map_err(|e| e.to_string())?;
    file.write_all(&16u32.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?; // PCM
    file.write_all(&channels_count.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&sample_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&byte_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&block_align.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&bits_per_sample.to_le_bytes()).map_err(|e| e.to_string())?;

    // nAPT chunk
    file.write_all(b"nAPT").map_err(|e| e.to_string())?;
    file.write_all(&meta_chunk_size.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(meta_bytes).map_err(|e| e.to_string())?;
    file.write_all(&[0u8]).map_err(|e| e.to_string())?;
    for _ in 0..meta_padding { file.write_all(&[0u8]).map_err(|e| e.to_string())?; }

    // Write IQ Chunks
    for (i, (tag, size, padding)) in iq_chunks.iter().enumerate() {
        file.write_all(tag.as_bytes()).map_err(|e| e.to_string())?;
        file.write_all(&size.to_le_bytes()).map_err(|e| e.to_string())?;
        file.write_all(&result.channels[i].iq_data).map_err(|e| e.to_string())?;
        if *padding > 0 { file.write_all(&[0u8]).map_err(|e| e.to_string())?; }
    }

    // Write Spectrum Chunks
    for (tag, bytes, padding) in spectrum_chunks {
        file.write_all(tag.as_bytes()).map_err(|e| e.to_string())?;
        file.write_all(&(bytes.len() as u32).to_le_bytes()).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        if padding > 0 { file.write_all(&[0u8]).map_err(|e| e.to_string())?; }
    }
  }
  
  info!("Saved capture file: {}", path.display());
  Ok(CaptureArtifact { filename, path })
}

#[cfg(test)]
mod save_tests {
  use super::*;
  use std::fs;
  use std::path::PathBuf; // Keep this if other tests need it, otherwise remove.
  use crate::sdr::processor::{CaptureResult, CaptureChannel}; // Add these imports

  #[test]
  fn test_save_capture_file_multi_metadata() {
    let result = CaptureResult {
        job_id: "test_multi".to_string(),
        channels: vec![
            CaptureChannel {
                center_freq_hz: 137.5e6,
                sample_rate_hz: 2.4e6,
                iq_data: vec![0u8; 100],
                spectrum_data: vec![0f32; 10],
            }
        ],
        file_type: ".napt".to_string(),
        acquisition_mode: "interleaved".to_string(),
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
    };
    
    let result_napt = save_capture_file_multi(
      &result,
      &[0u8; 32],
    ).expect("save multi .napt");
    
    let content_napt_bytes = fs::read(&result_napt.path).expect("read .napt");
    let content_napt = String::from_utf8_lossy(&content_napt_bytes);
    assert!(content_napt.contains(r#""acquisition_mode":"interleaved""#), "Missing acquisition_mode");
    assert!(content_napt.contains(r#""source_device":"Mock APT SDR""#), "Missing source_device");
    assert!(content_napt.contains(r#""channels""#), "Missing channels array");

    // Test .wav unencrypted
    let result_wav_struct = CaptureResult {
        job_id: "test_multi_wav".to_string(),
        channels: vec![
            CaptureChannel {
                center_freq_hz: 137.5e6,
                sample_rate_hz: 2.4e6,
                iq_data: vec![0u8; 100],
                spectrum_data: vec![0f32; 10],
            },
            CaptureChannel {
                center_freq_hz: 140.0e6,
                sample_rate_hz: 2.4e6,
                iq_data: vec![1u8; 100],
                spectrum_data: vec![1f32; 10],
            }
        ],
        file_type: ".wav".to_string(),
        acquisition_mode: "stepwise".to_string(),
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
    };

    let result_wav = save_capture_file_multi(
      &result_wav_struct,
      &[0u8; 32],
    ).expect("save multi .wav");
    
    let content_wav = fs::read(&result_wav.path).expect("read .wav");
    let wav_str = String::from_utf8_lossy(&content_wav);
    assert!(wav_str.contains(r#""acquisition_mode":"stepwise""#), "Missing acquisition_mode in .wav");
    assert!(wav_str.contains(r#""channels""#), "Missing channels array in .wav");
    assert!(wav_str.contains("nIQ1"), "Missing nIQ1 chunk in .wav");
    assert!(wav_str.contains("nSP1"), "Missing nSP1 chunk in .wav");
    
    // Clean up
    let _ = fs::remove_file(result_napt.path);
    let _ = fs::remove_file(result_wav.path);
  }
}
