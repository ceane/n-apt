//! DSP-worker output contracts.

use std::sync::Arc;

/// A display-oriented spectrum frame. Display consumers may receive only the
/// latest frame; lossless capture uses the acquisition frame instead.
#[derive(Debug, Clone)]
pub struct SpectrumFrame {
  pub source_epoch: u64,
  pub frame_sequence: u64,
  pub bins: Arc<[f32]>,
}

impl SpectrumFrame {
  pub fn new(source_epoch: u64, frame_sequence: u64, bins: Vec<f32>) -> Self {
    Self {
      source_epoch,
      frame_sequence,
      bins: bins.into(),
    }
  }

  pub fn belongs_to_epoch(&self, source_epoch: u64) -> bool {
    self.source_epoch == source_epoch
  }
}
