//! Session management for authenticated clients.
//!
//! After a successful authentication (passkey or password), the server issues
//! a random session token. The client stores it in `localStorage` and sends it
//! on WebSocket upgrade to skip re-authentication.
//!
//! Sessions are persisted to `~/.n-apt/sessions.json` so they survive restarts.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Default session lifetime (30 days).
const DEFAULT_SESSION_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// Persisted session entry (serializable).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedSession {
    token: String,
    created_at_epoch: u64,
    expires_at_epoch: u64,
    encryption_key: Vec<u8>,
}

/// A single authenticated session (runtime representation).
#[derive(Debug, Clone)]
pub struct Session {
    /// Unique session token
    pub token: String,
    /// When this session was created (epoch secs)
    pub created_at_epoch: u64,
    /// When this session expires (epoch secs)
    pub expires_at_epoch: u64,
    /// The AES-256 encryption key for this session
    pub encryption_key: [u8; 32],
}

impl Session {
    fn is_expired(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        now >= self.expires_at_epoch
    }
}

/// Thread-safe session store with file persistence.
pub struct SessionStore {
    sessions: Mutex<HashMap<String, Session>>,
    ttl: Duration,
    persist_path: std::path::PathBuf,
}

impl SessionStore {
    /// Create a new session store, loading any persisted sessions from disk.
    pub fn new() -> Self {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        let dir = std::path::PathBuf::from(home).join(".n-apt");
        let _ = std::fs::create_dir_all(&dir);
        let persist_path = dir.join("sessions.json");

        let mut sessions = HashMap::new();

        // Load persisted sessions
        if let Ok(data) = std::fs::read_to_string(&persist_path) {
            if let Ok(persisted) = serde_json::from_str::<Vec<PersistedSession>>(&data) {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                for p in persisted {
                    if p.expires_at_epoch > now && p.encryption_key.len() == 32 {
                        let mut key = [0u8; 32];
                        key.copy_from_slice(&p.encryption_key);
                        sessions.insert(
                            p.token.clone(),
                            Session {
                                token: p.token,
                                created_at_epoch: p.created_at_epoch,
                                expires_at_epoch: p.expires_at_epoch,
                                encryption_key: key,
                            },
                        );
                    }
                }
                if !sessions.is_empty() {
                    log::info!(
                        "Loaded {} persisted session(s) from disk",
                        sessions.len()
                    );
                }
            }
        }

        Self {
            sessions: Mutex::new(sessions),
            ttl: DEFAULT_SESSION_TTL,
            persist_path,
        }
    }

    /// Persist current sessions to disk.
    fn save(&self, sessions: &HashMap<String, Session>) {
        let persisted: Vec<PersistedSession> = sessions
            .values()
            .filter(|s| !s.is_expired())
            .map(|s| PersistedSession {
                token: s.token.clone(),
                created_at_epoch: s.created_at_epoch,
                expires_at_epoch: s.expires_at_epoch,
                encryption_key: s.encryption_key.to_vec(),
            })
            .collect();

        if let Ok(json) = serde_json::to_string_pretty(&persisted) {
            let _ = std::fs::write(&self.persist_path, json);
        }
    }

    /// Create a new session and return its token.
    pub fn create_session(&self, encryption_key: [u8; 32]) -> String {
        let token = Uuid::new_v4().to_string();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let session = Session {
            token: token.clone(),
            created_at_epoch: now,
            expires_at_epoch: now + self.ttl.as_secs(),
            encryption_key,
        };

        let mut sessions = self.sessions.lock().unwrap();
        // Opportunistic cleanup of expired sessions
        sessions.retain(|_, s| !s.is_expired());
        sessions.insert(token.clone(), session);

        log::info!("Session created (active sessions: {})", sessions.len());
        self.save(&sessions);
        token
    }

    /// Validate a session token. Returns the session if valid and not expired.
    pub fn validate(&self, token: &str) -> Option<Session> {
        let sessions = self.sessions.lock().unwrap();
        sessions.get(token).and_then(|s| {
            if !s.is_expired() {
                Some(s.clone())
            } else {
                None
            }
        })
    }

    /// Remove a session (logout).
    pub fn revoke(&self, token: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.remove(token);
        self.save(&sessions);
    }

    /// Create a SessionStore backed by a custom path (for testing).
    #[cfg(test)]
    fn with_path(path: std::path::PathBuf) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            ttl: DEFAULT_SESSION_TTL,
            persist_path: path,
        }
    }

    /// Create a SessionStore with a custom TTL (for testing).
    #[cfg(test)]
    fn with_path_and_ttl(path: std::path::PathBuf, ttl: Duration) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            ttl,
            persist_path: path,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_session_path() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("n-apt-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir.join("sessions.json")
    }

    #[test]
    fn test_create_and_validate_session() {
        let path = temp_session_path();
        let store = SessionStore::with_path(path.clone());
        let key = [42u8; 32];

        let token = store.create_session(key);
        assert!(!token.is_empty());

        let session = store.validate(&token);
        assert!(session.is_some());
        let s = session.unwrap();
        assert_eq!(s.token, token);
        assert_eq!(s.encryption_key, key);

        // Cleanup
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn test_validate_invalid_token_returns_none() {
        let path = temp_session_path();
        let store = SessionStore::with_path(path.clone());

        assert!(store.validate("nonexistent-token").is_none());

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn test_revoke_session() {
        let path = temp_session_path();
        let store = SessionStore::with_path(path.clone());
        let key = [1u8; 32];

        let token = store.create_session(key);
        assert!(store.validate(&token).is_some());

        store.revoke(&token);
        assert!(store.validate(&token).is_none());

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn test_multiple_sessions() {
        let path = temp_session_path();
        let store = SessionStore::with_path(path.clone());

        let t1 = store.create_session([1u8; 32]);
        let t2 = store.create_session([2u8; 32]);
        let t3 = store.create_session([3u8; 32]);

        assert!(store.validate(&t1).is_some());
        assert!(store.validate(&t2).is_some());
        assert!(store.validate(&t3).is_some());

        // Revoking one doesn't affect others
        store.revoke(&t2);
        assert!(store.validate(&t1).is_some());
        assert!(store.validate(&t2).is_none());
        assert!(store.validate(&t3).is_some());

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn test_expired_session_not_valid() {
        let path = temp_session_path();
        // TTL of 0 seconds means sessions expire immediately
        let store = SessionStore::with_path_and_ttl(path.clone(), Duration::from_secs(0));
        let key = [99u8; 32];

        let token = store.create_session(key);
        // Session was created with expires_at = now + 0, so it's already expired
        std::thread::sleep(Duration::from_millis(10));
        assert!(store.validate(&token).is_none(), "Expired session must not validate");

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn test_session_persists_to_disk() {
        let path = temp_session_path();
        let key = [7u8; 32];

        let token = {
            let store = SessionStore::with_path(path.clone());
            store.create_session(key)
        };

        // File should exist
        assert!(path.exists(), "Sessions file should be written to disk");

        // Verify persisted file contents
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(persisted) = serde_json::from_str::<Vec<serde_json::Value>>(&data) {
                assert!(!persisted.is_empty(), "Persisted sessions should not be empty");
                let has_token = persisted.iter().any(|p| {
                    p.get("token").and_then(|t| t.as_str()) == Some(&token)
                });
                assert!(has_token, "Persisted file should contain the created token");
            }
        }

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn test_session_token_is_uuid_format() {
        let path = temp_session_path();
        let store = SessionStore::with_path(path.clone());
        let token = store.create_session([0u8; 32]);

        // UUID v4 format: 8-4-4-4-12 hex chars
        assert!(Uuid::parse_str(&token).is_ok(), "Token should be valid UUID");

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn test_session_has_correct_timestamps() {
        let path = temp_session_path();
        let store = SessionStore::with_path(path.clone());
        let key = [0u8; 32];

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let token = store.create_session(key);
        let session = store.validate(&token).unwrap();

        assert!(session.created_at_epoch >= now);
        assert!(session.created_at_epoch <= now + 2);
        assert!(session.expires_at_epoch > session.created_at_epoch);

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
