//! Safe Rust wrapper around librtlsdr FFI bindings
//!
//! Provides a high-level interface for RTL-SDR device access with
//! proper error handling and resource cleanup.

use anyhow::{anyhow, Result};
use log::{debug, info, warn};
use std::ffi::CStr;
use std::os::raw::c_int;
use std::ptr;

use super::ffi;

/// Safe wrapper around an RTL-SDR device handle
pub struct RtlSdrDevice {
    dev: *mut ffi::RtlSdrDev,
    device_index: u32,
}

// SAFETY: The RTL-SDR device handle is accessed behind a Mutex in the server,
// so only one thread accesses it at a time.
unsafe impl Send for RtlSdrDevice {}

impl RtlSdrDevice {
    /// Get the number of RTL-SDR devices connected to the system
    pub fn get_device_count() -> u32 {
        unsafe { ffi::rtlsdr_get_device_count() }
    }

    /// Get the name of a device by index
    pub fn get_device_name(index: u32) -> String {
        unsafe {
            let name_ptr = ffi::rtlsdr_get_device_name(index);
            if name_ptr.is_null() {
                return format!("RTL-SDR Device #{}", index);
            }
            CStr::from_ptr(name_ptr)
                .to_string_lossy()
                .into_owned()
        }
    }

    /// Open an RTL-SDR device by index
    ///
    /// Returns None if the device cannot be opened (not plugged in, busy, etc.)
    pub fn open(index: u32) -> Result<Self> {
        let mut dev: *mut ffi::RtlSdrDev = ptr::null_mut();
        let ret = unsafe { ffi::rtlsdr_open(&mut dev, index) };
        if ret != 0 || dev.is_null() {
            return Err(anyhow!(
                "Failed to open RTL-SDR device #{} (error code: {})",
                index,
                ret
            ));
        }
        info!("Opened RTL-SDR device #{}: {}", index, Self::get_device_name(index));
        Ok(Self {
            dev,
            device_index: index,
        })
    }

    /// Try to open the first available RTL-SDR device
    pub fn open_first() -> Result<Self> {
        let count = Self::get_device_count();
        if count == 0 {
            return Err(anyhow!("No RTL-SDR devices found"));
        }
        info!("Found {} RTL-SDR device(s)", count);
        for i in 0..count {
            info!("  Device #{}: {}", i, Self::get_device_name(i));
        }
        Self::open(0)
    }

    /// Set the center frequency in Hz
    pub fn set_center_freq(&self, freq: u32) -> Result<()> {
        let ret = unsafe { ffi::rtlsdr_set_center_freq(self.dev, freq) };
        if ret != 0 {
            return Err(anyhow!("Failed to set center frequency to {} Hz", freq));
        }
        debug!("Center frequency set to {} Hz", freq);
        Ok(())
    }

    /// Get the current center frequency in Hz
    pub fn get_center_freq(&self) -> u32 {
        unsafe { ffi::rtlsdr_get_center_freq(self.dev) }
    }

    /// Set the sample rate in Hz
    pub fn set_sample_rate(&self, rate: u32) -> Result<()> {
        let ret = unsafe { ffi::rtlsdr_set_sample_rate(self.dev, rate) };
        if ret != 0 {
            return Err(anyhow!("Failed to set sample rate to {} Hz", rate));
        }
        info!("Sample rate set to {} Hz", rate);
        Ok(())
    }

    /// Get the current sample rate in Hz
    pub fn get_sample_rate(&self) -> u32 {
        unsafe { ffi::rtlsdr_get_sample_rate(self.dev) }
    }

    /// Set manual gain mode and gain value in tenths of dB
    ///
    /// Pass gain in tenths of dB (e.g., 496 = 49.6 dB).
    /// Use `get_tuner_gains()` to get valid gain values.
    pub fn set_tuner_gain(&self, gain: i32) -> Result<()> {
        // Enable manual gain mode
        let ret = unsafe { ffi::rtlsdr_set_tuner_gain_mode(self.dev, 1) };
        if ret != 0 {
            return Err(anyhow!("Failed to enable manual gain mode"));
        }
        let ret = unsafe { ffi::rtlsdr_set_tuner_gain(self.dev, gain as c_int) };
        if ret != 0 {
            return Err(anyhow!("Failed to set tuner gain to {} (tenths dB)", gain));
        }
        debug!("Tuner gain set to {:.1} dB", gain as f32 / 10.0);
        Ok(())
    }

    /// Get current tuner gain in tenths of dB
    pub fn get_tuner_gain(&self) -> i32 {
        unsafe { ffi::rtlsdr_get_tuner_gain(self.dev) as i32 }
    }

    /// Get list of valid tuner gains in tenths of dB
    pub fn get_tuner_gains(&self) -> Vec<i32> {
        // First call with null to get count
        let count = unsafe { ffi::rtlsdr_get_tuner_gains(self.dev, ptr::null_mut()) };
        if count <= 0 {
            return Vec::new();
        }
        let mut gains = vec![0i32; count as usize];
        unsafe {
            ffi::rtlsdr_get_tuner_gains(self.dev, gains.as_mut_ptr() as *mut c_int);
        }
        gains
    }

    /// Enable or disable AGC mode
    pub fn set_agc_mode(&self, enabled: bool) -> Result<()> {
        let ret = unsafe { ffi::rtlsdr_set_agc_mode(self.dev, if enabled { 1 } else { 0 }) };
        if ret != 0 {
            return Err(anyhow!("Failed to set AGC mode"));
        }
        debug!("AGC mode {}", if enabled { "enabled" } else { "disabled" });
        Ok(())
    }

    /// Enable or disable tuner gain mode (manual=1, automatic=0)
    pub fn set_tuner_gain_mode(&self, manual: bool) -> Result<()> {
        let ret = unsafe { ffi::rtlsdr_set_tuner_gain_mode(self.dev, if manual { 1 } else { 0 }) };
        if ret != 0 {
            return Err(anyhow!("Failed to set tuner gain mode"));
        }
        debug!("Tuner gain mode set to {}", if manual { "manual" } else { "automatic" });
        Ok(())
    }

    /// Set frequency correction in PPM
    pub fn set_freq_correction(&self, ppm: i32) -> Result<()> {
        let ret = unsafe { ffi::rtlsdr_set_freq_correction(self.dev, ppm as c_int) };
        if ret != 0 {
            warn!("Failed to set PPM correction to {} (may already be set)", ppm);
        }
        Ok(())
    }

    /// Get current frequency correction in PPM
    pub fn get_freq_correction(&self) -> i32 {
        unsafe { ffi::rtlsdr_get_freq_correction(self.dev) as i32 }
    }

    /// Get the maximum supported sample rate for this device
    /// Tests common sample rates and returns the highest one that works
    pub fn get_max_sample_rate(&self) -> u32 {
        // Common RTL-SDR sample rates to test (highest to lowest)
        let test_rates = [
            3_200_000,  // 3.2 MHz - common max
            2_800_000,  // 2.8 MHz
            2_560_000,  // 2.56 MHz
            2_400_000,  // 2.4 MHz
            2_048_000,  // 2.048 MHz
            1_920_000,  // 1.92 MHz
            1_800_000,  // 1.8 MHz
            1_600_000,  // 1.6 MHz
            1_440_000,  // 1.44 MHz
            1_200_000,  // 1.2 MHz
            1_024_000,  // 1.024 MHz
            960_000,    // 960 kHz
            900_001,    // 900 kHz (common for FM radio)
            480_000,    // 480 kHz
        ];

        let current_rate = self.get_sample_rate();
        let mut max_supported = current_rate;

        for &rate in &test_rates {
            let ret = unsafe { ffi::rtlsdr_set_sample_rate(self.dev, rate) };
            if ret == 0 {
                // Verify the rate was actually set
                let actual_rate = unsafe { ffi::rtlsdr_get_sample_rate(self.dev) };
                if actual_rate == rate {
                    max_supported = rate;
                }
            }
        }

        // Restore original sample rate
        let _ = unsafe { ffi::rtlsdr_set_sample_rate(self.dev, current_rate) };
        
        max_supported
    }

    /// Reset the device buffer (call before starting reads)
    pub fn reset_buffer(&self) -> Result<()> {
        let ret = unsafe { ffi::rtlsdr_reset_buffer(self.dev) };
        if ret != 0 {
            return Err(anyhow!("Failed to reset buffer"));
        }
        Ok(())
    }

    /// Read IQ samples synchronously
    ///
    /// Returns a Vec<u8> of interleaved I/Q samples (2 bytes per sample).
    /// `len` should be a multiple of 512 for best performance.
    pub fn read_sync(&self, len: usize) -> Result<Vec<u8>> {
        let mut buf = vec![0u8; len];
        let mut n_read: c_int = 0;
        let ret = unsafe {
            ffi::rtlsdr_read_sync(
                self.dev,
                buf.as_mut_ptr() as *mut std::os::raw::c_void,
                len as c_int,
                &mut n_read,
            )
        };
        if ret != 0 {
            return Err(anyhow!("Synchronous read failed (error code: {})", ret));
        }
        buf.truncate(n_read as usize);
        Ok(buf)
    }

    /// Read IQ samples synchronously into a pre-allocated buffer (zero-copy)
    ///
    /// Returns the number of bytes actually read.
    /// `buf` should be a multiple of 512 bytes for best performance.
    pub fn read_sync_into(&self, buf: &mut [u8]) -> Result<usize> {
        let mut n_read: c_int = 0;
        let ret = unsafe {
            ffi::rtlsdr_read_sync(
                self.dev,
                buf.as_mut_ptr() as *mut std::os::raw::c_void,
                buf.len() as c_int,
                &mut n_read,
            )
        };
        if ret != 0 {
            return Err(anyhow!("Synchronous read failed (error code: {})", ret));
        }
        Ok(n_read as usize)
    }

    /// Get the raw device pointer for sharing with the async reader thread.
    ///
    /// SAFETY: The pointer is only valid while the device is open.
    /// Caller must ensure cancel_async() + join before dropping the device.
    pub fn raw_ptr(&self) -> *mut ffi::RtlSdrDev {
        self.dev
    }

    /// Cancel an ongoing async read. Must be called from a different thread
    /// than the one running read_async. After this returns, the read_async
    /// call on the reader thread will unblock and return.
    pub fn cancel_async(&self) -> Result<()> {
        info!("Cancelling async read...");
        let ret = unsafe { ffi::rtlsdr_cancel_async(self.dev) };
        if ret != 0 {
            return Err(anyhow!("Cancel async failed (error code: {})", ret));
        }
        Ok(())
    }

    /// Get a formatted device info string
    pub fn get_device_info(&self) -> String {
        let name = Self::get_device_name(self.device_index);
        let freq = self.get_center_freq();
        let rate = self.get_sample_rate();
        let max_rate = self.get_max_sample_rate();
        let gain = self.get_tuner_gain();
        let ppm = self.get_freq_correction();
        
        format!(
            "{} - Freq: {} Hz, Rate: {} Hz (max: {} Hz), Gain: {:.1} dB, PPM: {}",
            name,
            freq,
            rate,
            max_rate,
            gain as f32 / 10.0,
            ppm
        )
    }
}

impl Drop for RtlSdrDevice {
    fn drop(&mut self) {
        if !self.dev.is_null() {
            info!("Closing RTL-SDR device #{}...", self.device_index);
            let ret = unsafe { ffi::rtlsdr_close(self.dev) };
            if ret != 0 {
                warn!("rtlsdr_close returned error code {} for device #{}", ret, self.device_index);
            } else {
                info!("RTL-SDR device #{} closed successfully", self.device_index);
            }
            self.dev = ptr::null_mut();
        }
    }
}
