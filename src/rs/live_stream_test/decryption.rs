//! Decryption utilities for AES-256-GCM payloads
//! 
//! Ported from the TypeScript WebCrypto implementation to Rust

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;

/// PBKDF2 iteration count - must match frontend WebCrypto
const PBKDF2_ITERATIONS: u32 = 100_000;
/// Salt for PBKDF2 key derivation - must match frontend
const PBKDF2_SALT: &[u8] = b"n-apt-aes-salt-v1";
/// IV length for AES-GCM
const IV_LENGTH: usize = 12;

/// Derive a 256-bit AES key from a passkey using PBKDF2-HMAC-SHA256
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

/// Decrypt a base64-encoded AES-256-GCM payload
pub fn decrypt_payload_base64(key: &[u8; 32], encrypted_base64: &str) -> Result<Vec<u8>> {
    let encrypted_data = B64
        .decode(encrypted_base64)
        .map_err(|e| anyhow!("Base64 decode failed: {}", e))?;
    
    decrypt_payload_binary(key, &encrypted_data)
}

/// Decrypt a raw binary AES-256-GCM payload
/// Input: IV (12 bytes) || ciphertext || tag (16 bytes)
pub fn decrypt_payload_binary(key: &[u8; 32], encrypted_data: &[u8]) -> Result<Vec<u8>> {
    if encrypted_data.len() < IV_LENGTH + 16 {
        return Err(anyhow!("Encrypted data too short: {} bytes", encrypted_data.len()));
    }

    let iv = &encrypted_data[..IV_LENGTH];
    let ciphertext = &encrypted_data[IV_LENGTH..];

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| anyhow!("Failed to create cipher: {}", e))?;
    
    let nonce = Nonce::from_slice(iv);
    
    let decrypted = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow!("Decryption failed: {}", e))?;
    
    Ok(decrypted)
}

/// Decrypt f32 waveform data from encrypted payload
pub fn decrypt_waveform(key: &[u8; 32], encrypted_data: &[u8]) -> Result<Vec<f32>> {
    let decrypted_bytes = decrypt_payload_binary(key, encrypted_data)?;
    
    if decrypted_bytes.len() % 4 != 0 {
        return Err(anyhow!("Decrypted data length not divisible by 4 for f32 conversion"));
    }
    
    // Convert bytes to f32 array
    let f32_slice: &[f32] = bytemuck::try_cast_slice(&decrypted_bytes)
        .map_err(|e| anyhow!("Failed to cast bytes to f32: {}", e))?;
    
    Ok(f32_slice.to_vec())
}

/// Decrypt raw I/Q data (remains as bytes)
pub fn decrypt_iq_data(key: &[u8; 32], encrypted_data: &[u8]) -> Result<Vec<u8>> {
    decrypt_payload_binary(key, encrypted_data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_derivation() {
        let key1 = derive_key("test-passkey");
        let key2 = derive_key("test-passkey");
        assert_eq!(key1, key2);
        assert_eq!(key1.len(), 32);
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = derive_key("roundtrip-test");
        let plaintext = b"Hello, World! This is a test message for encryption.";
        
        // Use the existing encryption function from the crypto module
        let encrypted = crate::crypto::encrypt_payload_binary(&key, plaintext).unwrap();
        let decrypted = decrypt_payload_binary(&key, &encrypted).unwrap();
        
        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_waveform_decryption() {
        let key = derive_key("waveform-test");
        let original_waveform: Vec<f32> = vec![1.0, -1.0, 0.5, -0.5, 0.0, 2.0, -2.0, 1.5];
        let waveform_bytes: &[u8] = bytemuck::cast_slice(&original_waveform);
        
        let encrypted = crate::crypto::encrypt_payload_binary(&key, waveform_bytes).unwrap();
        let decrypted_waveform = decrypt_waveform(&key, &encrypted).unwrap();
        
        assert_eq!(original_waveform, decrypted_waveform);
    }
}
