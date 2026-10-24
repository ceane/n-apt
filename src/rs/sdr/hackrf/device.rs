use anyhow::{anyhow, Result};
use crossbeam_channel::{bounded, Receiver, Sender};
use std::ffi::CStr;
use std::os::raw::c_int;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use super::ffi;
use crate::sdr::audio_iq_tap::{AudioIqBlock, AudioIqTap};
use crate::sdr::SdrDevice;

const HACKRF_MAX_SAMPLE_RATE: u32 = 20_000_000;
const HACKRF_MIN_SAMPLE_RATE: u32 = 2_000_000;
const HACKRF_RX_QUEUE_DEPTH: usize = 8;
const HACKRF_DEFAULT_TRANSFER_BUFFER_SIZE: usize = 262_144;
const HACKRF_RX_TIMEOUT: Duration = Duration::from_millis(500);
const HACKRF_RX_START_RETRY_ATTEMPTS: usize = 5;
const HACKRF_RX_START_RETRY_DELAY: Duration = Duration::from_millis(250);

static HACKRF_NATIVE_OPERATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct RxBlock {
  sequence: u64,
  generation: u64,
  data: Vec<u8>,
}

struct RxContext {
  tx: Sender<RxBlock>,
  recycle: Sender<Vec<u8>>,
  free_buffers: Receiver<Vec<u8>>,
  next_sequence: AtomicU64,
  generation: AtomicU64,
  tuning: AtomicBool,
  invalid_transfers: AtomicU64,
  short_transfers: AtomicU64,
  queue_drops: AtomicU64,
  tune_discards: AtomicU64,
  callback_allocations: AtomicU64,
  callback_allocated_bytes: AtomicU64,
  copies: AtomicU64,
  copied_bytes: AtomicU64,
  recycled_buffers: AtomicU64,
}

impl RxContext {
  fn new(
    tx: Sender<RxBlock>,
    recycle: Sender<Vec<u8>>,
    free_buffers: Receiver<Vec<u8>>,
  ) -> Self {
    Self {
      tx,
      recycle,
      free_buffers,
      next_sequence: AtomicU64::new(0),
      generation: AtomicU64::new(0),
      tuning: AtomicBool::new(false),
      invalid_transfers: AtomicU64::new(0),
      short_transfers: AtomicU64::new(0),
      queue_drops: AtomicU64::new(0),
      tune_discards: AtomicU64::new(0),
      callback_allocations: AtomicU64::new(0),
      callback_allocated_bytes: AtomicU64::new(0),
      copies: AtomicU64::new(0),
      copied_bytes: AtomicU64::new(0),
      recycled_buffers: AtomicU64::new(0),
    }
  }

  fn recycle_buffer(&self, mut buffer: Vec<u8>) {
    buffer.clear();
    if self.recycle.try_send(buffer).is_ok() {
      self.recycled_buffers.fetch_add(1, Ordering::Relaxed);
    }
  }

  fn prepare_retune(&self) -> u64 {
    self.tuning.store(true, Ordering::Release);
    self.generation.fetch_add(1, Ordering::AcqRel) + 1
  }

  fn finish_retune(&self) {
    self.tuning.store(false, Ordering::Release);
  }
}

#[derive(Default)]
struct HackRfFrameAssembler {
  current: Option<RxBlock>,
  current_offset: usize,
  expected_sequence: Option<u64>,
  generation: Option<u64>,
  sequence_gaps: u64,
  incomplete_windows_dropped: u64,
}

impl HackRfFrameAssembler {
  fn fill_frame(
    &mut self,
    fft_size: usize,
    output: &mut Vec<u8>,
    mut next_block: impl FnMut() -> Result<RxBlock>,
    mut on_block: impl FnMut(&[u8], bool),
    mut recycle: impl FnMut(Vec<u8>),
  ) -> Result<()> {
    let target_len = fft_size
      .checked_mul(2)
      .filter(|target| *target > 0)
      .ok_or_else(|| anyhow!("HackRF FFT size must be positive"))?;
    output.clear();
    output.reserve(target_len);

    while output.len() < target_len {
      if self
        .current
        .as_ref()
        .is_some_and(|block| self.current_offset >= block.data.len())
      {
        if let Some(block) = self.current.take() {
          recycle(block.data);
        }
        self.current_offset = 0;
      }

      if self.current.is_none() {
        let block = match next_block() {
          Ok(block) => block,
          Err(error) => {
            if !output.is_empty() {
              self.incomplete_windows_dropped += 1;
              output.clear();
            }
            return Err(error);
          }
        };
        if block.data.is_empty() || block.data.len() % 2 != 0 {
          recycle(block.data);
          self.incomplete_windows_dropped += 1;
          output.clear();
          continue;
        }

        let sequence_gap = self
          .expected_sequence
          .is_some_and(|expected| expected != block.sequence);
        let generation_changed = self
          .generation
          .is_some_and(|generation| generation != block.generation);
        let discontinuity = sequence_gap || generation_changed;
        if sequence_gap {
          let missed = self
            .expected_sequence
            .map(|expected| block.sequence.saturating_sub(expected).max(1))
            .unwrap_or(1);
          self.sequence_gaps = self.sequence_gaps.saturating_add(missed);
        }
        if discontinuity {
          if !output.is_empty() {
            self.incomplete_windows_dropped += 1;
            output.clear();
          }
          self.current_offset = 0;
        }
        self.expected_sequence = Some(block.sequence.wrapping_add(1));
        self.generation = Some(block.generation);
        on_block(&block.data, discontinuity);
        self.current = Some(block);
      }

      let block = self.current.as_ref().expect("current block was loaded");
      let remaining = target_len - output.len();
      let available = block.data.len() - self.current_offset;
      let count = remaining.min(available);
      // Both offsets stay on complete I/Q byte pairs: valid transfers and the
      // requested FFT window are even-sized.
      output.extend_from_slice(
        &block.data[self.current_offset..self.current_offset + count],
      );
      self.current_offset += count;
    }

    Ok(())
  }

  fn reset(&mut self, recycle: impl FnMut(Vec<u8>)) {
    let mut recycle = recycle;
    if let Some(block) = self.current.take() {
      recycle(block.data);
    }
    self.current_offset = 0;
    self.expected_sequence = None;
    self.generation = None;
  }
}

fn valid_rx_transfer_length(
  valid_length: c_int,
  buffer_length: c_int,
) -> Option<usize> {
  if valid_length <= 0
    || buffer_length <= 0
    || valid_length > buffer_length
    || valid_length % 2 != 0
  {
    return None;
  }
  Some(valid_length as usize)
}
struct TxContext {
  iq: Mutex<Vec<u8>>,
}

impl TxContext {
  fn new(iq: Vec<u8>) -> Self {
    Self { iq: Mutex::new(iq) }
  }

  fn replace_iq(&self, iq: Vec<u8>) {
    *self.iq.lock().unwrap() = iq;
  }

  fn snapshot_iq(&self) -> Vec<u8> {
    self.iq.lock().unwrap().clone()
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

#[cfg(test)]
fn drain_rx_queue<T>(rx: &Receiver<T>) -> usize {
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

/// Tap every block consumed for one display read and return the newest block.
/// `max_blocks` includes `first`, so a live callback cannot keep this drain
/// loop occupied by replenishing the bounded receiver as quickly as it drains.
#[cfg(test)]
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

fn apply_hackrf_frequency_tune(
  frequency_hz: u32,
  ppm: u32,
  requested_frequency: &mut u32,
  effective_frequency: &mut u32,
  write_frequency: impl FnOnce(u64) -> i32,
) -> Result<()> {
  let corrected_frequency = apply_ppm_correction(frequency_hz, ppm);
  let result = write_frequency(u64::from(corrected_frequency));
  if result != 0 {
    return Err(anyhow!(
      "Failed to set HackRF One center frequency to {} (corrected {})",
      frequency_hz,
      corrected_frequency
    ));
  }
  *requested_frequency = frequency_hz;
  *effective_frequency = frequency_hz;
  Ok(())
}

pub struct HackRfDevice {
  dev: *mut ffi::HackRfDeviceHandle,
  rx_queue: Receiver<RxBlock>,
  rx_context: Option<Arc<RxContext>>,
  tx_context: Option<Arc<TxContext>>,
  tx_started: bool,
  last_error: Option<String>,
  sample_rate: u32,
  center_frequency: u32,
  requested_center_frequency: u32,
  ppm: u32,
  transfer_buffer_size: usize,
  frame_assembler: HackRfFrameAssembler,
  iq_buffer: Vec<u8>,
  /// Contiguous IQ retained for streaming consumers such as audio.
  audio_tap: AudioIqTap,
  streaming_started: bool,
  serial_number: String,
  /// True while this handle owns the process-wide hackrf session opened by
  /// `hackrf_init`. Guards the exit so an explicit `cleanup()` followed by the
  /// later `Drop` cannot tear the native session down twice.
  native_session_active: bool,
}

unsafe impl Send for HackRfDevice {}

/// Receive samples from a native HackRF transfer.
///
/// # Safety
/// The libhackrf callback contract must be upheld: `transfer` must point to a
/// live, writable `HackRfTransfer`; its RX context must point to a live
/// `RxContext`; and its buffer must point to `buffer_length` readable bytes.
/// The device retains the RX context until RX streaming has stopped.
unsafe extern "C" fn hackrf_rx_callback(
  transfer: *mut ffi::HackRfTransfer,
) -> c_int {
  let res = std::panic::catch_unwind(|| {
    if transfer.is_null() {
      return 0;
    }

    // SAFETY: libhackrf supplies a live transfer structure for each callback.
    let transfer = unsafe { &mut *transfer };
    if transfer.rx_ctx.is_null() {
      return 0;
    }

    // SAFETY: RX starts with a pointer derived from the device-owned Arc, which
    // remains alive until the native stream is stopped.
    let ctx = unsafe { &*(transfer.rx_ctx as *const RxContext) };
    let sequence = ctx.next_sequence.fetch_add(1, Ordering::Relaxed);
    let Some(len) =
      valid_rx_transfer_length(transfer.valid_length, transfer.buffer_length)
    else {
      ctx.invalid_transfers.fetch_add(1, Ordering::Relaxed);
      return 0;
    };
    if transfer.buffer.is_null() {
      ctx.invalid_transfers.fetch_add(1, Ordering::Relaxed);
      return 0;
    }
    if transfer.valid_length < transfer.buffer_length {
      ctx.short_transfers.fetch_add(1, Ordering::Relaxed);
    }
    if ctx.tuning.load(Ordering::Acquire) {
      ctx.tune_discards.fetch_add(1, Ordering::Relaxed);
      return 0;
    }
    let generation = ctx.generation.load(Ordering::Acquire);
    // SAFETY: `valid_rx_transfer_length` bounds `len` by the transfer's native
    // buffer length, and libhackrf owns a readable buffer of that size here.
    let data = unsafe { std::slice::from_raw_parts(transfer.buffer, len) };
    let mut block = match ctx.free_buffers.try_recv() {
      Ok(buffer) if buffer.capacity() >= len => buffer,
      Ok(_undersized_buffer) => {
        // A transfer size can differ from the default pool size. Do not return
        // an undersized buffer to the pool or every callback would allocate
        // the same larger buffer again.
        ctx.callback_allocations.fetch_add(1, Ordering::Relaxed);
        ctx
          .callback_allocated_bytes
          .fetch_add(len as u64, Ordering::Relaxed);
        Vec::with_capacity(len)
      }
      Err(_) => {
        ctx.callback_allocations.fetch_add(1, Ordering::Relaxed);
        ctx
          .callback_allocated_bytes
          .fetch_add(len as u64, Ordering::Relaxed);
        Vec::with_capacity(len)
      }
    };
    block.clear();
    block.extend_from_slice(data);
    ctx.copies.fetch_add(1, Ordering::Relaxed);
    ctx.copied_bytes.fetch_add(len as u64, Ordering::Relaxed);

    if ctx.tuning.load(Ordering::Acquire)
      || ctx.generation.load(Ordering::Acquire) != generation
    {
      ctx.tune_discards.fetch_add(1, Ordering::Relaxed);
      ctx.recycle_buffer(block);
      return 0;
    }

    let rx_block = RxBlock {
      sequence,
      generation,
      data: block,
    };
    if let Err(error) = ctx.tx.try_send(rx_block) {
      ctx.queue_drops.fetch_add(1, Ordering::Relaxed);
      let block = match error {
        crossbeam_channel::TrySendError::Full(block)
        | crossbeam_channel::TrySendError::Disconnected(block) => block,
      };
      ctx.recycle_buffer(block.data);
    }

    0
  });
  res.unwrap_or(0)
}

/// Fill a native HackRF transfer with the current transmit samples.
///
/// # Safety
/// The libhackrf callback contract must be upheld: `transfer` must point to a
/// live, writable `HackRfTransfer`; its TX context must point to a live
/// `TxContext`; and its buffer must point to `buffer_length` writable bytes.
/// The device retains the TX context until TX streaming has stopped.
unsafe extern "C" fn hackrf_tx_callback(
  transfer: *mut ffi::HackRfTransfer,
) -> c_int {
  let res = std::panic::catch_unwind(|| {
    if transfer.is_null() {
      return -1;
    }
    // SAFETY: libhackrf supplies a live transfer structure for each callback.
    let transfer = unsafe { &mut *transfer };
    if transfer.buffer.is_null()
      || transfer.buffer_length <= 0
      || transfer.tx_ctx.is_null()
    {
      return -1;
    }
    // SAFETY: TX starts with a pointer derived from the live Arc held by
    // `transmit_iq`; the device retains that Arc until streaming has stopped.
    let ctx = unsafe { &*(transfer.tx_ctx as *const TxContext) };
    let iq = ctx.snapshot_iq();
    if iq.is_empty() {
      return -1;
    }
    // SAFETY: libhackrf provides a writable buffer of `buffer_length` bytes for
    // this callback, and the length was checked to be positive above.
    let output = unsafe {
      std::slice::from_raw_parts_mut(
        transfer.buffer,
        transfer.buffer_length as usize,
      )
    };
    if crate::tx::repeat_iq_payload_into(&iq, output).is_err() {
      return -1;
    }
    transfer.valid_length = output.len() as c_int;
    0
  });
  res.unwrap_or(-1)
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
      let transfer_buffer_size = ffi::hackrf_get_transfer_buffer_size(dev);
      let transfer_buffer_size = if transfer_buffer_size >= 2 {
        transfer_buffer_size
      } else {
        HACKRF_DEFAULT_TRANSFER_BUFFER_SIZE
      };
      let (_tx, rx) = bounded::<RxBlock>(HACKRF_RX_QUEUE_DEPTH);
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
        ppm: 0,
        transfer_buffer_size,
        frame_assembler: HackRfFrameAssembler::default(),
        iq_buffer: Vec::with_capacity(32_768 * 2),
        audio_tap: AudioIqTap::new(),
        streaming_started: false,
        serial_number,
        native_session_active: true,
      })
    }
  }

  fn rx_context_ptr(&mut self) -> *mut std::os::raw::c_void {
    if self.rx_context.is_none() {
      let (tx, rx) = bounded::<RxBlock>(HACKRF_RX_QUEUE_DEPTH);
      let (recycle, free_buffers) =
        bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH * 2);
      for _ in 0..HACKRF_RX_QUEUE_DEPTH {
        let _ = recycle.try_send(Vec::with_capacity(self.transfer_buffer_size));
      }
      self.rx_queue = rx;
      self.rx_context =
        Some(Arc::new(RxContext::new(tx, recycle, free_buffers)));
    }

    Arc::as_ptr(self.rx_context.as_ref().expect("rx context")) as *mut _
  }

  fn set_sample_rate_inner(&mut self, rate: u32) -> Result<()> {
    let clamped = rate.clamp(HACKRF_MIN_SAMPLE_RATE, HACKRF_MAX_SAMPLE_RATE);
    let context = self.rx_context.as_ref().cloned();
    if let Some(context) = context.as_ref() {
      context.prepare_retune();
    }
    let ret =
      unsafe { ffi::hackrf_set_sample_rate_manual(self.dev, clamped, 1) };
    if ret != 0 {
      if let Some(context) = context {
        context.finish_retune();
      }
      return Err(anyhow!(
        "Failed to set HackRF One sample rate to {} Hz",
        clamped
      ));
    }
    self.sample_rate = clamped;
    if self.rx_context.is_some() {
      self.flush_read_queue();
    }
    if let Some(context) = context {
      context.finish_retune();
    }
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
        let payload = prepare_hackrf_tx_payload(samples);
        if payload.is_empty() {
          return Err(anyhow!("HackRF TX requires I/Q samples"));
        }
        let context = Arc::new(TxContext::new(payload));
        let ret = unsafe {
          ffi::hackrf_start_tx(
            self.dev,
            Some(hackrf_tx_callback),
            Arc::as_ptr(&context) as *mut _,
          )
        };
        if ret != 0 {
          return Err(anyhow!(
            "Failed to start HackRF One TX streaming (error code: {})",
            ret
          ));
        }
        self.tx_context = Some(context);
        self.tx_started = true;
      }
      None => {
        let was_transmitting = self.tx_started;
        self.stop_transmitting();
        self.tx_context = None;
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
    let audio_enabled = self.audio_tap.is_enabled();
    let rx_queue = self.rx_queue.clone();
    let context = self.rx_context.as_ref().cloned();
    let frame_assembler = &mut self.frame_assembler;
    let iq_buffer = &mut self.iq_buffer;
    let audio_tap = &mut self.audio_tap;
    let acquisition_started = std::time::Instant::now();
    let assembled = frame_assembler.fill_frame(
      fft_size,
      iq_buffer,
      || {
        rx_queue
          .recv_timeout(HACKRF_RX_TIMEOUT)
          .map_err(|err| match err {
            crossbeam_channel::RecvTimeoutError::Timeout => {
              anyhow!("Timeout waiting for HackRF One RX samples")
            }
            crossbeam_channel::RecvTimeoutError::Disconnected => {
              anyhow!("HackRF One RX queue closed")
            }
          })
      },
      |chunk, discontinuity| {
        if audio_enabled {
          if discontinuity {
            audio_tap.clear();
          }
          let mut normalized = chunk.to_vec();
          normalize_hackrf_buffer(&mut normalized);
          audio_tap.push(&normalized);
        }
      },
      |buffer| {
        if let Some(context) = context.as_ref() {
          context.recycle_buffer(buffer);
        }
      },
    );
    let acquisition_elapsed = acquisition_started.elapsed();

    let metrics = crate::performance::pipeline_metrics();
    metrics.record_latency(
      crate::performance::Stage::Acquisition,
      acquisition_elapsed,
    );
    metrics.observe_queue(
      crate::performance::Stage::Acquisition,
      rx_queue.len() as u64,
    );
    if let Some(context) = self.rx_context.as_ref() {
      metrics.increment(
        crate::performance::CounterKind::HackrfShortTransfers,
        context.short_transfers.swap(0, Ordering::Relaxed),
      );
      metrics.increment(
        crate::performance::CounterKind::HackrfQueueDrops,
        context.queue_drops.swap(0, Ordering::Relaxed),
      );
      metrics.increment(
        crate::performance::CounterKind::Allocations,
        context.callback_allocations.swap(0, Ordering::Relaxed),
      );
      metrics.increment(
        crate::performance::CounterKind::AllocatedBytes,
        context.callback_allocated_bytes.swap(0, Ordering::Relaxed),
      );
      metrics.increment(
        crate::performance::CounterKind::Copies,
        context.copies.swap(0, Ordering::Relaxed),
      );
      metrics.increment(
        crate::performance::CounterKind::CopiedBytes,
        context.copied_bytes.swap(0, Ordering::Relaxed),
      );
      metrics.increment(
        crate::performance::CounterKind::HackrfInvalidTransfers,
        context.invalid_transfers.swap(0, Ordering::Relaxed),
      );
      metrics.increment(
        crate::performance::CounterKind::HackrfTuneDiscards,
        context.tune_discards.swap(0, Ordering::Relaxed),
      );
      metrics.increment(
        crate::performance::CounterKind::HackrfRecycledBuffers,
        context.recycled_buffers.swap(0, Ordering::Relaxed),
      );
    }
    metrics.increment(
      crate::performance::CounterKind::SequenceGaps,
      std::mem::take(&mut self.frame_assembler.sequence_gaps),
    );
    metrics.increment(
      crate::performance::CounterKind::HackrfIncompleteWindowsDropped,
      std::mem::take(&mut self.frame_assembler.incomplete_windows_dropped),
    );
    assembled?;

    // Normalize signed i8 IQ data to unsigned u8 offset binary (centered at 128)
    normalize_hackrf_buffer(&mut self.iq_buffer);

    Ok(crate::signal_port::fft::types::RawSamples {
      data: std::mem::take(&mut self.iq_buffer),
      sample_rate: self.sample_rate,
    })
  }

  fn recycle_read_buffer(&mut self, mut buffer: Vec<u8>) {
    buffer.clear();
    if buffer.capacity() > self.iq_buffer.capacity() {
      self.iq_buffer = buffer;
    }
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
    apply_hackrf_frequency_tune(
      freq,
      self.ppm,
      &mut self.requested_center_frequency,
      &mut self.center_frequency,
      |corrected_freq| unsafe {
        ffi::hackrf_set_freq(self.dev, corrected_freq as u64)
      },
    )
  }

  fn set_center_frequency_live(&mut self, freq: u32) -> Result<()> {
    // hackrf_set_freq is a synchronous control transfer and stays valid while
    // RX is streaming. Stopping and restarting the native stream here
    // (hackrf_stop_rx can block in firmware) turned every VFO tick into a full
    // stream restart and stalled scrolling. Retune in place, then drop chunks
    // already buffered at the old LO so the next frame is new-frequency content.
    let context = self.rx_context.as_ref().cloned();
    if let Some(context) = context.as_ref() {
      context.prepare_retune();
    }
    let result = self.set_center_frequency(freq);
    self.flush_read_queue();
    if let Some(context) = context {
      context.finish_retune();
    }
    result
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
    let context = self.rx_context.as_ref().cloned();
    while let Ok(block) = self.rx_queue.try_recv() {
      if let Some(context) = context.as_ref() {
        context.recycle_buffer(block.data);
      }
    }
    let recycle_context = context.clone();
    self.frame_assembler.reset(|buffer| {
      if let Some(context) = recycle_context.as_ref() {
        context.recycle_buffer(buffer);
      }
    });
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
    if self.dev.is_null() {
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
  use std::collections::VecDeque;

  fn rx_block(sequence: u64, generation: u64, data: &[u8]) -> RxBlock {
    RxBlock {
      sequence,
      generation,
      data: data.to_vec(),
    }
  }

  fn fill_frame(
    assembler: &mut HackRfFrameAssembler,
    fft_size: usize,
    blocks: &mut VecDeque<RxBlock>,
    output: &mut Vec<u8>,
  ) -> Result<()> {
    assembler.fill_frame(
      fft_size,
      output,
      || {
        blocks
          .pop_front()
          .ok_or_else(|| anyhow!("test blocks exhausted"))
      },
      |_, _| {},
      |_| {},
    )
  }

  #[test]
  fn transfer_length_accepts_short_complete_iq_pairs_without_padding() {
    assert_eq!(valid_rx_transfer_length(4, 8), Some(4));
    assert_eq!(valid_rx_transfer_length(3, 8), None);
    assert_eq!(valid_rx_transfer_length(9, 8), None);
    assert_eq!(valid_rx_transfer_length(0, 8), None);
  }

  #[test]
  fn frame_assembly_combines_transfers_and_preserves_unconsumed_samples() {
    let mut assembler = HackRfFrameAssembler::default();
    let mut blocks = VecDeque::from([
      rx_block(0, 1, &[1, 2, 3, 4, 5, 6, 7, 8]),
      rx_block(1, 1, &[9, 10, 11, 12, 13, 14, 15, 16]),
    ]);
    let mut frame = Vec::new();

    fill_frame(&mut assembler, 2, &mut blocks, &mut frame).unwrap();
    assert_eq!(frame, vec![1, 2, 3, 4]);
    fill_frame(&mut assembler, 2, &mut blocks, &mut frame).unwrap();
    assert_eq!(frame, vec![5, 6, 7, 8]);
    fill_frame(&mut assembler, 2, &mut blocks, &mut frame).unwrap();
    assert_eq!(frame, vec![9, 10, 11, 12]);
  }

  #[test]
  fn frame_assembly_waits_for_a_full_window_across_short_transfers() {
    let mut assembler = HackRfFrameAssembler::default();
    let mut blocks = VecDeque::from([
      rx_block(0, 1, &[1, 2]),
      rx_block(1, 1, &[3, 4]),
      rx_block(2, 1, &[5, 6]),
      rx_block(3, 1, &[7, 8]),
    ]);
    let mut frame = Vec::new();

    fill_frame(&mut assembler, 4, &mut blocks, &mut frame).unwrap();

    assert_eq!(frame.len(), 8);
    assert_eq!(frame, vec![1, 2, 3, 4, 5, 6, 7, 8]);
  }

  #[test]
  fn frame_assembly_drops_partial_window_on_sequence_gap() {
    let mut assembler = HackRfFrameAssembler::default();
    let mut blocks = VecDeque::from([
      rx_block(0, 1, &[1, 2]),
      rx_block(2, 1, &[3, 4]),
      rx_block(3, 1, &[5, 6]),
    ]);
    let mut frame = Vec::new();

    fill_frame(&mut assembler, 2, &mut blocks, &mut frame).unwrap();

    assert_eq!(frame, vec![3, 4, 5, 6]);
    assert_eq!(assembler.sequence_gaps, 1);
    assert_eq!(assembler.incomplete_windows_dropped, 1);
  }

  #[test]
  fn frame_assembly_never_combines_samples_across_retune_generations() {
    let mut assembler = HackRfFrameAssembler::default();
    let mut blocks = VecDeque::from([
      rx_block(0, 1, &[1, 2]),
      rx_block(1, 2, &[3, 4]),
      rx_block(2, 2, &[5, 6]),
    ]);
    let mut frame = Vec::new();

    fill_frame(&mut assembler, 2, &mut blocks, &mut frame).unwrap();

    assert_eq!(frame, vec![3, 4, 5, 6]);
    assert_eq!(assembler.incomplete_windows_dropped, 1);
  }

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

  #[test]
  fn applies_ppm_correction_by_adjusting_tune_frequency() {
    assert_eq!(apply_ppm_correction(100_000_000, 0), 100_000_000);
    assert_eq!(apply_ppm_correction(100_000_000, 10), 100_001_000);
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
    let (_tx, rx) = bounded::<RxBlock>(HACKRF_RX_QUEUE_DEPTH);
    let mut device = HackRfDevice {
      dev: ptr::null_mut(),
      rx_queue: rx,
      rx_context: None,
      last_error: None,
      sample_rate: HACKRF_MIN_SAMPLE_RATE,
      center_frequency: 0,
      requested_center_frequency: 0,
      ppm: 0,
      transfer_buffer_size: HACKRF_DEFAULT_TRANSFER_BUFFER_SIZE,
      frame_assembler: HackRfFrameAssembler::default(),
      iq_buffer: Vec::new(),
      audio_tap: AudioIqTap::new(),
      tx_context: None,
      tx_started: false,
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
    let (_tx, rx) = bounded::<RxBlock>(HACKRF_RX_QUEUE_DEPTH);
    let mut device = HackRfDevice {
      dev: ptr::null_mut(),
      rx_queue: rx,
      rx_context: None,
      last_error: None,
      sample_rate: HACKRF_MIN_SAMPLE_RATE,
      center_frequency: 0,
      requested_center_frequency: 0,
      ppm: 0,
      transfer_buffer_size: HACKRF_DEFAULT_TRANSFER_BUFFER_SIZE,
      frame_assembler: HackRfFrameAssembler::default(),
      iq_buffer: Vec::new(),
      audio_tap: AudioIqTap::new(),
      tx_context: None,
      tx_started: false,
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
  fn corrected_frequency_is_written_once_and_only_committed_on_success() {
    let mut requested = 10_000_000;
    let mut effective = 10_000_000;
    let mut writes = Vec::new();

    apply_hackrf_frequency_tune(
      100_000_000,
      10,
      &mut requested,
      &mut effective,
      |hz| {
        writes.push(hz);
        0
      },
    )
    .unwrap();

    assert_eq!(writes, vec![100_001_000]);
    assert_eq!(requested, 100_000_000);
    assert_eq!(effective, 100_000_000);

    let result = apply_hackrf_frequency_tune(
      200_000_000,
      10,
      &mut requested,
      &mut effective,
      |_| -1,
    );
    assert!(result.is_err());
    assert_eq!(requested, 100_000_000);
    assert_eq!(effective, 100_000_000);
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

  #[test]
  fn tx_callback_reads_tx_context_without_starting_hardware_tx() {
    let context = TxContext::new(vec![11, 22, 33, 44]);
    let mut output = [0_u8; 8];
    let mut transfer = ffi::HackRfTransfer {
      device: ptr::null_mut(),
      buffer: output.as_mut_ptr(),
      buffer_length: output.len() as c_int,
      valid_length: 0,
      rx_ctx: ptr::null_mut(),
      tx_ctx: (&context as *const TxContext).cast_mut().cast(),
    };

    assert_eq!(hackrf_tx_callback(&mut transfer), 0);
    assert_eq!(transfer.valid_length, output.len() as c_int);
    assert_eq!(output, [11, 22, 33, 44, 11, 22, 33, 44]);
  }

  #[test]
  fn rx_callback_uses_buffer_pool_for_a_valid_short_transfer() {
    let (tx, rx) = bounded::<RxBlock>(HACKRF_RX_QUEUE_DEPTH);
    let (recycle, free_buffers) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH * 2);
    recycle.send(Vec::with_capacity(8)).unwrap();
    let context = RxContext::new(tx, recycle, free_buffers);
    let mut input = [10_u8, 20, 30, 40, 0, 0, 0, 0];
    let mut transfer = ffi::HackRfTransfer {
      device: ptr::null_mut(),
      buffer: input.as_mut_ptr(),
      buffer_length: input.len() as c_int,
      valid_length: 4,
      rx_ctx: (&context as *const RxContext).cast_mut().cast(),
      tx_ctx: ptr::null_mut(),
    };

    assert_eq!(hackrf_rx_callback(&mut transfer), 0);

    let block = rx.try_recv().expect("callback sends the acquired bytes");
    assert_eq!(block.sequence, 0);
    assert_eq!(block.generation, 0);
    assert_eq!(block.data, [10, 20, 30, 40]);
    assert_eq!(context.short_transfers.load(Ordering::Relaxed), 1);
    assert_eq!(context.callback_allocations.load(Ordering::Relaxed), 0);
  }

  #[test]
  fn callback_replaces_pool_buffers_smaller_than_actual_transfer_size() {
    let (tx, _rx) = bounded::<RxBlock>(HACKRF_RX_QUEUE_DEPTH);
    let (recycle, free_buffers) = bounded::<Vec<u8>>(HACKRF_RX_QUEUE_DEPTH * 2);
    recycle.send(Vec::with_capacity(4)).unwrap();
    let context = RxContext::new(tx, recycle, free_buffers.clone());
    let mut input = [10_u8, 20, 30, 40, 50, 60, 70, 80];
    let mut transfer = ffi::HackRfTransfer {
      device: ptr::null_mut(),
      buffer: input.as_mut_ptr(),
      buffer_length: input.len() as c_int,
      valid_length: input.len() as c_int,
      rx_ctx: (&context as *const RxContext).cast_mut().cast(),
      tx_ctx: ptr::null_mut(),
    };

    assert_eq!(hackrf_rx_callback(&mut transfer), 0);

    assert!(free_buffers.is_empty());
    assert_eq!(context.callback_allocations.load(Ordering::Relaxed), 1);
  }
}
