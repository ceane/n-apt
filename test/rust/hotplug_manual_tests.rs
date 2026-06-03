use n_apt_backend::sdr::hotplug::{
  scan_supported_usb_device_snapshots, scan_usb_device_snapshots,
  HotplugEvent, HotplugEventKind, HotplugMonitor, UsbDeviceSnapshot,
};
use n_apt_backend::sdr::{SdrDevice, SdrDeviceFactory};
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

fn report_supported_devices(
  label: &str,
  devices: &[UsbDeviceSnapshot],
  include_open_prompt: bool,
) {
  if devices.is_empty() {
    eprintln!("{}: unsupported", label);
    return;
  }

  eprintln!(
    "{}: supported devices ({})",
    label,
    devices.len()
  );
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
