//! Ownership rules for controls around a shared source/mode stream.
//!
//! RX playback is local to a subscriber. RX tuning and settings alter the
//! shared device stream. TX is device-owned: stopping, starting, or changing
//! its settings affects the transmitter and therefore every subscriber.

use serde::{Deserialize, Serialize};

use super::stream_manager::StreamMode;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamControlScope {
  Subscriber,
  Device,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StreamControlAction {
  Pause,
  Stop,
  Settings,
  Tune,
}

pub fn stream_control_scope(
  mode: StreamMode,
  action: StreamControlAction,
) -> StreamControlScope {
  match (mode, action) {
    (StreamMode::Rx, StreamControlAction::Pause) => {
      StreamControlScope::Subscriber
    }
    (StreamMode::Rx, StreamControlAction::Stop)
    | (StreamMode::Rx, StreamControlAction::Settings)
    | (StreamMode::Rx, StreamControlAction::Tune)
    | (StreamMode::Tx, StreamControlAction::Pause)
    | (StreamMode::Tx, StreamControlAction::Stop)
    | (StreamMode::Tx, StreamControlAction::Settings)
    | (StreamMode::Tx, StreamControlAction::Tune) => {
      StreamControlScope::Device
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn scopes_are_serialized_for_protocol_diagnostics() {
    assert_eq!(
      serde_json::to_string(&StreamControlScope::Subscriber).unwrap(),
      "\"subscriber\""
    );
    assert_eq!(
      serde_json::to_string(&StreamControlScope::Device).unwrap(),
      "\"device\""
    );
  }
}
