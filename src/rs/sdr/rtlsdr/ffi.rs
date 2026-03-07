//! Raw FFI (Foreign Function Interface) bindings to librtlsdr
//!
//! FFI is a mechanism that allows code written in one programming language (Rust)
//! to call and be called by code written in another language (C). In this module,
//! we define Rust function signatures that map directly to the C API functions
//! provided by the librtlsdr library.
//!
//! These bindings are "unsafe" because Rust cannot guarantee the memory safety
//! of C code. The librtlsdr C library manages its own memory and follows C
//! conventions, so we must use unsafe blocks to call these functions.
//!
//! The RTL-SDR device is a USB radio tuner that can be used for software-defined
//! radio applications. The librtlsdr C library provides the low-level interface
//! for communicating with the hardware, and these FFI bindings expose that
//! functionality to Rust code.

use std::os::raw::{c_char, c_int, c_void};

/// Opaque handle to an RTL-SDR device
pub enum RtlSdrDev {}

// Callback type for async reading
pub type RtlSdrReadAsyncCb =
  Option<unsafe extern "C" fn(buf: *mut u8, len: u32, ctx: *mut c_void)>;

extern "C" {
  // Device discovery
  pub fn rtlsdr_get_device_count() -> u32;
  pub fn rtlsdr_get_device_name(index: u32) -> *const c_char;

  // Device open/close
  pub fn rtlsdr_open(dev: *mut *mut RtlSdrDev, index: u32) -> c_int;
  pub fn rtlsdr_close(dev: *mut RtlSdrDev) -> c_int;

  // Configuration
  pub fn rtlsdr_set_center_freq(dev: *mut RtlSdrDev, freq: u32) -> c_int;
  pub fn rtlsdr_get_center_freq(dev: *mut RtlSdrDev) -> u32;
  pub fn rtlsdr_set_freq_correction(dev: *mut RtlSdrDev, ppm: c_int) -> c_int;
  pub fn rtlsdr_get_freq_correction(dev: *mut RtlSdrDev) -> c_int;
  pub fn rtlsdr_set_tuner_gain_mode(
    dev: *mut RtlSdrDev,
    manual: c_int,
  ) -> c_int;
  pub fn rtlsdr_set_tuner_gain(dev: *mut RtlSdrDev, gain: c_int) -> c_int;
  pub fn rtlsdr_get_tuner_gain(dev: *mut RtlSdrDev) -> c_int;
  pub fn rtlsdr_get_tuner_gains(
    dev: *mut RtlSdrDev,
    gains: *mut c_int,
  ) -> c_int;
  pub fn rtlsdr_set_tuner_bandwidth(dev: *mut RtlSdrDev, bw: u32) -> c_int;
  pub fn rtlsdr_set_sample_rate(dev: *mut RtlSdrDev, rate: u32) -> c_int;
  pub fn rtlsdr_get_sample_rate(dev: *mut RtlSdrDev) -> u32;
  pub fn rtlsdr_set_agc_mode(dev: *mut RtlSdrDev, on: c_int) -> c_int;
  pub fn rtlsdr_set_direct_sampling(dev: *mut RtlSdrDev, on: c_int) -> c_int;

  // Streaming
  pub fn rtlsdr_reset_buffer(dev: *mut RtlSdrDev) -> c_int;
  pub fn rtlsdr_read_sync(
    dev: *mut RtlSdrDev,
    buf: *mut c_void,
    len: c_int,
    n_read: *mut c_int,
  ) -> c_int;
  pub fn rtlsdr_read_async(
    dev: *mut RtlSdrDev,
    cb: RtlSdrReadAsyncCb,
    ctx: *mut c_void,
    buf_num: u32,
    buf_len: u32,
  ) -> c_int;
  pub fn rtlsdr_cancel_async(dev: *mut RtlSdrDev) -> c_int;
}
