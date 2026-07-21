//! TX-side foldover guard.
//!
//! The purpose of this module is to constrain transmit synthesis so that
//! only declared spectrum components make it into the emitted stream.

/// Describes a permitted spectrum interval in Hz.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpectrumBand {
  pub min_hz: f64,
  pub max_hz: f64,
}

impl SpectrumBand {
  pub fn contains(&self, freq_hz: f64) -> bool {
    freq_hz >= self.min_hz && freq_hz <= self.max_hz
  }
}

/// Guard object for future TX-side foldover suppression.
#[derive(Debug, Default)]
pub struct AntiFoldoverGuard {
  bands: Vec<SpectrumBand>,
}

impl AntiFoldoverGuard {
  pub fn new() -> Self {
    Self { bands: Vec::new() }
  }

  pub fn with_bands(bands: Vec<SpectrumBand>) -> Self {
    Self { bands }
  }

  pub fn add_band(&mut self, band: SpectrumBand) {
    self.bands.push(band);
  }

  pub fn bands(&self) -> &[SpectrumBand] {
    &self.bands
  }

  pub fn is_permitted(&self, freq_hz: f64) -> bool {
    self.bands.iter().any(|band| band.contains(freq_hz))
  }
}
