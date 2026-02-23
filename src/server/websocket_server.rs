use log::{error, info, warn};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

use n_apt_backend::rtlsdr::RtlSdrDevice;

use super::shared_state::SharedState;
use super::types::{SdrCommand, SpectrumData};
use super::utils::{next_missing_device_probe_streak, should_declare_disconnected};

/// Dedicated I/O thread that owns the SDR device and produces spectrum data.
/// This thread runs in a tight loop and never blocks the async runtime.
pub struct WebSocketServer {
    pub shared: Arc<SharedState>,
    pub cmd_tx: std::sync::mpsc::Sender<SdrCommand>,
    pub broadcast_tx: broadcast::Sender<String>,
}

impl WebSocketServer {
    pub fn new(shared: Arc<SharedState>) -> Self {
        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<SdrCommand>();
        let (broadcast_tx, _broadcast_rx) = broadcast::channel(1000);

        let broadcast_tx_clone = broadcast_tx.clone();
        let shared_clone = shared.clone();

        thread::spawn(move || {
            info!("Starting SDR I/O thread");
            Self::sdr_io_thread(cmd_rx, broadcast_tx_clone, shared_clone);
        });

        Self { shared, cmd_tx, broadcast_tx }
    }

    fn broadcast_status(shared: &Arc<SharedState>, broadcast_tx: &broadcast::Sender<String>) {
        let device_connected = shared.device_connected.load(Ordering::Relaxed);
        let device_info = shared.device_info.lock().unwrap().clone();
        let device_loading = *shared.device_loading.lock().unwrap();
        let device_loading_reason = shared.device_loading_reason.lock().unwrap().clone();
        let device_state = shared.device_state.lock().unwrap().clone();
        let paused = shared.is_paused.load(Ordering::Relaxed);

        let max_sample_rate = if device_connected {
            device_info
                .split("max: ")
                .nth(1)
                .and_then(|s| s.split(" Hz").next())
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(3_200_000)
        } else {
            device_info
                .split("Sample Rate: ")
                .nth(1)
                .and_then(|s| s.split(" Hz").next())
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(3_200_000)
        };

        let status = serde_json::json!({
            "message_type": "status",
            "device_connected": device_connected,
            "device_info": device_info,
            "device_loading": device_loading,
            "device_loading_reason": device_loading_reason,
            "device_state": device_state,
            "paused": paused,
            "max_sample_rate": max_sample_rate,
            "spectrum_frames": shared.spectrum_frames.lock().unwrap().clone(),
            "backend": if device_connected { "rtl-sdr" } else { "mock" }
        });

        if let Ok(json) = serde_json::to_string(&status) {
            let _ = broadcast_tx.send(json);
        }
    }

    fn sdr_io_thread(
        cmd_rx: std::sync::mpsc::Receiver<SdrCommand>,
        broadcast_tx: broadcast::Sender<String>,
        shared: Arc<SharedState>,
    ) {
        let mut sdr_processor = super::sdr_processor::SDRProcessor::new();
        let mut missing_device_probe_streak = 0u32;
        let mut device_connected;
        let mut last_device_failure: Option<Instant> = None;

        // Try to initialize with real device first
        match sdr_processor.initialize() {
            Ok(_) => {
                info!("RTL-SDR device initialized successfully");
                device_connected = true;
                shared.device_connected.store(true, Ordering::Relaxed);
                *shared.device_info.lock().unwrap() = sdr_processor.get_device_info();
                *shared.device_state.lock().unwrap() = "connected".to_string();
                Self::broadcast_status(&shared, &broadcast_tx);
            }
            Err(e) => {
                warn!("Failed to initialize RTL-SDR device: {}. Using mock mode.", e);
                sdr_processor.enter_mock_mode();
                device_connected = false;
                shared.device_connected.store(false, Ordering::Relaxed);
                *shared.device_info.lock().unwrap() = sdr_processor.get_device_info();
                *shared.device_state.lock().unwrap() = "disconnected".to_string();
                Self::broadcast_status(&shared, &broadcast_tx);
            }
        }

        let mut last_frame = std::time::Instant::now();

        loop {
            // Check for shutdown
            if shared.shutdown.load(Ordering::Relaxed) {
                info!("SDR I/O thread shutting down");
                break;
            }

            // Process pending commands
            while let Ok(cmd) = cmd_rx.try_recv() {
                Self::handle_command(&mut sdr_processor, &shared, cmd);
            }

            // Apply pending center-frequency changes from VFO/range updates.
            // This coalesces rapid slider updates and keeps the SDR in sync.
            if shared
                .pending_center_freq_dirty
                .swap(false, Ordering::Relaxed)
            {
                let freq = shared.pending_center_freq.load(Ordering::Relaxed);
                if let Err(e) = sdr_processor.set_center_frequency(freq) {
                    error!("Failed to set frequency: {}", e);
                    // Re-flag so we can retry after transient device issues.
                    shared
                        .pending_center_freq_dirty
                        .store(true, Ordering::Relaxed);
                }
            }

            // Calculate current frame interval dynamically based on the applied frame rate
            let current_frame_rate = sdr_processor.display_frame_rate.max(1);
            let frame_interval = Duration::from_millis((1000 / current_frame_rate) as u64);

            // Only produce spectrum data if there are authenticated clients
            if shared.authenticated_count.load(Ordering::Relaxed) > 0 && !shared.is_paused.load(Ordering::Relaxed) {
                let now = std::time::Instant::now();
                if now.duration_since(last_frame) >= frame_interval {
                    let spectrum_result = if sdr_processor.is_mock {
                        sdr_processor.read_and_process_mock()
                    } else {
                        sdr_processor.read_and_process_device()
                    };

                    match spectrum_result {
                        Ok(spectrum) => {
                            let timestamp = chrono::Utc::now().timestamp_millis();
                            let is_mock = sdr_processor.is_mock;
                            let spectrum_data = SpectrumData {
                                message_type: "spectrum".to_string(),
                                waveform: spectrum.clone(),
                                is_mock,
                                center_frequency_hz: Some(sdr_processor.center_freq),
                                timestamp,
                            };

                            if let Ok(json) = serde_json::to_string(&spectrum_data) {
                                let _ = broadcast_tx.send(json);
                            }

                            // Update latest spectrum for status endpoint
                            *shared.latest_spectrum.lock().unwrap() = Some((spectrum_data.waveform, spectrum_data.is_mock));

                            // Capture completion check
                            if let Some((job_id, artifact)) = sdr_processor.check_capture_completion() {
                                // Store capture artifact for download
                                let mut artifacts_map = shared.capture_artifacts.lock().unwrap();
                                artifacts_map.entry(job_id.clone()).or_insert_with(Vec::new).push(artifact.clone());
                                drop(artifacts_map);

                                // Send capture completion status
                                let status_msg = serde_json::json!({
                                    "message_type": "capture_status",
                                    "job_id": job_id,
                                    "status": "done",
                                    "filename": artifact.filename,
                                    "download_url": format!("/capture/download?jobId={}", job_id)
                                });
                                if let Ok(json) = serde_json::to_string(&status_msg) {
                                    let _ = broadcast_tx.send(json);
                                }
                            }
                        }
                        Err(e) => {
                            error!("Failed to get spectrum data: {}", e);
                            if !sdr_processor.is_mock {
                                // Drop the device handle so the next reconnect opens a fresh device
                                sdr_processor.release_device();
                                sdr_processor.enter_mock_mode();
                                device_connected = false;
                                shared.device_connected.store(false, Ordering::Relaxed);
                                *shared.device_state.lock().unwrap() = "disconnected".to_string();
                                last_device_failure = Some(Instant::now());
                            }
                        }
                    }
                    last_frame = now;
                }
            }

            // Device probing logic for mock mode
            if !device_connected {
                thread::sleep(Duration::from_millis(100));

                // Backoff after a recent failure to avoid tight reconnect loops
                if let Some(failed_at) = last_device_failure {
                    if failed_at.elapsed() < Duration::from_millis(500) {
                        continue;
                    }
                }

                let device_count = RtlSdrDevice::get_device_count();
                missing_device_probe_streak = next_missing_device_probe_streak(missing_device_probe_streak, device_count);

                if device_count > 0 {
                    info!("RTL-SDR device detected, attempting to connect");
                    *shared.device_loading.lock().unwrap() = true;
                    *shared.device_loading_reason.lock().unwrap() = Some("connect".to_string());
                    *shared.device_state.lock().unwrap() = "loading".to_string();

                    match sdr_processor.try_connect_device() {
                        Ok(true) => {
                            info!("RTL-SDR device connected successfully");
                            device_connected = true;
                            shared.device_connected.store(true, Ordering::Relaxed);
                            let device_info = sdr_processor.get_device_info();
                            *shared.device_info.lock().unwrap() = device_info;
                            *shared.device_state.lock().unwrap() = "connected".to_string();
                            *shared.device_loading.lock().unwrap() = false;
                            *shared.device_loading_reason.lock().unwrap() = None;
                            missing_device_probe_streak = 0;
                        }
                        Ok(false) => {
                            *shared.device_loading.lock().unwrap() = false;
                            *shared.device_loading_reason.lock().unwrap() = None;
                            *shared.device_state.lock().unwrap() = "disconnected".to_string();
                        }
                        Err(e) => {
                            warn!("Failed to connect RTL-SDR device: {}", e);
                            *shared.device_loading.lock().unwrap() = false;
                            *shared.device_loading_reason.lock().unwrap() = None;
                            *shared.device_state.lock().unwrap() = "disconnected".to_string();
                        }
                    }
                }
            } else {
                // Check if device is still present periodically (every ~1s)
                // Do not sleep here, as it would cap the SDR thread's frame rate!
                if missing_device_probe_streak % 30 == 0 {
                    let device_count = RtlSdrDevice::get_device_count();
                    if device_count == 0 {
                        missing_device_probe_streak = next_missing_device_probe_streak(missing_device_probe_streak, 0);
                        if should_declare_disconnected(missing_device_probe_streak) {
                            warn!("RTL-SDR device disconnected");
                            device_connected = false;
                            shared.device_connected.store(false, Ordering::Relaxed);
                            *shared.device_state.lock().unwrap() = "disconnected".to_string();
                            Self::broadcast_status(&shared, &broadcast_tx);
                            
                            // Fall back to mock mode
                            sdr_processor.enter_mock_mode();
                        }
                    } else {
                        missing_device_probe_streak = 1;
                    }
                } else {
                    missing_device_probe_streak = missing_device_probe_streak.wrapping_add(1);
                }
            }
        }
    }

    fn handle_command(
        sdr_processor: &mut super::sdr_processor::SDRProcessor,
        shared: &Arc<SharedState>,
        cmd: SdrCommand,
    ) {
        match cmd {
            SdrCommand::SetFrequency(freq) => {
                if let Err(e) = sdr_processor.set_center_frequency(freq) {
                    error!("Failed to set frequency: {}", e);
                } else {
                    shared.pending_center_freq.store(freq, Ordering::Relaxed);
                    shared.pending_center_freq_dirty.store(false, Ordering::Relaxed);
                }
            }
            SdrCommand::SetGain(gain) => {
                if let Err(e) = sdr_processor.set_gain(gain) {
                    error!("Failed to set gain: {}", e);
                }
            }
            SdrCommand::SetPpm(ppm) => {
                if let Err(e) = sdr_processor.set_ppm(ppm) {
                    error!("Failed to set PPM: {}", e);
                }
            }
            SdrCommand::SetTunerAGC(enabled) => {
                if let Err(e) = sdr_processor.set_tuner_agc(enabled) {
                    error!("Failed to set tuner AGC: {}", e);
                }
            }
            SdrCommand::SetRtlAGC(enabled) => {
                if let Err(e) = sdr_processor.set_rtl_agc(enabled) {
                    error!("Failed to set RTL AGC: {}", e);
                }
            }
            SdrCommand::RestartDevice => {
                info!("Restarting SDR device");
                *shared.device_loading.lock().unwrap() = true;
                *shared.device_loading_reason.lock().unwrap() = Some("restart".to_string());
                *shared.device_state.lock().unwrap() = "loading".to_string();

                // Reinitialize the device
                sdr_processor.release_device();
                if let Err(e) = sdr_processor.initialize() {
                    error!("Failed to restart device: {}", e);
                    *shared.device_loading.lock().unwrap() = false;
                    *shared.device_loading_reason.lock().unwrap() = None;
                    *shared.device_state.lock().unwrap() = "disconnected".to_string();
                } else {
                    info!("Device restarted successfully");
                    *shared.device_loading.lock().unwrap() = false;
                    *shared.device_loading_reason.lock().unwrap() = None;
                    *shared.device_state.lock().unwrap() = "connected".to_string();
                }
            }
            SdrCommand::StartTraining { label: _, signal_area: _ } => {
                info!("Training command received (not implemented)");
            }
            SdrCommand::StopTraining => {
                info!("Stop training command received (not implemented)");
            }
            SdrCommand::StartCapture { job_id: _, min_freq: _, max_freq: _, duration_s: _, file_type: _, encrypted: _, fft_size: _, fft_window: _ } => {
                info!("Start capture command received (not implemented)");
            }
            SdrCommand::ApplySettings { fft_size, fft_window, frame_rate, gain, ppm, tuner_agc, rtl_agc } => {
                info!("Applying settings: fft_size={:?}, frame_rate={:?}, gain={:?}, ppm={:?}", fft_size, frame_rate, gain, ppm);
                if let Err(e) = sdr_processor.apply_settings(fft_size, fft_window, frame_rate, gain, ppm, tuner_agc, rtl_agc) {
                    error!("Failed to apply settings: {}", e);
                } else {
                    info!("Settings applied successfully. Current display_frame_rate: {} fps", sdr_processor.display_frame_rate);
                }
            }
        }
    }
}
