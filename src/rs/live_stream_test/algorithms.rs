//! Lightweight diagnostics for source-scoped managed RX frames.

use super::types::LiveData;

/// Diagnostic summary for the standalone live stream client.
#[derive(Default)]
pub struct AlgorithmTester {
  frame_count: u64,
}

impl AlgorithmTester {
  pub fn new() -> Self {
    Self::default()
  }

  /// Report basic I/Q statistics while preserving stream identity in the log.
  pub fn process_data(&mut self, frame: LiveData) {
    self.frame_count += 1;

    let mut sample_count = 0_u64;
    let mut sum_i = 0.0_f64;
    let mut sum_q = 0.0_f64;
    let mut sum_power = 0.0_f64;
    for sample in frame.iq_bytes.chunks_exact(2) {
      let i = iq_byte_to_sample(sample[0]);
      let q = iq_byte_to_sample(sample[1]);
      sample_count += 1;
      sum_i += i;
      sum_q += q;
      sum_power += i * i + q * q;
    }

    let divisor = sample_count as f64;
    println!(
      "📶 RX {} epoch {} sequence {}: {} samples, {:.1} MHz center, {:.1} MHz rate",
      frame.source_id,
      frame.stream_epoch,
      frame.sequence,
      sample_count,
      frame.center_frequency_hz as f64 / 1e6,
      frame.sample_rate_hz as f64 / 1e6,
    );
    println!(
      "📈 I/Q Stats: I_avg={:.3}, Q_avg={:.3}, Power_avg={:.3}",
      sum_i / divisor,
      sum_q / divisor,
      sum_power / divisor,
    );

    if self.frame_count % 10 == 0 {
      self.print_status();
    }
  }

  /// Run built-in example algorithms.
  pub fn run_example_algorithms(&mut self) {
    println!("🧪 Running example algorithms...");
    println!("📊 Processing managed RX I/Q frames...");
    println!("Press Ctrl+C to stop");
    println!("{}", "─".repeat(50));
  }

  fn print_status(&self) {
    println!("📊 Processed {} managed RX frames", self.frame_count);
  }
}

fn iq_byte_to_sample(byte: u8) -> f64 {
  (byte as f64 - 128.0) / 128.0
}

#[cfg(test)]
mod tests {
  use super::*;

  fn frame(sequence: u64) -> LiveData {
    LiveData {
      source_id: "mock-apt".to_owned(),
      stream_epoch: 9,
      sequence,
      timestamp: 0,
      center_frequency_hz: 137_100_000,
      sample_rate_hz: 3_200_000,
      iq_bytes: vec![128, 128, 255, 0],
    }
  }

  #[test]
  fn iq_bytes_use_unsigned_offset_binary_scaling() {
    assert_eq!(iq_byte_to_sample(128), 0.0);
    assert_eq!(iq_byte_to_sample(0), -1.0);
    assert_eq!(iq_byte_to_sample(255), 127.0 / 128.0);
  }

  #[test]
  fn diagnostic_counts_only_managed_rx_frames() {
    let mut tester = AlgorithmTester::new();
    tester.process_data(frame(1));
    tester.process_data(frame(2));
    assert_eq!(tester.frame_count, 2);
  }
}
