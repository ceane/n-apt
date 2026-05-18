use n_apt_backend::sdr::hotplug::scan_usb_for_supported_device;
use n_apt_backend::sdr::SdrDeviceFactory;
use std::time::Duration;
use std::thread;

#[test]
#[ignore]
fn hotplug_smoke_scan_reports_supported_device() {
  if std::env::var("CI").is_ok() {
    eprintln!("Skipping manual hotplug smoke test in CI");
    return;
  }

  eprintln!("Hotplug watch running. Plug/unplug the SDR, then press Ctrl+C to stop.");
  let mut last_seen: Option<String> = None;
  loop {
    let seen = scan_usb_for_supported_device()
      .expect("USB scan should not fail unexpectedly");
    if seen != last_seen {
      match &seen {
        Some(device_type) => {
          eprintln!("Detected supported USB device: {}", device_type);
          let mut opened = None;
          let mut last_err = None;
          for attempt in 1..=5 {
            match SdrDeviceFactory::create_rtlsdr_device() {
              Ok(device) => {
                opened = Some(device);
                break;
              }
              Err(e) => {
                last_err = Some(e);
                eprintln!(
                  "RTL-SDR open attempt {} of 5 failed; retrying",
                  attempt
                );
                thread::sleep(Duration::from_millis(250));
              }
            }
          }

          match opened {
            Some(device) => {
              eprintln!("Opened device type: {}", device.device_type());
            }
            None => {
              eprintln!(
                "Supported USB device is present, but RTL-SDR open still failed: {}",
                last_err.expect("Expected a failure reason")
              );
            }
          }
        }
        None => {
          match &last_seen {
            Some(previous) => eprintln!("{} disconnected", previous),
            None => eprintln!("No supported USB device detected"),
          }
        }
      }
      last_seen = seen;
    }

    thread::sleep(Duration::from_millis(500));
  }
}
