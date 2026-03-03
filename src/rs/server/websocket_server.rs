//! WebSocket server with SDR processor integration
//! Handles real-time spectrum data streaming to frontend clients

use anyhow::Result;
use log::{info, warn, error};
use std::sync::Arc;
use std::sync::atomic::Ordering;
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
        let shared_state = self.shared_state.clone();
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
                            // During active captures, the hopping logic in read_and_process_frame
                            // exclusively controls the SDR frequency. UI frequency range changes 
                            // must NOT retune the hardware or they corrupt capture frames.
                            if processor.capture_active {
                                log::debug!("Ignoring SetFrequency during active capture");
                            } else if let Err(e) = processor.set_center_frequency(freq) {
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
                        crate::server::types::SdrCommand::StartCapture { job_id, fragments, duration_s, file_type, acquisition_mode, encrypted, fft_window, .. } => {
                            processor.capture_job_id = Some(job_id.clone());
                            processor.capture_duration_s = duration_s;
                            processor.capture_file_type = file_type;
                            
                            let mode_str = if acquisition_mode == "stepwise" {
                                "stepwise_naive".to_string()
                            } else {
                                acquisition_mode
                            };
                            processor.capture_acquisition_mode = mode_str.clone();
                            info!("[CAPTURE] acquisition_mode={}, fragments={}, hops will be computed next", mode_str, fragments.len());
                            
                            processor.capture_current_fragment = 0;
                            processor.capture_last_hop = Some(std::time::Instant::now());
                            processor.capture_encrypted = encrypted;
                            processor.capture_start = Some(std::time::Instant::now());
                            processor.capture_actual_frames = 0;
                            // Snapshot current settings
                            processor.capture_fft_window = fft_window;
                            processor.capture_gain = processor.current_gain_db;
                            processor.capture_ppm = processor.current_ppm;
                            // AGC state is not tracked in config, default false for now
                            processor.capture_tuner_agc = false;
                            processor.capture_rtl_agc = false;

                            let hw_sample_rate = processor.get_sample_rate() as f64;
                            let usable_bw_mhz = hw_sample_rate / 1_000_000.0;
                            
                            let mut all_hops: Vec<(f64, f64)> = Vec::new();
                            // Track the overall requested range for metadata
                            let mut overall_min = f64::INFINITY;
                            let mut overall_max = f64::NEG_INFINITY;
                            
                            for &(min_freq, max_freq) in &fragments {
                                overall_min = overall_min.min(min_freq);
                                overall_max = overall_max.max(max_freq);
                                
                                let span = max_freq - min_freq;
                                if span <= usable_bw_mhz {
                                    // Single hop: center the window on the requested range
                                    let center = (min_freq + max_freq) / 2.0;
                                    let hop_start = center - usable_bw_mhz / 2.0;
                                    all_hops.push((hop_start, hop_start + usable_bw_mhz));
                                } else {
                                    // Sliding window: first hop starts at min_freq,
                                    // last hop ends at max_freq, with overlap in between
                                    let num_hops = (span / usable_bw_mhz).ceil() as usize;
                                    if num_hops <= 1 {
                                        all_hops.push((min_freq, min_freq + usable_bw_mhz));
                                    } else {
                                        // Distribute hops so first starts at min_freq, last ends at max_freq
                                        let step = (span - usable_bw_mhz) / ((num_hops - 1) as f64);
                                        for i in 0..num_hops {
                                            let start = min_freq + (i as f64 * step);
                                            let end = start + usable_bw_mhz;
                                            all_hops.push((start, end));
                                        }
                                    }
                                }
                            }
                            
                            // Compute overall metadata from the REQUESTED range (not hops)
                            let overall_span_hz = (overall_max - overall_min) * 1_000_000.0;
                            let overall_center_hz = ((overall_min + overall_max) / 2.0) * 1_000_000.0;

                            processor.capture_fragments = all_hops.clone();
                            processor.capture_channels = all_hops.iter().map(|&(min_freq, _max_freq)| {
                                let center_freq = (min_freq * 1_000_000.0) + (hw_sample_rate / 2.0);
                                crate::sdr::processor::CaptureChannel {
                                    center_freq_hz: center_freq,
                                    sample_rate_hz: hw_sample_rate,
                                    iq_data: Vec::new(),
                                    spectrum_data: Vec::new(),
                                    bins_per_frame: 0,
                                }
                            }).collect();
                            
                            processor.capture_active = true;
                            processor.capture_overall_center_hz = overall_center_hz;
                            processor.capture_overall_span_hz = overall_span_hz;
                            
                            // Tune to the first hop if available
                            if let Some(&(min_freq, max_freq)) = all_hops.first() {
                                let center_freq = ((min_freq * 1000000.0) + (hw_sample_rate / 2.0)) as u32;
                                if let Err(e) = processor.set_center_frequency(center_freq) {
                                    error!("Failed to tune to first fragment: {}", e);
                                } else {
                                    info!("Tuned to initial capture fragment: {} MHz - {} MHz (center {} Hz)", min_freq, max_freq, center_freq);
                                }
                            }
                            
                            // Auto-unpause for capture
                            shared_state.is_paused.store(false, Ordering::Relaxed);
                            
                            info!("Started capture job {} for {}s (auto-unpaused)", job_id, duration_s);

                            let msg = serde_json::json!({
                                "message_type": "capture_status",
                                "status": {
                                    "jobId": job_id,
                                    "status": "started"
                                }
                            });
                            let _ = _broadcast_tx.send(msg.to_string());
                        }
                        _ => {
                            warn!("Unhandled command: {:?}", cmd);
                        }
                    }
                }

                // If the stream is paused by the client, don't read from SDR or broadcast
                if shared_state.is_paused.load(Ordering::Relaxed) {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }

                // 2. Read and process one frame from SDR
                let process_result = {
                    let cloned_processor = sdr_processor.clone();
                    tokio::task::spawn_blocking(move || -> Result<(Vec<f32>, i64, u32, bool, String)> {
                        let mut processor = cloned_processor.blocking_lock();
                        let waveform = processor.read_and_process_frame()?;
                        let timestamp = chrono::Utc::now().timestamp_millis();
                        let center_frequency = processor.get_center_frequency();
                        let is_mock_apt = processor.device_type().contains("Mock");
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
                        // Wait for settling
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                    Err(join_e) => {
                        error!("SDR block join error: {}", join_e);
                    }
                }

                // 3. Check capture completion
                let capture_result = { sdr_processor.lock().await.check_capture_completion() };
                if let Some(result) = capture_result {
                    let enc_key = shared_state.encryption_key;
                    let shared_clone = shared_state.clone();
                    let bcast = _broadcast_tx.clone();
                    
                    tokio::task::spawn_blocking(move || {
                        match crate::server::utils::save_capture_file_multi(
                            &result,
                            &enc_key,
                        ) {
                            Ok(artifact) => {
                                let mut artifacts = shared_clone.capture_artifacts.lock().unwrap();
                                artifacts.entry(result.job_id.clone()).or_insert_with(Vec::new).push(artifact.clone());
                                
                                let file_name = artifact.filename.clone();

                                let msg = serde_json::json!({
                                    "message_type": "capture_status",
                                    "status": {
                                        "jobId": result.job_id,
                                        "status": "done",
                                        "filename": file_name,
                                        "downloadUrl": format!("/api/capture/download?jobId={}", result.job_id)
                                    }
                                });
                                let _ = bcast.send(msg.to_string());
                            }
                            Err(e) => {
                                error!("Failed to save capture file: {}", e);
                                let msg = serde_json::json!({
                                    "message_type": "capture_status",
                                    "status": {
                                        "jobId": result.job_id,
                                        "status": "failed",
                                        "error": e.to_string()
                                    }
                                });
                                let _ = bcast.send(msg.to_string());
                            }
                        }
                    });
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
