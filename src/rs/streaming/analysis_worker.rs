//! Analysis command execution kept outside the acquisition loop.

use std::sync::Arc;

#[cfg(rs_decrypted)]
use log::info;
use tokio::sync::{broadcast, Mutex};

use crate::sdr::processor::SdrProcessor;
use crate::server::types::SdrCommand;

/// Executes optional analysis jobs against the latest processor frame.
#[derive(Clone)]
pub struct AnalysisWorker {
  #[cfg_attr(not(rs_decrypted), allow(dead_code))]
  processor: Arc<Mutex<SdrProcessor>>,
  #[cfg_attr(not(rs_decrypted), allow(dead_code))]
  broadcast_tx: broadcast::Sender<String>,
}

impl AnalysisWorker {
  pub fn new(
    processor: Arc<Mutex<SdrProcessor>>,
    broadcast_tx: broadcast::Sender<String>,
  ) -> Self {
    Self {
      processor,
      broadcast_tx,
    }
  }

  /// Handle an analysis command, or return the command to normal dispatch.
  pub async fn try_handle(
    &self,
    command: SdrCommand,
  ) -> Result<(), SdrCommand> {
    match command {
      #[cfg(rs_decrypted)]
      SdrCommand::ScanForAudio {
        job_id,
        frequency_range,
        window_size_hz,
        step_size_hz,
        audio_threshold,
      } => {
        let mut processor = self.processor.lock().await;
        info!("[SCAN] Starting scan job={}", job_id);
        let regions = processor.handle_scan(
          frequency_range,
          window_size_hz,
          step_size_hz,
          audio_threshold,
          &job_id,
          &self.broadcast_tx,
        );
        let response = crate::server::types::ScanResultResponse {
          message_type: "scan_result".to_string(),
          job_id,
          regions,
        };
        if let Ok(json) = serde_json::to_string(&response) {
          let _ = self.broadcast_tx.send(json);
        }
        Ok(())
      }
      #[cfg(not(rs_decrypted))]
      SdrCommand::ScanForAudio { job_id, .. } => {
        log::warn!(
          "ScanForAudio requested for job {} but decrypted scan support is disabled in this build",
          job_id
        );
        Ok(())
      }
      #[cfg(rs_decrypted)]
      SdrCommand::DemodulateRegion { job_id, region } => {
        let mut processor = self.processor.lock().await;
        info!("[DEMOD] Demodulating region for job={}", job_id);
        let (audio_buffer, sample_rate) = processor.handle_demodulate(&region);
        let response = crate::server::types::DemodResultResponse {
          message_type: "demod_result".to_string(),
          job_id,
          region,
          audio_buffer,
          sample_rate,
        };
        if let Ok(json) = serde_json::to_string(&response) {
          let _ = self.broadcast_tx.send(json);
        }
        Ok(())
      }
      #[cfg(not(rs_decrypted))]
      SdrCommand::DemodulateRegion { job_id, .. } => {
        log::warn!(
          "DemodulateRegion requested for job {} but decrypted demod support is disabled in this build",
          job_id
        );
        Ok(())
      }
      #[cfg(rs_decrypted)]
      SdrCommand::StartAptAnalysis { job_id, config } => {
        let processor = self.processor.lock().await;
        info!("[APT] Starting APT analysis for job={}", job_id);
        let initial_result = crate::server::types::AptAnalysisResult {
          message_type: "apt_analysis_result".to_string(),
          job_id: job_id.clone(),
          channel_metadata: crate::server::types::AptChannelMetadata {
            window_size_hz: config.window_size_hz,
            content_type: config.content_type.clone(),
            sub_channel_range: config.sub_channel_range,
            center_freq_hz: processor.get_center_frequency(),
            signal_strength_db: -50.0,
            snr: 10.0,
            demod_processor: config.demod_processor.clone(),
          },
          progress: 0.0,
          processing_stage:
            crate::server::types::AptProcessingStage::Initializing,
          analysis_data: None,
        };
        if let Ok(json) = serde_json::to_string(&initial_result) {
          let _ = self.broadcast_tx.send(json);
        }

        let processor = self.processor.clone();
        let broadcast_tx = self.broadcast_tx.clone();
        tokio::spawn(async move {
          crate::encrypted_modules::apt_analysis::run_apt_analysis(
            processor,
            broadcast_tx,
            job_id,
            config,
          )
          .await;
        });
        Ok(())
      }
      #[cfg(not(rs_decrypted))]
      SdrCommand::StartAptAnalysis { job_id, .. } => {
        log::warn!(
          "StartAptAnalysis requested for job {} but APT analysis is disabled in this build",
          job_id
        );
        Ok(())
      }
      command => Err(command),
    }
  }
}
