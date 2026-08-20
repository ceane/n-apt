use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::sync::broadcast;

use super::stream_contract::StreamDeliveryPolicy;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamMode {
  Rx,
  Tx,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamKey {
  pub source_id: String,
  pub mode: StreamMode,
}

impl StreamKey {
  pub fn new(source_id: impl Into<String>, mode: StreamMode) -> Self {
    Self {
      source_id: source_id.into(),
      mode,
    }
  }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RxStreamOptions {
  pub center_frequency_hz: u64,
  pub sample_rate_hz: u32,
  pub fft_size: usize,
  pub fft_window: Option<String>,
  pub frame_rate: Option<u32>,
  pub gain: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TxStreamOptions {
  pub center_frequency_hz: u64,
  pub sample_rate_hz: u32,
  pub bandwidth_hz: u32,
  pub signal: String,
  pub power_dbm: f64,
  pub ifft_size: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum StreamOptions {
  Rx(RxStreamOptions),
  Tx(TxStreamOptions),
}

impl StreamOptions {
  fn mode(&self) -> StreamMode {
    match self {
      Self::Rx(_) => StreamMode::Rx,
      Self::Tx(_) => StreamMode::Tx,
    }
  }
}

#[derive(Clone, Debug, PartialEq)]
pub struct StreamFrame {
  pub key: StreamKey,
  pub stream_epoch: u64,
  pub options_revision: u64,
  pub sequence: u64,
  pub timestamp: i64,
  pub center_frequency_hz: Option<u64>,
  pub sample_rate_hz: u32,
  pub iq_data: Arc<Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TxStreamPayload {
  pub center_frequency_hz: u64,
  pub sample_rate_hz: u32,
  pub iq_data: Arc<Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum StreamEvent {
  Opened {
    key: StreamKey,
    stream_epoch: u64,
    options_revision: u64,
    options: StreamOptions,
  },
  OptionsApplied {
    key: StreamKey,
    stream_epoch: u64,
    options_revision: u64,
    options: StreamOptions,
  },
  Frame(StreamFrame),
  State {
    key: StreamKey,
    stream_epoch: u64,
    options_revision: u64,
    state: StreamState,
    reason: Option<String>,
  },
  Error {
    key: StreamKey,
    stream_epoch: u64,
    options_revision: u64,
    code: String,
    message: String,
  },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StreamState {
  Opening,
  Ready,
  Stopping,
  Unavailable,
  Error,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SourceStreamCapabilities {
  pub can_receive: bool,
  pub can_transmit: bool,
  pub full_duplex: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamMetrics {
  pub subscriber_count: usize,
  pub accepted_frames: u64,
  pub sequence: u64,
  pub stream_epoch: u64,
  pub options_revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StreamMetricsSnapshot {
  pub key: StreamKey,
  pub subscriber_count: usize,
  pub accepted_frames: u64,
  pub sequence: u64,
  pub stream_epoch: u64,
  pub options_revision: u64,
}

#[derive(Debug, Eq, PartialEq)]
pub enum StreamError {
  InvalidOptions,
  Capability(String),
  Arbitration(String),
  MissingStream,
}

impl StreamError {
  pub fn code(&self) -> &'static str {
    match self {
      Self::InvalidOptions => "options",
      Self::Capability(_) => "capability",
      Self::Arbitration(_) => "arbitration",
      Self::MissingStream => "missing_stream",
    }
  }
}

impl Display for StreamError {
  fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
    match self {
      Self::InvalidOptions => {
        formatter.write_str("stream options do not match stream mode")
      }
      Self::Capability(message) | Self::Arbitration(message) => {
        formatter.write_str(message)
      }
      Self::MissingStream => formatter.write_str("stream is not active"),
    }
  }
}

impl std::error::Error for StreamError {}

struct StreamEntry {
  options: StreamOptions,
  stream_epoch: u64,
  options_revision: u64,
  sequence: u64,
  accepted_frames: u64,
  subscribers: HashMap<u64, SubscriberContract>,
  close_generation: u64,
  sender: broadcast::Sender<StreamEvent>,
}

/// Per-connection subscriber state. This is deliberately separate from the
/// source/device state: the backend may use unanimity across these contracts
/// to idle acquisition, but it must not turn one subscriber's pause into a
/// global pause visible to the other subscribers.
struct SubscriberContract {
  paused: Arc<AtomicBool>,
  delivery_policy: Arc<AtomicU8>,
}

struct ManagerInner {
  streams: Mutex<HashMap<StreamKey, StreamEntry>>,
  capabilities: Mutex<HashMap<String, SourceStreamCapabilities>>,
  tx_payloads: Mutex<HashMap<StreamKey, TxStreamPayload>>,
  next_epoch: AtomicU64,
  next_subscription: AtomicU64,
  no_subscriber_grace: Duration,
}

#[derive(Clone)]
pub struct StreamingSourceModeManager {
  inner: Arc<ManagerInner>,
}

pub struct StreamSubscription {
  manager: Weak<ManagerInner>,
  key: StreamKey,
  subscription_id: u64,
  receiver: broadcast::Receiver<StreamEvent>,
  active: Arc<AtomicBool>,
  paused: Arc<AtomicBool>,
  delivery_policy: Arc<AtomicU8>,
  pending_event: Option<StreamEvent>,
}

fn delivery_policy_to_u8(policy: StreamDeliveryPolicy) -> u8 {
  match policy {
    StreamDeliveryPolicy::Latest => 0,
    StreamDeliveryPolicy::Lossless => 1,
  }
}

fn delivery_policy_from_u8(value: u8) -> StreamDeliveryPolicy {
  if value == delivery_policy_to_u8(StreamDeliveryPolicy::Latest) {
    StreamDeliveryPolicy::Latest
  } else {
    StreamDeliveryPolicy::Lossless
  }
}

impl StreamingSourceModeManager {
  pub fn new(no_subscriber_grace: Duration) -> Self {
    Self {
      inner: Arc::new(ManagerInner {
        streams: Mutex::new(HashMap::new()),
        capabilities: Mutex::new(HashMap::new()),
        tx_payloads: Mutex::new(HashMap::new()),
        next_epoch: AtomicU64::new(1),
        next_subscription: AtomicU64::new(1),
        no_subscriber_grace,
      }),
    }
  }

  pub fn register_source(
    &self,
    source_id: impl Into<String>,
    capabilities: SourceStreamCapabilities,
  ) {
    self
      .inner
      .capabilities
      .lock()
      .unwrap()
      .insert(source_id.into(), capabilities);
  }

  pub fn subscribe(
    &self,
    key: StreamKey,
    options: StreamOptions,
  ) -> Result<StreamSubscription, StreamError> {
    self.subscribe_with_policy(key, options, StreamDeliveryPolicy::Lossless)
  }

  pub fn subscribe_with_policy(
    &self,
    key: StreamKey,
    options: StreamOptions,
    delivery_policy: StreamDeliveryPolicy,
  ) -> Result<StreamSubscription, StreamError> {
    if key.source_id.trim().is_empty() || options.mode() != key.mode {
      return Err(StreamError::InvalidOptions);
    }
    self.validate_capability(&key)?;

    let mut streams = self.inner.streams.lock().unwrap();
    if self.has_conflicting_mode(&key, &streams) {
      return Err(StreamError::Arbitration(format!(
        "source {} is already streaming the other half-duplex mode",
        key.source_id
      )));
    }
    if let Some(entry) = streams.get_mut(&key) {
      if options.mode() != entry.options.mode() {
        return Err(StreamError::InvalidOptions);
      }
      entry.close_generation = entry.close_generation.wrapping_add(1);
      let receiver = entry.sender.subscribe();
      // A second subscriber hydrates from the existing device-owned stream.
      // It must not turn its stale local request into a global reconfiguration;
      // callers use update_options for an intentional device-scoped change.
      let subscription_id = self.next_subscription();
      let paused = Arc::new(AtomicBool::new(false));
      let delivery_policy = Arc::new(AtomicU8::new(delivery_policy_to_u8(delivery_policy)));
      entry
        .subscribers
        .insert(
          subscription_id,
          SubscriberContract {
            paused: paused.clone(),
            delivery_policy: delivery_policy.clone(),
          },
        );
      return Ok(self.make_subscription(
        key,
        receiver,
        subscription_id,
        paused,
        delivery_policy,
      ));
    }

    let (sender, receiver) = broadcast::channel(32);
    let stream_epoch = self.next_epoch();
    let options_revision = 1;
    let subscription_id = self.next_subscription();
    let paused = Arc::new(AtomicBool::new(false));
    let delivery_policy = Arc::new(AtomicU8::new(delivery_policy_to_u8(delivery_policy)));
    let mut subscribers = HashMap::new();
    subscribers.insert(
      subscription_id,
      SubscriberContract {
        paused: paused.clone(),
        delivery_policy: delivery_policy.clone(),
      },
    );
    streams.insert(
      key.clone(),
      StreamEntry {
        options,
        stream_epoch,
        options_revision,
        sequence: 0,
        accepted_frames: 0,
        subscribers,
        close_generation: 0,
        sender,
      },
    );
    Ok(self.make_subscription(
      key,
      receiver,
      subscription_id,
      paused,
      delivery_policy,
    ))
  }

  fn make_subscription(
    &self,
    key: StreamKey,
    receiver: broadcast::Receiver<StreamEvent>,
    subscription_id: u64,
    paused: Arc<AtomicBool>,
    delivery_policy: Arc<AtomicU8>,
  ) -> StreamSubscription {
    StreamSubscription {
      manager: Arc::downgrade(&self.inner),
      key,
      subscription_id,
      receiver,
      active: Arc::new(AtomicBool::new(true)),
      paused,
      delivery_policy,
      pending_event: None,
    }
  }

  fn validate_capability(&self, key: &StreamKey) -> Result<(), StreamError> {
    let capabilities = self
      .inner
      .capabilities
      .lock()
      .unwrap()
      .get(&key.source_id)
      .copied()
      .unwrap_or(SourceStreamCapabilities {
        can_receive: true,
        can_transmit: true,
        full_duplex: true,
      });
    let allowed = match key.mode {
      StreamMode::Rx => capabilities.can_receive,
      StreamMode::Tx => capabilities.can_transmit,
    };
    if allowed {
      Ok(())
    } else {
      Err(StreamError::Capability(format!(
        "source {} does not support {:?} streaming",
        key.source_id, key.mode
      )))
    }
  }

  fn has_conflicting_mode(
    &self,
    key: &StreamKey,
    streams: &HashMap<StreamKey, StreamEntry>,
  ) -> bool {
    let capabilities = self
      .inner
      .capabilities
      .lock()
      .unwrap()
      .get(&key.source_id)
      .copied()
      .unwrap_or(SourceStreamCapabilities {
        can_receive: true,
        can_transmit: true,
        full_duplex: true,
      });
    if capabilities.full_duplex {
      return false;
    }
    streams.keys().any(|existing| {
      existing.source_id == key.source_id && existing.mode != key.mode
    })
  }

  fn next_epoch(&self) -> u64 {
    self.inner.next_epoch.fetch_add(1, Ordering::Relaxed)
  }

  fn next_subscription(&self) -> u64 {
    self.inner.next_subscription.fetch_add(1, Ordering::Relaxed)
  }

  pub fn publish_iq_frame(
    &self,
    key: &StreamKey,
    timestamp: i64,
    sample_rate_hz: u32,
    iq_data: Arc<Vec<u8>>,
  ) -> Result<StreamFrame, StreamError> {
    self.publish_iq_frame_with_metadata(
      key,
      timestamp,
      None,
      sample_rate_hz,
      iq_data,
    )
  }

  pub fn publish_iq_frame_with_metadata(
    &self,
    key: &StreamKey,
    timestamp: i64,
    center_frequency_hz: Option<u64>,
    sample_rate_hz: u32,
    iq_data: Arc<Vec<u8>>,
  ) -> Result<StreamFrame, StreamError> {
    let mut streams = self.inner.streams.lock().unwrap();
    let entry = streams.get_mut(key).ok_or(StreamError::MissingStream)?;
    entry.sequence += 1;
    entry.accepted_frames += 1;
    let frame = StreamFrame {
      key: key.clone(),
      stream_epoch: entry.stream_epoch,
      options_revision: entry.options_revision,
      sequence: entry.sequence,
      timestamp,
      center_frequency_hz,
      sample_rate_hz,
      iq_data,
    };
    let _ = entry.sender.send(StreamEvent::Frame(frame.clone()));
    Ok(frame)
  }

  pub fn options(&self, key: &StreamKey) -> Option<StreamOptions> {
    self
      .inner
      .streams
      .lock()
      .unwrap()
      .get(key)
      .map(|entry| entry.options.clone())
  }

  /// Returns true only when there is at least one subscriber and every
  /// subscriber has opted into the backend's universal idle optimization.
  /// A missing stream or a stream with no subscribers must keep producing so a
  /// new subscriber can still attach and receive its first frame.
  pub fn all_subscribers_paused(&self, key: &StreamKey) -> bool {
    let streams = self.inner.streams.lock().unwrap();
    let Some(entry) = streams.get(key) else {
      return false;
    };
    !entry.subscribers.is_empty()
      && entry
        .subscribers
        .values()
        .all(|subscriber| subscriber.paused.load(Ordering::Acquire))
  }

  /// Update one subscriber's local pause contract and return whether all
  /// subscribers are now paused. The aggregate is an optimization only; the
  /// subscriber flag itself remains local and is never broadcast as device
  /// state.
  pub fn set_subscriber_paused(
    &self,
    key: &StreamKey,
    subscription_id: u64,
    paused: bool,
  ) -> Result<bool, StreamError> {
    let streams = self.inner.streams.lock().unwrap();
    let entry = streams.get(key).ok_or(StreamError::MissingStream)?;
    let subscriber = entry
      .subscribers
      .get(&subscription_id)
      .ok_or(StreamError::MissingStream)?;
    subscriber.paused.store(paused, Ordering::Release);
    Ok(
      !entry.subscribers.is_empty()
        && entry
          .subscribers
          .values()
          .all(|subscriber| subscriber.paused.load(Ordering::Acquire)),
    )
  }

  pub fn set_subscriber_delivery_policy(
    &self,
    key: &StreamKey,
    subscription_id: u64,
    delivery_policy: StreamDeliveryPolicy,
  ) -> Result<StreamDeliveryPolicy, StreamError> {
    let streams = self.inner.streams.lock().unwrap();
    let entry = streams.get(key).ok_or(StreamError::MissingStream)?;
    let subscriber = entry
      .subscribers
      .get(&subscription_id)
      .ok_or(StreamError::MissingStream)?;
    subscriber
      .delivery_policy
      .store(delivery_policy_to_u8(delivery_policy), Ordering::Release);
    Ok(delivery_policy)
  }

  pub fn metrics(&self, key: &StreamKey) -> Option<StreamMetrics> {
    self
      .inner
      .streams
      .lock()
      .unwrap()
      .get(key)
      .map(|entry| StreamMetrics {
        subscriber_count: entry.subscribers.len(),
        accepted_frames: entry.accepted_frames,
        sequence: entry.sequence,
        stream_epoch: entry.stream_epoch,
        options_revision: entry.options_revision,
      })
  }

  pub fn metrics_snapshot(&self) -> Vec<StreamMetricsSnapshot> {
    self
      .inner
      .streams
      .lock()
      .unwrap()
      .iter()
      .map(|(key, entry)| StreamMetricsSnapshot {
        key: key.clone(),
        subscriber_count: entry.subscribers.len(),
        accepted_frames: entry.accepted_frames,
        sequence: entry.sequence,
        stream_epoch: entry.stream_epoch,
        options_revision: entry.options_revision,
      })
      .collect()
  }

  pub fn has_stream(&self, key: &StreamKey) -> bool {
    self.inner.streams.lock().unwrap().contains_key(key)
  }

  pub fn set_tx_payload(
    &self,
    key: StreamKey,
    center_frequency_hz: u64,
    sample_rate_hz: u32,
    iq_data: Vec<u8>,
  ) {
    self.inner.tx_payloads.lock().unwrap().insert(
      key,
      TxStreamPayload {
        center_frequency_hz,
        sample_rate_hz,
        iq_data: Arc::new(iq_data),
      },
    );
  }

  pub fn tx_payload(&self, key: &StreamKey) -> Option<TxStreamPayload> {
    self.inner.tx_payloads.lock().unwrap().get(key).cloned()
  }

  pub fn clear_tx_payload(&self, key: &StreamKey) {
    self.inner.tx_payloads.lock().unwrap().remove(key);
  }

  pub fn update_options(
    &self,
    key: &StreamKey,
    options: StreamOptions,
  ) -> Result<(u64, u64), StreamError> {
    if options.mode() != key.mode {
      return Err(StreamError::InvalidOptions);
    }
    self.validate_capability(key)?;
    let mut streams = self.inner.streams.lock().unwrap();
    let entry = streams.get_mut(key).ok_or(StreamError::MissingStream)?;
    if entry.options == options {
      return Ok((entry.stream_epoch, entry.options_revision));
    }
    entry.options = options.clone();
    entry.options_revision += 1;
    entry.stream_epoch = self.next_epoch();
    entry.sequence = 0;
    let epoch = entry.stream_epoch;
    let revision = entry.options_revision;
    let _ = entry.sender.send(StreamEvent::OptionsApplied {
      key: key.clone(),
      stream_epoch: epoch,
      options_revision: revision,
      options,
    });
    Ok((epoch, revision))
  }

  fn unsubscribe(&self, key: &StreamKey, subscription_id: u64) {
    let mut streams = self.inner.streams.lock().unwrap();
    let Some(entry) = streams.get_mut(key) else {
      return;
    };
    if entry.subscribers.remove(&subscription_id).is_none() {
      return;
    }
    entry.close_generation = entry.close_generation.wrapping_add(1);
    if !entry.subscribers.is_empty() {
      return;
    }

    let close_generation = entry.close_generation;
    let delay = self.inner.no_subscriber_grace;
    let weak = Arc::downgrade(&self.inner);
    let key = key.clone();
    log::debug!(
      "stream subscriber {} released {:?}; scheduling close in {:?}",
      subscription_id,
      key,
      delay
    );
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
      handle.spawn(async move {
        tokio::time::sleep(delay).await;
        let Some(inner) = weak.upgrade() else {
          return;
        };
        let mut streams = inner.streams.lock().unwrap();
        let should_remove = streams.get(&key).is_some_and(|entry| {
          entry.subscribers.is_empty()
            && entry.close_generation == close_generation
        });
        if should_remove {
          streams.remove(&key);
        }
      });
    }
  }
}

impl StreamSubscription {
  pub fn subscription_id(&self) -> u64 {
    self.subscription_id
  }

  pub async fn recv(
    &mut self,
  ) -> Result<StreamEvent, broadcast::error::RecvError> {
    loop {
      let event = if let Some(pending) = self.pending_event.take() {
        pending
      } else {
        match self.receiver.recv().await {
          Ok(event) => event,
          Err(broadcast::error::RecvError::Lagged(_))
            if delivery_policy_from_u8(self.delivery_policy.load(Ordering::Acquire))
              == StreamDeliveryPolicy::Latest => continue,
          Err(error) => return Err(error),
        }
      };
      if self.paused.load(Ordering::Acquire)
        && matches!(&event, StreamEvent::Frame(_))
      {
        continue;
      }

      if delivery_policy_from_u8(self.delivery_policy.load(Ordering::Acquire))
        == StreamDeliveryPolicy::Latest
        && matches!(&event, StreamEvent::Frame(_))
      {
        let mut latest = event;
        loop {
          match self.receiver.try_recv() {
            Ok(next @ StreamEvent::Frame(_)) => {
              if !self.paused.load(Ordering::Acquire) {
                latest = next;
              }
            }
            Ok(control) => {
              self.pending_event = Some(control);
              break;
            }
            Err(broadcast::error::TryRecvError::Empty) => break,
            // A latest-only consumer is explicitly allowed to drop stale
            // frames. Keep draining until the next control event.
            Err(broadcast::error::TryRecvError::Lagged(_)) => continue,
            Err(broadcast::error::TryRecvError::Closed) => break,
          }
        }
        return Ok(latest);
      }
      return Ok(event);
    }
  }

  pub fn delivery_policy(&self) -> StreamDeliveryPolicy {
    delivery_policy_from_u8(self.delivery_policy.load(Ordering::Acquire))
  }

  pub fn set_delivery_policy(
    &self,
    delivery_policy: StreamDeliveryPolicy,
  ) -> Result<StreamDeliveryPolicy, StreamError> {
    let manager = self.manager.upgrade().ok_or(StreamError::MissingStream)?;
    let manager = StreamingSourceModeManager { inner: manager };
    manager.set_subscriber_delivery_policy(
      &self.key,
      self.subscription_id,
      delivery_policy,
    )
  }

  pub fn set_paused(&self, paused: bool) -> Result<bool, StreamError> {
    let manager = self.manager.upgrade().ok_or(StreamError::MissingStream)?;
    let manager = StreamingSourceModeManager { inner: manager };
    manager.set_subscriber_paused(&self.key, self.subscription_id, paused)
  }

  pub fn update_options(
    &mut self,
    options: StreamOptions,
  ) -> Result<(), StreamError> {
    let manager = self.manager.upgrade().ok_or(StreamError::MissingStream)?;
    let manager = StreamingSourceModeManager { inner: manager };
    manager.update_options(&self.key, options).map(|_| ())
  }

  pub fn unsubscribe(&self) {
    if !self.active.swap(false, Ordering::AcqRel) {
      return;
    }
    if let Some(inner) = self.manager.upgrade() {
      StreamingSourceModeManager { inner }
        .unsubscribe(&self.key, self.subscription_id);
    }
  }
}

impl Drop for StreamSubscription {
  fn drop(&mut self) {
    self.unsubscribe();
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::server::stream_contract::{
    stream_control_scope, StreamControlAction, StreamControlScope,
  };

  fn rx_options() -> StreamOptions {
    StreamOptions::Rx(RxStreamOptions {
      center_frequency_hz: 100_000_000,
      sample_rate_hz: 2_400_000,
      fft_size: 1024,
      fft_window: None,
      frame_rate: None,
      gain: None,
    })
  }

  fn tx_options() -> StreamOptions {
    StreamOptions::Tx(TxStreamOptions {
      center_frequency_hz: 100_000_000,
      sample_rate_hz: 2_400_000,
      bandwidth_hz: 2_400_000,
      signal: "wifi".to_string(),
      power_dbm: -18.0,
      ifft_size: 1024,
    })
  }

  fn half_duplex_manager() -> StreamingSourceModeManager {
    let manager = StreamingSourceModeManager::new(Duration::from_millis(10));
    manager.register_source(
      "hackrf_one-00000001",
      SourceStreamCapabilities {
        can_receive: true,
        can_transmit: true,
        full_duplex: false,
      },
    );
    manager
  }

  #[test]
  fn half_duplex_tx_subscribe_succeeds_without_rx_stream() {
    let manager = half_duplex_manager();
    let key = StreamKey::new("hackrf_one-00000001", StreamMode::Tx);

    // The frontend releases the Rx stream before requesting a Tx preview;
    // the Tx subscription must therefore be accepted.
    let subscription = manager.subscribe(key.clone(), tx_options()).expect(
      "half-duplex Tx subscribe must succeed when no Rx stream is held",
    );
    assert!(manager.has_stream(&key));
    subscription.unsubscribe();
  }

  #[test]
  fn half_duplex_tx_subscribe_is_rejected_while_rx_stream_is_held() {
    let manager = half_duplex_manager();
    let rx_key = StreamKey::new("hackrf_one-00000001", StreamMode::Rx);
    let tx_key = StreamKey::new("hackrf_one-00000001", StreamMode::Tx);

    let rx_subscription = manager
      .subscribe(rx_key.clone(), rx_options())
      .unwrap();
    let error = match manager.subscribe(tx_key.clone(), tx_options()) {
      Err(error) => error,
      Ok(_) => panic!("half-duplex Tx subscribe must be rejected while Rx is held"),
    };
    assert!(matches!(error, StreamError::Arbitration(_)));

    // Releasing the Rx stream unblocks the Tx subscribe. The removal runs on
    // the grace timer, so this needs a runtime.
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
      rx_subscription.unsubscribe();
      tokio::time::sleep(Duration::from_millis(30)).await;
      manager
        .subscribe(tx_key.clone(), tx_options())
        .expect("releasing the half-duplex Rx stream must unblock the Tx subscribe");
    });
    assert!(manager.has_stream(&tx_key));
  }

  #[test]
  fn full_duplex_source_can_hold_rx_and_tx_streams() {
    let manager = StreamingSourceModeManager::new(Duration::from_millis(10));
    manager.register_source(
      "mock-tx",
      SourceStreamCapabilities {
        can_receive: true,
        can_transmit: true,
        full_duplex: true,
      },
    );
    let rx_key = StreamKey::new("mock-tx", StreamMode::Rx);
    let tx_key = StreamKey::new("mock-tx", StreamMode::Tx);

    let _rx = manager.subscribe(rx_key, rx_options()).unwrap();
    manager.subscribe(tx_key, tx_options()).expect(
      "full-duplex sources may hold both streams simultaneously",
    );
  }

  #[test]
  fn metrics_snapshot_exposes_live_subscriber_delivery_state() {
    let manager = StreamingSourceModeManager::new(Duration::from_millis(10));
    let key = StreamKey::new("mock-apt", StreamMode::Rx);
    let subscription = manager.subscribe(key.clone(), rx_options()).unwrap();

    manager
      .publish_iq_frame(&key, 123, 2_400_000, Arc::new(vec![1, 2, 3]))
      .expect("published frame should be accepted by the active stream");

    let snapshot = manager.metrics_snapshot();
    assert_eq!(snapshot.len(), 1);
    assert_eq!(snapshot[0].key, key);
    assert_eq!(snapshot[0].subscriber_count, 1);
    assert_eq!(snapshot[0].accepted_frames, 1);

    subscription.unsubscribe();
  }

  #[test]
  fn late_subscriber_cannot_overwrite_device_owned_options() {
    let manager = StreamingSourceModeManager::new(Duration::from_millis(10));
    let key = StreamKey::new("mock-apt", StreamMode::Rx);
    let first = manager.subscribe(key.clone(), rx_options()).unwrap();
    let second_options = StreamOptions::Rx(RxStreamOptions {
      center_frequency_hz: 101_000_000,
      sample_rate_hz: 2_400_000,
      fft_size: 4096,
      fft_window: None,
      frame_rate: None,
      gain: None,
    });

    let second = manager.subscribe(key.clone(), second_options).unwrap();

    assert_eq!(manager.options(&key), Some(rx_options()));
    assert_eq!(manager.metrics(&key).unwrap().options_revision, 1);
    first.unsubscribe();
    second.unsubscribe();
  }

  #[tokio::test]
  async fn latest_subscriber_drains_frames_without_crossing_control_events() {
    let manager = StreamingSourceModeManager::new(Duration::from_millis(10));
    let key = StreamKey::new("mock-apt", StreamMode::Rx);
    let mut subscription = manager
      .subscribe_with_policy(
        key.clone(),
        rx_options(),
        StreamDeliveryPolicy::Latest,
      )
      .unwrap();

    for sequence in 1..=3 {
      manager
        .publish_iq_frame(&key, sequence as i64, 2_400_000, Arc::new(vec![sequence as u8]))
        .unwrap();
    }

    let latest = subscription.recv().await.unwrap();
    assert!(matches!(latest, StreamEvent::Frame(frame) if frame.sequence == 3));

    manager
      .update_options(&key, StreamOptions::Rx(RxStreamOptions {
        center_frequency_hz: 101_000_000,
        sample_rate_hz: 2_400_000,
        fft_size: 1024,
        fft_window: None,
        frame_rate: None,
        gain: None,
      }))
      .unwrap();
    manager
      .publish_iq_frame(&key, 4, 2_400_000, Arc::new(vec![4]))
      .unwrap();

    let frame_before_control = subscription.recv().await.unwrap();
    assert!(matches!(frame_before_control, StreamEvent::OptionsApplied { .. }));
    let frame_after_control = subscription.recv().await.unwrap();
    assert!(matches!(frame_after_control, StreamEvent::Frame(frame) if frame.sequence == 1));
  }

  #[tokio::test]
  async fn latest_subscriber_recovers_from_bounded_broadcast_lag() {
    let manager = StreamingSourceModeManager::new(Duration::from_millis(10));
    let key = StreamKey::new("mock-apt", StreamMode::Rx);
    let mut subscription = manager
      .subscribe_with_policy(key.clone(), rx_options(), StreamDeliveryPolicy::Latest)
      .unwrap();

    for sequence in 1..=64 {
      manager
        .publish_iq_frame(&key, sequence, 2_400_000, Arc::new(vec![sequence as u8]))
        .unwrap();
    }

    let latest = subscription.recv().await.unwrap();
    assert!(matches!(latest, StreamEvent::Frame(frame) if frame.sequence == 64));
  }

  #[test]
  fn stream_contract_scopes_rx_pause_and_device_controls() {
    assert_eq!(
      stream_control_scope(StreamMode::Rx, StreamControlAction::Pause),
      StreamControlScope::Subscriber
    );
    assert_eq!(
      stream_control_scope(StreamMode::Rx, StreamControlAction::Settings),
      StreamControlScope::Device
    );
    assert_eq!(
      stream_control_scope(StreamMode::Rx, StreamControlAction::Tune),
      StreamControlScope::Device
    );
  }

  #[test]
  fn stream_contract_scopes_tx_stop_and_settings_to_the_device() {
    assert_eq!(
      stream_control_scope(StreamMode::Tx, StreamControlAction::Stop),
      StreamControlScope::Device
    );
    assert_eq!(
      stream_control_scope(StreamMode::Tx, StreamControlAction::Pause),
      StreamControlScope::Device
    );
    assert_eq!(
      stream_control_scope(StreamMode::Tx, StreamControlAction::Settings),
      StreamControlScope::Device
    );
  }
}
