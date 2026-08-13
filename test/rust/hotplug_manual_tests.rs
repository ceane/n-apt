use base64::{engine::general_purpose, Engine as _};
use futures_util::{SinkExt, StreamExt};
use n_apt_backend::crypto;
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
use serde::Deserialize;
use serde_json::Value;
use serial_test::serial;
use std::thread;
use std::time::{Duration, Instant};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Deserialize)]
struct ManualAuthChallenge {
  challenge_id: String,
  nonce: String,
}

fn manual_http_url() -> String {
  std::env::var("N_APT_MANUAL_HTTP_URL")
    .or_else(|_| std::env::var("N_APT_HTTP_URL"))
    .unwrap_or_else(|_| "http://127.0.0.1:8765".to_string())
    .trim_end_matches('/')
    .to_string()
}

fn manual_websocket_url(http_url: &str, path: &str, token: &str) -> String {
  let ws_url = http_url
    .replacen("https://", "wss://", 1)
    .replacen("http://", "ws://", 1);
  format!("{ws_url}{path}?token={token}")
}

async fn manual_authenticate(
  http_url: &str,
  passkey: &str,
) -> Result<(String, [u8; 32]), String> {
  let client = reqwest::Client::new();
  let challenge_response = client
    .post(format!("{http_url}/auth/challenge"))
    .json(&serde_json::json!({}))
    .send()
    .await
    .map_err(|error| format!("auth challenge request failed: {error}"))?;
  if !challenge_response.status().is_success() {
    return Err(format!(
      "auth challenge returned HTTP {}",
      challenge_response.status()
    ));
  }
  let challenge = challenge_response
    .json::<ManualAuthChallenge>()
    .await
    .map_err(|error| format!("auth challenge response was invalid: {error}"))?;
  let nonce = general_purpose::STANDARD
    .decode(challenge.nonce)
    .map_err(|error| format!("auth challenge nonce was invalid: {error}"))?;
  let key = crypto::derive_key(passkey);
  let hmac =
    general_purpose::STANDARD.encode(crypto::compute_hmac(&key, &nonce));
  let verify_response = client
    .post(format!("{http_url}/auth/verify"))
    .json(&serde_json::json!({
      "challenge_id": challenge.challenge_id,
      "hmac": hmac,
    }))
    .send()
    .await
    .map_err(|error| format!("auth verification request failed: {error}"))?;
  if !verify_response.status().is_success() {
    return Err(format!(
      "auth verification returned HTTP {}",
      verify_response.status()
    ));
  }
  let body = verify_response.json::<Value>().await.map_err(|error| {
    format!("auth verification response was invalid: {error}")
  })?;
  let token = body
    .get("token")
    .and_then(Value::as_str)
    .filter(|token| !token.is_empty())
    .ok_or_else(|| {
      "auth verification response did not contain a token".to_string()
    })?;
  Ok((token.to_string(), key))
}

fn source_from_snapshot<'a>(
  snapshot: &'a Value,
  source_id: &str,
) -> Option<&'a Value> {
  snapshot["sources"]
    .as_array()?
    .iter()
    .find(|source| source["id"].as_str() == Some(source_id))
}

fn active_source_from_snapshot(snapshot: &Value) -> Option<Value> {
  let active_source_id = snapshot["active_source"].as_str()?;
  source_from_snapshot(snapshot, active_source_id).cloned()
}

fn source_number(source: &Value, path: &[&str]) -> Option<f64> {
  path
    .iter()
    .try_fold(source, |value, key| value.get(*key))
    .and_then(Value::as_f64)
}

fn source_stream_options(source: &Value) -> Value {
  let center_frequency_hz =
    source_number(source, &["sdr", "settings", "center_frequency"])
      .unwrap_or(137_500_000.0)
      .round() as u64;
  let max_sample_rate_hz = source_number(source, &["sdr", "max_sample_rate"])
    .unwrap_or(2_400_000.0)
    .round() as u32;
  let requested_sample_rate_hz =
    source_number(source, &["sdr", "settings", "sample_rate"])
      .unwrap_or(2_400_000.0)
      .round() as u32;
  let sample_rate_hz = requested_sample_rate_hz
    .min(max_sample_rate_hz.max(1_000_000))
    .max(1_000_000);
  serde_json::json!({
    "mode": "rx",
    "centerFrequencyHz": center_frequency_hz,
    "sampleRateHz": sample_rate_hz,
    "fftSize": 2048,
    "fftWindow": "Rectangular",
    "frameRate": 15,
    "gain": null,
  })
}

fn validate_manual_rx_frame(
  value: &Value,
  source_id: &str,
  encryption_key: &[u8; 32],
  last_epoch: &mut Option<u64>,
  last_sequence: &mut Option<u64>,
) -> Result<bool, String> {
  if value["type"] != "stream_frame" {
    return Ok(false);
  }
  if value["sourceId"].as_str() != Some(source_id)
    || value["mode"].as_str() != Some("rx")
  {
    return Err(format!(
      "received a frame owned by the wrong stream: source={:?}, mode={:?}",
      value["sourceId"].as_str(),
      value["mode"].as_str()
    ));
  }
  let sequence = value["sequence"]
    .as_u64()
    .ok_or_else(|| "stream frame must contain a sequence".to_string())?;
  let epoch = value["streamEpoch"]
    .as_u64()
    .ok_or_else(|| "stream frame must contain a stream epoch".to_string())?;
  match (*last_epoch, *last_sequence) {
    (Some(previous_epoch), Some(previous_sequence)) if epoch == previous_epoch => {
      if sequence <= previous_sequence {
        return Err("stream frame sequence moved backwards".to_string());
      }
      if sequence != previous_sequence + 1 {
        return Err(format!(
          "frontend RX stream lost a frame: previous={previous_sequence}, current={sequence}"
        ));
      }
    }
    (Some(previous_epoch), _) if epoch < previous_epoch => {
      return Err(format!(
        "frontend RX stream epoch moved backwards: previous={previous_epoch}, current={epoch}"
      ));
    }
    _ => {}
  }
  let sample_rate_hz = value["sampleRateHz"]
    .as_u64()
    .ok_or_else(|| "stream frame must contain a sample rate".to_string())?;
  if sample_rate_hz == 0 {
    return Err("frontend RX frame has no sample rate".to_string());
  }
  let encoded_iq = value["iqData"]
    .as_str()
    .ok_or_else(|| "stream frame must contain encrypted IQ data".to_string())?;
  let encrypted_iq = general_purpose::STANDARD
    .decode(encoded_iq)
    .map_err(|error| format!("stream frame IQ data was not base64: {error}"))?;
  let iq_data = crypto::decrypt_payload_binary(encryption_key, &encrypted_iq)
    .map_err(|error| {
    format!("stream frame IQ data did not decrypt: {error}")
  })?;
  if iq_data.is_empty() {
    return Err("frontend RX frame contains no IQ data".to_string());
  }
  if iq_data.len() % 2 != 0 {
    return Err("RTL-SDR IQ data is not interleaved".to_string());
  }
  *last_epoch = Some(epoch);
  *last_sequence = Some(sequence);
  Ok(true)
}

async fn next_source_info(
  control: &mut tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
  >,
  timeout: Duration,
) -> Result<Value, String> {
  tokio::time::timeout(timeout, async {
    while let Some(message) = control.next().await {
      let message = message
        .map_err(|error| format!("control WebSocket failed: {error}"))?;
      let Message::Text(text) = message else {
        continue;
      };
      let value = serde_json::from_str::<Value>(&text).map_err(|error| {
        format!("control message was invalid JSON: {error}")
      })?;
      if value["type"] == "source_info" {
        return Ok(value);
      }
    }
    Err("control WebSocket closed before source_info".to_string())
  })
  .await
  .map_err(|_| "timed out waiting for source_info".to_string())?
}

fn assert_loading_then_receiving(
  source_label: &str,
  statuses: &[String],
) {
  let loading_position = statuses
    .iter()
    .position(|status| status == "loading")
    .unwrap_or_else(|| {
      panic!(
        "{source_label} connect never exposed the Loading placeholder; trace={statuses:?}"
      )
    });
  let receiving_position = statuses
    .iter()
    .position(|status| status == "receiving")
    .unwrap_or_else(|| {
      panic!(
        "{source_label} connect never transitioned to Receiving; trace={statuses:?}"
      )
    });
  assert!(
    loading_position < receiving_position,
    "{source_label} connect skipped or reordered Loading -> Receiving: trace={statuses:?}"
  );
}

async fn select_manual_source(
  control: &mut tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
  >,
  source_id: &str,
) -> Result<(), String> {
  control
    .send(Message::Text(
      serde_json::json!({
        "type": "select_source",
        "source_id": source_id,
      })
      .to_string()
      .into(),
    ))
    .await
    .map_err(|error| format!("failed to select source {source_id}: {error}"))?;

  // A manual flow test always exercises the receiving path. Clear a stale
  // source-scoped pause left by the operator's previous browser session so a
  // valid source is not mistaken for a failed first-frame transition.
  control
    .send(Message::Text(
      serde_json::json!({
        "type": "pause",
        "paused": false,
        "source_id": source_id,
      })
      .to_string()
      .into(),
    ))
    .await
    .map_err(|error| format!("failed to resume source {source_id}: {error}"))
}

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
      "mock_apt" => Ok(SdrDeviceFactory::create_mock_device()),
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

/// Opens only the attached RTL-SDR and verifies that the Rust async reader
/// delivers real IQ blocks. This is intentionally opt-in because it claims the
/// physical USB interface for the duration of the test.
#[test]
#[serial]
fn rtl_sdr_manual_read_probe_delivers_iq() {
  if std::env::var("RUN_HOTPLUG_RTL_READ").is_err() {
    eprintln!(
      "Skipping RTL-SDR read probe. Set RUN_HOTPLUG_RTL_READ=1 to run it."
    );
    return;
  }

  let mut device =
    open_supported_device("rtl-sdr").expect("open attached RTL-SDR");
  device.initialize().expect("initialize RTL-SDR");

  for cycle in 0..3 {
    let frame = device.read_samples(4096).unwrap_or_else(|error| {
      panic!("RTL-SDR read cycle {cycle} failed: {error}")
    });
    assert_eq!(frame.data.len(), 8192);
  }

  cleanup_device(device.as_mut());
}

/// Exercises the backend's processor construction and first-frame path with
/// only the attached RTL-SDR, without starting the HTTP/WebSocket server.
#[test]
#[serial]
fn rtl_sdr_processor_manual_read_probe_delivers_frame() {
  if std::env::var("RUN_HOTPLUG_RTL_PROCESSOR_READ").is_err() {
    eprintln!(
      "Skipping RTL-SDR processor probe. Set RUN_HOTPLUG_RTL_PROCESSOR_READ=1 to run it."
    );
    return;
  }

  let device = open_supported_device("rtl-sdr").expect("open attached RTL-SDR");
  let mut processor =
    SdrProcessor::with_device(device).expect("construct RTL-SDR processor");
  processor
    .initialize()
    .expect("initialize RTL-SDR processor");

  for cycle in 0..3 {
    let frame = processor.read_and_process_frame().unwrap_or_else(|error| {
      panic!("RTL-SDR processor cycle {cycle} failed: {error}")
    });
    assert!(!frame.is_empty());
  }
}

/// Runs the same control-plane and multiplexed IQ path used by the browser
/// against an attached RTL-SDR. This is intentionally ignored and opt-in:
/// it requires a running authenticated backend and claims the physical SDR.
#[tokio::test]
#[ignore = "requires a running backend and an attached RTL-SDR"]
#[serial]
async fn source_frontend_startup_and_frame_flow() {
  if std::env::var("RUN_SOURCE_FRONTEND_FLOW").is_err() {
    eprintln!(
      "Skipping source frontend flow test. Set RUN_SOURCE_FRONTEND_FLOW=1 to run it."
    );
    return;
  }
  let Some(passkey) = std::env::var_os("N_APT_MANUAL_PASSKEY")
    .or_else(|| std::env::var_os("UNSAFE_LOCAL_USER_PASSWORD"))
  else {
    eprintln!(
      "Skipping source frontend flow test. Set N_APT_MANUAL_PASSKEY in the process environment."
    );
    return;
  };
  let passkey = passkey
    .into_string()
    .map_err(|_| "manual passkey is not valid UTF-8")
    .expect("manual passkey must be valid UTF-8");
  let http_url = manual_http_url();
  let (token, encryption_key) = manual_authenticate(&http_url, &passkey)
    .await
    .expect("manual backend authentication");

  let control_url = manual_websocket_url(&http_url, "/ws", &token);
  let (mut control, _) = connect_async(control_url)
    .await
    .expect("connect authenticated control WebSocket");
  let initial_snapshot =
    next_source_info(&mut control, Duration::from_secs(10))
      .await
      .expect("receive initial source_info");
  let rtl_source = active_source_from_snapshot(&initial_snapshot)
    .expect("running backend must advertise an active source");
  let rtl_source_id = rtl_source["id"]
    .as_str()
    .expect("active source must have an id")
    .to_string();
  let mut status_trace =
    vec![source_from_snapshot(&initial_snapshot, &rtl_source_id)
      .and_then(|source| source["status"].as_str())
      .unwrap_or("missing")
      .to_string()];
  let mut saw_loading = status_trace
    .last()
    .is_some_and(|status| status == "loading");
  let mut saw_receiving = status_trace
    .last()
    .is_some_and(|status| status == "receiving");
  let connect_status_trace_start = status_trace.len();

  let stream_url = manual_websocket_url(&http_url, "/ws/streams", &token);
  let (mut stream, _) = connect_async(stream_url)
    .await
    .expect("connect authenticated multiplexed stream WebSocket");
  let stream_options = source_stream_options(&rtl_source);
  stream
    .send(Message::Text(
      serde_json::json!({
        "type": "stream_subscribe",
        "subscriptionId": "manual-rtl-rx",
        "stream": {"sourceId": &rtl_source_id, "mode": "rx"},
        "options": stream_options,
      })
      .to_string()
      .into(),
    ))
    .await
    .expect("subscribe to RTL-SDR RX stream");

  let force_cold_start =
    std::env::var("RUN_SOURCE_FORCE_COLD_START").is_ok();
  if force_cold_start {
    // Force the source handoff through Mock APT first so this invocation
    // proves the loading -> receiving transition instead of inheriting a
    // prior browser session's active-source state.
    select_manual_source(&mut control, "mock-apt")
      .await
      .expect("select Mock APT before cold RTL-SDR start");
    loop {
      let snapshot = next_source_info(&mut control, Duration::from_secs(10))
        .await
        .expect("receive Mock APT handoff source_info");
      if snapshot["active_source"] == "mock-apt" {
        break;
      }
    }
  }
  if initial_snapshot["active_source"] != rtl_source_id || force_cold_start {
    select_manual_source(&mut control, &rtl_source_id)
      .await
      .expect("select active source");
  }

  let deadline = Instant::now() + Duration::from_secs(30);
  let mut frame_count = 0usize;
  let mut last_sequence = None::<u64>;
  let mut last_epoch = None::<u64>;
  let mut last_frame_at = None::<Instant>;
  let mut max_frame_gap = Duration::ZERO;
  let mut receiving_without_frame_after_stall = false;
  let mut first_receiving_without_frame_at = None::<Instant>;
  let mut stream_errors = Vec::<String>::new();
  let mut stream_ready = false;
  let mut stream_event_trace = Vec::<String>::new();

  while Instant::now() < deadline
    && (frame_count < 8
      || last_frame_at
        .is_none_or(|frame_at| frame_at.elapsed() < Duration::from_secs(3)))
  {
    let remaining = deadline.saturating_duration_since(Instant::now());
    let next_message = match tokio::time::timeout(remaining, async {
      tokio::select! {
        message = control.next() => (true, message),
        message = stream.next() => (false, message),
      }
    })
    .await
    {
      Ok(message) => message,
      Err(_) => {
        if frame_count == 0 && saw_receiving {
          receiving_without_frame_after_stall = true;
        }
        break;
      }
    };
    let (is_control, message) = next_message;
    let Some(message) = message else {
      panic!("frontend WebSocket closed during RTL-SDR flow observation");
    };
    let message = message.expect("frontend WebSocket message must be valid");
    let Message::Text(text) = message else {
      continue;
    };
    let value = serde_json::from_str::<Value>(&text)
      .expect("frontend WebSocket message must be valid JSON");

    if is_control {
      if value["type"] != "source_info" {
        continue;
      }
      let Some(source) = source_from_snapshot(&value, &rtl_source_id) else {
        continue;
      };
      let status = source["status"].as_str().unwrap_or("missing");
      if value["active_source"].as_str() == Some(rtl_source_id.as_str())
        && status != "paused"
      {
        assert_eq!(
          value["active_source_mode"].as_str(),
          Some("live"),
          "an active receiving source must not enter file/placeholder mode"
        );
      }
      status_trace.push(status.to_string());
      match status {
        "loading" => saw_loading = true,
        "receiving" => {
          saw_receiving = true;
          if frame_count == 0 {
            let first_receiving_at =
              first_receiving_without_frame_at.get_or_insert_with(Instant::now);
            if first_receiving_at.elapsed() > Duration::from_secs(2) {
              receiving_without_frame_after_stall = true;
            }
          } else if let Some(frame_at) = last_frame_at {
            if frame_at.elapsed() > Duration::from_secs(2) {
              receiving_without_frame_after_stall = true;
            }
          }
        }
        "connected" | "initializing" | "stale" | "disconnected" | "standby"
        | "paused" | "transmitting" => {}
        "error" => stream_errors.push(
          source["device_loading_reason"]
            .as_str()
            .unwrap_or("active source entered error state")
            .to_string(),
        ),
        other => {
          panic!("unexpected source status in frontend trace: {other}")
        }
      }
      continue;
    }

    if stream_event_trace.len() < 12 {
      stream_event_trace.push(format!(
        "type={}, state={}, sourceId={}, code={}",
        value["type"].as_str().unwrap_or("missing"),
        value["state"].as_str().unwrap_or("missing"),
        value["sourceId"].as_str().unwrap_or("missing"),
        value["code"].as_str().unwrap_or("missing"),
      ));
    }

    match value["type"].as_str() {
      Some("stream_frame") => {
        validate_manual_rx_frame(
          &value,
          &rtl_source_id,
          &encryption_key,
          &mut last_epoch,
          &mut last_sequence,
        )
        .expect(
          "frontend RX frame must be source-owned, contiguous, and valid",
        );
        let now = Instant::now();
        if let Some(previous) = last_frame_at {
          max_frame_gap = max_frame_gap.max(now.duration_since(previous));
        }
        last_frame_at = Some(now);
        frame_count += 1;
      }
      Some("stream_subscribed")
      | Some("stream_state")
      | Some("stream_error") => {
        if value["state"] == "ready" {
          stream_ready = true;
        }
        if value["type"] == "stream_error"
          && value["sourceId"].as_str() == Some(rtl_source_id.as_str())
        {
          stream_errors.push(
            value["message"]
              .as_str()
              .unwrap_or("RTL-SDR multiplexed stream error")
              .to_string(),
          );
        }
      }
      _ => {}
    }
  }

  if frame_count < 8 {
    eprintln!(
      "source frontend flow stopped before teardown: frames={frame_count}, stream_ready={stream_ready}, saw_loading={saw_loading}, saw_receiving={saw_receiving}, receiving_without_frame_after_stall={receiving_without_frame_after_stall}, states={}, stream_events={stream_event_trace:?}, stream_errors={stream_errors:?}",
      status_trace.join(" -> ")
    );
    let _ = stream.close(None).await;
    panic!(
      "source frontend received only {frame_count} frames before teardown"
    );
  }

  // Multi-source isolation: a failed peer selection must not take the
  // currently streaming source out with it. The peer is deliberately made
  // unavailable by changing its advertised id, which exercises the same
  // open-device failure path without asking the operator to unplug hardware
  // during this assertion.
  let peer_source_count = initial_snapshot["sources"]
    .as_array()
    .map(|sources| {
      sources
        .iter()
        .filter(|source| source["id"].as_str() != Some(rtl_source_id.as_str()))
        .count()
    })
    .unwrap_or(0);
  assert!(
    peer_source_count > 0,
    "multi-source isolation requires at least one peer source"
  );
  let peer_source_id = initial_snapshot["sources"]
    .as_array()
    .and_then(|sources| {
      sources.iter().find_map(|source| {
        let id = source["id"].as_str()?;
        (id != rtl_source_id).then_some(id.to_string())
      })
    })
    .expect("peer source must have an id");
  let failed_peer_id = format!("{peer_source_id}-unavailable");
  control
    .send(Message::Text(
      serde_json::json!({
        "type": "select_source",
        "source_id": &failed_peer_id,
      })
      .to_string()
      .into(),
    ))
    .await
    .expect("request failed peer source selection");

  let isolation_deadline = Instant::now() + Duration::from_secs(8);
  let isolation_start_frames = frame_count;
  let mut saw_failed_peer = false;
  let mut active_status_after_failure = status_trace
    .last()
    .filter(|status| status.as_str() == "receiving")
    .cloned();
  while Instant::now() < isolation_deadline
    && (!saw_failed_peer || frame_count < isolation_start_frames + 3)
  {
    let remaining = isolation_deadline.saturating_duration_since(Instant::now());
    let next_message = tokio::time::timeout(remaining, async {
      tokio::select! {
        message = control.next() => (true, message),
        message = stream.next() => (false, message),
      }
    })
    .await
    .expect("failed peer selection must not stall the active stream");
    let (is_control, message) = next_message;
    let Some(message) = message else {
      panic!("WebSocket closed while asserting failed-peer isolation");
    };
    let message = message.expect("failed-peer isolation message must be valid");
    let Message::Text(text) = message else {
      continue;
    };
    let value = serde_json::from_str::<Value>(&text)
      .expect("failed-peer isolation message must be valid JSON");

    if is_control {
      if value["type"] == "error"
        && value["code"] == "source_switch_failed"
        && value["source_id"] == failed_peer_id
      {
        saw_failed_peer = true;
      }
      if value["type"] == "source_info"
        && value["active_source"].as_str() == Some(rtl_source_id.as_str())
      {
        active_status_after_failure = source_from_snapshot(
          &value,
          &rtl_source_id,
        )
        .and_then(|source| source["status"].as_str())
        .map(str::to_string);
      }
      continue;
    }

    if validate_manual_rx_frame(
      &value,
      &rtl_source_id,
      &encryption_key,
      &mut last_epoch,
      &mut last_sequence,
    )
    .expect("active source frame must survive failed peer selection")
    {
      let now = Instant::now();
      if let Some(previous) = last_frame_at {
        max_frame_gap = max_frame_gap.max(now.duration_since(previous));
      }
      last_frame_at = Some(now);
      frame_count += 1;
    }
  }
  assert!(
    saw_failed_peer,
    "failed peer selection did not produce source_switch_failed"
  );
  assert!(
    frame_count >= isolation_start_frames + 3,
    "active source stopped delivering frames when its peer failed"
  );
  assert_eq!(
    active_status_after_failure.as_deref(),
    Some("receiving"),
    "active source did not remain Receiving after peer failure"
  );

  // Exercise the same teardown path used when the browser changes source or
  // reconnects after a page/backend restart. The acknowledgement proves the
  // server removed the logical subscription before the socket is closed.
  stream
    .send(Message::Text(
      serde_json::json!({
        "type": "stream_unsubscribe",
        "subscriptionId": "manual-rtl-rx",
        "stream": {"sourceId": &rtl_source_id, "mode": "rx"},
      })
      .to_string()
      .into(),
    ))
    .await
    .expect("unsubscribe RTL-SDR RX stream");
  let teardown_acknowledged =
    tokio::time::timeout(Duration::from_secs(5), async {
      while let Some(message) = stream.next().await {
        let message = message.map_err(|error| error.to_string())?;
        let Message::Text(text) = message else {
          continue;
        };
        let value = serde_json::from_str::<Value>(&text)
          .map_err(|error| error.to_string())?;
        if value["type"] == "stream_unsubscribe"
          && value["subscriptionId"] == "manual-rtl-rx"
        {
          return Ok::<bool, String>(true);
        }
      }
      Ok(false)
    })
    .await
    .map_err(|_| {
      "timed out waiting for RTL-SDR stream teardown acknowledgement"
    })
    .expect("RTL-SDR stream teardown must complete")
    .expect("RTL-SDR stream teardown WebSocket must remain valid");
  assert!(
    teardown_acknowledged,
    "RTL-SDR stream teardown was not acknowledged"
  );
  stream
    .close(None)
    .await
    .expect("close RTL-SDR stream WebSocket cleanly");

  // Recreate the browser's multiplexed transport after teardown. This catches
  // stale manager entries and the old-reader/old-subscription race separately
  // from the first connection's frame flow.
  let resumed_stream_url =
    manual_websocket_url(&http_url, "/ws/streams", &token);
  let (mut resumed_stream, _) = connect_async(resumed_stream_url)
    .await
    .expect("reconnect authenticated multiplexed stream WebSocket");
  resumed_stream
    .send(Message::Text(
      serde_json::json!({
        "type": "stream_subscribe",
        "subscriptionId": "manual-rtl-rx-resumed",
        "stream": {"sourceId": &rtl_source_id, "mode": "rx"},
        "options": stream_options.clone(),
      })
      .to_string()
      .into(),
    ))
    .await
    .expect("resubscribe to RTL-SDR RX stream after teardown");
  let reconnect_deadline = Instant::now() + Duration::from_secs(10);
  let mut reconnect_frames = 0usize;
  let mut reconnect_epoch = None;
  let mut reconnect_sequence = None;
  while Instant::now() < reconnect_deadline && reconnect_frames < 3 {
    let remaining =
      reconnect_deadline.saturating_duration_since(Instant::now());
    let message = tokio::time::timeout(remaining, resumed_stream.next())
      .await
      .map_err(|_| "timed out waiting for RTL-SDR frames after reconnect")
      .expect("RTL-SDR stream reconnect must deliver frames")
      .expect("RTL-SDR stream reconnect WebSocket closed")
      .expect("RTL-SDR stream reconnect message must be valid");
    let Message::Text(text) = message else {
      continue;
    };
    let value = serde_json::from_str::<Value>(&text)
      .expect("reconnected frontend stream message must be valid JSON");
    if value["type"] == "stream_error" {
      stream_errors.push(
        value["message"]
          .as_str()
          .unwrap_or("RTL-SDR stream error after reconnect")
          .to_string(),
      );
      continue;
    }
    if validate_manual_rx_frame(
      &value,
      &rtl_source_id,
      &encryption_key,
      &mut reconnect_epoch,
      &mut reconnect_sequence,
    )
    .expect("reconnected RTL-SDR frame must be valid")
    {
      reconnect_frames += 1;
    }
  }
  assert_eq!(
    reconnect_frames, 3,
    "RTL-SDR stream did not recover after teardown"
  );

  if std::env::var("RUN_SOURCE_HOTPLUG_CYCLE").is_ok() {
    eprintln!(
      "source hotplug cycle armed: unplug the active source now, wait for the disconnected/loading state, then plug it back in."
    );
    let hotplug_deadline = Instant::now() + Duration::from_secs(90);
    let hotplug_trace_start = status_trace.len();
    let mut saw_disconnect_placeholder = false;
    let mut saw_reconnected_receiving = false;
    while Instant::now() < hotplug_deadline && !saw_reconnected_receiving {
      let remaining =
        hotplug_deadline.saturating_duration_since(Instant::now());
      let message = tokio::time::timeout(remaining, control.next())
        .await
        .map_err(|_| "timed out waiting for the manual source hotplug cycle")
        .expect("manual source hotplug cycle must produce state updates")
        .expect("control WebSocket closed during manual source hotplug cycle")
        .expect("hotplug lifecycle message must be valid");
      let Message::Text(text) = message else {
        continue;
      };
      let snapshot = serde_json::from_str::<Value>(&text)
        .expect("hotplug lifecycle message must be valid JSON");
      if snapshot["type"] != "source_info" {
        continue;
      }
      let Some(source) = source_from_snapshot(&snapshot, &rtl_source_id) else {
        continue;
      };
      let status = source["status"].as_str().unwrap_or("missing");
      status_trace.push(status.to_string());
      match status {
        "disconnected" | "stale" | "loading" | "error" | "paused" => {
          saw_disconnect_placeholder = true;
        }
        "receiving" if saw_disconnect_placeholder => {
          saw_reconnected_receiving = true;
        }
        _ => {}
      }
    }
    assert!(
      saw_disconnect_placeholder,
      "hotplug cycle never exposed a disconnected/loading placeholder state"
    );
    assert!(
      saw_reconnected_receiving,
      "hotplug cycle never returned RTL-SDR to receiving state"
    );
    assert_loading_then_receiving(
      rtl_source["kind"].as_str().unwrap_or("hardware source"),
      &status_trace[hotplug_trace_start..],
    );

    // Keep the browser stream subscribed across the physical reconnect. The
    // lifecycle is not complete until the same subscription receives fresh,
    // source-owned frames after Receiving returns.
    let frame_deadline = Instant::now() + Duration::from_secs(10);
    let mut hotplug_frames = 0usize;
    let mut hotplug_epoch = reconnect_epoch;
    let mut hotplug_sequence = reconnect_sequence;
    while Instant::now() < frame_deadline && hotplug_frames < 3 {
      let remaining = frame_deadline.saturating_duration_since(Instant::now());
      let message = tokio::time::timeout(remaining, resumed_stream.next())
        .await
        .map_err(|_| "timed out waiting for frames after source hotplug")
        .expect("source hotplug stream must recover")
        .expect("source hotplug stream WebSocket closed")
        .expect("source hotplug stream message must be valid");
      let Message::Text(text) = message else {
        continue;
      };
      let value = serde_json::from_str::<Value>(&text)
        .expect("source hotplug stream message must be valid JSON");
      if value["type"] == "stream_error" {
        stream_errors.push(
          value["message"]
            .as_str()
            .unwrap_or("RTL-SDR stream error after hotplug")
            .to_string(),
        );
        continue;
      }
      if validate_manual_rx_frame(
        &value,
        &rtl_source_id,
        &encryption_key,
        &mut hotplug_epoch,
        &mut hotplug_sequence,
      )
      .expect("source hotplug frame must be valid")
      {
        hotplug_frames += 1;
      }
    }
    assert_eq!(
      hotplug_frames, 3,
      "RTL-SDR stream did not deliver frames after hotplug recovery"
    );
  }

  resumed_stream
    .close(None)
    .await
    .expect("close resumed RTL-SDR stream WebSocket cleanly");

  eprintln!(
    "source frontend state trace: {}",
    status_trace.join(" -> ")
  );
  assert!(saw_receiving, "RTL-SDR never reached receiving state");
  assert!(
    stream_ready,
    "RTL-SDR multiplexed stream never reached ready state"
  );
  if force_cold_start {
    // The source-agnostic lifecycle assertion below must observe this
    // handoff, rather than inherit a pre-existing Receiving state.
    assert!(
      connect_status_trace_start < status_trace.len(),
      "forced source connect produced no lifecycle updates"
    );
    assert_loading_then_receiving(
      rtl_source["kind"].as_str().unwrap_or("hardware source"),
      &status_trace[connect_status_trace_start..],
    );
  }
  assert!(
    !receiving_without_frame_after_stall,
    "RTL-SDR reported receiving after its frame flow stalled"
  );
  assert!(
    stream_errors.is_empty(),
    "source frontend stream errors: {stream_errors:?}"
  );
  assert!(
    frame_count >= 8,
    "source frontend received only {frame_count} frames"
  );
  assert!(
    max_frame_gap <= Duration::from_secs(2),
    "source frontend frame gap reached {max_frame_gap:?}"
  );
}

#[tokio::test]
#[serial]
async fn source_lifecycle_updates_app_source_state_through_loading_and_receiving()
{
  if std::env::var("RUN_OPEN_DEVICE_APP_STATE").is_err() {
    eprintln!(
      "Skipping open-device app-state test. Set RUN_OPEN_DEVICE_APP_STATE=1 to run it."
    );
    return;
  }
  if std::env::var_os("UNSAFE_LOCAL_USER_PASSWORD").is_none() {
    eprintln!(
      "Skipping open-device app-state test. Set UNSAFE_LOCAL_USER_PASSWORD in the process environment."
    );
    return;
  }

  let snapshots = scan_supported_usb_device_snapshots()
    .expect("supported USB scan should succeed");
  let mut device_types = vec!["mock_apt"];
  device_types.extend(
    snapshots
      .iter()
      .map(|snapshot| snapshot.device_type.as_str())
      .filter(|kind| *kind == "rtl-sdr" || *kind == "hackrf_one")
      .collect::<Vec<_>>(),
  );
  device_types.sort_unstable();
  device_types.dedup();

  let shared = SharedState::new("redis://127.0.0.1:6379");
  let (broadcast_tx, mut broadcast_rx) =
    tokio::sync::broadcast::channel::<String>(32);

  // Open each advertised source once at the beginning to initialize drivers
  // and exercise the same lifecycle contract for Mock APT and physical SDRs.
  let mut devices = Vec::new();
  for kind in device_types {
    let device = open_supported_device(kind)
      .unwrap_or_else(|| panic!("failed to open attached {kind}"));
    devices.push((kind, device));
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

    // Transition and verify the source-agnostic Loading placeholder.
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

    let mut status_trace = vec![loading_source["status"]
      .as_str()
      .unwrap_or("missing")
      .to_string()];

    // Simulate and verify the first-frame transition to Receiving.
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
      assert_eq!(active["status"], "receiving");
      assert_eq!(active["paused"], false);
      status_trace.push(active["status"].as_str().unwrap().to_string());

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
            assert_eq!(src["status"], "receiving");
          }
        }
      }

      eprintln!("Iterated streaming state for {} (cycle {}/5)", kind, i + 1);
      tokio::time::sleep(Duration::from_millis(100)).await;
    }

    assert_loading_then_receiving(&kind, &status_trace);

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
