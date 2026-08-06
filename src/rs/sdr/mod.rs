//! # Software Defined Radio (SDR) Abstraction Layer
//!
//! This module provides a pluggable interface for different SDR hardware and mock implementations.
//! It allows seamless switching between real hardware (RTL-SDR or HackRF One) and simulated signals for testing.
//!
//! ## Architecture
//!
//! - `SdrDevice` trait defines the common interface for all SDR implementations
//! - `mock_apt` module provides simulated signals with configurable shapes and noise
//! - `rtlsdr` module provides real hardware interface for RTL-SDR devices
//! - `hackrf` module provides real hardware interface for HackRF One devices
//! - `processor` contains the main signal processing pipeline

use crate::s::fft::types::RawSamples;
use anyhow::Result;
use std::thread;
use std::time::Duration;

#[cfg(has_hackrf)]
const HACKRF_OPEN_RETRY_ATTEMPTS: usize = 5;
#[cfg(has_hackrf)]
const HACKRF_OPEN_RETRY_DELAY: Duration = Duration::from_millis(250);

#[cfg(has_hackrf)]
fn open_hackrf_with_retry() -> Result<Box<dyn SdrDevice>> {
  let mut last_err = None;
  for attempt in 1..=HACKRF_OPEN_RETRY_ATTEMPTS {
    match crate::sdr::hackrf::HackRfDevice::open_first() {
      Ok(device) => {
        log::info!("Using HackRF One device after {} attempt(s)", attempt);
        return Ok(Box::new(device));
      }
      Err(err) => {
        last_err = Some(err);
        if attempt < HACKRF_OPEN_RETRY_ATTEMPTS {
          thread::sleep(HACKRF_OPEN_RETRY_DELAY);
        }
      }
    }
  }

  Err(
    last_err
      .unwrap_or_else(|| anyhow::anyhow!("Failed to open HackRF One device")),
  )
}

/// Common interface for all SDR device implementations
pub trait SdrDevice: Send {
  /// Device type identifier
  fn device_type(&self) -> &'static str;

  /// Get a formatted device info string
  fn get_device_info(&self) -> String;

  /// Initialize the device and prepare for operation
  fn initialize(&mut self) -> Result<()>;

  /// Suspend sample transfers while retaining the open device handle.
  fn enter_standby(&mut self) -> Result<()> {
    Ok(())
  }

  /// Check if device is ready for reading
  fn is_ready(&self) -> bool;

  /// Read IQ samples from the device
  fn read_samples(&mut self, fft_size: usize) -> Result<RawSamples>;

  /// Enable retention of a contiguous IQ stream alongside the display path.
  ///
  /// The display path keeps only the freshest frame, which is correct for a
  /// real-time waterfall but leaves a hole at every frame boundary. Consumers
  /// that need an unbroken timeline, such as audio demodulation, enable this
  /// tap. Devices without a streaming reader default to a no-op.
  fn set_audio_iq_tap_enabled(&mut self, _enabled: bool) {}

  /// Take the contiguous IQ retained since the last call, if the tap is active.
  fn take_audio_iq(&mut self) -> Option<audio_iq_tap::AudioIqBlock> {
    None
  }

  fn transmit_iq(&mut self, _samples: Option<&[u8]>) -> Result<()> {
    Err(anyhow::anyhow!("This SDR does not support transmission"))
  }

  /// Return an owned IQ sample buffer to devices that can reuse it.
  fn recycle_read_buffer(&mut self, _buffer: Vec<u8>) {}

  /// Set sample rate in Hz
  fn set_sample_rate(&mut self, rate: u32) -> Result<()>;

  /// Set center frequency in Hz
  fn set_center_frequency(&mut self, freq: u32) -> Result<()>;

  /// Set tuner gain in dB
  fn set_gain(&mut self, gain: f64) -> Result<()>;

  /// Set HackRF LNA gain in dB.
  /// Defaults to a no-op for devices that do not expose split gain controls.
  fn set_lna_gain(&mut self, _gain: f64) -> Result<()> {
    Ok(())
  }

  /// Set HackRF VGA gain in dB.
  /// Defaults to a no-op for devices that do not expose split gain controls.
  fn set_vga_gain(&mut self, _gain: f64) -> Result<()> {
    Ok(())
  }

  /// Enable/disable the HackRF RF amplifier.
  /// Defaults to a no-op for devices that do not expose an RF amp control.
  fn set_amp_enable(&mut self, _enabled: bool) -> Result<()> {
    Ok(())
  }

  /// Set frequency correction in PPM
  fn set_ppm(&mut self, ppm: u32) -> Result<()>;

  /// Enable/disable tuner AGC
  fn set_tuner_agc(&mut self, enabled: bool) -> Result<()>;

  /// Enable/disable RTL AGC
  fn set_rtl_agc(&mut self, enabled: bool) -> Result<()>;

  /// Enable/disable offset tuning
  fn set_offset_tuning(&mut self, enabled: bool) -> Result<()>;

  /// Set tuner bandwidth in Hz (0 = auto)
  fn set_tuner_bandwidth(&mut self, bw: u32) -> Result<()>;

  /// Set direct sampling mode (0 = off, 1 = I, 2 = Q)
  fn set_direct_sampling(&mut self, mode: u8) -> Result<()>;

  /// Get current center frequency
  fn get_center_frequency(&self) -> u32;

  /// Get current sample rate
  fn get_sample_rate(&self) -> u32;

  /// Get the maximum supported sample rate.
  /// Defaults to the current sample rate for devices that do not expose a ceiling.
  fn get_max_sample_rate(&mut self) -> u32 {
    self.get_sample_rate()
  }

  /// Flush software-side sample buffers (overflow + async queue) without
  /// touching the hardware. Called after frequency hops to discard stale
  /// samples from the previous tuning / PLL settling period.
  fn flush_read_queue(&mut self) {}

  /// Reset device buffers
  fn reset_buffer(&mut self) -> Result<()>;

  /// Cleanup resources
  fn cleanup(&mut self) -> Result<()>;

  /// Check if the device is still healthy (e.g. hasn't been unplugged).
  ///
  /// # Hotplug Contract
  ///
  /// Implementations return `false` on **any** sign of trouble (null handle,
  /// dead thread, USB error). This is intentionally aggressive — the caller
  /// is responsible for **debouncing** multiple consecutive failures before
  /// deciding to abandon the device and fall back to mock.
  fn is_healthy(&self) -> bool;

  /// Check if the device is actively streaming/receiving samples (Rx active)
  fn is_rx_active(&self) -> bool {
    false
  }

  /// Get the device serial number (empty string if unavailable)
  fn get_serial_number(&self) -> String {
    String::new()
  }

  /// Get the device manufacturer string (empty string if unavailable)
  fn get_manufacturer(&self) -> String {
    String::new()
  }

  /// Get the device product string (empty string if unavailable)
  fn get_product(&self) -> String {
    String::new()
  }

  fn get_firmware_version(&self) -> Option<String> {
    None
  }

  /// Get the last error message if any
  fn get_error(&self) -> Option<String>;
}

/// Device factory for creating SDR instances
pub struct SdrDeviceFactory;

impl SdrDeviceFactory {
  /// Create the appropriate SDR device based on availability
  pub fn create_device() -> Result<Box<dyn SdrDevice>> {
    // Prefer opening the device that is physically connected according to USB snapshots.
    let snapshots =
      match crate::sdr::hotplug::scan_supported_usb_device_snapshots() {
        Ok(s) => s,
        Err(_) => Vec::new(),
      };

    let has_hackrf_connected =
      snapshots.iter().any(|s| s.device_type == "hackrf_one");
    let has_rtlsdr_connected =
      snapshots.iter().any(|s| s.device_type == "rtl-sdr");

    #[cfg(has_hackrf)]
    {
      if has_hackrf_connected {
        if let Ok(device) = open_hackrf_with_retry() {
          return Ok(device);
        }
      }
    }

    if has_rtlsdr_connected {
      if let Ok(device) = crate::sdr::rtlsdr::RtlSdrDevice::open_first() {
        log::info!("Using RTL-SDR device");
        return Ok(Box::new(device));
      }
    }

    // If snapshots scan is inconclusive or both are listed, try to open HackRF then RTL-SDR
    #[cfg(has_hackrf)]
    {
      if let Ok(device) = open_hackrf_with_retry() {
        return Ok(device);
      }
    }

    match crate::sdr::rtlsdr::RtlSdrDevice::open_first() {
      Ok(device) => {
        log::info!("Using RTL-SDR device");
        Ok(Box::new(device))
      }
      Err(_) => Self::create_mock_fallback_device(),
    }
  }

  /// Force creation of a mock APT device
  pub fn create_mock_device() -> Box<dyn SdrDevice> {
    log::info!(
      "Creating mock APT SDR device with fixed seed for visual continuity"
    );
    // Use a fixed seed so frequencies stay aligned when swapping away and back
    Box::new(crate::sdr::mock_apt::MockAptDevice::new_with_seed(0x0A97))
  }

  /// Force creation of an RTL-SDR device (will error if none available)
  pub fn create_rtlsdr_device() -> Result<Box<dyn SdrDevice>> {
    let device = crate::sdr::rtlsdr::RtlSdrDevice::open_first()?;
    log::info!("Using RTL-SDR device");
    Ok(Box::new(device))
  }

  /// Force creation of a HackRF One device (will error if none available)
  #[cfg(has_hackrf)]
  pub fn create_hackrf_device() -> Result<Box<dyn SdrDevice>> {
    open_hackrf_with_retry()
  }

  #[cfg(not(has_hackrf))]
  pub fn create_hackrf_device() -> Result<Box<dyn SdrDevice>> {
    Err(anyhow::anyhow!(
      "HackRF One support not enabled at build time"
    ))
  }

  fn create_mock_fallback_device() -> Result<Box<dyn SdrDevice>> {
    log::info!(
      "No RTL-SDR or HackRF One device found, using mock APT implementation"
    );
    Ok(Box::new(crate::sdr::mock_apt::MockAptDevice::new()))
  }
}

pub mod audio_iq_tap;
pub mod hackrf;
pub mod hotplug;
pub mod mock_apt;
pub mod processor;
pub mod rtlsdr;

// Re-export common types
pub use processor::SdrProcessor;
