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
      channel: None,
      kind: Some("PatchOptionsApplied".to_string()),
      frame_sequence: None,
      source_id: Some("rtl-sdr-acceptance".to_string()),
      job_id: Some(format!("iq_format_acceptance_{case}")),
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
        assert_eq!(header["metadata"]["format_version"], 6);
        assert_eq!(header["metadata"]["frame_updates"], serde_json::json!(input.frame_updates));
        assert_eq!(header["metadata"]["encrypted"], true);
        assert_eq!(header["metadata"]["sections"]["binary"]["encrypted"], true);
      }
      ".iq" => {
        assert_eq!(&bytes[..8], b"NAPT-IQ3");
        assert_eq!(bytes[32] != 0, encrypted);
        let decoded = iq_format::decode(&bytes, encrypted.then_some(&key))
          .expect("written IQ should decode with matching key policy");
        assert_eq!(decoded.metadata.format_version, 6);
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
        assert_eq!(metadata["frame_updates"], serde_json::json!(input.frame_updates));
      }
      _ => unreachable!(),
    }
    fs::remove_file(artifact.path).expect("remove acceptance artifact");
  }
}

#[test]
fn backend_iq_v6_keeps_chunk_sample_offsets_per_channel_and_rebases_patch_bytes() {
  let mut input = capture(".iq", false, "multi_channel_offsets");
  input.channels.push(CaptureChannel {
    center_freq_hz: 138_000_000.0,
    sample_rate_hz: 3_200_000.0,
    requested_min_freq_hz: None,
    requested_max_freq_hz: None,
    iq_data: vec![120, 121, 122, 123],
    spectrum_data: Vec::new(),
    bins_per_frame: 2,
    label: None,
  });
  input.frame_updates = vec![
    serde_json::from_value(serde_json::json!({
      "sample_offset": 0,
      "timestamp_us": 10,
      "channel": 0,
      "patch": { "center_frequency_hz": 137500000 }
    }))
    .expect("first channel patch"),
    serde_json::from_value(serde_json::json!({
      "sample_offset": 2,
      "timestamp_us": 20,
      "channel": 1,
      "patch": { "center_frequency_hz": 138000000 }
    }))
    .expect("second channel patch"),
  ];

  let artifact = save_capture_file_multi(&input, &key())
    .expect("write multichannel V6 IQ");
  let bytes = fs::read(&artifact.path).expect("read multichannel V6 IQ");
  let decoded = iq_format::decode(&bytes, None).expect("decode multichannel V6 IQ");

  assert_eq!(
    decoded.chunks.iter().map(|chunk| chunk.sample_offset).collect::<Vec<_>>(),
    vec![0, 0],
    "chunk sample offsets are relative to each channel"
  );
  let updates = decoded
    .frames
    .iter()
    .map(serde_json::to_value)
    .collect::<Result<Vec<_>, _>>()
    .expect("serialize updates");
  assert_eq!(updates[0]["sample_offset"], 0);
  assert_eq!(updates[0]["channel"], 0);
  assert_eq!(updates[1]["sample_offset"], 10);
  assert_eq!(updates[1]["channel"], 1);
}

#[test]
fn backend_iq_v6_writes_shared_cross_language_playback_fixture() {
  let fixture: Value = serde_json::from_str(include_str!("../fixtures/iq-capture-v6-playback.json"))
    .expect("shared playback fixture");
  let frames = fixture["frames"].as_array().expect("fixture frames");
  let mut input = capture(".iq", false, "cross_language_playback");
  input.channels[0].iq_data = frames
    .iter()
    .flat_map(|frame| frame["iq_data"].as_array().expect("frame bytes"))
    .map(|byte| byte.as_u64().expect("u8 byte") as u8)
    .collect();
  input.channels[0].bins_per_frame = 2;
  input.fft_size = 2;
  input.actual_frame_count = frames.len() as u32;
  input.frame_updates = frames
    .iter()
    .flat_map(|frame| {
      let offset = frame["sample_offset"].as_u64().expect("byte offset");
      let timestamp = frame["timestamp_us"].as_u64().expect("timestamp");
      let sequence = frame["frame_sequence"].as_u64().expect("sequence");
      let fft_size = frame["fft_size"].as_u64().expect("FFT size");
      [
        iq_format::FrameUpdate {
          sample_offset: offset,
          timestamp_us: timestamp,
          channel: Some(0),
          kind: Some("Frame".into()),
          frame_sequence: Some(sequence),
          source_id: Some("cross-language-fixture".into()),
          job_id: Some(input.job_id.clone()),
          patch: serde_json::json!({}),
        },
        iq_format::FrameUpdate {
          sample_offset: offset,
          timestamp_us: timestamp,
          channel: Some(0),
          kind: Some("PatchOptionsApplied".into()),
          frame_sequence: Some(sequence),
          source_id: Some("cross-language-fixture".into()),
          job_id: Some(input.job_id.clone()),
          patch: serde_json::json!({
            "center_frequency_hz": fixture["metadata"]["center_frequency_hz"],
            "capture_sample_rate_hz": fixture["metadata"]["capture_sample_rate_hz"],
            "fft_size": fft_size,
            "fft_window": fixture["metadata"]["fft_window"],
            "gain": fixture["metadata"]["gain"],
            "ppm": fixture["metadata"]["ppm"],
          }),
        },
      ]
    })
    .collect();

  let artifact = save_capture_file_multi(&input, &key()).expect("write backend V6 IQ");
  let bytes = fs::read(&artifact.path).expect("read backend V6 IQ");
  let decoded = iq_format::decode(&bytes, None).expect("decode backend V6 IQ");
  assert_eq!(decoded.metadata.format_version, 6);
  assert_eq!(decoded.chunks.len(), 1);
  assert_eq!(decoded.chunks[0].sample_offset, 0);
  assert_eq!(decoded.chunks[0].data, input.channels[0].iq_data);
  assert_eq!(decoded.frames, input.frame_updates);

  if let Some(path) = std::env::var_os("NAPT_IQ_CROSS_LANGUAGE_FIXTURE") {
    let path = std::path::PathBuf::from(path);
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).expect("create cross-language fixture directory");
    }
    fs::copy(&artifact.path, path).expect("export backend V6 IQ for frontend test");
  }
  fs::remove_file(artifact.path).expect("remove backend writer artifact");
}
