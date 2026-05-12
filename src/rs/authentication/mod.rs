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
}

/// Manages passkey credential persistence.
pub struct CredentialStore {
  path: PathBuf,
  base_dir: PathBuf,
}

impl CredentialStore {
  /// Create a new credential store. Creates the directory if needed.
  pub fn new() -> Result<Self, String> {
    let dir = dirs_path()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir: {e}"))?;

    // RE-CANONICALIZE the final directory to ensure it's not a symlink to somewhere dangerous.
    // This is a defense-in-depth measure against TOCTOU or crafted symlink attacks.
    let dir = dir
      .canonicalize()
      .map_err(|e| format!("canonicalize dir: {e}"))?;

    let path = dir.join("credentials.json");

    // Final security check: ensure the path is still within the expected directory
    // and doesn't contain any traversal components.
    if !path.is_absolute() {
      return Err("Credential path must be absolute".to_string());
    }
    if !path.starts_with(&dir) {
      return Err("Credential path escaped base directory".to_string());
    }
    if path
      .components()
      .any(|c| matches!(c, std::path::Component::ParentDir))
    {
      return Err("Credential path contains invalid components".to_string());
    }

    Ok(Self {
      path,
      base_dir: dir,
    })
  }

  /// Load credentials from disk. Returns default if file doesn't exist.
  pub fn load(&self) -> CredentialFile {
    // SECURITY: Explicitly re-validate path safety before reading.
    // This ensures that even if the struct was tampered with, we don't
    // read from an uncontrolled location.
    if !self.path.starts_with(&self.base_dir)
      || self
        .path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
      log::error!("Refusing to read from unsafe path: {:?}", self.path);
      return CredentialFile::default();
    }

    match std::fs::read_to_string(&self.path) {
      Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
      Err(_) => CredentialFile::default(),
    }
  }

  /// Save credentials to disk.
  pub fn save(&self, creds: &CredentialFile) -> Result<(), String> {
    // SECURITY: Explicitly re-validate path safety before writing.
    if !self.path.starts_with(&self.base_dir)
      || self
        .path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
      return Err(format!("Refusing to write to unsafe path: {:?}", self.path));
    }

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

}

/// Get the n-apt config directory path (~/.n-apt).
/// Canonicalizes the home directory to prevent path traversal attacks
/// via a crafted HOME environment variable.
fn dirs_path() -> Result<PathBuf, String> {
  let home = std::env::var("HOME")
    .or_else(|_| std::env::var("USERPROFILE"))
    .map_err(|_| "Cannot determine home directory".to_string())?;

  let home_path = PathBuf::from(&home);

  // Explicitly validate that the home path is absolute and doesn't contain
  // traversal components before we even canonicalize it.
  if !home_path.is_absolute() {
    return Err(format!(
      "Home directory '{}' must be an absolute path",
      home
    ));
  }

  if home_path
    .components()
    .any(|c| matches!(c, std::path::Component::ParentDir))
  {
    return Err(format!(
      "Home directory '{}' contains invalid traversal components",
      home
    ));
  }

  // Canonicalize resolves symlinks and normalizes the path,
  // preventing ".." traversal attacks via a crafted HOME variable.
  let canonical_home = home_path.canonicalize().map_err(|e| {
    format!("Home directory '{}' is not a valid path: {}", home, e)
  })?;

  // Ensure the canonical path is actually a directory
  if !canonical_home.is_dir() {
    return Err(format!(
      "Home path '{}' is not a directory",
      canonical_home.display()
    ));
  }

  let final_dir = canonical_home.join(".n-apt");

  // Final check: ensure joining didn't somehow escape the home directory
  if !final_dir.starts_with(&canonical_home) {
    return Err(
      "Security violation: derived path escaped home directory".into(),
    );
  }

  Ok(final_dir)
}

pub mod auth_handlers;
