use log::{error, info, warn};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
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

    fn sdr_io_thread(
        cmd_rx: std::sync::mpsc::Receiver<SdrCommand>,
        broadcast_tx: broadcast::Sender<String>,
        shared: Arc<SharedState>,
    ) {
        let mut sdr_processor = super::sdr_processor::SDRProcessor::new();
        let mut missing_device_probe_streak = 0u32;
        let mut device_connected;

        // Try to initialize with real device first
        match sdr_processor.initialize() {
            Ok(_) => {
                info!("RTL-SDR device initialized successfully");
                device_connected = true;
                shared.device_connected.store(true, Ordering::Relaxed);
                *shared.device_info.lock().unwrap() = sdr_processor.get_device_info();
                *shared.device_state.lock().unwrap() = "connected".to_string();
            }
            Err(e) => {
                warn!("Failed to initialize RTL-SDR device: {}. Using mock mode.", e);
                sdr_processor.enter_mock_mode();
                device_connected = false;
                shared.device_connected.store(false, Ordering::Relaxed);
                *shared.device_info.lock().unwrap() = sdr_processor.get_device_info();
                *shared.device_state.lock().unwrap() = "disconnected".to_string();
            }
        }

        let frame_interval = Duration::from_millis(1000 / 30); // 30 FPS default
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

            // Only produce spectrum data if there are authenticated clients
            if shared.authenticated_count.load(Ordering::Relaxed) > 0 && !shared.is_paused.load(Ordering::Relaxed) {
                let now = std::time::Instant::now();
                if now.duration_since(last_frame) >= frame_interval {
                    match sdr_processor.read_and_process_mock() {
                        Ok(spectrum) => {
                            let timestamp = chrono::Utc::now().timestamp_millis();
                            let spectrum_data = SpectrumData {
                                message_type: "spectrum".to_string(),
                                waveform: spectrum.clone(),
                                waterfall: spectrum,
                                is_mock: !device_connected,
                                timestamp,
                            };

                            if let Ok(json) = serde_json::to_string(&spectrum_data) {
                                let _ = broadcast_tx.send(json);
                            }

                            // Update latest spectrum for status endpoint
                            *shared.latest_spectrum.lock().unwrap() = Some((spectrum_data.waveform, spectrum_data.is_mock));
                        }
                        Err(e) => {
                            error!("Failed to get spectrum data: {}", e);
                        }
                    }
                    last_frame = now;
                }
            }

            // Device probing logic for mock mode
            if !device_connected {
                thread::sleep(Duration::from_millis(100));
                let device_count = RtlSdrDevice::get_device_count();
                missing_device_probe_streak = next_missing_device_probe_streak(missing_device_probe_streak, device_count);
                
                if device_count > 0 && should_declare_disconnected(missing_device_probe_streak) {
                    info!("RTL-SDR device detected, attempting to connect");
                    *shared.device_loading.lock().unwrap() = true;
                    *shared.device_loading_reason.lock().unwrap() = Some("connect".to_string());
                    *shared.device_state.lock().unwrap() = "loading".to_string();

                    match sdr_processor.initialize() {
                        Ok(_) => {
                            info!("RTL-SDR device connected successfully");
                            device_connected = true;
                            shared.device_connected.store(true, Ordering::Relaxed);
                            let device_info = sdr_processor.get_device_info();
                            *shared.device_info.lock().unwrap() = device_info;
                            *shared.device_state.lock().unwrap() = "connected".to_string();
                            *shared.device_loading.lock().unwrap() = false;
                            *shared.device_loading_reason.lock().unwrap() = None;
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
                // Check if device is still present
                thread::sleep(Duration::from_millis(100));
                let device_count = RtlSdrDevice::get_device_count();
                if device_count == 0 {
                    missing_device_probe_streak = next_missing_device_probe_streak(missing_device_probe_streak, 0);
                    if should_declare_disconnected(missing_device_probe_streak) {
                        warn!("RTL-SDR device disconnected");
                        device_connected = false;
                        shared.device_connected.store(false, Ordering::Relaxed);
                        *shared.device_state.lock().unwrap() = "disconnected".to_string();
                        
                        // Fall back to mock mode
                        sdr_processor.enter_mock_mode();
                    }
                } else {
                    missing_device_probe_streak = 0;
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
            SdrCommand::ApplySettings { fft_size, fft_window, frame_rate: _, gain, ppm, tuner_agc, rtl_agc } => {
                if let Err(e) = sdr_processor.apply_settings(fft_size, fft_window, None, gain, ppm, tuner_agc, rtl_agc) {
                    error!("Failed to apply settings: {}", e);
                }
            }
        }
    }
}
