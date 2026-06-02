use n_apt_backend::sdr::mock_apt::MockAptDevice;
use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::sdr::SdrDevice;
#[cfg(test)]
mod tests {
  use super::*;

  static MOCK_APT_PERF_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

  fn new_perf_device(seed: u64) -> MockAptDevice {
    // Keep the checksum-regression test on the canonical CPU path.
    MockAptDevice::new_with_seed(seed)
  }

  #[test]
  fn test_device_type() {
    let device = MockAptDevice::new();
    assert_eq!(device.device_type(), "Mock APT SDR");
  }

  #[test]
  fn test_is_ready() {
    let device = MockAptDevice::new();
    assert!(device.is_ready(), "Mock device should always be ready");
  }

  #[test]
  fn test_initialize() {
    let mut device = MockAptDevice::new();
    let result = device.initialize();
    assert!(result.is_ok(), "initialize() should succeed");
    assert!(device.is_ready());
  }

  #[test]
  fn test_default_center_frequency() {
    let device = MockAptDevice::new();
    assert_eq!(
      device.get_center_frequency(),
      1_600_000,
      "Default center freq should be 1.6 MHz"
    );
  }

  #[test]
  fn test_default_sample_rate() {
    let device = MockAptDevice::new();
    assert_eq!(
      device.get_sample_rate(),
      3_200_000,
      "Default sample rate should be 3.2 MSPS"
    );
  }

  #[test]
  fn test_set_center_frequency_roundtrip() {
    let mut device = MockAptDevice::new();
    device.set_center_frequency(28_000_000).unwrap();
    assert_eq!(device.get_center_frequency(), 28_000_000);
  }

  #[test]
  fn test_queued_center_frequency_applies_during_retune_cooldown() {
    let mut processor = SdrProcessor::new_mock_apt().unwrap();
    processor.frame.retune_cooldown_until =
      Some(std::time::Instant::now() + std::time::Duration::from_secs(5));

    processor.queue_center_frequency(2_529_130);
    let _ = processor.read_and_process_frame().unwrap();

    assert_eq!(processor.get_center_frequency(), 2_529_130);
    assert!(
      processor.frame.pending_freq.is_none(),
      "queued retunes should not be stuck behind cooldown"
    );
  }

  #[test]
  fn test_set_gain() {
    let mut device = MockAptDevice::new();
    let result = device.set_gain(25.0);
    assert!(result.is_ok());
  }

  #[test]
  fn test_set_ppm() {
    let mut device = MockAptDevice::new();
    let result = device.set_ppm(5);
    assert!(result.is_ok());
  }

  #[test]
  fn test_set_tuner_agc() {
    let mut device = MockAptDevice::new();
    assert!(device.set_tuner_agc(true).is_ok());
    assert!(device.set_tuner_agc(false).is_ok());
  }

  #[test]
  fn test_set_rtl_agc() {
    let mut device = MockAptDevice::new();
    assert!(device.set_rtl_agc(true).is_ok());
    assert!(device.set_rtl_agc(false).is_ok());
  }

  #[test]
  fn test_read_samples_length() {
    let mut device = MockAptDevice::new();
    let fft_size = 1024;
    let result = device.read_samples(fft_size);
    assert!(result.is_ok(), "read_samples should succeed");
    let samples = result.unwrap();
    assert_eq!(
      samples.data.len(),
      fft_size * 2,
      "Output should be fft_size * 2 bytes (I/Q pairs)"
    );
  }

  #[test]
  fn test_read_samples_values_in_range() {
    let mut device = MockAptDevice::new();
    let samples = device.read_samples(512).unwrap();
    // All u8 values are inherently 0..=255, but verify none are missing
    assert!(!samples.data.is_empty());
    // Verify the sample_rate is passed through
    assert_eq!(samples.sample_rate, device.get_sample_rate());
  }

  #[test]
  fn test_read_samples_varies_between_frames() {
    let mut device = MockAptDevice::new();
    let frame1 = device.read_samples(256).unwrap();
    let frame2 = device.read_samples(256).unwrap();
    // Two consecutive frames should not be byte-identical
    // (noise and signal drift make this extremely unlikely)
    assert_ne!(frame1.data, frame2.data, "Consecutive frames should differ");
  }

  #[test]
  fn test_read_samples_different_fft_sizes() {
    let mut device = MockAptDevice::new();
    for &size in &[128, 256, 1024, 4096] {
      let result = device.read_samples(size);
      assert!(
        result.is_ok(),
        "read_samples should work for fft_size={}",
        size
      );
      assert_eq!(result.unwrap().data.len(), size * 2);
    }
  }

  #[test]
  fn test_reset_buffer() {
    let mut device = MockAptDevice::new();
    let result = device.reset_buffer();
    assert!(result.is_ok());
  }

  #[test]
  fn test_cleanup() {
    let mut device = MockAptDevice::new();
    let result = device.cleanup();
    assert!(result.is_ok());
  }

  #[test]
  fn test_performance_and_identity_regression() {
    use std::time::Instant;

    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");

    // Use a fixed seed for deterministic output
    let mut device = new_perf_device(12345);
    let fft_size = 262144; // 256k samples (standard large frame)

    // 1. Warm up (settle time modeling)
    device.read_samples(1024).unwrap();

    // 2. Measure Performance
    let start = Instant::now();
    let samples = device.read_samples(fft_size).unwrap();
    let duration = start.elapsed();

    let throughput = (fft_size as f64 / duration.as_secs_f64()) / 1_000_000.0;
    println!("MOCK APT PERFORMANCE:");
    println!("  Backend: {}", device.generation_backend_label());
    println!("  Generated {} samples in {:?}", fft_size, duration);
    println!("  Throughput: {:.2} MSPS", throughput);

    // 3. Verify Identity (Waveform Checksum)
    // Sum of all bytes in the I/Q frame
    let checksum: u64 = samples.data.iter().map(|&b| b as u64).sum();
    println!("MOCK APT IDENTITY:");
    println!("  Waveform checksum: {}", checksum);
    assert_eq!(checksum, 66846617, "mock APT waveform checksum changed");

    // Ensure determinism
    let mut device2 = new_perf_device(12345);
    device2.read_samples(1024).unwrap();
    let samples2 = device2.read_samples(fft_size).unwrap();
    let checksum2: u64 = samples2.data.iter().map(|&b| b as u64).sum();

    assert_eq!(
      checksum, checksum2,
      "Waveform must be deterministic with same seed"
    );

    // Initial sanity check for performance (should be well under 100ms for 256k samples on modern CPUs)
    // If it's over 500ms, it's definitely "out of control".
    assert!(
      duration.as_millis() < 5000,
      "Performance is extremely out of control: {:?}",
      duration
    );
  }

  #[test]
  fn test_consecutive_frames_do_not_restart() {
    let mut device = MockAptDevice::new_with_seed(12345);
    device.read_samples(1024).unwrap();

    let mut previous_checksum = None;
    for _ in 0..8 {
      let samples = device.read_samples(8192).unwrap();
      let checksum: u64 = samples.data.iter().map(|&b| b as u64).sum();
      assert!(checksum > 0, "frame checksum should never be zero");
      if let Some(prev) = previous_checksum {
        assert_ne!(
          prev, checksum,
          "consecutive frames should advance instead of restarting"
        );
      }
      previous_checksum = Some(checksum);
    }
  }

  #[test]
  fn test_mock_apt_medium_frame_performance() {
    use std::time::Instant;

    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");

    let mut device = MockAptDevice::new_with_seed(20240513);
    device.read_samples(1024).unwrap();

    let start = Instant::now();
    let samples = device.read_samples(32768).unwrap();
    let elapsed = start.elapsed();

    assert_eq!(samples.data.len(), 32768 * 2);

    let limit = if cfg!(debug_assertions) {
      std::time::Duration::from_secs(2)
    } else {
      std::time::Duration::from_millis(40)
    };

    assert!(
      elapsed < limit,
      "Mock APT 32k frame generation is too slow: {:?}",
      elapsed
    );
  }

  #[test]
  fn test_mock_apt_max_frame_performance() {
    use std::time::Instant;

    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");

    let mut device = MockAptDevice::new_with_seed(20240513);
    device.read_samples(1024).unwrap();

    let fft_size = 262144;
    let start = Instant::now();
    let samples = device.read_samples(fft_size).unwrap();
    let elapsed = start.elapsed();

    assert_eq!(samples.data.len(), fft_size * 2);

    let limit = if cfg!(debug_assertions) {
      std::time::Duration::from_secs(12)
    } else {
      std::time::Duration::from_millis(90)
    };

    assert!(
      elapsed < limit,
      "Mock APT 256k frame generation is too slow: {:?}",
      elapsed
    );
  }

  #[test]
  fn test_mock_apt_profile_snapshot() {
    let device = MockAptDevice::new_with_seed(12345);
    let profile = device.performance_profile(262144);

    assert_eq!(profile.fft_size, 262144);
    assert!(profile.active_signals > 0);
    assert!(profile.est_signal_pairs > 0);
    assert!(profile.estimated_operations_per_frame > 0);
    assert!(profile.estimated_bytes_per_frame >= 262144 * 2);
  }

  #[test]
  fn test_mock_apt_profile_snapshot_medium_frame() {
    let device = MockAptDevice::new_with_seed(12345);
    let profile = device.performance_profile(32768);

    assert_eq!(profile.fft_size, 32768);
    assert!(profile.active_signals > 0);
    assert!(profile.est_signal_pairs > 0);
    assert!(profile.estimated_operations_per_frame > 0);
    assert!(profile.estimated_bytes_per_frame >= 32768 * 2);
  }

  #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
  #[test]
  fn test_mock_apt_metal_backend_smoke() {
    let mut device = MockAptDevice::new_with_seed_and_gpu_backend(12345);
    if !device.gpu_backend_enabled() {
      eprintln!(
        "Metal backend unavailable; skipping smoke assertions: {}",
        device
          .gpu_backend_error()
          .unwrap_or("unknown initialization error")
      );
      return;
    }

    assert_eq!(device.device_type(), "Mock APT SDR (Metal)");

    device.read_samples(1024).unwrap();
    let frame1 = device.read_samples(32_768).unwrap();
    let frame2 = device.read_samples(32_768).unwrap();

    assert_eq!(frame1.data.len(), 32_768 * 2);
    assert_eq!(frame2.data.len(), 32_768 * 2);
    assert_ne!(
      frame1.data, frame2.data,
      "Metal-backed frames should continue advancing"
    );
  }

  #[test]
  fn test_large_fft_frame_rate_regression() {
    let cases = [
      (2048, 1_000_000, 60),
      (2048, 3_200_000, 60),
      (8192, 3_200_000, 60),
      (32768, 3_200_000, 60),
      (65536, 3_200_000, 48),
      (131072, 3_200_000, 24),
      (262144, 3_200_000, 12),
      (262144, 1_000_000, 3),
      (262144, 10_000, 1),
    ];

    for (fft_size, sample_rate, expected) in cases {
      assert_eq!(
        n_apt_backend::sdr::processor::SdrProcessor::calculate_valid_frame_rate(
          fft_size,
          sample_rate,
        ),
        expected,
        "unexpected frame rate for fft_size={} sample_rate={}",
        fft_size,
        sample_rate
      );
    }
  }
}
