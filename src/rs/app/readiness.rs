#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadinessState {
  Starting,
  HttpReady,
  HardwareLoading,
  HardwareReady,
  Degraded,
  ShuttingDown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadinessEvent {
  HttpBound,
  HardwareInitializationStarted,
  HardwareReady,
  HardwareFailed,
  Shutdown,
}

impl ReadinessState {
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Starting => "starting",
      Self::HttpReady => "http_ready",
      Self::HardwareLoading => "hardware_loading",
      Self::HardwareReady => "hardware_ready",
      Self::Degraded => "degraded",
      Self::ShuttingDown => "shutting_down",
    }
  }

  pub fn from_u8(value: u8) -> Self {
    match value {
      1 => Self::HttpReady,
      2 => Self::HardwareLoading,
      3 => Self::HardwareReady,
      4 => Self::Degraded,
      5 => Self::ShuttingDown,
      _ => Self::Starting,
    }
  }

  pub fn transition(self, event: ReadinessEvent) -> Self {
    match event {
      ReadinessEvent::HttpBound => match self {
        Self::Starting => Self::HttpReady,
        state => state,
      },
      ReadinessEvent::HardwareInitializationStarted => match self {
        Self::Starting | Self::HttpReady => Self::HardwareLoading,
        state => state,
      },
      ReadinessEvent::HardwareReady => match self {
        Self::Starting | Self::HttpReady | Self::HardwareLoading => {
          Self::HardwareReady
        }
        state => state,
      },
      ReadinessEvent::HardwareFailed => match self {
        Self::Starting
        | Self::HttpReady
        | Self::HardwareLoading
        | Self::HardwareReady => Self::Degraded,
        state => state,
      },
      ReadinessEvent::Shutdown => Self::ShuttingDown,
    }
  }

  pub fn is_http_ready(self) -> bool {
    !matches!(self, Self::Starting | Self::ShuttingDown)
  }

  pub fn is_hardware_ready(self) -> bool {
    matches!(self, Self::HardwareReady)
  }

  pub fn is_degraded(self) -> bool {
    matches!(self, Self::Degraded)
  }
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(serde::Serialize)]
pub struct ReadinessResponse {
  pub state: &'static str,
  pub http_ready: bool,
  pub hardware_ready: bool,
  pub degraded: bool,
  pub redis_state: &'static str,
  pub redis_ready: bool,
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn handler(
  axum::extract::State(state): axum::extract::State<
    std::sync::Arc<crate::server::AppState>,
  >,
) -> axum::Json<ReadinessResponse> {
  let readiness = state.shared.readiness_state();
  let redis = state.shared.redis_readiness();
  axum::Json(ReadinessResponse {
    state: readiness.as_str(),
    http_ready: readiness.is_http_ready(),
    hardware_ready: readiness.is_hardware_ready(),
    degraded: readiness.is_degraded(),
    redis_state: redis.as_str(),
    redis_ready: redis.is_ready(),
  })
}

#[cfg(test)]
mod tests {
  use super::{ReadinessEvent, ReadinessState};

  #[test]
  fn http_readiness_precedes_hardware_readiness() {
    let state = ReadinessState::Starting
      .transition(ReadinessEvent::HttpBound)
      .transition(ReadinessEvent::HardwareInitializationStarted);

    assert!(state.is_http_ready());
    assert!(!state.is_hardware_ready());

    let state = state.transition(ReadinessEvent::HardwareReady);
    assert!(state.is_http_ready());
    assert!(state.is_hardware_ready());
  }

  #[test]
  fn hardware_failure_keeps_http_ready_and_enters_degraded_state() {
    let state = ReadinessState::Starting
      .transition(ReadinessEvent::HttpBound)
      .transition(ReadinessEvent::HardwareInitializationStarted)
      .transition(ReadinessEvent::HardwareFailed);

    assert!(state.is_http_ready());
    assert!(!state.is_hardware_ready());
    assert!(state.is_degraded());
  }
}
