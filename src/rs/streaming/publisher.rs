//! Latest-value publication for display-oriented consumers.

use std::sync::Arc;
use tokio::sync::watch;

#[derive(Clone)]
pub struct LatestFramePublisher<T> {
  sender: watch::Sender<Option<Arc<T>>>,
}

impl<T> LatestFramePublisher<T> {
  pub fn new() -> Self {
    let (sender, _) = watch::channel(None);
    Self { sender }
  }

  pub fn publish(&self, frame: T) {
    let _ = self.sender.send(Some(Arc::new(frame)));
  }

  pub fn subscribe(&self) -> watch::Receiver<Option<Arc<T>>> {
    self.sender.subscribe()
  }

  pub fn latest(&self) -> Option<Arc<T>> {
    self.sender.borrow().clone()
  }
}

impl<T> Default for LatestFramePublisher<T> {
  fn default() -> Self {
    Self::new()
  }
}

#[cfg(test)]
mod tests {
  use super::LatestFramePublisher;

  #[test]
  fn publisher_retains_only_the_latest_frame() {
    let publisher = LatestFramePublisher::new();
    let mut receiver = publisher.subscribe();

    publisher.publish(1_u64);
    publisher.publish(2_u64);

    assert_eq!(publisher.latest().as_deref(), Some(&2));
    assert!(receiver.has_changed().unwrap());
    assert_eq!(receiver.borrow_and_update().as_deref().map(|v| *v), Some(2));
  }
}
