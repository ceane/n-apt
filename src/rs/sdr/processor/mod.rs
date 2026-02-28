//! # SDR Processor
//!
//! Main signal processing pipeline that uses the abstract SDR interface.
//! Handles both mock and real SDR devices seamlessly.

use anyhow::Result;
use log::{info, warn};
use std::time::Instant;

use crate::fft::FFTProcessor;
use crate::stitching::SignalStitcher;

use super::{SdrDevice, SdrDeviceFactory};
// TODO: Replace with proper types when server integration is ready
// use crate::server::types::{CaptureArtifact, SdrCommand};

/// SDR processor that works with any SDR device implementation
pub struct SdrProcessor {
    /// The actual SDR device (mock or real hardware)
    device: Box<dyn SdrDevice>,
    /// FFT processor for signal processing
    pub fft_processor: FFTProcessor,
    /// Frame counter for time-based operations
    pub frame_counter: u64,
    /// Exponential moving average buffer for frame averaging
    pub avg_spectrum: Option<Vec<f32>>,
    /// EMA smoothing factor (0.0 = no smoothing, 1.0 = no averaging)
    pub avg_alpha: f32,
    /// Display min/max dB
    pub display_min_db: i32,
    pub display_max_db: i32,
    /// IQ sample accumulator for async reading
    pub iq_accumulator: Vec<u8>,
    /// Current read offset into iq_accumulator
    pub iq_offset: usize,
    /// Reusable IQ frame buffer
    pub iq_frame: Vec<u8>,
    /// Validated frame rate for display
    pub display_frame_rate: u32,
    /// Whether training capture is active
    pub training_active: bool,
    /// Current training label
    pub training_label: Option<String>,
    /// Current training signal area
    pub training_signal_area: Option<String>,
    /// Signal stitcher for accumulating FFT frames during training
    pub training_stitcher: Option<SignalStitcher>,
    /// Accumulated training samples
    pub training_samples: Vec<crate::stitching::TrainingSample>,
    /// Whether capture is active
    pub capture_active: bool,
    /// Current capture job ID
    pub capture_job_id: Option<String>,
    /// Capture start time
    pub capture_start: Option<Instant>,
    /// Capture duration in seconds
    pub capture_duration_s: f64,
    /// Capture file type
    pub capture_file_type: String,
    /// Whether capture should be encrypted
    pub capture_encrypted: bool,
    /// Whether to trigger playback after capture completion
    pub capture_playback: bool,
    /// Accumulated IQ samples for capture
    pub capture_buffer: Vec<u8>,
    /// Accumulated spectrum frames for capture
    pub spectrum_buffer: Vec<f32>,
}

impl SdrProcessor {
    /// Create a new SDR processor with automatic device selection
    pub fn new() -> Result<Self> {
        let device = SdrDeviceFactory::create_device()?;
        Self::with_device(device)
    }
    
    /// Create a new SDR processor with a specific device
    pub fn with_device(device: Box<dyn SdrDevice>) -> Result<Self> {
        let sample_rate = device.get_sample_rate();
        let _center_freq = device.get_center_frequency();
        
        // Load settings from signals.yaml (reuse existing loading logic)
        // TODO: Replace with proper server utils when integration is ready
        // For now, create a minimal config
        use serde::Deserialize;
        
        #[derive(Debug, Clone, Deserialize)]
        struct SdrConfig {
            fft: FftConfig,
            display: DisplayConfig,
        }
        
        #[derive(Debug, Clone, Deserialize)]
        struct FftConfig {
            default_size: usize,
            default_frame_rate: u32,
        }
        
        #[derive(Debug, Clone, Deserialize)]
        struct DisplayConfig {
            min_db: i32,
            max_db: i32,
        }
        
        let sdr_settings = SdrConfig {
            fft: FftConfig {
                default_size: 32768,
                default_frame_rate: 60,
            },
            display: DisplayConfig {
                min_db: -120,
                max_db: 0,
            },
        };
        let fft_cfg = sdr_settings.fft.clone();
        let display_cfg = sdr_settings.display.clone();
        
        let fft_size = fft_cfg.default_size;
        let min_db = display_cfg.min_db;
        let max_db = display_cfg.max_db;
        let default_frame_rate = fft_cfg.default_frame_rate;
        
        let mut fft_processor = FFTProcessor::new_with_defaults(fft_size, sample_rate, min_db, max_db);
        
        // Align initial zoom width and size to config
        let mut cfg = fft_processor.config().clone();
        cfg.zoom_width = fft_size;
        fft_processor.update_config(cfg);
        
        let processor = Self {
            device,
            fft_processor,
            frame_counter: 0,
            avg_spectrum: None,
            avg_alpha: 0.3,
            display_min_db: min_db,
            display_max_db: max_db,
            iq_accumulator: Vec::new(),
            iq_offset: 0,
            iq_frame: Vec::new(),
            display_frame_rate: default_frame_rate,
            training_active: false,
            training_label: None,
            training_signal_area: None,
            training_stitcher: None,
            training_samples: Vec::new(),
            capture_active: false,
            capture_job_id: None,
            capture_start: None,
            capture_duration_s: 0.0,
            capture_file_type: String::new(),
            capture_encrypted: false,
            capture_playback: false,
            capture_buffer: Vec::new(),
            spectrum_buffer: Vec::new(),
        };
        
        info!("SDR processor created with device: {}", processor.device.device_type());
        Ok(processor)
    }
    
    /// Force mock mode
    pub fn new_mock() -> Result<Self> {
        let device = SdrDeviceFactory::create_mock_device();
        Self::with_device(device)
    }
    
    /// Force RTL-SDR mode (will error if no device available)
    pub fn new_rtlsdr() -> Result<Self> {
        let device = SdrDeviceFactory::create_rtlsdr_device()?;
        Self::with_device(device)
    }
    
    /// Initialize the SDR processor and device
    pub fn initialize(&mut self) -> Result<()> {
        self.device.initialize()?;
        info!("SDR processor initialized with {}", self.device.device_type());
        Ok(())
    }
    
    /// Check if the device is ready for reading
    pub fn is_ready(&self) -> bool {
        self.device.is_ready()
    }
    
    /// Read and process one frame from the device
    pub fn read_and_process_frame(&mut self) -> Result<Vec<f32>> {
        let fft_size = self.fft_processor.config().fft_size;
        
        // Read samples from the device
        let samples = self.device.read_samples(fft_size)?;
        
        // Process the samples through FFT
        let result = self.fft_processor.process_samples(&samples)?;
        let mut spectrum = result.power_spectrum;
        
        // DC spike suppression
        let len = spectrum.len();
        if len > 6 {
            let center = len / 2;
            let left = spectrum[center - 3];
            let right = spectrum[center + 3];
            for i in 0..5 {
                let t = (i + 1) as f32 / 6.0;
                spectrum[center - 2 + i] = left * (1.0 - t) + right * t;
            }
        }
        
        // Frame averaging (exponential moving average)
        let alpha = self.avg_alpha;
        if let Some(ref mut avg) = self.avg_spectrum {
            if avg.len() == spectrum.len() {
                for (i, val) in spectrum.iter().enumerate() {
                    avg[i] = alpha * val + (1.0 - alpha) * avg[i];
                }
                Ok(avg.clone())
            } else {
                self.avg_spectrum = Some(spectrum.clone());
                Ok(spectrum)
            }
        } else {
            self.avg_spectrum = Some(spectrum.clone());
            Ok(spectrum)
        }
    }
    
    /// Apply settings to both the device and FFT processor
    pub fn apply_settings(&mut self, fft_size: Option<usize>, fft_window: Option<String>, 
                         frame_rate: Option<u32>, gain: Option<f64>, ppm: Option<i32>, 
                         tuner_agc: Option<bool>, rtl_agc: Option<bool>) -> Result<()> {
        let mut config = self.fft_processor.config().clone();
        let mut config_changed = false;
        
        // Always ensure the FFT processor sample rate matches the device
        let device_sample_rate = self.device.get_sample_rate();
        if config.sample_rate != device_sample_rate {
            config.sample_rate = device_sample_rate;
            config_changed = true;
            info!("Updated FFT processor sample rate to {} Hz", device_sample_rate);
        }
        
        // FFT size
        if let Some(size) = fft_size {
            if size > 0 && (size & (size - 1)) == 0 {
                if config.fft_size != size {
                    config.fft_size = size;
                    config.zoom_width = size;
                    config_changed = true;
                    info!("FFT size changed to {}", size);
                }
            } else {
                warn!("Invalid FFT size {} (must be power of 2), ignoring", size);
            }
        }
        
        // FFT window
        if let Some(ref window_name) = fft_window {
            let window_type = match window_name.to_lowercase().as_str() {
                "rectangular" | "none" => crate::fft::WindowType::Rectangular,
                "hanning" | "hann" => crate::fft::WindowType::Hanning,
                "hamming" => crate::fft::WindowType::Hamming,
                "blackman" => crate::fft::WindowType::Blackman,
                "nuttall" => crate::fft::WindowType::Nuttall,
                _ => {
                    warn!("Unknown window type '{}', using Rectangular", window_name);
                    crate::fft::WindowType::Rectangular
                }
            };
            if config.window_type != window_type {
                config.window_type = window_type;
                config_changed = true;
                info!("FFT window changed to {:?}", window_type);
            }
        }
        
        // Frame rate
        if let Some(requested_rate) = frame_rate {
            let max_rate = self.calculate_max_frame_rate(config.fft_size);
            let clamped_rate = requested_rate.clamp(1, max_rate);
            if clamped_rate != requested_rate {
                warn!("Requested frame rate {} fps exceeds maximum {} fps, clamping to {}", 
                      requested_rate, max_rate, clamped_rate);
            }
            self.display_frame_rate = clamped_rate;
            info!("Frame rate set to {} fps", clamped_rate);
        }
        
        // Device settings
        if let Some(g_db) = gain {
            self.device.set_gain(g_db)?;
            // Convert dB to linear amplitude multiplier for FFT
            let baseline_db = 49.6; // From signals.yaml
            let delta_db = g_db - baseline_db;
            config.gain = 10f32.powf(delta_db as f32 / 20.0);
            config_changed = true;
        }
        
        if let Some(p) = ppm {
            self.device.set_ppm(p)?;
            config.ppm = p as f32;
            config_changed = true;
        }
        
        if let Some(tuner_agc) = tuner_agc {
            self.device.set_tuner_agc(tuner_agc)?;
        }
        
        if let Some(rtl_agc) = rtl_agc {
            self.device.set_rtl_agc(rtl_agc)?;
        }
        
        if config_changed {
            self.fft_processor.update_config(config);
        }
        
        Ok(())
    }
    
    /// Calculate maximum frame rate for given FFT size
    fn calculate_max_frame_rate(&self, fft_size: usize) -> u32 {
        // Simplified calculation - base on FFT size
        match fft_size {
            0..=8192 => 60,
            8193..=16384 => 60,
            16385..=32768 => 60,
            32769..=65536 => 48,
            65537..=131072 => 24,
            _ => 12,
        }
    }
    
    /// Set center frequency
    pub fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
        self.device.set_center_frequency(freq)?;
        // Clear averaging when frequency changes
        self.avg_spectrum = None;
        Ok(())
    }
    
    /// Get device type information
    pub fn device_type(&self) -> &'static str {
        self.device.device_type()
    }
    
    /// Get current center frequency
    pub fn get_center_frequency(&self) -> u32 {
        self.device.get_center_frequency()
    }
    
    /// Get current sample rate
    pub fn get_sample_rate(&self) -> u32 {
        self.device.get_sample_rate()
    }
    
    /// Reset device buffers
    pub fn reset_buffer(&mut self) -> Result<()> {
        self.device.reset_buffer()?;
        self.iq_accumulator.clear();
        self.iq_offset = 0;
        self.avg_spectrum = None;
        Ok(())
    }
    
    /// Cleanup resources
    pub fn cleanup(&mut self) -> Result<()> {
        self.device.cleanup()?;
        info!("SDR processor cleanup completed");
        Ok(())
    }
    
    // TODO: Replace with proper types when server integration is ready
    pub fn check_capture_completion(&mut self) -> Option<(String, /* CaptureArtifact */ ())> {
        None
    }
}
