use n_apt_backend::crypto;
use n_apt_backend::sdr::processor::{CaptureChannel, CaptureResult};
use n_apt_backend::server::utils::save_capture_file_multi;
use std::fs;
use tempfile::tempdir;

const ENCRYPTION_FIXTURE_PASSWORD: &str = "napt-test-fixture-password-v1";

fn test_vault_key() -> [u8; 32] {
  crypto::derive_key(ENCRYPTION_FIXTURE_PASSWORD)
}

#[test]
fn test_encryption_save_load_cycle() {
  let _dir = tempdir().unwrap();
  let vault_key = test_vault_key();

  // 1. Setup mock capture result
  let original_iq = vec![0xAAu8; 1024];
  let result = CaptureResult {
    job_id: "test_e2e".to_string(),
    channels: vec![CaptureChannel {
      center_freq_hz: 137.5e6,
      sample_rate_hz: 2.4e6,
      requested_min_freq_hz: None,
      requested_max_freq_hz: None,
      iq_data: original_iq.clone(),
      spectrum_data: vec![],
      bins_per_frame: 1024,
      label: None,
    }],
    file_type: ".napt".to_string(),
    acquisition_mode: "stepwise".to_string(),
    duration_mode: "timed".to_string(),
    encrypted: true,
    fft_size: 1024,
    duration_s: 1.0,
    actual_frame_count: 1,
    fft_window: "Hanning".to_string(),
    gain: 1.0,
    ppm: 0,
    tuner_agc: false,
    rtl_agc: false,
    source_device: "Mock SDR".to_string(),
    hardware_sample_rate_hz: 2.4e6,
    overall_center_frequency_hz: 137.5e6,
    overall_capture_sample_rate_hz: 2.4e6,
    geolocation: None,
    frequency_range: None,
    ref_based_demod_baseline: None,
    is_mock_apt: true,
    is_ephemeral: false,
    dek: None, // Will be generated automatically
    bandwidth: None,
    bandwidth_center_frequency: None,
    frame_updates: Vec::new(),
    device_profile: None,
  };

  // 2. Save file
  let artifact =
    save_capture_file_multi(&result, &vault_key).expect("Save failed");

  // 3. Verify Checksum exists
  assert!(
    !artifact.checksum.is_empty(),
    "Checksum should be generated"
  );

  // 4. Read file back
  let file_bytes = fs::read(&artifact.path).expect("Read failed");

  // 5. Extract header and payload
  // Header is first 4096 bytes
  let header_bytes = &file_bytes[..4096];

  // 6. Parse Header
  let header_str = String::from_utf8_lossy(header_bytes);
  let header_json: serde_json::Value =
    serde_json::from_str(header_str.trim()).expect("Header parse failed");
  let binary_length = header_json["metadata"]["sections"]["binary"]
    ["length_bytes"]
    .as_u64()
    .expect("binary section length missing") as usize;
  let payload_end = 4096 + binary_length;
  assert!(
    payload_end <= file_bytes.len(),
    "binary section must fit inside the saved file"
  );
  let wrapped_dek_b64 = header_json["metadata"]["wrapped_dek"]
    .as_str()
    .expect("wrapped_dek missing");
  let wrapped_dek_bytes =
    crypto::from_base64(wrapped_dek_b64).expect("Base64 decode failed");

  // 7. Unwrap DEK using Vault Key
  let dek_bytes =
    crypto::decrypt_payload_binary(&vault_key, &wrapped_dek_bytes)
      .expect("DEK unwrap failed");
  let mut dek = [0u8; 32];
  dek.copy_from_slice(&dek_bytes);

  // 8. Decrypt Payload using DEK
  let encrypted_payload = &file_bytes[4096..payload_end];
  let decrypted_payload =
    crypto::decrypt_payload_binary(&dek, encrypted_payload)
      .expect("Payload decryption failed");

  // 9. Compare with original
  assert_eq!(decrypted_payload, original_iq, "Decrypted IQ data mismatch");

  // 10. Verify Checksum manually
  use sha2::Digest;
  let mut hasher = sha2::Sha256::new();
  hasher.update(&file_bytes);
  let expected_checksum = hasher
    .finalize()
    .iter()
    .map(|b| format!("{:02x}", b))
    .collect::<String>();
  assert_eq!(
    artifact.checksum, expected_checksum,
    "Checksum verification failed"
  );
}

#[test]
fn test_derive_key_trimming() {
  let key1 = derive_key("mypassword");
  let key2 = derive_key("  mypassword  \n");
  let key3 = derive_key("\tmypassword\r\n");
  assert_eq!(
    key1, key2,
    "derive_key should be invariant to leading/trailing space/newline"
  );
  assert_eq!(
    key1, key3,
    "derive_key should be invariant to leading/trailing tab/carriage return"
  );
}

#[test]
fn test_checksum_integrity_and_corruption() {
  let _dir = tempdir().unwrap();
  let vault_key = test_vault_key();

  let result = CaptureResult {
    job_id: "test_integrity".to_string(),
    channels: vec![CaptureChannel {
      center_freq_hz: 137.5e6,
      sample_rate_hz: 2.4e6,
      requested_min_freq_hz: None,
      requested_max_freq_hz: None,
      iq_data: vec![0xCC; 100],
      spectrum_data: vec![],
      bins_per_frame: 100,
      label: None,
    }],
    file_type: ".napt".to_string(),
    acquisition_mode: "stepwise".to_string(),
    duration_mode: "timed".to_string(),
    encrypted: true,
    fft_size: 1024,
    duration_s: 1.0,
    actual_frame_count: 1,
    fft_window: "Hanning".to_string(),
    gain: 1.0,
    ppm: 0,
    tuner_agc: false,
    rtl_agc: false,
    source_device: "Mock SDR".to_string(),
    hardware_sample_rate_hz: 2.4e6,
    overall_center_frequency_hz: 137.5e6,
    overall_capture_sample_rate_hz: 2.4e6,
    geolocation: None,
    frequency_range: None,
    ref_based_demod_baseline: None,
    is_mock_apt: true,
    is_ephemeral: false,
    dek: None,
    bandwidth: None,
    bandwidth_center_frequency: None,
    frame_updates: Vec::new(),
    device_profile: None,
  };

  let artifact =
    save_capture_file_multi(&result, &vault_key).expect("Save failed");
  let original_checksum = artifact.checksum.clone();

  // 1. Corrupt the file (flip a bit in the encrypted payload)
  let mut file_bytes = fs::read(&artifact.path).expect("Read failed");
  let corruption_idx = file_bytes.len() - 1;
  file_bytes[corruption_idx] ^= 0x01;
  fs::write(&artifact.path, &file_bytes).expect("Write failed");

  // 2. Calculate new checksum
  use sha2::Digest;
  let mut hasher = sha2::Sha256::new();
  hasher.update(&file_bytes);
  let new_checksum = hasher
    .finalize()
    .iter()
    .map(|b| format!("{:02x}", b))
    .collect::<String>();

  // 3. Verify checksum changed
  assert_ne!(
    original_checksum, new_checksum,
    "Checksum should have changed after corruption"
  );

  // 4. Verify decryption fails due to corrupted payload (AES-GCM tag check)
  let header_bytes = &file_bytes[..4096];
  let payload_bytes = &file_bytes[4096..];
  let header_str = String::from_utf8_lossy(header_bytes);
  let header_json: serde_json::Value =
    serde_json::from_str(header_str.trim()).unwrap();
  let wrapped_dek_b64 =
    header_json["metadata"]["wrapped_dek"].as_str().unwrap();
  let wrapped_dek_bytes = crypto::from_base64(wrapped_dek_b64).unwrap();
  let dek_bytes =
    crypto::decrypt_payload_binary(&vault_key, &wrapped_dek_bytes).unwrap();

  let mut dek = [0u8; 32];
  dek.copy_from_slice(&dek_bytes);

  let decrypt_result = crypto::decrypt_payload_binary(&dek, payload_bytes);
  assert!(
    decrypt_result.is_err(),
    "Decryption should fail after payload corruption"
  );
}

#[test]
fn test_legacy_format_decryption() {
  let _dir = tempdir().unwrap();
  let vault_key = test_vault_key();

  // 1. Manually create a legacy file (encrypted with vault key directly, no wrapped_dek)
  let original_iq = vec![0xBB; 200];
  let encrypted_payload =
    crypto::encrypt_payload_binary(&vault_key, &original_iq).unwrap();

  // Header without wrapped_dek
  let header_json = serde_json::json!({
      "metadata": {
          "job_id": "legacy_test",
          "encrypted": true
          // wrapped_dek is missing
      }
  });
  let mut header_str = header_json.to_string();
  header_str.push_str(&" ".repeat(4096 - header_str.len()));

  let mut file_bytes = header_str.into_bytes();
  file_bytes.extend_from_slice(&encrypted_payload);

  // 2. Simulate worker logic for legacy files
  let header_bytes = &file_bytes[..4096];
  let payload_bytes = &file_bytes[4096..];
  let header_json: serde_json::Value =
    serde_json::from_str(String::from_utf8_lossy(header_bytes).trim()).unwrap();

  let decrypted_iq = if let Some(wrapped_dek_b64) =
    header_json["metadata"]["wrapped_dek"].as_str()
  {
    let wrapped_dek = crypto::from_base64(wrapped_dek_b64).unwrap();
    let dek_bytes =
      crypto::decrypt_payload_binary(&vault_key, &wrapped_dek).unwrap();
    let mut dek = [0u8; 32];
    dek.copy_from_slice(&dek_bytes);
    crypto::decrypt_payload_binary(&dek, payload_bytes).unwrap()
  } else {
    // Fallback to vault key (Legacy)
    crypto::decrypt_payload_binary(&vault_key, payload_bytes).unwrap()
  };

  assert_eq!(
    decrypted_iq, original_iq,
    "Legacy decryption fallback failed"
  );
}

#[test]
fn generate_test_artifacts() {
  let vault_key = test_vault_key();

  let original_iq = vec![0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE];
  let result = CaptureResult {
    job_id: "e2e_artifact_test".to_string(),
    channels: vec![CaptureChannel {
      center_freq_hz: 137.5e6,
      sample_rate_hz: 2.4e6,
      requested_min_freq_hz: None,
      requested_max_freq_hz: None,
      iq_data: original_iq.clone(),
      spectrum_data: vec![],
      bins_per_frame: 1024,
      label: Some("Artifact Test".to_string()),
    }],
    file_type: ".napt".to_string(),
    acquisition_mode: "stepwise".to_string(),
    duration_mode: "timed".to_string(),
    encrypted: true,
    fft_size: 1024,
    duration_s: 1.0,
    actual_frame_count: 1,
    fft_window: "Hanning".to_string(),
    gain: 1.0,
    ppm: 0,
    tuner_agc: false,
    rtl_agc: false,
    source_device: "Mock SDR".to_string(),
    hardware_sample_rate_hz: 2.4e6,
    overall_center_frequency_hz: 137.5e6,
    overall_capture_sample_rate_hz: 2.4e6,
    geolocation: None,
    frequency_range: None,
    ref_based_demod_baseline: None,
    is_mock_apt: true,
    is_ephemeral: false,
    dek: None,
    bandwidth: None,
    bandwidth_center_frequency: None,
    frame_updates: Vec::new(),
    device_profile: None,
  };

  let artifact =
    save_capture_file_multi(&result, &vault_key).expect("Save failed");

  // Copy to a stable location for frontend tests
  let fixture_dir = std::path::Path::new("test/integration/fixtures");
  fs::create_dir_all(fixture_dir).unwrap();
  let dest_path = fixture_dir.join("encrypted_test.napt");
  fs::copy(&artifact.path, &dest_path).expect("Copy to fixtures failed");

  println!("Generated test artifact at: {:?}", dest_path);
}

use n_apt_backend::crypto::derive_key;
