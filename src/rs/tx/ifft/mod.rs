//! TX-side IFFT contracts.
//!
//! This module distinguishes how a waveform was produced from where it is
//! transported. A synthetic waveform can still be sent through a physical
//! HackRF device.

pub mod cache;
pub mod noise;
pub mod power;
pub mod synthesis;

pub use crate::dsp::ifft::complex_baseband::{
  canonical_complex_baseband_signal_key, generate_complex_baseband_iq,
  ComplexBasebandIQGenerator, ComplexBasebandIQParams,
};

pub use crate::server::websocket_server::complex_baseband::{
  mock_tx_monitor_noise_floor_rms, mock_tx_monitor_target_rms_from_dbm,
  resolve_effective_tx_power_dbm, resolve_mock_tx_noise_floor_db,
  synthesize_mock_tx_monitor_iq, MOCK_TX_DISPLAY_NAME,
  MOCK_TX_MONITOR_SAMPLE_CURSOR,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalOrigin {
  Synthetic,
  Captured,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TxTransport {
  Mock,
  HackRf,
}

#[cfg(test)]
mod tests {
  use super::{SignalOrigin, TxTransport};

  #[test]
  fn synthetic_waveform_can_use_hackrf_transport() {
    let origin = SignalOrigin::Synthetic;
    let transport = TxTransport::HackRf;

    assert_eq!(origin, SignalOrigin::Synthetic);
    assert_eq!(transport, TxTransport::HackRf);
  }
}
