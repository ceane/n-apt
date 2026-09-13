//! Low-overhead pipeline counters and opt-in detailed performance telemetry.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const PRESENTATION_WARNING: &str = "Presentation FPS is calibrated to screen refresh and is not the uncapped production ceiling.";

pub fn pipeline_metrics() -> &'static Arc<PipelineMetrics> {
  static METRICS: OnceLock<Arc<PipelineMetrics>> = OnceLock::new();
  METRICS.get_or_init(|| {
    let detailed = std::env::var("N_APT_PIPELINE_PROFILE")
      .map(|value| matches!(value.as_str(), "1" | "true" | "on"))
      .unwrap_or(false);
    Arc::new(PipelineMetrics::new(detailed))
  })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CeilingModel {
  pub sample_rate_hz: u64,
  pub samples_per_frame: u64,
  pub bytes_per_sample: u64,
  pub requested_presentation_fps: u64,
}

impl CeilingModel {
  pub const fn new(
    sample_rate_hz: u64,
    samples_per_frame: u64,
    bytes_per_sample: u64,
    requested_presentation_fps: u64,
  ) -> Self {
    Self {
      sample_rate_hz,
      samples_per_frame,
      bytes_per_sample,
      requested_presentation_fps,
    }
  }

  pub const fn theoretical_frames_per_second(self) -> u64 {
    if self.samples_per_frame == 0 {
      0
    } else {
      self.sample_rate_hz / self.samples_per_frame
    }
  }

  pub const fn presentation_frames_per_second(self) -> u64 {
    self.requested_presentation_fps
  }

  pub const fn sample_bytes_per_second(self) -> u64 {
    self.sample_rate_hz.saturating_mul(self.bytes_per_sample)
  }

  pub fn theoretical_frame_interval(self) -> Duration {
    if self.sample_rate_hz == 0 {
      Duration::ZERO
    } else {
      Duration::from_secs_f64(
        self.samples_per_frame as f64 / self.sample_rate_hz as f64,
      )
    }
  }

  pub const fn presentation_warning(self) -> &'static str {
    PRESENTATION_WARNING
  }
}

#[derive(
  Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
  DeviceCallback,
  Acquisition,
  CaptureQueue,
  CaptureWrite,
  FftDsp,
  EncryptSerialize,
  WebSocketSend,
  BrowserDecrypt,
  StatePublish,
  GpuUpload,
  GpuCompute,
  GpuSubmit,
  Presentation,
  TxSynthesis,
  TxDeviceWrite,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BenchmarkScenario {
  pub name: String,
  pub sample_rate_hz: u64,
  pub transform_size: usize,
  pub clients: usize,
  pub tx_signal: Option<String>,
}

pub fn benchmark_scenarios() -> Vec<BenchmarkScenario> {
  let mut scenarios = Vec::new();
  for sample_rate_hz in [1_000_000_u64, 3_200_000, 20_000_000] {
    for transform_size in [2_048_usize, 32_768, 262_144] {
      scenarios.push(BenchmarkScenario {
        name: format!("rx-{sample_rate_hz}-{transform_size}"),
        sample_rate_hz,
        transform_size,
        clients: 1,
        tx_signal: None,
      });
    }
  }
  for signal in ["d", "d_sharp", "wifi", "5g", "tone", "noise", "custom"] {
    scenarios.push(BenchmarkScenario {
      name: format!("tx-{signal}"),
      sample_rate_hz: 3_200_000,
      transform_size: 262_144,
      clients: 1,
      tx_signal: Some(signal.to_string()),
    });
  }
  scenarios
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CounterKind {
  FramesRequested,
  FramesProduced,
  FramesConsumed,
  FramesDropped,
  FramesLate,
  Samples,
  Bytes,
  SequenceGaps,
  Copies,
  CopiedBytes,
  Allocations,
  AllocatedBytes,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", content = "value")]
pub enum MetricAvailability {
  Available(f64),
  Unavailable,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CounterSnapshot {
  pub frames_requested: u64,
  pub frames_produced: u64,
  pub frames_consumed: u64,
  pub frames_dropped: u64,
  pub frames_late: u64,
  pub samples: u64,
  pub bytes: u64,
  pub sequence_gaps: u64,
  pub copies: u64,
  pub copied_bytes: u64,
  pub allocations: u64,
  pub allocated_bytes: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct LatencySummary {
  pub count: u64,
  pub p50_ms: f64,
  pub p95_ms: f64,
  pub p99_ms: f64,
  pub max_ms: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct StageSnapshot {
  pub latency: LatencySummary,
  pub queue_depth: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PipelineSnapshot {
  pub detailed_profiling_enabled: bool,
  pub counters: CounterSnapshot,
  pub stages: BTreeMap<Stage, StageSnapshot>,
  pub gpu_time: MetricAvailability,
  pub usb_utilization: MetricAvailability,
}

#[derive(Default)]
struct AtomicCounters {
  frames_requested: AtomicU64,
  frames_produced: AtomicU64,
  frames_consumed: AtomicU64,
  frames_dropped: AtomicU64,
  frames_late: AtomicU64,
  samples: AtomicU64,
  bytes: AtomicU64,
  sequence_gaps: AtomicU64,
  copies: AtomicU64,
  copied_bytes: AtomicU64,
  allocations: AtomicU64,
  allocated_bytes: AtomicU64,
}

#[derive(Default)]
struct StageMeasurements {
  /// Recent latency samples. Capped: profiling runs for the whole process
  /// lifetime, so an unbounded Vec would grow forever and make every
  /// snapshot's clone+sort slower over time. Percentiles therefore describe
  /// the most recent window, which is what live profiling wants anyway.
  latency_ns: Vec<u64>,
  queue_high_water: u64,
}

/// Maximum retained latency samples per stage.
const LATENCY_SAMPLE_CAP: usize = 4096;

pub struct PipelineMetrics {
  detailed: bool,
  counters: AtomicCounters,
  stages: Mutex<BTreeMap<Stage, StageMeasurements>>,
}

pub struct ProfilingSpan<'a> {
  metrics: Option<&'a PipelineMetrics>,
  stage: Stage,
  started_at: Instant,
}

impl<'a> ProfilingSpan<'a> {
  pub fn start(metrics: &'a PipelineMetrics, stage: Stage) -> Self {
    Self {
      metrics: metrics.detailed.then_some(metrics),
      stage,
      started_at: Instant::now(),
    }
  }
}

impl Drop for ProfilingSpan<'_> {
  fn drop(&mut self) {
    if let Some(metrics) = self.metrics {
      metrics.record_latency(self.stage, self.started_at.elapsed());
    }
  }
}

impl PipelineMetrics {
  pub fn new(detailed_profiling_enabled: bool) -> Self {
    Self {
      detailed: detailed_profiling_enabled,
      counters: AtomicCounters::default(),
      stages: Mutex::new(BTreeMap::new()),
    }
  }

  pub fn increment(&self, kind: CounterKind, amount: u64) {
    let counter = match kind {
      CounterKind::FramesRequested => &self.counters.frames_requested,
      CounterKind::FramesProduced => &self.counters.frames_produced,
      CounterKind::FramesConsumed => &self.counters.frames_consumed,
      CounterKind::FramesDropped => &self.counters.frames_dropped,
      CounterKind::FramesLate => &self.counters.frames_late,
      CounterKind::Samples => &self.counters.samples,
      CounterKind::Bytes => &self.counters.bytes,
      CounterKind::SequenceGaps => &self.counters.sequence_gaps,
      CounterKind::Copies => &self.counters.copies,
      CounterKind::CopiedBytes => &self.counters.copied_bytes,
      CounterKind::Allocations => &self.counters.allocations,
      CounterKind::AllocatedBytes => &self.counters.allocated_bytes,
    };
    counter.fetch_add(amount, Ordering::Relaxed);
  }

  pub fn record_latency(&self, stage: Stage, duration: Duration) {
    let nanos = duration.as_nanos().min(u64::MAX as u128) as u64;
    let mut stages = self.stages.lock().unwrap();
    let measurement = stages.entry(stage).or_default();
    if measurement.latency_ns.len() >= LATENCY_SAMPLE_CAP {
      // Retain the most recent half; bounds memory while keeping history.
      measurement.latency_ns.drain(..LATENCY_SAMPLE_CAP / 2);
    }
    measurement.latency_ns.push(nanos);
  }

  pub fn observe_queue(&self, stage: Stage, depth: u64) {
    let mut stages = self.stages.lock().unwrap();
    let measurement = stages.entry(stage).or_default();
    measurement.queue_high_water = measurement.queue_high_water.max(depth);
  }

  pub fn snapshot(&self) -> PipelineSnapshot {
    let load = |counter: &AtomicU64| counter.load(Ordering::Relaxed);
    let counters = CounterSnapshot {
      frames_requested: load(&self.counters.frames_requested),
      frames_produced: load(&self.counters.frames_produced),
      frames_consumed: load(&self.counters.frames_consumed),
      frames_dropped: load(&self.counters.frames_dropped),
      frames_late: load(&self.counters.frames_late),
      samples: load(&self.counters.samples),
      bytes: load(&self.counters.bytes),
      sequence_gaps: load(&self.counters.sequence_gaps),
      copies: load(&self.counters.copies),
      copied_bytes: load(&self.counters.copied_bytes),
      allocations: load(&self.counters.allocations),
      allocated_bytes: load(&self.counters.allocated_bytes),
    };
    let stages = self
      .stages
      .lock()
      .unwrap()
      .iter()
      .map(|(stage, values)| {
        (
          *stage,
          StageSnapshot {
            latency: summarize(&values.latency_ns),
            queue_depth: values.queue_high_water,
          },
        )
      })
      .collect();
    PipelineSnapshot {
      detailed_profiling_enabled: self.detailed,
      counters,
      stages,
      gpu_time: MetricAvailability::Unavailable,
      usb_utilization: MetricAvailability::Unavailable,
    }
  }
}

fn summarize(values: &[u64]) -> LatencySummary {
  if values.is_empty() {
    return LatencySummary::default();
  }
  let mut sorted = values.to_vec();
  sorted.sort_unstable();
  let percentile = |fraction: f64| {
    let index = ((sorted.len() as f64 * fraction).ceil() as usize)
      .saturating_sub(1)
      .min(sorted.len() - 1);
    sorted[index] as f64 / 1_000_000.0
  };
  LatencySummary {
    count: sorted.len() as u64,
    p50_ms: percentile(0.50),
    p95_ms: percentile(0.95),
    p99_ms: percentile(0.99),
    max_ms: *sorted.last().unwrap() as f64 / 1_000_000.0,
  }
}
