//! File-backed credential storage for WebAuthn passkeys.
//!
//! Credentials are stored in `~/.n-apt/credentials.json`. This is appropriate
//! for a local/LAN SDR tool — no database required.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use webauthn_rs::prelude::*;

/// On-disk format for the credential store.
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CredentialFile {
  /// Map of user ID → list of registered passkey credentials
  pub passkeys: HashMap<String, Vec<Passkey>>,
  /// Pending registration states (keyed by challenge ID)
  #[serde(default)]
  pub pending_registrations: HashMap<String, String>,
}

/// Manages passkey credential persistence.
pub struct CredentialStore {
  path: PathBuf,
}

impl CredentialStore {
  /// Create a new credential store. Creates the directory if needed.
  pub fn new() -> Result<Self, String> {
    let dir = dirs_path()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir: {e}"))?;
    let path = dir.join("credentials.json");
    Ok(Self { path })
  }

  /// Load credentials from disk. Returns default if file doesn't exist.
  pub fn load(&self) -> CredentialFile {
    match std::fs::read_to_string(&self.path) {
      Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
      Err(_) => CredentialFile::default(),
    }
  }

  /// Save credentials to disk.
  pub fn save(&self, creds: &CredentialFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(creds)
      .map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&self.path, json).map_err(|e| format!("write: {e}"))?;
    Ok(())
  }

  /// Check if any passkeys are registered.
  pub fn has_passkeys(&self) -> bool {
    let creds = self.load();
    creds.passkeys.values().any(|v| !v.is_empty())
  }

  /// Get all passkeys for the default user.
  pub fn get_passkeys(&self) -> Vec<Passkey> {
    let creds = self.load();
    creds.passkeys.get("default").cloned().unwrap_or_default()
  }

  /// Store a new passkey for the default user.
  pub fn add_passkey(&self, passkey: Passkey) -> Result<(), String> {
    let mut creds = self.load();
    creds
      .passkeys
      .entry("default".to_string())
      .or_default()
      .push(passkey);
    self.save(&creds)
  }

  /// Store a pending registration state (serialized).
  pub fn store_pending_registration(
    &self,
    id: &str,
    state: &str,
  ) -> Result<(), String> {
    let mut creds = self.load();
    creds
      .pending_registrations
      .insert(id.to_string(), state.to_string());
    self.save(&creds)
  }

  /// Retrieve and remove a pending registration state.
  pub fn take_pending_registration(&self, id: &str) -> Option<String> {
    let mut creds = self.load();
    let state = creds.pending_registrations.remove(id);
    if state.is_some() {
      let _ = self.save(&creds);
    }
    state
  }
}

/// Get the n-apt config directory path (~/.n-apt).
fn dirs_path() -> Result<PathBuf, String> {
  let home = std::env::var("HOME")
    .or_else(|_| std::env::var("USERPROFILE"))
    .map_err(|_| "Cannot determine home directory".to_string())?;
  Ok(PathBuf::from(home).join(".n-apt"))
}

pub mod auth_handlers;
