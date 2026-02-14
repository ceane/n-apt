use serde::{Deserialize, Serialize};

/// Training sample produced by the signal stitcher
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingSample {
  pub signal_area: String,
  pub label: String,
  pub data: Vec<f32>,
  pub timestamp: i64,
  pub frequency_min: f64,
  pub frequency_max: f64,
  pub sample_rate: u32,
}

/// Accumulates consecutive FFT power-spectrum frames into a single
/// stitched signal using overlap-add with a Hanning window.
///
/// Each call to `add_frame` appends a new spectrum snapshot.  When the
/// internal buffer reaches `target_frames` the stitcher yields a
/// complete `Vec<f32>` that can be sent to the CoreML service.
pub struct SignalStitcher {
  buffer: Vec<f32>,
  overlap_size: usize,
  window: Vec<f32>,
  fft_size: usize,
  target_frames: usize,
  frames_accumulated: usize,
}

impl SignalStitcher {
  /// Create a new stitcher.
  ///
  /// * `fft_size`       – number of bins per FFT frame (e.g. 32768)
  /// * `target_frames`  – how many frames to accumulate before yielding
  pub fn new(fft_size: usize, target_frames: usize) -> Self {
    let overlap_size = fft_size / 4; // 25 % overlap
    let window = Self::create_hanning_window(overlap_size);

    Self {
      buffer: Vec::with_capacity(fft_size * target_frames),
      overlap_size,
      window,
      fft_size,
      target_frames,
      frames_accumulated: 0,
    }
  }

  /// Feed one FFT power-spectrum frame.
  ///
  /// Returns `Some(stitched)` when `target_frames` have been accumulated.
  pub fn add_frame(&mut self, frame: &[f32]) -> Option<Vec<f32>> {
    if self.buffer.is_empty() {
      self.buffer.extend_from_slice(frame);
    } else {
      // Overlap-add: cross-fade the last `overlap_size` bins of the
      // buffer with the first `overlap_size` bins of the new frame.
      let buf_len = self.buffer.len();
      let overlap = self.overlap_size.min(frame.len()).min(buf_len);

      for i in 0..overlap {
        let buf_idx = buf_len - self.overlap_size + i;
        if buf_idx < buf_len {
          let w = self.window[i];
          self.buffer[buf_idx] = w * frame[i] + (1.0 - w) * self.buffer[buf_idx];
        }
      }

      // Append the non-overlapping tail
      if overlap < frame.len() {
        self.buffer.extend_from_slice(&frame[overlap..]);
      }
    }

    self.frames_accumulated += 1;

    if self.frames_accumulated >= self.target_frames {
      let result = self.buffer.clone();
      self.clear();
      return Some(result);
    }

    None
  }

  /// Return whatever has been accumulated so far (partial window).
  pub fn finalize(&mut self) -> Option<Vec<f32>> {
    if self.buffer.is_empty() {
      return None;
    }
    let result = self.buffer.clone();
    self.clear();
    Some(result)
  }

  /// Reset internal state.
  pub fn clear(&mut self) {
    self.buffer.clear();
    self.frames_accumulated = 0;
  }

  /// Number of frames accumulated so far.
  pub fn frames_accumulated(&self) -> usize {
    self.frames_accumulated
  }

  /// Target number of frames before auto-yield.
  pub fn target_frames(&self) -> usize {
    self.target_frames
  }

  /// Expected FFT size per frame.
  pub fn fft_size(&self) -> usize {
    self.fft_size
  }

  /// Build a Hanning window of length `n` used for the overlap region.
  fn create_hanning_window(n: usize) -> Vec<f32> {
    if n == 0 {
      return Vec::new();
    }
    (0..n)
      .map(|i| {
        let t = i as f32 / (n as f32 - 1.0).max(1.0);
        0.5 * (1.0 - (2.0 * std::f32::consts::PI * t).cos())
      })
      .collect()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_single_frame_finalize() {
    let mut s = SignalStitcher::new(8, 5);
    let frame = vec![1.0; 8];
    assert!(s.add_frame(&frame).is_none());
    assert_eq!(s.frames_accumulated(), 1);

    let result = s.finalize().unwrap();
    assert!(!result.is_empty());
    assert_eq!(s.frames_accumulated(), 0);
  }

  #[test]
  fn test_yields_at_target() {
    let target = 3;
    let fft_size = 16;
    let mut s = SignalStitcher::new(fft_size, target);

    let frame = vec![0.5; fft_size];
    assert!(s.add_frame(&frame).is_none());
    assert!(s.add_frame(&frame).is_none());
    let result = s.add_frame(&frame);
    assert!(result.is_some());
    // After yielding, internal state is cleared
    assert_eq!(s.frames_accumulated(), 0);
  }

  #[test]
  fn test_clear_resets() {
    let mut s = SignalStitcher::new(8, 10);
    s.add_frame(&[1.0; 8]);
    s.add_frame(&[2.0; 8]);
    assert_eq!(s.frames_accumulated(), 2);
    s.clear();
    assert_eq!(s.frames_accumulated(), 0);
    assert!(s.finalize().is_none());
  }

  #[test]
  fn test_finalize_empty_returns_none() {
    let mut s = SignalStitcher::new(8, 5);
    assert!(s.finalize().is_none());
  }

  #[test]
  fn test_overlap_blending() {
    let fft_size = 8;
    let mut s = SignalStitcher::new(fft_size, 10);

    // First frame: all 1.0
    s.add_frame(&[1.0; 8]);
    // Second frame: all 0.0 — overlap region should be blended
    s.add_frame(&[0.0; 8]);

    let result = s.finalize().unwrap();
    // The overlap region (last 2 bins of first frame blended with first 2 of second)
    // should contain values between 0.0 and 1.0
    let overlap_start = fft_size - (fft_size / 4);
    for i in overlap_start..fft_size {
      assert!(
        result[i] >= 0.0 && result[i] <= 1.0,
        "Overlap bin {} = {} should be in [0, 1]",
        i,
        result[i]
      );
    }
  }

  #[test]
  fn test_hanning_window_properties() {
    let w = SignalStitcher::create_hanning_window(64);
    assert_eq!(w.len(), 64);
    // Hanning window: starts at 0, peaks at 1 in the middle, ends at ~1 (last sample)
    assert!(w[0] < 0.01, "w[0] = {} should be near 0", w[0]);
    // Middle should be near 1.0
    let mid = w.len() / 2;
    assert!(w[mid] > 0.9, "w[{}] = {} should be > 0.9", mid, w[mid]);
    // Values should be monotonically increasing in the first half
    for i in 1..mid {
      assert!(w[i] >= w[i - 1], "w[{}] = {} < w[{}] = {}", i, w[i], i - 1, w[i - 1]);
    }
  }
}
