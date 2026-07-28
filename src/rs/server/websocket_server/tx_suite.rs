//! Capability and role resolution for the Tx Suite flow.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceCapability {
  pub source_id: String,
  pub can_rx: bool,
  pub can_tx: bool,
  pub full_duplex: bool,
}

impl DeviceCapability {
  pub fn new(
    source_id: &str,
    can_rx: bool,
    can_tx: bool,
    full_duplex: bool,
  ) -> Self {
    Self {
      source_id: source_id.to_string(),
      can_rx,
      can_tx,
      full_duplex,
    }
  }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TxSuitePair {
  pub rx_source_id: String,
  pub tx_source_id: String,
  pub rx_active: bool,
  pub tx_active: bool,
  pub tx_mode: &'static str,
}

/// Resolve the safest default Tx Suite pairing.
///
/// A separate Rx-capable source is preferred so a half-duplex Tx source can
/// remain reserved for transmission. A full-duplex source may satisfy both
/// roles when no separate pairing is available.
pub fn resolve_tx_suite_pair(
  devices: &[DeviceCapability],
) -> Option<TxSuitePair> {
  let rx = devices.iter().find(|device| device.can_rx)?;
  if let Some(tx) = devices
    .iter()
    .find(|device| device.source_id != rx.source_id && device.can_tx)
  {
    return Some(TxSuitePair {
      rx_source_id: rx.source_id.clone(),
      tx_source_id: tx.source_id.clone(),
      rx_active: true,
      tx_active: false,
      tx_mode: "standby",
    });
  }

  if rx.can_tx && rx.full_duplex {
    return Some(TxSuitePair {
      rx_source_id: rx.source_id.clone(),
      tx_source_id: rx.source_id.clone(),
      rx_active: true,
      tx_active: false,
      tx_mode: "standby",
    });
  }

  None
}

pub fn can_enter_tx_mode(device: &DeviceCapability, receiving: bool) -> bool {
  device.can_tx && (!receiving || device.full_duplex)
}

#[cfg(test)]
mod tests {
  use super::{can_enter_tx_mode, DeviceCapability};

  #[test]
  fn half_duplex_device_cannot_transmit_while_receiving() {
    let device = DeviceCapability::new("hackrf", true, true, false);
    assert!(!can_enter_tx_mode(&device, true));
    assert!(can_enter_tx_mode(&device, false));
  }

  #[test]
  fn full_duplex_device_can_transmit_while_receiving() {
    let device = DeviceCapability::new("duplex", true, true, true);
    assert!(can_enter_tx_mode(&device, true));
  }
}
// Hot-reload verification edit 2.
