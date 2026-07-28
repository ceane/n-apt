use redis::Commands;
use std::collections::HashMap;
use std::sync::atomic::{
  AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering,
};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use super::types::{
  CaptureArtifact, DeviceProfile, SdrProcessorSettings, SpectrumFrameMessage,
};
use super::utils::{load_available_spectrum, load_channels, load_sdr_settings};

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
  /// Stream epoch captured when the current paused one-frame request was made.
  pub paused_frame_request_epoch: AtomicU64,
  /// Last frame sequence visible when the current paused one-frame request was made.
  pub paused_frame_request_sequence: AtomicU64,
  /// Source that owns the current paused one-frame request.
  pub paused_frame_request_source_id: Mutex<Option<String>>,
  /// Monotonic presentation lifecycle for source-scoped v2 I/Q frames.
  pub stream_epoch: AtomicU64,
  /// Monotonic frame sequence reset whenever `stream_epoch` advances.
  pub stream_sequence: AtomicU64,
  /// Serializes epoch resets with frame identity allocation.
  stream_identity_lock: Mutex<()>,
  /// Pause state tracked per source so switching sources does not bleed pause
  /// commands across unrelated devices.
  pub source_pause_states: Mutex<HashMap<String, bool>>,
  /// Latest requested center frequency (MHz -> Hz), coalesced atomically
  pub pending_center_freq: AtomicU32,
  /// Whether there is a pending frequency change
  pub pending_center_freq_dirty: AtomicBool,
  /// Shutdown signal — I/O thread checks this each iteration
  pub shutdown: AtomicBool,
  /// Device info string (set once at init)
  pub device_info: Mutex<String>,
  /// USB serial number of the active SDR device
  pub device_serial: Mutex<String>,
  /// USB manufacturer string of the active SDR device
  pub device_manufacturer: Mutex<String>,
  /// USB product string of the active SDR device
  pub device_product: Mutex<String>,
  /// Backend/device error string surfaced to the frontend when available.
  pub device_backend_error: Mutex<Option<String>>,
  /// Current device profile/capabilities for frontend feature gating
  pub device_profile: Mutex<DeviceProfile>,
  /// Source requested by a client while the active processor is still on the
  /// previous source. The frame loop uses this as a hard publication fence so
  /// old-source frames cannot leak during a handoff.
  pub pending_source_switch: Mutex<Option<String>>,
  /// Device loading state (when device is being initialized)
  pub device_loading: Mutex<bool>,
  /// When device_loading is true, why: "connect" | "restart" (optional)
  pub device_loading_reason: Mutex<Option<String>>,
  /// Canonical device state: "connected", "loading", "loose", "disconnected", "stale"
  /// This is the single source of truth for the frontend.
  pub device_state: Mutex<String>,
  /// AES-256 encryption key derived from passkey (set once at startup)
  pub encryption_key: [u8; 32],
  /// Channels configuration loaded from signals.yaml
  pub channels: Mutex<Vec<SpectrumFrameMessage>>,
  /// SDR settings loaded from signals.yaml
  pub sdr_settings: Mutex<super::types::SdrConfig>,
  /// Available spectrum bounds loaded from signals.yaml
  pub available_spectrum: Option<(f64, f64)>,
  /// Forces the live stream to emit noise when the frontend/backend
  /// asks for an out-of-bounds tune request.
  pub force_noise: AtomicBool,
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
  pub mock_tx_transmitting: AtomicBool,
  pub tx_safety_enabled: AtomicBool,
  pub tx_safety_limit: Mutex<String>,
  pub tx_hop_enabled: AtomicBool,
  pub tx_hop_type: Mutex<String>,
  pub tx_hop_start_frequency_hz: Mutex<f64>,
  pub tx_hop_end_frequency_hz: Mutex<f64>,
  pub tx_hop_channels: Mutex<Vec<String>>,
  pub tx_hop_rate_hz: Mutex<f64>,
  pub mock_tx_phase_accumulator: Mutex<f64>,
  /// Last broadcast status payload, used to suppress duplicate snapshots.
  pub last_broadcast_status: Mutex<Option<String>>,
}

impl SharedState {
  pub fn new(redis_url: &str) -> Arc<Self> {
    let passkey = unsafe_local_user_password();
    let encryption_key = crate::crypto::derive_key(&passkey);
    let sdr_settings = load_sdr_settings();
    let redis_client = redis::Client::open(redis_url)
      .expect("Failed to initialize Redis client");

    Arc::new(SharedState {
      latest_spectrum: Mutex::new(None),
      device_connected: AtomicBool::new(false),
      client_count: AtomicUsize::new(0),
      authenticated_count: AtomicUsize::new(0),
      is_paused: AtomicBool::new(false),
      allow_next_paused_frame: AtomicBool::new(false),
      paused_frame_request_epoch: AtomicU64::new(1),
      paused_frame_request_sequence: AtomicU64::new(0),
      paused_frame_request_source_id: Mutex::new(None),
      stream_epoch: AtomicU64::new(1),
      stream_sequence: AtomicU64::new(0),
      stream_identity_lock: Mutex::new(()),
      source_pause_states: Mutex::new(HashMap::new()),
      pending_center_freq: AtomicU32::new(sdr_settings.center_frequency),
      pending_center_freq_dirty: AtomicBool::new(false),
      shutdown: AtomicBool::new(false),
      device_info: Mutex::new(String::new()),
      device_serial: Mutex::new(String::new()),
      device_manufacturer: Mutex::new(String::new()),
      device_product: Mutex::new(String::new()),
      device_backend_error: Mutex::new(None),
      device_profile: Mutex::new(DeviceProfile {
        kind: "mock_apt".to_string(),
        is_rtl_sdr: false,
        supports_approx_dbm: true,
        iq_format: Some(crate::server::types::IqFormat::default()),
      }),
      pending_source_switch: Mutex::new(None),
      device_loading: Mutex::new(false),
      device_loading_reason: Mutex::new(None),
      device_state: Mutex::new("disconnected".to_string()),
      encryption_key,
      channels: Mutex::new(load_channels()),
      sdr_settings: Mutex::new(sdr_settings.clone()),
      available_spectrum: load_available_spectrum()
        .map(|range| (range.min_freq, range.max_freq)),
      force_noise: AtomicBool::new(false),
      redis_client,
      health_failure_streak: AtomicU32::new(0),
      recovery_attempts: AtomicU32::new(0),
      last_successful_read: Mutex::new(None),
      pending_fast_settings: Mutex::new(Vec::new()),
      last_broadcast_status: Mutex::new(None),
      mock_tx_transmitting: AtomicBool::new(false),
      tx_safety_enabled: AtomicBool::new(false),
      tx_safety_limit: Mutex::new("room".to_string()),
      tx_hop_enabled: AtomicBool::new(false),
      tx_hop_type: Mutex::new("range".to_string()),
      tx_hop_start_frequency_hz: Mutex::new(0.0),
      tx_hop_end_frequency_hz: Mutex::new(0.0),
      tx_hop_channels: Mutex::new(Vec::new()),
      tx_hop_rate_hz: Mutex::new(1.0),
      mock_tx_phase_accumulator: Mutex::new(0.0),
    })
  }

  /// Return the current source-scoped I/Q lifecycle generation.
  pub fn current_stream_epoch(&self) -> u64 {
    self.stream_epoch.load(Ordering::Acquire)
  }

  /// Record the latest source handoff intent before its command is queued.
  pub fn request_source_switch(&self, source_id: &str) {
    *self.pending_source_switch.lock().unwrap() = Some(source_id.to_string());
  }

  /// Read the source handoff fence used by the frame publisher.
  pub fn pending_source_switch(&self) -> Option<String> {
    self.pending_source_switch.lock().unwrap().clone()
  }

  /// Clear a completed/failed handoff without erasing a newer request.
  pub fn clear_pending_source_switch(&self, source_id: &str) {
    let mut pending = self.pending_source_switch.lock().unwrap();
    if pending.as_deref() == Some(source_id) {
      *pending = None;
    }
  }

  /// Start a new source presentation generation and reset frame ordering.
  pub fn begin_stream_epoch(&self) -> u64 {
    let _identity_guard = self.stream_identity_lock.lock().unwrap();
    self.stream_sequence.store(0, Ordering::Release);
    self.stream_epoch.fetch_add(1, Ordering::AcqRel) + 1
  }

  /// Atomically allocate an epoch and its next monotonic v2 frame number.
  pub fn next_stream_frame_identity(&self) -> (u64, u64) {
    let _identity_guard = self.stream_identity_lock.lock().unwrap();
    let epoch = self.stream_epoch.load(Ordering::Acquire);
    let sequence = self.stream_sequence.fetch_add(1, Ordering::AcqRel) + 1;
    (epoch, sequence)
  }

  /// Mark a paused preview request at the current source stream boundary.
  ///
  /// Frames already broadcast before this call are not valid responses to the
  /// request. The source-I/Q handler uses this floor to avoid replaying an old
  /// buffered frame after a retune or sample-rate change.
  pub fn mark_paused_frame_requested(&self, source_id: &str) {
    self
      .paused_frame_request_epoch
      .store(self.current_stream_epoch(), Ordering::Release);
    self.paused_frame_request_sequence.store(
      self.stream_sequence.load(Ordering::Acquire),
      Ordering::Release,
    );
    *self.paused_frame_request_source_id.lock().unwrap() =
      Some(source_id.to_string());
    self.allow_next_paused_frame.store(true, Ordering::SeqCst);
  }

  /// Return the request floor when a paused request belongs to this source.
  pub fn paused_frame_request_for_source(
    &self,
    source_id: &str,
  ) -> Option<(u64, u64)> {
    let owns_request = self
      .paused_frame_request_source_id
      .lock()
      .unwrap()
      .as_deref()
      == Some(source_id);
    if !owns_request || !self.allow_next_paused_frame.load(Ordering::SeqCst) {
      return None;
    }
    Some((
      self.paused_frame_request_epoch.load(Ordering::Acquire),
      self.paused_frame_request_sequence.load(Ordering::Acquire),
    ))
  }

  /// Clear the source ownership associated with a consumed or cancelled request.
  pub fn clear_paused_frame_request(&self) {
    self.allow_next_paused_frame.store(false, Ordering::SeqCst);
    *self.paused_frame_request_source_id.lock().unwrap() = None;
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
    let is_mock_fallback =
      !connected && device_profile.kind.starts_with("mock_apt");
    self.device_connected.store(connected, Ordering::Relaxed);
    *self.device_info.lock().unwrap() = info;
    let kind = device_profile.kind.clone();
    *self.device_profile.lock().unwrap() = device_profile;
    {
      let mut settings = self.sdr_settings.lock().unwrap();
      settings.fft = super::utils::resolve_fft_config(
        &kind,
        settings.sample_rate,
        Some(settings.fft.default_size),
        Some(&settings),
      );
    }
    *self.device_state.lock().unwrap() = if connected {
      *self.device_loading_reason.lock().unwrap() = None;
      "connected".to_string()
    } else {
      "disconnected".to_string()
    };
    // Reset debounce counters on any definitive state change
    self.health_failure_streak.store(0, Ordering::Relaxed);
    self.recovery_attempts.store(0, Ordering::Relaxed);
    if is_mock_fallback {
      self.allow_next_paused_frame.store(true, Ordering::SeqCst);
    }
    *self.last_broadcast_status.lock().unwrap() = None;
  }

  /// Store or clear pause for a specific source.
  pub fn set_source_pause_state(&self, source_id: &str, paused: bool) {
    let mut states = self.source_pause_states.lock().unwrap();
    if paused {
      states.insert(source_id.to_string(), true);
    } else {
      states.remove(source_id);
    }
  }

  /// Return whether the source is currently marked paused.
  pub fn is_source_paused(&self, source_id: &str) -> bool {
    self
      .source_pause_states
      .lock()
      .unwrap()
      .get(source_id)
      .copied()
      .unwrap_or(false)
  }

  /// Mirror the provided source pause state into the active streaming fast path.
  pub fn sync_active_source_pause_state(&self, source_id: &str) {
    let paused = self.is_source_paused(source_id);
    self.is_paused.store(paused, Ordering::SeqCst);
    self.clear_paused_frame_request();
  }

  /// Record a pause change for the active source and mirror it into the
  /// legacy fast-path flag that the streaming loop still reads.
  pub fn set_active_source_pause_state(&self, source_id: &str, paused: bool) {
    self.set_source_pause_state(source_id, paused);
    self.is_paused.store(paused, Ordering::SeqCst);
    self.clear_paused_frame_request();
  }

  /// Update USB device identification strings (serial, manufacturer, product).
  pub fn update_device_usb_strings(
    &self,
    serial: String,
    manufacturer: String,
    product: String,
  ) {
    *self.device_serial.lock().unwrap() = serial;
    *self.device_manufacturer.lock().unwrap() = manufacturer;
    *self.device_product.lock().unwrap() = product;
  }

  pub fn set_device_backend_error(&self, error: Option<String>) {
    *self.device_backend_error.lock().unwrap() = error;
  }

  /// Transition device_state and immediately update the loading fields.
  /// This is the single source of truth for state transitions so the
  /// frontend always sees a consistent snapshot.
  pub fn set_device_state(&self, state: &str, loading_reason: Option<&str>) {
    let entered_loading = {
      let mut current = self.device_state.lock().unwrap();
      let entered = state == "loading" && current.as_str() != "loading";
      *current = state.to_string();
      entered
    };
    if entered_loading {
      self.begin_stream_epoch();
    }
    let is_loading = state == "loading";
    *self.device_loading.lock().unwrap() = is_loading;
    *self.device_loading_reason.lock().unwrap() =
      loading_reason.map(|s| s.to_string());
    self.device_connected.store(
      state == "connected" || state == "loading" || state == "transmitting",
      Ordering::Relaxed,
    );
    *self.last_broadcast_status.lock().unwrap() = None;
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

fn unsafe_local_user_password() -> String {
  match std::env::var("UNSAFE_LOCAL_USER_PASSWORD") {
    Ok(passkey) if !passkey.trim().is_empty() => passkey,
    _ => panic!(
      "UNSAFE_LOCAL_USER_PASSWORD missing. .env.local missing or incomplete; run npm run setup"
    ),
  }
}

#[cfg(test)]
mod tests {
  use super::{unsafe_local_user_password, SharedState};
  use serial_test::serial;
  use std::sync::atomic::Ordering;

  #[test]
  #[serial]
  fn entering_loading_starts_one_new_stream_epoch() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let shared = SharedState::new("redis://127.0.0.1:6379");
    let initial_epoch = shared.current_stream_epoch();
    shared.stream_sequence.store(9, Ordering::Release);

    shared.set_device_state("loading", Some("restart"));
    assert_eq!(shared.current_stream_epoch(), initial_epoch + 1);
    assert_eq!(shared.stream_sequence.load(Ordering::Acquire), 0);

    shared.set_device_state("loading", Some("restart"));
    assert_eq!(shared.current_stream_epoch(), initial_epoch + 1);
  }

  #[test]
  #[serial]
  fn frame_identity_is_monotonic_and_resets_with_the_epoch() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let shared = SharedState::new("redis://127.0.0.1:6379");
    let (epoch, first) = shared.next_stream_frame_identity();
    let (same_epoch, second) = shared.next_stream_frame_identity();
    assert_eq!(same_epoch, epoch);
    assert_eq!(second, first + 1);

    let next_epoch = shared.begin_stream_epoch();
    assert_eq!(shared.next_stream_frame_identity(), (next_epoch, 1));
  }

  #[test]
  #[serial]
  fn uses_configured_unsafe_local_user_password() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "configured-password");

    assert_eq!(unsafe_local_user_password(), "configured-password");

    std::env::remove_var("UNSAFE_LOCAL_USER_PASSWORD");
  }

  #[test]
  #[serial]
  #[should_panic(
    expected = "UNSAFE_LOCAL_USER_PASSWORD missing. .env.local missing or incomplete; run npm run setup"
  )]
  fn missing_unsafe_local_user_password_has_setup_error() {
    std::env::remove_var("UNSAFE_LOCAL_USER_PASSWORD");

    let _ = unsafe_local_user_password();
  }
}
// Hot-reload handoff probe 2.
