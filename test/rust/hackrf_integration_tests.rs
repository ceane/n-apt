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
}
