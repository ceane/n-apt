use n_apt_backend::consts::fft::SAMPLE_RATE;
use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::server::types::SdrProcessorSettings;
use serial_test::serial;
use std::time::{Duration, Instant};

/// CI runners (GitHub Actions' ubuntu-latest) are shared VMs with variable
/// single-thread perf. Return a multiplier so timing assertions stay valid.
fn ci_timing_multiplier() -> u32 {
  if std::env::var("CI").map_or(false, |v| v == "true" || v == "1") {
    2
  } else {
    1
  }
}

#[test]
#[serial]
fn test_sdr_processor_frame_timing_stability() {
  // We use a mock device for this test
  let mut processor =
    SdrProcessor::new_mock_apt().expect("Failed to create mock processor");

  // Set a high target frame rate to stress the processor
  let target_fps = 60;
  processor
    .apply_settings(SdrProcessorSettings {
      frame_rate: Some(target_fps),
      fft_size: Some(2048),
      ..Default::default()
    })
    .expect("Failed to apply settings");

  let num_frames = 50;
  let mut timings = Vec::with_capacity(num_frames);

  for _ in 0..num_frames {
    let start = Instant::now();
    let _ = processor
      .read_and_process_frame()
      .expect("Failed to process frame");
    timings.push(start.elapsed());
  }

  let avg_time: Duration =
    timings.iter().sum::<Duration>() / (num_frames as u32);
  println!("Average frame processing time (size=2048): {:?}", avg_time);

  // In debug mode, mock signal generation is very slow due to math functions.
  // In release mode, it should be < 1ms on a dedicated machine.
  let base_limit = if cfg!(debug_assertions) {
    Duration::from_millis(100)
  } else {
    Duration::from_millis(5)
  };
  let limit = base_limit * ci_timing_multiplier();

  assert!(avg_time < limit, "Processing time too high: {:?}", avg_time);
}

#[test]
#[serial]
fn test_high_resolution_fft_throughput() {
  let mut processor =
    SdrProcessor::new_mock_apt().expect("Failed to create mock processor");

  // Test with maximum resolution
  let fft_size = 262144; // 2^18
  processor
    .apply_settings(SdrProcessorSettings {
      fft_size: Some(fft_size),
      ..Default::default()
    })
    .expect("Failed to apply settings");

  let start = Instant::now();
  let _ = processor
    .read_and_process_frame()
    .expect("Failed to process frame");
  let elapsed = start.elapsed();

  println!("256k FFT processing time: {:?}", elapsed);

  // In debug mode, 256k sin/cos calls + FFT is very slow.
  let base_limit = if cfg!(debug_assertions) {
    Duration::from_secs(10)
  } else {
    Duration::from_millis(500)
  };
  let limit = base_limit * ci_timing_multiplier();

  assert!(elapsed < limit, "256k FFT took too long: {:?}", elapsed);
}

#[test]
#[serial]
fn test_fft_size_switch_to_max_first_frame_latency() {
  let mut processor =
    SdrProcessor::new_mock_apt().expect("Failed to create mock processor");

  processor
    .apply_settings(SdrProcessorSettings {
      fft_size: Some(262144),
      ..Default::default()
    })
    .expect("Failed to apply max FFT size");
  let _ = processor
    .read_and_process_frame()
    .expect("Failed to warm max-size frame");

  let baseline_start = Instant::now();
  let _ = processor
    .read_and_process_frame()
    .expect("Failed to process baseline max-size frame");
  let baseline_elapsed = baseline_start.elapsed();

  processor
    .apply_settings(SdrProcessorSettings {
      fft_size: Some(32768),
      ..Default::default()
    })
    .expect("Failed to apply initial FFT size");
  let _ = processor
    .read_and_process_frame()
    .expect("Failed to process warmup frame");

  let start = Instant::now();
  processor
    .apply_settings(SdrProcessorSettings {
      fft_size: Some(262144),
      ..Default::default()
    })
    .expect("Failed to switch to max FFT size");
  let _ = processor
    .read_and_process_frame()
    .expect("Failed to process first max-size frame");
  let elapsed = start.elapsed();

  println!(
        "First frame after 32k -> 256k FFT switch: {:?} (baseline 256k frame: {:?})",
        elapsed,
        baseline_elapsed
    );

  let multiplier = if cfg!(debug_assertions) { 3 } else { 2 };
  let limit = baseline_elapsed
    .saturating_mul(multiplier * ci_timing_multiplier())
    .max(Duration::from_millis(100));

  assert!(
        elapsed < limit,
        "FFT size switch first frame took too long: {:?} (baseline: {:?}, limit: {:?})",
        elapsed,
        baseline_elapsed,
        limit
    );
}

#[test]
#[serial]
fn test_loop_interval_consistency_across_sizes() {
  let test_cases = [
    (2048, 60),   // 16.6ms
    (65536, 48),  // 20.8ms
    (131072, 24), // 41.6ms
    (262144, 12), // 83.3ms
  ];

  for (fft_size, expected_fps) in test_cases {
    let target_fps = SdrProcessor::calculate_valid_frame_rate(fft_size);
    assert_eq!(
      target_fps, expected_fps,
      "Frame rate calculation mismatch for size {}",
      fft_size
    );

    let target_duration = Duration::from_millis(1000 / (target_fps as u64));

    let mut intervals = Vec::new();
    let mut last_time = Instant::now();

    for _ in 0..10 {
      let start_time = Instant::now();

      // Simulate work
      std::thread::sleep(Duration::from_millis(1));

      let elapsed = start_time.elapsed();
      if elapsed < target_duration {
        std::thread::sleep(target_duration - elapsed);
      }

      let now = Instant::now();
      intervals.push(now.duration_since(last_time));
      last_time = now;
    }

    let avg_interval: Duration =
      intervals.iter().skip(1).sum::<Duration>() / (intervals.len() as u32 - 1);
    println!(
      "Size {}: Avg interval {:?}, Target {:?}",
      fft_size, avg_interval, target_duration
    );

    let diff = if avg_interval > target_duration {
      avg_interval - target_duration
    } else {
      target_duration - avg_interval
    };

    // Allow more jitter in debug/CI
    let base_jitter = if cfg!(debug_assertions) {
      Duration::from_millis(15)
    } else {
      Duration::from_millis(5)
    };
    let jitter_limit = base_jitter * ci_timing_multiplier();

    assert!(
      diff < jitter_limit,
      "Interval jitter too high for size {}: {:?}",
      fft_size,
      diff
    );
  }
}

#[test]
fn test_mock_sdr_sample_rate_correctness() {
  let processor =
    SdrProcessor::new_mock_apt().expect("Failed to create mock processor");
  assert_eq!(
    processor.get_sample_rate(),
    SAMPLE_RATE,
    "Mock SDR sample rate should match constants (3.2MHz)"
  );
}
