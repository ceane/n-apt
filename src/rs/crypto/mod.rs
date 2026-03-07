//! Cryptographic utilities for AES-256-GCM payload encryption and
//! HMAC-based challenge–response authentication.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::Hmac;
use hmac::Mac;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

/// PBKDF2 iteration count — must match the frontend WebCrypto derivation.
const PBKDF2_ITERATIONS: u32 = 100_000;
/// Salt used for PBKDF2 key derivation (fixed, shared between client/server).
/// In production this could be per-session, but a fixed salt is acceptable when
/// the passkey itself has sufficient entropy.
const PBKDF2_SALT: &[u8] = b"n-apt-aes-salt-v1";

/// Derive a 256-bit AES key from a passkey using PBKDF2-HMAC-SHA256.
pub fn derive_key(passkey: &str) -> [u8; 32] {
  let mut key = [0u8; 32];
  pbkdf2_hmac::<Sha256>(
    passkey.as_bytes(),
    PBKDF2_SALT,
    PBKDF2_ITERATIONS,
    &mut key,
  );
  key
}

/// Generate a random 32-byte nonce for the challenge–response handshake.
pub fn generate_nonce() -> [u8; 32] {
  let mut nonce = [0u8; 32];
  OsRng.fill_bytes(&mut nonce);
  nonce
}

/// Compute HMAC-SHA256 over `data` using the given `key`.
pub fn compute_hmac(key: &[u8; 32], data: &[u8]) -> Vec<u8> {
  let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key)
    .expect("HMAC key length is always valid");
  mac.update(data);
  mac.finalize().into_bytes().to_vec()
}

/// Verify an HMAC-SHA256 tag. Returns `true` when the tag is valid.
pub fn verify_hmac(key: &[u8; 32], data: &[u8], tag: &[u8]) -> bool {
  let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key)
    .expect("HMAC key length is always valid");
  mac.update(data);
  mac.verify_slice(tag).is_ok()
}

/// Encrypt `plaintext` with AES-256-GCM.
/// Returns raw bytes: `12-byte IV || ciphertext || 16-byte tag`.
pub fn encrypt_payload_binary(
  key: &[u8; 32],
  plaintext: &[u8],
) -> Result<Vec<u8>, String> {
  let cipher =
    Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init: {e}"))?;

  let mut iv_bytes = [0u8; 12];
  OsRng.fill_bytes(&mut iv_bytes);
  let nonce = Nonce::from_slice(&iv_bytes);

  let ciphertext = cipher
    .encrypt(nonce, plaintext)
    .map_err(|e| format!("encrypt: {e}"))?;

  // Wire format: IV || ciphertext (which includes the GCM tag)
  let mut out = Vec::with_capacity(12 + ciphertext.len());
  out.extend_from_slice(&iv_bytes);
  out.extend_from_slice(&ciphertext);

  Ok(out)
}

/// Encrypt `plaintext` with AES-256-GCM.
/// Returns `base64( 12-byte IV || ciphertext || 16-byte tag )`.
pub fn encrypt_payload(
  key: &[u8; 32],
  plaintext: &[u8],
) -> Result<String, String> {
  let cipher =
    Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init: {e}"))?;

  let mut iv_bytes = [0u8; 12];
  OsRng.fill_bytes(&mut iv_bytes);
  let nonce = Nonce::from_slice(&iv_bytes);

  let ciphertext = cipher
    .encrypt(nonce, plaintext)
    .map_err(|e| format!("encrypt: {e}"))?;

  // Wire format: IV || ciphertext (which includes the GCM tag)
  let mut out = Vec::with_capacity(12 + ciphertext.len());
  out.extend_from_slice(&iv_bytes);
  out.extend_from_slice(&ciphertext);

  Ok(B64.encode(&out))
}

/// Encode raw bytes as base64.
pub fn to_base64(data: &[u8]) -> String {
  B64.encode(data)
}

/// Decode base64 string to raw bytes.
pub fn from_base64(encoded: &str) -> Result<Vec<u8>, String> {
  B64
    .decode(encoded)
    .map_err(|e| format!("base64 decode: {e}"))
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
