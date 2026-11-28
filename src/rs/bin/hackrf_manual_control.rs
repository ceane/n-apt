use std::io::{BufRead, Write};

fn parse_tx_frequency_hz(input: &str) -> Result<u32, String> {
  let frequency_hz = input.trim().parse::<u64>().map_err(|_| {
    "Enter the TX frequency in Hz using digits only".to_string()
  })?;
  if !(1_000_000..=u32::MAX as u64).contains(&frequency_hz) {
    return Err(format!(
      "TX frequency must be between 1000000 and {} Hz",
      u32::MAX
    ));
  }
  Ok(frequency_hz as u32)
}

fn make_zero_iq_payload(byte_len: usize) -> Vec<u8> {
  vec![128; byte_len & !1]
}

#[cfg(test)]
mod tests {
  use super::{make_zero_iq_payload, parse_tx_frequency_hz};

  #[test]
  fn accepts_hackrf_tx_frequency_in_hertz() {
    assert_eq!(parse_tx_frequency_hz("28000000").unwrap(), 28_000_000);
  }

  #[test]
  fn rejects_frequency_outside_sdr_processor_range() {
    assert!(parse_tx_frequency_hz("0").is_err());
    assert!(parse_tx_frequency_hz("5000000000").is_err());
    assert!(parse_tx_frequency_hz("not-a-frequency").is_err());
  }

  #[test]
  fn creates_centered_zero_amplitude_iq_for_led_only_tx_check() {
    assert_eq!(make_zero_iq_payload(8), vec![128; 8]);
    assert!(make_zero_iq_payload(0).is_empty());
  }
}

#[cfg(has_hackrf)]
fn main() {
  if let Err(error) = run_controller() {
    emit(&serde_json::json!({"type": "error", "message": error.to_string()}));
    std::process::exit(1);
  }
}

#[cfg(not(has_hackrf))]
fn main() {
  eprintln!("This build of n-apt-backend does not include HackRF support.");
  std::process::exit(2);
}

#[cfg(has_hackrf)]
#[derive(serde::Deserialize)]
struct Command {
  action: String,
  frequency_hz: Option<String>,
}

#[cfg(has_hackrf)]
fn emit(value: &serde_json::Value) {
  println!("{value}");
  let _ = std::io::stdout().flush();
}

#[cfg(has_hackrf)]
fn run_controller() -> anyhow::Result<()> {
  use anyhow::Context;
  use n_apt_backend::sdr::hackrf::HackRfDevice;
  use n_apt_backend::sdr::SdrDevice;
  use std::sync::mpsc;
  use std::thread;
  use std::time::{Duration, Instant};

  let mut device = HackRfDevice::open_first().context(
    "Could not open HackRF One. Suggested fix: close other SDR apps, confirm `hackrf_info` reports `Found HackRF`, and launch from a host terminal with direct USB access.",
  )?;
  device.set_sample_rate(2_000_000)?;
  device.set_center_frequency(100_000_000)?;

  let (commands_tx, commands_rx) = mpsc::channel::<Result<Command, String>>();
  thread::spawn(move || {
    for line in std::io::stdin().lock().lines() {
      let parsed = line.map_err(|error| error.to_string()).and_then(|line| {
        serde_json::from_str::<Command>(&line)
          .map_err(|error| error.to_string())
      });
      if commands_tx.send(parsed).is_err() {
        break;
      }
    }
  });

  emit(&serde_json::json!({
    "type": "status",
    "mode": "standby",
    "serial": device.get_serial_number(),
    "sample_rate_hz": device.get_sample_rate(),
    "center_frequency_hz": device.get_center_frequency(),
    "message": "HackRF ready; use RX or TX controls"
  }));

  let mut last_report = Instant::now();
  let mut rx_frames = 0u64;
  let mut transmitting = false;
  let mut receiving = false;
  loop {
    match commands_rx.recv_timeout(Duration::from_millis(20)) {
      Ok(Ok(command)) => match command.action.as_str() {
        "rx" => {
          if transmitting {
            device
              .transmit_iq(None)
              .context("Could not return HackRF to RX")?;
            transmitting = false;
            receiving = true;
          } else if !receiving {
            device.initialize().context("Could not start HackRF RX")?;
            receiving = true;
          }
          emit(
            &serde_json::json!({"type": "status", "mode": "rx", "message": "RX stream active"}),
          );
          last_report = Instant::now();
        }
        "tx" => {
          let Some(frequency_input) = command.frequency_hz else {
            emit(
              &serde_json::json!({"type": "error", "message": "TX frequency is required"}),
            );
            continue;
          };
          let frequency_hz = match parse_tx_frequency_hz(&frequency_input) {
            Ok(frequency_hz) => frequency_hz,
            Err(message) => {
              emit(&serde_json::json!({"type": "error", "message": message}));
              continue;
            }
          };
          device
            .set_center_frequency(frequency_hz)
            .context("Failed to tune HackRF to the requested TX frequency")?;
          let payload = make_zero_iq_payload(262_144);
          device
            .transmit_iq(Some(&payload))
            .context("HackRF failed to start the TX stream")?;
          transmitting = true;
          receiving = false;
          emit(&serde_json::json!({
            "type": "status",
            "mode": "tx",
            "frequency_hz": frequency_hz,
            "message": "Zero-amplitude TX IQ stream active for LED/stream check"
          }));
          last_report = Instant::now();
        }
        "quit" => break,
        action => emit(&serde_json::json!({
          "type": "error",
          "message": format!("Unknown controller action: {action}")
        })),
      },
      Ok(Err(error)) => emit(&serde_json::json!({
        "type": "error",
        "message": format!("Invalid controller command: {error}")
      })),
      Err(mpsc::RecvTimeoutError::Timeout) => {
        if transmitting {
          if device
            .poll_transmit_health()
            .is_some_and(|health| health.recovery_needed)
          {
            emit(
              &serde_json::json!({"type": "error", "message": "HackRF TX stream needs recovery; stop the test and inspect the device"}),
            );
            break;
          }
        }
        if receiving
          && !transmitting
          && last_report.elapsed() >= Duration::from_millis(250)
        {
          match device.read_samples(2048) {
            Ok(samples) => {
              rx_frames += 1;
              emit(&serde_json::json!({
                "type": "heartbeat",
                "mode": "rx",
                "rx_frames": rx_frames,
                "sample_bytes": samples.data.len()
              }));
            }
            Err(error) => {
              emit(
                &serde_json::json!({"type": "error", "message": format!("HackRF RX read failed: {error}")}),
              );
            }
          }
          last_report = Instant::now();
        }
      }
      Err(mpsc::RecvTimeoutError::Disconnected) => break,
    }
  }

  if transmitting {
    device
      .transmit_iq(None)
      .context("Failed to stop the HackRF TX stream")?;
  }
  device.cleanup()?;
  emit(
    &serde_json::json!({"type": "status", "mode": "stopped", "message": "HackRF closed"}),
  );
  Ok(())
}
