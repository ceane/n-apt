//! # Software Defined Radio (SDR) Abstraction Layer
//!
//! This module provides a pluggable interface for different SDR hardware and mock implementations.
//! It allows seamless switching between real hardware (RTL-SDR or HackRF) and simulated signals for testing.
//!
//! ## Architecture
//!
//! - `SdrDevice` trait defines the common interface for all SDR implementations
//! - `mock_apt` module provides simulated signals with configurable shapes and noise
//! - `rtlsdr` module provides real hardware interface for RTL-SDR devices
//! - `hackrf` module provides real hardware interface for HackRF devices
//! - `processor` contains the main signal processing pipeline

use crate::fft::types::RawSamples;
use anyhow::Result;

/// Common interface for all SDR device implementations
pub trait SdrDevice: Send {
  /// Device type identifier
  fn device_type(&self) -> &'static str;

  /// Get a formatted device info string
  fn get_device_info(&self) -> String;

  /// Initialize the device and prepare for operation
  fn initialize(&mut self) -> Result<()>;

  /// Check if device is ready for reading
  fn is_ready(&self) -> bool;

  /// Read IQ samples from the device
  fn read_samples(&mut self, fft_size: usize) -> Result<RawSamples>;

  /// Return an owned IQ sample buffer to devices that can reuse it.
  fn recycle_read_buffer(&mut self, _buffer: Vec<u8>) {}

  /// Set sample rate in Hz
  fn set_sample_rate(&mut self, rate: u32) -> Result<()>;

  /// Set center frequency in Hz
  fn set_center_frequency(&mut self, freq: u32) -> Result<()>;

  /// Set tuner gain in dB
  fn set_gain(&mut self, gain: f64) -> Result<()>;

  /// Set frequency correction in PPM
  fn set_ppm(&mut self, ppm: i32) -> Result<()>;

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

  /// Get the last error message if any
  fn get_error(&self) -> Option<String>;
}

/// Device factory for creating SDR instances
pub struct SdrDeviceFactory;

impl SdrDeviceFactory {
  /// Create the appropriate SDR device based on availability
  pub fn create_device() -> Result<Box<dyn SdrDevice>> {
    // Prefer HackRF when both devices are present, then fall back to RTL-SDR,
    // then finally to the mock device.
    #[cfg(has_hackrf)]
    {
      if let Ok(device) = crate::sdr::hackrf::HackRfDevice::open_first() {
        log::info!("Using HackRF device");
        return Ok(Box::new(device));
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
    log::info!("Creating mock APT SDR device");
    #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
    {
      return Box::new(crate::sdr::mock_apt::MockAptDevice::new_with_gpu_backend());
    }

    #[cfg(not(all(feature = "mock_apt_metal", target_os = "macos")))]
    {
      Box::new(crate::sdr::mock_apt::MockAptDevice::new())
    }
  }

  /// Force creation of an RTL-SDR device (will error if none available)
  pub fn create_rtlsdr_device() -> Result<Box<dyn SdrDevice>> {
    let device = crate::sdr::rtlsdr::RtlSdrDevice::open_first()?;
    log::info!("Using RTL-SDR device");
    Ok(Box::new(device))
  }

  /// Force creation of a HackRF device (will error if none available)
  #[cfg(has_hackrf)]
  pub fn create_hackrf_device() -> Result<Box<dyn SdrDevice>> {
    let device = crate::sdr::hackrf::HackRfDevice::open_first()?;
    log::info!("Using HackRF device");
    Ok(Box::new(device))
  }

  #[cfg(not(has_hackrf))]
  pub fn create_hackrf_device() -> Result<Box<dyn SdrDevice>> {
    Err(anyhow::anyhow!("HackRF support not enabled at build time"))
  }

  fn create_mock_fallback_device() -> Result<Box<dyn SdrDevice>> {
    log::info!(
      "No RTL-SDR or HackRF device found, using mock APT implementation"
    );
    #[cfg(all(feature = "mock_apt_metal", target_os = "macos"))]
    {
      return Ok(Box::new(
        crate::sdr::mock_apt::MockAptDevice::new_with_gpu_backend(),
      ));
    }

    #[cfg(not(all(feature = "mock_apt_metal", target_os = "macos")))]
    {
      Ok(Box::new(crate::sdr::mock_apt::MockAptDevice::new()))
    }
  }
}

#[cfg(has_hackrf)]
pub mod hackrf;
pub mod hotplug;
pub mod mock_apt;
pub mod processor;
pub mod rtlsdr;

// Re-export common types
pub use processor::SdrProcessor;
