//! Property tests for the subscriber-streaming manager: per-source fan-out,
//! local (subscriber) state isolation from device state, device-global options,
//! grace-drop lifecycle, and lag behavior.

use std::sync::Arc;
use std::time::Duration;

use n_apt_backend::server::stream_contract::StreamDeliveryPolicy;
use n_apt_backend::server::stream_manager::{
  RxStreamOptions, SourceStreamCapabilities, StreamEvent, StreamKey, StreamMode,
  StreamOptions, StreamSubscription, StreamingSourceModeManager,
};
use proptest::prelude::*;

fn rx_options(center: u64) -> StreamOptions {
  StreamOptions::Rx(RxStreamOptions {
    center_frequency_hz: center,
    sample_rate_hz: 2_400_000,
    fft_size: 1024,
    fft_window: None,
    frame_rate: None,
    gain: None,
  })
}

fn new_manager() -> StreamingSourceModeManager {
  let manager = StreamingSourceModeManager::new(Duration::from_millis(10));
  manager.register_source(
    "src",
    SourceStreamCapabilities {
      can_receive: true,
      can_transmit: true,
      full_duplex: true,
    },
  );
  manager
}

/// Drain every already-buffered Frame sequence from a subscription by calling
/// `recv()` with a tiny timeout. Frames published synchronously ahead of time
/// sit in the broadcast buffer, so `recv()` returns them immediately; the
/// timeout only guards an empty/blocking queue (e.g. a paused subscriber).
fn drain_sequences(sub: &mut StreamSubscription) -> Vec<u64> {
  let runtime = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
  runtime.block_on(async {
    let mut out = Vec::new();
    loop {
      match tokio::time::timeout(Duration::from_millis(5), sub.recv()).await {
        Ok(Ok(StreamEvent::Frame(frame))) => out.push(frame.sequence),
        Ok(Ok(_)) => {}
        Ok(Err(_)) | Err(_) => break,
      }
    }
    out
  })
}

proptest! {
  #![proptest_config(ProptestConfig::with_cases(24))]

  #[test]
  fn lossless_subscribers_receive_every_published_frame_in_order(
    frame_count in 0usize..30,
  ) {
    let manager = new_manager();
    let key = StreamKey::new("src", StreamMode::Rx);
    let mut a = manager
      .subscribe_with_policy(key.clone(), rx_options(100_000_000), StreamDeliveryPolicy::Lossless)
      .unwrap();
    let mut b = manager
      .subscribe_with_policy(key.clone(), rx_options(100_000_000), StreamDeliveryPolicy::Lossless)
      .unwrap();

    for seq in 1..=frame_count {
      manager
        .publish_iq_frame(&key, seq as i64, 2_400_000, Arc::new(vec![seq as u8]))
        .unwrap();
    }
    let a_seq = drain_sequences(&mut a);
    let b_seq = drain_sequences(&mut b);
    let expected: Vec<u64> = (1..=frame_count as u64).collect();
    assert_eq!(a_seq, expected, "subscriber A lost frames: {a_seq:?}");
    assert_eq!(b_seq, expected, "subscriber B lost frames: {b_seq:?}");
    a.unsubscribe();
    b.unsubscribe();
  }

  #[test]
  fn paused_subscriber_receives_no_frames_while_others_still_do(
    frame_count in 1usize..25,
  ) {
    let manager = new_manager();
    let key = StreamKey::new("src", StreamMode::Rx);
    let mut silent = manager.subscribe(key.clone(), rx_options(100_000_000)).unwrap();
    let mut hearing = manager.subscribe(key.clone(), rx_options(100_000_000)).unwrap();
    silent.set_paused(true).unwrap();

    for seq in 1..=frame_count {
      manager
        .publish_iq_frame(&key, seq as i64, 2_400_000, Arc::new(vec![]))
        .unwrap();
    }
    let silent_seq = drain_sequences(&mut silent);
    let hearing_seq = drain_sequences(&mut hearing);
    assert!(silent_seq.is_empty(), "paused subscriber must not receive frames");
    assert_eq!(hearing_seq.len(), frame_count, "unpaused subscriber must receive all");
    silent.unsubscribe();
    hearing.unsubscribe();
  }

  #[test]
  fn device_options_updates_are_global_and_monotone(updates in 0usize..12) {
    let manager = new_manager();
    let key = StreamKey::new("src", StreamMode::Rx);
    let sub = manager.subscribe(key.clone(), rx_options(100_000_000)).unwrap();
    let mut last_revision = 1u64;
    for i in 1..=updates {
      let center = 100_000_000u64 + (i as u64) * 1_000_000;
      let (_, revision, _) = manager.update_options(&key, rx_options(center)).unwrap();
      assert!(revision > last_revision, "options revision must be strictly monotone");
      last_revision = revision;
    }
    assert_eq!(
      manager.options(&key).unwrap(),
      rx_options(100_000_000 + updates as u64 * 1_000_000)
    );
    sub.unsubscribe();
  }

  #[test]
  fn late_subscriber_does_not_overwrite_device_options(seed in 0u32..5) {
    let manager = new_manager();
    let key = StreamKey::new("src", StreamMode::Rx);
    let first = manager.subscribe(key.clone(), rx_options(100_000_000)).unwrap();
    // A late subscriber asks for a different center; device options must hold.
    let _second = manager.subscribe(key.clone(), rx_options(200_000_000)).unwrap();
    assert_eq!(manager.options(&key).unwrap(), rx_options(100_000_000));
    first.unsubscribe();
    let _ = seed;
  }

  #[test]
  fn all_subscribers_paused_tracks_unanimity(subscribers in 1usize..6) {
    let manager = new_manager();
    let key = StreamKey::new("src", StreamMode::Rx);
    let mut subs = Vec::new();
    for _ in 0..subscribers {
      subs.push(manager.subscribe(key.clone(), rx_options(100_000_000)).unwrap());
    }
    assert!(!manager.all_subscribers_paused(&key), "no subscriber paused yet");
    for (i, sub) in subs.iter().enumerate() {
      sub.set_paused(true).unwrap();
      let expect_all = i == subscribers - 1;
      assert_eq!(
        manager.all_subscribers_paused(&key),
        expect_all,
        "only the last pause makes the aggregate true"
      );
    }
    for sub in &subs {
      sub.unsubscribe();
    }
  }
}
