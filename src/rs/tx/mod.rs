pub mod ifft;
pub mod monitor;
pub mod safety;

use std::sync::Arc;

/// Keep each I/Q pair together before sharing a TX payload across consumers.
pub fn into_iq_aligned_arc(mut payload: Vec<u8>) -> Arc<Vec<u8>> {
  if payload.len() % 2 != 0 {
    payload.push(0);
  }
  Arc::new(payload)
}

/// Fill a device-owned callback buffer by repeating an I/Q-aligned payload.
/// Doubling the filled prefix reduces copies for short waveforms.
pub fn repeat_iq_payload_into(
  payload: &[u8],
  output: &mut [u8],
) -> Result<(), &'static str> {
  if payload.is_empty() {
    return Err("TX payload is empty");
  }

  let mut filled = payload.len().min(output.len());
  output[..filled].copy_from_slice(&payload[..filled]);
  while filled < output.len() {
    let count = filled.min(output.len() - filled);
    output.copy_within(0..count, filled);
    filled += count;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::{into_iq_aligned_arc, repeat_iq_payload_into};
  use std::sync::Arc;

  #[test]
  fn repeats_payload_and_fills_partial_tail_exactly() {
    let mut output = [0; 11];

    repeat_iq_payload_into(&[1, 2, 3, 4], &mut output).unwrap();

    assert_eq!(output, [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3]);
  }

  #[test]
  fn copies_only_the_prefix_when_payload_exceeds_transfer() {
    let mut output = [0; 4];

    repeat_iq_payload_into(&[1, 2, 3, 4, 5, 6], &mut output).unwrap();

    assert_eq!(output, [1, 2, 3, 4]);
  }

  #[test]
  fn rejects_an_empty_payload() {
    assert_eq!(
      repeat_iq_payload_into(&[], &mut [0; 4]),
      Err("TX payload is empty")
    );
  }

  #[test]
  fn aligns_odd_payload_once_before_sharing() {
    let payload = into_iq_aligned_arc(vec![7, 8, 9]);

    assert_eq!(payload.as_slice(), &[7, 8, 9, 0]);
  }

  #[test]
  fn already_aligned_payload_keeps_its_byte_order() {
    let original = Arc::new(vec![7, 8, 9, 10]);
    let shared = into_iq_aligned_arc(original.as_ref().clone());

    assert_eq!(shared.as_slice(), original.as_slice());
  }
}
