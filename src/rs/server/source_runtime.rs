//! Concurrent source-runtime ownership and per-source duplex arbitration.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sha2::{Digest, Sha256};

use super::stream_manager::{SourceStreamCapabilities, StreamMode};
use super::stream_manager::{
  StreamKey, StreamOptions, StreamingSourceModeManager,
};
use crate::sdr::processor::SdrProcessor;
use crate::server::types::SdrProcessorSettings;

#[derive(Debug, PartialEq, Eq)]
pub enum SourceRuntimeError {
  UnsupportedMode {
    source_id: String,
    mode: StreamMode,
  },
  ModeConflict {
    source_id: String,
    existing_mode: StreamMode,
    requested_mode: StreamMode,
  },
  Startup(String),
}

impl std::fmt::Display for SourceRuntimeError {
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Self::UnsupportedMode { source_id, mode } => {
        write!(formatter, "source {source_id} does not support {mode:?}")
      }
      Self::ModeConflict {
        source_id,
        existing_mode,
        requested_mode,
      } => write!(
        formatter,
        "source {source_id} is already reserved for {existing_mode:?}; cannot reserve {requested_mode:?}"
      ),
      Self::Startup(message) => formatter.write_str(message),
    }
  }
}

impl std::error::Error for SourceRuntimeError {}

/// Stable identity for one logical source/mode stream within an authenticated
/// session. The physical source ID remains separate so half-duplex arbitration
/// can be enforced per device while RX and TX retain distinct stream identities.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct SourceStreamIdentity {
  session_id: String,
  source_id: String,
  mode: StreamMode,
}

impl SourceStreamIdentity {
  pub fn new(
    session_id: impl Into<String>,
    source_id: impl Into<String>,
    mode: StreamMode,
  ) -> Self {
    Self {
      session_id: session_id.into(),
      source_id: source_id.into(),
      mode,
    }
  }

  /// Build the public identity from the authenticated token without exposing
  /// the token itself. The same session token and physical source ID produce
  /// the same identity for the lifetime of that session.
  pub fn from_session_token(
    session_token: &str,
    source_id: &str,
    mode: StreamMode,
  ) -> Self {
    Self::new(
      format!("session-{}", stable_component("session", session_token)),
      format!("source-{}", stable_component("source", source_id)),
      mode,
    )
  }

  pub fn id(&self) -> String {
    format!(
      "{}--{}--{}",
      self.session_id,
      self.source_id,
      match self.mode {
        StreamMode::Rx => "rx",
        StreamMode::Tx => "tx",
      }
    )
  }

  pub fn url_path(&self) -> String {
    format!("/ws/streams/{}", self.id())
  }
}

fn stable_component(namespace: &str, value: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(namespace.as_bytes());
  hasher.update([0]);
  hasher.update(value.as_bytes());
  let digest = hasher.finalize();
  digest[..16]
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect()
}

#[derive(Default)]
pub struct SourceRuntimeRegistry {
  reservations: HashMap<String, HashSet<StreamMode>>,
}

impl SourceRuntimeRegistry {
  pub fn new() -> Self {
    Self::default()
  }

  pub fn reserve(
    &mut self,
    source_id: impl Into<String>,
    mode: StreamMode,
    capabilities: SourceStreamCapabilities,
  ) -> Result<(), SourceRuntimeError> {
    let source_id = source_id.into();
    let supported = match mode {
      StreamMode::Rx => capabilities.can_receive,
      StreamMode::Tx => capabilities.can_transmit,
    };
    if !supported {
      return Err(SourceRuntimeError::UnsupportedMode { source_id, mode });
    }

    let modes = self.reservations.entry(source_id.clone()).or_default();
    if !capabilities.full_duplex {
      if let Some(&existing_mode) =
        modes.iter().find(|existing_mode| **existing_mode != mode)
      {
        return Err(SourceRuntimeError::ModeConflict {
          source_id,
          existing_mode,
          requested_mode: mode,
        });
      }
    }
    modes.insert(mode);
    Ok(())
  }

  pub fn release(&mut self, source_id: &str, mode: StreamMode) {
    let should_remove =
      self.reservations.get_mut(source_id).is_some_and(|modes| {
        modes.remove(&mode);
        modes.is_empty()
      });
    if should_remove {
      self.reservations.remove(source_id);
    }
  }

  pub fn is_reserved(&self, source_id: &str, mode: StreamMode) -> bool {
    self
      .reservations
      .get(source_id)
      .is_some_and(|modes| modes.contains(&mode))
  }

  pub fn running_source_count(&self) -> usize {
    self.reservations.values().map(HashSet::len).sum()
  }
}

enum RuntimeCommand {
  ApplyRxOptions {
    center_frequency_hz: u32,
    settings: SdrProcessorSettings,
  },
}

struct RuntimeHandle {
  stop: tokio::sync::watch::Sender<bool>,
  commands: tokio::sync::mpsc::UnboundedSender<RuntimeCommand>,
}

#[derive(Default)]
struct RuntimeManagerInner {
  registry: SourceRuntimeRegistry,
  handles: HashMap<StreamKey, RuntimeHandle>,
}

/// Owns one independent acquisition task per source/mode stream.
///
/// The legacy active-source processor remains responsible for the existing
/// control-plane path. This manager is the concurrent path: every entry owns
/// its own processor and can publish to its own `(source_id, mode)` stream.
#[derive(Clone, Default)]
pub struct SourceRuntimeManager {
  inner: Arc<Mutex<RuntimeManagerInner>>,
  startup_locks: Arc<Mutex<HashMap<StreamKey, Arc<tokio::sync::Mutex<()>>>>>,
}

impl SourceRuntimeManager {
  pub fn new() -> Self {
    Self {
      inner: Arc::new(Mutex::new(RuntimeManagerInner {
        registry: SourceRuntimeRegistry::new(),
        handles: HashMap::new(),
      })),
      startup_locks: Arc::new(Mutex::new(HashMap::new())),
    }
  }

  pub async fn start(
    &self,
    key: StreamKey,
    capabilities: SourceStreamCapabilities,
    mut processor: SdrProcessor,
    options: StreamOptions,
    stream_manager: StreamingSourceModeManager,
  ) -> Result<(), SourceRuntimeError> {
    if key.mode != StreamMode::Rx {
      return Err(SourceRuntimeError::UnsupportedMode {
        source_id: key.source_id,
        mode: key.mode,
      });
    }

    // Opening a USB device is not idempotent on all backends. Serialize only
    // starts for the same physical source/mode; different sources continue
    // to initialize concurrently.
    let startup_lock = {
      let mut locks = self
        .startup_locks
        .lock()
        .expect("source runtime startup lock poisoned");
      locks
        .entry(key.clone())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
    };
    let _startup_guard = startup_lock.lock().await;

    {
      let mut inner = self
        .inner
        .lock()
        .expect("source runtime registry lock poisoned");
      if inner.handles.contains_key(&key) {
        return Ok(());
      }
      inner
        .registry
        .reserve(key.source_id.clone(), key.mode, capabilities)?;
    }

    let initial_options = match options {
      StreamOptions::Rx(options) => options,
      StreamOptions::Tx(_) => {
        self.release_reservation(&key);
        return Err(SourceRuntimeError::UnsupportedMode {
          source_id: key.source_id,
          mode: StreamMode::Tx,
        });
      }
    };
    let initialized = tokio::task::spawn_blocking(move || {
      processor
        .initialize()
        .map_err(|error| SourceRuntimeError::Startup(error.to_string()))?;
      apply_rx_options(
        &mut processor,
        initial_options.center_frequency_hz,
        SdrProcessorSettings {
          sample_rate: Some(initial_options.sample_rate_hz),
          fft_size: Some(initial_options.fft_size),
          fft_window: initial_options.fft_window,
          frame_rate: initial_options.frame_rate,
          gain: initial_options.gain,
          ..Default::default()
        },
      )
      .map_err(|error| SourceRuntimeError::Startup(error.to_string()))?;
      Ok::<_, SourceRuntimeError>(Arc::new(Mutex::new(processor)))
    })
    .await
    .map_err(|error| SourceRuntimeError::Startup(error.to_string()))?;
    let processor = match initialized {
      Ok(processor) => processor,
      Err(error) => {
        self.release_reservation(&key);
        return Err(error);
      }
    };

    let (stop, stop_rx) = tokio::sync::watch::channel(false);
    let (commands, command_rx) = tokio::sync::mpsc::unbounded_channel();
    {
      let mut inner = self
        .inner
        .lock()
        .expect("source runtime registry lock poisoned");
      if inner.handles.contains_key(&key) {
        self.release_reservation_locked(&mut inner, &key);
        return Ok(());
      }
      inner
        .handles
        .insert(key.clone(), RuntimeHandle { stop, commands });
    }

    let inner = Arc::clone(&self.inner);
    tokio::spawn(run_runtime(
      key,
      processor,
      stream_manager,
      stop_rx,
      command_rx,
      inner,
    ));
    Ok(())
  }

  pub fn update_rx_options(
    &self,
    key: &StreamKey,
    center_frequency_hz: u32,
    settings: SdrProcessorSettings,
  ) -> Result<(), SourceRuntimeError> {
    let inner = self
      .inner
      .lock()
      .expect("source runtime registry lock poisoned");
    let Some(handle) = inner.handles.get(key) else {
      return Err(SourceRuntimeError::Startup(format!(
        "source runtime {} is not running",
        key.source_id
      )));
    };
    handle
      .commands
      .send(RuntimeCommand::ApplyRxOptions {
        center_frequency_hz,
        settings,
      })
      .map_err(|_| {
        SourceRuntimeError::Startup(format!(
          "source runtime {} is stopping",
          key.source_id
        ))
      })
  }

  pub fn is_running(&self, key: &StreamKey) -> bool {
    self
      .inner
      .lock()
      .expect("source runtime registry lock poisoned")
      .handles
      .contains_key(key)
  }

  pub fn running_source_count(&self) -> usize {
    self
      .inner
      .lock()
      .expect("source runtime registry lock poisoned")
      .registry
      .running_source_count()
  }

  pub fn stop_all(&self) {
    let inner = self
      .inner
      .lock()
      .expect("source runtime registry lock poisoned");
    for handle in inner.handles.values() {
      let _ = handle.stop.send(true);
    }
  }

  fn release_reservation(&self, key: &StreamKey) {
    let mut inner = self
      .inner
      .lock()
      .expect("source runtime registry lock poisoned");
    self.release_reservation_locked(&mut inner, key);
  }

  fn release_reservation_locked(
    &self,
    inner: &mut RuntimeManagerInner,
    key: &StreamKey,
  ) {
    inner.registry.release(&key.source_id, key.mode);
  }
}

fn apply_rx_options(
  processor: &mut SdrProcessor,
  center_frequency_hz: u64,
  settings: SdrProcessorSettings,
) -> anyhow::Result<()> {
  let center_frequency_hz = u32::try_from(center_frequency_hz)
    .map_err(|_| anyhow::anyhow!("center frequency exceeds u32"))?;
  processor.apply_settings(settings)?;
  processor.set_center_frequency(center_frequency_hz)?;
  Ok(())
}

async fn run_runtime(
  key: StreamKey,
  processor: Arc<Mutex<SdrProcessor>>,
  stream_manager: StreamingSourceModeManager,
  mut stop_rx: tokio::sync::watch::Receiver<bool>,
  mut command_rx: tokio::sync::mpsc::UnboundedReceiver<RuntimeCommand>,
  inner: Arc<Mutex<RuntimeManagerInner>>,
) {
  let frame_interval = Duration::from_millis(20);
  loop {
    tokio::select! {
      changed = stop_rx.changed() => {
        if changed.is_err() || *stop_rx.borrow() { break; }
      }
      Some(command) = command_rx.recv() => {
        let processor = Arc::clone(&processor);
        let _ = tokio::task::spawn_blocking(move || {
          let mut processor = processor.lock().ok()?;
          match command {
            RuntimeCommand::ApplyRxOptions { center_frequency_hz, settings } =>
              apply_rx_options(&mut processor, center_frequency_hz.into(), settings).ok(),
          }
        }).await;
      }
      _ = tokio::time::sleep(frame_interval) => {
        if !stream_manager.has_subscribers(&key) {
          continue;
        }
        let processor = Arc::clone(&processor);
        let frame = tokio::task::spawn_blocking(move || {
          let mut processor = processor.lock().ok()?;
          processor.read_and_process_frame_with_noise(false).ok()?;
          Some((
            processor.get_center_frequency(),
            processor.get_sample_rate(),
            Arc::new(processor.frame.last_frame_raw_iq.clone()),
          ))
        }).await.ok().flatten();
        if let Some((center_frequency, sample_rate, iq_data)) = frame {
          let _ = stream_manager.publish_iq_frame_with_metadata(
            &key,
            chrono::Utc::now().timestamp_millis(),
            Some(center_frequency.into()),
            sample_rate,
            iq_data,
          );
        }
      }
    }
  }

  let mut inner = inner.lock().expect("source runtime registry lock poisoned");
  inner.handles.remove(&key);
  inner.registry.release(&key.source_id, key.mode);
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::sdr::processor::SdrProcessor;
  use crate::server::stream_manager::{
    RxStreamOptions, SourceStreamCapabilities, StreamEvent, StreamFrame,
    StreamKey, StreamMode, StreamOptions, StreamSubscription,
    StreamingSourceModeManager,
  };
  use std::time::Duration;

  async fn receive_frame(subscription: &mut StreamSubscription) -> StreamFrame {
    loop {
      match subscription
        .recv()
        .await
        .expect("stream should remain open")
      {
        StreamEvent::Frame(frame) => return frame,
        StreamEvent::Opened { .. }
        | StreamEvent::OptionsApplied { .. }
        | StreamEvent::State { .. } => {}
        StreamEvent::Error { code, message, .. } => {
          panic!("unexpected stream error {code}: {message}")
        }
      }
    }
  }

  #[test]
  fn allows_independent_sources_to_run_at_the_same_time() {
    let mut registry = SourceRuntimeRegistry::new();

    registry
      .reserve(
        "rtl-sdr-serial-a",
        StreamMode::Rx,
        SourceStreamCapabilities {
          can_receive: true,
          can_transmit: false,
          full_duplex: false,
        },
      )
      .expect("RTL-SDR RX should be reservable");
    registry
      .reserve(
        "hackrf_one-serial-b",
        StreamMode::Tx,
        SourceStreamCapabilities {
          can_receive: true,
          can_transmit: true,
          full_duplex: false,
        },
      )
      .expect("HackRF TX should be reservable independently");

    assert_eq!(registry.running_source_count(), 2);
    assert!(registry.is_reserved("rtl-sdr-serial-a", StreamMode::Rx));
    assert!(registry.is_reserved("hackrf_one-serial-b", StreamMode::Tx));
  }

  #[test]
  fn rejects_opposite_modes_only_for_the_same_half_duplex_source() {
    let mut registry = SourceRuntimeRegistry::new();
    let half_duplex = SourceStreamCapabilities {
      can_receive: true,
      can_transmit: true,
      full_duplex: false,
    };

    registry
      .reserve("hackrf_one-serial-a", StreamMode::Rx, half_duplex)
      .expect("RX should be reservable first");
    let error = registry
      .reserve("hackrf_one-serial-a", StreamMode::Tx, half_duplex)
      .expect_err("half-duplex RX/TX must not overlap");
    assert!(matches!(error, SourceRuntimeError::ModeConflict { .. }));

    registry
      .reserve("hackrf_one-serial-b", StreamMode::Tx, half_duplex)
      .expect("another half-duplex device may run TX");
  }

  #[test]
  fn permits_rx_and_tx_on_one_full_duplex_source() {
    let mut registry = SourceRuntimeRegistry::new();
    let full_duplex = SourceStreamCapabilities {
      can_receive: true,
      can_transmit: true,
      full_duplex: true,
    };

    registry
      .reserve("duplex-source", StreamMode::Rx, full_duplex)
      .expect("full-duplex RX should be reservable");
    registry
      .reserve("duplex-source", StreamMode::Tx, full_duplex)
      .expect("full-duplex TX should be reservable alongside RX");

    assert_eq!(registry.running_source_count(), 2);
  }

  #[test]
  fn stream_identity_is_stable_per_session_source_and_mode() {
    let rx = SourceStreamIdentity::new(
      "session-a",
      "hackrf_one-serial-a",
      StreamMode::Rx,
    );
    let same_rx = SourceStreamIdentity::new(
      "session-a",
      "hackrf_one-serial-a",
      StreamMode::Rx,
    );
    let tx = SourceStreamIdentity::new(
      "session-a",
      "hackrf_one-serial-a",
      StreamMode::Tx,
    );
    let other_session = SourceStreamIdentity::new(
      "session-b",
      "hackrf_one-serial-a",
      StreamMode::Rx,
    );

    assert_eq!(rx, same_rx);
    assert_ne!(rx, tx);
    assert_ne!(rx, other_session);
    assert_eq!(rx.id(), "session-a--hackrf_one-serial-a--rx");
    assert_eq!(
      tx.url_path(),
      "/ws/streams/session-a--hackrf_one-serial-a--tx"
    );
  }

  #[test]
  fn session_token_derivation_is_stable_opaque_and_mode_specific() {
    let rx = SourceStreamIdentity::from_session_token(
      "2d3f7ad7-4c3f-4b4d-9b0c-7e0d8c0be4a1",
      "hackrf_one-serial-a",
      StreamMode::Rx,
    );
    let same_rx = SourceStreamIdentity::from_session_token(
      "2d3f7ad7-4c3f-4b4d-9b0c-7e0d8c0be4a1",
      "hackrf_one-serial-a",
      StreamMode::Rx,
    );
    let tx = SourceStreamIdentity::from_session_token(
      "2d3f7ad7-4c3f-4b4d-9b0c-7e0d8c0be4a1",
      "hackrf_one-serial-a",
      StreamMode::Tx,
    );

    assert_eq!(rx, same_rx);
    assert_ne!(rx, tx);
    assert!(!rx.id().contains("2d3f7ad7-4c3f-4b4d-9b0c-7e0d8c0be4a1"));
    assert!(rx.id().chars().all(|character| {
      character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
    }));
  }

  #[tokio::test]
  async fn publishes_frames_from_two_source_instances_concurrently() {
    let stream_manager =
      StreamingSourceModeManager::new(Duration::from_millis(20));
    let runtime_manager = SourceRuntimeManager::new();
    let capabilities = SourceStreamCapabilities {
      can_receive: true,
      can_transmit: false,
      full_duplex: false,
    };
    let options = |center_frequency_hz| {
      StreamOptions::Rx(RxStreamOptions {
        center_frequency_hz,
        sample_rate_hz: 3_200_000,
        fft_size: 1024,
        fft_window: None,
        frame_rate: Some(20),
        gain: None,
      })
    };
    let key_a = StreamKey::new("rtl-sdr-a", StreamMode::Rx);
    let key_b = StreamKey::new("rtl-sdr-b", StreamMode::Rx);
    stream_manager.register_source(key_a.source_id.clone(), capabilities);
    stream_manager.register_source(key_b.source_id.clone(), capabilities);
    let mut subscription_a = stream_manager
      .subscribe(key_a.clone(), options(137_100_000))
      .expect("source A subscription should open");
    let mut subscription_b = stream_manager
      .subscribe(key_b.clone(), options(144_800_000))
      .expect("source B subscription should open");

    runtime_manager
      .start(
        key_a.clone(),
        capabilities,
        SdrProcessor::new_mock_apt().expect("source A processor"),
        options(137_100_000),
        stream_manager.clone(),
      )
      .await
      .expect("source A runtime should start");
    runtime_manager
      .start(
        key_b.clone(),
        capabilities,
        SdrProcessor::new_mock_apt().expect("source B processor"),
        options(144_800_000),
        stream_manager.clone(),
      )
      .await
      .expect("source B runtime should start");

    let frame_a = tokio::time::timeout(
      Duration::from_secs(2),
      receive_frame(&mut subscription_a),
    )
    .await
    .expect("source A should publish a frame");
    let frame_b = tokio::time::timeout(
      Duration::from_secs(2),
      receive_frame(&mut subscription_b),
    )
    .await
    .expect("source B should publish a frame");

    assert_eq!(frame_a.key, key_a);
    assert_eq!(frame_b.key, key_b);
    assert_eq!(runtime_manager.running_source_count(), 2);
    runtime_manager.stop_all();
  }

  #[tokio::test]
  async fn coalesces_concurrent_start_requests_for_one_source_mode() {
    let stream_manager =
      StreamingSourceModeManager::new(Duration::from_millis(20));
    let runtime_manager = SourceRuntimeManager::new();
    let capabilities = SourceStreamCapabilities {
      can_receive: true,
      can_transmit: false,
      full_duplex: false,
    };
    let key = StreamKey::new("rtl-sdr-shared", StreamMode::Rx);
    let options = StreamOptions::Rx(RxStreamOptions {
      center_frequency_hz: 137_100_000,
      sample_rate_hz: 3_200_000,
      fft_size: 1024,
      fft_window: None,
      frame_rate: Some(20),
      gain: None,
    });
    stream_manager.register_source(key.source_id.clone(), capabilities);
    let _subscription = stream_manager
      .subscribe(key.clone(), options.clone())
      .expect("shared source subscription should open");

    let (first, second) = tokio::join!(
      runtime_manager.start(
        key.clone(),
        capabilities,
        SdrProcessor::new_mock_apt().expect("first processor"),
        options.clone(),
        stream_manager.clone(),
      ),
      runtime_manager.start(
        key.clone(),
        capabilities,
        SdrProcessor::new_mock_apt().expect("second processor"),
        options,
        stream_manager.clone(),
      ),
    );

    first.expect("first start should succeed");
    second.expect("coalesced start should succeed");
    assert_eq!(runtime_manager.running_source_count(), 1);
    runtime_manager.stop_all();
  }
}
