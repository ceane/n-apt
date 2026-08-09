//! File-backed credential storage for WebAuthn passkeys.
//!
//! Credentials are stored in `~/.n-apt/credentials.json`. This is appropriate
//! for a local/LAN SDR tool — no database required.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use webauthn_rs::prelude::*;

/// On-disk format for the credential store.
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CredentialFile {
  /// Map of user ID → list of registered passkey credentials
  pub passkeys: HashMap<String, Vec<Passkey>>,
}

/// Manages passkey credential persistence.
pub struct CredentialStore {
  paths: OnceLock<Result<CredentialPaths, String>>,
}

struct CredentialPaths {
  path: PathBuf,
  base_dir: PathBuf,
}

impl CredentialStore {
  /// Create a new credential store. Creates the directory if needed.
  pub fn new() -> Result<Self, String> {
    let store = Self::deferred();
    store.resolve_paths()?;
    Ok(store)
  }

  /// Construct a store without touching the filesystem. Path validation and
  /// directory creation happen on the first credential operation.
  pub fn deferred() -> Self {
    Self {
      paths: OnceLock::new(),
    }
  }

  #[cfg(test)]
  fn paths_initialized(&self) -> bool {
    self.paths.get().is_some()
  }

  fn resolve_paths(&self) -> Result<&CredentialPaths, String> {
    self
      .paths
      .get_or_init(build_paths)
      .as_ref()
      .map_err(Clone::clone)
  }

  /// Load credentials from disk. Returns default if file doesn't exist.
  pub fn load(&self) -> CredentialFile {
    let Ok(paths) = self.resolve_paths() else {
      return CredentialFile::default();
    };
    // SECURITY: Explicitly re-validate path safety before reading.
    // This ensures that even if the struct was tampered with, we don't
    // read from an uncontrolled location.
    if !paths.path.starts_with(&paths.base_dir)
      || paths
        .path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
      log::error!("Refusing to read from unsafe path: {:?}", paths.path);
      return CredentialFile::default();
    }

    match std::fs::read_to_string(&paths.path) {
      Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
      Err(_) => CredentialFile::default(),
    }
  }

  /// Save credentials to disk.
  pub fn save(&self, creds: &CredentialFile) -> Result<(), String> {
    let paths = self.resolve_paths()?;
    // SECURITY: Explicitly re-validate path safety before writing.
    if !paths.path.starts_with(&paths.base_dir)
      || paths
        .path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
      return Err(format!(
        "Refusing to write to unsafe path: {:?}",
        paths.path
      ));
    }

    let json = serde_json::to_string_pretty(creds)
      .map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&paths.path, json).map_err(|e| format!("write: {e}"))?;
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

fn build_paths() -> Result<CredentialPaths, String> {
  let dir = dirs_path()?;
  std::fs::create_dir_all(&dir).map_err(|e| format!("create dir: {e}"))?;

  // Re-canonicalize the final directory to ensure it is not a symlink to an
  // unexpected location. This preserves the eager store's security checks.
  let dir = dir
    .canonicalize()
    .map_err(|e| format!("canonicalize dir: {e}"))?;
  let path = dir.join("credentials.json");

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

  Ok(CredentialPaths {
    path,
    base_dir: dir,
  })
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

use crate::server::main::AppState;
use axum::{
  body::Body,
  http::{Request, StatusCode},
  middleware::Next,
  response::Response,
};
use std::sync::Arc;

/// Middleware to enforce session authentication.
///
/// Extracts the session token from the `Authorization: Bearer <token>` header
/// OR from the `token` query parameter (common for direct downloads).
/// Validates the token against the Redis session store. Rejects unauthenticated
/// requests with 401 Unauthorized.
pub async fn require_session(
  state: axum::extract::State<Arc<AppState>>,
  req: Request<Body>,
  next: Next,
) -> Result<Response, StatusCode> {
  let mut token = None;

  // 1. Check Authorization header
  if let Some(auth_header) = req
    .headers()
    .get(axum::http::header::AUTHORIZATION)
    .and_then(|h| h.to_str().ok())
  {
    if auth_header.starts_with("Bearer ") {
      token = Some(auth_header[7..].to_string());
    }
  }

  // 2. Fallback to query parameter (common for direct downloads via <a> tags)
  if token.is_none() {
    if let Some(query) = req.uri().query() {
      if let Ok(params) = serde_urlencoded::from_str::<
        std::collections::HashMap<String, String>,
      >(query)
      {
        if let Some(t) = params.get("token") {
          token = Some(t.clone());
        }
      }
    }
  }

  if let Some(token) = token {
    if state.session_store.validate(&token).await.is_some() {
      return Ok(next.run(req).await);
    } else {
      let masked = if token.len() > 8 {
        format!("{}…{}", &token[..4], &token[token.len() - 4..])
      } else {
        "***".to_string()
      };
      log::warn!(
        "Unauthorized access to {}: Invalid or expired token ({}...)",
        req.uri().path(),
        masked
      );
    }
  } else {
    log::warn!(
      "Unauthorized access to {}: No token found in header or query",
      req.uri().path()
    );
  }

  Err(StatusCode::UNAUTHORIZED)
}

pub mod auth_handlers;

#[cfg(test)]
mod tests {
  use super::CredentialStore;

  #[test]
  fn deferred_credential_store_keeps_path_setup_lazy() {
    let store = CredentialStore::deferred();
    assert!(!store.paths_initialized());
  }
}
