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
        
        Self {
            sdr_processor: Arc::new(Mutex::new(sdr_processor)),
            shared_state: SharedState::new(),
            broadcast_tx,
        }
    }
    
    pub async fn run(&self, mut cmd_rx: std::sync::mpsc::Receiver<crate::server::types::SdrCommand>) -> Result<()> {
        info!("Starting SDR data streaming thread");
        
        let sdr_processor = self.sdr_processor.clone();
        let _shared_state = self.shared_state.clone();
        let broadcast_tx = self.broadcast_tx.clone();
        
        // Spawn SDR processing thread
        tokio::spawn(async move {
            let mut frame_count = 0u64;
            let mut last_stats = Instant::now();
            loop {
                let start_time = Instant::now();
                let target_fps = 30; // 30 FPS for smooth streaming
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
                {
                    let mut processor = sdr_processor.lock().await;
                    match processor.read_and_process_frame() {
                        Ok(waveform) => {
                            let timestamp = chrono::Utc::now().timestamp_millis();
                            let center_frequency = processor.get_center_frequency();
                            let is_mock_apt = processor.device_type() == "mock_apt";
                            drop(processor);

                            let spectrum_message = SpectrumData {
                                message_type: "spectrum".to_string(),
                                waveform,
                                is_mock_apt,
                                center_frequency_hz: Some(center_frequency),
                                timestamp,
                            };

                            // Broadcast to all connected WebSocket clients
                            if let Ok(json_message) = serde_json::to_string(&spectrum_message) {
                                if let Err(_e) = broadcast_tx.send(json_message) {
                                    // No receivers, which is normal when no clients are connected
                                }
                            }

                            frame_count += 1;

                            // Log stats every 10 seconds
                            if last_stats.elapsed() >= Duration::from_secs(10) {
                                let device_type = sdr_processor.lock().await.device_type();
                                info!("SDR streaming: {} frames sent, device: {}", frame_count, device_type);
                                last_stats = Instant::now();
                            }
                        }
                        Err(e) => {
                            drop(processor);
                            error!("SDR processing error: {}", e);
                            // Try to reinitialize the processor
                            if let Err(reinit_err) = sdr_processor.lock().await.initialize() {
                                error!("Failed to reinitialize SDR processor: {}", reinit_err);
                                tokio::time::sleep(Duration::from_secs(1)).await;
                            }
                        }
                    }
                }
                
                // Maintain target frame rate
                let elapsed = start_time.elapsed();
                let target_duration = Duration::from_millis(1000 / target_fps);
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
}
