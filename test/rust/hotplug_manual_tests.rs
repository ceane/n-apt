use n_apt_backend::sdr::hotplug::{
  scan_supported_usb_device_snapshots, scan_usb_device_snapshots, HotplugEvent,
  HotplugEventKind, HotplugMonitor, UsbDeviceSnapshot,
};
use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::sdr::{SdrDevice, SdrDeviceFactory};
use n_apt_backend::server::shared_state::SharedState;
use n_apt_backend::server::websocket_server::{
  broadcast_device_status, build_device_profile, build_source_info_snapshot,
  SourceLifecyclePhase,
};
use serial_test::serial;
use std::thread;
use std::time::{Duration, Instant};

fn open_supported_device(
  device_type: &str,
) -> Option<Box<dyn n_apt_backend::sdr::SdrDevice>> {
  if device_type == "hackrf_dfu" {
    eprintln!(
      "HackRF is in DFU mode, so the runtime SDR cannot be opened yet."
    );
    return None;
  }

  let mut opened = None;
  let mut last_err = None;

  for attempt in 1..=5 {
    let result = match device_type {
      "hackrf_one" => SdrDeviceFactory::create_hackrf_device(),
      _ => SdrDeviceFactory::create_rtlsdr_device(),
    };

    match result {
      Ok(device) => {
        opened = Some(device);
        break;
      }
      Err(e) => {
        last_err = Some(e);
        eprintln!(
          "Supported device open attempt {} of 5 failed; retrying",
          attempt
        );
        thread::sleep(Duration::from_millis(250));
      }
    }
  }

  if opened.is_none() {
    eprintln!(
      "Supported USB device is present, but open still failed: {}",
      last_err.expect("Expected a failure reason")
    );
  }

  opened
}

#[test]
#[serial]
fn hotplug_smoke_scan_reports_supported_device() {
  if std::env::var("RUN_HOTPLUG_MANUAL").is_err() {
    eprintln!(
      "Skipping manual hotplug smoke test. Set RUN_HOTPLUG_MANUAL=1 to run it."
    );
    return;
  }

  let monitor = HotplugMonitor::new().expect("hotplug monitor");
  monitor.start().expect("start hotplug monitor");

  eprintln!(
    "Hotplug watch running. Plug/unplug the SDR, then press Ctrl+C to stop."
  );
  let open_devices = std::env::var("RUN_HOTPLUG_OPEN").is_ok();
  let verbose_usb = std::env::var("RUN_HOTPLUG_VERBOSE").is_ok();
  if open_devices {
    eprintln!(
      "Open probe enabled: supported devices will be opened and cleaned up."
    );
  } else {
    eprintln!("Open probe disabled: observing USB only. Set RUN_HOTPLUG_OPEN=1 to open devices.");
  }
  if verbose_usb {
    eprintln!("Verbose USB snapshots enabled.");
  }

  let mut last_seen_devices = scan_supported_usb_device_snapshots()
    .expect("USB scan should not fail unexpectedly");
  report_supported_devices("Initial scan", &last_seen_devices, open_devices);
  if open_devices {
    if let Some(device_type) = last_seen_devices.first().map(|d| &d.device_type)
    {
      open_and_report(device_type);
    }
  }
  if verbose_usb && last_seen_devices.is_empty() {
    report_usb_snapshot("Initial USB snapshot");
  }

  let mut last_heartbeat = Instant::now();
  loop {
    while let Some(event) = monitor.try_recv() {
      let event_kind = match event.kind {
        HotplugEventKind::Attached => "attached",
        HotplugEventKind::Detached => "detached",
      };
      eprintln!(
        "USB event: {} for {}",
        event_kind,
        display_device_type(&event.device_type)
      );
      if verbose_usb {
        eprintln!("  {}", format_hotplug_event(&event));
      }
      let seen = scan_supported_usb_device_snapshots()
        .expect("USB scan should not fail unexpectedly");
      if seen != last_seen_devices {
        report_supported_devices("Reconciled", &seen, open_devices);
        if open_devices {
          if let Some(device_type) = seen.first().map(|d| &d.device_type) {
            open_and_report(device_type);
          }
        }
        last_seen_devices = seen;
      } else if verbose_usb && seen.is_empty() {
        report_usb_snapshot("USB snapshot after unknown event");
      }
    }

    let seen = scan_supported_usb_device_snapshots()
      .expect("USB scan should not fail unexpectedly");
    if seen != last_seen_devices {
      report_supported_devices("Polled", &seen, open_devices);
      if open_devices {
        if let Some(device_type) = seen.first().map(|d| &d.device_type) {
          open_and_report(device_type);
        }
      }
      last_seen_devices = seen;
    }

    if last_heartbeat.elapsed() >= Duration::from_secs(5) {
      report_supported_devices("Heartbeat", &last_seen_devices, false);
      if verbose_usb && last_seen_devices.is_empty() {
        report_usb_snapshot("Heartbeat USB snapshot");
      }
      last_heartbeat = Instant::now();
    }

    thread::sleep(Duration::from_millis(250));
  }
}

fn format_hotplug_event(event: &HotplugEvent) -> String {
  match (event.vendor_id, event.product_id) {
    (Some(vendor_id), Some(product_id)) => format!(
      "vid=0x{:04x} pid=0x{:04x} bus={} address={}",
      vendor_id, product_id, event.bus_number, event.address
    ),
    _ => format!(
      "descriptor unavailable bus={} address={}",
      event.bus_number, event.address
    ),
  }
}

fn report_usb_snapshot(label: &str) {
  match scan_usb_device_snapshots() {
    Ok(devices) if devices.is_empty() => {
      eprintln!("{}: libusb sees no USB devices", label);
    }
    Ok(devices) => {
      eprintln!("{}: libusb sees {} USB device(s)", label, devices.len());
      for device in devices {
        eprintln!("  {}", format_usb_snapshot(&device));
      }
    }
    Err(err) => {
      eprintln!("{}: failed to enumerate USB devices: {}", label, err);
    }
  }
}

fn format_usb_snapshot(device: &UsbDeviceSnapshot) -> String {
  format!(
    "{} vid=0x{:04x} pid=0x{:04x} bus={} address={}",
    device.device_type,
    device.vendor_id,
    device.product_id,
    device.bus_number,
    device.address
  )
}

fn open_and_report(device_type: &str) {
  match open_supported_device(device_type) {
    Some(mut device) => {
      eprintln!("Opened device type: {}", device.device_type());
      cleanup_device(device.as_mut());
    }
    None => {}
  }
}

fn cleanup_device(device: &mut dyn SdrDevice) {
  match device.cleanup() {
    Ok(()) => eprintln!("Cleaned up device handle"),
    Err(err) => eprintln!("Device cleanup failed: {}", err),
  }
}

#[test]
#[serial]
fn stateful_attached_devices_resume_after_repeated_standby_switches() {
  if std::env::var("RUN_HOTPLUG_STATEFUL").is_err() {
    eprintln!(
      "Skipping stateful hardware test. Set RUN_HOTPLUG_STATEFUL=1 to run it."
    );
    return;
  }

  let snapshots = scan_supported_usb_device_snapshots()
    .expect("supported USB scan should succeed");
  let mut device_types = snapshots
    .iter()
    .map(|snapshot| snapshot.device_type.as_str())
    .filter(|kind| *kind == "rtl-sdr" || *kind == "hackrf_one")
    .collect::<Vec<_>>();
  device_types.sort_unstable();
  device_types.dedup();
  assert!(
    device_types.len() >= 2,
    "expected RTL-SDR and HackRF One to be attached; found {device_types:?}"
  );

  let mut devices = device_types
    .into_iter()
    .map(|kind| {
      let mut device = open_supported_device(kind)
        .unwrap_or_else(|| panic!("failed to open attached {kind}"));
      device
        .initialize()
        .unwrap_or_else(|error| panic!("failed to initialize {kind}: {error}"));
      (kind.to_string(), device)
    })
    .collect::<Vec<_>>();

  for cycle in 0..4 {
    for (kind, device) in &mut devices {
      let samples = device.read_samples(4096).unwrap_or_else(|error| {
        panic!("{kind} did not stream in cycle {cycle}: {error}")
      });
      assert!(!samples.data.is_empty(), "{kind} returned an empty frame");
      device
        .enter_standby()
        .unwrap_or_else(|error| panic!("{kind} standby failed: {error}"));
      device
        .initialize()
        .unwrap_or_else(|error| panic!("{kind} warm resume failed: {error}"));
    }
  }

  for (_, device) in &mut devices {
    cleanup_device(device.as_mut());
  }
}

/// Exercises the same processor-level warm swap used by `SetActiveSource`.
/// This is intentionally opt-in because it opens both physical libusb devices.
#[test]
#[serial]
fn physical_processor_switches_between_rtl_and_hackrf_without_stale_rx() {
  if std::env::var("RUN_HOTPLUG_PROCESSOR_SWITCH").is_err() {
    eprintln!(
      "Skipping physical processor switch test. Set RUN_HOTPLUG_PROCESSOR_SWITCH=1 to run it."
    );
    return;
  }

  let snapshots = scan_supported_usb_device_snapshots()
    .expect("supported USB scan should succeed");
  assert!(snapshots
    .iter()
    .any(|device| device.device_type == "rtl-sdr"));
  assert!(snapshots
    .iter()
    .any(|device| device.device_type == "hackrf_one"));

  let rtl = open_supported_device("rtl-sdr").expect("open RTL-SDR");
  let mut hackrf =
    open_supported_device("hackrf_one").expect("open HackRF One");
  let mut processor =
    SdrProcessor::with_device(rtl).expect("create RTL processor");
  processor.initialize().expect("initialize RTL processor");

  for cycle in 0..3 {
    let rtl_frame =
      processor.read_and_process_frame().unwrap_or_else(|error| {
        panic!("RTL frame before switch {cycle}: {error}")
      });
    assert!(!rtl_frame.is_empty(), "RTL frame before switch was empty");

    let previous_rtl =
      processor
        .swap_device_keep_warm(hackrf)
        .unwrap_or_else(|error| {
          panic!("switch to HackRF in cycle {cycle}: {error}")
        });
    assert!(processor
      .device_type()
      .to_ascii_lowercase()
      .contains("hackrf"));
    let hackrf_frame = processor
      .read_and_process_frame()
      .unwrap_or_else(|error| panic!("HackRF frame in cycle {cycle}: {error}"));
    assert!(!hackrf_frame.is_empty(), "HackRF frame was empty");

    hackrf = processor
      .swap_device_keep_warm(previous_rtl)
      .unwrap_or_else(|error| {
        panic!("switch to RTL in cycle {cycle}: {error}")
      });
    assert!(processor.device_type().to_ascii_lowercase().contains("rtl"));
  }

  let mut active_rtl = processor
    .swap_device_keep_warm(hackrf)
    .expect("final switch to HackRF");
  cleanup_device(active_rtl.as_mut());
}

#[tokio::test]
#[serial]
async fn open_hardware_updates_app_source_state_through_loading_and_streaming()
{
  if std::env::var("RUN_OPEN_DEVICE_APP_STATE").is_err() {
    eprintln!(
      "Skipping open-device app-state test. Set RUN_OPEN_DEVICE_APP_STATE=1 to run it."
    );
    return;
  }
  std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");

  let snapshots = scan_supported_usb_device_snapshots()
    .expect("supported USB scan should succeed");
  let mut device_types = snapshots
    .iter()
    .map(|snapshot| snapshot.device_type.as_str())
    .filter(|kind| *kind == "rtl-sdr" || *kind == "hackrf_one")
    .collect::<Vec<_>>();
  device_types.sort_unstable();
  device_types.dedup();
  assert!(
    device_types.len() >= 2,
    "expected both SDR types: {device_types:?}"
  );

  let shared = SharedState::new("redis://127.0.0.1:6379");
  let (broadcast_tx, mut broadcast_rx) =
    tokio::sync::broadcast::channel::<String>(32);

  // Open the devices once at the beginning to initialize drivers and print connection details
  let mut devices = Vec::new();
  for kind in device_types {
    let device = open_supported_device(kind)
      .unwrap_or_else(|| panic!("failed to open attached {kind}"));
    devices.push((kind, device));
  }

  // 1. Verify Connected (USB) State: Prior to opening, check that they are present in the sources list as connected
  let initial_state = build_source_info_snapshot(&shared);
  let initial_sources =
    initial_state["sources"].as_array().expect("sources array");
  for (kind, _) in &devices {
    let is_present = initial_sources.iter().any(|source| {
      source["kind"] == **kind && source["status"] == "connected"
    });
    eprintln!("USB Device presence for {}: {}", kind, is_present);
    if is_present {
      eprintln!(
        "Source lifecycle status: {} for {}",
        SourceLifecyclePhase::Connected,
        kind
      );
    }
  }

  for (kind, mut device) in devices {
    // Prior to initialize, Rx should NOT be active
    assert!(
      !device.is_rx_active(),
      "Expected Rx active to be false before initialize"
    );

    device.initialize().expect("device initialize");

    // After initialize, Rx active should be true
    assert!(
      device.is_rx_active(),
      "Expected Rx active to be true for {} after initialize",
      kind
    );

    // 2. Transition and verify Loading State
    eprintln!(
      "Source lifecycle status: {} for {}",
      SourceLifecyclePhase::Loading,
      kind
    );
    shared.update_device_status(
      true,
      device.get_device_info(),
      build_device_profile(device.device_type()),
    );
    shared.update_device_usb_strings(
      device.get_serial_number(),
      device.get_manufacturer(),
      device.get_product(),
    );
    let source_id =
      n_apt_backend::server::websocket_server::active_source_id(&shared);
    shared.set_active_source_pause_state(&source_id, false);
    shared.set_device_state("loading", Some("connect"));

    // Broadcast loading state
    broadcast_device_status(&shared, &broadcast_tx);

    let loading = build_source_info_snapshot(&shared);
    assert_eq!(loading["active_source"], source_id);
    let loading_source = loading["sources"]
      .as_array()
      .unwrap()
      .iter()
      .find(|source| source["id"] == source_id)
      .expect("active loading source");
    assert_eq!(loading_source["status"], "loading");

    // Receive the broadcasted loading message and assert
    if let Ok(msg) = broadcast_rx.try_recv() {
      let parsed: serde_json::Value =
        serde_json::from_str(&msg).expect("valid json payload");
      assert_eq!(parsed["type"], "source_info");
      assert_eq!(parsed["active_source"], source_id);
      let src = parsed["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == source_id)
        .unwrap();
      assert_eq!(src["status"], "loading");
    }

    // 3. Simulate and verify Streaming State in a loop
    eprintln!(
      "Source lifecycle status: {} for {}",
      SourceLifecyclePhase::Streaming,
      kind
    );
    if kind == "hackrf_one" {
      eprintln!("Rx active (Rx light on HackRF One)");
    }
    for i in 0..5 {
      let frame = device.read_samples(4096).expect("hardware frame");
      assert!(!frame.data.is_empty());
      shared.record_successful_read();
      shared.update_device_status(
        true,
        device.get_device_info(),
        build_device_profile(device.device_type()),
      );

      // Broadcast the streaming state
      broadcast_device_status(&shared, &broadcast_tx);

      let streaming = build_source_info_snapshot(&shared);
      let sources = streaming["sources"].as_array().unwrap();
      let active = sources
        .iter()
        .find(|source| source["id"] == source_id)
        .expect("active streaming source");
      assert_eq!(active["status"], "streaming");
      assert_eq!(active["paused"], false);

      // Receive and verify broadcast
      while let Ok(msg) = broadcast_rx.try_recv() {
        let parsed: serde_json::Value =
          serde_json::from_str(&msg).expect("valid json payload");
        if parsed["type"] == "source_info" {
          if let Some(src) = parsed["sources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == source_id)
          {
            assert_eq!(src["status"], "streaming");
          }
        }
      }

      eprintln!("Iterated streaming state for {} (cycle {}/5)", kind, i + 1);
      tokio::time::sleep(Duration::from_millis(100)).await;
    }

    cleanup_device(device.as_mut());
    assert!(
      !device.is_rx_active(),
      "Expected Rx active to be false after cleanup"
    );
    if kind == "hackrf_one" {
      eprintln!("Rx inactive (Rx light off HackRF One)");
    }
    eprintln!(
      "Source lifecycle status: {} for {}",
      SourceLifecyclePhase::Standby,
      kind
    );
  }
}

fn report_supported_devices(
  label: &str,
  devices: &[UsbDeviceSnapshot],
  include_open_prompt: bool,
) {
  if devices.is_empty() {
    eprintln!("{}: unsupported", label);
    return;
  }

  eprintln!("{}: supported devices ({})", label, devices.len());
  for device in devices {
    eprintln!("  {}", format_usb_snapshot(device));
  }
  if include_open_prompt {
    eprintln!("{}: attempting device open", label);
  }
}

fn display_device_type(device_type: &str) -> &str {
  match device_type {
    "hackrf_one" => "HackRF One",
    "hackrf_dfu" => "HackRF DFU",
    "rtl-sdr" => "RTL-SDR",
    "mock_apt" => "Mock APT SDR",
    _ => "unsupported",
  }
}

#[test]
fn display_device_type_uses_compact_supported_labels() {
  assert_eq!(display_device_type("hackrf_one"), "HackRF One");
  assert_eq!(display_device_type("rtl-sdr"), "RTL-SDR");
  assert_eq!(display_device_type("not-supported"), "unsupported");
}
