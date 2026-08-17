//! Acquisition-worker input and frame ownership contracts.

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::sdr::audio_iq_tap::AudioIqBlock;
use crate::sdr::processor::SdrProcessor;
use crate::server::shared_state::SharedState;
use crate::server::types::PowerScale;

/// A contiguous IQ block tagged with the source epoch that produced it.
///
/// Consumers must reject a frame whose epoch is no longer active. This keeps
/// samples produced before a source switch from leaking into the new source.
#[derive(Debug, Clone)]
pub struct AcquisitionFrame {
  pub source_epoch: u64,
  pub frame_sequence: u64,
  pub iq: Arc<[u8]>,
}

/// Output of one blocking device read plus DSP pass. Keeping the source and
/// capture metadata beside the buffers prevents the orchestration loop from
/// reconstructing ownership from mutable global state after the read.
#[derive(Debug)]
pub struct ProcessedFrame {
  pub source_id: String,
  pub waveform: Vec<f32>,
  pub timestamp: i64,
  pub center_frequency: u32,
  pub is_mock_apt: bool,
  pub device_type: String,
  pub power_scale: PowerScale,
  pub sample_rate: u32,
  pub raw_iq: Vec<u8>,
  pub target_fps: u32,
}

/// Resolve the IQ payload for the visualizer without forcing every live frame
/// through the optional contiguous-audio retention path. The audio tap is only
/// useful when an audio consumer is actively attached; the display already has
/// one complete frame in `last_frame_raw_iq`.
pub(crate) fn resolve_display_iq(
  audio_block: Option<AudioIqBlock>,
  fallback: &[u8],
) -> Vec<u8> {
  audio_block
    .map(|block| block.data)
    .filter(|data| !data.is_empty())
    .unwrap_or_else(|| fallback.to_vec())
}

#[derive(Clone)]
pub struct AcquisitionWorker {
  processor: Arc<Mutex<SdrProcessor>>,
  shared_state: Arc<SharedState>,
}

impl AcquisitionWorker {
  pub fn new(
    processor: Arc<Mutex<SdrProcessor>>,
    shared_state: Arc<SharedState>,
  ) -> Self {
    Self {
      processor,
      shared_state,
    }
  }

  /// Read and process one frame without blocking the async orchestration
  /// future. The processor lock remains owned by the device supervisor and is
  /// borrowed only for the duration of this blocking operation.
  pub async fn read_and_process(
    &self,
    captured_source_id: String,
    requested_single_frame: bool,
  ) -> Result<ProcessedFrame> {
    let processor = self.processor.clone();
    let shared_state = self.shared_state.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<ProcessedFrame> {
      let metrics = crate::performance::pipeline_metrics();
      metrics.increment(crate::performance::CounterKind::FramesRequested, 1);
      let _span = crate::performance::ProfilingSpan::start(
        metrics,
        crate::performance::Stage::Acquisition,
      );
      let mut processor = processor.blocking_lock();

      if shared_state
        .pending_center_freq_dirty
        .swap(false, std::sync::atomic::Ordering::AcqRel)
      {
        let pending_frequency = shared_state
          .pending_center_freq
          .load(std::sync::atomic::Ordering::Acquire);
        if pending_frequency > 0
          && pending_frequency != processor.get_center_frequency()
        {
          if let Err(error) =
            processor.set_center_frequency_live(pending_frequency)
          {
            log::warn!(
              "Failed to apply pending frequency in acquisition worker: {}",
              error
            );
          }
        }
      }

      let pending: Vec<_> = {
        let mut slot = shared_state.pending_fast_settings.lock().unwrap();
        std::mem::take(&mut *slot)
      };
      let old_fft_size = processor.fft_processor.config().fft_size;
      for settings in pending {
        if let Err(error) = processor.apply_settings(settings) {
          let supported_device_present = shared_state
            .usb_inventory_known
            .load(std::sync::atomic::Ordering::Acquire)
            && shared_state
              .supported_usb_device_count
              .load(std::sync::atomic::Ordering::Relaxed)
              > 0;
          if !processor.is_mock()
            && crate::server::websocket_server::should_promote_fast_path_error_to_read_error(
              &error,
              supported_device_present,
            )
          {
            return Err(error);
          }
          log::error!("Failed to apply fast-path settings: {}", error);
        }
      }
      if processor.fft_processor.config().fft_size != old_fft_size {
        processor.flush_read_queue();
        processor.frame.avg_spectrum = None;
      }

      let current_fft_size = processor.fft_processor.config().fft_size;
      let timestamp = chrono::Utc::now().timestamp_millis();
      if let Some(pending) = processor.frame.pending_freq.take() {
        if pending != processor.get_center_frequency() {
          if let Err(error) = processor.set_center_frequency_live(pending) {
            log::warn!(
              "Failed to apply pending frequency in acquisition worker: {}",
              error
            );
          }
        }
      }
      let active_source_id =
        crate::server::websocket_server::active_source_id(&shared_state);
      let tx_is_active = crate::safety::TX_TRANSMITTING
        .load(std::sync::atomic::Ordering::Relaxed);
      let streaming_mock_tx_monitor =
        crate::server::websocket_server::should_synthesize_mock_tx_monitor_frame(
          &active_source_id,
          tx_is_active,
          requested_single_frame,
        );
      let is_mock_apt = crate::server::websocket_server::frame_is_mock_apt(
        &captured_source_id,
        streaming_mock_tx_monitor,
      );
      let device_type = if streaming_mock_tx_monitor {
        crate::server::websocket_server::MOCK_TX_DISPLAY_NAME.to_string()
      } else {
        processor.device_type().to_string()
      };
      let power_scale = if streaming_mock_tx_monitor {
        PowerScale::DBm
      } else {
        processor.get_power_scale()
      };
      let sample_rate = {
        let processor_sample_rate = processor.get_sample_rate();
        if processor_sample_rate == 0 {
          shared_state.sdr_settings.lock().unwrap().sample_rate.max(1)
        } else {
          processor_sample_rate
        }
      };

      let mut center_frequency = processor.get_center_frequency();
      let (waveform, raw_iq) = if streaming_mock_tx_monitor {
        let tx_signal = crate::safety::TX_SIGNAL.lock().unwrap().clone();
        let tx_power_dbm = *crate::safety::TX_POWER_DBM.lock().unwrap();
        let tx_center_hz =
          *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap();
        let tx_bandwidth_hz = *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap();
        let tx_ifft_size = *crate::safety::TX_IFFT_SIZE.lock().unwrap();
        let tx_iq_power_model = crate::server::websocket_server::complex_baseband::resolve_mock_tx_iq_power_model();
        let tx_view_center_hz = *crate::safety::TX_MONITOR_VIEW_CENTER_HZ
          .lock()
          .unwrap();
        let center_frequency = if tx_view_center_hz > 0.0 {
          tx_view_center_hz.round().clamp(1.0, u32::MAX as f64) as u32
        } else if tx_center_hz > 0.0 {
          tx_center_hz.round().clamp(1.0, u32::MAX as f64) as u32
        } else {
          center_frequency
        };
        let tx_monitor_sample_rate = crate::safety::TX_MONITOR_SAMPLE_RATE_HZ
          .load(std::sync::atomic::Ordering::Relaxed);
        let monitor_sample_rate = if tx_monitor_sample_rate > 0 {
          tx_monitor_sample_rate
        } else {
          sample_rate
        };
        let monitor_fft_size =
          crate::server::websocket_server::resolve_mock_tx_monitor_fft_size(
            current_fft_size,
            tx_ifft_size,
          );
        let raw_iq = crate::server::websocket_server::complex_baseband::synthesize_mock_tx_monitor_iq(
          monitor_fft_size,
          center_frequency as f64,
          monitor_sample_rate,
          if tx_center_hz > 0.0 {
            tx_center_hz
          } else {
            center_frequency as f64
          },
          tx_bandwidth_hz,
          &tx_signal,
          tx_ifft_size,
          tx_power_dbm,
          &tx_iq_power_model,
          &mut *shared_state.mock_tx_phase_accumulator.lock().unwrap(),
        );
        (Vec::new(), raw_iq)
      } else {
        let force_noise = shared_state
          .force_noise
          .load(std::sync::atomic::Ordering::Relaxed);
        let waveform = processor.read_and_process_frame_with_noise(force_noise)?;
        center_frequency = processor.displayed_center_frequency();
        // Keep the live display on the single frame buffer. Enabling the
        // hardware audio tap here copied every USB chunk into a second
        // bounded queue even when no audio consumer was running, which made
        // physical devices slower than Mock sources with identical FFT work.
        let contiguous_iq = resolve_display_iq(None, &processor.frame.last_frame_raw_iq);
        (waveform, contiguous_iq)
      };

      metrics.increment(crate::performance::CounterKind::FramesProduced, 1);
      metrics.increment(
        crate::performance::CounterKind::Samples,
        (raw_iq.len() / 2) as u64,
      );
      metrics.increment(
        crate::performance::CounterKind::Bytes,
        raw_iq.len() as u64,
      );
      Ok(ProcessedFrame {
        source_id: captured_source_id,
        waveform,
        timestamp,
        center_frequency,
        is_mock_apt,
        device_type,
        power_scale,
        sample_rate,
        raw_iq,
        target_fps: processor.display_frame_rate,
      })
    })
    .await
    .map_err(|error| anyhow::anyhow!("Acquisition worker join failed: {error}"))?;

    result
  }
}

impl AcquisitionFrame {
  pub fn new(source_epoch: u64, frame_sequence: u64, iq: Vec<u8>) -> Self {
    Self {
      source_epoch,
      frame_sequence,
      iq: iq.into(),
    }
  }

  pub fn belongs_to_epoch(&self, source_epoch: u64) -> bool {
    self.source_epoch == source_epoch
  }
}

/// Publication fence for frames produced while a source handoff may still be
/// in flight. The frame source must match the active source, and a pending
/// source request must either already target the active source or be absent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FramePublicationGate {
  active_source_id: String,
  pending_source_id: Option<String>,
}

impl FramePublicationGate {
  pub fn new(active_source_id: &str, pending_source_id: Option<&str>) -> Self {
    Self {
      active_source_id: active_source_id.to_string(),
      pending_source_id: pending_source_id.map(str::to_string),
    }
  }

  pub fn accepts(&self, frame_source_id: &str) -> bool {
    frame_source_id == self.active_source_id
      && self
        .pending_source_id
        .as_deref()
        .map(|pending| pending == self.active_source_id)
        .unwrap_or(true)
  }
}

#[cfg(test)]
mod tests {
  use super::{
    resolve_display_iq, AcquisitionFrame, FramePublicationGate, ProcessedFrame,
  };
  use crate::server::types::PowerScale;

  #[test]
  fn display_iq_uses_the_frame_buffer_when_no_audio_consumer_is_present() {
    let fallback = vec![128, 129, 130, 131];

    assert_eq!(resolve_display_iq(None, &fallback), fallback);
  }

  #[test]
  fn frames_reject_a_previous_source_epoch() {
    let frame = AcquisitionFrame::new(7, 1, vec![1, 2, 3, 4]);

    assert!(frame.belongs_to_epoch(7));
    assert!(!frame.belongs_to_epoch(6));
  }

  #[test]
  fn publication_gate_rejects_frames_from_a_previous_source() {
    let gate = FramePublicationGate::new("mock-tx", Some("mock-tx"));

    assert!(!gate.accepts("mock-apt"));
    assert!(gate.accepts("mock-tx"));
  }

  #[test]
  fn processed_frame_keeps_source_and_capture_metadata_together() {
    let frame = ProcessedFrame {
      source_id: "rtl-sdr-1".to_string(),
      waveform: vec![1.0, 2.0],
      timestamp: 42,
      center_frequency: 137_500_000,
      is_mock_apt: false,
      device_type: "rtl_sdr".to_string(),
      power_scale: PowerScale::DBm,
      sample_rate: 2_400_000,
      raw_iq: vec![128, 128, 129, 127],
      target_fps: 30,
    };

    assert_eq!(frame.source_id, "rtl-sdr-1");
    assert_eq!(frame.raw_iq.len(), 4);
    assert_eq!(frame.sample_rate, 2_400_000);
  }
}
