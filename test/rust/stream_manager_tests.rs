use std::sync::Arc;
use std::time::Duration;

use n_apt_backend::server::stream_manager::{
  RxStreamOptions, SourceStreamCapabilities, StreamEvent, StreamKey,
  StreamMode, StreamOptions, StreamingSourceModeManager, TxStreamOptions,
};

fn rx_options(center_frequency_hz: u64) -> StreamOptions {
  StreamOptions::Rx(RxStreamOptions {
    center_frequency_hz,
    sample_rate_hz: 2_400_000,
    fft_size: 1024,
    fft_window: Some("hann".to_string()),
    frame_rate: Some(60),
    gain: Some(20.0),
  })
}

fn tx_options() -> StreamOptions {
  StreamOptions::Tx(TxStreamOptions {
    center_frequency_hz: 100_000_000,
    sample_rate_hz: 2_400_000,
    bandwidth_hz: 1_000_000,
    view_center_hz: None,
    view_sample_rate_hz: None,
    signal: "wifi".to_string(),
    power_dbm: -18.0,
    ifft_size: 1024,
  })
}

#[tokio::test]
async fn one_source_mode_fans_identical_frames_to_multiple_subscribers() {
  let manager = StreamingSourceModeManager::new(Duration::from_millis(250));
  let key = StreamKey::new("source-a", StreamMode::Rx);
  let mut first = manager
    .subscribe(key.clone(), rx_options(100_000_000))
    .unwrap();
  let mut second = manager
    .subscribe(key.clone(), rx_options(100_000_000))
    .unwrap();

  let published = manager
    .publish_iq_frame(
      &key,
      42,
      2_400_000,
      Arc::from(vec![128_u8, 129, 127, 130]),
    )
    .unwrap();

  let first_event = first.recv().await.unwrap();
  let second_event = second.recv().await.unwrap();
  assert_eq!(first_event, second_event);
  assert_eq!(first_event, StreamEvent::Frame(published));
  assert_eq!(manager.metrics(&key).unwrap().subscriber_count, 2);
}

#[tokio::test]
async fn backend_pauses_only_when_all_subscribers_are_paused() {
  let manager = StreamingSourceModeManager::new(Duration::from_millis(250));
  let key = StreamKey::new("source-a", StreamMode::Rx);
  let first = manager
    .subscribe(key.clone(), rx_options(100_000_000))
    .unwrap();
  let second = manager
    .subscribe(key.clone(), rx_options(100_000_000))
    .unwrap();

  assert!(!manager.all_subscribers_paused(&key));
  assert!(!manager
    .set_subscriber_paused(&key, first.subscription_id(), true)
    .unwrap());
  assert!(!manager.all_subscribers_paused(&key));

  assert!(manager
    .set_subscriber_paused(&key, second.subscription_id(), true)
    .unwrap());
  assert!(manager.all_subscribers_paused(&key));

  assert!(!manager
    .set_subscriber_paused(&key, first.subscription_id(), false)
    .unwrap());
  assert!(!manager.all_subscribers_paused(&key));
}

#[tokio::test]
async fn paused_subscribers_are_drained_without_receiving_frames() {
  let manager = StreamingSourceModeManager::new(Duration::from_millis(250));
  let key = StreamKey::new("source-a", StreamMode::Rx);
  let mut paused = manager
    .subscribe(key.clone(), rx_options(100_000_000))
    .unwrap();
  let mut active = manager
    .subscribe(key.clone(), rx_options(100_000_000))
    .unwrap();

  manager
    .set_subscriber_paused(&key, paused.subscription_id(), true)
    .unwrap();
  manager
    .publish_iq_frame(&key, 42, 2_400_000, Arc::from(vec![128_u8, 129]))
    .unwrap();

  assert!(matches!(
    active.recv().await.unwrap(),
    StreamEvent::Frame(_)
  ));
  assert!(
    tokio::time::timeout(Duration::from_millis(20), paused.recv())
      .await
      .is_err()
  );
}

#[tokio::test]
async fn option_updates_are_shared_and_advance_the_revision() {
  let manager = StreamingSourceModeManager::new(Duration::from_millis(250));
  let key = StreamKey::new("source-a", StreamMode::Rx);
  let mut first = manager
    .subscribe(key.clone(), rx_options(100_000_000))
    .unwrap();
  let mut second = manager
    .subscribe(key.clone(), rx_options(100_000_000))
    .unwrap();

  first.update_options(rx_options(101_000_000)).unwrap();

  let first_event = first.recv().await.unwrap();
  let second_event = second.recv().await.unwrap();
  assert_eq!(first_event, second_event);
  assert!(matches!(
    first_event,
    StreamEvent::OptionsApplied {
      options_revision: 2,
      ..
    }
  ));
  assert_eq!(manager.options(&key).unwrap(), rx_options(101_000_000));
}

#[tokio::test]
async fn source_and_mode_keys_have_independent_streams() {
  let manager = StreamingSourceModeManager::new(Duration::from_millis(250));
  let source_a_rx = StreamKey::new("source-a", StreamMode::Rx);
  let source_b_rx = StreamKey::new("source-b", StreamMode::Rx);
  let source_a_tx = StreamKey::new("source-a", StreamMode::Tx);
  let mut rx_a = manager
    .subscribe(source_a_rx.clone(), rx_options(100_000_000))
    .unwrap();
  let mut rx_b = manager
    .subscribe(source_b_rx.clone(), rx_options(200_000_000))
    .unwrap();
  let mut tx_a = manager
    .subscribe(source_a_tx.clone(), tx_options())
    .unwrap();

  manager
    .publish_iq_frame(&source_a_rx, 1, 2_400_000, Arc::from(vec![1_u8, 2]))
    .unwrap();
  manager
    .publish_iq_frame(&source_b_rx, 1, 2_400_000, Arc::from(vec![3_u8, 4]))
    .unwrap();
  manager
    .publish_iq_frame(&source_a_tx, 1, 2_400_000, Arc::from(vec![5_u8, 6]))
    .unwrap();

  assert!(
    matches!(rx_a.recv().await.unwrap(), StreamEvent::Frame(frame) if frame.key == source_a_rx)
  );
  assert!(
    matches!(rx_b.recv().await.unwrap(), StreamEvent::Frame(frame) if frame.key == source_b_rx)
  );
  assert!(
    matches!(tx_a.recv().await.unwrap(), StreamEvent::Frame(frame) if frame.key == source_a_tx)
  );
}

#[tokio::test]
async fn tx_subscribers_receive_the_same_generated_payload() {
  let manager = StreamingSourceModeManager::new(Duration::from_millis(250));
  let key = StreamKey::new("hackrf_one-test", StreamMode::Tx);
  let mut monitor = manager.subscribe(key.clone(), tx_options()).unwrap();
  let mut recorder = manager.subscribe(key.clone(), tx_options()).unwrap();
  let payload: Arc<Vec<u8>> = Arc::from(vec![128_u8, 129, 127, 130]);

  let published = manager
    .publish_iq_frame(&key, 42, 2_000_000, payload.clone())
    .unwrap();
  let monitor_event = monitor.recv().await.unwrap();
  let recorder_event = recorder.recv().await.unwrap();

  assert_eq!(monitor_event, recorder_event);
  assert_eq!(monitor_event, StreamEvent::Frame(published));
  assert!(
    matches!(monitor_event, StreamEvent::Frame(frame) if frame.iq_data == payload)
  );
}

#[tokio::test]
async fn half_duplex_sources_arbitrate_rx_and_tx_modes() {
  let manager = StreamingSourceModeManager::new(Duration::from_millis(250));
  manager.register_source(
    "half-duplex",
    SourceStreamCapabilities {
      can_receive: true,
      can_transmit: true,
      full_duplex: false,
    },
  );

  let rx = StreamKey::new("half-duplex", StreamMode::Rx);
  let tx = StreamKey::new("half-duplex", StreamMode::Tx);
  let _rx_subscription =
    manager.subscribe(rx, rx_options(100_000_000)).unwrap();
  let error = manager
    .subscribe(tx, tx_options())
    .err()
    .expect("half-duplex TX should be arbitrated while RX is active");

  assert_eq!(error.code(), "arbitration");
}

#[tokio::test]
async fn last_unsubscribe_closes_stream_after_grace_period() {
  let manager = StreamingSourceModeManager::new(Duration::from_millis(10));
  let key = StreamKey::new("source-a", StreamMode::Rx);
  let subscription = manager
    .subscribe(key.clone(), rx_options(100_000_000))
    .unwrap();
  subscription.unsubscribe();

  assert!(manager.has_stream(&key));
  tokio::time::sleep(Duration::from_millis(30)).await;
  assert!(!manager.has_stream(&key));
}
