use n_apt_backend::performance::{
  benchmark_scenarios, CeilingModel, CounterKind, MetricAvailability,
  PipelineMetrics, ProfilingSpan, Stage,
};
use n_apt_backend::tx::repeat_iq_payload_into;
use std::time::Duration;

#[test]
fn theoretical_ceiling_is_not_limited_by_presentation_rate() {
  let ceiling = CeilingModel::new(3_200_000, 2_048, 2, 60);

  assert_eq!(ceiling.theoretical_frames_per_second(), 1_562);
  assert_eq!(ceiling.presentation_frames_per_second(), 60);
  assert_eq!(ceiling.sample_bytes_per_second(), 6_400_000);
  assert_eq!(
    ceiling.theoretical_frame_interval(),
    Duration::from_secs_f64(2_048.0 / 3_200_000.0)
  );
  assert!(ceiling.presentation_warning().contains("screen refresh"));
}

#[test]
fn latency_summary_reports_distribution_without_inventing_missing_metrics() {
  let metrics = PipelineMetrics::new(false);
  for millis in [1_u64, 2, 3, 4, 100] {
    metrics.record_latency(Stage::FftDsp, Duration::from_millis(millis));
  }

  let snapshot = metrics.snapshot();
  let fft = snapshot.stages.get(&Stage::FftDsp).unwrap();
  assert_eq!(fft.latency.count, 5);
  assert_eq!(fft.latency.p50_ms, 3.0);
  assert_eq!(fft.latency.p95_ms, 100.0);
  assert_eq!(fft.latency.p99_ms, 100.0);
  assert_eq!(fft.latency.max_ms, 100.0);
  assert_eq!(snapshot.gpu_time, MetricAvailability::Unavailable);
}

#[test]
fn counters_and_queue_high_water_marks_are_monotonic() {
  let metrics = PipelineMetrics::new(true);
  metrics.increment(CounterKind::FramesRequested, 3);
  metrics.increment(CounterKind::FramesProduced, 2);
  metrics.increment(CounterKind::FramesDropped, 1);
  metrics.observe_queue(Stage::BrowserDecrypt, 2);
  metrics.observe_queue(Stage::BrowserDecrypt, 1);
  metrics.observe_queue(Stage::BrowserDecrypt, 4);

  let snapshot = metrics.snapshot();
  assert_eq!(snapshot.counters.frames_requested, 3);
  assert_eq!(snapshot.counters.frames_produced, 2);
  assert_eq!(snapshot.counters.frames_dropped, 1);
  assert_eq!(
    snapshot
      .stages
      .get(&Stage::BrowserDecrypt)
      .unwrap()
      .queue_depth,
    4
  );
  assert!(snapshot.detailed_profiling_enabled);
}

#[test]
fn benchmark_matrix_covers_every_supported_tx_signal() {
  let signals: Vec<_> = benchmark_scenarios()
    .into_iter()
    .filter_map(|scenario| scenario.tx_signal)
    .collect();

  for expected in ["d", "d_sharp", "wifi", "5g", "tone", "noise", "custom"] {
    assert!(
      signals.iter().any(|signal| signal == expected),
      "missing {expected}"
    );
  }
}

#[test]
fn profiling_span_records_only_when_detailed_mode_is_enabled() {
  let disabled = PipelineMetrics::new(false);
  drop(ProfilingSpan::start(&disabled, Stage::Acquisition));
  assert!(disabled.snapshot().stages.is_empty());

  let enabled = PipelineMetrics::new(true);
  drop(ProfilingSpan::start(&enabled, Stage::Acquisition));
  assert_eq!(
    enabled
      .snapshot()
      .stages
      .get(&Stage::Acquisition)
      .unwrap()
      .latency
      .count,
    1
  );
}

#[test]
fn tx_callback_payload_fill_repeats_without_losing_iq_alignment() {
  let payload = [1_u8, 2, 3, 4, 5, 6];
  let mut output = [0_u8; 16];

  repeat_iq_payload_into(&payload, &mut output).unwrap();

  assert_eq!(output, [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4]);
  assert!(repeat_iq_payload_into(&[], &mut output).is_err());
}
