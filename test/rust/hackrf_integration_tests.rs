#[cfg(all(test, has_hackrf))]
use anyhow::{Context, Result};

#[cfg(all(test, has_hackrf))]
mod hackrf_integration_tests {
  use super::*;
  use n_apt_backend::sdr::hackrf::HackRfDevice;
  use n_apt_backend::sdr::SdrDevice;

  fn resolve_hackrf_open<T>(
    result: Result<T>,
    required: bool,
    activity: &str,
  ) -> Result<Option<T>> {
    match result {
      Ok(device) => Ok(Some(device)),
      Err(error) if required => Err(error).context(format!(
        "HACKRF_TEST_REQUIRE_DEVICE=1: {activity} could not open HackRF One. Suggested fix: verify the USB cable and power, confirm `hackrf_info` reports `Found HackRF`, close other SDR applications, and rerun with direct host USB access outside the sandbox."
      )),
      Err(error) => {
        eprintln!("Skipping {activity}: {error:#}");
        Ok(None)
      }
    }
  }

  fn open_hackrf_for_test(activity: &str) -> Result<Option<HackRfDevice>> {
    let required = std::env::var("HACKRF_TEST_REQUIRE_DEVICE")
      .is_ok_and(|value| {
        matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes")
      });
    resolve_hackrf_open(HackRfDevice::open_first(), required, activity)
  }

  #[test]
  fn missing_hackrf_is_an_error_when_manual_test_requires_hardware() {
    let result = resolve_hackrf_open::<()>(
      Err(anyhow::anyhow!("No HackRF boards found")),
      true,
      "manual TX test",
    );

    let error = result.expect_err("required hardware must not silently skip");
    assert!(error.to_string().contains("manual TX test"));
    assert!(error.to_string().contains("HACKRF_TEST_REQUIRE_DEVICE=1"));
    assert!(error.to_string().contains("hackrf_info"));
    assert!(error.to_string().contains("outside the sandbox"));
  }

  #[test]
  fn missing_hackrf_remains_a_skip_for_unconfigured_test_runs() {
    let result = resolve_hackrf_open::<()>(
      Err(anyhow::anyhow!("No HackRF boards found")),
      false,
      "optional RX test",
    )
    .expect("optional test should skip cleanly");

    assert!(result.is_none());
  }

  #[test]
  fn hackrf_device_discovery_or_graceful_skip() -> Result<()> {
    let Some(mut dev) =
      open_hackrf_for_test("live HackRF One discovery exercise")?
    else {
      return Ok(());
    };
    dev.initialize()?;
    assert_eq!(dev.device_type(), "hackrf_one");
    assert!(dev.get_sample_rate() >= 2_000_000);
    dev.cleanup()?;
    Ok(())
  }

  /// A live VFO retune must retune in place: no RX stop/restart, and the next
  /// read must carry new samples instead of the reader being stranded stopped.
  #[test]
  fn live_retune_keeps_the_reader_streaming() -> Result<()> {
    let Some(mut dev) =
      open_hackrf_for_test("live HackRF One retune exercise")?
    else {
      return Ok(());
    };

    dev.set_sample_rate(3_200_000)?;
    dev.set_center_frequency(100_000_000)?;
    dev.initialize()?;

    let first = dev.read_samples(2048)?;
    assert!(!first.data.is_empty(), "initial HackRF RX frame was empty");

    dev.set_center_frequency_live(101_000_000)?;
    assert_eq!(dev.get_center_frequency(), 101_000_000);
    let second = dev.read_samples(2048)?;
    assert!(
      !second.data.is_empty(),
      "RX stream did not continue after a live retune"
    );

    dev.cleanup()?;
    Ok(())
  }
}
