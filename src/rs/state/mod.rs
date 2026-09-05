//! Typed application-state groups used by workers and handlers.
//!
//! `server::shared_state::SharedState` remains as a compatibility facade while
//! callers migrate. These groups make ownership explicit at the seam: device
//! lifecycle, source epochs, streaming flow, capture, and transmit safety do
//! not need to share one untyped state object.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8};
use std::sync::Arc;

use crate::app::readiness::ReadinessState;

#[derive(Clone)]
pub struct DeviceState {
  pub connected: Arc<AtomicBool>,
  pub loading: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct SourceState {
  pub active_source_epoch: Arc<AtomicU64>,
}

#[derive(Clone)]
pub struct StreamingState {
  pub paused: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct CaptureState {
  pub active: Arc<AtomicBool>,
  pub next_sample: Arc<AtomicU64>,
}

#[derive(Clone)]
pub struct TransmitState {
  pub enabled: Arc<AtomicBool>,
  pub safety_latched: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct ReadinessStateGroup {
  value: Arc<AtomicU8>,
}

impl ReadinessStateGroup {
  pub fn new() -> Self {
    Self {
      value: Arc::new(AtomicU8::new(ReadinessState::Starting as u8)),
    }
  }

  pub fn get(&self) -> ReadinessState {
    ReadinessState::from_u8(
      self.value.load(std::sync::atomic::Ordering::Acquire),
    )
  }

  pub fn set(&self, state: ReadinessState) {
    self
      .value
      .store(state as u8, std::sync::atomic::Ordering::Release);
  }
}

impl Default for ReadinessStateGroup {
  fn default() -> Self {
    Self::new()
  }
}

/// The typed state root. It is intentionally independent from HTTP/auth
/// state, which belongs to the application router rather than the SDR
/// runtime.
#[derive(Clone)]
pub struct AppState {
  pub device: DeviceState,
  pub sources: SourceState,
  pub streaming: StreamingState,
  pub capture: CaptureState,
  pub transmit: TransmitState,
  pub readiness: ReadinessStateGroup,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      device: DeviceState {
        connected: Arc::new(AtomicBool::new(false)),
        loading: Arc::new(AtomicBool::new(false)),
      },
      sources: SourceState {
        active_source_epoch: Arc::new(AtomicU64::new(0)),
      },
      streaming: StreamingState {
        paused: Arc::new(AtomicBool::new(false)),
      },
      capture: CaptureState {
        active: Arc::new(AtomicBool::new(false)),
        next_sample: Arc::new(AtomicU64::new(0)),
      },
      transmit: TransmitState {
        enabled: Arc::new(AtomicBool::new(false)),
        safety_latched: Arc::new(AtomicBool::new(true)),
      },
      readiness: ReadinessStateGroup::default(),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::AppState;
  use crate::app::readiness::ReadinessState;

  #[test]
  fn typed_state_starts_with_safe_defaults() {
    let state = AppState::default();

    assert!(!state
      .device
      .connected
      .load(std::sync::atomic::Ordering::Acquire));
    assert!(!state
      .transmit
      .enabled
      .load(std::sync::atomic::Ordering::Acquire));
    assert!(state
      .transmit
      .safety_latched
      .load(std::sync::atomic::Ordering::Acquire));
    assert_eq!(state.readiness.get(), ReadinessState::Starting);
  }
}
