//! Cryptographic utilities for AES-256-GCM payload encryption and
//! HMAC-based challenge–response authentication.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
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
    pbkdf2_hmac::<Sha256>(passkey.as_bytes(), PBKDF2_SALT, PBKDF2_ITERATIONS, &mut key);
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
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC key length is always valid");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// Verify an HMAC-SHA256 tag. Returns `true` when the tag is valid.
pub fn verify_hmac(key: &[u8; 32], data: &[u8], tag: &[u8]) -> bool {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC key length is always valid");
    mac.update(data);
    mac.verify_slice(tag).is_ok()
}

/// Encrypt `plaintext` with AES-256-GCM.
/// Returns `base64( 12-byte IV || ciphertext || 16-byte tag )`.
pub fn encrypt_payload(key: &[u8; 32], plaintext: &[u8]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init: {e}"))?;

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
    B64.decode(encoded).map_err(|e| format!("base64 decode: {e}"))
}
