#[cfg(all(test, has_hackrf))]
use anyhow::Result;

#[cfg(all(test, has_hackrf))]
mod hackrf_integration_tests {
  use super::*;
  use n_apt_backend::sdr::hackrf::HackRfDevice;
  use n_apt_backend::sdr::SdrDevice;

  #[test]
  fn hackrf_device_discovery_or_graceful_skip() -> Result<()> {
    let device = HackRfDevice::open_first();
    match device {
      Ok(mut dev) => {
        dev.initialize()?;
        assert_eq!(dev.device_type(), "hackrf_one");
        assert!(dev.get_sample_rate() >= 2_000_000);
        dev.cleanup()?;
      }
      Err(err) => {
        // Keep this test useful in environments without attached hardware.
        eprintln!("Skipping live HackRF One exercise: {}", err);
      }
    }
    Ok(())
  }

  /// A live VFO retune must retune in place: no RX stop/restart, and the next
  /// read must carry new samples instead of the reader being stranded stopped.
  #[test]
  fn live_retune_keeps_the_reader_streaming() -> Result<()> {
    let device = HackRfDevice::open_first();
    let Ok(mut dev) = device else {
      eprintln!("Skipping live HackRF One retune exercise: no device attached");
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
