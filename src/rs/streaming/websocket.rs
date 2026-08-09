//! Client-facing status/event transport boundary.

use tokio::sync::broadcast;

#[derive(Clone)]
pub struct WebSocketEventBus<T: Clone> {
  sender: broadcast::Sender<T>,
}

impl<T: Clone> WebSocketEventBus<T> {
  pub fn new(capacity: usize) -> Self {
    assert!(capacity > 0, "WebSocket event capacity must be positive");
    let (sender, _) = broadcast::channel(capacity);
    Self { sender }
  }

  pub fn publish(
    &self,
    event: T,
  ) -> Result<usize, broadcast::error::SendError<T>> {
    self.sender.send(event)
  }

  pub fn subscribe(&self) -> broadcast::Receiver<T> {
    self.sender.subscribe()
  }
}
