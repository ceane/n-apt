use std::os::raw::{c_char, c_int, c_uint, c_void};
use std::sync::OnceLock;

pub enum HackRfDeviceHandle {}

pub const USB_BOARD_ID_JAWBREAKER: c_int = 0x604B;
pub const USB_BOARD_ID_HACKRF_ONE: c_int = 0x6089;
pub const USB_BOARD_ID_RAD1O: c_int = 0xCC15;

#[repr(C)]
pub struct HackRfDeviceList {
  pub serial_numbers: *mut *mut c_char,
  pub usb_board_ids: *mut c_int,
  pub usb_device_index: *mut c_int,
  pub devicecount: c_int,
  pub usb_devices: *mut *mut c_void,
  pub usb_devicecount: c_int,
}

#[repr(C)]
pub struct HackRfTransfer {
  pub device: *mut HackRfDeviceHandle,
  pub buffer: *mut u8,
  pub buffer_length: c_int,
  pub valid_length: c_int,
  pub rx_ctx: *mut c_void,
  pub tx_ctx: *mut c_void,
}

/// Device-side state returned by libhackrf's USB API 0x0106 diagnostic call.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct HackRfM0State {
  pub requested_mode: u16,
  pub request_flag: u16,
  pub active_mode: u32,
  pub m0_count: u32,
  pub m4_count: u32,
  pub num_shortfalls: u32,
  pub longest_shortfall: u32,
  pub shortfall_limit: u32,
  pub threshold: u32,
  pub next_mode: u32,
  pub error: u32,
}

pub type HackRfUsbApiVersionRead = unsafe extern "C" fn(
  device: *mut HackRfDeviceHandle,
  version: *mut u16,
) -> c_int;
pub type HackRfSetTxUnderrunLimit = unsafe extern "C" fn(
  device: *mut HackRfDeviceHandle,
  value: u32,
) -> c_int;
pub type HackRfGetM0State = unsafe extern "C" fn(
  device: *mut HackRfDeviceHandle,
  state: *mut HackRfM0State,
) -> c_int;

#[derive(Clone, Copy, Default)]
pub struct HackRfExtendedApi {
  pub usb_api_version_read: Option<HackRfUsbApiVersionRead>,
  pub set_tx_underrun_limit: Option<HackRfSetTxUnderrunLimit>,
  pub get_m0_state: Option<HackRfGetM0State>,
}

/// Resolve newer optional exports at runtime so an older host libhackrf can
/// still load and report that the TX guard needs a software update.
pub fn extended_api() -> &'static HackRfExtendedApi {
  static API: OnceLock<HackRfExtendedApi> = OnceLock::new();
  API.get_or_init(|| unsafe {
    HackRfExtendedApi {
      usb_api_version_read: resolve_symbol(
        b"hackrf_usb_api_version_read\0",
      ),
      set_tx_underrun_limit: resolve_symbol(
        b"hackrf_set_tx_underrun_limit\0",
      ),
      get_m0_state: resolve_symbol(b"hackrf_get_m0_state\0"),
    }
  })
}

#[cfg(target_os = "linux")]
#[link(name = "dl")]
unsafe extern "C" {
  fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
  fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

unsafe fn resolve_symbol<T: Copy>(name: &'static [u8]) -> Option<T> {
  #[cfg(target_os = "linux")]
  let handle = std::ptr::null_mut(); // RTLD_DEFAULT
  #[cfg(target_os = "macos")]
  let handle = (-2isize) as *mut c_void; // RTLD_DEFAULT

  #[cfg(any(target_os = "linux", target_os = "macos"))]
  {
    let symbol = dlsym(handle, name.as_ptr().cast());
    if symbol.is_null() {
      None
    } else {
      // POSIX permits converting a dlsym result to the function pointer type
      // associated with the named C symbol.
      Some(std::mem::transmute_copy(&symbol))
    }
  }

  #[cfg(not(any(target_os = "linux", target_os = "macos")))]
  {
    let _ = name;
    None
  }
}

pub type HackRfSampleBlockCb =
  Option<unsafe extern "C" fn(transfer: *mut HackRfTransfer) -> c_int>;

extern "C" {
  pub fn hackrf_init() -> c_int;
  pub fn hackrf_exit() -> c_int;
  pub fn hackrf_error_name(error_code: c_int) -> *const c_char;
  pub fn hackrf_get_transfer_buffer_size(
    device: *mut HackRfDeviceHandle,
  ) -> usize;
  pub fn hackrf_device_list() -> *mut HackRfDeviceList;
  pub fn hackrf_device_list_open(
    list: *mut HackRfDeviceList,
    index: c_int,
    device: *mut *mut HackRfDeviceHandle,
  ) -> c_int;
  pub fn hackrf_device_list_free(list: *mut HackRfDeviceList);
  pub fn hackrf_close(device: *mut HackRfDeviceHandle) -> c_int;
  pub fn hackrf_start_rx(
    device: *mut HackRfDeviceHandle,
    callback: HackRfSampleBlockCb,
    ctx: *mut c_void,
  ) -> c_int;
  pub fn hackrf_stop_rx(device: *mut HackRfDeviceHandle) -> c_int;
  pub fn hackrf_start_tx(
    device: *mut HackRfDeviceHandle,
    callback: HackRfSampleBlockCb,
    ctx: *mut c_void,
  ) -> c_int;
  pub fn hackrf_stop_tx(device: *mut HackRfDeviceHandle) -> c_int;
  pub fn hackrf_set_freq(
    device: *mut HackRfDeviceHandle,
    freq_hz: u64,
  ) -> c_int;
  pub fn hackrf_set_sample_rate_manual(
    device: *mut HackRfDeviceHandle,
    freq_hz: u32,
    divider: c_uint,
  ) -> c_int;
  pub fn hackrf_set_lna_gain(
    device: *mut HackRfDeviceHandle,
    value: u32,
  ) -> c_int;
  pub fn hackrf_set_vga_gain(
    device: *mut HackRfDeviceHandle,
    value: u32,
  ) -> c_int;
  pub fn hackrf_set_amp_enable(
    device: *mut HackRfDeviceHandle,
    value: u8,
  ) -> c_int;
  pub fn hackrf_set_antenna_enable(
    device: *mut HackRfDeviceHandle,
    value: u8,
  ) -> c_int;
  pub fn hackrf_set_baseband_filter_bandwidth(
    device: *mut HackRfDeviceHandle,
    bw_hz: u32,
  ) -> c_int;
  pub fn hackrf_is_streaming(device: *mut HackRfDeviceHandle) -> c_int;
}

#[cfg(test)]
mod tests {
  use super::HackRfTransfer;
  use std::mem::{offset_of, size_of};

  #[test]
  fn transfer_layout_matches_libhackrf_c_header() {
    let pointer = size_of::<*mut ()>();
    assert_eq!(offset_of!(HackRfTransfer, device), 0);
    assert_eq!(offset_of!(HackRfTransfer, buffer), pointer);
    assert_eq!(offset_of!(HackRfTransfer, buffer_length), pointer * 2);
    assert_eq!(offset_of!(HackRfTransfer, valid_length), pointer * 2 + 4);
    let context_offset = (pointer * 2 + 8 + pointer - 1) / pointer * pointer;
    assert_eq!(offset_of!(HackRfTransfer, rx_ctx), context_offset);
    assert_eq!(offset_of!(HackRfTransfer, tx_ctx), context_offset + pointer);
    assert_eq!(size_of::<HackRfTransfer>(), context_offset + pointer * 2);
  }
}
