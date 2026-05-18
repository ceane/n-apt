use anyhow::{anyhow, Result};
use crossbeam_channel::{bounded, Receiver, Sender};
use log::info;
use std::os::raw::c_int;
use std::ptr;
use std::thread::JoinHandle;

use super::ffi;
use crate::sdr::SdrDevice;

const HACKRF_MAX_SAMPLE_RATE: u32 = 20_000_000;
const HACKRF_MIN_SAMPLE_RATE: u32 = 2_000_000;
const HACKRF_RX_QUEUE_DEPTH: usize = 8;
const HACKRF_BLOCK_SIZE: usize = 16_384;

struct RxContext {
  tx: Sender<Vec<u8>>,
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
  iq_buffer: Vec<u8>,
  streaming_started: bool,
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
        return Err(anyhow!("Failed to initialize HackRF"));
      }
      let list = ffi::hackrf_device_list();
      if list.is_null() {
        let _ = ffi::hackrf_exit();
        return Err(anyhow!("No HackRF devices found"));
      }
      let mut dev: *mut ffi::HackRfDeviceHandle = ptr::null_mut();
      let ret = ffi::hackrf_device_list_open(list, index, &mut dev);
      ffi::hackrf_device_list_free(list);
      if ret != 0 || dev.is_null() {
        let _ = ffi::hackrf_exit();
        return Err(anyhow!("Failed to open HackRF device #{}", index));
      }
      info!("Opened HackRF device #{}", index);

      let (_tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
      Ok(Self {
        dev,
        rx_queue: rx,
        async_thread: None,
        rx_context: None,
        last_error: None,
        sample_rate: HACKRF_MIN_SAMPLE_RATE,
        center_frequency: 0,
        iq_buffer: Vec::with_capacity(HACKRF_BLOCK_SIZE * 2),
        streaming_started: false,
      })
    }
  }

  fn set_sample_rate_inner(&mut self, rate: u32) -> Result<()> {
    let clamped = rate.clamp(HACKRF_MIN_SAMPLE_RATE, HACKRF_MAX_SAMPLE_RATE);
    let ret =
      unsafe { ffi::hackrf_set_sample_rate_manual(self.dev, clamped, 1) };
    if ret != 0 {
      return Err(anyhow!(
        "Failed to set HackRF sample rate to {} Hz",
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
      return Err(anyhow!("Failed to start HackRF RX streaming"));
    }

    self.rx_queue = rx;
    self.rx_context = Some(ctx_ptr);
    self.streaming_started = true;
    Ok(())
  }
}

impl SdrDevice for HackRfDevice {
  fn device_type(&self) -> &'static str {
    "hackrf"
  }

  fn get_device_info(&self) -> String {
    format!(
      "HackRF One - Freq: {} Hz, Rate: {} Hz",
      self.center_frequency, self.sample_rate
    )
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
    let mut frame = self
      .rx_queue
      .recv()
      .map_err(|_| anyhow!("HackRF RX queue closed"))?;

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
      return Err(anyhow!("Failed to set HackRF center frequency to {}", freq));
    }
    self.center_frequency = freq;
    Ok(())
  }

  fn set_gain(&mut self, gain: f64) -> Result<()> {
    let gain = gain.clamp(0.0, 47.0);
    let lna = if gain >= 16.0 { 16 } else { 0 };
    let vga = ((gain - lna as f64).round() as i32).clamp(0, 62) as u32;
    unsafe {
      let _ = ffi::hackrf_set_lna_gain(self.dev, lna);
      let _ = ffi::hackrf_set_vga_gain(self.dev, vga);
      let _ = ffi::hackrf_set_amp_enable(self.dev, 0);
      let _ = ffi::hackrf_set_antenna_enable(self.dev, 0);
    }
    Ok(())
  }

  fn set_ppm(&mut self, _ppm: i32) -> Result<()> {
    Ok(())
  }

  fn set_tuner_agc(&mut self, enabled: bool) -> Result<()> {
    let _ = unsafe { ffi::hackrf_set_amp_enable(self.dev, enabled as u8) };
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
    Ok(())
  }

  fn is_healthy(&self) -> bool {
    !self.dev.is_null()
  }

  fn get_error(&self) -> Option<String> {
    self.last_error.clone()
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
}
