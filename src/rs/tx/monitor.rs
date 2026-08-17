//! TX monitor synthesis and physical transmit orchestration.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tokio::sync::{broadcast, Mutex};

use crate::sdr::processor::SdrProcessor;
use crate::server::shared_state::SharedState;
use crate::server::stream_manager::{
  StreamKey, StreamMode, StreamingSourceModeManager,
};
use crate::server::types::SpectrumData;
use crate::server::websocket_server::complex_baseband;
use crate::server::websocket_server::{
  active_source_id, broadcast_device_status,
};

/// State and settings carried by a transmit-status command.
#[derive(Debug, Clone)]
pub struct TxStatusRequest {
  pub enabled: bool,
  pub device: String,
  pub tx_signal: Option<String>,
  pub center_frequency_hz: Option<u64>,
  pub sample_rate_hz: Option<u64>,
  pub bandwidth_hz: Option<f64>,
  pub tx_ifft_size: Option<usize>,
  pub power_dbm: Option<f64>,
  pub lna_gain_db: Option<f64>,
  pub vga_gain_db: Option<f64>,
  pub amp_enabled: Option<bool>,
  pub tuner_agc: Option<bool>,
  pub rtl_agc: Option<bool>,
  pub ppm: Option<u32>,
}

/// Outcome of a request-only standby preview attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StandbyPreviewOutcome {
  /// A standby preview frame was published for the requesting source.
  Published,
  /// No standby request is armed at all; the general paused-frame path may
  /// wake normally.
  NoRequest,
}

/// Publishes the latest TX monitor frame without entering the RX acquisition
/// loop. Display consumers are allowed to skip frames; physical TX remains
/// controlled by `TxWorker::apply_status` and the safety gates.
pub(crate) fn spawn_monitor_stream(
  shared_state: Arc<SharedState>,
  spectrum_tx: broadcast::Sender<Arc<SpectrumData>>,
  stream_manager: StreamingSourceModeManager,
) -> tokio::task::JoinHandle<()> {
  tokio::spawn(async move {
    let mut ticker = tokio::time::interval(
      crate::server::websocket_server::TX_MONITOR_FRAME_INTERVAL,
    );
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
      ticker.tick().await;
      if shared_state.shutdown.load(Ordering::Relaxed) {
        break;
      }
      let tx_is_active = crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed);
      let active_source_id = active_source_id(&shared_state);
      let active_tx_key =
        StreamKey::new(active_source_id.clone(), StreamMode::Tx);
      let mock_tx_key = StreamKey::new(
        crate::server::websocket_server::MOCK_TX_SOURCE_ID,
        StreamMode::Tx,
      );
      let tx_key = if stream_manager.has_stream(&active_tx_key)
        || stream_manager.tx_payload(&active_tx_key).is_some()
      {
        active_tx_key
      } else {
        mock_tx_key
      };
      let managed_tx_stream = stream_manager.has_stream(&tx_key);
      if !crate::server::websocket_server::should_run_tx_monitor(
        &active_source_id,
        tx_is_active,
        managed_tx_stream,
      ) {
        continue;
      }
      let frame = if active_source_id
        == crate::server::websocket_server::MOCK_TX_SOURCE_ID
      {
        let frame_state = shared_state.clone();
        match tokio::task::spawn_blocking(move || {
                    crate::server::websocket_handlers::build_mock_tx_standby_preview_frame(
                        &frame_state,
                    )
                })
                .await
                {
                    Ok(frame) => frame,
                    Err(_) => continue,
                }
      } else {
        let Some(payload) = stream_manager.tx_payload(&tx_key) else {
          continue;
        };
        crate::server::websocket_handlers::build_tx_monitor_frame_from_iq(
          &shared_state,
          &active_source_id,
          payload.center_frequency_hz as f64,
          payload.sample_rate_hz,
          (*payload.iq_data).clone(),
          false,
        )
      };
      let _ = stream_manager.publish_iq_frame_with_metadata(
        &tx_key,
        frame.timestamp,
        frame.center_frequency_hz.map(|frequency| frequency as u64),
        frame.sample_rate.unwrap_or(1),
        Arc::new(frame.iq_data.clone()),
      );
      let _ = spectrum_tx.send(Arc::new(frame));
    }
  })
}

/// Owns transmit-side state changes without coupling them to RX acquisition.
#[derive(Clone)]
pub struct TxWorker {
  processor: Arc<Mutex<SdrProcessor>>,
  shared_state: Arc<SharedState>,
  broadcast_tx: broadcast::Sender<String>,
  spectrum_tx: broadcast::Sender<Arc<SpectrumData>>,
  stream_manager: StreamingSourceModeManager,
}

impl TxWorker {
  pub fn new(
    processor: Arc<Mutex<SdrProcessor>>,
    shared_state: Arc<SharedState>,
    broadcast_tx: broadcast::Sender<String>,
    spectrum_tx: broadcast::Sender<Arc<SpectrumData>>,
    stream_manager: StreamingSourceModeManager,
  ) -> Self {
    Self {
      processor,
      shared_state,
      broadcast_tx,
      spectrum_tx,
      stream_manager,
    }
  }

  /// Fulfill a request-only standby preview without waking RX.
  ///
  /// Mock Tx synthesizes its preview here. A half-duplex hardware source
  /// (HackRF in Tx standby while a separate Rx source remains active) is
  /// served from the payload `TxWorker::apply_status` already stored on the
  /// stream manager — the same bytes handed to the transmitter, so the
  /// preview matches what a transmission would produce. The request owner
  /// decides which source's Tx stream receives the frame; a bound half-duplex
  /// source may not be the active SDR source.
  pub fn try_publish_standby_preview(&self) -> StandbyPreviewOutcome {
    let tx_is_active = crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed);
    if tx_is_active {
      return StandbyPreviewOutcome::NoRequest;
    }
    let Some(request_owner) = self.shared_state.paused_frame_request_owner()
    else {
      return StandbyPreviewOutcome::NoRequest;
    };

    // Mock Tx path — synthesize the preview exactly as the monitor worker does.
    if request_owner == crate::server::websocket_server::MOCK_TX_SOURCE_ID {
      let frame =
        crate::server::websocket_handlers::build_mock_tx_standby_preview_frame(
          &self.shared_state,
        );
      let tx_key = StreamKey::new(
        crate::server::websocket_server::MOCK_TX_SOURCE_ID.to_string(),
        StreamMode::Tx,
      );
      let _ = self.stream_manager.publish_iq_frame_with_metadata(
        &tx_key,
        frame.timestamp,
        frame.center_frequency_hz.map(|frequency| frequency as u64),
        frame.sample_rate.unwrap_or(1),
        Arc::new(frame.iq_data.clone()),
      );
      let _ = self.spectrum_tx.send(Arc::new(frame));
      self.shared_state.clear_paused_frame_request();
      return StandbyPreviewOutcome::Published;
    }

    // Half-duplex hardware path — publish a standby preview so the requested
    // source gets its frame even though the general SDR loop is reading a
    // different (Rx) source. Prefer the stored transmit payload (the exact
    // bytes handed to the transmitter) when one exists; otherwise synthesize
    // from the TX globals set by the preview request, mirroring the source-I/Q
    // socket behavior for an inactive tx-capable device.
    let hardware_tx_key = StreamKey::new(request_owner.clone(), StreamMode::Tx);
    let frame =
      if let Some(payload) = self.stream_manager.tx_payload(&hardware_tx_key) {
        crate::server::websocket_handlers::build_tx_monitor_frame_from_iq(
          &self.shared_state,
          &request_owner,
          payload.center_frequency_hz as f64,
          payload.sample_rate_hz,
          (*payload.iq_data).clone(),
          true,
        )
      } else {
        crate::server::websocket_handlers::build_tx_preview_frame(
          &self.shared_state,
          &request_owner,
        )
      };
    let _ = self.stream_manager.publish_iq_frame_with_metadata(
      &hardware_tx_key,
      frame.timestamp,
      frame.center_frequency_hz.map(|frequency| frequency as u64),
      frame.sample_rate.unwrap_or(1),
      Arc::new(frame.iq_data.clone()),
    );
    let _ = self.spectrum_tx.send(Arc::new(frame));
    self.shared_state.clear_paused_frame_request();
    StandbyPreviewOutcome::Published
  }

  pub async fn apply_status(
    &self,
    request: TxStatusRequest,
  ) -> anyhow::Result<()> {
    let TxStatusRequest {
      enabled,
      device,
      tx_signal,
      center_frequency_hz,
      sample_rate_hz,
      bandwidth_hz,
      tx_ifft_size,
      power_dbm,
      lna_gain_db,
      vga_gain_db,
      amp_enabled,
      tuner_agc,
      rtl_agc,
      ppm,
    } = request;
    let active_kind = self
      .shared_state
      .device_profile
      .lock()
      .unwrap()
      .kind
      .clone();
    let active_source_id = active_source_id(&self.shared_state);
    let device_normalized =
      device.to_ascii_lowercase().replace(['_', '-'], " ");
    let is_mock_tx_device = matches!(
      device_normalized.as_str(),
      "mock tx" | "mock tx device" | "mock tx sdr"
    );

    if let Some(tx_signal) = tx_signal.as_deref() {
      *crate::safety::TX_SIGNAL.lock().unwrap() = tx_signal.to_string();
    }
    if let Some(power_dbm) = complex_baseband::resolve_effective_tx_power_dbm(
      power_dbm,
      vga_gain_db,
      amp_enabled,
    ) {
      *crate::safety::TX_POWER_DBM.lock().unwrap() = power_dbm;
    }
    if let Some(center_frequency_hz) = center_frequency_hz {
      *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() =
        center_frequency_hz as f64;
    }
    if let Some(bandwidth_hz) = bandwidth_hz {
      *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = bandwidth_hz;
    }
    if let Some(tx_ifft_size) = tx_ifft_size {
      *crate::safety::TX_IFFT_SIZE.lock().unwrap() = tx_ifft_size;
    }

    let was_transmitting =
      crate::safety::TX_TRANSMITTING.swap(enabled, Ordering::Relaxed);
    if !enabled {
      crate::safety::TX_HOP_ENABLED.store(false, Ordering::Relaxed);
      self
        .shared_state
        .tx_hop_enabled
        .store(false, Ordering::Relaxed);
    }

    // Keep an established standby VFO when starting TX. If it is unset,
    // seed the monitor around the requested carrier.
    if is_mock_tx_device && enabled {
      let mut view_center =
        crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap();
      if *view_center <= 0.0 {
        if let Some(center_frequency_hz) = center_frequency_hz {
          *view_center = center_frequency_hz.min(u32::MAX as u64) as f64;
        }
      }
    }

    if crate::server::websocket_server::should_apply_transmit_settings_to_receiver(
            is_mock_tx_device,
            &active_kind,
        ) {
            if let Some(center_frequency_hz) = center_frequency_hz {
                let mut processor = self.processor.lock().await;
                processor.queue_center_frequency(center_frequency_hz.min(u32::MAX as u64) as u32);
            }
            self.shared_state.pending_fast_settings.lock().unwrap().push(
                crate::server::types::SdrProcessorSettings {
                    sample_rate: sample_rate_hz.map(|value| value.min(u32::MAX as u64) as u32),
                    hackrf_lna_gain: lna_gain_db,
                    hackrf_vga_gain: vga_gain_db,
                    hackrf_amp_enable: amp_enabled,
                    tuner_agc,
                    rtl_agc,
                    ppm,
                    ..Default::default()
                },
            );
        }

    if active_kind == "hackrf_one" {
      let mut processor = self.processor.lock().await;
      if enabled {
        let center_hz = center_frequency_hz.unwrap_or(0) as f64;
        let sample_rate =
          sample_rate_hz.unwrap_or(2_000_000).min(u32::MAX as u64) as u32;
        if let Some(center_frequency_hz) = center_frequency_hz {
          processor.set_center_frequency(
            center_frequency_hz.min(u32::MAX as u64) as u32,
          )?;
        }
        if sample_rate_hz.is_some() {
          processor.set_sample_rate(sample_rate)?;
        }
        let metrics = crate::performance::pipeline_metrics();
        metrics.increment(crate::performance::CounterKind::FramesRequested, 1);
        let iq = {
          let _span = crate::performance::ProfilingSpan::start(
            metrics,
            crate::performance::Stage::TxSynthesis,
          );
          complex_baseband::synthesize_mock_tx_monitor_iq(
            tx_ifft_size.unwrap_or(262_144).clamp(256, 262_144),
            center_hz,
            sample_rate,
            center_hz,
            bandwidth_hz.unwrap_or(sample_rate as f64),
            tx_signal.as_deref().unwrap_or("wifi"),
            tx_ifft_size.unwrap_or(262_144),
            power_dbm.unwrap_or(-18.0),
            &complex_baseband::resolve_mock_tx_iq_power_model(),
            &mut *self.shared_state.mock_tx_phase_accumulator.lock().unwrap(),
          )
        };
        metrics.increment(crate::performance::CounterKind::FramesProduced, 1);
        metrics.increment(
          crate::performance::CounterKind::Samples,
          (iq.len() / 2) as u64,
        );
        metrics
          .increment(crate::performance::CounterKind::Bytes, iq.len() as u64);
        {
          let _span = crate::performance::ProfilingSpan::start(
            metrics,
            crate::performance::Stage::TxDeviceWrite,
          );
          processor.transmit_iq(Some(&iq))?;
        }
        metrics.increment(crate::performance::CounterKind::FramesConsumed, 1);
        // Store the payload under the source that owns the armed standby
        // preview when one exists. A half-duplex HackRF in Tx mode may be a
        // bound Tx-suite source rather than the active SDR source; the preview
        // request and its frame must be keyed to that source so the Tx stream
        // delivers the standby graph to the bound device.
        let payload_source = self
          .shared_state
          .paused_frame_request_owner()
          .unwrap_or_else(|| active_source_id.clone());
        self.stream_manager.set_tx_payload(
          StreamKey::new(payload_source, StreamMode::Tx),
          center_hz.min(u32::MAX as f64) as u64,
          sample_rate,
          iq,
        );
      } else {
        processor.transmit_iq(None)?;
        self.stream_manager.clear_tx_payload(&StreamKey::new(
          active_source_id.clone(),
          StreamMode::Tx,
        ));
        if let Some(request_owner) =
          self.shared_state.paused_frame_request_owner()
        {
          self
            .stream_manager
            .clear_tx_payload(&StreamKey::new(request_owner, StreamMode::Tx));
        }
      }
    }

    let mut status_changed = was_transmitting != enabled;
    if active_kind == "mock_tx" || is_mock_tx_device {
      let mock_tx_was_transmitting = self
        .shared_state
        .mock_tx_transmitting
        .swap(enabled, Ordering::Relaxed);
      status_changed |= mock_tx_was_transmitting != enabled;
    }
    if status_changed
      && matches!(active_kind.as_str(), "mock_tx" | "hackrf_one")
    {
      self.shared_state.set_device_state(
        if enabled { "transmitting" } else { "connected" },
        None,
      );
    }
    if status_changed {
      broadcast_device_status(&self.shared_state, &self.broadcast_tx);
    }

    Ok(())
  }
}

pub use crate::tx::ifft::synthesize_mock_tx_monitor_iq;
