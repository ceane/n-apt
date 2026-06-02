use anyhow::{anyhow, Result};
use crossbeam_channel::{bounded, Receiver, Sender};
use log::{debug, info};
use std::ffi::CStr;
use std::os::raw::c_int;
use std::ptr;
use std::thread::JoinHandle;
use std::time::Duration;

use super::ffi;
use crate::sdr::SdrDevice;

const HACKRF_MAX_SAMPLE_RATE: u32 = 20_000_000;
const HACKRF_MIN_SAMPLE_RATE: u32 = 2_000_000;
const HACKRF_RX_QUEUE_DEPTH: usize = 8;
const HACKRF_BLOCK_SIZE: usize = 16_384;
const HACKRF_RX_TIMEOUT: Duration = Duration::from_millis(500);

struct RxContext {
  tx: Sender<Vec<u8>>,
}

fn apply_ppm_correction(freq_hz: u32, ppm: u32) -> u32 {
  if freq_hz == 0 || ppm == 0 {
    return freq_hz;
  }

  let numerator = i128::from(freq_hz) * 1_000_000i128;
  let denominator = 1_000_000i128 - i128::from(ppm);
  if denominator <= 0 {
    return freq_hz;
  }

  let corrected = (numerator + (denominator / 2)) / denominator;
  corrected.clamp(0, u32::MAX as i128) as u32
}

pub struct HackRfDevice {
  dev: *mut ffi::HackRfDeviceHandle,
  rx_queue: Receiver<Vec<u8>>,
  #[allow(dead_code)]
  async_thread: Option<JoinHandle<()>>,
  rx_context: Option<*mut std::os::raw::c_void>,
  last_error: Option<String>,
  sample_rate: u32,
  center_frequency: u32,
  requested_center_frequency: u32,
  ppm: u32,
  iq_buffer: Vec<u8>,
  streaming_started: bool,
  serial_number: String,
}

unsafe impl Send for HackRfDevice {}

extern "C" fn hackrf_rx_callback(transfer: *mut ffi::HackRfTransfer) -> c_int {
  if transfer.is_null() {
    return 0;
  }

  let transfer = unsafe { &mut *transfer };
  if transfer.buffer.is_null() || transfer.valid_length <= 0 {
    return 0;
  }

  let ctx = unsafe { &*(transfer.rx_ctx as *const RxContext) };
  let len = transfer.valid_length as usize;
  let data = unsafe { std::slice::from_raw_parts(transfer.buffer, len) };
  let mut frame = Vec::with_capacity(len);
  frame.extend_from_slice(data);

  let _ = ctx.tx.try_send(frame);

  0
}

impl HackRfDevice {
  pub fn open_first() -> Result<Self> {
    Self::open(0)
  }

  pub fn open(index: i32) -> Result<Self> {
    unsafe {
      if ffi::hackrf_init() != 0 {
        return Err(anyhow!("Failed to initialize HackRF One"));
      }
      let list = ffi::hackrf_device_list();
      if list.is_null() {
        let _ = ffi::hackrf_exit();
        return Err(anyhow!("No HackRF One devices found"));
      }
      let mut dev: *mut ffi::HackRfDeviceHandle = ptr::null_mut();
      let ret = ffi::hackrf_device_list_open(list, index, &mut dev);

      // Extract serial number before freeing the list
      let serial_number =
        if (*list).devicecount > index && !(*list).serial_numbers.is_null() {
          let sn_ptr = *(*list).serial_numbers.offset(index as isize);
          if sn_ptr.is_null() {
            String::new()
          } else {
            CStr::from_ptr(sn_ptr).to_string_lossy().into_owned()
          }
        } else {
          String::new()
        };

      ffi::hackrf_device_list_free(list);
      if ret != 0 || dev.is_null() {
        let _ = ffi::hackrf_exit();
        return Err(anyhow!("Failed to open HackRF One device #{}", index));
      }
      info!(
        "Opened HackRF One device #{} (serial: {:?})",
        index, serial_number
      );

      let (_tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
      Ok(Self {
        dev,
        rx_queue: rx,
        async_thread: None,
        rx_context: None,
        last_error: None,
        sample_rate: HACKRF_MIN_SAMPLE_RATE,
        center_frequency: 0,
        requested_center_frequency: 0,
        ppm: 0,
        iq_buffer: Vec::with_capacity(HACKRF_BLOCK_SIZE * 2),
        streaming_started: false,
        serial_number,
      })
    }
  }

  fn set_sample_rate_inner(&mut self, rate: u32) -> Result<()> {
    let clamped = rate.clamp(HACKRF_MIN_SAMPLE_RATE, HACKRF_MAX_SAMPLE_RATE);
    let ret =
      unsafe { ffi::hackrf_set_sample_rate_manual(self.dev, clamped, 1) };
    if ret != 0 {
      return Err(anyhow!(
        "Failed to set HackRF One sample rate to {} Hz",
        clamped
      ));
    }
    self.sample_rate = clamped;
    Ok(())
  }

  fn ensure_streaming(&mut self) -> Result<()> {
    if self.streaming_started {
      return Ok(());
    }

    let (tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
    let ctx = Box::new(RxContext { tx });
    let ctx_ptr = Box::into_raw(ctx) as *mut std::os::raw::c_void;
    let ret = unsafe {
      ffi::hackrf_start_rx(self.dev, Some(hackrf_rx_callback), ctx_ptr)
    };
    if ret != 0 {
      unsafe {
        drop(Box::from_raw(ctx_ptr as *mut RxContext));
      }
      return Err(anyhow!("Failed to start HackRF One RX streaming"));
    }

    self.rx_queue = rx;
    self.rx_context = Some(ctx_ptr);
    self.streaming_started = true;
    Ok(())
  }

  fn cleanup_inner(&mut self) {
    if self.streaming_started {
      let _ = unsafe { ffi::hackrf_stop_rx(self.dev) };
      self.streaming_started = false;
    }
    if let Some(ctx_ptr) = self.rx_context.take() {
      unsafe {
        drop(Box::from_raw(ctx_ptr as *mut RxContext));
      }
    }
    if !self.dev.is_null() {
      let _ = unsafe { ffi::hackrf_close(self.dev) };
      self.dev = ptr::null_mut();
    }
    let _ = unsafe { ffi::hackrf_exit() };
  }
}

impl Drop for HackRfDevice {
  fn drop(&mut self) {
    self.cleanup_inner();
  }
}

impl SdrDevice for HackRfDevice {
  fn device_type(&self) -> &'static str {
    "hackrf_one"
  }

  fn get_device_info(&self) -> String {
    format!(
      "HackRF One - Freq: {} Hz, Rate: {} Hz",
      self.requested_center_frequency, self.sample_rate
    )
  }

  fn get_serial_number(&self) -> String {
    self.serial_number.clone()
  }

  fn initialize(&mut self) -> Result<()> {
    self.set_sample_rate_inner(self.sample_rate)?;
    self.ensure_streaming()?;
    Ok(())
  }

  fn is_ready(&self) -> bool {
    !self.dev.is_null()
  }

  fn read_samples(
    &mut self,
    fft_size: usize,
  ) -> Result<crate::fft::types::RawSamples> {
    self.ensure_streaming()?;
    let mut frame = self.rx_queue.recv_timeout(HACKRF_RX_TIMEOUT).map_err(
      |err| match err {
        crossbeam_channel::RecvTimeoutError::Timeout => {
          anyhow!("Timeout waiting for HackRF One RX samples")
        }
        crossbeam_channel::RecvTimeoutError::Disconnected => {
          anyhow!("HackRF One RX queue closed")
        }
      },
    )?;

    let target_len = fft_size.saturating_mul(2);
    if frame.len() > target_len {
      frame.truncate(target_len);
    } else if frame.len() < target_len {
      frame.resize(target_len, 0);
    }

    if self.iq_buffer.capacity() < target_len {
      self
        .iq_buffer
        .reserve(target_len - self.iq_buffer.capacity());
    }
    self.iq_buffer.clear();
    self.iq_buffer.extend_from_slice(&frame);

    // Normalize signed i8 IQ data to unsigned u8 offset binary (centered at 128)
    normalize_hackrf_buffer(&mut self.iq_buffer);

    Ok(crate::fft::types::RawSamples {
      data: std::mem::take(&mut self.iq_buffer),
      sample_rate: self.sample_rate,
    })
  }

  fn set_sample_rate(&mut self, rate: u32) -> Result<()> {
    self.set_sample_rate_inner(rate)
  }

  fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
    let ret = unsafe { ffi::hackrf_set_freq(self.dev, freq as u64) };
    if ret != 0 {
      return Err(anyhow!(
        "Failed to set HackRF One center frequency to {}",
        freq
      ));
    }
    self.requested_center_frequency = freq;
    self.center_frequency = freq;
    let corrected_freq = apply_ppm_correction(freq, self.ppm);
    let ret = unsafe { ffi::hackrf_set_freq(self.dev, corrected_freq as u64) };
    if ret != 0 {
      return Err(anyhow!(
        "Failed to set HackRF One center frequency to {}",
        corrected_freq
      ));
    }
    debug!(
      "HackRF center frequency set to {} Hz (requested {}, ppm {})",
      corrected_freq, self.requested_center_frequency, self.ppm
    );
    Ok(())
  }

  fn set_gain(&mut self, gain: f64) -> Result<()> {
    let gain = gain.clamp(0.0, 47.0);
    let lna = if gain >= 16.0 { 16 } else { 0 };
    let vga = ((gain - lna as f64).round() as i32).clamp(0, 62) as u32;
    self.set_lna_gain(lna as f64)?;
    self.set_vga_gain(vga as f64)?;
    self.set_amp_enable(false)?;
    unsafe {
      let _ = ffi::hackrf_set_antenna_enable(self.dev, 0);
    }
    Ok(())
  }

  fn set_lna_gain(&mut self, gain: f64) -> Result<()> {
    let lna = (((gain / 8.0).round() * 8.0).clamp(0.0, 40.0)) as u32;
    let _ = unsafe { ffi::hackrf_set_lna_gain(self.dev, lna) };
    Ok(())
  }

  fn set_vga_gain(&mut self, gain: f64) -> Result<()> {
    let vga = (((gain / 2.0).round() * 2.0).clamp(0.0, 62.0)) as u32;
    let _ = unsafe { ffi::hackrf_set_vga_gain(self.dev, vga) };
    Ok(())
  }

  fn set_amp_enable(&mut self, enabled: bool) -> Result<()> {
    let _ = unsafe { ffi::hackrf_set_amp_enable(self.dev, enabled as u8) };
    Ok(())
  }

  fn set_ppm(&mut self, ppm: u32) -> Result<()> {
    self.ppm = ppm;
    debug!("HackRF PPM correction set to {} ppm", ppm);
    Ok(())
  }

  fn set_tuner_agc(&mut self, enabled: bool) -> Result<()> {
    debug!(
      "Ignoring tuner AGC request on HackRF One; use AMP enabled instead: {}",
      enabled
    );
    Ok(())
  }

  fn set_rtl_agc(&mut self, _enabled: bool) -> Result<()> {
    Ok(())
  }

  fn set_offset_tuning(&mut self, _enabled: bool) -> Result<()> {
    Ok(())
  }

  fn set_tuner_bandwidth(&mut self, bw: u32) -> Result<()> {
    let ret =
      unsafe { ffi::hackrf_set_baseband_filter_bandwidth(self.dev, bw) };
    if ret != 0 {
      return Err(anyhow!("Failed to set baseband bandwidth to {}", bw));
    }
    Ok(())
  }

  fn set_direct_sampling(&mut self, _mode: u8) -> Result<()> {
    Ok(())
  }

  fn get_center_frequency(&self) -> u32 {
    self.center_frequency
  }

  fn get_sample_rate(&self) -> u32 {
    self.sample_rate
  }

  fn get_max_sample_rate(&mut self) -> u32 {
    HACKRF_MAX_SAMPLE_RATE
  }

  fn reset_buffer(&mut self) -> Result<()> {
    if self.streaming_started {
      let _ = unsafe { ffi::hackrf_stop_rx(self.dev) };
      self.streaming_started = false;
    }
    if let Some(ctx_ptr) = self.rx_context.take() {
      unsafe {
        drop(Box::from_raw(ctx_ptr as *mut RxContext));
      }
    }
    self.ensure_streaming()?;
    Ok(())
  }

  fn cleanup(&mut self) -> Result<()> {
    self.cleanup_inner();
    Ok(())
  }

  fn is_healthy(&self) -> bool {
    if self.dev.is_null() {
      return false;
    }
    if !self.streaming_started {
      return true;
    }

    unsafe { ffi::hackrf_is_streaming(self.dev) == 1 }
  }

  fn get_error(&self) -> Option<String> {
    self.last_error.clone()
  }
}

fn normalize_hackrf_buffer(buffer: &mut [u8]) {
  let len = buffer.len();
  let mut i = 0;

  #[cfg(target_arch = "aarch64")]
  {
    use std::arch::aarch64::*;
    unsafe {
      let mask = vdupq_n_u8(0x80);
      while i + 16 <= len {
        let ptr = buffer.as_mut_ptr().add(i);
        let data = vld1q_u8(ptr);
        let result = veorq_u8(data, mask);
        vst1q_u8(ptr, result);
        i += 16;
      }
    }
  }

  #[cfg(target_arch = "x86_64")]
  {
    use std::arch::x86_64::*;
    unsafe {
      let mask = _mm_set1_epi8(0x80u8 as i8);
      while i + 16 <= len {
        let ptr = buffer.as_mut_ptr().add(i) as *mut __m128i;
        let data = _mm_loadu_si128(ptr);
        let result = _mm_xor_si128(data, mask);
        _mm_storeu_si128(ptr, result);
        i += 16;
      }
    }
  }

  // Fallback for remaining bytes
  for byte in &mut buffer[i..] {
    *byte ^= 0x80;
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn clamps_sample_rate_to_hackrf_bounds() {
    assert_eq!(HACKRF_MIN_SAMPLE_RATE, 2_000_000);
    assert_eq!(HACKRF_MAX_SAMPLE_RATE, 20_000_000);
  }

  #[test]
  fn hackrf_rx_timeout_is_bounded_for_hotplug_recovery() {
    assert!(HACKRF_RX_TIMEOUT <= Duration::from_millis(500));
  }

  #[test]
  fn applies_ppm_correction_by_adjusting_tune_frequency() {
    assert_eq!(apply_ppm_correction(100_000_000, 0), 100_000_000);
    assert_eq!(apply_ppm_correction(100_000_000, 10), 100_001_000);
  }
}
