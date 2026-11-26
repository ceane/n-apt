use anyhow::{anyhow, Result};
use crossbeam_channel::{bounded, Receiver, Sender};
use std::ffi::CStr;
use std::os::raw::c_int;
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use super::ffi;
use crate::sdr::audio_iq_tap::{AudioIqBlock, AudioIqTap};
use crate::sdr::SdrDevice;

const HACKRF_MAX_SAMPLE_RATE: u32 = 20_000_000;
const HACKRF_MIN_SAMPLE_RATE: u32 = 2_000_000;
const HACKRF_RX_QUEUE_DEPTH: usize = 8;
const HACKRF_BLOCK_SIZE: usize = 16_384;
const HACKRF_RX_TIMEOUT: Duration = Duration::from_millis(500);
const HACKRF_RX_START_RETRY_ATTEMPTS: usize = 5;
const HACKRF_RX_START_RETRY_DELAY: Duration = Duration::from_millis(250);
const HACKRF_TX_UNDERRUN_LIMIT_MS: u32 = 100;
const HACKRF_TX_DIAGNOSTIC_INTERVAL: Duration = Duration::from_millis(500);
const HACKRF_TX_M0_RUN: u32 = 4;
const HACKRF_TX_USB_API_REQUIRED: u16 = 0x0106;
const HACKRF_TX_TRANSFER_BYTES: u64 = 262_144;

static HACKRF_NATIVE_OPERATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct RxContext {
  tx: Sender<Vec<u8>>,
}
struct TxContext {
  iq: Mutex<Vec<u8>>,
  callback_count: AtomicU64,
  callback_failures: AtomicU64,
  max_callback_duration_us: AtomicU64,
}

impl TxContext {
  fn new(iq: Vec<u8>) -> Self {
    Self {
      iq: Mutex::new(iq),
      callback_count: AtomicU64::new(0),
      callback_failures: AtomicU64::new(0),
      max_callback_duration_us: AtomicU64::new(0),
    }
  }

  fn replace_iq(&self, iq: Vec<u8>) {
    *self
      .iq
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner()) = iq;
  }

  #[cfg(test)]
  fn snapshot_iq(&self) -> Vec<u8> {
    self
      .iq
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
      .clone()
  }

}

fn prepare_hackrf_tx_payload(samples: &[u8]) -> Vec<u8> {
  let mut payload = samples.to_vec();
  if payload.len() % 2 != 0 {
    payload.push(0);
  }
  payload
}

fn should_resume_rx_after_tx_stop(
  tx_started: bool,
  streaming_started: bool,
) -> bool {
  tx_started && !streaming_started
}

fn drain_rx_queue(rx: &Receiver<Vec<u8>>) -> usize {
  // A live RX callback can refill the bounded queue while a retune flushes it.
  // Limit each flush to one queue's capacity so a gesture cannot monopolize
  // the acquisition worker while discarding stale chunks.
  let mut drained = 0;
  while drained < HACKRF_RX_QUEUE_DEPTH {
    if rx.try_recv().is_err() {
      break;
    }
    drained += 1;
  }
  drained
}

fn initial_tx_guard_status(
  usb_api_version: Option<u16>,
) -> crate::sdr::TxUnderrunGuardStatus {
  let api = ffi::extended_api();
  let status = if api.set_tx_underrun_limit.is_none()
    || api.get_m0_state.is_none()
    || api.usb_api_version_read.is_none()
  {
    ("host_update_required", Some(
      "Installed host libhackrf is missing the TX underrun or M0 diagnostics API."
        .to_string(),
    ))
  } else if usb_api_version
    .is_some_and(|version| version < HACKRF_TX_USB_API_REQUIRED)
  {
    ("firmware_update_required", Some(
      "HackRF firmware USB API 1.06 or newer is required for TX underrun protection."
        .to_string(),
    ))
  } else if usb_api_version.is_none() {
    ("host_update_required", Some(
      "Could not read the HackRF USB API version; update host libhackrf and firmware."
        .to_string(),
    ))
  } else {
    ("available", None)
  };
  crate::sdr::TxUnderrunGuardStatus {
    state: status.0.to_string(),
    usb_api_version,
    threshold_bytes: None,
    shortfalls: None,
    longest_shortfall_bytes: None,
    message: status.1,
  }
}

fn read_usb_api_version(
  device: *mut ffi::HackRfDeviceHandle,
) -> Option<u16> {
  let read_version = ffi::extended_api().usb_api_version_read?;
  let mut version = 0;
  (unsafe { read_version(device, &mut version) } == 0).then_some(version)
}

/// Tap every block consumed for one display read and return the newest block.
/// `max_blocks` includes `first`, so a live callback cannot keep this drain
/// loop occupied by replenishing the bounded receiver as quickly as it drains.
fn take_freshest_rx_block(
  rx: &Receiver<Vec<u8>>,
  mut first: Vec<u8>,
  max_blocks: usize,
  mut tap: impl FnMut(&[u8]),
) -> (Vec<u8>, usize) {
  if max_blocks == 0 {
    return (first, 0);
  }
  tap(&first);
  let mut drained = 0;
  while drained + 1 < max_blocks {
    match rx.try_recv() {
      Ok(next) => {
        tap(&next);
        first = next;
        drained += 1;
      }
      Err(_) => break,
    }
  }
  (first, drained)
}

pub struct HackRfDevice {
  dev: *mut ffi::HackRfDeviceHandle,
  rx_queue: Receiver<Vec<u8>>,
  rx_context: Option<Arc<RxContext>>,
  tx_context: Option<Arc<TxContext>>,
  tx_started: bool,
  last_error: Option<String>,
  sample_rate: u32,
  center_frequency: u32,
  requested_center_frequency: u32,
  iq_buffer: Vec<u8>,
  /// Contiguous IQ retained for streaming consumers such as audio.
  audio_tap: AudioIqTap,
  streaming_started: bool,
  serial_number: String,
  tx_guard_status: crate::sdr::TxUnderrunGuardStatus,
  tx_started_at: Option<Instant>,
  last_tx_diagnostic_at: Option<Instant>,
  last_m0_count: Option<u32>,
  last_callback_failures: u64,
  tx_recovery_attempted: bool,
  lna_gain: u32,
  vga_gain: u32,
  amp_enabled: bool,
  /// True while this handle owns the process-wide hackrf session opened by
  /// `hackrf_init`. Guards the exit so an explicit `cleanup()` followed by the
  /// later `Drop` cannot tear the native session down twice.
  native_session_active: bool,
}

unsafe impl Send for HackRfDevice {}

extern "C" fn hackrf_rx_callback(transfer: *mut ffi::HackRfTransfer) -> c_int {
  let res = std::panic::catch_unwind(|| {
    if transfer.is_null() {
      return 0;
    }

    let transfer = unsafe { &mut *transfer };
    if transfer.buffer.is_null()
      || transfer.valid_length <= 0
      || transfer.rx_ctx.is_null()
    {
      return 0;
    }

    let ctx = unsafe { &*(transfer.rx_ctx as *const RxContext) };
    let len = transfer.valid_length as usize;
    let data = unsafe { std::slice::from_raw_parts(transfer.buffer, len) };
    let mut frame = Vec::with_capacity(len);
    frame.extend_from_slice(data);

    let _ = ctx.tx.try_send(frame);

    0
  });
  res.unwrap_or(0)
}

extern "C" fn hackrf_tx_callback(transfer: *mut ffi::HackRfTransfer) -> c_int {
  if transfer.is_null() {
    return -1;
  }
  let transfer = unsafe { &mut *transfer };
  let context = if transfer.tx_ctx.is_null() {
    None
  } else {
    Some(unsafe { &*(transfer.tx_ctx as *const TxContext) })
  };
  let Some(context) = context else {
    return -1;
  };
  let callback_started = Instant::now();
  context.callback_count.fetch_add(1, Ordering::Relaxed);

  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    if transfer.buffer.is_null() || transfer.buffer_length <= 0 {
      return Err(());
    }
    let iq = context
      .iq
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());
    if iq.is_empty() {
      return Err(());
    }
    let output = unsafe {
      std::slice::from_raw_parts_mut(
        transfer.buffer,
        transfer.buffer_length as usize,
      )
    };
    crate::tx::repeat_iq_payload_into(&iq, output).map_err(|_| ())?;
    transfer.valid_length = output.len() as c_int;
    Ok(())
  }));

  let callback_result = match result {
    Ok(Ok(())) => 0,
    _ => {
      context.callback_failures.fetch_add(1, Ordering::Relaxed);
      -1
    }
  };
  let callback_duration_us = callback_started.elapsed().as_micros() as u64;
  let mut previous_max = context
    .max_callback_duration_us
    .load(Ordering::Relaxed);
  while callback_duration_us > previous_max {
    match context.max_callback_duration_us.compare_exchange_weak(
      previous_max,
      callback_duration_us,
      Ordering::Relaxed,
      Ordering::Relaxed,
    ) {
      Ok(_) => break,
      Err(actual) => previous_max = actual,
    }
  }
  callback_result
}

impl HackRfDevice {
  pub(crate) fn native_operation_lock() -> MutexGuard<'static, ()> {
    HACKRF_NATIVE_OPERATION_LOCK
      .get_or_init(|| Mutex::new(()))
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
  }

  pub fn open_first() -> Result<Self> {
    Self::open(0)
  }

  #[cfg(has_hackrf)]
  pub(crate) fn enumerate_serial_numbers() -> Result<Vec<String>> {
    let _native_operation_guard = Self::native_operation_lock();
    unsafe {
      if ffi::hackrf_init() != 0 {
        return Err(anyhow!("Failed to initialize HackRF One"));
      }
      let list = ffi::hackrf_device_list();
      if list.is_null() {
        let _ = ffi::hackrf_exit();
        return Ok(Vec::new());
      }

      let mut serial_numbers = Vec::new();
      let device_count = (*list).devicecount.max(0) as usize;
      for index in 0..device_count {
        let serial_number = if !(*list).serial_numbers.is_null() {
          let serial_ptr = *(*list).serial_numbers.add(index);
          if serial_ptr.is_null() {
            String::new()
          } else {
            CStr::from_ptr(serial_ptr).to_string_lossy().into_owned()
          }
        } else {
          String::new()
        };
        serial_numbers.push(serial_number);
      }

      ffi::hackrf_device_list_free(list);
      let _ = ffi::hackrf_exit();
      Ok(serial_numbers)
    }
  }

  pub fn open(index: i32) -> Result<Self> {
    let _native_operation_guard = Self::native_operation_lock();
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
      let usb_api_version = read_usb_api_version(dev);
      let (_tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
      Ok(Self {
        dev,
        rx_queue: rx,
        rx_context: None,
        tx_context: None,
        tx_started: false,
        last_error: None,
        sample_rate: HACKRF_MIN_SAMPLE_RATE,
        center_frequency: 0,
        requested_center_frequency: 0,
        iq_buffer: Vec::with_capacity(HACKRF_BLOCK_SIZE * 2),
        audio_tap: AudioIqTap::new(),
        streaming_started: false,
        serial_number,
        tx_guard_status: initial_tx_guard_status(usb_api_version),
        tx_started_at: None,
        last_tx_diagnostic_at: None,
        last_m0_count: None,
        last_callback_failures: 0,
        tx_recovery_attempted: false,
        lna_gain: 0,
        vga_gain: 0,
        amp_enabled: false,
        native_session_active: true,
      })
    }
  }

  fn rx_context_ptr(&mut self) -> *mut std::os::raw::c_void {
    if self.rx_context.is_none() {
      let (tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
      self.rx_queue = rx;
      self.rx_context = Some(Arc::new(RxContext { tx }));
    }

    Arc::as_ptr(self.rx_context.as_ref().expect("rx context")) as *mut _
  }

  /// Retain a received chunk in the audio tap as unsigned offset binary.
  ///
  /// The tap feeds consumers that expect the same format the display path
  /// emits, so the signed i8 samples must be converted before retention rather
  /// than after.
  fn tap_normalized(&mut self, chunk: &[u8]) {
    let mut normalized = chunk.to_vec();
    normalize_hackrf_buffer(&mut normalized);
    self.audio_tap.push(&normalized);
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

    let ctx_ptr = self.rx_context_ptr();
    let mut last_ret = 0;
    for attempt in 1..=HACKRF_RX_START_RETRY_ATTEMPTS {
      last_ret = unsafe {
        ffi::hackrf_start_rx(self.dev, Some(hackrf_rx_callback), ctx_ptr)
      };
      if last_ret == 0 {
        self.streaming_started = true;
        self.last_error = None;
        return Ok(());
      }

      if attempt < HACKRF_RX_START_RETRY_ATTEMPTS {
        std::thread::sleep(HACKRF_RX_START_RETRY_DELAY);
      }
    }

    self.last_error = Some(format!(
      "Failed to start HackRF One RX streaming after {} attempt(s) (last error code: {})",
      HACKRF_RX_START_RETRY_ATTEMPTS,
      last_ret
    ));
    Err(anyhow!("Failed to start HackRF One RX streaming"))
  }

  fn stop_streaming(&mut self) {
    if self.streaming_started {
      let _ = unsafe { ffi::hackrf_stop_rx(self.dev) };
      self.streaming_started = false;
    }
  }

  fn stop_transmitting(&mut self) {
    if self.tx_started {
      let _ = unsafe { ffi::hackrf_stop_tx(self.dev) };
      self.tx_started = false;
    }
    self.tx_started_at = None;
    self.last_tx_diagnostic_at = None;
    self.last_m0_count = None;
    if self.tx_guard_status.state == "active" {
      self.tx_guard_status.state = "available".to_string();
      self.tx_guard_status.threshold_bytes = None;
    }
  }

  fn configure_tx_underrun_guard(&mut self) {
    let api = *ffi::extended_api();
    let Some(set_limit) = api.set_tx_underrun_limit else {
      self.tx_guard_status.state = "host_update_required".to_string();
      self.tx_guard_status.threshold_bytes = None;
      self.tx_guard_status.message = Some(
        "Installed host libhackrf does not export hackrf_set_tx_underrun_limit."
          .to_string(),
      );
      return;
    };
    if self
      .tx_guard_status
      .usb_api_version
      .is_some_and(|version| version < HACKRF_TX_USB_API_REQUIRED)
    {
      self.tx_guard_status.state = "firmware_update_required".to_string();
      self.tx_guard_status.threshold_bytes = None;
      self.tx_guard_status.message = Some(
        "HackRF firmware must support USB API 1.06 or newer for the underrun guard."
          .to_string(),
      );
      return;
    }

    let threshold_bytes = ((self.sample_rate as u64
      * 2
      * HACKRF_TX_UNDERRUN_LIMIT_MS as u64)
      / 1000)
      .min(u32::MAX as u64) as u32;
    let ret = unsafe { set_limit(self.dev, threshold_bytes) };
    if ret == 0 {
      self.tx_guard_status.state = "active".to_string();
      self.tx_guard_status.threshold_bytes = Some(threshold_bytes);
      self.tx_guard_status.message = if api.get_m0_state.is_none() {
        Some(
          "The underrun limit is active, but host libhackrf lacks M0 stream diagnostics."
            .to_string(),
        )
      } else {
        None
      };
    } else {
      let firmware_is_old = self
        .tx_guard_status
        .usb_api_version
        .is_some_and(|version| version < HACKRF_TX_USB_API_REQUIRED);
      self.tx_guard_status.state = if firmware_is_old {
        "firmware_update_required"
      } else {
        "configuration_error"
      }
      .to_string();
      self.tx_guard_status.threshold_bytes = None;
      self.tx_guard_status.message = Some(format!(
        "Could not enable the HackRF TX underrun limit (libhackrf error {ret})."
      ));
    }
  }

  fn mark_tx_recovery_failed(&mut self, message: String) {
    self.stop_transmitting();
    self.tx_guard_status.state = "recovery_failed".to_string();
    self.tx_guard_status.message = Some(message.clone());
    self.last_error = Some(message);
  }

  fn cleanup_inner(&mut self) {
    let _native_operation_guard = Self::native_operation_lock();
    self.stop_transmitting();
    self.stop_streaming();
    if !self.dev.is_null() {
      let _ = unsafe { ffi::hackrf_close(self.dev) };
      self.dev = ptr::null_mut();
    }
    let _ = self.rx_context.take();
    let _ = self.tx_context.take();
    if self.native_session_active {
      self.native_session_active = false;
      let _ = unsafe { ffi::hackrf_exit() };
    }
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
    // Captured from libhackrf's device list before opening the device. This is
    // the hardware-reported HackRF serial; it is empty only if the library
    // does not provide one.
    self.serial_number.clone()
  }

  fn initialize(&mut self) -> Result<()> {
    self.set_sample_rate_inner(self.sample_rate)?;
    self.ensure_streaming()?;
    Ok(())
  }

  fn transmit_iq(&mut self, samples: Option<&[u8]>) -> Result<()> {
    match samples {
      Some(samples) => {
        self.stop_transmitting();
        self.stop_streaming();
        self.tx_recovery_attempted = false;
        let payload = prepare_hackrf_tx_payload(samples);
        if payload.is_empty() {
          return Err(anyhow!("HackRF TX requires I/Q samples"));
        }
        self.configure_tx_underrun_guard();
        let context = Arc::new(TxContext::new(payload));
        let ret = unsafe {
          ffi::hackrf_start_tx(
            self.dev,
            Some(hackrf_tx_callback),
            Arc::as_ptr(&context) as *mut _,
          )
        };
        if ret != 0 {
          self.tx_guard_status.state = "start_failed".to_string();
          self.tx_guard_status.message = Some(format!(
            "Could not start HackRF TX stream (libhackrf error {ret})."
          ));
          return Err(anyhow!(
            "Failed to start HackRF One TX streaming (error code: {})",
            ret
          ));
        }
        self.last_callback_failures = 0;
        self.tx_context = Some(context);
        self.tx_started = true;
        self.tx_started_at = Some(Instant::now());
        self.last_tx_diagnostic_at = None;
        self.last_m0_count = None;
      }
      None => {
        let was_transmitting = self.tx_started;
        self.stop_transmitting();
        self.tx_context = None;
        self.tx_recovery_attempted = false;
        if should_resume_rx_after_tx_stop(
          was_transmitting,
          self.streaming_started,
        ) {
          self.ensure_streaming()?;
        }
      }
    }
    Ok(())
  }

  fn update_transmit_iq(&mut self, samples: &[u8]) -> Result<()> {
    let Some(context) = self.tx_context.as_ref() else {
      return Err(anyhow!("HackRF TX is not active"));
    };
    let payload = prepare_hackrf_tx_payload(samples);
    if payload.is_empty() {
      return Err(anyhow!("HackRF TX requires I/Q samples"));
    }
    context.replace_iq(payload);
    Ok(())
  }

  fn tx_underrun_guard_status(
    &self,
  ) -> Option<crate::sdr::TxUnderrunGuardStatus> {
    Some(self.tx_guard_status.clone())
  }

  fn poll_transmit_health(&mut self) -> Option<crate::sdr::TxStreamHealth> {
    let context = self.tx_context.as_ref()?;
    let now = Instant::now();
    let callback_failures =
      context.callback_failures.load(Ordering::Relaxed);
    let callback_failed = callback_failures > self.last_callback_failures;
    self.last_callback_failures = callback_failures;
    let mut recovery_needed = callback_failed
      || !self.tx_started
      || unsafe { ffi::hackrf_is_streaming(self.dev) != 1 };

    if self
      .last_tx_diagnostic_at
      .is_none_or(|last| now.duration_since(last) >= HACKRF_TX_DIAGNOSTIC_INTERVAL)
    {
      self.last_tx_diagnostic_at = Some(now);
      let transfer_budget_us =
        (HACKRF_TX_TRANSFER_BYTES * 1_000_000
          / (2 * self.sample_rate.max(1) as u64))
          .max(1);
      log::debug!(
        "HackRF TX callbacks: count={}, failures={}, max={}us, per-transfer budget={}us",
        context.callback_count.load(Ordering::Relaxed),
        context.callback_failures.load(Ordering::Relaxed),
        context.max_callback_duration_us.load(Ordering::Relaxed),
        transfer_budget_us,
      );
      if let Some(get_state) = ffi::extended_api().get_m0_state {
        let mut state = ffi::HackRfM0State::default();
        let ret = unsafe { get_state(self.dev, &mut state) };
        if ret == 0 {
          self.tx_guard_status.shortfalls = Some(state.num_shortfalls);
          self.tx_guard_status.longest_shortfall_bytes =
            Some(state.longest_shortfall);
          if let Some(previous_count) = self.last_m0_count {
            let tx_has_run_long_enough = self
              .tx_started_at
              .is_some_and(|started| started.elapsed() >= HACKRF_TX_DIAGNOSTIC_INTERVAL);
            if tx_has_run_long_enough
              && (state.active_mode != HACKRF_TX_M0_RUN
                || state.m0_count == previous_count)
            {
              recovery_needed = true;
            }
          }
          self.last_m0_count = Some(state.m0_count);
        } else if self
          .tx_guard_status
          .usb_api_version
          .is_some_and(|version| version < HACKRF_TX_USB_API_REQUIRED)
        {
          self.tx_guard_status.state = "firmware_update_required".to_string();
          self.tx_guard_status.message = Some(
            "HackRF firmware USB API 1.06 or newer is required for M0 diagnostics."
              .to_string(),
          );
        }
      }
    }

    Some(crate::sdr::TxStreamHealth {
      recovery_needed,
      guard_status: Some(self.tx_guard_status.clone()),
    })
  }

  fn recover_transmit(&mut self) -> Result<bool> {
    if self.tx_context.is_none() {
      return Ok(false);
    }
    if self.tx_recovery_attempted {
      let message =
        "HackRF TX stream failed again after its one recovery attempt.";
      self.mark_tx_recovery_failed(message.to_string());
      return Err(anyhow!(message));
    }
    self.tx_recovery_attempted = true;
    let context = self.tx_context.as_ref().expect("checked TX context").clone();
    self.stop_transmitting();

    let result = (|| -> Result<()> {
      if self.requested_center_frequency > 0 {
        let ret = unsafe {
          ffi::hackrf_set_freq(
            self.dev,
            self.requested_center_frequency as u64,
          )
        };
        if ret != 0 {
          return Err(anyhow!(
            "Failed to reapply HackRF frequency during TX recovery (error {ret})"
          ));
        }
      }
      self.set_sample_rate_inner(self.sample_rate)?;
      for (ret, label) in [
        (
          unsafe { ffi::hackrf_set_lna_gain(self.dev, self.lna_gain) },
          "LNA gain",
        ),
        (
          unsafe { ffi::hackrf_set_vga_gain(self.dev, self.vga_gain) },
          "VGA gain",
        ),
        (
          unsafe {
            ffi::hackrf_set_amp_enable(self.dev, self.amp_enabled as u8)
          },
          "RF amplifier",
        ),
      ] {
        if ret != 0 {
          return Err(anyhow!(
            "Failed to reapply HackRF {label} during TX recovery (error {ret})"
          ));
        }
      }
      self.configure_tx_underrun_guard();
      self.last_callback_failures =
        context.callback_failures.load(Ordering::Relaxed);
      let ret = unsafe {
        ffi::hackrf_start_tx(
          self.dev,
          Some(hackrf_tx_callback),
          Arc::as_ptr(&context) as *mut _,
        )
      };
      if ret != 0 {
        return Err(anyhow!(
          "Failed to restart HackRF TX stream during recovery (error {ret})"
        ));
      }
      self.tx_started = true;
      self.tx_started_at = Some(Instant::now());
      self.last_tx_diagnostic_at = None;
      self.last_m0_count = None;
      Ok(())
    })();

    if let Err(error) = result {
      self.mark_tx_recovery_failed(error.to_string());
      return Err(error);
    }
    self.last_error = None;
    log::warn!("HackRF TX stream recovered once; continuing with last IQ buffer");
    Ok(true)
  }

  fn enter_standby(&mut self) -> Result<()> {
    self.stop_streaming();
    self.flush_read_queue();
    Ok(())
  }

  fn is_ready(&self) -> bool {
    !self.dev.is_null()
  }

  fn read_samples(
    &mut self,
    fft_size: usize,
  ) -> Result<crate::signal_port::fft::types::RawSamples> {
    self.ensure_streaming()?;
    let first = self.rx_queue.recv_timeout(HACKRF_RX_TIMEOUT).map_err(
      |err| match err {
        crossbeam_channel::RecvTimeoutError::Timeout => {
          anyhow!("Timeout waiting for HackRF One RX samples")
        }
        crossbeam_channel::RecvTimeoutError::Disconnected => {
          anyhow!("HackRF One RX queue closed")
        }
      },
    )?;

    // Keep display acquisition real-time even if audio retention is disabled:
    // drain a bounded number of buffered blocks and display the freshest one.
    let audio_enabled = self.audio_tap.is_enabled();
    let rx_queue = self.rx_queue.clone();
    let (mut frame, drained) = if audio_enabled {
      take_freshest_rx_block(&rx_queue, first, HACKRF_RX_QUEUE_DEPTH, |chunk| {
        self.tap_normalized(chunk)
      })
    } else {
      take_freshest_rx_block(&rx_queue, first, HACKRF_RX_QUEUE_DEPTH, |_| {})
    };
    if drained > 0 {
      crate::performance::pipeline_metrics().increment(
        crate::performance::CounterKind::HackrfDisplayBlocksDrained,
        drained as u64,
      );
    }

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

    Ok(crate::signal_port::fft::types::RawSamples {
      data: std::mem::take(&mut self.iq_buffer),
      sample_rate: self.sample_rate,
      spectrum_iq_data: None,
      spectrum_ppm_correction: None,
    })
  }

  fn set_audio_iq_tap_enabled(&mut self, enabled: bool) {
    if enabled {
      self
        .audio_tap
        .set_capacity_for_sample_rate(self.sample_rate);
    }
    self.audio_tap.set_enabled(enabled);
  }

  fn take_audio_iq(&mut self) -> Option<AudioIqBlock> {
    if !self.audio_tap.is_enabled() {
      return None;
    }
    let data = self.audio_tap.take();
    if data.is_empty() {
      return None;
    }
    Some(AudioIqBlock {
      data,
      sample_rate: self.sample_rate,
      dropped_bytes: self.audio_tap.dropped_bytes(),
    })
  }

  fn set_sample_rate(&mut self, rate: u32) -> Result<()> {
    self.set_sample_rate_inner(rate)?;
    // The latency budget is in seconds, and retained samples belong to the old
    // rate, so they cannot carry over.
    self.audio_tap.set_capacity_for_sample_rate(rate);
    self.audio_tap.clear();
    Ok(())
  }

  fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
    let result = unsafe { ffi::hackrf_set_freq(self.dev, freq as u64) };
    if result != 0 {
      return Err(anyhow!("Failed to set HackRF One center frequency to {freq}"));
    }
    self.requested_center_frequency = freq;
    self.center_frequency = freq;
    Ok(())
  }

  fn set_center_frequency_live(&mut self, freq: u32) -> Result<()> {
    // hackrf_set_freq is a synchronous control transfer and stays valid while
    // RX is streaming. Stopping and restarting the native stream here
    // (hackrf_stop_rx can block in firmware) turned every VFO tick into a full
    // stream restart and stalled scrolling. Retune in place, then drop chunks
    // already buffered at the old LO so the next frame is new-frequency content.
    self.set_center_frequency(freq)?;
    self.flush_read_queue();
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
    self.lna_gain = lna;
    Ok(())
  }

  fn set_vga_gain(&mut self, gain: f64) -> Result<()> {
    let vga = (((gain / 2.0).round() * 2.0).clamp(0.0, 62.0)) as u32;
    let _ = unsafe { ffi::hackrf_set_vga_gain(self.dev, vga) };
    self.vga_gain = vga;
    Ok(())
  }

  fn set_amp_enable(&mut self, enabled: bool) -> Result<()> {
    let _ = unsafe { ffi::hackrf_set_amp_enable(self.dev, enabled as u8) };
    self.amp_enabled = enabled;
    Ok(())
  }

  fn set_ppm(&mut self, ppm: i32) -> Result<()> {
    // HackRF has no hardware PPM API. Frequency compensation is applied to IQ
    // samples in the WebGPU spectrum pipeline; never retune the LO here.
    let _ = ppm;
    Ok(())
  }

  fn set_tuner_agc(&mut self, _enabled: bool) -> Result<()> {
    // HackRF has no RTL-style tuner AGC; AMP remains explicitly controlled.
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

  fn flush_read_queue(&mut self) {
    drain_rx_queue(&self.rx_queue);
    self.iq_buffer.clear();
    // A flush is an intentional discontinuity, so retained audio would splice
    // unrelated spectrum into the stream.
    self.audio_tap.clear();
  }

  fn reset_buffer(&mut self) -> Result<()> {
    self.stop_streaming();
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

  fn is_rx_active(&self) -> bool {
    if self.dev.is_null() || self.tx_started {
      return false;
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
  fn tx_payload_is_padded_to_a_complete_iq_pair() {
    assert_eq!(prepare_hackrf_tx_payload(&[1, 2, 3]), vec![1, 2, 3, 0]);
  }

  #[test]
  fn clamps_sample_rate_to_hackrf_bounds() {
    assert_eq!(HACKRF_MIN_SAMPLE_RATE, 2_000_000);
    assert_eq!(HACKRF_MAX_SAMPLE_RATE, 20_000_000);
  }

  #[test]
  fn hackrf_rx_timeout_is_bounded_for_hotplug_recovery() {
    assert!(HACKRF_RX_TIMEOUT <= Duration::from_millis(500));
  }

  fn retry_value_then_succeed<T, F>(attempts: usize, mut f: F) -> T
  where
    F: FnMut(usize) -> Option<T>,
  {
    for attempt in 1..=attempts {
      if let Some(value) = f(attempt) {
        return value;
      }
    }

    panic!("expected helper to succeed within attempt budget");
  }

  #[test]
  fn retries_rx_start_until_success() {
    let result = retry_value_then_succeed(5, |attempt| {
      if attempt < 3 {
        None
      } else {
        Some(attempt)
      }
    });

    assert_eq!(result, 3);
  }

  #[test]
  fn rx_context_is_reused_across_restart_cycles() {
    let (_tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
    let mut device = HackRfDevice {
      dev: ptr::null_mut(),
      rx_queue: rx,
      rx_context: None,
      last_error: None,
      sample_rate: HACKRF_MIN_SAMPLE_RATE,
      center_frequency: 0,
      requested_center_frequency: 0,
      iq_buffer: Vec::new(),
      audio_tap: AudioIqTap::new(),
      tx_context: None,
      tx_started: false,
      tx_guard_status: initial_tx_guard_status(None),
      tx_started_at: None,
      last_tx_diagnostic_at: None,
      last_m0_count: None,
      last_callback_failures: 0,
      tx_recovery_attempted: false,
      lna_gain: 0,
      vga_gain: 0,
      amp_enabled: false,
      streaming_started: false,
      serial_number: String::new(),
      native_session_active: false,
    };

    let first_ptr = device.rx_context_ptr();
    let second_ptr = device.rx_context_ptr();

    assert_eq!(first_ptr, second_ptr);
    assert!(device.rx_context.is_some());
  }

  #[test]
  fn repeated_cleanup_does_not_reenter_the_native_session() {
    // The shutdown path calls `cleanup()` explicitly and `Drop` calls it again.
    // The second pass must not tear the hackrf session down twice.
    let (_tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
    let mut device = HackRfDevice {
      dev: ptr::null_mut(),
      rx_queue: rx,
      rx_context: None,
      last_error: None,
      sample_rate: HACKRF_MIN_SAMPLE_RATE,
      center_frequency: 0,
      requested_center_frequency: 0,
      iq_buffer: Vec::new(),
      audio_tap: AudioIqTap::new(),
      tx_context: None,
      tx_started: false,
      tx_guard_status: initial_tx_guard_status(None),
      tx_started_at: None,
      last_tx_diagnostic_at: None,
      last_m0_count: None,
      last_callback_failures: 0,
      tx_recovery_attempted: false,
      lna_gain: 0,
      vga_gain: 0,
      amp_enabled: false,
      streaming_started: false,
      serial_number: String::new(),
      native_session_active: false,
    };

    assert!(device.cleanup().is_ok());
    assert!(device.cleanup().is_ok());
    assert!(!device.native_session_active);
    assert!(device.dev.is_null());
  }

  #[test]
  fn warm_rx_queue_is_drained_before_display_resumes() {
    let (tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
    tx.send(vec![1, 2]).unwrap();
    tx.send(vec![3, 4]).unwrap();

    assert_eq!(drain_rx_queue(&rx), 2);
    assert!(rx.try_recv().is_err());
  }

  #[test]
  fn live_queue_flush_is_bounded_while_rx_continues_to_produce() {
    let (tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
    for value in 0..HACKRF_RX_QUEUE_DEPTH {
      tx.send(vec![value as u8]).unwrap();
    }
    let (started_tx, started_rx) = bounded(1);
    let producer = std::thread::spawn(move || {
      started_tx.send(()).unwrap();
      for value in 0..512u16 {
        if tx.send(vec![value as u8]).is_err() {
          break;
        }
      }
    });
    started_rx.recv().unwrap();
    std::thread::sleep(Duration::from_millis(5));

    let drained = drain_rx_queue(&rx);
    drop(rx);
    producer.join().unwrap();

    assert!(drained <= HACKRF_RX_QUEUE_DEPTH);
  }

  #[test]
  fn display_read_selects_latest_bounded_block_and_taps_in_arrival_order() {
    let (tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
    for block in [vec![1], vec![2], vec![3], vec![4]] {
      tx.send(block).unwrap();
    }
    let first = rx.try_recv().unwrap();
    let mut tapped = Vec::new();

    let (latest, drained) =
      take_freshest_rx_block(&rx, first, HACKRF_RX_QUEUE_DEPTH, |block| {
        tapped.push(block[0])
      });

    assert_eq!(latest, vec![4]);
    assert_eq!(drained, 3);
    assert_eq!(tapped, vec![1, 2, 3, 4]);
  }

  #[test]
  fn display_read_bounds_drain_and_leaves_excess_blocks_queued() {
    let (tx, rx) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH);
    for value in 1..=4 {
      tx.send(vec![value]).unwrap();
    }
    let first = rx.try_recv().unwrap();

    let (latest, drained) = take_freshest_rx_block(&rx, first, 2, |_| {});

    assert_eq!(latest, vec![2]);
    assert_eq!(drained, 1);
    assert_eq!(rx.try_iter().count(), 2);
  }

  #[test]
  fn stopping_tx_requires_restarting_rx_when_tx_replaced_rx() {
    assert!(should_resume_rx_after_tx_stop(true, false));
    assert!(!should_resume_rx_after_tx_stop(true, true));
    assert!(!should_resume_rx_after_tx_stop(false, false));
  }

  #[test]
  fn tx_callback_context_accepts_new_iq_without_restarting_tx() {
    let context = TxContext::new(vec![1, 2, 3, 4]);

    context.replace_iq(vec![5, 6, 7, 8]);

    assert_eq!(context.snapshot_iq(), vec![5, 6, 7, 8]);
  }
}
