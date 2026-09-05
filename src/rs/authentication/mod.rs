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
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CredentialFile {
  /// Map of user ID → list of registered passkey credentials
  pub passkeys: HashMap<String, Vec<Passkey>>,
}

/// Manages passkey credential persistence.
///
/// All public methods are async and run their file I/O on the blocking pool;
/// `add_passkey` serializes its read-modify-write through a mutex so two
/// concurrent registrations cannot silently drop one passkey.
pub struct CredentialStore {
  paths: OnceLock<Result<CredentialPaths, String>>,
  /// Serializes load→push→save sequences across tasks.
  write_lock: std::sync::Arc<std::sync::Mutex<()>>,
}

#[derive(Clone)]
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
      write_lock: std::sync::Arc::new(std::sync::Mutex::new(())),
    }
  }

  #[cfg(test)]
  fn paths_initialized(&self) -> bool {
    self.paths.get().is_some()
  }

  fn resolve_paths(&self) -> Result<CredentialPaths, String> {
    self.paths.get_or_init(build_paths).clone()
  }

  /// Load credentials from disk, surfacing a corrupt file as an error.
  ///
  /// A missing file is fine (fresh install). A present-but-unparseable file
  /// must NOT be treated as empty: that would silently wipe effective access
  /// and let the next registration enroll an attacker of choice without any
  /// signal. Callers that only need a best-effort view use [`Self::load`];
  /// writers go through this and refuse to proceed on corruption.
  pub async fn try_load(&self) -> Result<CredentialFile, String> {
    let paths = self.resolve_paths()?;
    tokio::task::spawn_blocking(move || Self::load_from_paths(&paths))
      .await
      .map_err(|e| format!("credential read task failed: {e}"))?
  }

  /// Blocking-core of [`Self::try_load`]; runs on the blocking pool only.
  fn load_from_paths(paths: &CredentialPaths) -> Result<CredentialFile, String> {
    // SECURITY: Explicitly re-validate path safety before reading.
    // This ensures that even if the struct was tampered with, we don't
    // read from an uncontrolled location.
    if !paths.path.starts_with(&paths.base_dir)
      || paths
        .path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
      let error = format!("Refusing to read from unsafe path: {:?}", paths.path);
      log::error!("{error}");
      return Err(error);
    }

    match std::fs::read_to_string(&paths.path) {
      Ok(contents) => serde_json::from_str(&contents).map_err(|e| {
        let error = format!(
          "credentials.json at {} is corrupt: {e}; refusing to treat it as empty — fix or remove the file",
          paths.path.display()
        );
        log::error!("{error}");
        error
      }),
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
        Ok(CredentialFile::default())
      }
      Err(e) => {
        let error = format!("Failed to read credentials.json: {e}");
        log::error!("{error}");
        Err(error)
      }
    }
  }

  /// Best-effort load: defaults to an empty store on any error (already
  /// logged by [`Self::try_load`]).
  pub async fn load(&self) -> CredentialFile {
    self.try_load().await.unwrap_or_default()
  }

  /// Save credentials to disk (blocking core; runs on the blocking pool).
  pub async fn save(&self, creds: &CredentialFile) -> Result<(), String> {
    let paths = self.resolve_paths()?;
    let creds = creds.clone();
    tokio::task::spawn_blocking(move || Self::save_to_paths(&paths, &creds))
      .await
      .map_err(|e| format!("credential write task failed: {e}"))?
  }

  fn save_to_paths(
    paths: &CredentialPaths,
    creds: &CredentialFile,
  ) -> Result<(), String> {
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
  pub async fn has_passkeys(&self) -> bool {
    let creds = self.load().await;
    creds.passkeys.values().any(|v| !v.is_empty())
  }

  /// Get all passkeys for the default user.
  pub async fn get_passkeys(&self) -> Vec<Passkey> {
    let creds = self.load().await;
    creds.passkeys.get("default").cloned().unwrap_or_default()
  }

  /// Store a new passkey for the default user.
  ///
  /// The load→push→save sequence is serialized through a mutex so two
  /// concurrent registrations cannot each load the same base state and
  /// silently drop one credential. Refuses to write when the existing file
  /// is corrupt: saving would silently replace every registered passkey with
  /// just this one.
  pub async fn add_passkey(&self, passkey: Passkey) -> Result<(), String> {
    let write_lock = std::sync::Arc::clone(&self.write_lock);
    let paths = self.resolve_paths()?;
    tokio::task::spawn_blocking(move || {
      let _guard = write_lock.lock().unwrap();
      let mut creds = Self::load_from_paths(&paths)?;
      creds
        .passkeys
        .entry("default".to_string())
        .or_default()
        .push(passkey);
      Self::save_to_paths(&paths, &creds)
    })
    .await
    .map_err(|e| format!("credential write task failed: {e}"))?
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
        // Byte-slicing can split a multi-byte UTF-8 char and panic; mask by
        // char boundaries instead.
        format!(
          "{}…{}",
          token.get(..4).unwrap_or(""),
          token.get(token.len() - 4..).unwrap_or("")
        )
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
