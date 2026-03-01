//! WebSocket server with SDR processor integration
//! Handles real-time spectrum data streaming to frontend clients

use anyhow::Result;
use log::{info, warn, error};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use crate::sdr::processor::SdrProcessor;
use super::shared_state::SharedState;
use super::types::SpectrumData;

#[derive(Clone)]
pub struct WebSocketServer {
    sdr_processor: Arc<Mutex<SdrProcessor>>,
    shared_state: Arc<SharedState>,
    broadcast_tx: broadcast::Sender<String>,
    spectrum_tx: broadcast::Sender<Arc<SpectrumData>>,
}

impl WebSocketServer {
    pub fn new() -> Self {
        info!("Creating WebSocket server with SDR processor");
        
        // Create SDR processor (will auto-select mock_apt or real device)
        let mut sdr_processor = SdrProcessor::new()
            .expect("Failed to create SDR processor");
        
        // Initialize the processor
        if let Err(e) = sdr_processor.initialize() {
            warn!("Failed to initialize SDR processor: {}, using mock APT mode", e);
            // Fallback to mock_apt mode
            sdr_processor = SdrProcessor::new_mock_apt()
                .expect("Failed to create mock APT SDR processor");
            sdr_processor.initialize()
                .expect("Failed to initialize mock APT SDR processor");
        }
        
        info!("SDR processor initialized with device: {}", sdr_processor.device_type());
        
        // Create broadcast channel for WebSocket clients
        let (broadcast_tx, _) = broadcast::channel(1000);
        let (spectrum_tx, _) = broadcast::channel(1000);
        
        Self {
            sdr_processor: Arc::new(Mutex::new(sdr_processor)),
            shared_state: SharedState::new(),
            broadcast_tx,
            spectrum_tx,
        }
    }
    
    pub async fn run(&self, cmd_rx: std::sync::mpsc::Receiver<crate::server::types::SdrCommand>) -> Result<()> {
        info!("Starting SDR data streaming thread");
        
        let sdr_processor = self.sdr_processor.clone();
        let _shared_state = self.shared_state.clone();
        let _broadcast_tx = self.broadcast_tx.clone();
        let spectrum_tx = self.spectrum_tx.clone();
        
        // Spawn SDR processing thread
        tokio::spawn(async move {
            let mut frame_count = 0u64;
            let mut last_stats = Instant::now();
            loop {
                let start_time = Instant::now();
                let target_fps = {
                    sdr_processor.lock().await.display_frame_rate
                };
                // 1. Process pending commands
                while let Ok(cmd) = cmd_rx.try_recv() {
                    let mut processor = sdr_processor.lock().await;
                    match cmd {
                        crate::server::types::SdrCommand::ApplySettings { 
                            fft_size, fft_window, frame_rate, gain, ppm, tuner_agc, rtl_agc 
                        } => {
                            if let Err(e) = processor.apply_settings(fft_size, fft_window, frame_rate, gain, ppm, tuner_agc, rtl_agc) {
                                error!("Failed to apply settings: {}", e);
                            }
                        }
                        crate::server::types::SdrCommand::SetFrequency(freq) => {
                            if let Err(e) = processor.set_center_frequency(freq) {
                                error!("Failed to set frequency: {}", e);
                            }
                        }
                        crate::server::types::SdrCommand::SetGain(gain) => {
                            if let Err(e) = processor.apply_settings(None, None, None, Some(gain), None, None, None) {
                                error!("Failed to set gain: {}", e);
                            }
                        }
                        crate::server::types::SdrCommand::SetPpm(ppm) => {
                            if let Err(e) = processor.apply_settings(None, None, None, None, Some(ppm), None, None) {
                                error!("Failed to set PPM: {}", e);
                            }
                        }
                        crate::server::types::SdrCommand::SetTunerAGC(enabled) => {
                            if let Err(e) = processor.apply_settings(None, None, None, None, None, Some(enabled), None) {
                                error!("Failed to set tuner AGC: {}", e);
                            }
                        }
                        crate::server::types::SdrCommand::SetRtlAGC(enabled) => {
                            if let Err(e) = processor.apply_settings(None, None, None, None, None, None, Some(enabled)) {
                                error!("Failed to set RTL AGC: {}", e);
                            }
                        }
                        crate::server::types::SdrCommand::RestartDevice => {
                            if let Err(e) = processor.initialize() {
                                error!("Failed to restart device: {}", e);
                            }
                        }
                        _ => {
                            warn!("Unhandled command: {:?}", cmd);
                        }
                    }
                }

                // 2. Read and process one frame from SDR
                let process_result = {
                    let cloned_processor = sdr_processor.clone();
                    tokio::task::spawn_blocking(move || -> Result<(Vec<f32>, i64, u32, bool, String)> {
                        let mut processor = cloned_processor.blocking_lock();
                        let waveform = processor.read_and_process_frame()?;
                        let timestamp = chrono::Utc::now().timestamp_millis();
                        let center_frequency = processor.get_center_frequency();
                        let is_mock_apt = processor.device_type() == "mock_apt";
                        let device_type = processor.device_type().to_string();
                        Ok((waveform, timestamp, center_frequency, is_mock_apt, device_type))
                    }).await
                };

                match process_result {
                    Ok(Ok((waveform, timestamp, center_frequency, is_mock_apt, device_type_str))) => {
                        let spectrum_message = SpectrumData {
                            message_type: "spectrum".to_string(),
                            waveform,
                            is_mock_apt,
                            center_frequency_hz: Some(center_frequency),
                            timestamp,
                        };

                        // Broadcast to all connected WebSocket clients
                        if let Err(_e) = spectrum_tx.send(Arc::new(spectrum_message)) {
                            // No receivers, which is normal when no clients are connected
                        }

                        frame_count += 1;

                        // Log stats every 10 seconds
                        if last_stats.elapsed() >= Duration::from_secs(10) {
                            info!("SDR streaming: {} frames sent, device: {}", frame_count, device_type_str);
                            last_stats = Instant::now();
                        }
                    }
                    Ok(Err(e)) => {
                        error!("SDR processing error: {}", e);
                        // Try to reinitialize the processor
                        let cloned_processor = sdr_processor.clone();
                        let _ = tokio::task::spawn_blocking(move || -> Result<()> {
                            let mut processor = cloned_processor.blocking_lock();
                            if let Err(reinit_err) = processor.initialize() {
                                error!("Failed to reinitialize SDR processor: {}", reinit_err);
                            }
                            Ok(())
                        }).await;
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                    Err(join_e) => {
                        error!("SDR block join error: {}", join_e);
                    }
                }
                
                // Maintain target frame rate
                let elapsed = start_time.elapsed();
                let target_duration = Duration::from_millis(1000 / (target_fps as u64));
                if elapsed < target_duration {
                    tokio::time::sleep(target_duration - elapsed).await;
                }
            }
        });
        
        info!("SDR data streaming started successfully");
        Ok(())
    }
    
    pub fn get_shared_state(&self) -> Arc<SharedState> {
        self.shared_state.clone()
    }
    
    pub fn get_sdr_processor(&self) -> Arc<Mutex<SdrProcessor>> {
        self.sdr_processor.clone()
    }
    
    pub fn get_broadcast_tx(&self) -> broadcast::Sender<String> {
        self.broadcast_tx.clone()
    }
    
    pub fn get_spectrum_tx(&self) -> broadcast::Sender<Arc<SpectrumData>> {
        self.spectrum_tx.clone()
    }
}
