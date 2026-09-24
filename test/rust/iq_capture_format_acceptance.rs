use n_apt_backend::crypto;
use n_apt_backend::sdr::processor::{CaptureChannel, CaptureResult};
use n_apt_backend::server::{iq_format, utils::save_capture_file_multi};
use serde_json::Value;
use std::fs;

fn capture(file_type: &str, encrypted: bool, case: &str) -> CaptureResult {
  CaptureResult {
    job_id: format!("iq_format_acceptance_{case}"),
    channels: vec![CaptureChannel {
      center_freq_hz: 137_500_000.0,
      sample_rate_hz: 3_200_000.0,
      requested_min_freq_hz: None,
      requested_max_freq_hz: None,
      iq_data: vec![128, 129, 127, 126, 130, 125, 129, 126],
      spectrum_data: Vec::new(),
      bins_per_frame: 4,
      label: None,
    }],
    file_type: file_type.to_string(),
    acquisition_mode: "whole_sample".to_string(),
    duration_mode: "timed".to_string(),
    encrypted,
    fft_size: 4,
    duration_s: 1.0,
    actual_frame_count: 1,
    fft_window: "Rectangular".to_string(),
    gain: 1.0,
    ppm: 0,
    tuner_agc: false,
    rtl_agc: false,
    source_device: "Acceptance SDR".to_string(),
    hardware_sample_rate_hz: 3_200_000.0,
    overall_center_frequency_hz: 137_500_000.0,
    overall_capture_sample_rate_hz: 3_200_000.0,
    geolocation: None,
    frequency_range: None,
    ref_based_demod_baseline: None,
    is_mock_apt: false,
    is_ephemeral: false,
    dek: None,
    bandwidth: None,
    bandwidth_center_frequency: None,
    frame_updates: vec![iq_format::FrameUpdate {
      sample_offset: 0,
      timestamp_us: 1_234,
      patch: serde_json::json!({ "center_frequency_hz": 137_500_000 }),
    }],
    device_profile: Some(serde_json::json!({ "kind": "Acceptance SDR" })),
  }
}

fn key() -> [u8; 32] {
  crypto::derive_key("iq-format-acceptance-key")
}

fn napt_header(bytes: &[u8]) -> Value {
  let newline = bytes
    .iter()
    .position(|byte| *byte == b'\n')
    .expect("NAPT header newline");
  serde_json::from_slice(&bytes[..newline]).expect("valid NAPT JSON header")
}

#[test]
fn backend_capture_writer_format_and_encryption_matrix_is_explicit() {
  let key = key();
  let cases = [
    (".napt", false, false),
    (".napt", true, true),
    (".iq", false, true),
    (".iq", true, true),
    (".wav", false, true),
    (".wav", true, false),
  ];

  for (format, encrypted, supported) in cases {
    let case = format!("{}_{}", format.trim_start_matches('.'), encrypted);
    let input = capture(format, encrypted, &case);
    let output = save_capture_file_multi(&input, &key);
    assert_eq!(output.is_ok(), supported, "{format}, encrypted={encrypted}");
    if !supported {
      continue;
    }

    let artifact = output.expect("supported capture format should be written");
    assert!(artifact.filename.ends_with(format));
    let bytes = fs::read(&artifact.path).expect("read written capture");
    match format {
      ".napt" => {
        let header = napt_header(&bytes);
        assert_eq!(header["metadata"]["format"], "napt");
        assert_eq!(header["metadata"]["format_version"], 5);
        assert_eq!(header["metadata"]["encrypted"], true);
        assert_eq!(header["metadata"]["sections"]["binary"]["encrypted"], true);
      }
      ".iq" => {
        assert_eq!(&bytes[..8], b"NAPT-IQ3");
        assert_eq!(bytes[32] != 0, encrypted);
        let decoded = iq_format::decode(&bytes, encrypted.then_some(&key))
          .expect("written IQ should decode with matching key policy");
        assert_eq!(decoded.chunks[0].data, input.channels[0].iq_data);
        assert_eq!(decoded.frames, input.frame_updates);
      }
      ".wav" => {
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        let metadata_marker = bytes
          .windows(4)
          .position(|chunk| chunk == b"nAPT")
          .expect("WAV should contain nAPT metadata");
        let length_start = metadata_marker + 4;
        let metadata_start = metadata_marker + 8;
        let metadata_length = u32::from_le_bytes(
          bytes[length_start..metadata_start]
            .try_into()
            .expect("WAV chunk length"),
        ) as usize;
        let metadata_bytes =
          &bytes[metadata_start..metadata_start + metadata_length];
        let metadata_end = metadata_bytes
          .iter()
          .position(|byte| *byte == 0)
          .unwrap_or(metadata_length);
        let metadata: Value =
          serde_json::from_slice(&metadata_bytes[..metadata_end])
            .expect("valid WAV nAPT metadata");
        assert_eq!(metadata["format"], "wav");
        assert_eq!(metadata["format_version"], 3);
        assert_eq!(metadata["encrypted"], false);
      }
      _ => unreachable!(),
    }
    fs::remove_file(artifact.path).expect("remove acceptance artifact");
  }
}
