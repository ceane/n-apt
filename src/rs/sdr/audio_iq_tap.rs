//! Contiguous IQ retention for streaming consumers such as browser-side audio.
//!
//! The display path deliberately keeps only the freshest frame so the waterfall
//! stays real-time. That policy drops every sample which arrived while the
//! previous frame was being transformed and sent, and audio cannot tolerate
//! those holes: a missing span is both a gap in the timeline and a phase
//! discontinuity that an FM discriminator turns into an audible click.
//!
//! This tap retains samples independently of the display frame loop. It is
//! bounded by a latency budget rather than by a frame size, so a consumer that
//! keeps up never loses a sample, and one that falls permanently behind sheds
//! the oldest audio instead of growing without limit.

use std::collections::VecDeque;

/// How much audio the tap may buffer before it starts shedding the oldest data.
pub const DEFAULT_MAX_LATENCY_SECS: f64 = 0.5;

/// Fallback capacity used before a sample rate is known.
const FALLBACK_CAPACITY_BYTES: usize = 1 << 20;

/// One contiguous span of retained IQ, handed to a streaming consumer.
#[derive(Debug, Clone)]
pub struct AudioIqBlock {
  pub data: Vec<u8>,
  pub sample_rate: u32,
  /// Cumulative bytes shed because the consumer fell behind. A rising value
  /// means the audio timeline has a real hole the consumer should resynchronize.
  pub dropped_bytes: u64,
}

/// A bounded, contiguous IQ byte buffer with interleaved I/Q parity preserved.
#[derive(Debug)]
pub struct AudioIqTap {
  enabled: bool,
  buffer: VecDeque<u8>,
  capacity_bytes: usize,
  dropped_bytes: u64,
}

impl Default for AudioIqTap {
  fn default() -> Self {
    Self::new()
  }
}

/// Round down to an even count so draining or dropping never swaps I with Q.
fn even(count: usize) -> usize {
  count & !1
}

impl AudioIqTap {
  pub fn new() -> Self {
    Self {
      enabled: false,
      buffer: VecDeque::new(),
      capacity_bytes: FALLBACK_CAPACITY_BYTES,
      dropped_bytes: 0,
    }
  }

  pub fn is_enabled(&self) -> bool {
    self.enabled
  }

  /// Enable or disable retention. Disabling releases the buffered audio so a
  /// paused or non-listening session does not hand back stale samples later.
  pub fn set_enabled(&mut self, enabled: bool) {
    if self.enabled == enabled {
      return;
    }
    self.enabled = enabled;
    if !enabled {
      self.clear();
    }
  }

  /// Size the latency budget for the active sample rate (2 bytes per complex
  /// sample). Shrinking the budget sheds the oldest audio immediately.
  pub fn set_capacity_for_sample_rate(&mut self, sample_rate: u32) {
    let bytes = (sample_rate as f64 * 2.0 * DEFAULT_MAX_LATENCY_SECS) as usize;
    self.capacity_bytes = even(bytes.max(2));
    self.enforce_capacity();
  }

  pub fn capacity_bytes(&self) -> usize {
    self.capacity_bytes
  }

  pub fn len(&self) -> usize {
    self.buffer.len()
  }

  pub fn is_empty(&self) -> bool {
    self.buffer.is_empty()
  }

  /// Total bytes shed because the consumer fell behind the latency budget.
  pub fn dropped_bytes(&self) -> u64 {
    self.dropped_bytes
  }

  pub fn clear(&mut self) {
    self.buffer.clear();
  }

  /// Retain a chunk exactly as it arrived from the device. No-op while disabled
  /// so a session that is not listening pays nothing.
  pub fn push(&mut self, chunk: &[u8]) {
    if !self.enabled || chunk.is_empty() {
      return;
    }
    self.buffer.extend(chunk.iter().copied());
    self.enforce_capacity();
  }

  /// Take everything retained so far as one contiguous block.
  pub fn take(&mut self) -> Vec<u8> {
    let take = even(self.buffer.len());
    if take == 0 {
      return Vec::new();
    }
    let mut out = Vec::with_capacity(take);
    out.extend(self.buffer.drain(..take));
    out
  }

  fn enforce_capacity(&mut self) {
    if self.buffer.len() <= self.capacity_bytes {
      return;
    }
    let discard = even(self.buffer.len() - self.capacity_bytes);
    if discard == 0 {
      return;
    }
    self.buffer.drain(..discard);
    self.dropped_bytes = self.dropped_bytes.saturating_add(discard as u64);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn enabled_tap(capacity_bytes: usize) -> AudioIqTap {
    let mut tap = AudioIqTap::new();
    tap.set_enabled(true);
    tap.capacity_bytes = capacity_bytes;
    tap
  }

  #[test]
  fn retains_every_sample_across_chunks_so_audio_has_no_holes() {
    let mut tap = enabled_tap(1024);
    tap.push(&[1, 2, 3, 4]);
    tap.push(&[5, 6]);
    tap.push(&[7, 8, 9, 10]);

    assert_eq!(tap.take(), vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert_eq!(tap.dropped_bytes(), 0);
    assert!(tap.is_empty(), "take must consume the retained block");
  }

  #[test]
  fn a_disabled_tap_costs_nothing() {
    let mut tap = AudioIqTap::new();
    tap.push(&[1, 2, 3, 4]);

    assert!(tap.is_empty());
    assert!(tap.take().is_empty());
  }

  #[test]
  fn disabling_releases_buffered_audio_instead_of_replaying_it_later() {
    let mut tap = enabled_tap(1024);
    tap.push(&[1, 2, 3, 4]);
    tap.set_enabled(false);
    tap.set_enabled(true);

    assert!(tap.take().is_empty());
  }

  #[test]
  fn sheds_oldest_audio_when_the_consumer_falls_behind_the_latency_budget() {
    let mut tap = enabled_tap(6);
    tap.push(&[1, 2, 3, 4, 5, 6]);
    tap.push(&[7, 8, 9, 10]);

    // The newest 6 bytes survive; the oldest 4 are shed and accounted for.
    assert_eq!(tap.take(), vec![5, 6, 7, 8, 9, 10]);
    assert_eq!(tap.dropped_bytes(), 4);
  }

  #[test]
  fn shedding_preserves_iq_parity() {
    let mut tap = enabled_tap(4);
    // An odd overflow must still discard an even number of bytes, otherwise I
    // and Q swap and the spectrum mirrors. Shedding the minimum even amount can
    // leave the buffer one byte over budget, which is bounded and harmless.
    tap.push(&[1, 2, 3, 4, 5, 6, 7]);

    assert_eq!(tap.dropped_bytes(), 2);
    assert_eq!(tap.take(), vec![3, 4, 5, 6], "must resume on a pair boundary");
  }

  #[test]
  fn take_never_splits_an_iq_pair() {
    let mut tap = enabled_tap(1024);
    tap.push(&[1, 2, 3]);

    assert_eq!(tap.take(), vec![1, 2]);
    assert_eq!(tap.len(), 1, "the stray byte waits for its pair");
    tap.push(&[4]);
    assert_eq!(tap.take(), vec![3, 4]);
  }

  #[test]
  fn latency_budget_is_derived_from_the_active_sample_rate() {
    let mut tap = AudioIqTap::new();
    tap.set_enabled(true);
    tap.set_capacity_for_sample_rate(3_200_000);

    // 3.2 MS/s * 2 bytes * 0.5 s
    assert_eq!(tap.capacity_bytes(), 3_200_000);
  }
}
