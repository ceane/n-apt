//! Safe Rust wrapper around librtlsdr FFI bindings
//!
//! Provides a high-level interface for RTL-SDR device access with
//! proper error handling and resource cleanup.

use anyhow::{anyhow, Result};
use crossbeam_channel::{bounded, Receiver, Sender};
use log::{debug, info, warn};
use std::ffi::CStr;
use std::os::raw::c_int;
use std::ptr;
use std::thread::{self, JoinHandle};

use super::ffi;
use crate::sdr::SdrDevice;

pub struct RtlSdrDevice {
    dev: *mut ffi::RtlSdrDev,
    device_index: u32,
    rx_queue: Option<Receiver<Vec<u8>>>,
    async_thread: Option<JoinHandle<()>>,
    iq_overflow: Vec<u8>,
    max_sample_rate_cache: Option<u32>,
    last_error: Option<String>,
}

struct AsyncContext {
    tx: Sender<Vec<u8>>,
    rx: Receiver<Vec<u8>>,
}

/// Asynchronous callback for RTL-SDR block events
extern "C" fn c_read_async_cb(buf: *mut u8, len: u32, ctx: *mut std::os::raw::c_void) {
    if buf.is_null() || ctx.is_null() || len == 0 {
        return;
    }
    
    let context = unsafe { &*(ctx as *const AsyncContext) };
    let data_slice = unsafe { std::slice::from_raw_parts(buf, len as usize) };
    
    // Copy out from C buffer immediately
    let chunk = data_slice.to_vec();
    
    // If the queue is full, we MUST drop the oldest frame, NOT the newest frame!
    // Dropping the newest frame creates a phase discontinuity hole right in the 
    // middle of our constructed FFT window. By popping the oldest frame, we just 
    // slide the continuous time-window forward.
    while let Err(crossbeam_channel::TrySendError::Full(_)) = context.tx.try_send(chunk.clone()) {
        let _ = context.rx.try_recv(); // Pop oldest
    }
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
        
        let device = Self {
            dev,
            device_index: index,
            rx_queue: None,
            async_thread: None,
            iq_overflow: Vec::new(),
            max_sample_rate_cache: None,
            last_error: None,
        };

        // Set mandatory default sample rate so get_device_info doesn't return 0Hz
        // and initial processing doesn't fail.
        let _ = device.set_sample_rate(3_200_000);
        
        Ok(device)
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
        
        // Verify the rate was actually set correctly
        let actual_rate = unsafe { ffi::rtlsdr_get_sample_rate(self.dev) };
        if actual_rate != rate {
            warn!("Sample rate mismatch: requested {} Hz, device reports {} Hz", rate, actual_rate);
        } else {
            info!("Sample rate verified: {} Hz", rate);
        }
        
        Ok(())
    }

    /// Get the current sample rate in Hz
    pub fn get_sample_rate(&self) -> u32 {
        unsafe { ffi::rtlsdr_get_sample_rate(self.dev) }
    }
    
    #[allow(dead_code)]
    fn get_center_frequency(&self) -> u32 {
        self.get_center_freq()
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
    pub fn get_max_sample_rate(&mut self) -> u32 {
        if let Some(cached) = self.max_sample_rate_cache {
            return cached;
        }

        // Common RTL-SDR sample rates to test (highest to lowest)
        let test_rates = [
            // Max sample rate for RTL-SDR Blog V4
            // Required to correctly view N-APT due to nyquist limi
            3_200_000,  // 3.2 MHz - common max
            // Always selecting max
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

        let mut current_rate = self.get_sample_rate();
        // If the device was just opened, the sample rate might read as 0
        // in which case we should restore to our desired default (3.2MHz)
        if current_rate == 0 {
            current_rate = 3_200_000;
        }

        info!("Sample rate is set at {} Hz", current_rate);

        let mut max_supported = current_rate;

        // Test from highest to lowest, stop at first successful rate
        for &rate in &test_rates {
            let ret = unsafe { ffi::rtlsdr_set_sample_rate(self.dev, rate) };
            if ret == 0 {
                // Verify the rate was actually set
                let actual_rate = unsafe { ffi::rtlsdr_get_sample_rate(self.dev) };
                if actual_rate == rate {
                    max_supported = rate;
                    break; // Found the highest supported rate, stop testing
                }
            }
        }

        info!("After testing sample rate is set to {} Hz",  current_rate);

        // Restore original sample rate
        let restore_ret = unsafe { ffi::rtlsdr_set_sample_rate(self.dev, current_rate) };
        if restore_ret != 0 {
            warn!("Failed to restore original sample rate {} Hz (error code: {})", current_rate, restore_ret);
        } else {
            let restored_rate = unsafe { ffi::rtlsdr_get_sample_rate(self.dev) };
            if restored_rate != current_rate {
                warn!("Sample rate not properly restored: expected {} Hz, got {} Hz", current_rate, restored_rate);
            }
        }
        
        self.max_sample_rate_cache = Some(max_supported);
        max_supported
    }

    /// Reset the device buffer (call before starting reads)
    pub fn reset_buffer(&self) -> Result<()> {
        info!("Resetting RTL-SDR device buffer...");
        let ret = unsafe { ffi::rtlsdr_reset_buffer(self.dev) };
        if ret != 0 {
            return Err(anyhow!("Failed to reset buffer"));
        }
        Ok(())
    }

    // DO NOT READ SYNCHRONOUSLY
    /// RTL-SDR will not allow you to change options
    /// This will cause problems when adjusting SDR settings
    /// 
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
    // DO NOT READ SYNCHRONOUSLY
    /// RTL-SDR will not allow you to change options
    /// This will cause problems when adjusting SDR settings
    /// 
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

    /// Read IQ samples asynchronously
    ///
    /// The callback will be called repeatedly with chunks of IQ data.
    /// Blocks until cancel_async is called from another thread.
    pub fn read_async(
        &self,
        cb: ffi::RtlSdrReadAsyncCb,
        ctx: *mut std::os::raw::c_void,
        buf_num: u32,
        buf_len: u32,
    ) -> Result<()> {
        let ret = unsafe { ffi::rtlsdr_read_async(self.dev, cb, ctx, buf_num, buf_len) };
        if ret != 0 {
            return Err(anyhow!("Asynchronous read failed (error code: {})", ret));
        }
        Ok(())
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
        // This is now &mut self or we need to avoid calling it here if we want to keep get_device_info as &self
        // Actually, get_device_info is called from many places.
        // Let's just make it return a default or use the cached value if available.
        let max_rate = self.max_sample_rate_cache.unwrap_or(3_200_000);
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
            
            if self.async_thread.is_some() {
                let _ = unsafe { ffi::rtlsdr_cancel_async(self.dev) };
                if let Some(handle) = self.async_thread.take() {
                    let _ = handle.join();
                }
            }
            
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

impl SdrDevice for RtlSdrDevice {
    fn device_type(&self) -> &'static str {
        "RTL-SDR"
    }
    
    fn get_device_info(&self) -> String {
        self.get_device_info()
    }
    
    fn initialize(&mut self) -> Result<()> {
        // Allow re-initialization if the thread has exited or the queue is gone
        if let Some(handle) = &self.async_thread {
            if !handle.is_finished() {
                return Ok(());
            }
            // Thread finished (likely crashed), cleanup before restart
            let _ = self.async_thread.take().unwrap().join();
        }
        
        self.reset_buffer()?;
        
        let (tx, rx) = bounded::<Vec<u8>>(1024);
        let rx_for_device = rx.clone();
        self.rx_queue = Some(rx_for_device);
        self.iq_overflow.clear();
        
        let dev_ptr_val = self.dev as usize;
        let device_index = self.device_index;
        
        let context = Box::new(AsyncContext { tx, rx });
        let ctx_ptr_val = Box::into_raw(context) as usize;
        
        let handle = thread::spawn(move || {
            let dev_ptr = dev_ptr_val as *mut ffi::RtlSdrDev;
            let ctx_ptr = ctx_ptr_val as *mut std::os::raw::c_void;
            
            info!("Starting RTL-SDR async read thread for device #{}", device_index);
            
            // macOS often fails with LIBUSB_ERROR_IO (-5) if bulk transfers are too large.
            // 32 buffers of 16KB (16384 bytes) handles 512KB queue, safe for macOS USB.
            // Ensure buf_len is a multiple of 512.
            let buf_num = 32;
            let buf_len = 16384;
            
            let ret = unsafe {
                ffi::rtlsdr_read_async(dev_ptr, Some(c_read_async_cb), ctx_ptr, buf_num, buf_len)
            };
            
            info!("RTL-SDR async read thread for device #{} exited with code {}", device_index, ret);
            let _ = unsafe { Box::from_raw(ctx_ptr as *mut AsyncContext) };
        });
        
        self.async_thread = Some(handle);
        Ok(())
    }
    
    fn is_ready(&self) -> bool {
        !self.dev.is_null() && self.async_thread.is_some()
    }
    
    fn read_samples(&mut self, fft_size: usize) -> Result<crate::fft::types::RawSamples> {
        let bytes_needed = fft_size * 2;
        
        if let Some(rx) = &self.rx_queue {
            // First, aggressively drain any queued backlog to stay real-time!
            while let Ok(chunk) = rx.try_recv() {
                self.iq_overflow.extend_from_slice(&chunk);
            }
            
            // If we don't have enough to satisfy one valid, contiguous FFT frame, wait.
            while self.iq_overflow.len() < bytes_needed {
                // If the async thread died (often due to sudden unplug), stop waiting immediately.
                if let Some(handle) = &self.async_thread {
                    if handle.is_finished() {
                        return Err(anyhow::anyhow!("Async reader thread died prematurely"));
                    }
                }

                // Wait up to 100ms for more samples to arrive.
                // Shorter timeout (previously 500ms) improves responsiveness during device failure.
                match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(chunk) => {
                        self.iq_overflow.extend_from_slice(&chunk);
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                        // Check health again on timeout to avoid hanging if the thread is stuck
                        if let Some(handle) = &self.async_thread {
                            if handle.is_finished() {
                                return Err(anyhow::anyhow!("Async reader thread died during timeout"));
                            }
                        }
                        return Err(anyhow::anyhow!("Timeout waiting for async SDR samples"));
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                        return Err(anyhow::anyhow!("Async reader thread disconnected"));
                    }
                }
            }
            
            // Force even alignment before checking length, so that if an odd-length
            // chunk arrived from libusb, we drop the stray byte and restore I/Q parity.
            if self.iq_overflow.len() % 2 != 0 {
                self.iq_overflow.drain(0..1);
            }

            // To maintain real-time performance and prevent an infinite memory 
            // backlog, discard the oldest samples. Keep only the freshest.
            if self.iq_overflow.len() > bytes_needed {
                let excess = self.iq_overflow.len() - bytes_needed;
                // Ensure we discard an EVEN number of bytes so we don't swap
                // the I and Q interleaving, which would flip the FFT spectrum.
                let discard = excess & !1;
                self.iq_overflow.drain(0..discard);
            }
            
        } else {
            return Err(anyhow::anyhow!("Device not initialized for async reading"));
        }
        
        let bytes_to_take = bytes_needed; // Guaranteed by the while condition
        let data = self.iq_overflow.drain(..bytes_to_take).collect::<Vec<u8>>();
        
        Ok(crate::fft::types::RawSamples { 
            data,
            sample_rate: self.get_sample_rate()
        })
    }
    
    fn set_sample_rate(&mut self, rate: u32) -> Result<()> {
        RtlSdrDevice::set_sample_rate(self, rate)
    }
    
    fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
        self.set_center_freq(freq)
    }
    
    fn set_gain(&mut self, gain: f64) -> Result<()> {
        self.set_tuner_gain((gain * 10.0) as i32)
    }
    
    fn set_ppm(&mut self, ppm: i32) -> Result<()> {
        self.set_freq_correction(ppm)
    }
    
    fn set_tuner_agc(&mut self, enabled: bool) -> Result<()> {
        self.set_agc_mode(enabled)
    }
    
    fn set_rtl_agc(&mut self, enabled: bool) -> Result<()> {
        self.set_agc_mode(enabled)
    }
    
    fn reset_buffer(&mut self) -> Result<()> {
        RtlSdrDevice::reset_buffer(self)
    }
    
    fn get_center_frequency(&self) -> u32 {
        self.get_center_freq()
    }
    
    fn get_sample_rate(&self) -> u32 {
        unsafe { ffi::rtlsdr_get_sample_rate(self.dev) }
    }
    
    fn cleanup(&mut self) -> Result<()> {
        // Device is automatically cleaned up by Drop trait
        Ok(())
    }

    fn is_healthy(&self) -> bool {
        // Check if the device handle is still valid and the async thread is either
        // still running or hasn't been started yet.
        if self.dev.is_null() {
            return false;
        }

        if let Some(handle) = &self.async_thread {
            if handle.is_finished() {
                // Thread died prematurely (often due to LIBUSB_ERROR_NO_DEVICE)
                return false;
            }
        }

        true
    }

    fn get_error(&self) -> Option<String> {
        self.last_error.clone()
    }
}
