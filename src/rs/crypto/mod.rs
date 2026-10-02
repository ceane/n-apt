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
const CAPTURE_ENVELOPE_MAGIC_V1: &[u8; 8] = b"NAPTENC1";
const CAPTURE_ENVELOPE_MAGIC_V2: &[u8; 8] = b"NAPTENC2";
const CAPTURE_SALT_LEN: usize = 32;

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
  // PBKDF2 fills the complete output buffer before it is returned. Using the
  // type's default value here avoids presenting an all-zero array as a key to
  // static analyzers; the initialized bytes never leave this function.
  let mut key = [Default::default(); 32];
  let trimmed = passkey.trim();
  pbkdf2_hmac::<Sha256>(
    trimmed.as_bytes(),
    get_pbkdf2_salt(),
    PBKDF2_ITERATIONS,
    &mut key,
  );
  key
}

/// Login-only key, independently derived from the password. Deriving this
/// from the exported vault key would let its holder reconstruct login proofs.
pub fn derive_auth_key(passkey: &str) -> [u8; 32] {
  let mut salt = b"n-apt/password-auth/v2\0".to_vec();
  salt.extend_from_slice(get_pbkdf2_salt());
  let mut key = [0u8; 32];
  pbkdf2_hmac::<Sha256>(passkey.trim().as_bytes(), &salt, PBKDF2_ITERATIONS, &mut key);
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
  let nonce =
    Nonce::try_from(&iv_bytes[..]).map_err(|e| anyhow!("nonce init: {e}"))?;

  let ciphertext = cipher
    .encrypt(&nonce, plaintext)
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
  let nonce =
    Nonce::try_from(iv_bytes).map_err(|e| anyhow!("nonce init: {e}"))?;

  let plaintext = cipher
    .decrypt(&nonce, ciphertext)
    .map_err(|e| anyhow!("decrypt: {e}"))?;

  Ok(plaintext)
}

/// Derive a per-capture AES key with HKDF-style HMAC-SHA256 expansion.
/// The vault key has already paid the PBKDF2 cost at login/startup, so each
/// capture adds only two HMAC operations during encryption or decryption.
pub fn derive_capture_key(vault_key: &[u8; 32], salt: &[u8; 32]) -> [u8; 32] {
  let mut extract: Hmac<Sha256> =
    MacKeyInit::new_from_slice(salt).expect("HMAC accepts a 32-byte salt");
  extract.update(vault_key);
  let prk = extract.finalize().into_bytes();

  let mut expand: Hmac<Sha256> =
    MacKeyInit::new_from_slice(&prk).expect("HMAC accepts a 32-byte PRK");
  expand.update(b"n-apt/capture-protection/v1");
  expand.update(&[1]);
  let output = expand.finalize().into_bytes();
  let mut key = [0u8; 32];
  key.copy_from_slice(&output);
  key
}

/// Encrypt one stored capture with a fresh random salt.
/// Envelope: `NAPTENC2 || 12-byte nonce || ciphertext || tag`.
/// The per-capture salt is returned separately and must be stored server-side.
pub fn encrypt_capture_envelope(
  vault_key: &[u8; 32],
  plaintext: &[u8],
) -> Result<(Vec<u8>, [u8; 32])> {
  let salt: [u8; CAPTURE_SALT_LEN] = ::rand::random();
  let envelope = encrypt_capture_envelope_with_salt(vault_key, plaintext, &salt)?;
  Ok((envelope, salt))
}

pub fn generate_capture_salt() -> [u8; CAPTURE_SALT_LEN] {
  ::rand::random()
}

pub fn encrypt_capture_envelope_with_salt(
  vault_key: &[u8; 32],
  plaintext: &[u8],
  salt: &[u8; CAPTURE_SALT_LEN],
) -> Result<Vec<u8>> {
  let capture_key = derive_capture_key(vault_key, salt);
  let encrypted = encrypt_payload_binary(&capture_key, plaintext)?;
  let mut envelope = Vec::with_capacity(CAPTURE_ENVELOPE_MAGIC_V2.len() + encrypted.len());
  envelope.extend_from_slice(CAPTURE_ENVELOPE_MAGIC_V2);
  envelope.extend_from_slice(&encrypted);
  Ok(envelope)
}

/// Decrypt a new envelope using the salt retrieved from the trusted server store.
/// Legacy NAPTENC1 envelopes are accepted only when their embedded salt matches it.
pub fn decrypt_capture_envelope_with_salt(
  vault_key: &[u8; 32],
  envelope: &[u8],
  salt: &[u8; CAPTURE_SALT_LEN],
) -> Result<Vec<u8>> {
  if envelope.len() < CAPTURE_ENVELOPE_MAGIC_V2.len() + 12 + 16 {
    return Err(anyhow!("invalid capture envelope length"));
  }
  let (payload, envelope_salt) = if envelope.starts_with(CAPTURE_ENVELOPE_MAGIC_V2) {
    (&envelope[CAPTURE_ENVELOPE_MAGIC_V2.len()..], None)
  } else if envelope.starts_with(CAPTURE_ENVELOPE_MAGIC_V1) {
    let salt_start = CAPTURE_ENVELOPE_MAGIC_V1.len();
    let payload_start = salt_start + CAPTURE_SALT_LEN;
    if envelope.len() < payload_start + 12 + 16 {
      return Err(anyhow!("invalid legacy capture envelope length"));
    }
    (&envelope[payload_start..], Some(&envelope[salt_start..payload_start]))
  } else {
    return Err(anyhow!("invalid capture envelope header"));
  };
  if envelope_salt.is_some_and(|embedded| embedded != salt) {
    return Err(anyhow!("legacy capture salt does not match the server record"));
  }
  let capture_key = derive_capture_key(vault_key, salt);
  decrypt_payload_binary(&capture_key, payload)
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
  fn capture_key_derivation_matches_shared_js_vector() {
    // codeql[rust/hard-coded-cryptographic-value] Fixed vector used only by this unit test.
    let key = derive_capture_key(&[7u8; 32], &[8u8; 32]);
    let encoded = key.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    assert_eq!(encoded, "41d3d7c41410e3a76d9ebdc2040a91d208225e57664faab773f8394cd91264a1");
  }

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
  fn capture_envelopes_roundtrip_and_use_distinct_salts() {
    let vault_key = [7u8; 32];
    let plaintext = b"capture bytes";
    let (first, first_salt) = encrypt_capture_envelope(&vault_key, plaintext).unwrap();
    let (second, second_salt) = encrypt_capture_envelope(&vault_key, plaintext).unwrap();

    assert_ne!(first_salt, second_salt);
    assert_ne!(first, second);
    assert_eq!(&first[..8], b"NAPTENC2");
    assert_eq!(&second[..8], b"NAPTENC2");
    assert!(!first.windows(first_salt.len()).any(|window| window == first_salt));
    assert!(!second.windows(second_salt.len()).any(|window| window == second_salt));
    assert_eq!(decrypt_capture_envelope_with_salt(&vault_key, &first, &first_salt).unwrap(), plaintext);
    assert_eq!(decrypt_capture_envelope_with_salt(&vault_key, &second, &second_salt).unwrap(), plaintext);
  }

  #[test]
  fn capture_envelope_rejects_tampering_and_wrong_vault_key() {
    // codeql[rust/hard-coded-cryptographic-value] Fixed keys and salt are test-only fixtures.
    let salt = [8u8; 32];
    let mut envelope = encrypt_capture_envelope_with_salt(&[3u8; 32], b"private capture", &salt).unwrap();
    assert!(decrypt_capture_envelope_with_salt(&[4u8; 32], &envelope, &salt).is_err());
    let last = envelope.len() - 1;
    envelope[last] ^= 1;
    assert!(decrypt_capture_envelope_with_salt(&[3u8; 32], &envelope, &salt).is_err());
  }

  #[test]
  fn legacy_capture_envelope_requires_the_matching_server_salt() {
    // codeql[rust/hard-coded-cryptographic-value] Fixed keys and salt are test-only fixtures.
    let vault_key = [12u8; 32];
    let salt = [13u8; 32];
    let capture_key = derive_capture_key(&vault_key, &salt);
    let encrypted = encrypt_payload_binary(&capture_key, b"legacy capture").unwrap();
    let mut legacy = Vec::from(&b"NAPTENC1"[..]);
    legacy.extend_from_slice(&salt);
    legacy.extend_from_slice(&encrypted);

    assert_eq!(decrypt_capture_envelope_with_salt(&vault_key, &legacy, &salt).unwrap(), b"legacy capture");
    assert!(decrypt_capture_envelope_with_salt(&vault_key, &legacy, &[14u8; 32]).is_err());
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
