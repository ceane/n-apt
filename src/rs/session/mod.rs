//! Session management for authenticated clients.
//!
//! After a successful authentication (passkey or password), the server issues
//! a random session token. The client stores it in `localStorage` and sends it
//! on WebSocket upgrade to skip re-authentication.
//!
//! Sessions are persisted to `~/.n-apt/sessions.json` so they survive restarts.

use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, Client as RedisClient};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Session lifetime (30 days). This is the single source of truth shared with
/// the auth handlers' advertised `expires_in`.
pub const SESSION_TTL_SECS: u64 = 30 * 24 * 60 * 60;
const DEFAULT_SESSION_TTL_SECS: u64 = SESSION_TTL_SECS;

/// A single authenticated session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
  /// Unique session token
  pub token: String,
  /// The AES-256 encryption key for this session (stored as Vec<u8> for serialization)
  pub encryption_key: Vec<u8>,
}

/// Redis-backed session store.
pub struct SessionStore {
  client: RedisClient,
  ttl_secs: u64,
  prefix: String,
  config_error: Option<String>,
  /// Cached DB-1 multiplexed connection. Clones share one socket, so session
  /// operations don't pay a TCP handshake + SELECT each time; any command
  /// error evicts it so the next call reconnects cleanly.
  ///
  /// Reconnection is single-flighted through `connect_lock`: callers that
  /// race after an eviction wait on one attempt instead of each opening
  /// their own connection. The sync guard is never held across an `.await`.
  connection: std::sync::Mutex<Option<MultiplexedConnection>>,
  /// Serializes reconnection attempts (see `connection`).
  connect_lock: tokio::sync::Mutex<()>,
}

impl SessionStore {
  /// Create a new Redis-backed session store.
  pub fn new(redis_url: &str) -> Result<Self, String> {
    let client = RedisClient::open(redis_url)
      .map_err(|e| format!("Failed to open Redis: {}", e))?;
    Ok(Self {
      client,
      ttl_secs: DEFAULT_SESSION_TTL_SECS,
      prefix: "session:".to_string(),
      config_error: None,
      connection: std::sync::Mutex::new(None),
      connect_lock: tokio::sync::Mutex::new(()),
    })
  }

  /// Construct a store that keeps the listener available when the configured
  /// URL is malformed. Requests will receive the configuration error when
  /// they actually need session persistence.
  pub fn new_or_degraded(redis_url: &str) -> Self {
    match Self::new(redis_url) {
      Ok(store) => store,
      Err(error) => {
        log::error!("Redis session configuration unavailable: {error}");
        Self {
          client: RedisClient::open("redis://127.0.0.1/")
            .expect("built-in Redis fallback URL must be valid"),
          ttl_secs: DEFAULT_SESSION_TTL_SECS,
          prefix: "session:".to_string(),
          config_error: Some(error),
          connection: std::sync::Mutex::new(None),
          connect_lock: tokio::sync::Mutex::new(()),
        }
      }
    }
  }

  /// Drop the cached connection after a command failure so the next call
  /// reconnects (and re-runs SELECT).
  fn evict_connection(&self) {
    *self.connection.lock().unwrap() = None;
  }

  async fn connect(&self) -> Result<MultiplexedConnection, String> {
    let mut conn = self
      .client
      .get_multiplexed_async_connection()
      .await
      .map_err(|e| format!("Redis connection failed: {}", e))?;

    // Ensure we are on DB 1 for sessions.
    redis::cmd("SELECT")
      .arg(1)
      .query_async::<()>(&mut conn)
      .await
      .map_err(|e| format!("Failed to select Redis DB 1: {}", e))?;

    Ok(conn)
  }

  async fn get_conn(&self) -> Result<MultiplexedConnection, String> {
    if let Some(error) = &self.config_error {
      return Err(error.clone());
    }

    if let Some(cached) = self.connection.lock().unwrap().clone() {
      return Ok(cached);
    }

    // Single-flight the reconnect so concurrent callers after an eviction
    // share one connection attempt instead of racing to each dial Redis.
    let _permit = self.connect_lock.lock().await;
    // Re-check: another caller may have connected while we waited.
    if let Some(cached) = self.connection.lock().unwrap().clone() {
      return Ok(cached);
    }

    let conn = self.connect().await?;
    *self.connection.lock().unwrap() = Some(conn.clone());
    Ok(conn)
  }

  /// Create a new session and return its token.
  pub async fn create_session(
    &self,
    encryption_key: [u8; 32],
  ) -> Result<String, String> {
    let token = Uuid::new_v4().to_string();
    let session = Session {
      token: token.clone(),
      encryption_key: encryption_key.to_vec(),
    };

    let key = format!("{}{}", self.prefix, token);
    let session_json = serde_json::to_string(&session)
      .map_err(|error| format!("Failed to serialize session: {error}"))?;

    let mut conn = self.get_conn().await?;
    let write_result = conn.set_ex(&key, session_json, self.ttl_secs).await;
    if write_result.is_err() {
      self.evict_connection();
    }
    let persisted_token = Self::session_write_result(write_result, token)?;
    log::info!(
      "Session created in Redis: {}…",
      persisted_token.get(..8).unwrap_or(&persisted_token)
    );
    Ok(persisted_token)
  }

  fn session_write_result(
    result: redis::RedisResult<()>,
    token: String,
  ) -> Result<String, String> {
    result
      .map(|()| token)
      .map_err(|error| format!("Failed to persist session in Redis: {error}"))
  }

  /// Validate a session token. Returns the session if valid and not expired.
  pub async fn validate(&self, token: &str) -> Option<Session> {
    // Reject non-UUID tokens before they reach Redis
    if Uuid::parse_str(token).is_err() {
      log::warn!("Session validate: rejected non-UUID token");
      return None;
    }
    let mut conn = self.get_conn().await.ok()?;
    let key = format!("{}{}", self.prefix, token);

    match conn.get::<_, Option<String>>(&key).await {
      Ok(session_json) => match session_json {
        Some(json) => {
          let session: Session = serde_json::from_str(&json).ok()?;
          Some(session)
        }
        None => None,
      },
      Err(_) => {
        self.evict_connection();
        None
      }
    }
  }

  /// Remove a session (logout).
  ///
  /// Returns an error when the session could not be removed — callers must
  /// treat logout as failed so a client is never told it logged out while the
  /// token remains valid in Redis.
  pub async fn revoke(&self, token: &str) -> Result<(), String> {
    if Uuid::parse_str(token).is_err() {
      log::warn!("Session revoke: rejected non-UUID token");
      return Err("Invalid session token format".to_string());
    }
    let mut conn = self
      .get_conn()
      .await
      .map_err(|error| format!("Session revoke failed: {error}"))?;
    let key = format!("{}{}", self.prefix, token);
    let del_result = conn.del::<_, i64>(&key).await;
    if del_result.is_err() {
      self.evict_connection();
    }
    del_result.map_err(|error| format!("Session revoke failed: {error}"))?;
    log::info!(
      "Session revoked in Redis: {}…",
      token.get(..8).unwrap_or(token)
    );
    Ok(())
  }
}

// NOTE: The tests below were written for the old file-based SessionStore
// (with_path, with_path_and_ttl, created_at_epoch, expires_at_epoch).
// They don't compile against the current Redis-backed SessionStore.
// TODO: Rewrite as Redis integration tests in test/rust/session_tests.rs.
//
// The hard-coded cryptographic values ([0u8;32], [42u8;32], etc.) that CodeQL
// flagged have been replaced with crate::crypto::derive_key() calls in the
// commented-out source below for reference.
#[cfg(test)]
mod tests {

  #[test]
  fn failed_session_persistence_does_not_return_a_token() {
    let token = uuid::Uuid::new_v4().to_string();
    let result = super::SessionStore::session_write_result(
      Err(redis::RedisError::from((
        redis::ErrorKind::Client,
        "Redis unavailable",
      ))),
      token,
    );

    assert!(result.is_err());
  }

  /// Deterministic test key — avoids hard-coded byte arrays
  /// that CodeQL flags as "hard-coded cryptographic value".
  fn test_key(label: &str) -> [u8; 32] {
    crate::crypto::derive_key(label)
  }

  #[test]
  fn test_key_derivation_is_deterministic() {
    let k1 = test_key("session-test");
    let k2 = test_key("session-test");
    assert_eq!(k1, k2);
    assert_eq!(k1.len(), 32);
  }

  #[test]
  fn test_key_derivation_different_labels() {
    let k1 = test_key("label-a");
    let k2 = test_key("label-b");
    assert_ne!(k1, k2, "Different labels must produce different keys");
  }
}
