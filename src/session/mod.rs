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
}
