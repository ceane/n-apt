//! TX-oriented synthesis processor.
//!
//! This is a starting point for inverse-transform style signal generation.
//! It is not wired into the emit path yet; the current mock APT path still
//! synthesizes directly in the time domain.

use anyhow::Result;

/// Minimal inverse-transform style processor scaffold for TX work.
#[derive(Debug, Default)]
pub struct IfftProcessor {
  tx_enabled: bool,
}

impl IfftProcessor {
  /// Create a new processor scaffold.
  pub fn new() -> Self {
    Self { tx_enabled: false }
  }

  /// Enable or disable TX-side synthesis.
  pub fn set_tx_enabled(&mut self, enabled: bool) {
    self.tx_enabled = enabled;
  }

  /// Return whether TX-side synthesis is enabled.
  pub fn tx_enabled(&self) -> bool {
    self.tx_enabled
  }

  /// Placeholder entry point for future IFFT-driven TX synthesis.
  pub fn synthesize(&self) -> Result<()> {
    if !self.tx_enabled {
      return Ok(());
    }

    Ok(())
  }
}
