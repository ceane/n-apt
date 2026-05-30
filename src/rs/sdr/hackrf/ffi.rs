use std::os::raw::{c_char, c_int, c_uint, c_void};

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
  pub valid_length: c_int,
  pub buffer_length: c_int,
  pub rx_ctx: *mut c_void,
}

pub type HackRfSampleBlockCb =
  Option<unsafe extern "C" fn(transfer: *mut HackRfTransfer) -> c_int>;

extern "C" {
  pub fn hackrf_init() -> c_int;
  pub fn hackrf_exit() -> c_int;
  pub fn hackrf_error_name(error_code: c_int) -> *const c_char;
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
