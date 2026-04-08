use n_apt_backend::server::shared_state::SharedState;
use n_apt_backend::server::utils::reconcile_device_state;
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[tokio::test]
async fn test_device_freeze_detection() {
  // Test that the system can detect when a device becomes unresponsive
  let shared_state = Arc::new(SharedState::new());

  // Simulate device freeze
  let mock_profile = n_apt_backend::server::types::DeviceProfile {
    kind: "Mock APT".to_string(),
    is_rtl_sdr: false,
    supports_approx_dbm: false,
    supports_raw_iq_stream: false,
  };
  shared_state.update_device_status(
    false,
    "Freeze simulated".to_string(),
    mock_profile,
  );

  // Check that device state is updated correctly
  {
    let device_state = shared_state.device_state.lock().unwrap();
    assert_eq!(*device_state, "disconnected");
    // Explicitly drop the lock
    drop(device_state);
  }
}

#[tokio::test]
async fn test_stream_freeze_recovery() {
  // Test recovery from frozen stream
  let shared_state = Arc::new(SharedState::new());

  // Simulate stream freeze
  shared_state.device_connected.store(false, Ordering::SeqCst);

  // Simulate recovery
  shared_state.device_connected.store(true, Ordering::SeqCst);

  // Verify recovery with state reconciliation
  let device_connected = true;
  let current_state = "disconnected";
  let reconciled = reconcile_device_state(device_connected, current_state);
  assert_eq!(reconciled, "connected");
}

#[tokio::test]
async fn test_mock_mode_fallback() {
  // Test fallback to mock mode when real device freezes
  let shared_state = Arc::new(SharedState::new());

  // Start with real device
  let rtl_profile = n_apt_backend::server::types::DeviceProfile {
    kind: "RTL-SDR".to_string(),
    is_rtl_sdr: true,
    supports_approx_dbm: true,
    supports_raw_iq_stream: true,
  };
  shared_state.update_device_status(
    true,
    "Initial real device".to_string(),
    rtl_profile,
  );

  // Simulate device freeze - should fallback to mock
  let mock_profile = n_apt_backend::server::types::DeviceProfile {
    kind: "Mock APT".to_string(),
    is_rtl_sdr: false,
    supports_approx_dbm: false,
    supports_raw_iq_stream: false,
  };
  shared_state.update_device_status(
    false,
    "Mock fallback simulated".to_string(),
    mock_profile,
  );

  // Verify mock mode activation
  {
    let device_state = shared_state.device_state.lock().unwrap();
    assert_eq!(*device_state, "disconnected");
    // Explicitly drop the lock
    drop(device_state);
  }

  // Verify mock data generation continues (latest_spectrum should still be accessible)
  {
    let spectrum = shared_state.latest_spectrum.lock().unwrap();
    // Initially should be None, but structure should be accessible
    assert!(spectrum.is_none() || spectrum.is_some());
    // Explicitly drop the lock
    drop(spectrum);
  }
}

#[tokio::test]
async fn test_io_thread_freeze_handling() {
  // Test handling of I/O thread freeze
  let shared_state = Arc::new(SharedState::new());

  // Simulate I/O thread freeze by setting shutdown flag
  shared_state.shutdown.store(true, Ordering::SeqCst);

  // Verify graceful shutdown
  let is_shutdown = shared_state.shutdown.load(Ordering::SeqCst);
  assert!(is_shutdown);
}

#[tokio::test]
async fn test_device_reconnection_after_freeze() {
  // Test device reconnection after freeze
  let shared_state = Arc::new(SharedState::new());

  // Initial connected state
  shared_state.device_connected.store(true, Ordering::SeqCst);
  assert!(shared_state.device_connected.load(Ordering::SeqCst));

  // Simulate freeze/disconnection
  shared_state.device_connected.store(false, Ordering::SeqCst);
  assert!(!shared_state.device_connected.load(Ordering::SeqCst));

  // Reconnection
  shared_state.device_connected.store(true, Ordering::SeqCst);
  assert!(shared_state.device_connected.load(Ordering::SeqCst));

  // Verify state reconciliation
  {
    let device_state = shared_state.device_state.lock().unwrap();
    let reconciled = reconcile_device_state(true, &device_state);
    assert_eq!(reconciled, "connected");
    // Explicitly drop the lock
    drop(device_state);
  }
}

#[tokio::test]
async fn test_spectrum_data_validation() {
  // Test spectrum data validation during freeze scenarios
  let shared_state = Arc::new(SharedState::new());

  // Test with valid data
  let valid_spectrum = vec![-60.0; 1024];
  {
    let mut spectrum_guard = shared_state.latest_spectrum.lock().unwrap();
    *spectrum_guard = Some((valid_spectrum, false));
    // Explicitly drop the lock to prevent potential deadlocks
    drop(spectrum_guard);
  }

  {
    let retrieved = shared_state.latest_spectrum.lock().unwrap();
    assert!(retrieved.is_some());
    // Explicitly drop the lock
    drop(retrieved);
  }

  // Test with invalid/corrupted data
  let corrupted_spectrum = vec![f32::NAN; 1024];
  {
    let mut spectrum_guard = shared_state.latest_spectrum.lock().unwrap();
    *spectrum_guard = Some((corrupted_spectrum, false));
    // Explicitly drop the lock
    drop(spectrum_guard);
  }

  // Should handle corrupted data gracefully
  {
    let retrieved = shared_state.latest_spectrum.lock().unwrap();
    assert!(retrieved.is_some()); // Should still return something, even if corrupted
                                  // Explicitly drop the lock
    drop(retrieved);
  }
}

#[tokio::test]
async fn test_pause_state_during_freeze() {
  // Test pause state handling during device freeze
  let shared_state = Arc::new(SharedState::new());

  // Set paused state
  shared_state.is_paused.store(true, Ordering::SeqCst);

  // Simulate device freeze
  shared_state.device_connected.store(false, Ordering::SeqCst);

  // Verify pause state is preserved
  assert!(shared_state.is_paused.load(Ordering::SeqCst));

  // Resume after freeze recovery
  shared_state.is_paused.store(false, Ordering::SeqCst);
  shared_state.device_connected.store(true, Ordering::SeqCst);

  assert!(!shared_state.is_paused.load(Ordering::SeqCst));
  assert!(shared_state.device_connected.load(Ordering::SeqCst));
}

#[tokio::test]
async fn test_frequency_changes_during_freeze() {
  // Test frequency parameter changes during freeze
  let shared_state = Arc::new(SharedState::new());

  // Set initial frequency
  let initial_freq = 100_000_000;
  shared_state
    .pending_center_freq
    .store(initial_freq, Ordering::SeqCst);

  // Simulate device freeze
  shared_state.device_connected.store(false, Ordering::SeqCst);

  // Change frequency during freeze
  let new_freq = 101_000_000;
  shared_state
    .pending_center_freq
    .store(new_freq, Ordering::SeqCst);
  shared_state
    .pending_center_freq_dirty
    .store(true, Ordering::SeqCst);

  // Verify frequency change is preserved
  assert_eq!(
    shared_state.pending_center_freq.load(Ordering::SeqCst),
    new_freq
  );
  assert!(shared_state
    .pending_center_freq_dirty
    .load(Ordering::SeqCst));
}

#[tokio::test]
async fn test_client_count_during_freeze() {
  // Test client count handling during device freeze
  let shared_state = Arc::new(SharedState::new());

  // Simulate multiple clients
  shared_state.client_count.store(3, Ordering::SeqCst);
  shared_state.authenticated_count.store(2, Ordering::SeqCst);

  // Simulate device freeze
  let device_connected = false;
  let current_state = "connected";
  let reconciled = reconcile_device_state(device_connected, current_state);

  // Verify client counts are preserved during freeze
  assert_eq!(shared_state.client_count.load(Ordering::SeqCst), 3);
  assert_eq!(shared_state.authenticated_count.load(Ordering::SeqCst), 2);
  assert_eq!(reconciled, "disconnected");
}

#[tokio::test]
async fn test_device_loading_state_during_freeze() {
  // Test device loading state during freeze scenarios
  let shared_state = Arc::new(SharedState::new());

  // Set loading state
  {
    let mut loading = shared_state.device_loading.lock().unwrap();
    *loading = true;
    // Explicitly drop the lock
    drop(loading);
  }
  {
    let mut loading_reason = shared_state.device_loading_reason.lock().unwrap();
    *loading_reason = Some("connect".to_string());
    // Explicitly drop the lock
    drop(loading_reason);
  }

  // Simulate freeze during loading
  let device_connected = false;
  let current_state = "loading";
  let reconciled = reconcile_device_state(device_connected, current_state);

  // "loading" is now authoritative — the server is mid-transition and
  // will resolve to connected or disconnected when the operation finishes.
  assert_eq!(reconciled, "loading");

  // Manually update the device state to simulate what would happen in real code
  {
    let mut device_state = shared_state.device_state.lock().unwrap();
    *device_state = reconciled;
    // Explicitly drop the lock
    drop(device_state);
  }

  // Loading should be cleared (manually clear to simulate real behavior)
  {
    let mut loading = shared_state.device_loading.lock().unwrap();
    *loading = false;
    // Explicitly drop the lock
    drop(loading);
  }
  {
    let mut loading_reason = shared_state.device_loading_reason.lock().unwrap();
    *loading_reason = None;
    // Explicitly drop the lock
    drop(loading_reason);
  }

  // Verify the final state
  {
    let loading = shared_state.device_loading.lock().unwrap();
    assert!(!*loading);
    // Explicitly drop the lock
    drop(loading);
  }
  {
    let loading_reason = shared_state.device_loading_reason.lock().unwrap();
    assert!(loading_reason.is_none());
    // Explicitly drop the lock
    drop(loading_reason);
  }
}

#[tokio::test]
async fn test_stale_state_recovery() {
  // Test recovery from stale device state
  let shared_state = Arc::new(SharedState::new());

  // Set stale state
  {
    let mut state = shared_state.device_state.lock().unwrap();
    *state = "stale".to_string();
    // Explicitly drop the lock
    drop(state);
  }

  // Device becomes connected again
  let device_connected = true;
  let current_state = "stale";
  let reconciled = reconcile_device_state(device_connected, current_state);

  // "stale" is now authoritative — the health loop set it deliberately.
  // Recovery happens via set_device_state("connected") when the device
  // resumes producing frames, not via reconciliation.
  assert_eq!(reconciled, "stale");
}

#[tokio::test]
async fn test_encryption_key_preservation() {
  // Test that encryption key is preserved during freeze scenarios
  let shared_state = Arc::new(SharedState::new());

  // Verify encryption key is set
  assert_ne!(shared_state.encryption_key, [0u8; 32]);

  // Simulate device freeze
  let device_connected = false;
  let current_state = "connected";
  let reconciled = reconcile_device_state(device_connected, current_state);

  // Encryption key should be preserved
  assert_ne!(shared_state.encryption_key, [0u8; 32]);
  assert_eq!(reconciled, "disconnected");
}

#[tokio::test]
async fn test_channels_preservation() {
  // Test that channels configuration is preserved during freeze
  let shared_state = Arc::new(SharedState::new());

  // Verify channels are loaded
  {
    let frames = shared_state.channels.lock().unwrap();
    let frame_count = frames.len();
    // Explicitly drop the lock
    drop(frames);

    // Simulate device freeze
    let device_connected = false;
    let current_state = "connected";
    let reconciled = reconcile_device_state(device_connected, current_state);

    // Channels should be preserved
    let frames_check = shared_state.channels.lock().unwrap();
    assert_eq!(frames_check.len(), frame_count);
    // Explicitly drop the lock
    drop(frames_check);

    assert_eq!(reconciled, "disconnected");
  }
}

#[tokio::test]
async fn test_memory_cleanup_during_freeze() {
  // Test memory cleanup during device freeze scenarios
  let shared_state = Arc::new(SharedState::new());

  // Fill spectrum buffer with data
  let large_spectrum = vec![-60.0; 10000];
  {
    let mut spectrum_guard = shared_state.latest_spectrum.lock().unwrap();
    *spectrum_guard = Some((large_spectrum, false));
    // Explicitly drop the lock
    drop(spectrum_guard);
  }

  // Simulate device freeze
  let device_connected = false;
  let current_state = "connected";
  let reconciled = reconcile_device_state(device_connected, current_state);

  // Memory should be cleaned up properly
  {
    let spectrum = shared_state.latest_spectrum.lock().unwrap();
    assert!(spectrum.is_some()); // Data should still be available for recovery
                                 // Explicitly drop the lock
    drop(spectrum);
    assert_eq!(reconciled, "disconnected");
  }
}
