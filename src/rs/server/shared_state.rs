use redis::Commands;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use super::types::{
  CaptureArtifact, DeviceProfile, SdrProcessorSettings, SpectrumFrameMessage,
};
use super::utils::{load_channels, load_sdr_settings};

/// How often to probe for a newly attached RTL-SDR while running in mock mode.
pub const DEVICE_PROBE_INTERVAL: std::time::Duration =
  std::time::Duration::from_millis(1000);

/// How often to run health checks on real hardware.
pub const HEALTH_CHECK_INTERVAL: std::time::Duration =
  std::time::Duration::from_millis(2000);

/// Number of consecutive health-check failures before declaring the device
/// truly disconnected (prevents false positives from USB glitches).
pub const DISCONNECT_FAILURE_THRESHOLD: u32 = 5;

/// Maximum number of automatic recovery attempts (buffer reset + re-init)
/// before giving up and falling back to mock.
pub const MAX_RECOVERY_ATTEMPTS: u32 = 2;

/// Shared state visible to the async runtime (lock-free where possible)
pub struct SharedState {
  /// Latest spectrum data produced by the I/O thread
  pub latest_spectrum: Mutex<Option<(Vec<f32>, bool)>>,
  /// Whether the device is connected (set once at init, updated on fallback)
  pub device_connected: AtomicBool,
  /// Client count
  pub client_count: AtomicUsize,
  /// Number of authenticated clients (streaming only starts when > 0)
  pub authenticated_count: AtomicUsize,
  /// Whether streaming is paused
  pub is_paused: AtomicBool,
  /// Allow exactly one spectrum frame through while paused after a one-frame request
  pub allow_next_paused_frame: AtomicBool,
  /// Latest requested center frequency (MHz -> Hz), coalesced atomically
  pub pending_center_freq: AtomicU32,
  /// Whether there is a pending frequency change
  pub pending_center_freq_dirty: AtomicBool,
  /// Shutdown signal — I/O thread checks this each iteration
  pub shutdown: AtomicBool,
  /// Device info string (set once at init)
  pub device_info: Mutex<String>,
  /// Current device profile/capabilities for frontend feature gating
  pub device_profile: Mutex<DeviceProfile>,
  /// Device loading state (when device is being initialized)
  pub device_loading: Mutex<bool>,
  /// When device_loading is true, why: "connect" | "restart" (optional)
  pub device_loading_reason: Mutex<Option<String>>,
  /// Canonical device state: "connected", "loading", "disconnected", "stale"
  /// This is the single source of truth for the frontend.
  pub device_state: Mutex<String>,
  /// AES-256 encryption key derived from passkey (set once at startup)
  pub encryption_key: [u8; 32],
  /// Channels configuration loaded from signals.yaml
  pub channels: Mutex<Vec<SpectrumFrameMessage>>,
  /// SDR settings loaded from signals.yaml
  pub sdr_settings: Mutex<super::types::SdrConfig>,
  /// Redis client for persistent metadata and sessions
  pub redis_client: redis::Client,

  // ── Hotplug debounce state ──────────────────────────────────────────
  /// Consecutive health-check failures while in real-hardware mode.
  /// Reset to 0 on every successful health check or frame read.
  pub health_failure_streak: AtomicU32,
  /// Number of recovery attempts (re-init) made during the current failure
  /// episode. Reset when the device recovers or is swapped to mock.
  pub recovery_attempts: AtomicU32,
  /// Timestamp of the last successful frame read from real hardware.
  /// Used to detect stale streams.
  pub last_successful_read: Mutex<Option<Instant>>,

  /// Fast-path settings slot: written by the command handler WITHOUT the
  /// processor lock, read and applied by the blocking frame loop BEFORE
  /// the slow device read. This lets FFT size changes take effect
  /// immediately instead of waiting for the current frame to finish.
  pub pending_fast_settings: Mutex<Vec<SdrProcessorSettings>>,
}

impl SharedState {
  pub fn new(redis_url: &str) -> Arc<Self> {
    let passkey = std::env::var("UNSAFE_LOCAL_USER_PASSWORD")
      .expect("Missing UNSAFE_LOCAL_USER_PASSWORD");
    let encryption_key = crate::crypto::derive_key(&passkey);
    let sdr_settings = load_sdr_settings();
    let redis_client = redis::Client::open(redis_url)
      .expect("Failed to initialize Redis client");
    log::info!(
      "Encryption key derived from passkey (PBKDF2-HMAC-SHA256, {} iterations)",
      100_000
    );

    Arc::new(SharedState {
      latest_spectrum: Mutex::new(None),
      device_connected: AtomicBool::new(false),
      client_count: AtomicUsize::new(0),
      authenticated_count: AtomicUsize::new(0),
      is_paused: AtomicBool::new(false),
      allow_next_paused_frame: AtomicBool::new(false),
      pending_center_freq: AtomicU32::new(sdr_settings.center_frequency),
      pending_center_freq_dirty: AtomicBool::new(false),
      shutdown: AtomicBool::new(false),
      device_info: Mutex::new(String::new()),
      device_profile: Mutex::new(DeviceProfile {
        kind: "mock_apt".to_string(),
        is_rtl_sdr: false,
        supports_approx_dbm: true,
        supports_raw_iq_stream: true,
      }),
      device_loading: Mutex::new(false),
      device_loading_reason: Mutex::new(None),
      device_state: Mutex::new("disconnected".to_string()),
      encryption_key,
      channels: Mutex::new(load_channels()),
      sdr_settings: Mutex::new(sdr_settings.clone()),
      redis_client,
      health_failure_streak: AtomicU32::new(0),
      recovery_attempts: AtomicU32::new(0),
      last_successful_read: Mutex::new(None),
      pending_fast_settings: Mutex::new(Vec::new()),
    })
  }

  /// Update device connection status and info string.
  ///
  /// Also resets hotplug debounce counters so the next failure episode
  /// starts from a clean slate.
  pub fn update_device_status(
    &self,
    connected: bool,
    info: String,
    device_profile: DeviceProfile,
  ) {
    self.device_connected.store(connected, Ordering::Relaxed);
    *self.device_info.lock().unwrap() = info;
    *self.device_profile.lock().unwrap() = device_profile;
    *self.device_state.lock().unwrap() = if connected {
      "connected".to_string()
    } else {
      "disconnected".to_string()
    };
    // Reset debounce counters on any definitive state change
    self.health_failure_streak.store(0, Ordering::Relaxed);
    self.recovery_attempts.store(0, Ordering::Relaxed);
  }

  /// Transition device_state and immediately update the loading fields.
  /// This is the single source of truth for state transitions so the
  /// frontend always sees a consistent snapshot.
  pub fn set_device_state(&self, state: &str, loading_reason: Option<&str>) {
    *self.device_state.lock().unwrap() = state.to_string();
    let is_loading = state == "loading";
    *self.device_loading.lock().unwrap() = is_loading;
    *self.device_loading_reason.lock().unwrap() =
      loading_reason.map(|s| s.to_string());
    self.device_connected.store(
      state == "connected" || state == "loading",
      Ordering::Relaxed,
    );
  }

  /// Record a successful read, resetting the failure streak.
  pub fn record_successful_read(&self) {
    self.health_failure_streak.store(0, Ordering::Relaxed);
    *self.last_successful_read.lock().unwrap() = Some(Instant::now());
  }

  /// Increment the failure streak and return the new count.
  pub fn record_health_failure(&self) -> u32 {
    self.health_failure_streak.fetch_add(1, Ordering::Relaxed) + 1
  }

  /// Store an auth challenge nonce in Redis.
  pub fn store_challenge(
    &self,
    challenge_id: &str,
    nonce: [u8; 32],
  ) -> Result<(), String> {
    let mut conn = self
      .redis_client
      .get_connection()
      .map_err(|e| format!("Redis connection failed: {}", e))?;

    // Select DB 1 for metadata/auth
    redis::cmd("SELECT")
      .arg(1)
      .query::<()>(&mut conn)
      .map_err(|e| format!("Failed to select Redis DB 1: {}", e))?;

    let key = format!("challenge:{}", challenge_id);
    let _: () = conn
      .set_ex(key, nonce.to_vec(), 60) // 60s TTL
      .map_err(|e| format!("Redis SETEX failed: {}", e))?;

    Ok(())
  }

  /// Retrieve and remove an auth challenge nonce from Redis.
  pub fn take_challenge(&self, challenge_id: &str) -> Option<[u8; 32]> {
    let mut conn = self.redis_client.get_connection().ok()?;
    let _ = redis::cmd("SELECT").arg(1).query::<()>(&mut conn).ok()?;

    let key = format!("challenge:{}", challenge_id);
    let nonce_vec: Option<Vec<u8>> = conn.get(&key).ok()?;

    if let Some(vec) = nonce_vec {
      let _: () = conn.del(key).ok()?; // Consume challenge
      if vec.len() == 32 {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&vec);
        return Some(arr);
      }
    }
    None
  }

  /// Store capture artifacts in Redis for a job.
  pub fn store_capture_artifacts(
    &self,
    job_id: &str,
    artifacts: &[CaptureArtifact],
  ) -> Result<(), String> {
    let mut conn = self
      .redis_client
      .get_connection()
      .map_err(|e| format!("Redis connection failed: {}", e))?;

    // Select DB 1 for metadata
    redis::cmd("SELECT")
      .arg(1)
      .query::<()>(&mut conn)
      .map_err(|e| format!("Failed to select Redis DB 1: {}", e))?;

    let key = format!("artifacts:{}", job_id);
    let json = serde_json::to_string(artifacts)
      .map_err(|e| format!("Serialization failed: {}", e))?;

    let _: () = conn
      .set(key, json)
      .map_err(|e| format!("Redis SET failed: {}", e))?;

    Ok(())
  }

  /// Retrieve capture artifacts from Redis for a job.
  pub fn get_capture_artifacts(
    &self,
    job_id: &str,
  ) -> Option<Vec<CaptureArtifact>> {
    let mut conn = self.redis_client.get_connection().ok()?;
    let _ = redis::cmd("SELECT").arg(1).query::<()>(&mut conn).ok()?;

    let key = format!("artifacts:{}", job_id);
    let json: Option<String> = conn.get(key).ok()?;

    match json {
      Some(s) => serde_json::from_str::<Vec<CaptureArtifact>>(&s).ok(),
      None => None,
    }
  }
}
