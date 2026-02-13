//! Session management for authenticated clients.
//!
//! After a successful authentication (passkey or password), the server issues
//! a random session token. The client stores it in `localStorage` and sends it
//! on WebSocket upgrade to skip re-authentication.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use uuid::Uuid;

/// Default session lifetime (24 hours).
const DEFAULT_SESSION_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// A single authenticated session.
#[derive(Debug, Clone)]
pub struct Session {
    /// Unique session token
    pub token: String,
    /// When this session was created
    pub created_at: Instant,
    /// When this session expires
    pub expires_at: Instant,
    /// The AES-256 encryption key for this session
    pub encryption_key: [u8; 32],
}

/// Thread-safe in-memory session store.
pub struct SessionStore {
    sessions: Mutex<HashMap<String, Session>>,
    ttl: Duration,
}

impl SessionStore {
    /// Create a new session store with the default TTL.
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            ttl: DEFAULT_SESSION_TTL,
        }
    }

    /// Create a new session and return its token.
    pub fn create_session(&self, encryption_key: [u8; 32]) -> String {
        let token = Uuid::new_v4().to_string();
        let now = Instant::now();
        let session = Session {
            token: token.clone(),
            created_at: now,
            expires_at: now + self.ttl,
            encryption_key,
        };

        let mut sessions = self.sessions.lock().unwrap();
        // Opportunistic cleanup of expired sessions
        sessions.retain(|_, s| s.expires_at > now);
        sessions.insert(token.clone(), session);

        log::info!("Session created (active sessions: {})", sessions.len());
        token
    }

    /// Validate a session token. Returns the session if valid and not expired.
    pub fn validate(&self, token: &str) -> Option<Session> {
        let sessions = self.sessions.lock().unwrap();
        sessions.get(token).and_then(|s| {
            if s.expires_at > Instant::now() {
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
    }
}
