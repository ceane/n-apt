//! Cryptographic utilities for AES-256-GCM payload encryption and
//! HMAC-based challenge–response authentication.

use aes_gcm::aead::{Aead, KeyInit as AeadKeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::{Hmac, KeyInit as MacKeyInit, Mac};
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;
use std::sync::OnceLock;

/// PBKDF2 iteration count — must match the frontend WebCrypto derivation.
const PBKDF2_ITERATIONS: u32 = 100_000;

/// Global salt used for PBKDF2 key derivation.
/// Defaults to a fixed value but can be overridden via NAPT_PBKDF2_SALT env var.
static PBKDF2_SALT: OnceLock<Vec<u8>> = OnceLock::new();

/// Get the PBKDF2 salt, either from NAPT_PBKDF2_SALT env var or the default value.
pub fn get_pbkdf2_salt() -> &'static [u8] {
  PBKDF2_SALT.get_or_init(|| {
    std::env::var("NAPT_PBKDF2_SALT")
      .map(|s| s.into_bytes())
      .unwrap_or_else(|_| b"n-apt-aes-salt-v1".to_vec())
  })
}

/// Derive a 256-bit AES key from a passkey using PBKDF2-HMAC-SHA256.
pub fn derive_key(passkey: &str) -> [u8; 32] {
  let mut key = [0u8; 32];
  let trimmed = passkey.trim();
  pbkdf2_hmac::<Sha256>(
    trimmed.as_bytes(),
    get_pbkdf2_salt(),
    PBKDF2_ITERATIONS,
    &mut key,
  );
  key
}

/// Generate a random 32-byte nonce for the challenge–response handshake.
pub fn generate_nonce() -> [u8; 32] {
  ::rand::random()
}

/// Generate a random 256-bit AES key.
pub fn generate_key() -> [u8; 32] {
  ::rand::random()
}

/// Compute HMAC-SHA256 over `data` using the given `key`.
pub fn compute_hmac(key: &[u8; 32], data: &[u8]) -> Vec<u8> {
  let mut mac: Hmac<Sha256> =
    MacKeyInit::new_from_slice(key).expect("HMAC key length is always valid");
  mac.update(data);
  mac.finalize().into_bytes().to_vec()
}

/// Verify an HMAC-SHA256 tag. Returns `true` when the tag is valid.
pub fn verify_hmac(key: &[u8; 32], data: &[u8], tag: &[u8]) -> bool {
  let mut mac: Hmac<Sha256> =
    MacKeyInit::new_from_slice(key).expect("HMAC key length is always valid");
  mac.update(data);
  mac.verify_slice(tag).is_ok()
}

/// Encrypt `plaintext` with AES-256-GCM.
/// Returns raw bytes: `12-byte IV || ciphertext || 16-byte tag`.
pub fn encrypt_payload_binary(
  key: &[u8; 32],
  plaintext: &[u8],
) -> Result<Vec<u8>> {
  let cipher: Aes256Gcm = AeadKeyInit::new_from_slice(key)
    .map_err(|e| anyhow!("cipher init: {e}"))?;

  let iv_bytes: [u8; 12] = ::rand::random();
  let nonce = Nonce::from_slice(&iv_bytes);

  let ciphertext = cipher
    .encrypt(nonce, plaintext)
    .map_err(|e| anyhow!("encrypt: {e}"))?;

  // Wire format: IV || ciphertext (which includes the GCM tag)
  let mut out = Vec::with_capacity(12 + ciphertext.len());
  out.extend_from_slice(&iv_bytes);
  out.extend_from_slice(&ciphertext);

  Ok(out)
}

/// Encrypt `plaintext` with AES-256-GCM.
/// Returns `base64( 12-byte IV || ciphertext || 16-byte tag )`.
pub fn encrypt_payload(key: &[u8; 32], plaintext: &[u8]) -> Result<String> {
  let encrypted = encrypt_payload_binary(key, plaintext)?;
  Ok(B64.encode(&encrypted))
}

/// Decrypt `payload` with AES-256-GCM.
/// Input raw bytes: `12-byte IV || ciphertext || 16-byte tag`.
pub fn decrypt_payload_binary(
  key: &[u8; 32],
  payload: &[u8],
) -> Result<Vec<u8>> {
  if payload.len() < 12 {
    return Err(anyhow!("payload too short for IV"));
  }

  let cipher: Aes256Gcm = AeadKeyInit::new_from_slice(key)
    .map_err(|e| anyhow!("cipher init: {e}"))?;

  let (iv_bytes, ciphertext) = payload.split_at(12);
  let nonce = Nonce::from_slice(iv_bytes);

  let plaintext = cipher
    .decrypt(nonce, ciphertext)
    .map_err(|e| anyhow!("decrypt: {e}"))?;

  Ok(plaintext)
}

/// Decrypt `payload_base64` with AES-256-GCM.
/// Input is `base64( 12-byte IV || ciphertext || 16-byte tag )`.
pub fn decrypt_payload(
  key: &[u8; 32],
  payload_base64: &str,
) -> Result<Vec<u8>> {
  let payload = from_base64(payload_base64)?;
  decrypt_payload_binary(key, &payload)
}

/// Decrypt f32 waveform data from encrypted payload
pub fn decrypt_waveform(
  key: &[u8; 32],
  encrypted_data: &[u8],
) -> Result<Vec<f32>> {
  let decrypted_bytes = decrypt_payload_binary(key, encrypted_data)?;

  if decrypted_bytes.len() % 4 != 0 {
    return Err(anyhow!(
      "Decrypted data length not divisible by 4 for f32 conversion"
    ));
  }

  // Convert bytes to f32 array
  let f32_slice: &[f32] = bytemuck::try_cast_slice(&decrypted_bytes)
    .map_err(|e| anyhow!("Failed to cast bytes to f32: {}", e))?;

  Ok(f32_slice.to_vec())
}

/// Decrypt raw I/Q data (remains as bytes)
pub fn decrypt_iq_data(
  key: &[u8; 32],
  encrypted_data: &[u8],
) -> Result<Vec<u8>> {
  decrypt_payload_binary(key, encrypted_data)
}

/// Encode raw bytes as base64.
pub fn to_base64(data: &[u8]) -> String {
  B64.encode(data)
}

/// Decode base64 string to raw bytes.
pub fn from_base64(encoded: &str) -> Result<Vec<u8>> {
  B64
    .decode(encoded)
    .map_err(|e| anyhow!("base64 decode: {e}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_derive_key_deterministic() {
    let key1 = derive_key("test-passkey");
    let key2 = derive_key("test-passkey");
    assert_eq!(key1, key2, "Same passkey must produce same key");
  }

  #[test]
  fn test_derive_key_different_passkeys() {
    let key1 = derive_key("passkey-a");
    let key2 = derive_key("passkey-b");
    assert_ne!(key1, key2, "Different passkeys must produce different keys");
  }

  #[test]
  fn test_derive_key_length() {
    let key = derive_key("any-passkey");
    assert_eq!(key.len(), 32, "Key must be 256 bits (32 bytes)");
  }

  #[test]
  fn test_generate_nonce_uniqueness() {
    let n1 = generate_nonce();
    let n2 = generate_nonce();
    assert_ne!(n1, n2, "Two nonces should be unique");
  }

  #[test]
  fn test_generate_nonce_length() {
    let nonce = generate_nonce();
    assert_eq!(nonce.len(), 32);
  }

  #[test]
  fn test_hmac_roundtrip() {
    let key = derive_key("hmac-test");
    let data = b"challenge-nonce-data";
    let tag = compute_hmac(&key, data);
    assert!(
      verify_hmac(&key, data, &tag),
      "HMAC must verify with correct key and data"
    );
  }

  #[test]
  fn test_hmac_wrong_key_fails() {
    let key1 = derive_key("key-one");
    let key2 = derive_key("key-two");
    let data = b"some data";
    let tag = compute_hmac(&key1, data);
    assert!(
      !verify_hmac(&key2, data, &tag),
      "HMAC must fail with wrong key"
    );
  }

  #[test]
  fn test_hmac_wrong_data_fails() {
    let key = derive_key("hmac-test");
    let tag = compute_hmac(&key, b"original");
    assert!(
      !verify_hmac(&key, b"tampered", &tag),
      "HMAC must fail with wrong data"
    );
  }

  #[test]
  fn test_hmac_truncated_tag_fails() {
    let key = derive_key("hmac-test");
    let tag = compute_hmac(&key, b"data");
    assert!(
      !verify_hmac(&key, b"data", &tag[..16]),
      "Truncated tag must fail"
    );
  }

  #[test]
  fn test_encrypt_payload_produces_valid_base64() {
    let key = derive_key("encrypt-test");
    let plaintext = b"hello world";
    let encrypted = encrypt_payload(&key, plaintext).unwrap();
    // Must be valid base64
    let decoded = from_base64(&encrypted).unwrap();
    // Wire format: 12-byte IV + ciphertext (>= 16 bytes for GCM tag)
    assert!(
      decoded.len() >= 12 + 16,
      "Encrypted output too short: {} bytes",
      decoded.len()
    );
  }

  #[test]
  fn test_encrypt_payload_different_each_time() {
    let key = derive_key("encrypt-test");
    let plaintext = b"same input";
    let e1 = encrypt_payload(&key, plaintext).unwrap();
    let e2 = encrypt_payload(&key, plaintext).unwrap();
    assert_ne!(
      e1, e2,
      "Encryption must use random IV, producing different ciphertext"
    );
  }

  #[test]
  fn test_base64_roundtrip() {
    let data = b"binary \x00\xff data";
    let encoded = to_base64(data);
    let decoded = from_base64(&encoded).unwrap();
    assert_eq!(decoded, data);
  }

  #[test]
  fn test_base64_empty() {
    let encoded = to_base64(b"");
    let decoded = from_base64(&encoded).unwrap();
    assert!(decoded.is_empty());
  }

  #[test]
  fn test_from_base64_invalid() {
    let result = from_base64("not!valid!base64!!!");
    assert!(result.is_err());
  }
}
