use n_apt_backend::sdr::mock_apt::MockAptDevice;
use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::sdr::SdrDevice;
use n_apt_backend::server::types::MockAptRealisticRfConfig;
use rustfft::{num_complex::Complex, FftPlanner};
#[cfg(test)]
mod tests {
  use super::*;

  static MOCK_APT_PERF_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

  fn new_perf_device(seed: u64) -> MockAptDevice {
    // Keep the checksum-regression test on the canonical CPU path.
    MockAptDevice::new_with_seed(seed)
  }

  fn realistic_rf_config() -> MockAptRealisticRfConfig {
    MockAptRealisticRfConfig {
      enabled: true,
      aliasing: true,
      passband: true,
      retune_settling: true,
    }
  }

  fn centered_energy(samples: &[u8]) -> u64 {
    samples
      .iter()
      .map(|&byte| (byte as i16 - 128).unsigned_abs() as u64)
      .sum()
  }

  fn iq_bin_magnitude(
    samples: &[u8],
    sample_rate_hz: f64,
    offset_hz: f64,
  ) -> f64 {
    let sample_count = samples.len() / 2;
    let phase_step = -2.0 * std::f64::consts::PI * offset_hz / sample_rate_hz;
    let mut sum_re = 0.0;
    let mut sum_im = 0.0;

    for sample_index in 0..sample_count {
      let i = samples[sample_index * 2] as f64 - 128.0;
      let q = samples[sample_index * 2 + 1] as f64 - 128.0;
      let phase = phase_step * sample_index as f64;
      let (sin, cos) = phase.sin_cos();
      sum_re += i * cos - q * sin;
      sum_im += i * sin + q * cos;
    }

    (sum_re.hypot(sum_im)) / sample_count.max(1) as f64
  }

  fn iq_bin_dbm(samples: &[u8], sample_rate_hz: f64, offset_hz: f64) -> f64 {
    let magnitude =
      iq_bin_magnitude(samples, sample_rate_hz, offset_hz) / 128.0;
    20.0 * magnitude.max(1e-12).log10() + 15.0
  }

  fn max_iq_bin_dbm(
    samples: &[u8],
    sample_rate_hz: f64,
    min_offset_hz: f64,
    max_offset_hz: f64,
    step_hz: f64,
  ) -> f64 {
    let mut offset_hz = min_offset_hz;
    let mut max_dbm: f64 = -150.0;
    while offset_hz <= max_offset_hz {
      max_dbm = max_dbm.max(iq_bin_dbm(samples, sample_rate_hz, offset_hz));
      offset_hz += step_hz.max(1.0);
    }
    max_dbm
  }

  fn fft_spectrum_dbm(samples: &[u8], sample_rate_hz: f64) -> Vec<(f64, f64)> {
    let sample_count = samples.len() / 2;
    let mut iq: Vec<Complex<f32>> = samples
      .chunks_exact(2)
      .map(|sample| {
        Complex::new(
          (sample[0] as f32 - 128.0) / 128.0,
          (sample[1] as f32 - 128.0) / 128.0,
        )
      })
      .collect();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(sample_count);
    fft.process(&mut iq);

    iq.iter()
      .enumerate()
      .map(|(index, bin)| {
        let rel_hz = if index <= sample_count / 2 {
          index as f64 * sample_rate_hz / sample_count as f64
        } else {
          -((sample_count - index) as f64 * sample_rate_hz
            / sample_count as f64)
        };
        let re = bin.re as f64 / sample_count as f64;
        let im = bin.im as f64 / sample_count as f64;
        let dbm = 10.0 * (re * re + im * im).max(1e-15).log10() + 15.0;
        (rel_hz, dbm)
      })
      .collect()
  }

  fn percentile_dbm(mut values: Vec<f64>, percentile: f64) -> f64 {
    values.retain(|value| value.is_finite());
    if values.is_empty() {
      return -150.0;
    }
    values.sort_by(|left, right| left.total_cmp(right));
    let index =
      ((values.len() - 1) as f64 * percentile.clamp(0.0, 1.0)).round() as usize;
    values[index]
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
    assert_eq!(checksum, 66846631, "mock APT waveform checksum changed");

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
  fn test_active_tx_overlay_performance_regression() {
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};

    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");

    n_apt_backend::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    let baseline_elapsed = {
      let mut device = new_perf_device(12345);
      device.read_samples(1024).unwrap();

      let start = Instant::now();
      for _ in 0..60 {
        let frame = device.read_samples(4096).unwrap();
        assert_eq!(frame.data.len(), 8192);
      }
      start.elapsed()
    };

    n_apt_backend::safety::TX_TRANSMITTING.store(true, Ordering::Relaxed);
    *n_apt_backend::safety::TX_SIGNAL.lock().unwrap() = "apt".to_string();
    *n_apt_backend::safety::TX_POWER_DBM.lock().unwrap() = -18.0;
    *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
      .lock()
      .unwrap() = 1_600_000.0;
    *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 760_000.0;

    let result = std::panic::catch_unwind(|| {
      let mut device = new_perf_device(12345);
      device.read_samples(1024).unwrap();

      let start = Instant::now();
      for _ in 0..60 {
        let frame = device.read_samples(4096).unwrap();
        assert_eq!(frame.data.len(), 8192);
      }
      start.elapsed()
    });

    n_apt_backend::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
      .lock()
      .unwrap() = 0.0;
    *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 0.0;

    let elapsed = result.expect("active Tx performance test panicked");
    println!(
      "MOCK APT ACTIVE TX PERF: baseline={baseline_elapsed:?}, active={elapsed:?}"
    );
    assert!(
      elapsed < Duration::from_millis(1500)
        && elapsed.as_secs_f64() <= baseline_elapsed.as_secs_f64() * 2.5,
      "active Mock APT Tx overlay is too slow for realtime streaming: baseline={baseline_elapsed:?}, active={elapsed:?}"
    );
  }

  #[test]
  fn test_active_tx_overlay_is_visible_in_mock_apt_receive_spectrum() {
    use std::sync::atomic::Ordering;

    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");

    let sample_rate_hz = 3_200_000.0;
    let tx_center_hz = 1_600_000.0;
    let tx_offset_hz = 100_000.0;

    n_apt_backend::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    let baseline_energy = {
      let mut device = new_perf_device(24680);
      device.set_center_frequency(tx_center_hz as u32).unwrap();
      device.set_sample_rate(sample_rate_hz as u32).unwrap();
      let frame = device.read_samples(4096).unwrap();
      iq_bin_magnitude(&frame.data, sample_rate_hz, 0.0)
    };

    n_apt_backend::safety::TX_TRANSMITTING.store(true, Ordering::Relaxed);
    *n_apt_backend::safety::TX_SIGNAL.lock().unwrap() = "tone".to_string();
    *n_apt_backend::safety::TX_POWER_DBM.lock().unwrap() = -18.0;
    *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
      .lock()
      .unwrap() = tx_center_hz;
    *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 2_400_000.0;

    let active_energy = {
      let mut device = new_perf_device(24680);
      device.set_center_frequency(tx_center_hz as u32).unwrap();
      device.set_sample_rate(sample_rate_hz as u32).unwrap();
      let frame = device.read_samples(4096).unwrap();
      let center_energy = iq_bin_magnitude(&frame.data, sample_rate_hz, 0.0);
      let offset_energy =
        iq_bin_magnitude(&frame.data, sample_rate_hz, tx_offset_hz);
      assert!(
        center_energy > offset_energy,
        "active Mock Tx overlay should peak at Tx center, not preset offset: center={center_energy}, offset={offset_energy}"
      );
      center_energy
    };

    n_apt_backend::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
      .lock()
      .unwrap() = 0.0;
    *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 0.0;

    assert!(
      active_energy > baseline_energy + 0.5,
      "active Mock Tx should be visible in Mock APT receive spectrum: baseline={baseline_energy}, active={active_energy}"
    );
  }

  #[test]
  fn test_active_tx_overlay_respects_narrow_tx_bandwidth_in_mock_apt_receive_spectrum(
  ) {
    use std::sync::atomic::Ordering;

    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");
    let sample_rate_hz = 3_200_000.0;
    let tx_center_hz = 137_100_000.0;

    n_apt_backend::safety::TX_TRANSMITTING.store(true, Ordering::Relaxed);
    *n_apt_backend::safety::TX_SIGNAL.lock().unwrap() = "apt".to_string();
    *n_apt_backend::safety::TX_POWER_DBM.lock().unwrap() = -18.0;
    *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
      .lock()
      .unwrap() = tx_center_hz;
    *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 100_000.0;

    let frame = {
      let mut device = new_perf_device(13579);
      device.set_center_frequency(tx_center_hz as u32).unwrap();
      device.set_sample_rate(sample_rate_hz as u32).unwrap();
      device.read_samples(65_536).unwrap()
    };

    n_apt_backend::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
      .lock()
      .unwrap() = 0.0;
    *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 0.0;

    let center_dbm = iq_bin_dbm(&frame.data, sample_rate_hz, 0.0);
    let outside_dbm = max_iq_bin_dbm(
      &frame.data,
      sample_rate_hz,
      250_000.0,
      1_400_000.0,
      25_000.0,
    )
    .max(max_iq_bin_dbm(
      &frame.data,
      sample_rate_hz,
      -1_400_000.0,
      -250_000.0,
      25_000.0,
    ));

    assert!(
      outside_dbm < center_dbm - 35.0,
      "Mock APT receive overlay should not show Tx energy outside a narrow Tx bandwidth: center={center_dbm:.2} dBm, outside={outside_dbm:.2} dBm"
    );
  }

  #[test]
  fn test_active_tx_overlay_suppresses_edge_adjacent_shoulders_in_mock_apt_receive_spectrum(
  ) {
    use std::sync::atomic::Ordering;

    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");
    let sample_rate_hz = 4_372_000.0;
    let tx_center_hz = 137_100_000.0;
    let tx_bandwidth_hz = 873_000.0;
    let tx_half_width_hz = tx_bandwidth_hz / 2.0;

    n_apt_backend::safety::TX_TRANSMITTING.store(true, Ordering::Relaxed);
    *n_apt_backend::safety::TX_SIGNAL.lock().unwrap() = "apt".to_string();
    *n_apt_backend::safety::TX_POWER_DBM.lock().unwrap() = -18.0;
    *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
      .lock()
      .unwrap() = tx_center_hz;
    *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = tx_bandwidth_hz;

    let frame = {
      let mut device = new_perf_device(24681357);
      device.set_center_frequency(tx_center_hz as u32).unwrap();
      device.set_sample_rate(sample_rate_hz as u32).unwrap();
      device.read_samples(65_536).unwrap()
    };

    n_apt_backend::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
      .lock()
      .unwrap() = 0.0;
    *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 0.0;

    let spectrum = fft_spectrum_dbm(&frame.data, sample_rate_hz);
    let far_floor_dbm = percentile_dbm(
      spectrum
        .iter()
        .filter(|(rel_hz, _)| {
          (1_200_000.0..=1_900_000.0).contains(rel_hz)
            || (-1_900_000.0..=-1_200_000.0).contains(rel_hz)
        })
        .map(|(_, dbm)| *dbm)
        .collect(),
      0.95,
    );
    let adjacent_outside_dbm = percentile_dbm(
      spectrum
        .iter()
        .filter(|(rel_hz, _)| {
          (tx_half_width_hz + 50_000.0..=tx_half_width_hz + 350_000.0)
            .contains(rel_hz)
            || (-(tx_half_width_hz + 350_000.0)
              ..=-(tx_half_width_hz + 50_000.0))
              .contains(rel_hz)
        })
        .map(|(_, dbm)| *dbm)
        .collect(),
      0.95,
    );

    assert!(
      adjacent_outside_dbm <= far_floor_dbm + 6.0,
      "Mock APT receive overlay should not keep elevated shoulders just outside Tx bandwidth: adjacent={adjacent_outside_dbm:.2} dBm, far_floor={far_floor_dbm:.2} dBm"
    );
  }

  #[test]
  fn test_active_noise_tx_overlay_does_not_create_cliffs_outside_allocated_bandwidth(
  ) {
    use std::sync::atomic::Ordering;

    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");
    let sample_rate_hz = 4_372_000.0;
    let tx_center_hz = 13_875_000.0;
    let tx_bandwidth_hz = 2_490_000.0;
    let tx_half_width_hz = tx_bandwidth_hz / 2.0;
    let fft_size = 65_536;

    n_apt_backend::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    let baseline = {
      let mut device = new_perf_device(97531);
      device.set_center_frequency(tx_center_hz as u32).unwrap();
      device.set_sample_rate(sample_rate_hz as u32).unwrap();
      let frame = device.read_samples(fft_size).unwrap();
      fft_spectrum_dbm(&frame.data, sample_rate_hz)
    };

    n_apt_backend::safety::TX_TRANSMITTING.store(true, Ordering::Relaxed);
    *n_apt_backend::safety::TX_SIGNAL.lock().unwrap() = "noise".to_string();
    *n_apt_backend::safety::TX_POWER_DBM.lock().unwrap() = -18.0;
    *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
      .lock()
      .unwrap() = tx_center_hz;
    *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = tx_bandwidth_hz;

    let active = {
      let mut device = new_perf_device(97531);
      device.set_center_frequency(tx_center_hz as u32).unwrap();
      device.set_sample_rate(sample_rate_hz as u32).unwrap();
      let frame = device.read_samples(fft_size).unwrap();
      fft_spectrum_dbm(&frame.data, sample_rate_hz)
    };

    n_apt_backend::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    *n_apt_backend::safety::TX_SIGNAL.lock().unwrap() = "apt".to_string();
    *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
      .lock()
      .unwrap() = 0.0;
    *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 0.0;

    let outside_active_dbm = percentile_dbm(
      active
        .iter()
        .filter(|(rel_hz, _)| {
          (tx_half_width_hz + 80_000.0..=tx_half_width_hz + 650_000.0)
            .contains(rel_hz)
            || (-(tx_half_width_hz + 650_000.0)
              ..=-(tx_half_width_hz + 80_000.0))
              .contains(rel_hz)
        })
        .map(|(_, dbm)| *dbm)
        .collect(),
      0.95,
    );
    let outside_baseline_dbm = percentile_dbm(
      baseline
        .iter()
        .filter(|(rel_hz, _)| {
          (tx_half_width_hz + 80_000.0..=tx_half_width_hz + 650_000.0)
            .contains(rel_hz)
            || (-(tx_half_width_hz + 650_000.0)
              ..=-(tx_half_width_hz + 80_000.0))
              .contains(rel_hz)
        })
        .map(|(_, dbm)| *dbm)
        .collect(),
      0.95,
    );
    let in_band_active_dbm = percentile_dbm(
      active
        .iter()
        .filter(|(rel_hz, _)| {
          (-tx_half_width_hz * 0.85..=tx_half_width_hz * 0.85).contains(rel_hz)
        })
        .map(|(_, dbm)| *dbm)
        .collect(),
      0.95,
    );

    assert!(
      outside_active_dbm <= outside_baseline_dbm + 4.0,
      "noise Tx overlay should not create the visible shoulder/cliff shelves outside the allocated bandwidth: active_outside={outside_active_dbm:.2} dBm, baseline_outside={outside_baseline_dbm:.2} dBm"
    );
    assert!(
      in_band_active_dbm >= outside_active_dbm + 10.0,
      "noise Tx overlay should remain concentrated inside the allocated bandwidth: in_band={in_band_active_dbm:.2} dBm, outside={outside_active_dbm:.2} dBm"
    );
  }

  #[test]
  fn test_realistic_rf_helpers_fold_and_shape_signal() {
    let sample_rate = 3_200_000.0;
    let folded =
      n_apt_backend::sdr::mock_apt::alias_to_baseband(1_900_000.0, sample_rate);
    assert!(
      (folded + 1_300_000.0).abs() < 1.0,
      "expected 1.9MHz offset to fold to -1.3MHz, got {folded}"
    );

    let center_gain =
      n_apt_backend::sdr::mock_apt::passband_gain(0.0, sample_rate);
    let edge_gain =
      n_apt_backend::sdr::mock_apt::passband_gain(1_550_000.0, sample_rate);
    assert!(center_gain > edge_gain);
    assert!(edge_gain > 0.0);

    let in_band = n_apt_backend::sdr::mock_apt::realistic_visibility_gain(
      400_000.0,
      400_000.0,
      sample_rate,
    );
    let folded_leak = n_apt_backend::sdr::mock_apt::realistic_visibility_gain(
      3_600_000.0,
      n_apt_backend::sdr::mock_apt::alias_to_baseband(3_600_000.0, sample_rate),
      sample_rate,
    );
    assert!(in_band > folded_leak);
    assert!(folded_leak > 0.0);
  }

  #[test]
  fn test_realistic_rf_mode_is_deterministic() {
    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");
    let mut device = MockAptDevice::new_with_seed(98765);
    device.set_realistic_rf_config(realistic_rf_config());
    device.set_settle_time(0);
    device.set_retune_settle_time(0);
    let frame1 = device.read_samples(8192).unwrap();
    let frame2 = device.read_samples(8192).unwrap();
    assert_ne!(
      frame1.data, frame2.data,
      "realistic frames should continue advancing"
    );

    let mut device2 = MockAptDevice::new_with_seed(98765);
    device2.set_realistic_rf_config(realistic_rf_config());
    device2.set_settle_time(0);
    device2.set_retune_settle_time(0);
    let frame1_b = device2.read_samples(8192).unwrap();
    let frame2_b = device2.read_samples(8192).unwrap();

    assert_eq!(frame1.data, frame1_b.data);
    assert_eq!(frame2.data, frame2_b.data);
  }

  #[test]
  fn test_realistic_rf_aliasing_keeps_folded_signal_visible() {
    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");
    let mut canonical = MockAptDevice::new_with_seed(24680);
    canonical.set_settle_time(0);
    canonical.set_center_frequency(10_000_000).unwrap();
    let canonical_frame = canonical.read_samples(32768).unwrap();
    let canonical_energy = centered_energy(&canonical_frame.data);

    let mut realistic = MockAptDevice::new_with_seed(24680);
    realistic.set_realistic_rf_config(realistic_rf_config());
    realistic.set_settle_time(0);
    realistic.set_retune_settle_time(0);
    realistic.set_center_frequency(10_000_000).unwrap();
    let realistic_frame = realistic.read_samples(32768).unwrap();
    let realistic_energy = centered_energy(&realistic_frame.data);

    assert!(
      realistic_energy > canonical_energy,
      "folded realistic signal should have more centered energy than canonical out-of-window noise"
    );
  }

  #[test]
  fn test_realistic_rf_retune_settling_ramps_after_tune() {
    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");
    let mut device = MockAptDevice::new_with_seed(13579);
    device.set_realistic_rf_config(realistic_rf_config());
    device.set_settle_time(0);
    device.set_retune_settle_time(32768);

    device.read_samples(8192).unwrap();
    device.set_center_frequency(1_700_000).unwrap();

    let first = device.read_samples(8192).unwrap();
    let second = device.read_samples(8192).unwrap();
    let third = device.read_samples(8192).unwrap();

    let first_energy = centered_energy(&first.data);
    let second_energy = centered_energy(&second.data);
    let third_energy = centered_energy(&third.data);

    assert!(
      second_energy > first_energy,
      "retuned realistic signal should ramp upward after first settled frame"
    );
    assert!(
      third_energy >= second_energy,
      "retuned realistic signal should not drop while settling"
    );
  }

  #[test]
  fn test_consecutive_frames_do_not_restart() {
    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");
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
  fn test_wifi_and_5g_tx_overlay_frames_advance() {
    use std::sync::atomic::Ordering;

    let _guard = MOCK_APT_PERF_LOCK.lock().expect("mock APT perf lock");
    let sample_rate_hz = 3_200_000.0;
    let center_hz = 1_600_000.0;

    for tx_signal in ["wifi", "5g"] {
      n_apt_backend::safety::TX_TRANSMITTING.store(true, Ordering::Relaxed);
      *n_apt_backend::safety::TX_SIGNAL.lock().unwrap() = tx_signal.to_string();
      *n_apt_backend::safety::TX_POWER_DBM.lock().unwrap() = -18.0;
      *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
        .lock()
        .unwrap() = center_hz;
      *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 2_400_000.0;

      let mut device = new_perf_device(424242);
      device.set_center_frequency(center_hz as u32).unwrap();
      device.set_sample_rate(sample_rate_hz as u32).unwrap();
      device.read_samples(1024).unwrap();

      let frame1 = device.read_samples(8192).unwrap();
      let frame2 = device.read_samples(8192).unwrap();

      assert_ne!(
        frame1.data, frame2.data,
        "{} overlay frames should advance instead of freezing",
        tx_signal
      );

      n_apt_backend::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
      *n_apt_backend::safety::TX_CENTER_FREQUENCY_HZ
        .lock()
        .unwrap() = 0.0;
      *n_apt_backend::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 0.0;
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
