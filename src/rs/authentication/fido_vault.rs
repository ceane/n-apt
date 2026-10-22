//! Short-lived backend access to a stable, recoverable file-encryption key.
use super::VaultKeyWrapper;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

pub const UNLOCK_TTL: Duration = Duration::from_secs(15 * 60);
const WRAPPER_FORMAT: &str = "n-apt-vault-key-wrapper-v1";

/// Transport-verified identity, never accepted from a capture JSON payload.
/// Redact it because SDR commands implement Debug.
#[derive(Clone)]
pub struct VaultSessionId(String);

impl VaultSessionId {
  pub fn new(token: &str) -> Self { Self(token.to_owned()) }
  pub fn as_str(&self) -> &str { &self.0 }
}

impl std::fmt::Debug for VaultSessionId {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str("VaultSessionId([redacted])")
  }
}

struct VaultLease {
  key: Zeroizing<[u8; 32]>,
  expires: Instant,
  generation: uuid::Uuid,
}

#[derive(Default)]
pub struct VaultSessions(HashMap<String, VaultLease>);

impl VaultSessions {
  pub fn unlock(&mut self, token: String, key: [u8; 32]) -> uuid::Uuid {
    self.0.retain(|_, lease| lease.expires > Instant::now());
    let generation = uuid::Uuid::new_v4();
    self.0.insert(
      token,
      VaultLease {
        key: Zeroizing::new(key),
        expires: Instant::now() + UNLOCK_TTL,
        generation,
      },
    );
    generation
  }

  pub fn key(&mut self, token: &str) -> Option<[u8; 32]> {
    self.0.retain(|_, lease| lease.expires > Instant::now());
    self.0.get(token).map(|lease| *lease.key)
  }

  pub fn lock(&mut self, token: &str) {
    self.0.remove(token);
  }

  pub fn lock_generation(&mut self, token: &str, generation: uuid::Uuid) {
    if self
      .0
      .get(token)
      .is_some_and(|lease| lease.generation == generation)
    {
      self.lock(token);
    }
  }
}

/// Check the submitted VMK against the existing password-recovery envelope.
/// The local backend already trusts/loads this password for ordinary encryption.
/// Never accept a replacement key that would make embedded recovery unusable.
pub fn recover_key(
  wrapper: &VaultKeyWrapper,
  password: &str,
) -> Result<Zeroizing<[u8; 32]>, String> {
  if wrapper.format != WRAPPER_FORMAT || password.trim().is_empty() {
    return Err("invalid_vault_recovery".into());
  }
  let salt = crate::crypto::from_base64(&wrapper.salt)
    .map_err(|_| "invalid_vault_recovery")?;
  let nonce = crate::crypto::from_base64(&wrapper.nonce)
    .map_err(|_| "invalid_vault_recovery")?;
  let ciphertext = crate::crypto::from_base64(&wrapper.ciphertext)
    .map_err(|_| "invalid_vault_recovery")?;
  if salt.len() != 32 || nonce.len() != 12 || ciphertext.len() != 48 {
    return Err("invalid_vault_recovery".into());
  }
  let mut wrapping_key = Zeroizing::new([0u8; 32]);
  pbkdf2::pbkdf2_hmac::<sha2::Sha256>(
    password.trim().as_bytes(),
    &salt,
    600_000,
    &mut *wrapping_key,
  );
  let cipher = Aes256Gcm::new_from_slice(&*wrapping_key)
    .map_err(|_| "invalid_vault_recovery")?;
  let nonce_array: [u8; 12] =
    nonce.try_into().map_err(|_| "invalid_vault_recovery")?;
  let plaintext = Zeroizing::new(
    cipher
      .decrypt(
        &Nonce::from(nonce_array),
        Payload {
          msg: &ciphertext,
          aad: WRAPPER_FORMAT.as_bytes(),
        },
      )
      .map_err(|_| "invalid_vault_recovery")?,
  );
  let key: [u8; 32] = plaintext
    .as_slice()
    .try_into()
    .map_err(|_| "invalid_vault_recovery")?;
  Ok(Zeroizing::new(key))
}

pub fn validate_wrapper(wrapper: &VaultKeyWrapper) -> bool {
  wrapper.format == WRAPPER_FORMAT
    && [
      (&wrapper.salt, 32),
      (&wrapper.nonce, 12),
      (&wrapper.ciphertext, 48),
    ]
    .iter()
    .all(|(value, length)| {
      crate::crypto::from_base64(value)
        .is_ok_and(|bytes| bytes.len() == *length)
    })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn unlock_is_session_scoped_and_old_cleanup_cannot_remove_new_unlock() {
    let mut sessions = VaultSessions::default();
    let old = sessions.unlock("a".into(), [1; 32]);
    assert_eq!(sessions.key("b"), None);
    sessions.unlock("b".into(), [2; 32]);
    sessions.unlock("a".into(), [1; 32]);
    sessions.lock_generation("a", old);
    assert_eq!(sessions.key("a"), Some([1; 32]));
    sessions.lock("a");
    assert_eq!(sessions.key("a"), None);
    assert_eq!(sessions.key("b"), Some([2; 32]));
    sessions.0.get_mut("b").unwrap().expires = Instant::now();
    assert_eq!(sessions.key("b"), None);
  }

  #[test]
  fn recovery_requires_correct_password_and_authenticated_wrapper() {
    let password = "test recovery password";
    let salt = [3u8; 32];
    let nonce = [4u8; 12];
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(
      password.as_bytes(),
      &salt,
      600_000,
      &mut key,
    );
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
    let ciphertext = cipher
      .encrypt(
        &Nonce::from(nonce),
        Payload {
          msg: &[7u8; 32],
          aad: WRAPPER_FORMAT.as_bytes(),
        },
      )
      .unwrap();
    let mut wrapper = VaultKeyWrapper {
      format: WRAPPER_FORMAT.into(),
      salt: crate::crypto::to_base64(&salt),
      nonce: crate::crypto::to_base64(&nonce),
      ciphertext: crate::crypto::to_base64(&ciphertext),
    };
    assert_eq!(*recover_key(&wrapper, password).unwrap(), [7; 32]);
    assert!(recover_key(&wrapper, "wrong").is_err());
    wrapper.nonce = crate::crypto::to_base64(&[5; 12]);
    assert!(recover_key(&wrapper, password).is_err());
  }
}
