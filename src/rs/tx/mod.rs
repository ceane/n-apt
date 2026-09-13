pub mod ifft;
pub mod monitor;
pub mod safety;

/// Fill a device-owned callback buffer by repeating a stable, I/Q-aligned
/// payload. Chunk copies avoid a modulus operation for every transmitted byte.
pub fn repeat_iq_payload_into(
  payload: &[u8],
  output: &mut [u8],
) -> Result<(), &'static str> {
  if payload.is_empty() {
    return Err("TX payload is empty");
  }
  let mut written = 0;
  while written < output.len() {
    let count = payload.len().min(output.len() - written);
    output[written..written + count].copy_from_slice(&payload[..count]);
    written += count;
  }
  Ok(())
}
