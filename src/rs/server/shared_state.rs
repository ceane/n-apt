use std::collections::HashMap;
use std::sync::atomic::{
  AtomicBool, AtomicU32, AtomicU64, AtomicU8, AtomicUsize, Ordering,
};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::Notify;

use crate::app::readiness::ReadinessState;
use crate::infrastructure::redis::{RedisReadiness, RedisStore};

use super::types::{DeviceProfile, SdrProcessorSettings, SpectrumFrameMessage};
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

/// Lifetime cap on reader-restart recoveries that report success. A stalled
/// reader whose handle reopens fine would otherwise reset both recovery
/// counters on every restart and loop loading→restart forever with a dead
/// stream; past this budget the terminal fallback path runs instead.
pub const MAX_READER_RESTARTS: u32 = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HackRfInventoryDevice {
  pub serial_number: String,
  pub index: usize,
}

/// RTL-SDR identity discovered by the SDR-owned hotplug/device path.
///
/// HTTP and WebSocket handlers must use this cache instead of calling
/// librtlsdr descriptor functions while the async reader owns the USB
/// interface. Those native calls can block on macOS/libusb and starve the
/// stream transport.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RtlSdrInventoryDevice {
  pub index: u32,
  pub serial_number: String,
  pub manufacturer: String,
  pub product: String,
  pub device_name: String,
}

/// Shared state visible to the async runtime (lock-free where possible)
pub struct SharedState {
  /// Backend readiness independent of hardware readiness.
  pub readiness: AtomicU8,
  /// Latest spectrum data produced by the I/O thread
  pub latest_spectrum: Mutex<Option<(Vec<f32>, bool)>>,
  /// Whether the device is connected (set once at init, updated on fallback)
  pub device_connected: AtomicBool,
  /// Count from the latest successful hardware-monitor inventory refresh.
  pub supported_usb_device_count: AtomicU32,
  /// Whether the hardware monitor has completed at least one inventory refresh.
  pub usb_inventory_known: AtomicBool,
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
  /// Wakes the frame loop as soon as a new retune request arrives.
  pub pending_center_freq_notify: Notify,
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
  /// Canonical device state: "connected", "initializing", "loading",
  /// "disconnected", "stale", or "error".
  /// This is the single source of truth for the frontend.
  pub device_state: Mutex<String>,
  /// AES-256 encryption key derived from passkey (set once at startup)
  pub encryption_key: [u8; 32],
  /// Channels configuration loaded from signals.yaml
  pub channels: Mutex<Vec<SpectrumFrameMessage>>,
  /// Device-scoped channel selected by the control plane. This is kept apart
  /// from subscriber-local playback state so every client can hydrate the
  /// same channel highlight and viewport.
  pub active_signal_area: Mutex<Option<String>>,
  /// Device-scoped viewport selected by the control plane.
  pub active_frequency_range: Mutex<Option<(f64, f64)>>,
  /// Device-scoped signed display convention. All subscribers receive this
  /// value so separate clients cannot render the same RF stream on opposite
  /// sides of the baseband axis.
  pub mirror_spectrum_below_zero: AtomicBool,
  /// SDR settings loaded from signals.yaml
  pub sdr_settings: Mutex<super::types::SdrConfig>,
  /// Available spectrum bounds loaded from signals.yaml
  pub available_spectrum: Option<(f64, f64)>,
  /// Forces the live stream to emit noise when the frontend/backend
  /// asks for an out-of-bounds tune request.
  pub force_noise: AtomicBool,
  /// Async Redis operations shared by HTTP handlers and workers.
  pub redis_store: RedisStore,
  /// Redis connectivity is tracked independently from HTTP and SDR health.
  pub redis_readiness: AtomicU8,

  // ── Hotplug debounce state ──────────────────────────────────────────
  /// Consecutive health-check failures while in real-hardware mode.
  /// Reset to 0 on every successful health check or frame read.
  pub health_failure_streak: AtomicU32,
  /// Number of recovery attempts (re-init) made during the current failure
  /// episode. Reset when the device recovers or is swapped to mock.
  pub recovery_attempts: AtomicU32,
  /// Lifetime count of reader-restart recoveries that reported success.
  /// Unlike `recovery_attempts`, this is never reset by the restart path, so
  /// a reader that reopens cleanly but keeps timing out cannot oscillate
  /// loading→restart forever; once `MAX_READER_RESTARTS` is reached the
  /// terminal hardware-swap / mock-fallback path takes over.
  pub reader_restart_count: AtomicU32,
  /// Timestamp of the last successful frame read from real hardware.
  /// Used to detect stale streams.
  pub last_successful_read: Mutex<Option<Instant>>,
  /// Monotonic counter for legacy-WebSocket connection ids.
  connection_counter: AtomicU64,
  /// The connection that armed the currently active capture, as
  /// (job_id, connection id). Lets socket teardown stop only captures the
  /// disconnecting client owns.
  capture_owner_connection: Mutex<Option<(String, u64)>>,

  /// Fast-path settings slot: written by the command handler WITHOUT the
  /// processor lock, read and applied by the blocking frame loop BEFORE
  /// the slow device read. This lets FFT size changes take effect
  /// immediately instead of waiting for the current frame to finish. The
  /// slot is coalesced field-wise so rapid writes from a disconnected or
  /// slow subscriber cannot replay stale device revisions.
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
  /// Last status/settings payload, used to suppress duplicate snapshots.
  pub last_broadcast_status: Mutex<Option<String>>,
  /// Last channels payload, kept separate so status/settings traffic cannot
  /// make an unchanged channel snapshot look new to subscribers.
  pub last_broadcast_channels: Mutex<Option<String>>,
  /// Origin tag of the client that performed the last live tune. Echoed in
  /// channels snapshots so the originator can recognize and drop its own
  /// echo instead of re-applying it over an in-flight gesture.
  pub last_tune_origin_id: Mutex<Option<String>>,
  /// HackRF inventory populated by the hardware monitor. Source/status
  /// snapshots must read this cache rather than enumerate the native library.
  pub hackrf_inventory: Mutex<Vec<HackRfInventoryDevice>>,
  /// RTL-SDR inventory populated by the SDR-owned device path. Source/status
  /// snapshots must not query librtlsdr directly from the HTTP runtime.
  pub rtl_sdr_inventory: Mutex<Vec<RtlSdrInventoryDevice>>,
}

impl SharedState {
  pub fn new(redis_url: &str) -> Arc<Self> {
    let passkey = unsafe_local_user_password();
    let encryption_key = crate::crypto::derive_key(&passkey);
    let sdr_settings = load_sdr_settings();
    let (redis_store, redis_readiness) = match redis::Client::open(redis_url) {
      Ok(client) => (RedisStore::from_client(client), RedisReadiness::Unknown),
      Err(error) => {
        log::error!(
          "Invalid Redis URL; Redis will remain unavailable: {error}"
        );
        let fallback_client = redis::Client::open("redis://127.0.0.1/")
          .expect("built-in Redis fallback URL must be valid");
        (
          RedisStore::from_client_with_error(
            fallback_client,
            error.to_string(),
          ),
          RedisReadiness::Unavailable,
        )
      }
    };

    let channels = load_channels();
    let initial_signal_area =
      channels.first().map(|channel| channel.label.clone());

    Arc::new(SharedState {
      readiness: AtomicU8::new(ReadinessState::Starting as u8),
      latest_spectrum: Mutex::new(None),
      device_connected: AtomicBool::new(false),
      supported_usb_device_count: AtomicU32::new(0),
      usb_inventory_known: AtomicBool::new(false),
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
      pending_center_freq_notify: Notify::new(),
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
      channels: Mutex::new(channels),
      active_signal_area: Mutex::new(initial_signal_area),
      active_frequency_range: Mutex::new(None),
      mirror_spectrum_below_zero: AtomicBool::new(false),
      sdr_settings: Mutex::new(sdr_settings.clone()),
      available_spectrum: load_available_spectrum()
        .map(|range| (range.min_freq, range.max_freq)),
      force_noise: AtomicBool::new(false),
      redis_store,
      redis_readiness: AtomicU8::new(redis_readiness as u8),
      health_failure_streak: AtomicU32::new(0),
      recovery_attempts: AtomicU32::new(0),
      reader_restart_count: AtomicU32::new(0),
      last_successful_read: Mutex::new(None),
      connection_counter: AtomicU64::new(0),
      capture_owner_connection: Mutex::new(None),
      pending_fast_settings: Mutex::new(Vec::new()),
      last_broadcast_status: Mutex::new(None),
      last_broadcast_channels: Mutex::new(None),
      last_tune_origin_id: Mutex::new(None),
      hackrf_inventory: Mutex::new(Vec::new()),
      rtl_sdr_inventory: Mutex::new(Vec::new()),
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

  pub fn set_readiness(&self, state: ReadinessState) {
    self.readiness.store(state as u8, Ordering::Release);
  }

  pub fn readiness_state(&self) -> ReadinessState {
    ReadinessState::from_u8(self.readiness.load(Ordering::Acquire))
  }

  pub fn set_redis_readiness(&self, state: RedisReadiness) {
    self.redis_readiness.store(state as u8, Ordering::Release);
  }

  pub fn redis_readiness(&self) -> RedisReadiness {
    RedisReadiness::from_u8(self.redis_readiness.load(Ordering::Acquire))
  }

  /// Publish the newest center-frequency request without taking the processor
  /// mutex. The frame loop consumes the latest value before its next read.
  pub fn request_center_frequency(&self, center_frequency_hz: u32) {
    self
      .pending_center_freq
      .store(center_frequency_hz, Ordering::Release);
    self
      .pending_center_freq_dirty
      .store(true, Ordering::Release);
    self.pending_center_freq_notify.notify_one();
  }

  /// Queue the newest value for every device-scoped setting without allowing
  /// a burst of partial updates to become a FIFO replay at the next frame.
  /// Independent fields are preserved, while a later value for the same
  /// field supersedes the older one.
  pub fn enqueue_pending_fast_settings(&self, next: SdrProcessorSettings) {
    let mut pending = self.pending_fast_settings.lock().unwrap();
    if let Some(current) = pending.last_mut() {
      merge_pending_fast_settings(current, next);
    } else {
      pending.push(next);
    }
  }

  /// Take the coalesced device settings at a frame boundary.
  pub fn take_pending_fast_settings(&self) -> Vec<SdrProcessorSettings> {
    std::mem::take(&mut *self.pending_fast_settings.lock().unwrap())
  }

  /// Store the latest device-scoped channel selection and viewport.
  pub fn set_channel_selection(
    &self,
    signal_area: Option<String>,
    frequency_range: (f64, f64),
  ) {
    if let Some(area) = signal_area {
      let canonical_area = if area.eq_ignore_ascii_case("manual") {
        Some("manual".to_string())
      } else {
        self
          .channels
          .lock()
          .unwrap()
          .iter()
          .find(|channel| channel.label.eq_ignore_ascii_case(&area))
          .map(|channel| channel.label.clone())
      };
      if canonical_area.is_some() {
        *self.active_signal_area.lock().unwrap() = canonical_area;
      }
    }
    *self.active_frequency_range.lock().unwrap() = Some(frequency_range);
  }

  pub fn active_signal_area(&self) -> Option<String> {
    self.active_signal_area.lock().unwrap().clone()
  }

  pub fn active_frequency_range(&self) -> Option<(f64, f64)> {
    *self.active_frequency_range.lock().unwrap()
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
    // A new source/recovery epoch must prove that it can produce a frame
    // before the source is advertised as receiving. Otherwise the frontend
    // sees `receiving` while the reader is still stalled and its watchdog
    // correctly reports a misleading I/O error.
    *self.last_successful_read.lock().unwrap() = None;
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

  /// The source that currently owns the armed paused-frame request, if any.
  pub fn paused_frame_request_owner(&self) -> Option<String> {
    let owns_request = self.allow_next_paused_frame.load(Ordering::SeqCst);
    if !owns_request {
      return None;
    }
    self.paused_frame_request_source_id.lock().unwrap().clone()
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
    *self.last_broadcast_channels.lock().unwrap() = None;
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

  pub fn set_rtl_sdr_inventory(&self, inventory: Vec<RtlSdrInventoryDevice>) {
    *self.rtl_sdr_inventory.lock().unwrap() = inventory;
  }

  pub fn cache_active_rtl_sdr(
    &self,
    serial_number: String,
    manufacturer: String,
    product: String,
  ) {
    let device_name = if product.trim().is_empty() {
      "RTL-SDR".to_string()
    } else {
      product.clone()
    };
    self.set_rtl_sdr_inventory(vec![RtlSdrInventoryDevice {
      index: 0,
      serial_number,
      manufacturer,
      product,
      device_name,
    }]);
  }

  pub fn rtl_sdr_inventory_snapshot(&self) -> Vec<RtlSdrInventoryDevice> {
    self.rtl_sdr_inventory.lock().unwrap().clone()
  }

  /// Transition device_state and immediately update the loading fields.
  /// This is the single source of truth for state transitions so the
  /// frontend always sees a consistent snapshot.
  pub fn set_device_state(&self, state: &str, loading_reason: Option<&str>) {
    let entered_loading = {
      let mut current = self.device_state.lock().unwrap();
      let entered = matches!(state, "loading" | "initializing")
        && current.as_str() != state;
      *current = state.to_string();
      entered
    };
    if entered_loading {
      self.begin_stream_epoch();
    }
    let is_loading = matches!(state, "loading" | "initializing");
    *self.device_loading.lock().unwrap() = is_loading;
    *self.device_loading_reason.lock().unwrap() =
      loading_reason.map(|s| s.to_string());
    self.device_connected.store(
      state == "connected"
        || state == "initializing"
        || state == "loading"
        || state == "transmitting",
      Ordering::Relaxed,
    );
    *self.last_broadcast_status.lock().unwrap() = None;
    *self.last_broadcast_channels.lock().unwrap() = None;
    if state == "disconnected" {
      // Hardware sources are gone; their pause records would otherwise
      // accumulate a stale entry per ever-seen serial for the process
      // lifetime. Mock source ids are unaffected.
      self.source_pause_states.lock().unwrap().retain(|source_id, _| {
        !(source_id.starts_with("hackrf_one-")
          || source_id.starts_with("rtl-sdr")
          || source_id.starts_with("rtl_sdr"))
      });
    }
  }

  /// Record a successful read, resetting the failure streak.
  pub fn record_successful_read(&self) {
    self.health_failure_streak.store(0, Ordering::Relaxed);
    *self.last_successful_read.lock().unwrap() = Some(Instant::now());
  }

  /// Allocate a unique legacy-WebSocket connection id.
  pub fn next_connection_id(&self) -> u64 {
    self.connection_counter.fetch_add(1, Ordering::Relaxed)
  }

  /// Record the connection that armed the currently active capture job. Only
  /// one capture can run at a time, so this is a single slot: the most recent
  /// starter owns it.
  pub fn register_capture_owner(&self, job_id: &str, connection_id: u64) {
    *self.capture_owner_connection.lock().unwrap() =
      Some((job_id.to_string(), connection_id));
  }

  /// Forget ownership of `job_id` (capture stopped or completed).
  pub fn clear_capture_owner_if(&self, job_id: &str) {
    let mut owner = self.capture_owner_connection.lock().unwrap();
    if owner.as_ref().is_some_and(|(owned, _)| owned == job_id) {
      *owner = None;
    }
  }

  /// Return the active capture's job_id only when this connection started
  /// it — used on socket teardown so one client disconnecting cannot abort
  /// another client's in-flight capture.
  pub fn take_owned_capture_for_connection(
    &self,
    connection_id: u64,
  ) -> Option<String> {
    let mut owner = self.capture_owner_connection.lock().unwrap();
    if owner
      .as_ref()
      .is_some_and(|(_, id)| *id == connection_id)
    {
      owner.take().map(|(job_id, _)| job_id)
    } else {
      None
    }
  }

  /// Increment the failure streak and return the new count.
  pub fn record_health_failure(&self) -> u32 {
    self.health_failure_streak.fetch_add(1, Ordering::Relaxed) + 1
  }
}

fn merge_pending_fast_settings(
  current: &mut SdrProcessorSettings,
  next: SdrProcessorSettings,
) {
  if next.fft_size.is_some() {
    current.fft_size = next.fft_size;
  }
  if next.fft_window.is_some() {
    current.fft_window = next.fft_window;
  }
  if next.frame_rate.is_some() {
    current.frame_rate = next.frame_rate;
  }
  if next.max_frame_rate.is_some() {
    current.max_frame_rate = next.max_frame_rate;
  }
  if next.sample_rate.is_some() {
    current.sample_rate = next.sample_rate;
  }
  if next.gain.is_some() {
    current.gain = next.gain;
  }
  if next.hackrf_lna_gain.is_some() {
    current.hackrf_lna_gain = next.hackrf_lna_gain;
  }
  if next.hackrf_vga_gain.is_some() {
    current.hackrf_vga_gain = next.hackrf_vga_gain;
  }
  if next.hackrf_amp_enable.is_some() {
    current.hackrf_amp_enable = next.hackrf_amp_enable;
  }
  if next.ppm.is_some() {
    current.ppm = next.ppm;
  }
  if next.tuner_agc.is_some() {
    current.tuner_agc = next.tuner_agc;
  }
  if next.rtl_agc.is_some() {
    current.rtl_agc = next.rtl_agc;
  }
  if next.offset_tuning.is_some() {
    current.offset_tuning = next.offset_tuning;
  }
  if next.direct_sampling.is_some() {
    current.direct_sampling = next.direct_sampling;
  }
  if next.tuner_bandwidth.is_some() {
    current.tuner_bandwidth = next.tuner_bandwidth;
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
  use crate::server::types::SdrProcessorSettings;
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
    assert!(shared.last_successful_read.lock().unwrap().is_none());

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
  fn new_stream_epoch_requires_a_fresh_successful_read() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let shared = SharedState::new("redis://127.0.0.1:6379");
    shared.record_successful_read();
    assert!(shared.last_successful_read.lock().unwrap().is_some());

    shared.begin_stream_epoch();

    assert!(shared.last_successful_read.lock().unwrap().is_none());
  }

  #[test]
  #[serial]
  fn syncing_same_source_clears_a_stale_global_pause_gate() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let shared = SharedState::new("redis://127.0.0.1:6379");
    shared.is_paused.store(true, Ordering::SeqCst);

    // The source-scoped state says RTL is resumable even though the legacy
    // global fast path was left paused by an earlier handoff.
    shared.sync_active_source_pause_state("rtl-sdr-00000001");

    assert!(!shared.is_paused.load(Ordering::SeqCst));
  }

  #[test]
  #[serial]
  fn coalesces_pending_device_settings_by_field() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    let shared = SharedState::new("redis://127.0.0.1:6379");

    shared.enqueue_pending_fast_settings(SdrProcessorSettings {
      sample_rate: Some(2_400_000),
      fft_size: Some(1024),
      ..Default::default()
    });
    shared.enqueue_pending_fast_settings(SdrProcessorSettings {
      sample_rate: Some(4_372_000),
      ..Default::default()
    });
    shared.enqueue_pending_fast_settings(SdrProcessorSettings {
      gain: Some(46.9),
      ..Default::default()
    });

    let pending = shared.take_pending_fast_settings();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].sample_rate, Some(4_372_000));
    assert_eq!(pending[0].fft_size, Some(1024));
    assert_eq!(pending[0].gain, Some(46.9));
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

  /// Pins the vault/auth key contract: the server's `encryption_key` is
  /// exactly `PBKDF2-HMAC-SHA256(password, salt, 100k)`. Both the password
  /// challenge-response (HMAC over a server nonce) and .napt capture
  /// encryption/playback (`scripts/decrypt_napt.mjs` re-derives this same
  /// key client-side) depend on this derivation staying byte-stable.
  /// Changing it orphans every previously recorded capture.
  #[test]
  #[serial]
  fn encryption_key_is_pbkdf2_of_configured_password() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "vault-contract-test");
    let shared = SharedState::new("redis://127.0.0.1:6379");

    let expected = crate::crypto::derive_key("vault-contract-test");
    assert_eq!(shared.encryption_key, expected);

    // A different password must derive a different key...
    assert_ne!(
      shared.encryption_key,
      crate::crypto::derive_key("other-password")
    );
    // ...and derivation trims deterministically (frontend parity).
    assert_eq!(expected, crate::crypto::derive_key(" vault-contract-test "));

    // End-to-end auth proof shape: a client that knows the password can HMAC
    // a server nonce with its derived key and the server verifies it with the
    // shared key — no plaintext password ever crosses the wire.
    let nonce = crate::crypto::generate_nonce();
    let client_tag = crate::crypto::compute_hmac(&expected, &nonce);
    assert!(crate::crypto::verify_hmac(
      &shared.encryption_key,
      &nonce,
      &client_tag
    ));

    std::env::remove_var("UNSAFE_LOCAL_USER_PASSWORD");
  }
}
// Hot-reload handoff probe 2.
